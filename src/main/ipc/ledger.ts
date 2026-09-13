import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import log from 'electron-log/main'
import type { LedgerEntry } from '../../shared/types'

function ledgerPath(): string {
  return join(app.getPath('userData'), 'ledger.json')
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

function isLedgerEntry(value: unknown): value is LedgerEntry {
  if (value === null || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.noteId === 'string' &&
    typeof v.bunchId === 'string' &&
    typeof v.filedAt === 'string' &&
    isStringArray(v.agentIds) &&
    isStringArray(v.artifactIds)
  )
}

/** Every filing the app has done. Missing, unreadable, or malformed entries are dropped. */
export function readLedger(): LedgerEntry[] {
  try {
    const parsed = JSON.parse(readFileSync(ledgerPath(), 'utf8')) as unknown
    return Array.isArray(parsed) ? parsed.filter(isLedgerEntry) : []
  } catch {
    return []
  }
}

/**
 * Appends one entry and returns the whole ledger. A ledger that cannot be written is
 * logged and returned unchanged: the note is safely filed, the count is merely stale.
 */
export function appendLedger(entry: LedgerEntry): LedgerEntry[] {
  const current = readLedger()
  const next = [...current, entry]
  try {
    const target = ledgerPath()
    mkdirSync(dirname(target), { recursive: true })
    const temp = `${target}.tmp`
    writeFileSync(temp, JSON.stringify(next, null, 2), 'utf8')
    renameSync(temp, target)
    return next
  } catch (error) {
    log.error('Could not write the filing ledger', error)
    return current
  }
}
