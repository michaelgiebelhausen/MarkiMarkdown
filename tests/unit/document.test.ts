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
  })

  test('a plain text file has no Markdown path until it is saved as one', () => {
    store.load(loaded('text\n', 'C:/downloads/notes.txt'))
    expect(store.state.paths).toEqual([])
    expect(store.state.isPlainText).toBe(true)
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
  test('the text is left exactly as it was; only where it lives changes', () => {
    store.load(loaded('# Hello\n', 'C:/downloads/notes.md'))
    store.afterFiling(['C:/sb/Inbox/notes.md'])
    expect(store.fullText()).toBe('# Hello\n')
    expect(store.state.paths).toEqual(['C:/sb/Inbox/notes.md'])
  })

  test('a later edit still counts as a change against what was written', () => {
    store.load(loaded('# Hello\n', 'C:/downloads/notes.md'))
    store.afterFiling(['C:/sb/Inbox/notes.md'], { written: '# Hello\n' })
    expect(store.state.dirty).toBe(false)

    store.setBody('# Hello there\n', null)
    expect(store.state.dirty).toBe(true)
  })
})

describe('only what was written counts as saved', () => {
  beforeEach(() => store.load(loaded('one\n')))

  test('text typed while a save was on its way stays unsaved', () => {
    store.setBody('two\n', null)
    const written = store.fullText()
    store.setBody('two and more\n', null) // typed during the await
    store.markSaved(written)
    expect(store.state.dirty).toBe(true)
    // ...and getting back to exactly what was written is clean again
    store.setBody('two\n', null)
    expect(store.state.dirty).toBe(false)
  })

  test('markSaved with the current text clears dirty', () => {
    store.setBody('two\n', null)
    store.markSaved(store.fullText())
    expect(store.state.dirty).toBe(false)
  })

  test('markSaved with nothing given still means the current text', () => {
    store.setBody('two\n', null)
    store.markSaved()
    expect(store.state.dirty).toBe(false)
  })

  test('a first save with typing during it keeps the new typing unsaved', () => {
    store.setBody('two\n', null)
    const written = store.fullText()
    store.setBody('two and more\n', null)
    store.afterFiling(['C:/sb/notes.md'], { written })
    expect(store.state.paths).toEqual(['C:/sb/notes.md'])
    expect(store.state.dirty).toBe(true)
    store.setBody('two\n', null)
    expect(store.state.dirty).toBe(false)
  })

  test('a move keeps whatever was unsaved before it unsaved', () => {
    store.setBody('typed after the last save\n', null)
    store.afterFiling(['C:/elsewhere/notes.md'])
    expect(store.state.dirty).toBe(true)
    store.setBody('one\n', null)
    expect(store.state.dirty).toBe(false)
  })
})

describe('undo changes the text only, never where the note lives', () => {
  test('undo after a move keeps the new path, so autosave never writes the old one again', () => {
    store.load(loaded('one\n', 'C:/old/notes.md'))
    store.setBody('two\n', null)
    store.commitUndoGroup()
    store.markSaved()
    store.afterFiling(['C:/new/notes.md'])
    store.setFileName('notes.md')
    store.undo()
    expect(store.state.body).toBe('one\n')
    expect(store.state.paths).toEqual(['C:/new/notes.md'])
    expect(store.state.originalPath).toBeUndefined()
    expect(store.state.dirty).toBe(true)
    store.redo()
    expect(store.state.body).toBe('two\n')
    expect(store.state.paths).toEqual(['C:/new/notes.md'])
    expect(store.state.dirty).toBe(false)
  })

  test('undo after a first save remembers the file and its name', () => {
    store.reset()
    store.setBody('# Plan\n', null)
    store.commitUndoGroup()
    store.setBody('# Plan\nmore\n', null)
    store.commitUndoGroup()
    store.afterFiling(['C:/sb/Plan.md'], { written: store.fullText() })
    store.setFileName('Plan.md')
    store.undo()
    expect(store.state.body).toBe('# Plan\n')
    expect(store.state.paths).toEqual(['C:/sb/Plan.md'])
    expect(store.state.fileName).toBe('Plan.md')
    expect(store.state.dirty).toBe(true)
  })

  test('undo after a .txt note was saved as Markdown does not bring plain-text mode back', () => {
    store.load(loaded('first\n', 'C:/downloads/notes.txt'))
    store.setBody('second\n', null)
    store.commitUndoGroup()
    store.afterFiling(['C:/downloads/notes.md'], { written: store.fullText() })
    store.undo()
    expect(store.state.body).toBe('first\n')
    expect(store.state.isPlainText).toBe(false)
    expect(store.state.paths).toEqual(['C:/downloads/notes.md'])
    expect(store.state.originalPath).toBeUndefined()
  })
})

describe('telling one opened note from the next', () => {
  test('loading and resetting change the generation; editing and saving do not', () => {
    const start = store.loadGeneration
    store.load(loaded('one\n'))
    const afterLoad = store.loadGeneration
    expect(afterLoad).not.toBe(start)

    store.setBody('two\n', null)
    store.markSaved()
    store.afterFiling(['C:/sb/notes.md'])
    store.setFileName('other.md')
    expect(store.loadGeneration).toBe(afterLoad)

    store.reset()
    expect(store.loadGeneration).not.toBe(afterLoad)
  })
})

describe('saying when a change came from undo or redo', () => {
  beforeEach(() => store.load(loaded('one\n')))

  test('undo and redo each move the history step, and the snapshot carries it', () => {
    store.setBody('two\n', null)
    store.commitUndoGroup()
    const before = store.historyStep
    expect(store.getSnapshot().historyStep).toBe(before)

    store.undo()
    expect(store.historyStep).toBe(before + 1)
    expect(store.getSnapshot().historyStep).toBe(before + 1)

    store.redo()
    expect(store.historyStep).toBe(before + 2)
    expect(store.getSnapshot().historyStep).toBe(before + 2)
  })

  test('an undo or redo with nothing to step to leaves it alone', () => {
    const before = store.historyStep
    store.undo()
    store.redo()
    expect(store.historyStep).toBe(before)
  })

  test('edits, saving, filing, opening and starting afresh leave it alone', () => {
    store.setBody('two\n', null)
    store.commitUndoGroup()
    store.undo()
    const before = store.historyStep

    store.setFullText('---\ntitle: X\n---\nthree\n', null)
    store.setBody('four\n', null)
    store.setFrontMatter(null, null)
    store.markSaved()
    store.afterFiling(['C:/sb/notes.md'], { written: 'four\n' })
    store.load(loaded('five\n'))
    store.reset()
    expect(store.historyStep).toBe(before)
    expect(store.getSnapshot().historyStep).toBe(before)
  })
})
