import {
  Annotation,
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
  Transaction,
  type ChangeSet,
  type Extension,
  type SelectionRange,
  type Text
} from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { splitFrontMatter } from '@shared/markdown/frontmatter'

export interface YamlFoldState {
  /** The student wants the YAML folded. */
  folded: boolean
  /** The YAML cannot be parsed: never fold it, mark it instead. */
  broken: boolean
  /** The folded line's text, like "YAML · 2 skills · 1 domain · 4 tags". */
  summary: string
}

export const setYamlFold = StateEffect.define<YamlFoldState>()

/**
 * Marks a change that arrives from the document store (the grid, the other pane, a file
 * being opened), so it is never refused: the store already holds it. 'history' is a step
 * through the store's own undo history, which is let through but opens the YAML when it
 * changes hidden text, exactly like an undo typed in this pane.
 */
export const fromStore = Annotation.define<'echo' | 'history'>()

/**
 * Asks for the YAML to be opened. Added to a transaction instead of opening straight away,
 * so the request is acted on after the update, never from inside a filter.
 */
export const requestOpen = StateEffect.define<null>()

type Span = { from: number; to: number }

/** Docs are immutable, so one parse per doc serves every caller on every keystroke. */
const spans = new WeakMap<Text, Span | null>()

/**
 * The span the front matter takes: from the opening fence to the end of the closing fence
 * line, not including that line's break. Null when the note has no front matter.
 */
export function foldRange(state: EditorState): Span | null {
  const doc = state.doc
  const cached = spans.get(doc)
  if (cached !== undefined) return cached
  const { raw } = splitFrontMatter(doc.toString())
  const span = raw === null || raw.length === 0 ? null : { from: 0, to: doc.lineAt(raw.length - 1).to }
  spans.set(doc, span)
  return span
}

const foldConfig = StateField.define<YamlFoldState>({
  create: () => ({ folded: false, broken: false, summary: '' }),
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setYamlFold)) value = effect.value
    return value
  }
})

/** The fold settings the editor is drawing with right now. */
export function yamlFoldConfig(state: EditorState): YamlFoldState {
  return state.field(foldConfig, false) ?? { folded: false, broken: false, summary: '' }
}

/**
 * What the fold hides right now, or null when nothing is hidden. A note that is only front
 * matter, with no line after the closing fence, is never folded: there would be nowhere
 * left to put the cursor.
 */
export function hiddenRange(state: EditorState): Span | null {
  const config = yamlFoldConfig(state)
  if (!config.folded || config.broken) return null
  const range = foldRange(state)
  if (!range || range.to >= state.doc.length) return null
  return range
}

function changesTouch(changes: ChangeSet, range: Span): boolean {
  let touches = false
  changes.iterChangedRanges((fromA) => {
    if (fromA <= range.to) touches = true
  })
  return touches
}

function isHistory(tr: Transaction): boolean {
  return tr.annotation(fromStore) === 'history' || tr.isUserEvent('undo') || tr.isUserEvent('redo')
}

class SummaryWidget extends WidgetType {
  constructor(
    readonly summary: string,
    readonly open: () => void
  ) {
    super()
  }

  eq(other: SummaryWidget): boolean {
    return other.summary === this.summary
  }

  toDOM(): HTMLElement {
    const el = document.createElement('div')
    el.className = 'cm-yaml-summary'
    el.textContent = `▸ ${this.summary}`
    el.title = 'Show the YAML'
    el.addEventListener('mousedown', (event) => {
      event.preventDefault()
      this.open()
    })
    return el
  }

  ignoreEvent(): boolean {
    return true
  }
}

/**
 * Folds the front matter to one line, or marks it when it is broken. `open` unfolds it;
 * `initial` is the fold to draw from the first frame, so a folded note never flashes open.
 */
export function yamlFold(
  open: () => void,
  initial: YamlFoldState = { folded: false, broken: false, summary: '' }
): Extension {
  const build = (state: EditorState): DecorationSet => {
    const config = yamlFoldConfig(state)
    const range = foldRange(state)
    if (!range) return Decoration.none
    if (config.broken) return Decoration.set([Decoration.line({ class: 'cm-yaml-broken' }).range(0)])
    const hidden = hiddenRange(state)
    if (!hidden) return Decoration.none
    return Decoration.set([
      Decoration.replace({ widget: new SummaryWidget(config.summary, open), block: true }).range(
        hidden.from,
        hidden.to
      )
    ])
  }

  // Block-replacing decorations must come from a state field, not a view plugin.
  const decorations = StateField.define<DecorationSet>({
    create: build,
    update: (value, tr) => (tr.docChanged || tr.effects.some((e) => e.is(setYamlFold)) ? build(tr.state) : value),
    provide: (field) => EditorView.decorations.from(field)
  })

  /**
   * Nothing changes text nobody can see. A change that reaches into the folded YAML is
   * refused and the YAML opens, so the student sees why: typing, deleting, dropping,
   * pasting, the menu's wrap and insert, anything at all. Only two kinds pass:
   *  - the store's own changes (a grid tick, the other pane, a file opening), which the
   *    store already holds and must never be refused;
   *  - undo and redo, which put back what was there, and open the YAML as they do.
   *
   * A selection that reaches into the fold (Ctrl+A, Shift+Ctrl+Home, a drag) is cut back to
   * the start of the body and the YAML opens, so the next keystroke replaces only what the
   * student could see when they made the selection.
   */
  const guard = EditorState.transactionFilter.of((tr) => {
    if (tr.annotation(fromStore) === 'echo') return tr
    const range = hiddenRange(tr.startState)
    if (!range) return tr

    if (tr.docChanged) {
      if (!changesTouch(tr.changes, range) || isHistory(tr)) return tr
      // Keep the document and the selection as they were; only ask for the YAML.
      return { effects: requestOpen.of(null) }
    }

    if (tr.selection && tr.isUserEvent('select')) {
      const selection = tr.newSelection
      const reaches = (r: SelectionRange) => !r.empty && r.from <= range.to
      if (!selection.ranges.some(reaches)) return tr
      const below = range.to + 1
      const clamp = (pos: number) => (pos <= range.to ? below : pos)
      const ranges = selection.ranges.map((r) => (reaches(r) ? EditorSelection.range(clamp(r.anchor), clamp(r.head)) : r))
      return {
        selection: EditorSelection.create(ranges, selection.mainIndex),
        effects: [...tr.effects, requestOpen.of(null)],
        scrollIntoView: tr.scrollIntoView,
        userEvent: tr.annotation(Transaction.userEvent)
      }
    }
    return tr
  })

  /**
   * The changes that may pass but still touch the fold ask for it to open: an undo or redo
   * that puts back hidden text, and a cursor moved into it (Ctrl+Home, find, arrow keys).
   * Extenders run after the filter, on every transaction.
   *
   * CodeMirror may run an extender twice on one transaction: when a filter (like the guard
   * above) hands back a new spec, that spec is resolved with the extenders, and the result
   * is then extended again. So this must stay idempotent: asking to open twice is the same
   * as asking once, and it must never add anything that would differ the second time.
   */
  const askToOpen = EditorState.transactionExtender.of((tr) => {
    if (tr.annotation(fromStore) === 'echo') return null
    const range = hiddenRange(tr.startState)
    if (!range) return null
    if (tr.docChanged && isHistory(tr) && changesTouch(tr.changes, range)) return { effects: requestOpen.of(null) }
    if (!tr.docChanged && tr.selection && tr.isUserEvent('select')) {
      if (tr.newSelection.ranges.some((r) => r.from <= range.to)) return { effects: requestOpen.of(null) }
    }
    return null
  })

  const opener = EditorView.updateListener.of((update) => {
    if (update.transactions.some((tr) => tr.effects.some((e) => e.is(requestOpen)))) open()
  })

  return [foldConfig.init(() => initial), decorations, guard, askToOpen, opener]
}
