import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import log from 'electron-log/main'
import type { LedgerEntry } from '../../shared/types'
import { isLegacyLedger, normaliseLedgerEntry } from '../../shared/ledger'
import { backupOnce } from './backup'

function ledgerPath(): string {
  return join(app.getPath('userData'), 'ledger.json')
}

/** Every archive copy the app has made. 1.1 entries are read under the new names; rubbish is dropped. */
export function readLedger(): LedgerEntry[] {
  const corruptBackup = (): void => {
    backupOnce(ledgerPath(), join(app.getPath('userData'), 'ledger.corrupt.bak.json'))
  }
  try {
    let raw = readFileSync(ledgerPath(), 'utf8')
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
    const parsed = JSON.parse(raw) as unknown
    if (isLegacyLedger(parsed)) backupOnce(ledgerPath(), join(app.getPath('userData'), 'ledger.v2.bak.json'))
    if (!Array.isArray(parsed)) {
      // Valid JSON of the wrong shape: the next append would replace it, so keep a copy.
      corruptBackup()
      return []
    }
    return parsed.map(normaliseLedgerEntry).filter((e): e is LedgerEntry => e !== null)
  } catch {
    // Missing files do nothing here (backupOnce checks); unreadable or unparsable ones are kept aside.
    corruptBackup()
    return []
  }
}

/**
 * Appends one entry and returns the whole ledger. A ledger that cannot be written is
 * logged and returned unchanged with saved false: the copy is safely on disk, only the
 * count is stale.
 */
export function appendLedger(entry: LedgerEntry): { entries: LedgerEntry[]; saved: boolean } {
  const current = readLedger()
  const next = [...current, entry]
  try {
    const target = ledgerPath()
    mkdirSync(dirname(target), { recursive: true })
    const temp = `${target}.tmp`
    writeFileSync(temp, JSON.stringify(next, null, 2), 'utf8')
    renameSync(temp, target)
    return { entries: next, saved: true }
  } catch (error) {
    log.error('Could not write the ledger', error)
    return { entries: current, saved: false }
  }
}
