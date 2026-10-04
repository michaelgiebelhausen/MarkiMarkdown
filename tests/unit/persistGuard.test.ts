import { beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const state = vi.hoisted(() => ({ userData: '', failBackup: false }))

vi.mock('electron', () => ({
  app: { getPath: () => state.userData },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('electron-log/main', () => ({ default: { error: () => undefined, warn: () => undefined } }))
vi.mock('../../src/main/ipc/backup', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/main/ipc/backup')>()
  return {
    ...real,
    backupUnique: (...args: Parameters<typeof real.backupUnique>) => (state.failBackup ? null : real.backupUnique(...args))
  }
})

async function freshSettings(): Promise<typeof import('../../src/main/ipc/settings')> {
  vi.resetModules()
  return import('../../src/main/ipc/settings')
}

async function freshLedger(): Promise<typeof import('../../src/main/ipc/ledger')> {
  vi.resetModules()
  return import('../../src/main/ipc/ledger')
}

function backups(prefix: string): string[] {
  return readdirSync(state.userData).filter((n) => n.startsWith(prefix) && n.endsWith('.bak.json'))
}

const entry = { noteId: 'n', bunchId: 'b', skillIds: ['s'], domainIds: ['d'], archivedAt: '2026-10-04T10:00:00+00:00' }

beforeEach(() => {
  state.userData = mkdtempSync(join(tmpdir(), 'marki-persist-'))
  state.failBackup = false
})

describe('settings on disk', () => {
  test('a missing file gives defaults and saves normally', async () => {
    const { readSettings, writeSettings } = await freshSettings()
    expect(readSettings().schemaVersion).toBe(3)
    writeSettings({ yamlFolded: false })
    expect(JSON.parse(readFileSync(join(state.userData, 'settings.json'), 'utf8')).yamlFolded).toBe(false)
  })

  test('an empty file counts as missing: no backup, saves normally', async () => {
    writeFileSync(join(state.userData, 'settings.json'), '  \n', 'utf8')
    const { writeSettings } = await freshSettings()
    writeSettings({ yamlFolded: false })
    expect(backups('settings')).toEqual([])
    expect(JSON.parse(readFileSync(join(state.userData, 'settings.json'), 'utf8')).yamlFolded).toBe(false)
  })

  test('a corrupt file is copied aside under its own name before the first save', async () => {
    writeFileSync(join(state.userData, 'settings.json'), '{ broken', 'utf8')
    writeFileSync(join(state.userData, 'settings.corrupt.bak.json'), 'an older backup', 'utf8')
    const { readSettings, writeSettings } = await freshSettings()
    expect(readSettings().schemaVersion).toBe(3)
    writeSettings({ yamlFolded: false })
    const made = backups('settings.corrupt-')
    expect(made).toHaveLength(1)
    expect(readFileSync(join(state.userData, made[0]), 'utf8')).toBe('{ broken')
    expect(readFileSync(join(state.userData, 'settings.corrupt.bak.json'), 'utf8')).toBe('an older backup')
    writeSettings({ yamlFolded: true })
    expect(backups('settings.corrupt-')).toHaveLength(1)
  })

  test('a list is not settings: it is backed up too', async () => {
    writeFileSync(join(state.userData, 'settings.json'), '[1, 2]', 'utf8')
    const { writeSettings } = await freshSettings()
    writeSettings({ yamlFolded: false })
    expect(backups('settings.corrupt-')).toHaveLength(1)
  })

  test('a corrupt file that cannot be backed up is never overwritten', async () => {
    writeFileSync(join(state.userData, 'settings.json'), '{ broken', 'utf8')
    state.failBackup = true
    const { writeSettings, readSettings } = await freshSettings()
    expect(writeSettings({ yamlFolded: false }).yamlFolded).toBe(false)
    expect(readSettings().yamlFolded).toBe(false)
    expect(readFileSync(join(state.userData, 'settings.json'), 'utf8')).toBe('{ broken')
  })

  test('a file that cannot be read is never overwritten', async () => {
    mkdirSync(join(state.userData, 'settings.json'))
    const { writeSettings } = await freshSettings()
    expect(writeSettings({ yamlFolded: false }).yamlFolded).toBe(false)
    expect(statSync(join(state.userData, 'settings.json')).isDirectory()).toBe(true)
  })

  test('the migration backup is named after the old version', async () => {
    writeFileSync(join(state.userData, 'settings.json'), JSON.stringify({ schemaVersion: 1 }), 'utf8')
    const { readSettings } = await freshSettings()
    readSettings()
    expect(readdirSync(state.userData)).toContain('settings.v1.bak.json')
  })

  test('a file with no version is backed up as version 2', async () => {
    writeFileSync(join(state.userData, 'settings.json'), JSON.stringify({ members: [] }), 'utf8')
    const { readSettings } = await freshSettings()
    readSettings()
    expect(readdirSync(state.userData)).toContain('settings.v2.bak.json')
  })
})

describe('ledger on disk', () => {
  const path = (): string => join(state.userData, 'ledger.json')

  test('a missing ledger is created', async () => {
    const { appendLedger } = await freshLedger()
    expect(appendLedger(entry)).toEqual({ entries: [entry], saved: true })
    expect(backups('ledger')).toEqual([])
  })

  test('a corrupt ledger is copied aside before it is rewritten', async () => {
    writeFileSync(path(), '[{ broken', 'utf8')
    const { readLedger, appendLedger } = await freshLedger()
    expect(readLedger()).toEqual([])
    expect(backups('ledger.corrupt-')).toEqual([])
    expect(appendLedger(entry).saved).toBe(true)
    const made = backups('ledger.corrupt-')
    expect(made).toHaveLength(1)
    expect(readFileSync(join(state.userData, made[0]), 'utf8')).toBe('[{ broken')
  })

  test('a ledger that is not a list is copied aside before it is rewritten', async () => {
    writeFileSync(path(), '{"entries": []}', 'utf8')
    const { appendLedger } = await freshLedger()
    expect(appendLedger(entry).saved).toBe(true)
    expect(backups('ledger.corrupt-')).toHaveLength(1)
  })

  test('entries that cannot be understood are kept in a backup before the rewrite drops them', async () => {
    writeFileSync(path(), JSON.stringify([entry, { mystery: true }]), 'utf8')
    const { appendLedger } = await freshLedger()
    expect(appendLedger(entry)).toEqual({ entries: [entry, entry], saved: true })
    const made = backups('ledger.corrupt-')
    expect(made).toHaveLength(1)
    expect(readFileSync(join(state.userData, made[0]), 'utf8')).toContain('mystery')
    appendLedger(entry)
    expect(backups('ledger.corrupt-')).toHaveLength(1)
  })

  test('a corrupt ledger that cannot be backed up is never overwritten', async () => {
    writeFileSync(path(), '[{ broken', 'utf8')
    state.failBackup = true
    const { appendLedger } = await freshLedger()
    expect(appendLedger(entry)).toEqual({ entries: [], saved: false })
    expect(readFileSync(path(), 'utf8')).toBe('[{ broken')
    state.failBackup = false
    expect(appendLedger(entry).saved).toBe(false)
    expect(readFileSync(path(), 'utf8')).toBe('[{ broken')
  })

  test('a ledger that cannot be read is never overwritten', async () => {
    mkdirSync(path())
    const { appendLedger } = await freshLedger()
    expect(appendLedger(entry)).toEqual({ entries: [], saved: false })
    expect(statSync(path()).isDirectory()).toBe(true)
  })
})
