/**
 * Filing a note into a bunch's raw folder.
 *
 * Two promises to the student:
 *  1. The destination is checked before a single byte is written, and the note's
 *     previous location is never removed until the new copy is safely on disk.
 *  2. Nothing is ever hard deleted. Removals go to the operating system's trash.
 *
 * Every disk operation goes through FileOps so the whole procedure - including the
 * ugly failure paths - can be exercised in tests without touching a real disk.
 */
import { samePath, dirName } from '../../shared/paths'

export interface FileOps {
  dirExists(path: string): Promise<boolean>
  canWrite(dir: string): Promise<boolean>
  exists(path: string): Promise<boolean>
  readText(path: string): Promise<string>
  /** Writes via a temp file inside the destination folder, then renames. */
  writeAtomic(path: string, text: string): Promise<void>
  /** Returns false when the path already existed. */
  createExclusive(path: string, text: string): Promise<boolean>
  appendText(path: string, text: string): Promise<void>
  trash(path: string): Promise<void>
  mtime(path: string): Promise<number | null>
}

export interface FolderRef {
  name: string
  path: string
}

export interface FilingPlan {
  /** Fully stamped file content. */
  content: string
  fileName: string
  noteId: string
  /** Where the note sits on disk right now, if it has been saved anywhere. */
  currentPath?: string
  /** The bunch's raw folder, named after the bunch for messages. */
  raw: FolderRef
  conflictChoice?: 'replace' | 'keepBoth' | 'cancel'
}

export interface UndoRecord {
  /** The note's previous location and bytes, when filing moved it. */
  movedFrom?: { path: string; text: string }
  /** The new copy filing wrote, when it wrote one. */
  written?: { path: string; text: string }
  /** The note was already in raw and was rewritten where it stood. `before` is null
   *  when there was nothing readable at that path at the time of the rewrite. */
  rewritten?: { path: string; before: string | null; after: string }
  /** A note that "replace" displaced. It is in the trash and can be put back. */
  replaced?: { path: string; text: string }
}

export interface FilingOutcome {
  ok: boolean
  writtenPath?: string
  hash?: string
  trashed: string[]
  failure?: string
  /** The previous copy could not be trashed, so it is still where it was. */
  originalKept: boolean
  notice: string
  undo: UndoRecord
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

/** A cheap content fingerprint - enough to notice that something else rewrote a copy. */
export function hashText(text: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 + c + i, 0x85ebca6b) >>> 0
  }
  return `${h1.toString(16)}${h2.toString(16)}-${text.length}`
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes(String.fromCharCode(92)) && !dir.includes('/') ? String.fromCharCode(92) : '/'
  return dir.endsWith('/') || dir.endsWith(String.fromCharCode(92)) ? `${dir}${name}` : `${dir}${sep}${name}`
}

/**
 * "In place" means this filing would rewrite the note where it already stands,
 * rather than moving a copy into raw. That is only true when the note already sits
 * inside this raw folder AND is already a Markdown file - a `.txt` note that happens
 * to live in raw still needs a real `.md` copy written beside it, not its `.txt`
 * silently overwritten with stamped Markdown.
 */
function isInPlace(currentPath: string, rawPath: string): boolean {
  return samePath(dirName(currentPath), rawPath) && /\.(md|markdown)$/i.test(currentPath)
}

function idOf(text: string): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)/.exec(text)
  if (!match) return null
  const line = /^id:\s*(.+)$/m.exec(match[1])
  return line ? line[1].trim().replace(/^["']|["']$/g, '') : null
}

export interface PreflightOutcome {
  ok: boolean
  /** The destination already holds a file with this name. */
  conflict?: { destPath: string; sameId: boolean }
  /** The raw folder cannot be written to at all. */
  unavailable?: string
}

export async function preflight(ops: FileOps, plan: FilingPlan): Promise<PreflightOutcome> {
  const fileName = sanitizeFileName(plan.fileName)
  const raw = plan.raw
  try {
    if (!(await ops.dirExists(raw.path))) {
      return {
        ok: false,
        unavailable: `${raw.name}'s raw folder could not be found. It may have been moved, renamed, or be on a drive that is not connected.`
      }
    }
    if (!(await ops.canWrite(raw.path))) {
      return { ok: false, unavailable: `${raw.name}'s raw folder cannot be written to. Check the folder's permissions.` }
    }
    const destPath = joinPath(raw.path, fileName)
    // A note that already sits somewhere inside this raw folder is not a clash with
    // anyone else, whatever its current file name happens to be.
    if (plan.currentPath !== undefined && isInPlace(plan.currentPath, raw.path)) return { ok: true }
    if (await ops.exists(destPath)) {
      let sameId = false
      try {
        sameId = idOf(await ops.readText(destPath)) === plan.noteId
      } catch {
        sameId = false
      }
      return { ok: sameId, conflict: { destPath, sameId } }
    }
    return { ok: true }
  } catch {
    return { ok: false, unavailable: `${raw.name}'s raw folder could not be reached right now.` }
  }
}

async function nextFreePath(ops: FileOps, destPath: string): Promise<string> {
  const dot = destPath.lastIndexOf('.')
  const stem = dot === -1 ? destPath : destPath.slice(0, dot)
  const ext = dot === -1 ? '' : destPath.slice(dot)
  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem}-${n}${ext}`
    if (!(await ops.exists(candidate))) return candidate
  }
  return `${stem}-${Date.now()}${ext}`
}

async function trashWithRetries(ops: FileOps, path: string, attempts = 3): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      await ops.trash(path)
      return true
    } catch {
      if (i === attempts - 1) return false
    }
  }
  return false
}

function friendlyWriteError(bunchName: string): string {
  return `${bunchName}'s raw folder could not be written to. It may be open in another program, or syncing.`
}

function failed(failure: string, undo: UndoRecord): FilingOutcome {
  return { ok: false, trashed: [], failure, originalKept: true, notice: '', undo }
}

export async function runFiling(ops: FileOps, plan: FilingPlan): Promise<FilingOutcome> {
  const fileName = sanitizeFileName(plan.fileName)
  const undo: UndoRecord = {}
  const trashed: string[] = []

  const check = await preflight(ops, plan)
  if (check.unavailable) return failed(check.unavailable, undo)

  const clash = check.conflict && !check.conflict.sameId ? check.conflict : undefined
  const choice = plan.conflictChoice ?? 'replace'
  if (clash && choice === 'cancel') {
    return failed(`${plan.raw.name} already has a different note called ${fileName}.`, undo)
  }

  let destPath = joinPath(plan.raw.path, fileName)
  const inPlace = plan.currentPath !== undefined && isInPlace(plan.currentPath, plan.raw.path)
  if (inPlace) destPath = plan.currentPath as string

  // 1. write the new copy
  try {
    if (inPlace) {
      // Already inside this raw folder: rewrite it where it stands, under whatever
      // name it already has. There is no clash to resolve against a name that isn't ours.
      let before: string | null
      try {
        before = await ops.readText(destPath)
      } catch {
        before = null
      }
      await ops.writeAtomic(destPath, plan.content)
      undo.rewritten = { path: destPath, before, after: plan.content }
    } else {
      if (clash && choice === 'keepBoth') {
        destPath = await nextFreePath(ops, destPath)
      } else if (clash) {
        // Replacing must never destroy someone's work outright: put the note that
        // was there into the trash first, and remember it so Undo can restore it.
        try {
          const displaced = await ops.readText(destPath)
          if (await trashWithRetries(ops, destPath)) {
            undo.replaced = { path: destPath, text: displaced }
            trashed.push(destPath)
          }
        } catch {
          /* unreadable: fall through and overwrite */
        }
      }
      await ops.writeAtomic(destPath, plan.content)
      undo.written = { path: destPath, text: plan.content }
    }
  } catch {
    const base = friendlyWriteError(plan.raw.name)
    const failure = undo.replaced
      ? `${base} The note that was there has been moved to the trash; Undo puts it back.`
      : base
    return { ok: false, trashed, failure, originalKept: true, notice: '', undo }
  }

  // 2. only once the new copy is safely written, retire the old location
  let originalKept = false
  let notice = ''
  if (plan.currentPath !== undefined && !inPlace) {
    const originalPath = plan.currentPath
    try {
      const text = await ops.readText(originalPath)
      if (await trashWithRetries(ops, originalPath)) {
        trashed.push(originalPath)
        undo.movedFrom = { path: originalPath, text }
      } else {
        originalKept = true
        notice = 'The note was filed, but the old copy is still where it was because another program is using it.'
      }
    } catch {
      // The read failed - either the original is already gone (nothing to do) or it
      // is locked and unreadable, in which case it is very much still there.
      if (await ops.exists(originalPath)) {
        originalKept = true
        notice = 'The note was filed, but the old copy is still where it was because another program is using it.'
      }
    }
  }

  return { ok: true, writtenPath: destPath, hash: hashText(plan.content), trashed, originalKept, notice, undo }
}

export interface UndoOutcome {
  ok: boolean
  /** Copies left in place because something else had already changed them. */
  keptChanged: string[]
  /** The original could not be restored, so the filed copy was deliberately left alone. */
  notRestored: string[]
  message: string
}

export async function undoFiling(ops: FileOps, undo: UndoRecord): Promise<UndoOutcome> {
  const keptChanged: string[] = []
  const notRestored: string[] = []

  // put the original back, unless something already reappeared at that path
  let restoredOriginal = true
  if (undo.movedFrom) {
    try {
      restoredOriginal = await ops.createExclusive(undo.movedFrom.path, undo.movedFrom.text)
    } catch {
      restoredOriginal = false
    }
    if (!restoredOriginal) notRestored.push(undo.movedFrom.path)
  }

  // remove the copy this filing wrote, but only if it is untouched - and only once
  // the original is safely back where it was, so a failed restore never leaves the
  // student with neither copy.
  if (undo.written && restoredOriginal) {
    try {
      if (await ops.exists(undo.written.path)) {
        const current = await ops.readText(undo.written.path)
        if (hashText(current) !== hashText(undo.written.text)) keptChanged.push(undo.written.path)
        else await trashWithRetries(ops, undo.written.path)
      }
    } catch {
      keptChanged.push(undo.written.path)
    }
  }

  // restore the earlier text of an in-place rewrite, but only if it is untouched
  if (undo.rewritten) {
    try {
      const current = await ops.readText(undo.rewritten.path)
      if (hashText(current) !== hashText(undo.rewritten.after)) {
        keptChanged.push(undo.rewritten.path)
      } else if (undo.rewritten.before === null) {
        // There was nothing readable here before the rewrite; putting the file back
        // means removing it, not writing an empty file in its place.
        await trashWithRetries(ops, undo.rewritten.path)
      } else {
        await ops.writeAtomic(undo.rewritten.path, undo.rewritten.before)
      }
    } catch {
      keptChanged.push(undo.rewritten.path)
    }
  }

  // bring back anything a replace displaced, once our copy is out of the way
  if (undo.replaced) {
    try {
      if (!(await ops.exists(undo.replaced.path))) {
        await ops.createExclusive(undo.replaced.path, undo.replaced.text)
      }
    } catch {
      /* leave whatever is there */
    }
  }

  const message =
    notRestored.length > 0
      ? `The note could not be put back at ${notRestored[0]}, so the filed copy was left where it is.`
      : keptChanged.length === 0
        ? 'Put back.'
        : 'Put back. The filed copy was left alone because it had already changed.'

  return { ok: notRestored.length === 0, keptChanged, notRestored, message }
}
