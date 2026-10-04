import { describe, expect, test } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { judgeRead, readOutcome } from '../../src/main/ipc/readGuard'

const parseJson = (text: string): unknown => JSON.parse(text)
const parseArray = (text: string): unknown[] => {
  const parsed = JSON.parse(text) as unknown
  if (!Array.isArray(parsed)) throw new Error('not a list')
  return parsed
}

describe('judgeRead', () => {
  test('only a missing file means start from nothing', () => {
    expect(judgeRead({ code: 'ENOENT' }, parseJson)).toEqual({ kind: 'missing' })
  })

  test('any other read failure is unreadable, never missing', () => {
    expect(judgeRead({ code: 'EBUSY' }, parseJson)).toEqual({ kind: 'unreadable', code: 'EBUSY' })
    expect(judgeRead({ code: 'EPERM' }, parseJson)).toEqual({ kind: 'unreadable', code: 'EPERM' })
    expect(judgeRead({ code: 'EACCES' }, parseJson).kind).toBe('unreadable')
    expect(judgeRead({}, parseJson).kind).toBe('unreadable')
  })

  test('an empty or whitespace-only file counts as missing', () => {
    expect(judgeRead({ text: '' }, parseJson)).toEqual({ kind: 'missing' })
    expect(judgeRead({ text: '  \r\n\t ' }, parseJson)).toEqual({ kind: 'missing' })
    expect(judgeRead({ text: '﻿ \n' }, parseJson)).toEqual({ kind: 'missing' })
  })

  test('a parse failure is corrupt', () => {
    expect(judgeRead({ text: '{ "a": ' }, parseJson)).toEqual({ kind: 'corrupt' })
  })

  test('the parse function decides the shape: a non-list ledger is corrupt', () => {
    expect(judgeRead({ text: '{"a":1}' }, parseArray)).toEqual({ kind: 'corrupt' })
    expect(judgeRead({ text: '[1]' }, parseArray)).toEqual({ kind: 'ok', value: [1] })
  })

  test('a byte order mark is ignored', () => {
    expect(judgeRead({ text: '﻿{"a":1}' }, parseJson)).toEqual({ kind: 'ok', value: { a: 1 } })
  })
})

describe('readOutcome', () => {
  test('reports the text of a file that is there', () => {
    const dir = mkdtempSync(join(tmpdir(), 'marki-guard-'))
    writeFileSync(join(dir, 'a.json'), '{}', 'utf8')
    expect(readOutcome(join(dir, 'a.json'))).toEqual({ text: '{}' })
  })

  test('reports the error code of a file that is not', () => {
    const dir = mkdtempSync(join(tmpdir(), 'marki-guard-'))
    expect(readOutcome(join(dir, 'missing.json'))).toEqual({ code: 'ENOENT' })
  })

  /** A reader that fails with `codes` in turn, then returns `text`. */
  function flaky(codes: string[], text = '{}') {
    const calls: string[] = []
    const read = (path: string): string => {
      calls.push(path)
      const code = codes[calls.length - 1]
      if (code !== undefined) throw Object.assign(new Error(code), { code })
      return text
    }
    return { read, calls }
  }

  test('a briefly locked file is read on a retry', () => {
    const pauses: number[] = []
    const { read, calls } = flaky(['EBUSY', 'EPERM'])
    expect(readOutcome('x.json', read, (ms) => pauses.push(ms))).toEqual({ text: '{}' })
    expect(calls).toHaveLength(3)
    expect(pauses).toEqual([50, 50])
  })

  test('a file that stays locked is reported after three retries', () => {
    const pauses: number[] = []
    const { read, calls } = flaky(['EACCES', 'EACCES', 'EACCES', 'EACCES', 'EACCES'])
    expect(readOutcome('x.json', read, (ms) => pauses.push(ms))).toEqual({ code: 'EACCES' })
    expect(calls).toHaveLength(4)
    expect(pauses).toHaveLength(3)
  })

  test('a missing file or a folder in the way is not retried', () => {
    for (const code of ['ENOENT', 'EISDIR']) {
      const pauses: number[] = []
      const { read, calls } = flaky([code])
      expect(readOutcome('x.json', read, (ms) => pauses.push(ms))).toEqual({ code })
      expect(calls).toHaveLength(1)
      expect(pauses).toEqual([])
    }
  })

  test('a folder in the way is not mistaken for a missing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'marki-guard-'))
    mkdirSync(join(dir, 'settings.json'))
    const outcome = readOutcome(join(dir, 'settings.json'))
    expect(outcome.text).toBeUndefined()
    expect(judgeRead(outcome, parseJson).kind).toBe('unreadable')
  })
})
