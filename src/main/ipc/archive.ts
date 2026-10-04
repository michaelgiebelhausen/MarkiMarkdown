/**
 * Disk work for the save flow: archive copies, brand new notes and moving the working
 * file. Two promises: nothing that is already on disk is ever overwritten, and a
 * failure says what happened in words a student can act on.
 *
 * Every disk operation goes through ArchiveOps so the failure paths can be tested
 * without touching a real disk.
 */
import { basename, dirname, join } from 'node:path'
import { archiveStem, freeName } from '../../shared/archive'
import { samePath } from '../../shared/paths'

export interface ArchiveOps {
  dirExists(path: string): Promise<boolean>
  listNames(dir: string): Promise<string[]>
  /** Creates the file only if nothing is there: false when something is, throws on any other failure. */
  createExclusive(path: string, text: string): Promise<boolean>
  /** Copies byte for byte, with the same contract as createExclusive. */
  copyExclusive(from: string, to: string): Promise<boolean>
  exists(path: string): Promise<boolean>
  rename(from: string, to: string): Promise<void>
  trash(path: string): Promise<void>
}

export type WriteResult = { ok: true; path: string; notice?: string } | { ok: false; message: string }

const MISSING = "The folder can't be found. It may have been moved, renamed, or be on a drive that isn't connected."
const UNWRITABLE = "The folder can't be written to. It may be open in another program, or syncing."

// Windows reports a file held by another program or a sync client as EPERM/EACCES too.
const NOT_ALLOWED =
  "The folder can't be written to. It may be open in another program or syncing, or MarkiMarkdown may not have permission to save there."
const NO_SPACE = 'There is no space left on the disk.'
const TOO_LONG = 'The name is too long for this folder. Try a shorter note name or a folder nearer the top of the drive.'
const NOTE_GONE = "The note couldn't be found. It may have been moved or renamed outside MarkiMarkdown."

/** Says what the disk actually refused, falling back to `fallback` for anything unexpected. */
function failureMessage(error: unknown, fallback: string): string {
  switch ((error as NodeJS.ErrnoException)?.code) {
    case 'ENOSPC':
      return NO_SPACE
    case 'EACCES':
    case 'EPERM':
      return NOT_ALLOWED
    case 'ENAMETOOLONG':
      return TOO_LONG
    default:
      return fallback
  }
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

export function sanitizeFileName(input: string): string {
  const withoutExt = input.replace(/\.(md|markdown|txt|text)$/i, '')
  let name = withoutExt.normalize('NFC')
  name = name.replace(/[<>:"|?*\u0000-\u001f]/g, '')
  name = name.split('/').join('').split(String.fromCharCode(92)).join('')
  name = name.replace(/[. ]+$/, '').replace(/^[. ]+/, '')
  if (WINDOWS_RESERVED.test(name)) name = `${name}-note`
  if (name.length === 0) name = 'note'
  if (name.length > 120) name = name.slice(0, 120).replace(/[. ]+$/, '')
  return `${name}.md`
}

/** Writes `text` as stem.md, or stem-2.md and so on, in `dir`. Never overwrites. */
export async function createWithFreeName(ops: ArchiveOps, dir: string, stem: string, text: string): Promise<WriteResult> {
  if (!(await ops.dirExists(dir))) return { ok: false, message: MISSING }
  let existing: string[]
  try {
    existing = await ops.listNames(dir)
  } catch (error) {
    return { ok: false, message: failureMessage(error, UNWRITABLE) }
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    const name = freeName(stem, existing)
    const path = join(dir, name)
    let created: boolean
    try {
      created = await ops.createExclusive(path, text)
    } catch (error) {
      return { ok: false, message: failureMessage(error, UNWRITABLE) }
    }
    if (created) return { ok: true, path }
    // Someone else wrote that name between our listing and our write. Take the next one.
    existing = [...existing, name]
  }
  return { ok: false, message: 'There are too many notes with that name already.' }
}

/** The dated, never-overwriting copy of the working note in a raw folder. */
export function writeArchiveCopy(
  ops: ArchiveOps,
  rawDir: string,
  workingFileName: string,
  date: string,
  text: string
): Promise<WriteResult> {
  return createWithFreeName(ops, rawDir, archiveStem(sanitizeFileName(workingFileName), date), text)
}

/** The first save of an untitled note into a folder the student chose. */
export function writeNewNote(ops: ArchiveOps, dir: string, fileName: string, text: string): Promise<WriteResult> {
  return createWithFreeName(ops, dir, sanitizeFileName(fileName).replace(/\.md$/, ''), text)
}

/** Moves the working file to another folder, keeping its name. Never overwrites. */
export async function moveWorkingFile(ops: ArchiveOps, from: string, toDir: string): Promise<WriteResult> {
  if (samePath(dirname(from), toDir)) return { ok: true, path: from }
  if (!(await ops.dirExists(toDir))) return { ok: false, message: MISSING }
  const name = basename(from)
  const dest = join(toDir, name)
  const clash = `That folder already has a note called ${name}.`
  if (await ops.exists(dest)) return { ok: false, message: clash }

  try {
    await ops.rename(from, dest)
    return { ok: true, path: dest }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    // ENOENT names either end: the note itself, or the folder vanishing since the check above.
    if (code === 'ENOENT') return { ok: false, message: (await ops.exists(from)) ? MISSING : NOTE_GONE }
    if (code !== 'EXDEV') {
      return { ok: false, message: failureMessage(error, "The note couldn't be moved. It may be open in another program.") }
    }
  }

  // A rename cannot cross drives: copy byte for byte, then put the original in the trash.
  try {
    if (!(await ops.copyExclusive(from, dest))) return { ok: false, message: clash }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT' && !(await ops.exists(from))) {
      return { ok: false, message: NOTE_GONE }
    }
    return { ok: false, message: failureMessage(error, UNWRITABLE) }
  }
  try {
    await ops.trash(from)
  } catch {
    return { ok: true, path: dest, notice: 'The note was moved, but the old copy is still where it was.' }
  }
  return { ok: true, path: dest }
}
