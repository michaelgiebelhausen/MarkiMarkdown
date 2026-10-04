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

export function readOutcome(path: string): ReadOutcome {
  try {
    return { text: readFileSync(path, 'utf8') }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    return code === undefined ? {} : { code }
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
