import { copyFileSync, existsSync } from 'node:fs'

/**
 * Copies a file aside before its old shape is rewritten. Runs at most once per backup
 * name and never overwrites an earlier backup. Returns true when it made a copy. A
 * failure is swallowed: a missing backup must never stop the app from starting.
 */
export function backupOnce(source: string, backup: string): boolean {
  try {
    if (existsSync(backup) || !existsSync(source)) return false
    copyFileSync(source, backup)
    return true
  } catch {
    return false
  }
}
