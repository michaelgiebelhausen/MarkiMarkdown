import { describe, expect, test } from 'vitest'
import { lastBunchFor, pairCounts, pairKey } from '@shared/ledger'
import type { LedgerEntry } from '@shared/types'

const entries: LedgerEntry[] = [
  { noteId: 'n1', bunchId: 'b1', agentIds: ['a1', 'a2'], artifactIds: ['x1'], filedAt: '2026-09-13T10:00:00+00:00' },
  { noteId: 'n2', bunchId: 'b1', agentIds: ['a1'], artifactIds: ['x1', 'x2'], filedAt: '2026-09-13T11:00:00+00:00' },
  { noteId: 'n1', bunchId: 'b2', agentIds: ['a2'], artifactIds: ['x2'], filedAt: '2026-09-13T12:00:00+00:00' }
]

describe('pairCounts', () => {
  test('counts how many filings carried both an agent and an artifact', () => {
    const counts = pairCounts(entries)
    expect(counts.get(pairKey('a1', 'x1'))).toBe(2)
    expect(counts.get(pairKey('a2', 'x1'))).toBe(1)
    expect(counts.get(pairKey('a1', 'x2'))).toBe(1)
    expect(counts.get(pairKey('a2', 'x2'))).toBe(1)
    expect(counts.get(pairKey('a3', 'x1'))).toBeUndefined()
  })

  test('an empty ledger has no counts', () => {
    expect(pairCounts([]).size).toBe(0)
  })
})

describe('lastBunchFor', () => {
  test('returns the most recent bunch a note was filed to', () => {
    expect(lastBunchFor(entries, 'n1')).toBe('b2')
    expect(lastBunchFor(entries, 'n2')).toBe('b1')
  })

  test('returns undefined for an unknown or empty note id', () => {
    expect(lastBunchFor(entries, 'n9')).toBeUndefined()
    expect(lastBunchFor(entries, '')).toBeUndefined()
  })
})
