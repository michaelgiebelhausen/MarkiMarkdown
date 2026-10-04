/**
 * Decides what a settings or ledger file on disk really means before the app trusts it.
 * Only a missing file (or an empty one) is "start from nothing". A file that is there
 * but cannot be read, or cannot be understood, must never be quietly replaced with
 * defaults: the callers back it up first, or refuse to write over it at all.
 *
 * No Electron here, so the decision can be tested on its own.
 */
import { readFileSync } from 'node:fs'

/** What happened when the file was read: its text, or the error code. */
export interface ReadOutcome {
  code?: string
  text?: string
}

export type Guarded<T> =
  | { kind: 'missing' }
  | { kind: 'ok'; value: T }
  /** Read fine but could not be parsed into the expected shape. */
  | { kind: 'corrupt' }
  /** There, but the read itself failed (locked, no permission, a folder in the way...). */
  | { kind: 'unreadable'; code?: string }

/** Errors a virus scanner, backup tool or sync client causes for a moment while it holds the file. */
const TRANSIENT = new Set(['EBUSY', 'EPERM', 'EACCES'])
const RETRIES = 3
const RETRY_MS = 50

function readText(path: string): string {
  return readFileSync(path, 'utf8')
}

/** Blocks the thread briefly; only used at startup-sized reads, where a few ms is fine. */
function pauseSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Reads the file, retrying a few times when it is briefly locked, so one unlucky moment
 * does not turn off saving for the whole session.
 */
export function readOutcome(
  path: string,
  read: (path: string) => string = readText,
  pause: (ms: number) => void = pauseSync
): ReadOutcome {
  for (let attempt = 0; ; attempt++) {
    try {
      return { text: read(path) }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code
      if (code !== undefined && TRANSIENT.has(code) && attempt < RETRIES) {
        pause(RETRY_MS)
        continue
      }
      return code === undefined ? {} : { code }
    }
  }
}

/** `parse` throws when the text is not the expected shape. */
export function judgeRead<T>(outcome: ReadOutcome, parse: (text: string) => T): Guarded<T> {
  if (outcome.text === undefined) {
    if (outcome.code === 'ENOENT') return { kind: 'missing' }
    return outcome.code === undefined ? { kind: 'unreadable' } : { kind: 'unreadable', code: outcome.code }
  }
  let text = outcome.text
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  if (text.trim().length === 0) return { kind: 'missing' }
  try {
    return { kind: 'ok', value: parse(text) }
  } catch {
    return { kind: 'corrupt' }
  }
}
