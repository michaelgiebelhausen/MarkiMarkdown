/**
 * Filing a note into one or more second-brain folders.
 *
 * Two promises to the student:
 *  1. All or nothing. Every destination is checked before a single byte is written,
 *     and the original is never removed until every copy is safely on disk.
 *  2. Nothing is ever hard deleted. Removals go to the operating system's trash.
 *
 * Every disk operation goes through FileOps so the whole procedure - including the
 * ugly failure paths - can be exercised in tests without touching a real disk.
 */

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

export interface RemovalRef extends FolderRef {
  filePath: string
}

export interface FilingPlan {
  content: string
  fileName: string
  noteId: string
  agentNames: string[]
  /** Copies that already exist and should be rewritten. */
  currentPaths: string[]
  /** Where the note was opened from, if that is not already a destination. */
  originalPath?: string
  addFolders: FolderRef[]
  removeFolders?: RemovalRef[]
  /** Every folder the note ends up in, for the log line. */
  allFolderNames: string[]
  now: string
  conflictChoice?: 'replace' | 'keepBoth' | 'cancel'
}

export interface UndoRecord {
  originalPath?: string
  originalText?: string
  written: { path: string; text: string; folderPath: string; logLine: string }[]
  removed: { path: string; text: string; folderPath: string }[]
  /** Notes that a "replace" displaced. They are in the trash and can be put back. */
  replaced: { path: string; text: string }[]
  now: string
}

export interface FilingOutcome {
  ok: boolean
  written: { path: string; hash: string }[]
  trashed: string[]
  failures: { folderName: string; message: string }[]
  originalKept: boolean
  notice: string
  undo: UndoRecord
}

export const LOG_HEADER =
  '# Filing log\n\nEach line records a note filed into this folder by MarkiMarkdown.\n\n'

const NEWLINE = String.fromCharCode(10)

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

export function sanitizeFileName(input: string): string {
  const withoutExt = input.replace(/\.(md|markdown|txt|text)$/i, '')
  let name = withoutExt.normalize('NFC')
  name = name.replace(/[<>:"|?*\u0000-\u001f]/g, '')
  name = name.split('/').join('').split(String.fromCharCode(92)).join('')
  name = name.replace(/[. ]+$/, '').replace(/^[. ]+/, '')
  if (WINDOWS_RESERVED.test(name)) name = `${name}-note`
  // log.md belongs to the folder itself; a note must never take its place
  if (name.toLowerCase() === 'log') name = `${name}-note`
  if (name.length === 0) name = 'note'
  if (name.length > 120) name = name.slice(0, 120).replace(/[. ]+$/, '')
  return `${name}.md`
}

export function buildLogLine(input: {
  now: string
  fileName: string
  noteId: string
  agentNames: string[]
  otherFolderNames: string[]
  verb?: string
}): string {
  const verb = input.verb ?? 'filed'
  const parts = [`- ${input.now} - ${verb} ${input.fileName}`, `id ${input.noteId}`]
  if (input.agentNames.length > 0) parts.push(`for ${input.agentNames.join(', ')}`)
  if (input.otherFolderNames.length > 0) parts.push(`also in ${input.otherFolderNames.join(', ')}`)
  return `${parts.join(' - ')}\n`
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

function idOf(text: string): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)/.exec(text)
  if (!match) return null
  const line = /^id:\s*(.+)$/m.exec(match[1])
  return line ? line[1].trim().replace(/^["']|["']$/g, '') : null
}

export interface PreflightOutcome {
  ok: boolean
  conflicts: { folderName: string; destPath: string; sameId: boolean }[]
  unavailable: { folderName: string; message: string }[]
}

export async function preflight(ops: FileOps, plan: FilingPlan): Promise<PreflightOutcome> {
  const conflicts: PreflightOutcome['conflicts'] = []
  const unavailable: PreflightOutcome['unavailable'] = []
  const fileName = sanitizeFileName(plan.fileName)

  for (const folder of plan.addFolders) {
    try {
      if (!(await ops.dirExists(folder.path))) {
        unavailable.push({
          folderName: folder.name,
          message: `${folder.name} could not be found. It may have been moved, renamed, or be on a drive that is not connected.`
        })
        continue
      }
      if (!(await ops.canWrite(folder.path))) {
        unavailable.push({
          folderName: folder.name,
          message: `${folder.name} cannot be written to. Check the folder's permissions.`
        })
        continue
      }
      const destPath = joinPath(folder.path, fileName)
      // A file at the destination that IS this note is not a clash with anyone else.
      const isSelf =
        destPath === plan.originalPath || plan.currentPaths.some((p) => p === destPath)
      if (!isSelf && (await ops.exists(destPath))) {
        let sameId = false
        try {
          sameId = idOf(await ops.readText(destPath)) === plan.noteId
        } catch {
          sameId = false
        }
        conflicts.push({ folderName: folder.name, destPath, sameId })
      }
    } catch {
      unavailable.push({
        folderName: folder.name,
        message: `${folder.name} could not be reached right now.`
      })
    }
  }

  const realClashes = conflicts.filter((c) => !c.sameId)
  return { ok: unavailable.length === 0 && realClashes.length === 0, conflicts, unavailable }
}

async function nextFreePath(ops: FileOps, destPath: string): Promise<string> {
  const dot = destPath.lastIndexOf('.')
  const stem = dot === -1 ? destPath : destPath.slice(0, dot)
  const ext = dot === -1 ? '' : destPath.slice(dot)
  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem}-${n}${ext}`
    if (!(await ops.exists(candidate))) return candidate
  }
  return `${stem}-${Date.parse('2026-01-01')}${ext}`
}

async function appendToLog(ops: FileOps, folderPath: string, line: string): Promise<void> {
  // The log helps agents notice new notes, but a note that is safely on disk must
  // never be reported as a failure because its folder log could not be written.
  try {
    const logPath = joinPath(folderPath, 'log.md')
    if (!(await ops.exists(logPath))) {
      await ops.writeAtomic(logPath, LOG_HEADER + line)
      return
    }
    const existing = await ops.readText(logPath)
    const prefix = existing.length > 0 && !existing.endsWith(NEWLINE) ? NEWLINE : ''
    await ops.appendText(logPath, prefix + line)
  } catch {
    /* the note is filed; the log entry is not worth failing over */
  }
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

function friendlyWriteError(folderName: string): string {
  return `${folderName} could not be written to. It may be open in another program, or syncing.`
}

export async function runFiling(ops: FileOps, plan: FilingPlan): Promise<FilingOutcome> {
  const fileName = sanitizeFileName(plan.fileName)
  const undo: UndoRecord = { written: [], removed: [], replaced: [], now: plan.now }
  const written: FilingOutcome['written'] = []
  const failures: FilingOutcome['failures'] = []
  const trashed: string[] = []

  const check = await preflight(ops, plan)
  if (check.unavailable.length > 0) {
    return {
      ok: false,
      written: [],
      trashed: [],
      failures: check.unavailable.map((u) => ({ folderName: u.folderName, message: u.message })),
      originalKept: true,
      notice: '',
      undo
    }
  }

  const realClashes = check.conflicts.filter((c) => !c.sameId)
  const choice = plan.conflictChoice ?? 'replace'
  if (realClashes.length > 0 && choice === 'cancel') {
    return {
      ok: false,
      written: [],
      trashed: [],
      failures: realClashes.map((c) => ({
        folderName: c.folderName,
        message: `${c.folderName} already has a different note with that name.`
      })),
      originalKept: true,
      notice: '',
      undo
    }
  }

  // 1. rewrite the copies the note already occupies
  for (const path of plan.currentPaths) {
    try {
      await ops.writeAtomic(path, plan.content)
      written.push({ path, hash: hashText(plan.content) })
    } catch {
      failures.push({ folderName: path, message: friendlyWriteError(path) })
    }
  }

  // 2. write each new destination
  for (const folder of plan.addFolders) {
    let destPath = joinPath(folder.path, fileName)
    try {
      const clash = realClashes.find((c) => c.destPath === destPath)
      if (clash && choice === 'keepBoth') {
        destPath = await nextFreePath(ops, destPath)
      } else if (clash) {
        // Replacing must never destroy someone's work outright: put the note that
        // was there into the trash first, and remember it so Undo can restore it.
        try {
          const displaced = await ops.readText(destPath)
          if (await trashWithRetries(ops, destPath)) {
            undo.replaced.push({ path: destPath, text: displaced })
            trashed.push(destPath)
          }
        } catch {
          /* unreadable: fall through and overwrite */
        }
      }
      await ops.writeAtomic(destPath, plan.content)
      const others = plan.allFolderNames.filter((n) => n !== folder.name)
      const logLine = buildLogLine({
        now: plan.now,
        fileName,
        noteId: plan.noteId,
        agentNames: plan.agentNames,
        otherFolderNames: others
      })
      written.push({ path: destPath, hash: hashText(plan.content) })
      undo.written.push({ path: destPath, text: plan.content, folderPath: folder.path, logLine })
      await appendToLog(ops, folder.path, logLine)
    } catch {
      failures.push({ folderName: folder.name, message: friendlyWriteError(folder.name) })
    }
  }

  // 3. remove copies the student switched off
  for (const removal of plan.removeFolders ?? []) {
    try {
      const text = await ops.readText(removal.filePath)
      const gone = await trashWithRetries(ops, removal.filePath)
      if (gone) {
        trashed.push(removal.filePath)
        undo.removed.push({ path: removal.filePath, text, folderPath: removal.path })
        await appendToLog(
          ops,
          removal.path,
          buildLogLine({
            now: plan.now,
            fileName,
            noteId: plan.noteId,
            agentNames: [],
            otherFolderNames: [],
            verb: 'removed'
          })
        )
      } else {
        failures.push({
          folderName: removal.name,
          message: `The copy in ${removal.name} could not be removed. It may be open in another program.`
        })
      }
    } catch {
      /* the copy was already gone - nothing to do */
    }
  }

  const ok = failures.length === 0

  // 4. only once every destination is safely written, retire the original
  let originalKept = false
  let notice = ''
  const original = plan.originalPath
  if (ok && original && !plan.currentPaths.includes(original)) {
    const isDestination = undo.written.some((w) => w.path === original)
    if (!isDestination) {
      try {
        const text = await ops.readText(original)
        const gone = await trashWithRetries(ops, original)
        if (gone) {
          trashed.push(original)
          undo.originalPath = original
          undo.originalText = text
        } else {
          originalKept = true
          notice = 'The note was filed, but the original is still in its old folder because another program is using it.'
        }
      } catch {
        /* already gone */
      }
    }
  }

  return { ok, written, trashed, failures, originalKept, notice, undo }
}

export interface UndoOutcome {
  ok: boolean
  /** Copies left in place because something else had already changed them. */
  keptChanged: string[]
  message: string
}

export async function undoFiling(ops: FileOps, undo: UndoRecord): Promise<UndoOutcome> {
  const keptChanged: string[] = []

  // put the original back, unless something already reappeared at that path
  if (undo.originalPath && undo.originalText !== undefined) {
    try {
      await ops.createExclusive(undo.originalPath, undo.originalText)
    } catch {
      /* leave whatever is there */
    }
  }

  // restore copies that were trashed
  for (const removed of undo.removed) {
    try {
      await ops.createExclusive(removed.path, removed.text)
    } catch {
      /* leave whatever is there */
    }
  }

  // bring back anything a replace displaced, once our copy is out of the way
  const restoreReplaced = async () => {
    for (const item of undo.replaced) {
      try {
        if (await ops.exists(item.path)) continue
        await ops.createExclusive(item.path, item.text)
      } catch {
        /* leave whatever is there */
      }
    }
  }

  // remove the copies this filing wrote, but only if they are untouched
  for (const entry of undo.written) {
    try {
      if (!(await ops.exists(entry.path))) continue
      const current = await ops.readText(entry.path)
      if (hashText(current) !== hashText(entry.text)) {
        keptChanged.push(entry.path)
        continue
      }
      await trashWithRetries(ops, entry.path)
    } catch {
      keptChanged.push(entry.path)
    }

    // tidy the log line, but only while it is still the last thing written
    try {
      const logPath = joinPath(entry.folderPath, 'log.md')
      if (!(await ops.exists(logPath))) continue
      const log = await ops.readText(logPath)
      if (log.endsWith(entry.logLine)) {
        await ops.writeAtomic(logPath, log.slice(0, log.length - entry.logLine.length))
      } else if (log.includes(entry.logLine)) {
        await ops.appendText(
          logPath,
          `- ${undo.now} - undone: the filing above was undone\n`
        )
      }
    } catch {
      /* the log is a convenience, never a failure */
    }
  }

  await restoreReplaced()

  return {
    ok: true,
    keptChanged,
    message:
      keptChanged.length === 0
        ? 'Put back.'
        : 'Put back. Some copies were left alone because they had already changed.'
  }
}
