import type { LedgerEntry } from './types'

/** Member ids must not contain `|`, or two distinct pairs could collide on the same key. */
export function pairKey(skillId: string, domainId: string): string {
  return `${skillId}|${domainId}`
}

/** How many archive copies carried both members, keyed by pairKey. */
export function pairCounts(entries: LedgerEntry[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    for (const skillId of new Set(entry.skillIds)) {
      for (const domainId of new Set(entry.domainIds)) {
        const key = pairKey(skillId, domainId)
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
  }
  return counts
}

/** The bunch a note was most recently filed to, if it ever was. */
export function lastBunchFor(entries: LedgerEntry[], noteId: string): string | undefined {
  if (noteId.length === 0) return undefined
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].noteId === noteId) return entries[i].bunchId
  }
  return undefined
}

function idList(primary: unknown, legacy: unknown): string[] | null {
  const list = primary !== undefined ? primary : legacy
  return Array.isArray(list) && list.every((v) => typeof v === 'string') ? (list as string[]) : null
}

/** Reads one ledger entry in the 1.2 shape or the 1.1 shape (agentIds, artifactIds, filedAt). */
export function normaliseLedgerEntry(value: unknown): LedgerEntry | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const skillIds = idList(v.skillIds, v.agentIds)
  const domainIds = idList(v.domainIds, v.artifactIds)
  const archivedAt = typeof v.archivedAt === 'string' ? v.archivedAt : typeof v.filedAt === 'string' ? v.filedAt : null
  if (typeof v.noteId !== 'string' || typeof v.bunchId !== 'string') return null
  if (skillIds === null || domainIds === null || archivedAt === null) return null
  return { noteId: v.noteId, bunchId: v.bunchId, skillIds, domainIds, archivedAt }
}

/** True when the parsed ledger file still holds 1.1 entries, so it should be backed up before rewriting. */
export function isLegacyLedger(parsed: unknown): boolean {
  if (!Array.isArray(parsed)) return false
  return parsed.some(
    (e) => e !== null && typeof e === 'object' && ('agentIds' in e || 'artifactIds' in e || 'filedAt' in e)
  )
}

/** How many archive copies a note has. */
export function archiveCount(entries: LedgerEntry[], noteId: string): number {
  if (noteId.length === 0) return 0
  return entries.filter((e) => e.noteId === noteId).length
}
