import { describe, expect, test, beforeEach } from 'vitest'
import { DocumentStore } from '@renderer/state/document'

let store: DocumentStore
beforeEach(() => {
  store = new DocumentStore()
})

const loaded = (text: string, path = 'C:/downloads/notes.md') => ({
  path,
  text,
  eol: text.includes('\r\n') ? ('\r\n' as const) : ('\n' as const),
  hadBom: false,
  encoding: 'utf-8' as const,
  mtimeMs: 1
})

describe('opening a file', () => {
  test('splits front matter from the body but shows both in the code pane', () => {
    store.load(loaded('---\ntitle: Notes\n---\n# Hello\n'))
    expect(store.state.frontMatterRaw).toBe('---\ntitle: Notes\n---\n')
    expect(store.state.body).toBe('# Hello\n')
    expect(store.fullText()).toBe('---\ntitle: Notes\n---\n# Hello\n')
  })

  test('is not dirty just because it was opened', () => {
    store.load(loaded('---\ntitle: Notes: broken\n---\n# Hello\n'))
    expect(store.state.dirty).toBe(false)
  })

  test('remembers where it came from and what it is called', () => {
    store.load(loaded('# Hello\n', 'C:/downloads/lecture notes.md'))
    expect(store.state.paths).toEqual(['C:/downloads/lecture notes.md'])
    expect(store.state.fileName).toBe('lecture notes.md')
  })

  test('marks a .txt file as plain text and renames it to .md', () => {
    store.load(loaded('Just some text\n', 'C:/downloads/notes.txt'))
    expect(store.state.isPlainText).toBe(true)
    expect(store.state.fileName).toBe('notes.md')
  })

  test('an empty document still has a body', () => {
    store.load(loaded(''))
    expect(store.state.body).toBe('')
    expect(store.fullText()).toBe('')
  })
})

describe('editing from the code pane', () => {
  beforeEach(() => store.load(loaded('---\ntitle: Notes\n---\n# Hello\n')))

  test('re-splits front matter when the whole text is replaced', () => {
    store.setFullText('---\ntitle: Changed\n---\n# Hello\n', 'code')
    expect(store.state.frontMatterRaw).toBe('---\ntitle: Changed\n---\n')
    expect(store.state.body).toBe('# Hello\n')
    expect(store.state.dirty).toBe(true)
  })

  test('handles the student deleting the closing fence without losing text', () => {
    store.setFullText('---\ntitle: Notes\n# Hello\n', 'code')
    expect(store.state.frontMatterRaw).toBeNull()
    expect(store.fullText()).toBe('---\ntitle: Notes\n# Hello\n')
  })

  test('ignores an edit that claims to come from a pane that does not own the document', () => {
    store.setOwner('code')
    store.setBody('from the wrong pane\n', 'rendered')
    expect(store.state.body).toBe('# Hello\n')
  })

  test('accepts an edit from the owning pane', () => {
    store.setOwner('rendered')
    store.setBody('# Owned\n', 'rendered')
    expect(store.state.body).toBe('# Owned\n')
  })

  test('accepts any edit while no pane has focus', () => {
    store.setOwner(null)
    store.setBody('# Anyone\n', 'rendered')
    expect(store.state.body).toBe('# Anyone\n')
  })

  test('an identical value does not mark the document dirty', () => {
    store.setFullText('---\ntitle: Notes\n---\n# Hello\n', 'code')
    expect(store.state.dirty).toBe(false)
  })
})

describe('undo', () => {
  beforeEach(() => store.load(loaded('one\n')))

  test('a fresh document has nothing to undo', () => {
    expect(store.canUndo()).toBe(false)
    store.undo()
    expect(store.state.body).toBe('one\n')
  })

  test('steps back through edits from either pane', () => {
    store.setOwner('code')
    store.setFullText('two\n', 'code')
    store.commitUndoGroup()
    store.setOwner('rendered')
    store.setBody('three\n', 'rendered')
    store.commitUndoGroup()

    expect(store.state.body).toBe('three\n')
    store.undo()
    expect(store.state.body).toBe('two\n')
    store.undo()
    expect(store.state.body).toBe('one\n')
  })

  test('redo walks forward again', () => {
    store.setFullText('two\n', 'code')
    store.commitUndoGroup()
    store.undo()
    expect(store.state.body).toBe('one\n')
    store.redo()
    expect(store.state.body).toBe('two\n')
  })

  test('a new edit after undo drops the redo trail', () => {
    store.setFullText('two\n', 'code')
    store.commitUndoGroup()
    store.undo()
    store.setFullText('other\n', 'code')
    store.commitUndoGroup()
    expect(store.canRedo()).toBe(false)
    store.undo()
    expect(store.state.body).toBe('one\n')
  })

  test('undoing back to the opened text clears the dirty flag', () => {
    store.setFullText('two\n', 'code')
    store.commitUndoGroup()
    expect(store.state.dirty).toBe(true)
    store.undo()
    expect(store.state.dirty).toBe(false)
  })

  test('rapid keystrokes collapse into one undo step until the group is committed', () => {
    store.setFullText('t\n', 'code')
    store.setFullText('tw\n', 'code')
    store.setFullText('two\n', 'code')
    store.commitUndoGroup()
    store.undo()
    expect(store.state.body).toBe('one\n')
  })
})

describe('filing changes where the note lives', () => {
  beforeEach(() => store.load(loaded('# Hello\n', 'C:/downloads/notes.md')))

  test('after filing the note tracks every folder it now lives in', () => {
    store.afterFiling(['C:/sb/Inbox/notes.md', 'C:/sb/Research/notes.md'])
    expect(store.state.paths).toEqual(['C:/sb/Inbox/notes.md', 'C:/sb/Research/notes.md'])
    expect(store.state.dirty).toBe(false)
    expect(store.state.originalPath).toBeUndefined()
  })

  test('an untitled note has no paths and cannot be saved silently', () => {
    const fresh = new DocumentStore()
    expect(fresh.state.paths).toEqual([])
    expect(fresh.needsFileName()).toBe(true)
  })

  test('a plain text file needs a name before it can be saved as markdown', () => {
    store.load(loaded('text\n', 'C:/downloads/notes.txt'))
    expect(store.needsFileName()).toBe(true)
  })
})

describe('notifying listeners', () => {
  test('tells subscribers when anything changes', () => {
    let calls = 0
    const off = store.subscribe(() => {
      calls += 1
    })
    store.load(loaded('one\n'))
    store.setFullText('two\n', 'code')
    expect(calls).toBeGreaterThanOrEqual(2)
    off()
    store.setFullText('three\n', 'code')
    const after = calls
    store.setFullText('four\n', 'code')
    expect(calls).toBe(after)
  })

  test('hands out a stable snapshot object so React does not loop', () => {
    store.load(loaded('one\n'))
    const a = store.getSnapshot()
    const b = store.getSnapshot()
    expect(a).toBe(b)
    store.setFullText('two\n', 'code')
    expect(store.getSnapshot()).not.toBe(a)
  })
})

describe('what the editor holds after filing', () => {
  test('takes on the stamped text, so the next save cannot wipe the stamp', () => {
    store.load(loaded('# Hello\n', 'C:/downloads/notes.md'))
    const stamped = '---\nid: 01ABC\ntype: note\nagents: [librarian]\n---\n# Hello\n'

    store.afterFiling(['C:/sb/Inbox/notes.md'], stamped)

    expect(store.fullText()).toBe(stamped)
    expect(store.state.frontMatterRaw).toContain('id: 01ABC')
    expect(store.state.body).toBe('# Hello\n')
    expect(store.state.dirty).toBe(false)
  })

  test('a later edit still counts as a change against the stamped text', () => {
    store.load(loaded('# Hello\n', 'C:/downloads/notes.md'))
    store.afterFiling(['C:/sb/Inbox/notes.md'], '---\nid: 01ABC\n---\n# Hello\n')
    expect(store.state.dirty).toBe(false)

    store.setBody('# Hello there\n', null)
    expect(store.state.dirty).toBe(true)
    expect(store.fullText()).toBe('---\nid: 01ABC\n---\n# Hello there\n')
  })

  test('undoing past the filing does not lose the stamp', () => {
    store.load(loaded('# Hello\n', 'C:/downloads/notes.md'))
    store.afterFiling(['C:/sb/Inbox/notes.md'], '---\nid: 01ABC\n---\n# Hello\n')
    store.setBody('# Edited\n', null)
    store.commitUndoGroup()
    store.undo()
    expect(store.fullText()).toContain('id: 01ABC')
  })

  test('still works when no stamped text is supplied', () => {
    store.load(loaded('# Hello\n', 'C:/downloads/notes.md'))
    store.afterFiling(['C:/sb/Inbox/notes.md'])
    expect(store.fullText()).toBe('# Hello\n')
    expect(store.state.paths).toEqual(['C:/sb/Inbox/notes.md'])
  })
})
