import type { LedgerEntry } from './types'

/** Member ids must not contain `|`, or two distinct pairs could collide on the same key. */
export function pairKey(agentId: string, artifactId: string): string {
  return `${agentId}|${artifactId}`
}

/** How many filings carried both members, keyed by pairKey. */
export function pairCounts(entries: LedgerEntry[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    for (const agentId of new Set(entry.agentIds)) {
      for (const artifactId of new Set(entry.artifactIds)) {
        const key = pairKey(agentId, artifactId)
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
