import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorState, Plugin, PluginKey, TextSelection } from 'prosemirror-state'
import { EditorView, Decoration, DecorationSet } from 'prosemirror-view'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap, toggleMark, chainCommands, exitCode } from 'prosemirror-commands'
import { schema } from './pm/schema'
import { BubbleMenu, type BubbleState, type BlockKind } from './BubbleMenu'
import { blockCommand, currentBlockKind } from './pm/blockCommands'
import { parseMarkdown, patchMarkdownDetailed, type ParsedDoc } from './pm/bridge'
import { markiInputRules } from './pm/inputRules'
import { renderVerbatim } from './pm/render'
import type { DocumentStore } from '@renderer/state/document'
import type { SyncController } from './sync'

/** Read-only view of anything the clean pane will not let you edit. */
class VerbatimView {
  dom: HTMLElement
  constructor(node: import('prosemirror-model').Node) {
    const wrap = document.createElement('div')
    wrap.className = 'raw-block'
    wrap.setAttribute('contenteditable', 'false')
    wrap.title = 'Edit this on the left'
    const html = renderVerbatim(String(node.attrs.value))
    if (html) wrap.innerHTML = html
    else wrap.textContent = String(node.attrs.value)
    this.dom = wrap
  }
  stopEvent() {
    return true
  }
  ignoreMutation() {
    return true
  }
}

class VerbatimInlineView {
  dom: HTMLElement
  constructor(node: import('prosemirror-model').Node) {
    const span = document.createElement('span')
    span.className = 'raw-inline'
    span.setAttribute('contenteditable', 'false')
    span.title = 'Edit this on the left'
    span.textContent = String(node.attrs.value)
    this.dom = span
  }
  stopEvent() {
    return true
  }
  ignoreMutation() {
    return true
  }
}

/** The tick box is drawn by CSS, so a click lands on the list item itself. */
const BOX_WIDTH = 24

const checklistPlugin = new Plugin({
  props: {
    handleClick(view, pos, event) {
      const $pos = view.state.doc.resolve(pos)
      let itemPos = -1
      for (let depth = $pos.depth; depth > 0; depth--) {
        if ($pos.node(depth).type === schema.nodes.list_item) {
          itemPos = $pos.before(depth)
          break
        }
      }
      if (itemPos < 0) return false

      const node = view.state.doc.nodeAt(itemPos)
      if (!node || node.attrs.checked === null || node.attrs.checked === undefined) return false

      const dom = view.nodeDOM(itemPos)
      if (!(dom instanceof HTMLElement)) return false
      const rect = dom.getBoundingClientRect()
      const mouse = event as MouseEvent
      if (mouse.clientX > rect.left + BOX_WIDTH) return false

      view.dispatch(
        view.state.tr.setNodeMarkup(itemPos, undefined, { ...node.attrs, checked: !node.attrs.checked })
      )
      return true
    }
  }
})

/** The same tint the code pane draws, on the matching block. */
const activeKey = new PluginKey<number>('marki-active-block')

const activeBlockPlugin = new Plugin<number>({
  key: activeKey,
  state: {
    init: () => -1,
    apply(tr, value) {
      const next = tr.getMeta(activeKey)
      return typeof next === 'number' ? next : value
    }
  },
  props: {
    decorations(state) {
      const index = activeKey.getState(state)
      if (index === undefined || index < 0 || index >= state.doc.childCount) return DecorationSet.empty
      let pos = 0
      for (let i = 0; i < index; i++) pos += state.doc.child(i).nodeSize
      const node = state.doc.child(index)
      return DecorationSet.create(state.doc, [
        Decoration.node(pos, pos + node.nodeSize, { class: 'pm-active' })
      ])
    }
  }
})

interface Props {
  store: DocumentStore
  body: string
  version: number
  sync: SyncController
  onFocusOwner: () => void
  registerCommands: (commands: RenderedCommands | null) => void
  /** Electron has no window.prompt, so the app asks for the address for us. */
  onRequestLink: () => void
}

export interface RenderedCommands {
  toggleStrong: () => void
  toggleEm: () => void
  toggleCode: () => void
  setLink: (href: string) => void
  focus: () => void
  /** Put the cursor in the block the other pane is sitting in. */
  jumpToActive: () => void
  /** Inserts text with no formatting, for Paste as Plain Text. */
  insertPlain: (text: string) => void
  removeLink: () => void
}

export function RenderedPane({
  store,
  body,
  version,
  sync,
  onFocusOwner,
  registerCommands,
  onRequestLink
}: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const parsed = useRef<ParsedDoc | null>(null)
  const [bubble, setBubble] = useState<BubbleState | null>(null)

  /** Shows the formatting bubble over the selection, or hides it when there is none. */
  const refreshBubble = useCallback((editor: EditorView) => {
    const { selection } = editor.state
    if (selection.empty || !editor.hasFocus()) {
      setBubble(null)
      return
    }
    const start = editor.coordsAtPos(selection.from)
    const end = editor.coordsAtPos(selection.to)
    const marks = editor.state.storedMarks ?? selection.$from.marks()
    const has = (name: keyof typeof schema.marks) =>
      schema.marks[name].isInSet(marks) !== undefined ||
      editor.state.doc.rangeHasMark(selection.from, selection.to, schema.marks[name])
    setBubble({
      left: Math.round((Math.min(start.left, end.left) + Math.max(start.right, end.right)) / 2),
      top: Math.round(Math.min(start.top, end.top)) - 10,
      strong: has('strong'),
      em: has('em'),
      code: has('code'),
      link: has('link'),
      block: currentBlockKind(editor.state)
    })
  }, [])

  useEffect(() => {
    if (!host.current) return

    const initial = parseMarkdown(body)
    parsed.current = initial

    const state = EditorState.create({
      doc: initial.doc,
      plugins: [
        markiInputRules(schema),
        checklistPlugin,
        activeBlockPlugin,
        keymap({
          'Mod-b': toggleMark(schema.marks.strong),
          'Mod-i': toggleMark(schema.marks.em),
          'Shift-Enter': chainCommands(exitCode, (state, dispatch) => {
            if (dispatch) dispatch(state.tr.insertText('\n'))
            return true
          })
        }),
        keymap(baseKeymap)
      ]
    })

    const created = new EditorView(host.current, {
      state,
      attributes: { spellcheck: 'true', 'aria-label': 'Readable text', class: 'pm-content' },
      nodeViews: {
        raw_block: (node) => new VerbatimView(node),
        raw_inline: (node) => new VerbatimInlineView(node)
      },
      dispatchTransaction(transaction) {
        const next = created.state.apply(transaction)
        created.updateState(next)
        if (transaction.selectionSet || transaction.docChanged) {
          const $head = next.selection.$head
          sync.setActive($head.depth === 0 ? Math.max(0, $head.index(0) - 1) : $head.index(0))
          refreshBubble(created)
        }
        if (!transaction.docChanged) return
        const current = parsed.current
        if (!current) return
        const patched = patchMarkdownDetailed(current, next.doc)
        // Pin the block map to the node objects now in the editor, so the next
        // keystroke still knows which blocks are untouched.
        parsed.current = { doc: next.doc, blocks: patched.blocks, src: patched.text }
        sync.setBlocks(patched.blocks, store.state.frontMatterRaw?.length ?? 0)
        store.setBody(patched.text, 'rendered')
      },
      handleDOMEvents: {
        focus: () => {
          onFocusOwner()
          return false
        },
        blur: () => {
          setBubble(null)
          return false
        }
      },
      handleScrollToSelection: () => false
    })

    view.current = created
    sync.setBlocks(initial.blocks, store.state.frontMatterRaw?.length ?? 0)

    const indexAtPos = (pos: number): number => {
      const $pos = created.state.doc.resolve(Math.max(0, Math.min(pos, created.state.doc.content.size)))
      return $pos.depth === 0 ? Math.max(0, $pos.index(0) - 1) : $pos.index(0)
    }

    const onScroll = () => {
      setBubble(null)
      const box = created.dom.getBoundingClientRect()
      const at = created.posAtCoords({ left: box.left + 12, top: box.top + 4 })
      if (at) sync.reportScroll('rendered', indexAtPos(at.pos))
    }
    const scroller = created.dom.closest('.pane') ?? created.dom
    scroller.addEventListener('scroll', onScroll, { passive: true })

    const release = sync.register('rendered', {
      scrollToBlock(index) {
        const doc = created.state.doc
        if (index < 0 || index >= doc.childCount) return
        let pos = 0
        for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize
        const dom = created.nodeDOM(pos)
        if (dom instanceof HTMLElement) dom.scrollIntoView({ block: 'start' })
      },
      highlight(index) {
        created.dispatch(created.state.tr.setMeta(activeKey, index))
      }
    })

    registerCommands({
      toggleStrong: () => runCommand(created, toggleMark(schema.marks.strong)),
      toggleEm: () => runCommand(created, toggleMark(schema.marks.em)),
      toggleCode: () => runCommand(created, toggleMark(schema.marks.code)),
      setLink: (href: string) => runCommand(created, toggleMark(schema.marks.link, { href })),
      focus: () => created.focus(),
      removeLink: () => {
        const { from, to } = created.state.selection
        created.dispatch(created.state.tr.removeMark(from, to, schema.marks.link))
        created.focus()
      },
      insertPlain: (value: string) => {
        created.dispatch(created.state.tr.insertText(value))
        created.focus()
      },
      jumpToActive: () => {
        const index = sync.activeBlock
        const doc = created.state.doc
        if (index < 0 || index >= doc.childCount) {
          created.focus()
          return
        }
        let pos = 0
        for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize
        const selection = TextSelection.near(doc.resolve(Math.min(pos + 1, doc.content.size)))
        created.dispatch(created.state.tr.setSelection(selection).scrollIntoView())
        created.focus()
      }
    })

    return () => {
      release()
      scroller.removeEventListener('scroll', onScroll)
      registerCommands(null)
      created.destroy()
      view.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The other pane changed the text: rebuild from markdown, which is the source of truth.
  useEffect(() => {
    const current = view.current
    if (!current) return
    // Our own edit coming back round: the editor already shows it.
    if (parsed.current && parsed.current.src === body) return

    const rebuild = () => {
      const live = view.current
      if (!live) return
      const next = parseMarkdown(body)
      parsed.current = next
      sync.setBlocks(next.blocks, store.state.frontMatterRaw?.length ?? 0)
      live.updateState(EditorState.create({ doc: next.doc, plugins: live.state.plugins }))
    }

    // Re-parsing a long note on every keystroke makes the left pane feel sticky.
    // Above a few tens of kilobytes, wait for a pause in typing instead.
    const delay = body.length > 120000 ? 350 : body.length > 40000 ? 140 : 0
    if (delay === 0) {
      rebuild()
      return
    }
    const timer = window.setTimeout(rebuild, delay)
    return () => window.clearTimeout(timer)
  }, [body, version])

  const runBlock = (kind: BlockKind) => {
    const editor = view.current
    if (!editor) return
    blockCommand(kind)(editor.state, editor.dispatch)
    editor.focus()
  }

  return (
    <>
      <div className="pm-host" ref={host} />
      {bubble && (
        <BubbleMenu
          state={bubble}
          view={view.current}
          onMark={(name) => {
            const editor = view.current
            if (!editor) return
            runCommand(editor, toggleMark(schema.marks[name]))
          }}
          onLink={onRequestLink}
          onBlock={runBlock}
        />
      )}
    </>
  )
}

function runCommand(view: EditorView, command: (state: EditorState, dispatch?: EditorView['dispatch']) => boolean) {
  command(view.state, view.dispatch)
  view.focus()
}
