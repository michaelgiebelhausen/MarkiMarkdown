import { describe, expect, test, beforeEach } from 'vitest'
import {
  sanitizeFileName,
  preflight,
  runFiling,
  undoFiling,
  hashText,
  type FileOps,
  type FilingPlan
} from '../../src/main/ipc/filing'

/** An in-memory stand-in for the disk, with hooks to make specific paths misbehave. */
class FakeFs implements FileOps {
  files = new Map<string, string>()
  dirs = new Set<string>(['/sb', '/sb/raw', '/downloads'])
  trashed: string[] = []
  failWriteAt = new Set<string>()
  readOnlyDirs = new Set<string>()
  failTrashCount = 0
  failCreateAt = new Set<string>()
  failReadAt = new Set<string>()

  async dirExists(p: string) {
    return this.dirs.has(p)
  }
  async canWrite(p: string) {
    return this.dirs.has(p) && !this.readOnlyDirs.has(p)
  }
  async exists(p: string) {
    return this.files.has(p)
  }
  async readText(p: string) {
    if (this.failReadAt.has(p)) throw new Error('EBUSY: file is locked')
    const v = this.files.get(p)
    if (v === undefined) throw new Error('ENOENT')
    return v
  }
  async writeAtomic(p: string, text: string) {
    if (this.failWriteAt.has(p)) throw new Error('EBUSY: file is locked')
    this.files.set(p, text)
  }
  async createExclusive(p: string, text: string) {
    if (this.failCreateAt.has(p)) return false
    if (this.files.has(p)) return false
    this.files.set(p, text)
    return true
  }
  async appendText(p: string, text: string) {
    this.files.set(p, (this.files.get(p) ?? '') + text)
  }
  async trash(p: string) {
    if (this.failTrashCount > 0) {
      this.failTrashCount -= 1
      throw new Error('EPERM: in use')
    }
    if (!this.files.has(p)) throw new Error('ENOENT')
    this.files.delete(p)
    this.trashed.push(p)
  }
  async mtime(p: string) {
    return this.files.has(p) ? 1000 : null
  }
}

let fs: FakeFs
beforeEach(() => {
  fs = new FakeFs()
  fs.files.set('/downloads/lecture-notes.md', 'ORIGINAL BODY')
})

const plan = (over: Partial<FilingPlan> = {}): FilingPlan => ({
  content: '---\nid: 01K3XYZ\n---\nSTAMPED CONTENT',
  fileName: 'lecture-notes.md',
  noteId: '01K3XYZ',
  currentPath: '/downloads/lecture-notes.md',
  raw: { name: 'study', path: '/sb/raw' },
  ...over
})

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

describe('preflight', () => {
  test('passes when the raw folder is writable and the name is free', async () => {
    const check = await preflight(fs, plan())
    expect(check.ok).toBe(true)
    expect(check.conflict).toBeUndefined()
    expect(check.unavailable).toBeUndefined()
  })

  test('reports a missing raw folder by bunch name', async () => {
    const check = await preflight(fs, plan({ raw: { name: 'study', path: '/sb/nowhere' } }))
    expect(check.ok).toBe(false)
    expect(check.unavailable).toContain('study')
    expect(check.unavailable).toContain('could not be found')
  })

  test('reports a read-only raw folder', async () => {
    fs.readOnlyDirs.add('/sb/raw')
    const check = await preflight(fs, plan())
    expect(check.ok).toBe(false)
    expect(check.unavailable).toContain('cannot be written')
  })

  test('a different note with the same name is a conflict', async () => {
    fs.files.set('/sb/raw/lecture-notes.md', '---\nid: OTHER\n---\nsomeone else')
    const check = await preflight(fs, plan())
    expect(check.ok).toBe(false)
    expect(check.conflict).toEqual({ destPath: '/sb/raw/lecture-notes.md', sameId: false })
  })

  test('an older copy of the same note is not a conflict', async () => {
    fs.files.set('/sb/raw/lecture-notes.md', '---\nid: 01K3XYZ\n---\nolder')
    const check = await preflight(fs, plan())
    expect(check.ok).toBe(true)
    expect(check.conflict?.sameId).toBe(true)
  })

  test('a note already sitting at the destination is not a conflict with itself', async () => {
    fs.files.set('/sb/raw/lecture-notes.md', 'me')
    const check = await preflight(fs, plan({ currentPath: '/sb/raw/lecture-notes.md' }))
    expect(check.ok).toBe(true)
    expect(check.conflict).toBeUndefined()
  })
})

describe('runFiling', () => {
  test('writes the note into raw and moves the original to the trash', async () => {
    const out = await runFiling(fs, plan())
    expect(out.ok).toBe(true)
    expect(out.writtenPath).toBe('/sb/raw/lecture-notes.md')
    expect(fs.files.get('/sb/raw/lecture-notes.md')).toContain('STAMPED CONTENT')
    expect(fs.files.has('/downloads/lecture-notes.md')).toBe(false)
    expect(fs.trashed).toEqual(['/downloads/lecture-notes.md'])
    expect(out.undo.movedFrom).toEqual({ path: '/downloads/lecture-notes.md', text: 'ORIGINAL BODY' })
    expect(out.undo.written?.path).toBe('/sb/raw/lecture-notes.md')
    expect(out.hash).toBe(hashText(plan().content))
  })

  test('never writes a log file', async () => {
    await runFiling(fs, plan())
    expect([...fs.files.keys()].some((p) => p.endsWith('log.md'))).toBe(false)
  })

  test('a note with no home yet is simply written', async () => {
    const out = await runFiling(fs, plan({ currentPath: undefined }))
    expect(out.ok).toBe(true)
    expect(fs.trashed).toEqual([])
    expect(out.undo.movedFrom).toBeUndefined()
  })

  test('a note already in raw is rewritten in place and can be undone', async () => {
    fs.files.set('/sb/raw/lecture-notes.md', 'BEFORE')
    const out = await runFiling(fs, plan({ currentPath: '/sb/raw/lecture-notes.md' }))
    expect(out.ok).toBe(true)
    expect(fs.trashed).toEqual([])
    expect(fs.files.get('/sb/raw/lecture-notes.md')).toContain('STAMPED CONTENT')
    expect(out.undo.rewritten).toEqual({ path: '/sb/raw/lecture-notes.md', before: 'BEFORE', after: plan().content })
    expect(out.undo.written).toBeUndefined()
  })

  test('a note already elsewhere in raw is rewritten in place even when its base name is taken', async () => {
    fs.files.set('/sb/raw/lecture-notes-2.md', 'BEFORE')
    fs.files.set('/sb/raw/lecture-notes.md', '---\nid: OTHER\n---\nsomeone else')
    const out = await runFiling(fs, plan({ currentPath: '/sb/raw/lecture-notes-2.md' }))
    expect(out.ok).toBe(true)
    expect(out.writtenPath).toBe('/sb/raw/lecture-notes-2.md')
    expect(fs.files.get('/sb/raw/lecture-notes-2.md')).toContain('STAMPED CONTENT')
    expect(fs.files.get('/sb/raw/lecture-notes.md')).toContain('someone else')
    expect(fs.trashed).toEqual([])
  })

  test('a note already in raw keeps its old file name even after the note is renamed', async () => {
    fs.files.set('/sb/raw/old-name.md', 'BEFORE')
    const out = await runFiling(fs, plan({ currentPath: '/sb/raw/old-name.md', fileName: 'new-name.md' }))
    expect(out.ok).toBe(true)
    expect(out.writtenPath).toBe('/sb/raw/old-name.md')
    expect(fs.files.get('/sb/raw/old-name.md')).toContain('STAMPED CONTENT')
    expect(fs.files.has('/sb/raw/new-name.md')).toBe(false)
  })

  test('an in-place rewrite with nothing readable there records a null before', async () => {
    const out = await runFiling(fs, plan({ currentPath: '/sb/raw/lecture-notes.md' }))
    expect(out.undo.rewritten?.before).toBeNull()
  })

  test('keepBoth writes beside the clash', async () => {
    fs.files.set('/sb/raw/lecture-notes.md', '---\nid: OTHER\n---\nsomeone else')
    const out = await runFiling(fs, plan({ conflictChoice: 'keepBoth' }))
    expect(out.ok).toBe(true)
    expect(out.writtenPath).toBe('/sb/raw/lecture-notes-2.md')
    expect(fs.files.get('/sb/raw/lecture-notes.md')).toContain('someone else')
  })

  test('replace trashes the displaced note and remembers it', async () => {
    fs.files.set('/sb/raw/lecture-notes.md', '---\nid: OTHER\n---\nsomeone else')
    const out = await runFiling(fs, plan({ conflictChoice: 'replace' }))
    expect(out.ok).toBe(true)
    expect(fs.files.get('/sb/raw/lecture-notes.md')).toContain('STAMPED CONTENT')
    expect(out.undo.replaced?.text).toContain('someone else')
    expect(fs.trashed).toContain('/sb/raw/lecture-notes.md')
  })

  test('cancel writes nothing', async () => {
    fs.files.set('/sb/raw/lecture-notes.md', '---\nid: OTHER\n---\nsomeone else')
    const out = await runFiling(fs, plan({ conflictChoice: 'cancel' }))
    expect(out.ok).toBe(false)
    expect(out.failure).toContain('already has a different note')
    expect(fs.files.get('/sb/raw/lecture-notes.md')).toContain('someone else')
    expect(fs.files.has('/downloads/lecture-notes.md')).toBe(true)
  })

  test('a failed write leaves the original untouched', async () => {
    fs.failWriteAt.add('/sb/raw/lecture-notes.md')
    const out = await runFiling(fs, plan())
    expect(out.ok).toBe(false)
    expect(out.failure).toContain('study')
    expect(fs.files.has('/downloads/lecture-notes.md')).toBe(true)
    expect(fs.trashed).toEqual([])
  })

  test('an original that cannot be trashed is reported, not treated as failure', async () => {
    fs.failTrashCount = 5
    const out = await runFiling(fs, plan())
    expect(out.ok).toBe(true)
    expect(out.originalKept).toBe(true)
    expect(out.notice).toContain('still where it was')
    expect(fs.files.has('/downloads/lecture-notes.md')).toBe(true)
  })

  test('an unavailable raw folder blocks everything', async () => {
    const out = await runFiling(fs, plan({ raw: { name: 'study', path: '/sb/nowhere' } }))
    expect(out.ok).toBe(false)
    expect(out.failure).toContain('could not be found')
    expect(fs.files.has('/downloads/lecture-notes.md')).toBe(true)
  })

  test('a write failure after replacing tells the student the displaced note is in the trash', async () => {
    fs.files.set('/sb/raw/lecture-notes.md', '---\nid: OTHER\n---\nsomeone else')
    fs.failWriteAt.add('/sb/raw/lecture-notes.md')
    const out = await runFiling(fs, plan({ conflictChoice: 'replace' }))
    expect(out.ok).toBe(false)
    expect(out.failure).toContain('moved to the trash')
    expect(out.undo.replaced).toBeDefined()
  })

  test('a .txt note already sitting in raw is filed into a stamped .md, not overwritten as .txt', async () => {
    fs.files.set('/sb/raw/notes.txt', 'plain')
    const out = await runFiling(fs, plan({ currentPath: '/sb/raw/notes.txt', fileName: 'notes.md' }))
    expect(out.ok).toBe(true)
    expect(out.writtenPath).toBe('/sb/raw/notes.md')
    expect(fs.files.get('/sb/raw/notes.md')).toContain('STAMPED CONTENT')
    expect(fs.files.has('/sb/raw/notes.txt')).toBe(false)
    expect(fs.trashed).toContain('/sb/raw/notes.txt')
    expect(out.undo.movedFrom).toEqual({ path: '/sb/raw/notes.txt', text: 'plain' })
  })

  test('a locked original is reported rather than silently dropped', async () => {
    fs.failReadAt.add('/downloads/lecture-notes.md')
    const out = await runFiling(fs, plan())
    expect(out.ok).toBe(true)
    expect(out.originalKept).toBe(true)
    expect(out.notice).toContain('still where it was')
    expect(fs.files.has('/downloads/lecture-notes.md')).toBe(true)
    expect(fs.files.has('/sb/raw/lecture-notes.md')).toBe(true)
    expect(out.undo.movedFrom).toBeUndefined()
  })
})

describe('undoFiling', () => {
  test('puts the original back and removes the filed copy', async () => {
    const out = await runFiling(fs, plan())
    const undone = await undoFiling(fs, out.undo)
    expect(undone.ok).toBe(true)
    expect(fs.files.get('/downloads/lecture-notes.md')).toBe('ORIGINAL BODY')
    expect(fs.files.has('/sb/raw/lecture-notes.md')).toBe(false)
    expect(undone.keptChanged).toEqual([])
  })

  test('leaves the filed copy alone if it has changed since', async () => {
    const out = await runFiling(fs, plan())
    fs.files.set('/sb/raw/lecture-notes.md', 'edited afterwards')
    const undone = await undoFiling(fs, out.undo)
    expect(fs.files.get('/sb/raw/lecture-notes.md')).toBe('edited afterwards')
    expect(undone.keptChanged).toEqual(['/sb/raw/lecture-notes.md'])
    expect(undone.message).toContain('left alone')
  })

  test('restores a note that replace displaced', async () => {
    fs.files.set('/sb/raw/lecture-notes.md', '---\nid: OTHER\n---\nsomeone else')
    const out = await runFiling(fs, plan({ conflictChoice: 'replace' }))
    await undoFiling(fs, out.undo)
    expect(fs.files.get('/sb/raw/lecture-notes.md')).toContain('someone else')
  })

  test('restores the previous text after an in-place rewrite', async () => {
    fs.files.set('/sb/raw/lecture-notes.md', 'BEFORE')
    const out = await runFiling(fs, plan({ currentPath: '/sb/raw/lecture-notes.md' }))
    await undoFiling(fs, out.undo)
    expect(fs.files.get('/sb/raw/lecture-notes.md')).toBe('BEFORE')
  })

  test('does not overwrite something that reappeared at the original path', async () => {
    const out = await runFiling(fs, plan())
    fs.files.set('/downloads/lecture-notes.md', 'a new file with the old name')
    await undoFiling(fs, out.undo)
    expect(fs.files.get('/downloads/lecture-notes.md')).toBe('a new file with the old name')
  })

  test('a filed copy is left alone when the original cannot be restored', async () => {
    const out = await runFiling(fs, plan())
    fs.failCreateAt.add('/downloads/lecture-notes.md')
    const undone = await undoFiling(fs, out.undo)
    expect(undone.ok).toBe(false)
    expect(undone.notRestored).toEqual(['/downloads/lecture-notes.md'])
    expect(fs.files.has('/sb/raw/lecture-notes.md')).toBe(true)
    expect(undone.message).toContain('could not be put back')
  })

  test('undoing an in-place rewrite that had nothing before trashes the note instead of leaving an empty file', async () => {
    const out = await runFiling(fs, plan({ currentPath: '/sb/raw/lecture-notes.md' }))
    expect(out.undo.rewritten?.before).toBeNull()
    await undoFiling(fs, out.undo)
    expect(fs.files.has('/sb/raw/lecture-notes.md')).toBe(false)
  })
})
