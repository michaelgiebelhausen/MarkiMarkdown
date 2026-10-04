import { constants, copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

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

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** YYYYMMDD-HHMMSS in local time, so the name sorts and reads like the clock on the wall. */
function stamp(when: Date): string {
  return (
    `${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}` +
    `-${pad(when.getHours())}${pad(when.getMinutes())}${pad(when.getSeconds())}`
  )
}

/**
 * Copies `source` into `dir` as `<stem>-<YYYYMMDD-HHMMSS>.bak.json`, or with -2, -3 and so
 * on when that name is taken. Every backup gets its own name, so none is ever
 * overwritten. Returns the backup's path, or null when there was nothing to copy or the
 * copy could not be made (the caller decides whether that is safe to ignore).
 */
export function backupUnique(source: string, dir: string, stem: string, when: Date = new Date()): string | null {
  if (!existsSync(source)) return null
  const base = `${stem}-${stamp(when)}`
  for (let attempt = 1; attempt <= 100; attempt++) {
    const path = join(dir, `${attempt === 1 ? base : `${base}-${attempt}`}.bak.json`)
    try {
      copyFileSync(source, path, constants.COPYFILE_EXCL)
      return path
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') return null
    }
  }
  return null
}
