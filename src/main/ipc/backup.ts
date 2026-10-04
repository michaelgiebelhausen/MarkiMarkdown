import { constants, copyFileSync, existsSync } from 'node:fs'

/**
 * Copies a file aside before its old shape is rewritten. Runs at most once per backup
 * name and never overwrites an earlier backup: the copy itself refuses to replace an
 * existing file, so two racing callers cannot clobber each other. Returns true when it
 * made a copy. A failure is swallowed: a missing backup must never stop the app from
 * starting.
 */
export function backupOnce(source: string, backup: string): boolean {
  try {
    if (!existsSync(source)) return false
    copyFileSync(source, backup, constants.COPYFILE_EXCL)
    return true
  } catch {
    // EEXIST means a backup is already there: no copy was made, which is the point.
    return false
  }
}
