import { app } from 'electron'
import { mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import log from 'electron-log/main'
import type { LedgerEntry } from '../../shared/types'
import { isLegacyLedger, normaliseLedgerEntry } from '../../shared/ledger'
import { backupOnce, backupUnique } from './backup'
import { judgeRead, readOutcome, type Guarded } from './readGuard'
import { replaceFileSync } from './writeGuard'

/**
 * Set once the ledger on disk could not be backed up before a rewrite. Appends then report
 * saved false and leave the file alone for the session. A ledger that merely could not be
 * read is decided again on each append, since every append reads it afresh.
 */
let doNotPersist = false
/** The ledger is read often; say each kind of trouble once per session. */
const warned = new Set<string>()

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return
  warned.add(key)
  log.warn(message)
}

function ledgerPath(): string {
  return join(app.getPath('userData'), 'ledger.json')
}

function parseList(text: string): unknown[] {
  const parsed = JSON.parse(text) as unknown
  if (!Array.isArray(parsed)) throw new Error('The ledger is not a list')
  return parsed
}

interface Loaded {
  kind: Guarded<unknown[]>['kind']
  entries: LedgerEntry[]
  /** True when some entries on disk could not be understood and would be lost on rewrite. */
  dropped: boolean
}

function loadLedger(): Loaded {
  const result = judgeRead(readOutcome(ledgerPath()), parseList)
  if (result.kind === 'missing') return { kind: 'missing', entries: [], dropped: false }
  if (result.kind === 'unreadable') {
    warnOnce('unreadable', `The ledger could not be read (${result.code ?? 'unknown error'}); it will not be overwritten`)
    return { kind: 'unreadable', entries: [], dropped: false }
  }
  if (result.kind === 'corrupt') {
    warnOnce('corrupt', 'The ledger could not be understood; it will be backed up before it is rewritten')
    return { kind: 'corrupt', entries: [], dropped: false }
  }
  if (isLegacyLedger(result.value)) backupOnce(ledgerPath(), join(app.getPath('userData'), 'ledger.v2.bak.json'))
  const entries = result.value.map(normaliseLedgerEntry).filter((e): e is LedgerEntry => e !== null)
  return { kind: 'ok', entries, dropped: entries.length < result.value.length }
}

/** Every archive copy the app has made. 1.1 entries are read under the new names; rubbish is skipped. */
export function readLedger(): LedgerEntry[] {
  return loadLedger().entries
}

/**
 * True when the file on disk may be replaced now. Anything the rewrite would lose (a file
 * that could not be parsed, or entries that could not be understood) is copied aside
 * first under a name of its own; if that copy fails, nothing is written.
 */
function mayRewrite(loaded: Loaded): boolean {
  if (doNotPersist) return false
  // Its entries are unknown, so writing would replace them; try again on the next append.
  if (loaded.kind === 'unreadable') return false
  if (loaded.kind !== 'corrupt' && !loaded.dropped) return true
  const source = ledgerPath()
  const backup = backupUnique(source, dirname(source), 'ledger.corrupt')
  if (backup === null && existsSync(source)) {
    log.warn('The ledger could not be backed up before rewriting it; it will not be changed this session')
    doNotPersist = true
    return false
  }
  if (backup !== null) log.warn(`Ledger entries that could not be read were kept in ${backup}`)
  return true
}

/**
 * Appends one entry and returns the whole ledger. A ledger that cannot be written is
 * logged and returned unchanged with saved false: the copy is safely on disk, only the
 * count is stale.
 */
export function appendLedger(entry: LedgerEntry): { entries: LedgerEntry[]; saved: boolean } {
  const loaded = loadLedger()
  const current = loaded.entries
  if (!mayRewrite(loaded)) {
    log.warn('The ledger was not updated: the existing file is kept untouched')
    return { entries: current, saved: false }
  }
  const next = [...current, entry]
  try {
    const target = ledgerPath()
    mkdirSync(dirname(target), { recursive: true })
    replaceFileSync(target, JSON.stringify(next, null, 2))
    return { entries: next, saved: true }
  } catch (error) {
    log.error('Could not write the ledger', error)
    return { entries: current, saved: false }
  }
}
