import { describe, expect, test } from 'vitest'
import { archiveCount, isLegacyLedger, noteIdOf, normaliseLedgerEntry, pairCounts, pairKey } from '@shared/ledger'
import type { LedgerEntry } from '@shared/types'

describe('noteIdOf', () => {
  const idIn = (yaml: string) => noteIdOf(`---\n${yaml}\n---\n`)

  test('reads a text id as its text', () => {
    expect(idIn('id: 01ABC')).toBe('01ABC')
    expect(idIn("id: '007'")).toBe('007')
    expect(idIn('id: "0x1F"')).toBe('0x1F')
    expect(idIn('id: !!str 007')).toBe('007')
  })

  test('keeps a number id exactly as the note writes it, not as YAML reads it', () => {
    expect(idIn('id: 20261004')).toBe('20261004')
    expect(idIn('id: 007')).toBe('007')
    expect(idIn('id: 0x1F')).toBe('0x1F')
    expect(idIn('id: 0o17')).toBe('0o17')
    expect(idIn('id: 1e3')).toBe('1e3')
    expect(idIn('id: +12')).toBe('+12')
    expect(idIn('id: .inf')).toBe('.inf')
    expect(idIn('id: 12   # typed by hand')).toBe('12')
  })

  test('works with Windows line endings', () => {
    expect(noteIdOf('---\r\nid: 007\r\ntitle: Note\r\n---\r\n')).toBe('007')
  })

  test('follows an alias to the value it names', () => {
    expect(idIn('first: &n 007\nid: *n')).toBe('007')
  })

  test('takes the last of two ids, as the parsed YAML does', () => {
    expect(idIn('id: 001\nid: 002')).toBe('002')
  })

  test('anything else is no id', () => {
    for (const yaml of ['id: true', 'id: false', 'id:', 'id: ~', 'id: null', "id: ''", 'id: [1]', 'id: {a: 1}', 'title: no id here', 'id: "', 'just a line']) {
      expect(idIn(yaml), yaml).toBe('')
    }
    expect(noteIdOf(null)).toBe('')
    expect(noteIdOf('')).toBe('')
  })
})

const entries: LedgerEntry[] = [
  { noteId: 'n1', bunchId: 'b1', skillIds: ['a1', 'a2'], domainIds: ['x1'], archivedAt: '2026-09-13T10:00:00+00:00' },
  { noteId: 'n2', bunchId: 'b1', skillIds: ['a1'], domainIds: ['x1', 'x2'], archivedAt: '2026-09-13T11:00:00+00:00' },
  { noteId: 'n1', bunchId: 'b2', skillIds: ['a2'], domainIds: ['x2'], archivedAt: '2026-09-13T12:00:00+00:00' }
]

describe('pairCounts', () => {
  test('counts how many archive copies carried both a skill and a domain', () => {
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

  test('duplicate ids inside one entry are not double-counted', () => {
    const dup: LedgerEntry[] = [
      { noteId: 'n', bunchId: 'b', skillIds: ['a', 'a'], domainIds: ['x', 'x'], archivedAt: 't' }
    ]
    expect(pairCounts(dup).get(pairKey('a', 'x'))).toBe(1)
  })
})

describe('normaliseLedgerEntry', () => {
  test('passes a 1.2 entry through', () => {
    const entry = { noteId: 'n', bunchId: 'b', skillIds: ['s'], domainIds: ['d'], archivedAt: 't' }
    expect(normaliseLedgerEntry(entry)).toEqual(entry)
  })

  test('reads a 1.1 entry under the new names', () => {
    expect(
      normaliseLedgerEntry({ noteId: 'n', bunchId: 'b', agentIds: ['a'], artifactIds: ['x'], filedAt: 't' })
    ).toEqual({ noteId: 'n', bunchId: 'b', skillIds: ['a'], domainIds: ['x'], archivedAt: 't' })
  })

  test('rejects entries with missing or malformed fields', () => {
    expect(normaliseLedgerEntry(null)).toBeNull()
    expect(normaliseLedgerEntry([])).toBeNull()
    expect(normaliseLedgerEntry({ noteId: 'n', bunchId: 'b', skillIds: ['s'], domainIds: ['d'] })).toBeNull()
    expect(
      normaliseLedgerEntry({ noteId: 'n', bunchId: 'b', skillIds: [1], domainIds: ['d'], archivedAt: 't' })
    ).toBeNull()
  })
})

describe('isLegacyLedger', () => {
  test('is true when any entry still uses the 1.1 names', () => {
    expect(isLegacyLedger([{ noteId: 'n', bunchId: 'b', agentIds: [], artifactIds: [], filedAt: 't' }])).toBe(true)
  })

  test('is false for a 1.2 ledger, an empty one, or rubbish', () => {
    expect(isLegacyLedger([{ noteId: 'n', bunchId: 'b', skillIds: [], domainIds: [], archivedAt: 't' }])).toBe(false)
    expect(isLegacyLedger([])).toBe(false)
    expect(isLegacyLedger('nope')).toBe(false)
  })
})

describe('archiveCount', () => {
  test('counts the archive copies of one note', () => {
    expect(archiveCount(entries, 'n1')).toBe(2)
    expect(archiveCount(entries, 'n2')).toBe(1)
    expect(archiveCount(entries, 'n9')).toBe(0)
    expect(archiveCount(entries, '')).toBe(0)
  })
})
