import { describe, expect, test } from 'vitest'
import { basename, dirname, join } from 'node:path'
import {
  moveWorkingFile,
  sanitizeFileName,
  writeArchiveCopy,
  writeNewNote,
  type ArchiveOps
} from '../../src/main/ipc/archive'

describe('sanitizeFileName', () => {
  test('always ends in .md and drops other note extensions', () => {
    expect(sanitizeFileName('notes.txt')).toBe('notes.md')
    expect(sanitizeFileName('notes.markdown')).toBe('notes.md')
    expect(sanitizeFileName('notes')).toBe('notes.md')
  })

  test('strips characters Windows refuses and path separators', () => {
    expect(sanitizeFileName('a<b>c:d"e|f?g*h')).toBe('abcdefgh.md')
    expect(sanitizeFileName('a/b' + String.fromCharCode(92) + 'c')).toBe('abc.md')
  })

  test('renames reserved device names and empties', () => {
    expect(sanitizeFileName('con')).toBe('con-note.md')
    expect(sanitizeFileName('')).toBe('note.md')
    expect(sanitizeFileName('...')).toBe('note.md')
  })

  test('a note called log keeps its name now that there is no folder log', () => {
    expect(sanitizeFileName('log')).toBe('log.md')
  })

  test('caps very long names', () => {
    expect(sanitizeFileName('x'.repeat(200)).length).toBe(123)
  })
})

const RAW = join('/', 'brain', 'raw')
const DRAFTS = join('/', 'drafts')
const OTHER = join('/', 'other')

interface Fake extends ArchiveOps {
  files: Map<string, string>
  /** Paths whose next create loses a race to another writer. */
  raceOn: Set<string>
  createError?: Error
  renameError?: Error
  copyError?: Error
  listError?: Error
}

function fake(folders: string[], files: Record<string, string> = {}): Fake {
  const disk: Fake = {
    files: new Map(Object.entries(files)),
    raceOn: new Set(),
    async dirExists(path) {
      return folders.includes(path)
    },
    async listNames(dir) {
      if (disk.listError) throw disk.listError
      return [...disk.files.keys()].filter((p) => dirname(p) === dir).map((p) => basename(p))
    },
    async createExclusive(path, text) {
      if (disk.createError) throw disk.createError
      if (disk.raceOn.has(path)) {
        disk.raceOn.delete(path)
        disk.files.set(path, 'someone else')
        return false
      }
      if (disk.files.has(path)) return false
      disk.files.set(path, text)
      return true
    },
    async copyExclusive(from, to) {
      if (disk.copyError) throw disk.copyError
      if (disk.files.has(to)) return false
      disk.files.set(to, disk.files.get(from) as string)
      return true
    },
    async exists(path) {
      return disk.files.has(path)
    },
    async rename(from, to) {
      if (disk.renameError) throw disk.renameError
      disk.files.set(to, disk.files.get(from) as string)
      disk.files.delete(from)
    },
    async trash(path) {
      disk.files.delete(path)
    }
  }
  return disk
}

function errno(code: string): Error {
  return Object.assign(new Error(code), { code })
}

describe('writeArchiveCopy', () => {
  test('writes a dated copy into raw', async () => {
    const disk = fake([RAW])
    const result = await writeArchiveCopy(disk, RAW, 'essay.md', '2026-10-04', 'TEXT')
    expect(result).toEqual({ ok: true, path: join(RAW, 'essay-2026-10-04.md') })
    expect(disk.files.get(join(RAW, 'essay-2026-10-04.md'))).toBe('TEXT')
  })

  test('never overwrites: a second copy the same day gets -2', async () => {
    const disk = fake([RAW], { [join(RAW, 'essay-2026-10-04.md')]: 'FIRST' })
    const result = await writeArchiveCopy(disk, RAW, 'essay.md', '2026-10-04', 'SECOND')
    expect(result).toEqual({ ok: true, path: join(RAW, 'essay-2026-10-04-2.md') })
    expect(disk.files.get(join(RAW, 'essay-2026-10-04.md'))).toBe('FIRST')
  })

  test('a clash in different case still counts', async () => {
    const disk = fake([RAW], { [join(RAW, 'Essay-2026-10-04.md')]: 'FIRST' })
    const result = await writeArchiveCopy(disk, RAW, 'essay.md', '2026-10-04', 'SECOND')
    expect(result.ok && basename(result.path)).toBe('essay-2026-10-04-2.md')
  })

  test('losing a race to another writer takes the next name', async () => {
    const disk = fake([RAW])
    disk.raceOn.add(join(RAW, 'essay-2026-10-04.md'))
    const result = await writeArchiveCopy(disk, RAW, 'essay.md', '2026-10-04', 'MINE')
    expect(result).toEqual({ ok: true, path: join(RAW, 'essay-2026-10-04-2.md') })
    expect(disk.files.get(join(RAW, 'essay-2026-10-04.md'))).toBe('someone else')
  })

  test('cleans the file name first', async () => {
    const disk = fake([RAW])
    const result = await writeArchiveCopy(disk, RAW, 'my:essay.txt', '2026-10-04', 'T')
    expect(result.ok && basename(result.path)).toBe('myessay-2026-10-04.md')
  })

  test('a missing raw folder is reported, not created', async () => {
    const disk = fake([])
    const result = await writeArchiveCopy(disk, RAW, 'essay.md', '2026-10-04', 'T')
    expect(result.ok).toBe(false)
    expect(!result.ok && result.message).toContain("can't be found")
    expect(disk.files.size).toBe(0)
  })

  test('a folder that refuses writes is reported', async () => {
    const disk = fake([RAW])
    disk.createError = errno('EACCES')
    const result = await writeArchiveCopy(disk, RAW, 'essay.md', '2026-10-04', 'T')
    expect(!result.ok && result.message).toContain("can't be written to")
    expect(!result.ok && result.message).toContain('permission')
  })

  test('a full disk says so', async () => {
    const disk = fake([RAW])
    disk.createError = errno('ENOSPC')
    const result = await writeArchiveCopy(disk, RAW, 'essay.md', '2026-10-04', 'T')
    expect(result).toEqual({ ok: false, message: 'There is no space left on the disk.' })
  })

  test('EPERM is a permissions problem too', async () => {
    const disk = fake([RAW])
    disk.createError = errno('EPERM')
    const result = await writeArchiveCopy(disk, RAW, 'essay.md', '2026-10-04', 'T')
    expect(!result.ok && result.message).toContain("can't be written to")
    expect(!result.ok && result.message).toContain('permission')
  })

  test('a name that is too long says so', async () => {
    const disk = fake([RAW])
    disk.createError = errno('ENAMETOOLONG')
    const result = await writeArchiveCopy(disk, RAW, 'essay.md', '2026-10-04', 'T')
    expect(!result.ok && result.message).toContain('name is too long')
  })

  test('an unknown failure keeps the general message', async () => {
    const disk = fake([RAW])
    disk.createError = errno('EIO')
    const result = await writeArchiveCopy(disk, RAW, 'essay.md', '2026-10-04', 'T')
    expect(result).toEqual({
      ok: false,
      message: "The folder can't be written to. It may be open in another program, or syncing."
    })
  })

  test('a folder that cannot be listed reports the reason', async () => {
    const disk = fake([RAW])
    disk.listError = errno('EACCES')
    const result = await writeArchiveCopy(disk, RAW, 'essay.md', '2026-10-04', 'T')
    expect(!result.ok && result.message).toContain('permission')
  })
})

describe('writeNewNote', () => {
  test('uses the name when free and -2 when not', async () => {
    const disk = fake([DRAFTS], { [join(DRAFTS, 'cells.md')]: 'OLD' })
    expect(await writeNewNote(disk, DRAFTS, 'fresh.md', 'A')).toEqual({ ok: true, path: join(DRAFTS, 'fresh.md') })
    expect(await writeNewNote(disk, DRAFTS, 'cells.md', 'B')).toEqual({ ok: true, path: join(DRAFTS, 'cells-2.md') })
    expect(disk.files.get(join(DRAFTS, 'cells.md'))).toBe('OLD')
  })
})

describe('moveWorkingFile', () => {
  const from = join(DRAFTS, 'essay.md')

  test('moves the file', async () => {
    const disk = fake([DRAFTS, OTHER], { [from]: 'T' })
    expect(await moveWorkingFile(disk, from, OTHER)).toEqual({ ok: true, path: join(OTHER, 'essay.md') })
    expect(disk.files.has(from)).toBe(false)
  })

  test('moving into the folder it is already in does nothing', async () => {
    const disk = fake([DRAFTS], { [from]: 'T' })
    expect(await moveWorkingFile(disk, from, DRAFTS)).toEqual({ ok: true, path: from })
  })

  test('refuses when the target already has that name', async () => {
    const disk = fake([DRAFTS, OTHER], { [from]: 'MINE', [join(OTHER, 'essay.md')]: 'THEIRS' })
    const result = await moveWorkingFile(disk, from, OTHER)
    expect(!result.ok && result.message).toContain('already has a note called essay.md')
    expect(disk.files.get(from)).toBe('MINE')
    expect(disk.files.get(join(OTHER, 'essay.md'))).toBe('THEIRS')
  })

  test('refuses a target folder that is not there', async () => {
    const disk = fake([DRAFTS], { [from]: 'T' })
    expect((await moveWorkingFile(disk, from, OTHER)).ok).toBe(false)
  })

  test('across drives it copies, then trashes the original', async () => {
    const disk = fake([DRAFTS, OTHER], { [from]: 'T' })
    disk.renameError = errno('EXDEV')
    expect(await moveWorkingFile(disk, from, OTHER)).toEqual({ ok: true, path: join(OTHER, 'essay.md') })
    expect(disk.files.get(join(OTHER, 'essay.md'))).toBe('T')
    expect(disk.files.has(from)).toBe(false)
  })

  test('any other rename failure leaves everything where it was', async () => {
    const disk = fake([DRAFTS, OTHER], { [from]: 'T' })
    disk.renameError = errno('EBUSY')
    const result = await moveWorkingFile(disk, from, OTHER)
    expect(!result.ok && result.message).toContain("couldn't be moved")
    expect(disk.files.get(from)).toBe('T')
  })

  test('a note that vanished before the move says it could not be found', async () => {
    const disk = fake([DRAFTS, OTHER])
    disk.renameError = errno('ENOENT')
    const result = await moveWorkingFile(disk, from, OTHER)
    expect(result).toEqual({
      ok: false,
      message: "The note couldn't be found. It may have been moved or renamed outside MarkiMarkdown."
    })
  })

  test('a target folder that vanished before the rename is reported as the folder', async () => {
    const disk = fake([DRAFTS, OTHER], { [from]: 'T' })
    disk.renameError = errno('ENOENT')
    const result = await moveWorkingFile(disk, from, OTHER)
    expect(!result.ok && result.message).toContain("folder can't be found")
    expect(disk.files.get(from)).toBe('T')
  })

  test('a rename refused for permissions says so', async () => {
    const disk = fake([DRAFTS, OTHER], { [from]: 'T' })
    disk.renameError = errno('EACCES')
    const result = await moveWorkingFile(disk, from, OTHER)
    expect(!result.ok && result.message).toContain('permission')
    expect(disk.files.get(from)).toBe('T')
  })

  test('a full disk during a cross-drive copy says so and keeps the original', async () => {
    const disk = fake([DRAFTS, OTHER], { [from]: 'T' })
    disk.renameError = errno('EXDEV')
    disk.copyError = errno('ENOSPC')
    const result = await moveWorkingFile(disk, from, OTHER)
    expect(result).toEqual({ ok: false, message: 'There is no space left on the disk.' })
    expect(disk.files.get(from)).toBe('T')
  })

  test('an unknown cross-drive copy failure keeps the general message', async () => {
    const disk = fake([DRAFTS, OTHER], { [from]: 'T' })
    disk.renameError = errno('EXDEV')
    disk.copyError = errno('EIO')
    const result = await moveWorkingFile(disk, from, OTHER)
    expect(!result.ok && result.message).toContain("can't be written to")
  })
})
