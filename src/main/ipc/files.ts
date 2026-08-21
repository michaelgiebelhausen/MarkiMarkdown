import { promises as fsp, constants } from 'node:fs'
import { join, dirname, basename, extname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { shell } from 'electron'
import log from 'electron-log/main'
import type { FileOps } from './filing'
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

/** The real disk, behind the same small interface the filing tests use. */
export const diskOps: FileOps = {
  async dirExists(path) {
    try {
      return (await fsp.stat(path)).isDirectory()
    } catch {
      return false
    }
  },
  async canWrite(dir) {
    try {
      await fsp.access(dir, constants.W_OK)
      return true
    } catch {
      return false
    }
  },
  async exists(path) {
    try {
      await fsp.access(path)
      return true
    } catch {
      return false
    }
  },
  async readText(path) {
    const buffer = await fsp.readFile(path)
    return decodeText(buffer).text
  },
  writeAtomic,
  async createExclusive(path, text) {
    try {
      const handle = await fsp.open(path, 'wx')
      try {
        await handle.writeFile(text, 'utf8')
      } finally {
        await handle.close()
      }
      return true
    } catch {
      return false
    }
  },
  async appendText(path, text) {
    await fsp.appendFile(path, text, 'utf8')
  },
  async trash(path) {
    await shell.trashItem(path)
  },
  async mtime(path) {
    try {
      return (await fsp.stat(path)).mtimeMs
    } catch {
      return null
    }
  }
}

/** Finds other copies of the same note, so the strip can show a faint dot. */
export async function findSiblings(
  folders: string[],
  noteId: string,
  selfPaths: string[]
): Promise<string[]> {
  const found: string[] = []
  for (const folder of folders) {
    try {
      const entries = await fsp.readdir(folder, { withFileTypes: true })
      let scanned = 0
      for (const entry of entries) {
        if (scanned > 500) break
        if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.md') continue
        if (entry.name === 'log.md') continue
        scanned += 1
        const full = join(folder, entry.name)
        if (selfPaths.includes(full)) continue
        try {
          const head = (await fsp.readFile(full, 'utf8')).slice(0, 800)
          if (head.includes(noteId)) {
            found.push(full)
            break
          }
        } catch {
          /* unreadable file - skip */
        }
      }
    } catch {
      /* folder gone - skip */
    }
  }
  return found
}
