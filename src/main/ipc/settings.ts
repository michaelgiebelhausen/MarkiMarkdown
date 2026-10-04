import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import log from 'electron-log/main'
import { DEFAULT_SETTINGS, type Settings } from '../../shared/types'
import { migrateSettings } from '../../shared/migrate'
import { backupOnce, backupUnique } from './backup'
import { judgeRead, readOutcome } from './readGuard'

let cache: Settings | null = null
/** The file on disk could not be understood: copy it aside before the first save replaces it. */
let corruptNeedsBackup = false
/**
 * The file on disk is there but could not be read, or could not be backed up. The app
 * runs on defaults in memory and never writes over it this session.
 */
let doNotPersist = false

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function secretPath(): string {
  return join(app.getPath('userData'), 'apikey.bin')
}

/** The schema version a parsed file says it has; a file from before versions is 2. */
function oldVersion(parsed: unknown): number {
  const version =
    parsed !== null && typeof parsed === 'object' ? (parsed as { schemaVersion?: unknown }).schemaVersion : undefined
  return typeof version === 'number' && Number.isInteger(version) && version >= 0 ? version : 2
}

/** Settings are one JSON object; a list, a number or null is not settings and is kept aside. */
function parseSettingsObject(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as unknown
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Not a settings object')
  return parsed as Record<string, unknown>
}

export function readSettings(): Settings {
  if (cache) return cache
  const result = judgeRead(readOutcome(settingsPath()), parseSettingsObject)
  switch (result.kind) {
    case 'ok': {
      const version = oldVersion(result.value)
      if (version !== DEFAULT_SETTINGS.schemaVersion) {
        backupOnce(settingsPath(), join(app.getPath('userData'), `settings.v${version}.bak.json`))
      }
      try {
        cache = migrateSettings(result.value)
      } catch (error) {
        log.warn('Settings could not be migrated; using defaults and keeping the file', error)
        corruptNeedsBackup = true
        cache = { ...DEFAULT_SETTINGS }
      }
      break
    }
    case 'corrupt':
      // Backed up on the first save, so an app that is opened and closed again and again
      // does not pile up identical copies.
      log.warn('Settings file could not be understood; using defaults until it is backed up')
      corruptNeedsBackup = true
      cache = { ...DEFAULT_SETTINGS }
      break
    case 'unreadable':
      log.warn(`Settings file could not be read (${result.code ?? 'unknown error'}); it will not be overwritten`)
      doNotPersist = true
      cache = { ...DEFAULT_SETTINGS }
      break
    case 'missing':
      cache = { ...DEFAULT_SETTINGS }
      break
  }
  return cache
}

/**
 * False once the app has decided never to write over the settings file this session,
 * so the student can be told when the app opens instead of after their first change.
 * Call after readSettings.
 */
export function settingsPersisting(): boolean {
  return !doNotPersist
}

/** True when the file on disk may be replaced now. */
function mayPersist(): boolean {
  if (doNotPersist) return false
  if (!corruptNeedsBackup) return true
  const source = settingsPath()
  const backup = backupUnique(source, dirname(source), 'settings.corrupt')
  if (backup === null && existsSync(source)) {
    log.warn('The unreadable settings file could not be backed up; settings will only be kept in memory')
    doNotPersist = true
    return false
  }
  if (backup !== null) log.warn(`The unreadable settings file was kept as ${backup}`)
  corruptNeedsBackup = false
  return true
}

/**
 * Merges `next` into the settings in memory and saves them. `persisted` is false when the
 * change lives only in memory: the file on disk is being kept untouched, or the write failed.
 */
export function writeSettings(next: Partial<Settings>): { settings: Settings; persisted: boolean } {
  const merged = { ...readSettings(), ...next }
  cache = merged
  if (!mayPersist()) {
    log.warn('Settings were not saved to disk: the existing file is kept untouched')
    return { settings: merged, persisted: false }
  }
  try {
    const target = settingsPath()
    mkdirSync(dirname(target), { recursive: true })
    const temp = `${target}.tmp`
    writeFileSync(temp, JSON.stringify(merged, null, 2), 'utf8')
    renameSync(temp, target)
    return { settings: merged, persisted: true }
  } catch (error) {
    log.error('Could not save settings', error)
    return { settings: merged, persisted: false }
  }
}

/** API keys are stored through the OS keychain wrapper, never in the JSON file. */
export function saveApiKey(key: string): boolean {
  try {
    if (key.length === 0) {
      if (existsSync(secretPath())) writeFileSync(secretPath(), '')
      return true
    }
    if (!safeStorage.isEncryptionAvailable()) return false
    writeFileSync(secretPath(), safeStorage.encryptString(key))
    return true
  } catch (error) {
    log.error('Could not save the API key', error)
    return false
  }
}

export function loadApiKey(): string | undefined {
  try {
    if (!existsSync(secretPath())) return undefined
    const buffer = readFileSync(secretPath())
    if (buffer.length === 0) return undefined
    if (!safeStorage.isEncryptionAvailable()) return undefined
    const value = safeStorage.decryptString(buffer)
    return value.length > 0 ? value : undefined
  } catch {
    return undefined
  }
}
