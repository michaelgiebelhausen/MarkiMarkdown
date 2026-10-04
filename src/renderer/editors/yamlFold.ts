import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state'
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
 * The span a fold hides: from the opening fence to the end of the closing fence line,
 * not including that line's break. Null when the note has no front matter.
 */
export function foldRange(state: EditorState): { from: number; to: number } | null {
  const { raw } = splitFrontMatter(state.doc.toString())
  if (raw === null || raw.length === 0) return null
  return { from: 0, to: state.doc.lineAt(raw.length - 1).to }
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

const foldConfig = StateField.define<YamlFoldState>({
  create: () => ({ folded: false, broken: false, summary: '' }),
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setYamlFold)) value = effect.value
    return value
  }
})

/** Folds the front matter to one line, or marks it when it is broken. `open` unfolds it. */
export function yamlFold(open: () => void): Extension {
  const build = (state: EditorState): DecorationSet => {
    const config = state.field(foldConfig)
    const range = foldRange(state)
    if (!range) return Decoration.none
    if (config.broken) return Decoration.set([Decoration.line({ class: 'cm-yaml-broken' }).range(0)])
    if (!config.folded) return Decoration.none
    return Decoration.set([
      Decoration.replace({ widget: new SummaryWidget(config.summary, open), block: true }).range(range.from, range.to)
    ])
  }

  // Block-replacing decorations must come from a state field, not a view plugin.
  const decorations = StateField.define<DecorationSet>({
    create: build,
    update: (value, tr) => (tr.docChanged || tr.effects.some((e) => e.is(setYamlFold)) ? build(tr.state) : value),
    provide: (field) => EditorView.decorations.from(field)
  })

  /**
   * The cursor guard keeps the caret below the fold, but Backspace at the start of the body
   * (or a selection reaching into the fold) would still change text nobody can see: it would
   * join the first body line onto the closing fence. Typing, deleting and dropping that touch
   * the hidden range are refused, and the YAML opens so the student sees why. Changes that
   * are not typed (a grid tick, the other pane) pass through.
   */
  const guard = EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged) return tr
    if (!(tr.isUserEvent('input') || tr.isUserEvent('delete') || tr.isUserEvent('move'))) return tr
    const config = tr.startState.field(foldConfig)
    if (!config.folded || config.broken) return tr
    const range = foldRange(tr.startState)
    if (!range) return tr
    let touches = false
    tr.changes.iterChangedRanges((fromA) => {
      if (fromA <= range.to) touches = true
    })
    if (!touches) return tr
    open()
    return []
  })

  return [foldConfig, decorations, guard]
}
