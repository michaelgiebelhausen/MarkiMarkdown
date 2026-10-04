import { describe, expect, test } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backupOnce } from '../../src/main/ipc/backup'

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
