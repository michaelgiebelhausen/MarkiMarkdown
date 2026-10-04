/**
 * Replaces a small app file (settings, ledger) in one step: write a temp file beside it,
 * then rename it over the target. A virus scanner, backup tool or sync client holding the
 * file for a moment makes Windows refuse with EPERM, EBUSY or EACCES; those are tried
 * again a few times, as reads are, before the caller is told the write failed.
 *
 * No Electron here, so the retries can be tested on their own.
 */
import { renameSync, writeFileSync } from 'node:fs'
import { RETRIES, RETRY_MS, isTransient, pauseSync } from './readGuard'

export interface WriteFs {
  writeFileSync: (path: string, text: string, encoding: 'utf8') => void
  renameSync: (from: string, to: string) => void
}

const nodeFs: WriteFs = {
  writeFileSync: (path, text, encoding) => writeFileSync(path, text, encoding),
  renameSync: (from, to) => renameSync(from, to)
}

/** Throws the last error when the file still cannot be replaced after the retries. */
export function replaceFileSync(
  target: string,
  text: string,
  fs: WriteFs = nodeFs,
  pause: (ms: number) => void = pauseSync
): void {
  const temp = `${target}.tmp`
  for (let attempt = 0; ; attempt++) {
    try {
      fs.writeFileSync(temp, text, 'utf8')
      fs.renameSync(temp, target)
      return
    } catch (error) {
      if (isTransient(error) && attempt < RETRIES) {
        pause(RETRY_MS)
        continue
      }
      throw error
    }
  }
}
