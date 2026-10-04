import { describe, expect, test } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backupOnce, backupUnique } from '../../src/main/ipc/backup'

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'marki-backup-'))
}

describe('backupOnce', () => {
  test('copies the file the first time', () => {
    const dir = scratch()
    writeFileSync(join(dir, 'settings.json'), 'old', 'utf8')
    expect(backupOnce(join(dir, 'settings.json'), join(dir, 'settings.v2.bak.json'))).toBe(true)
    expect(readFileSync(join(dir, 'settings.v2.bak.json'), 'utf8')).toBe('old')
  })

  test('never overwrites an existing backup', () => {
    const dir = scratch()
    writeFileSync(join(dir, 'settings.json'), 'newer', 'utf8')
    writeFileSync(join(dir, 'settings.v2.bak.json'), 'first', 'utf8')
    expect(backupOnce(join(dir, 'settings.json'), join(dir, 'settings.v2.bak.json'))).toBe(false)
    expect(readFileSync(join(dir, 'settings.v2.bak.json'), 'utf8')).toBe('first')
  })

  test('does nothing when there is no source file', () => {
    const dir = scratch()
    expect(backupOnce(join(dir, 'missing.json'), join(dir, 'missing.bak.json'))).toBe(false)
    expect(existsSync(join(dir, 'missing.bak.json'))).toBe(false)
  })
})

describe('backupUnique', () => {
  const when = new Date(2026, 9, 4, 9, 5, 7)

  test('copies under a timestamped name and returns the path', () => {
    const dir = scratch()
    writeFileSync(join(dir, 'settings.json'), 'broken', 'utf8')
    const path = backupUnique(join(dir, 'settings.json'), dir, 'settings.corrupt', when)
    expect(path).toBe(join(dir, 'settings.corrupt-20261004-090507.bak.json'))
    expect(readFileSync(path as string, 'utf8')).toBe('broken')
  })

  test('never overwrites: a clash in the same second adds a counter', () => {
    const dir = scratch()
    writeFileSync(join(dir, 'settings.json'), 'second', 'utf8')
    writeFileSync(join(dir, 'settings.corrupt-20261004-090507.bak.json'), 'first', 'utf8')
    writeFileSync(join(dir, 'settings.corrupt-20261004-090507-2.bak.json'), 'also first', 'utf8')
    const path = backupUnique(join(dir, 'settings.json'), dir, 'settings.corrupt', when)
    expect(path).toBe(join(dir, 'settings.corrupt-20261004-090507-3.bak.json'))
    expect(readFileSync(join(dir, 'settings.corrupt-20261004-090507.bak.json'), 'utf8')).toBe('first')
    expect(readFileSync(join(dir, 'settings.corrupt-20261004-090507-2.bak.json'), 'utf8')).toBe('also first')
    expect(readFileSync(path as string, 'utf8')).toBe('second')
  })

  test('returns null when there is no source file', () => {
    const dir = scratch()
    expect(backupUnique(join(dir, 'missing.json'), dir, 'missing.corrupt', when)).toBeNull()
    expect(readdirSync(dir)).toEqual([])
  })

  test('returns null when the copy cannot be made', () => {
    const dir = scratch()
    writeFileSync(join(dir, 'settings.json'), 'broken', 'utf8')
    expect(backupUnique(join(dir, 'settings.json'), join(dir, 'no-such-folder'), 'settings.corrupt', when)).toBeNull()
  })
})
