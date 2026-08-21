import { describe, expect, test, beforeEach } from 'vitest'
import {
  sanitizeFileName,
  buildLogLine,
  preflight,
  runFiling,
  undoFiling,
  LOG_HEADER,
  type FileOps,
  type FilingPlan
} from '../../src/main/ipc/filing'

/** An in-memory stand-in for the disk, with hooks to make specific paths misbehave. */
class FakeFs implements FileOps {
  files = new Map<string, string>()
  dirs = new Set<string>(['/sb', '/sb/Inbox', '/sb/Research', '/sb/Archive', '/downloads'])
  trashed: string[] = []
  failWriteAt = new Set<string>()
  failAppendAt = new Set<string>()
  readOnlyDirs = new Set<string>()
  failTrashCount = 0

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
    const v = this.files.get(p)
    if (v === undefined) throw new Error('ENOENT')
    return v
  }
  async writeAtomic(p: string, text: string) {
    if (this.failWriteAt.has(p)) throw new Error('EBUSY: file is locked')
    this.files.set(p, text)
  }
  async createExclusive(p: string, text: string) {
    if (this.files.has(p)) return false
    this.files.set(p, text)
    return true
  }
  async appendText(p: string, text: string) {
    if (this.failAppendAt.has(p)) throw new Error('EACCES: read-only')
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
  content: 'STAMPED CONTENT',
  fileName: 'lecture-notes.md',
  noteId: '01K3XYZ',
  agentNames: ['librarian'],
  currentPaths: [],
  originalPath: '/downloads/lecture-notes.md',
  addFolders: [{ name: 'Inbox', path: '/sb/Inbox' }],
  removeFolders: [],
  allFolderNames: ['Inbox'],
  now: '2026-08-21 14:30',
  ...over
})

describe('sanitizeFileName', () => {
  test('keeps an ordinary name', () => {
    expect(sanitizeFileName('lecture notes.md')).toBe('lecture notes.md')
  })
  test('always ends in .md', () => {
    expect(sanitizeFileName('notes')).toBe('notes.md')
    expect(sanitizeFileName('notes.txt')).toBe('notes.md')
  })
  test('removes characters Windows forbids', () => {
    expect(sanitizeFileName('a<b>c:d"e/f|g?h*i.md')).toBe('abcdefghi.md')
  })
  test('escapes reserved Windows device names', () => {
    expect(sanitizeFileName('CON.md')).toBe('CON-note.md')
    expect(sanitizeFileName('lpt1.md')).toBe('lpt1-note.md')
  })
  test('drops trailing dots and spaces', () => {
    expect(sanitizeFileName('notes .md')).toBe('notes.md')
  })
  test('falls back when nothing usable is left', () => {
    expect(sanitizeFileName('///.md')).toBe('note.md')
    expect(sanitizeFileName('')).toBe('note.md')
  })
  test('keeps accented characters', () => {
    expect(sanitizeFileName('résumé.md')).toBe('résumé.md')
  })
})

describe('buildLogLine', () => {
  test('records the file, the id, the agents and the other folders', () => {
    const line = buildLogLine({
      now: '2026-08-21 14:30',
      fileName: 'lecture-notes.md',
      noteId: '01K3XYZ',
      agentNames: ['librarian', 'tutor'],
      otherFolderNames: ['Research']
    })
    expect(line).toContain('2026-08-21 14:30')
    expect(line).toContain('lecture-notes.md')
    expect(line).toContain('01K3XYZ')
    expect(line).toContain('librarian, tutor')
    expect(line).toContain('Research')
    expect(line.startsWith('- ')).toBe(true)
    expect(line.endsWith('\n')).toBe(true)
  })
  test('omits the agent clause when there are no agents', () => {
    const line = buildLogLine({
      now: 'n', fileName: 'f.md', noteId: 'i', agentNames: [], otherFolderNames: []
    })
    expect(line).not.toContain('for ')
    expect(line).not.toContain('also in')
  })
})

describe('preflight', () => {
  test('passes for a writable empty folder', async () => {
    const r = await preflight(fs, plan())
    expect(r.ok).toBe(true)
    expect(r.conflicts).toEqual([])
    expect(r.unavailable).toEqual([])
  })

  test('reports a folder that no longer exists', async () => {
    const r = await preflight(fs, plan({ addFolders: [{ name: 'Gone', path: '/sb/Gone' }] }))
    expect(r.ok).toBe(false)
    expect(r.unavailable[0].folderName).toBe('Gone')
  })

  test('reports a read-only folder', async () => {
    fs.readOnlyDirs.add('/sb/Inbox')
    const r = await preflight(fs, plan())
    expect(r.ok).toBe(false)
    expect(r.unavailable[0].folderName).toBe('Inbox')
  })

  test('flags a name clash with a different note', async () => {
    fs.files.set('/sb/Inbox/lecture-notes.md', '---\nid: SOMETHING-ELSE\n---\nother\n')
    const r = await preflight(fs, plan())
    expect(r.conflicts).toHaveLength(1)
    expect(r.conflicts[0].sameId).toBe(false)
    expect(r.conflicts[0].folderName).toBe('Inbox')
  })

  test('recognises an older copy of the same note as not a real clash', async () => {
    fs.files.set('/sb/Inbox/lecture-notes.md', '---\nid: 01K3XYZ\n---\nolder\n')
    const r = await preflight(fs, plan())
    expect(r.conflicts).toHaveLength(1)
    expect(r.conflicts[0].sameId).toBe(true)
    expect(r.ok).toBe(true)
  })
})

describe('runFiling', () => {
  test('writes the note into every destination and logs each one', async () => {
    const res = await runFiling(
      fs,
      plan({
        addFolders: [
          { name: 'Inbox', path: '/sb/Inbox' },
          { name: 'Research', path: '/sb/Research' }
        ],
        allFolderNames: ['Inbox', 'Research']
      })
    )
    expect(res.ok).toBe(true)
    expect(fs.files.get('/sb/Inbox/lecture-notes.md')).toBe('STAMPED CONTENT')
    expect(fs.files.get('/sb/Research/lecture-notes.md')).toBe('STAMPED CONTENT')
    expect(fs.files.get('/sb/Inbox/log.md')).toContain('lecture-notes.md')
    expect(fs.files.get('/sb/Research/log.md')).toContain('lecture-notes.md')
    expect(res.written.map((w) => w.path).sort()).toEqual([
      '/sb/Inbox/lecture-notes.md',
      '/sb/Research/lecture-notes.md'
    ])
  })

  test("each folder's log mentions the other folders the note went to", async () => {
    await runFiling(
      fs,
      plan({
        addFolders: [
          { name: 'Inbox', path: '/sb/Inbox' },
          { name: 'Research', path: '/sb/Research' }
        ],
        allFolderNames: ['Inbox', 'Research']
      })
    )
    expect(fs.files.get('/sb/Inbox/log.md')).toContain('Research')
    expect(fs.files.get('/sb/Research/log.md')).toContain('Inbox')
  })

  test('creates log.md with an explanatory header the first time', async () => {
    await runFiling(fs, plan())
    const log = fs.files.get('/sb/Inbox/log.md') as string
    expect(log.startsWith(LOG_HEADER)).toBe(true)
  })

  test('adds a newline before appending when the log did not end with one', async () => {
    fs.files.set('/sb/Inbox/log.md', LOG_HEADER + '- an earlier line')
    await runFiling(fs, plan())
    const log = fs.files.get('/sb/Inbox/log.md') as string
    expect(log).not.toContain('earlier line- ')
    expect(log.split('\n').filter((l) => l.startsWith('- ')).length).toBe(2)
  })

  test('sends the original to the trash when it sits outside every destination', async () => {
    const res = await runFiling(fs, plan())
    expect(fs.trashed).toContain('/downloads/lecture-notes.md')
    expect(res.trashed).toContain('/downloads/lecture-notes.md')
  })

  test('keeps the original when it is already inside a destination folder', async () => {
    fs.files.set('/sb/Inbox/lecture-notes.md', 'old')
    const res = await runFiling(
      fs,
      plan({ originalPath: '/sb/Inbox/lecture-notes.md', addFolders: [{ name: 'Inbox', path: '/sb/Inbox' }] })
    )
    expect(fs.trashed).not.toContain('/sb/Inbox/lecture-notes.md')
    expect(res.ok).toBe(true)
  })

  test('rewrites copies the note already occupies', async () => {
    fs.files.set('/sb/Archive/lecture-notes.md', 'stale')
    await runFiling(
      fs,
      plan({ currentPaths: ['/sb/Archive/lecture-notes.md'], originalPath: undefined })
    )
    expect(fs.files.get('/sb/Archive/lecture-notes.md')).toBe('STAMPED CONTENT')
  })

  test('trashes copies the student removed and records it in that folder log', async () => {
    fs.files.set('/sb/Archive/lecture-notes.md', 'a copy')
    const res = await runFiling(
      fs,
      plan({
        currentPaths: ['/sb/Archive/lecture-notes.md'],
        originalPath: undefined,
        addFolders: [{ name: 'Inbox', path: '/sb/Inbox' }],
        removeFolders: [
          { name: 'Archive', path: '/sb/Archive', filePath: '/sb/Archive/lecture-notes.md' }
        ],
        allFolderNames: ['Inbox']
      })
    )
    expect(res.ok).toBe(true)
    expect(fs.trashed).toContain('/sb/Archive/lecture-notes.md')
    expect(fs.files.get('/sb/Archive/log.md')).toContain('removed')
  })
})

describe('runFiling when the disk misbehaves', () => {
  test('reports the folder that failed by name and keeps the others consistent', async () => {
    fs.failWriteAt.add('/sb/Research/lecture-notes.md')
    const res = await runFiling(
      fs,
      plan({
        addFolders: [
          { name: 'Inbox', path: '/sb/Inbox' },
          { name: 'Research', path: '/sb/Research' }
        ],
        allFolderNames: ['Inbox', 'Research']
      })
    )
    expect(res.ok).toBe(false)
    expect(res.failures).toHaveLength(1)
    expect(res.failures[0].folderName).toBe('Research')
    expect(res.failures[0].message).not.toContain('EBUSY')
    expect(fs.files.get('/sb/Inbox/lecture-notes.md')).toBe('STAMPED CONTENT')
    expect(res.written.map((w) => w.path)).toEqual(['/sb/Inbox/lecture-notes.md'])
  })

  test('never trashes the original when a destination failed', async () => {
    fs.failWriteAt.add('/sb/Inbox/lecture-notes.md')
    const res = await runFiling(fs, plan())
    expect(res.ok).toBe(false)
    expect(fs.trashed).not.toContain('/downloads/lecture-notes.md')
    expect(fs.files.has('/downloads/lecture-notes.md')).toBe(true)
  })

  test('retries a locked original before giving up, and still counts the filing a success', async () => {
    fs.failTrashCount = 2
    const res = await runFiling(fs, plan())
    expect(res.ok).toBe(true)
    expect(fs.trashed).toContain('/downloads/lecture-notes.md')
  })

  test('keeps the destinations when the original cannot be removed at all', async () => {
    fs.failTrashCount = 99
    const res = await runFiling(fs, plan())
    expect(res.ok).toBe(true)
    expect(fs.files.get('/sb/Inbox/lecture-notes.md')).toBe('STAMPED CONTENT')
    expect(res.originalKept).toBe(true)
    expect(res.notice).toContain('still in')
  })

  test('resolves a clash by keeping both when asked', async () => {
    fs.files.set('/sb/Inbox/lecture-notes.md', '---\nid: OTHER\n---\n')
    const res = await runFiling(fs, plan({ conflictChoice: 'keepBoth' }))
    expect(res.ok).toBe(true)
    expect(fs.files.get('/sb/Inbox/lecture-notes.md')).toContain('id: OTHER')
    expect(fs.files.get('/sb/Inbox/lecture-notes-2.md')).toBe('STAMPED CONTENT')
  })

  test('writes nothing at all when the student cancels a clash', async () => {
    fs.files.set('/sb/Inbox/lecture-notes.md', '---\nid: OTHER\n---\n')
    const res = await runFiling(fs, plan({ conflictChoice: 'cancel' }))
    expect(res.ok).toBe(false)
    expect(fs.files.get('/sb/Inbox/lecture-notes.md')).toContain('id: OTHER')
    expect(fs.trashed).toEqual([])
  })
})

describe('undoFiling', () => {
  test('puts the original back and removes the copies it wrote', async () => {
    const res = await runFiling(fs, plan())
    expect(fs.files.has('/downloads/lecture-notes.md')).toBe(false)
    const undo = await undoFiling(fs, res.undo)
    expect(undo.ok).toBe(true)
    expect(fs.files.get('/downloads/lecture-notes.md')).toBe('ORIGINAL BODY')
    expect(fs.files.has('/sb/Inbox/lecture-notes.md')).toBe(false)
  })

  test('leaves a copy alone when something else has already changed it', async () => {
    const res = await runFiling(fs, plan())
    fs.files.set('/sb/Inbox/lecture-notes.md', 'AN AGENT REWROTE THIS')
    const undo = await undoFiling(fs, res.undo)
    expect(fs.files.get('/sb/Inbox/lecture-notes.md')).toBe('AN AGENT REWROTE THIS')
    expect(undo.keptChanged).toContain('/sb/Inbox/lecture-notes.md')
  })

  test('removes its log line when it is still the last one', async () => {
    const res = await runFiling(fs, plan())
    await undoFiling(fs, res.undo)
    const log = fs.files.get('/sb/Inbox/log.md') as string
    expect(log.split('\n').filter((l) => l.startsWith('- ')).length).toBe(0)
  })

  test('appends an undo note instead when the log has moved on', async () => {
    const res = await runFiling(fs, plan())
    await fs.appendText('/sb/Inbox/log.md', '- something else happened\n')
    await undoFiling(fs, res.undo)
    const log = fs.files.get('/sb/Inbox/log.md') as string
    expect(log).toContain('something else happened')
    expect(log).toContain('undone')
  })

  test('does not fail when the original reappeared while the toast was up', async () => {
    const res = await runFiling(fs, plan())
    fs.files.set('/downloads/lecture-notes.md', 'SOMETHING NEW')
    const undo = await undoFiling(fs, res.undo)
    expect(undo.ok).toBe(true)
    expect(fs.files.get('/downloads/lecture-notes.md')).toBe('SOMETHING NEW')
  })
})

describe('a name clash must never destroy the other note', () => {
  test('replacing sends the note that was there to the trash first', async () => {
    fs.files.set('/sb/Inbox/lecture-notes.md', '---\nid: OTHER\n---\nThree weeks of work\n')
    const res = await runFiling(fs, plan({ conflictChoice: 'replace' }))
    expect(res.ok).toBe(true)
    expect(fs.files.get('/sb/Inbox/lecture-notes.md')).toBe('STAMPED CONTENT')
    // the note that was replaced is recoverable, not gone
    expect(fs.trashed).toContain('/sb/Inbox/lecture-notes.md')
  })

  test('undo brings the replaced note back rather than leaving the folder empty', async () => {
    fs.files.set('/sb/Inbox/lecture-notes.md', '---\nid: OTHER\n---\nThree weeks of work\n')
    const res = await runFiling(fs, plan({ conflictChoice: 'replace' }))
    const undo = await undoFiling(fs, res.undo)
    expect(undo.ok).toBe(true)
    expect(fs.files.get('/sb/Inbox/lecture-notes.md')).toContain('Three weeks of work')
  })

  test('an older copy of the same note is simply updated, with no trash detour', async () => {
    fs.files.set('/sb/Inbox/lecture-notes.md', '---\nid: 01K3XYZ\n---\nolder\n')
    const res = await runFiling(fs, plan())
    expect(res.ok).toBe(true)
    expect(fs.files.get('/sb/Inbox/lecture-notes.md')).toBe('STAMPED CONTENT')
    expect(fs.trashed).not.toContain('/sb/Inbox/lecture-notes.md')
  })
})

describe('the folder log is a convenience, never a blocker', () => {
  test('a log that cannot be written still leaves the filing successful', async () => {
    fs.files.set('/sb/Inbox/log.md', LOG_HEADER)
    fs.failAppendAt.add('/sb/Inbox/log.md')
    const res = await runFiling(fs, plan())
    expect(res.ok).toBe(true)
    expect(res.failures).toEqual([])
    expect(fs.files.get('/sb/Inbox/lecture-notes.md')).toBe('STAMPED CONTENT')
    expect(fs.trashed).toContain('/downloads/lecture-notes.md')
  })
})

describe('a note must never overwrite the folder log', () => {
  test('a note called log.md is filed under a different name', async () => {
    const res = await runFiling(fs, plan({ fileName: 'log.md' }))
    expect(res.ok).toBe(true)
    expect(fs.files.get('/sb/Inbox/log.md')).not.toBe('STAMPED CONTENT')
    expect(res.written.some((w) => w.path === '/sb/Inbox/log.md')).toBe(false)
    expect(res.written).toHaveLength(1)
  })

  test('the renamed note is still a sensible name', () => {
    expect(sanitizeFileName('log.md')).toBe('log-note.md')
    expect(sanitizeFileName('LOG.md')).toBe('LOG-note.md')
  })
})
