import { samePath } from './paths'

/** Most file systems refuse a file name longer than this. */
const MAX_NAME = 255
/** Room kept after the base for `-YYYY-MM-DD-NNN.md`. */
const SUFFIX_ROOM = 18

/**
 * The dated name an archive copy starts from, before any -2, -3 suffix. A very long base
 * is cut so the whole name, suffix included, still fits; the cut never splits an emoji
 * and never leaves a trailing space or dot, which Windows would silently drop.
 */
export function archiveStem(fileName: string, date: string): string {
  let base = fileName.replace(/\.(md|markdown|txt|text)$/i, '')
  const room = MAX_NAME - SUFFIX_ROOM
  if (base.length > room) {
    base = base.slice(0, room)
    const last = base.charCodeAt(base.length - 1)
    if (last >= 0xd800 && last <= 0xdbff) base = base.slice(0, -1)
    base = base.replace(/[. ]+$/, '')
    if (base.length === 0) base = 'note'
  }
  return `${base}-${date}`
}

/** stem.md if nobody has it, else stem-2.md, stem-3.md, ... compared ignoring case. */
export function freeName(stem: string, existing: string[]): string {
  const taken = new Set(existing.map((name) => name.toLowerCase()))
  if (!taken.has(`${stem}.md`.toLowerCase())) return `${stem}.md`
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}.md`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}

export function archiveName(fileName: string, date: string, existing: string[]): string {
  return freeName(archiveStem(fileName, date), existing)
}

export const BLOCK_REASONS = {
  yaml: 'Fix the YAML first.',
  noRaw: 'Choose a raw folder to archive into.',
  missingRaw: "The raw folder can't be found.",
  noTicks: 'Tick at least one skill or domain.',
  sameFolder: 'This note already lives in the raw folder.'
} as const

export interface SaveInput {
  yamlOk: boolean
  rawPath: string
  /** The raw folder was checked and is not there. */
  rawMissing: boolean
  /** Skills plus domains named in the YAML, known or not. */
  tickCount: number
  /** Folder of the working file. Empty for an untitled note with no folder yet. */
  workingDir: string
}

export interface SavePlan {
  canArchive: boolean
  reason: string
}

/** Whether Save can also archive, and if not, the one reason to show. */
export function planSave(input: SaveInput): SavePlan {
  const block = (reason: string): SavePlan => ({ canArchive: false, reason })
  if (!input.yamlOk) return block(BLOCK_REASONS.yaml)
  if (input.rawPath.trim().length === 0) return block(BLOCK_REASONS.noRaw)
  if (input.rawMissing) return block(BLOCK_REASONS.missingRaw)
  if (input.tickCount === 0) return block(BLOCK_REASONS.noTicks)
  if (input.workingDir.length > 0 && samePath(input.workingDir, input.rawPath)) return block(BLOCK_REASONS.sameFolder)
  return { canArchive: true, reason: '' }
}
