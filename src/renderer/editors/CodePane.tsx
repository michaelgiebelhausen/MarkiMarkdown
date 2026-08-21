import { useEffect, useRef } from 'react'
import { EditorState, Compartment, StateEffect, StateField } from '@codemirror/state'
import { EditorView, keymap, highlightActiveLine, drawSelection, Decoration, ViewPlugin } from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting, HighlightStyle, syntaxTree } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import type { DocumentStore } from '@renderer/state/document'
import type { SyncController } from './sync'

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: 'var(--code)', backgroundColor: 'transparent' },
  '.cm-scroller': {
    fontFamily: 'var(--mono)',
    lineHeight: '1.65',
    padding: '32px 28px 45vh',
    overflowX: 'hidden'
  },
  '.cm-content': { maxWidth: '70ch', margin: '0 auto', caretColor: 'var(--accent)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-line': { padding: '0' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-selectionBackground, ::selection': { backgroundColor: 'var(--accent-soft) !important' },
  '.cm-marki-active': { backgroundColor: 'var(--accent-soft)', borderRadius: '3px' },
  '.cm-marki-frontmatter': { color: 'var(--muted)' }
})

/** Syntax marks stay quiet; the words the student wrote stay loud. */
const highlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: '650', color: 'var(--text)' },
  { tag: tags.strong, fontWeight: '650' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.processingInstruction, color: 'var(--muted)' },
  { tag: tags.list, color: 'var(--muted)' },
  { tag: tags.link, color: 'var(--accent)' },
  { tag: tags.url, color: 'var(--muted)' },
  { tag: tags.monospace, color: 'var(--muted)' },
  { tag: tags.contentSeparator, color: 'var(--muted)' },
  { tag: tags.quote, color: 'var(--muted)' }
])

/**
 * Chromium underlines every "misspelling" including Markdown punctuation and URLs.
 * Turn spell check off for the syntax itself so the red lines only mark real words.
 */
const noSpellcheckOnSyntax = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = this.build(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = this.build(update.view)
    }
    build(view: EditorView): DecorationSet {
      const marks: ReturnType<typeof Decoration.mark>[] = []
      const ranges: { from: number; to: number }[] = []
      const quiet = new Set([
        'URL',
        'InlineCode',
        'CodeText',
        'CodeMark',
        'HeaderMark',
        'EmphasisMark',
        'ListMark',
        'QuoteMark',
        'LinkMark',
        'FencedCode',
        'CodeInfo',
        'HorizontalRule',
        'Table',
        'TableDelimiter'
      ])
      for (const { from, to } of view.visibleRanges) {
        syntaxTree(view.state).iterate({
          from,
          to,
          enter: (node) => {
            if (quiet.has(node.name) && node.to > node.from) ranges.push({ from: node.from, to: node.to })
          }
        })
      }
      void marks
      return Decoration.set(
        ranges.map((r) => Decoration.mark({ attributes: { spellcheck: 'false' } }).range(r.from, r.to)),
        true
      )
    }
  },
  { decorations: (v) => v.decorations }
)

/** Marks the block the cursor is in, so the same words light up on both sides. */
const setActiveRange = StateEffect.define<{ from: number; to: number } | null>()

const activeRangeField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes)
    for (const effect of tr.effects) {
      if (!effect.is(setActiveRange)) continue
      const range = effect.value
      if (!range) {
        next = Decoration.none
        continue
      }
      const from = Math.max(0, Math.min(range.from, tr.state.doc.length))
      const to = Math.max(from, Math.min(range.to, tr.state.doc.length))
      const marks = []
      const first = tr.state.doc.lineAt(from).number
      const last = tr.state.doc.lineAt(to).number
      for (let line = first; line <= last; line++) {
        marks.push(Decoration.line({ class: 'cm-marki-active' }).range(tr.state.doc.line(line).from))
      }
      next = Decoration.set(marks, true)
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field)
})

export interface CodeCommands {
  /** Wraps the selection, or drops a marker at the caret, exactly as typed. */
  wrap: (before: string, after: string) => void
  insert: (text: string) => void
  focus: () => void
}

interface Props {
  store: DocumentStore
  text: string
  sync: SyncController
  onFocusOwner: () => void
  registerCommands: (commands: CodeCommands | null) => void
}

export function CodePane({ store, text, sync, onFocusOwner, registerCommands }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const editable = useRef(new Compartment())

  useEffect(() => {
    if (!host.current) return

    /**
     * Wraps the selection in the given markers, or drops them at the caret.
     * Trailing whitespace is left outside, so selecting a whole line and pressing
     * bold does not strand the closing marker after the line break.
     */
    const wrapWith = (before: string, after: string) => (target: EditorView) => {
      const range = target.state.selection.main
      const raw = target.state.sliceDoc(range.from, range.to)
      const lead = raw.length - raw.trimStart().length
      const trail = raw.length - raw.trimEnd().length
      const from = range.from + lead
      const to = range.to - trail
      const selected = target.state.sliceDoc(from, to)
      target.dispatch({
        changes: { from, to, insert: before + selected + after },
        selection: { anchor: from + before.length, head: from + before.length + selected.length }
      })
      return true
    }

    const state = EditorState.create({
      doc: text,
      extensions: [
        history(),
        // The same shortcuts the menu offers, so they work in this pane too.
        keymap.of([
          { key: 'Mod-b', run: wrapWith('**', '**') },
          { key: 'Mod-i', run: wrapWith('*', '*') }
        ]),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        drawSelection(),
        highlightActiveLine(),
        markdown(),
        syntaxHighlighting(highlight),
        noSpellcheckOnSyntax,
        activeRangeField,
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ spellcheck: 'true', 'aria-label': 'Markdown source' }),
        theme,
        editable.current.of(EditorView.editable.of(true)),
        EditorView.updateListener.of((update) => {
          if (update.focusChanged && update.view.hasFocus) onFocusOwner()
          if (update.docChanged) store.setFullText(update.state.doc.toString(), 'code')
          if (update.selectionSet || update.docChanged) {
            const offset = update.state.selection.main.head - sync.bodyStart
            sync.setActive(sync.blockAtOffset(Math.max(0, offset)))
          }
        })
      ]
    })
    const created = new EditorView({ state, parent: host.current })
    view.current = created

    const onScroll = () => {
      if (!created.hasFocus && document.activeElement !== created.contentDOM) {
        // still report: the student may be scrolling with the wheel, not typing
      }
      const top = created.elementAtHeight(created.scrollDOM.scrollTop)
      const offset = top ? top.from - sync.bodyStart : 0
      sync.reportScroll('code', sync.blockAtOffset(Math.max(0, offset)))
    }
    created.scrollDOM.addEventListener('scroll', onScroll, { passive: true })

    registerCommands({
      wrap(before, after) {
        const range = created.state.selection.main
        const selected = created.state.sliceDoc(range.from, range.to)
        created.dispatch({
          changes: { from: range.from, to: range.to, insert: before + selected + after },
          selection: {
            anchor: range.from + before.length,
            head: range.from + before.length + selected.length
          }
        })
        created.focus()
      },
      insert(value) {
        const range = created.state.selection.main
        created.dispatch({
          changes: { from: range.from, to: range.to, insert: value },
          selection: { anchor: range.from + value.length }
        })
        created.focus()
      },
      focus: () => created.focus()
    })

    const release = sync.register('code', {
      scrollToBlock(index) {
        const target = created.state.doc.length === 0 ? 0 : sync.offsetOfBlock(index)
        const pos = Math.max(0, Math.min(target, created.state.doc.length))
        const block = created.lineBlockAt(pos)
        created.scrollDOM.scrollTo({ top: Math.max(0, block.top - 8) })
      },
      highlight(index) {
        if (index < 0) {
          created.dispatch({ effects: setActiveRange.of(null) })
          return
        }
        const block = sync.blocks[index]
        if (!block) return
        created.dispatch({
          effects: setActiveRange.of({
            from: sync.bodyStart + block.start,
            to: sync.bodyStart + block.end
          })
        })
      }
    })

    return () => {
      release()
      registerCommands(null)
      created.scrollDOM.removeEventListener('scroll', onScroll)
      created.destroy()
      view.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Follow the other pane without disturbing the cursor: replace only what differs.
  useEffect(() => {
    const current = view.current
    if (!current) return
    const existing = current.state.doc.toString()
    if (existing === text) return
    let start = 0
    const max = Math.min(existing.length, text.length)
    while (start < max && existing[start] === text[start]) start += 1
    let endOld = existing.length
    let endNew = text.length
    while (endOld > start && endNew > start && existing[endOld - 1] === text[endNew - 1]) {
      endOld -= 1
      endNew -= 1
    }
    current.dispatch({
      changes: { from: start, to: endOld, insert: text.slice(start, endNew) },
      scrollIntoView: false
    })
  }, [text])

  return <div className="cm-host" ref={host} />
}
