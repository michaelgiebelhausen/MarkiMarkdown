import { samePath } from './paths'

/** The dated name an archive copy starts from, before any -2, -3 suffix. */
export function archiveStem(fileName: string, date: string): string {
  return `${fileName.replace(/\.(md|markdown|txt|text)$/i, '')}-${date}`
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
  if (input.rawPath.length === 0) return block(BLOCK_REASONS.noRaw)
  if (input.rawMissing) return block(BLOCK_REASONS.missingRaw)
  if (input.tickCount === 0) return block(BLOCK_REASONS.noTicks)
  if (input.workingDir.length > 0 && samePath(input.workingDir, input.rawPath)) return block(BLOCK_REASONS.sameFolder)
  return { canArchive: true, reason: '' }
}
