import { promises as fsp, constants } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { randomBytes } from 'node:crypto'
import { shell } from 'electron'
import log from 'electron-log/main'
import type { ArchiveOps } from './archive'
import type { LoadedFile } from '../../shared/types'

/** Decodes a file the way a student's tools actually wrote it. */
export function decodeText(buffer: Buffer): { text: string; hadBom: boolean; encoding: LoadedFile['encoding'] } {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: buffer.subarray(2).toString('utf16le'), hadBom: true, encoding: 'utf-16le' }
  }
  const hasUtf8Bom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf
  const body = hasUtf8Bom ? buffer.subarray(3) : buffer
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(body)
    return { text, hadBom: hasUtf8Bom, encoding: 'utf-8' }
  } catch {
    // Word and Notepad still emit the legacy Windows code page
    const text = new TextDecoder('windows-1252').decode(body)
    return { text, hadBom: false, encoding: 'windows-1252' }
  }
}

export async function readFileForEditor(path: string): Promise<LoadedFile> {
  const buffer = await fsp.readFile(path)
  const { text, hadBom, encoding } = decodeText(buffer)
  const stat = await fsp.stat(path)
  return {
    path,
    text,
    eol: text.includes('\r\n') ? '\r\n' : '\n',
    hadBom,
    encoding,
    mtimeMs: stat.mtimeMs
  }
}

/** Writes through a temp file in the same folder, so a crash never truncates a note. */
export async function writeAtomic(path: string, text: string): Promise<void> {
  const dir = dirname(path)
  await fsp.mkdir(dir, { recursive: true })
  const temp = join(dir, `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`)
  const handle = await fsp.open(temp, 'w')
  try {
    await handle.writeFile(text, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await fsp.rename(temp, path)
}

export function translateFsError(error: unknown, what: string): string {
  const code = (error as NodeJS.ErrnoException)?.code
  switch (code) {
    case 'EPERM':
    case 'EACCES':
      return `MarkiMarkdown is not allowed to open ${what}. On a Mac, check System Settings, Privacy and Security, Files and Folders.`
    case 'ENOENT':
      return `${what} could not be found. It may have been moved or renamed.`
    case 'EBUSY':
      return `${what} is in use by another program. Close it there and try again.`
    case 'EISDIR':
      return `${what} is a folder, not a note.`
    case 'ENOSPC':
      return 'There is no space left on the disk.'
    default:
      log.error('File error', error)
      return `${what} could not be opened.`
  }
}

function code(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException)?.code
}

/** Removes a file this flow created itself and could not finish. A failure here is only logged. */
async function removePartial(path: string): Promise<void> {
  try {
    await fsp.unlink(path)
  } catch (error) {
    log.warn('Could not remove an unfinished copy', path, error)
  }
}

/**
 * A copy that inherited the read-only flag: make it writable, flush it through a writable
 * handle, then put its mode back. Returns false (changing nothing that lasts) when any
 * step before the flush is refused.
 */
async function syncReadOnlyCopy(path: string): Promise<boolean> {
  let mode: number
  try {
    mode = (await fsp.stat(path)).mode & 0o7777
    await fsp.chmod(path, mode | 0o200)
  } catch (error) {
    log.warn('Could not make a read-only copy writable to flush it', path, error)
    return false
  }
  try {
    let handle: Awaited<ReturnType<typeof fsp.open>>
    try {
      handle = await fsp.open(path, 'r+')
    } catch (error) {
      log.warn('Could not open a read-only copy for writing to flush it', path, error)
      return false
    }
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
    return true
  } finally {
    try {
      await fsp.chmod(path, mode)
    } catch (error) {
      log.warn('Could not make the copy read-only again', path, error)
    }
  }
}

/**
 * Flushes a finished copy to the disk. A copy that inherited the read-only flag cannot be
 * opened for writing, so it is made writable for the flush and read-only again after. If
 * even that is refused, Windows will not flush a handle opened only for reading: that one
 * case is logged and accepted, because copyFile itself already finished.
 */
async function syncCopy(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof fsp.open>>
  let readOnly = false
  try {
    handle = await fsp.open(path, 'r+')
  } catch (error) {
    if (code(error) !== 'EPERM' && code(error) !== 'EACCES') throw error
    if (await syncReadOnlyCopy(path)) return
    handle = await fsp.open(path, 'r')
    readOnly = true
  }
  try {
    await handle.sync()
  } catch (error) {
    const refused = code(error) === 'EPERM' || code(error) === 'EACCES' || code(error) === 'EBADF'
    if (!(readOnly && refused)) throw error
    log.warn('Could not flush a read-only copy', path, error)
  } finally {
    await handle.close()
  }
}

/** The real disk behind the save flow's ArchiveOps. */
export const diskArchiveOps: ArchiveOps = {
  async dirExists(path) {
    try {
      return (await fsp.stat(path)).isDirectory()
    } catch {
      return false
    }
  },
  listNames: (dir) => fsp.readdir(dir),
  async createExclusive(path, text) {
    let handle: Awaited<ReturnType<typeof fsp.open>>
    try {
      handle = await fsp.open(path, 'wx')
    } catch (error) {
      if (code(error) === 'EEXIST') return false
      throw error
    }
    // From here the file is ours: a write that fails half way must not leave a stub behind.
    try {
      try {
        await handle.writeFile(text, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
    } catch (error) {
      await removePartial(path)
      throw error
    }
    return true
  },
  async copyExclusive(from, to) {
    try {
      await fsp.copyFile(from, to, constants.COPYFILE_EXCL)
    } catch (error) {
      if (code(error) === 'EEXIST') return false
      throw error
    }
    // The cross-drive move trashes the original next, so the copy must be on the disk first.
    try {
      await syncCopy(to)
    } catch (error) {
      await removePartial(to)
      throw error
    }
    return true
  },
  async exists(path) {
    try {
      await fsp.access(path)
      return true
    } catch {
      return false
    }
  },
  rename: (from, to) => fsp.rename(from, to),
  trash: (path) => shell.trashItem(path)
}
