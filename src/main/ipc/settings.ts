import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import log from 'electron-log/main'
import { DEFAULT_SETTINGS, type Settings } from '../../shared/types'
import { migrateSettings } from '../../shared/migrate'

let cache: Settings | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function secretPath(): string {
  return join(app.getPath('userData'), 'apikey.bin')
}

export function readSettings(): Settings {
  if (cache) return cache
  try {
    const raw = readFileSync(settingsPath(), 'utf8')
    cache = migrateSettings(JSON.parse(raw))
  } catch {
    cache = { ...DEFAULT_SETTINGS }
  }
  return cache
}

export function writeSettings(next: Partial<Settings>): Settings {
  const merged = { ...readSettings(), ...next }
  cache = merged
  try {
    const target = settingsPath()
    mkdirSync(dirname(target), { recursive: true })
    const temp = `${target}.tmp`
    writeFileSync(temp, JSON.stringify(merged, null, 2), 'utf8')
    renameSync(temp, target)
  } catch (error) {
    log.error('Could not save settings', error)
  }
  return merged
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
