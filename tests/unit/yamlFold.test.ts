import { describe, expect, it } from 'vitest'
import { EditorState, type Transaction } from '@codemirror/state'
import {
  foldRange,
  fromStore,
  hiddenRange,
  requestOpen,
  yamlFold,
  yamlFoldConfig,
  type YamlFoldState
} from '@renderer/editors/yamlFold'

const YAML = '---\nskills: [librarian]\ntags: [a]\n---\n'
const NOTE = `${YAML}# Note\n\nBody.\n`
/** The first position of the body: just after the closing fence's line break. */
const BODY = YAML.length
/** The end of the closing fence line, the last position the fold hides. */
const FENCE_END = YAML.length - 1

const FOLDED: YamlFoldState = { folded: true, broken: false, summary: 'YAML · 1 skill' }

function stateFor(doc: string, config: YamlFoldState = FOLDED, opened: { count: number } = { count: 0 }) {
  return EditorState.create({ doc, extensions: [yamlFold(() => (opened.count += 1), config)] })
}

const asksToOpen = (tr: Transaction) => tr.effects.some((e) => e.is(requestOpen))

describe('foldRange', () => {
  it('spans the front matter up to the end of the closing fence line', () => {
    expect(foldRange(stateFor(NOTE))).toEqual({ from: 0, to: FENCE_END })
  })

  it('is null without front matter', () => {
    expect(foldRange(stateFor('# Note\n'))).toBeNull()
  })

  it('parses each document once', () => {
    const state = stateFor(NOTE)
    const first = foldRange(state)
    // A selection change keeps the same immutable doc, so the cached answer comes back.
    const moved = state.update({ selection: { anchor: BODY + 2 } }).state
    expect(moved.doc).toBe(state.doc)
    expect(foldRange(moved)).toBe(first)
    // A new doc is parsed afresh.
    const typed = moved.update({ changes: { from: BODY, insert: 'x' } }).state
    expect(foldRange(typed)).not.toBe(first)
    expect(foldRange(typed)).toEqual(first)
  })
})

describe('hiddenRange', () => {
  it('is the front matter while folded', () => {
    expect(hiddenRange(stateFor(NOTE))).toEqual({ from: 0, to: FENCE_END })
  })

  it('is null when open or broken', () => {
    expect(hiddenRange(stateFor(NOTE, { ...FOLDED, folded: false }))).toBeNull()
    expect(hiddenRange(stateFor(NOTE, { ...FOLDED, broken: true }))).toBeNull()
  })

  it('never folds a note that is only front matter with no line after it', () => {
    const state = stateFor('---\nskills: [librarian]\n---')
    expect(foldRange(state)).not.toBeNull()
    expect(hiddenRange(state)).toBeNull()
    // Nothing is hidden, so typing at the very end is allowed.
    const tr = state.update({ changes: { from: state.doc.length, insert: '\n' }, userEvent: 'input.type' })
    expect(tr.docChanged).toBe(true)
  })

  it('still folds front matter followed by an empty line', () => {
    expect(hiddenRange(stateFor(YAML))).toEqual({ from: 0, to: FENCE_END })
  })

  it('starts from the configuration it was given, with no flash of open YAML', () => {
    expect(yamlFoldConfig(stateFor(NOTE))).toEqual(FOLDED)
  })
})

describe('the fold guard', () => {
  it('refuses typing inside the hidden YAML, keeps the selection and asks to open', () => {
    const state = stateFor(NOTE).update({ selection: { anchor: 5 } }).state
    const tr = state.update({ changes: { from: 5, insert: 'x' }, userEvent: 'input.type' })
    expect(tr.docChanged).toBe(false)
    expect(tr.state.doc.toString()).toBe(NOTE)
    expect(tr.state.selection.main.head).toBe(5)
    expect(asksToOpen(tr)).toBe(true)
  })

  it('refuses Backspace at the start of the body, which would join it to the fence', () => {
    const tr = stateFor(NOTE).update({ changes: { from: FENCE_END, to: BODY }, userEvent: 'delete.backward' })
    expect(tr.docChanged).toBe(false)
    expect(asksToOpen(tr)).toBe(true)
  })

  it('refuses changes with no user event too, like the menu commands', () => {
    const tr = stateFor(NOTE).update({ changes: { from: 0, to: BODY, insert: '' } })
    expect(tr.docChanged).toBe(false)
    expect(asksToOpen(tr)).toBe(true)
  })

  it('lets typing in the body through untouched', () => {
    const tr = stateFor(NOTE).update({ changes: { from: BODY, insert: 'x' }, userEvent: 'input.type' })
    expect(tr.state.doc.toString()).toBe(`${YAML}x# Note\n\nBody.\n`)
    expect(asksToOpen(tr)).toBe(false)
  })

  it('lets undo and redo put back hidden text, and asks to open', () => {
    for (const userEvent of ['undo', 'redo']) {
      const tr = stateFor(NOTE).update({ changes: { from: 4, to: 10, insert: 'title' }, userEvent })
      expect(tr.docChanged).toBe(true)
      expect(asksToOpen(tr)).toBe(true)
    }
  })

  it("lets a step through the store's history pass, and asks to open", () => {
    const tr = stateFor(NOTE).update({ changes: { from: 4, insert: 'x' }, annotations: fromStore.of('history') })
    expect(tr.docChanged).toBe(true)
    expect(asksToOpen(tr)).toBe(true)
  })

  it("lets the store's echo pass untouched, without opening", () => {
    const tr = stateFor(NOTE).update({
      changes: { from: 4, insert: 'domains: [thesis]\n' },
      annotations: fromStore.of('echo')
    })
    expect(tr.state.doc.toString()).toBe(`---\ndomains: [thesis]\n${NOTE.slice(4)}`)
    expect(asksToOpen(tr)).toBe(false)
  })

  it('cuts a select-all back to the body and asks to open, so typing keeps the YAML', () => {
    const state = stateFor(NOTE)
    const selectAll = state.update({ selection: { anchor: 0, head: state.doc.length }, userEvent: 'select' })
    expect(asksToOpen(selectAll)).toBe(true)
    expect(selectAll.state.selection.main.from).toBe(BODY)
    expect(selectAll.state.selection.main.to).toBe(state.doc.length)

    const typed = selectAll.state.update(selectAll.state.replaceSelection('X'), { userEvent: 'input.type' })
    expect(typed.state.doc.toString()).toBe(`${YAML}X`)
  })

  it('refuses typing over a selection that already covers hidden text', () => {
    const state = stateFor(NOTE).update({ selection: { anchor: 0, head: NOTE.length } }).state
    const tr = state.update(state.replaceSelection('X'), { userEvent: 'input.type' })
    expect(tr.docChanged).toBe(false)
    expect(tr.state.doc.toString()).toBe(NOTE)
    expect(asksToOpen(tr)).toBe(true)
  })

  it('asks to open when the cursor moves into the fold, like Ctrl+Home', () => {
    const state = stateFor(NOTE).update({ selection: { anchor: BODY } }).state
    const home = state.update({ selection: { anchor: 0 }, userEvent: 'select' })
    expect(home.state.selection.main.head).toBe(0)
    expect(asksToOpen(home)).toBe(true)
  })

  it('does not ask to open when the cursor stays in the body', () => {
    const tr = stateFor(NOTE).update({ selection: { anchor: BODY + 2 }, userEvent: 'select' })
    expect(asksToOpen(tr)).toBe(false)
  })

  it('lets everything through while the YAML is open', () => {
    const tr = stateFor(NOTE, { ...FOLDED, folded: false }).update({
      changes: { from: 5, insert: 'x' },
      userEvent: 'input.type'
    })
    expect(tr.docChanged).toBe(true)
    expect(asksToOpen(tr)).toBe(false)
  })
})
