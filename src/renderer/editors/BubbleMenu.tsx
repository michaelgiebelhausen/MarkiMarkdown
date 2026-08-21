import type { EditorView } from 'prosemirror-view'

export interface BubbleState {
  left: number
  top: number
  strong: boolean
  em: boolean
  code: boolean
  link: boolean
  block: string
}

interface Props {
  state: BubbleState
  view: EditorView | null
  onMark: (name: 'strong' | 'em' | 'code') => void
  onLink: () => void
  onBlock: (kind: BlockKind) => void
}

export type BlockKind = 'paragraph' | 'h1' | 'h2' | 'h3' | 'bullet' | 'ordered' | 'task'

const BLOCKS: { kind: BlockKind; label: string; title: string }[] = [
  { kind: 'paragraph', label: 'T', title: 'Plain text' },
  { kind: 'h1', label: 'H1', title: 'Big heading' },
  { kind: 'h2', label: 'H2', title: 'Heading' },
  { kind: 'h3', label: 'H3', title: 'Small heading' },
  { kind: 'bullet', label: '\u2022', title: 'Bullet list' },
  { kind: 'ordered', label: '1.', title: 'Numbered list' },
  { kind: 'task', label: '\u2611', title: 'Checklist' }
]

export function BubbleMenu({ state, onMark, onLink, onBlock }: Props) {
  // mousedown must not steal focus from the editor, or the command has no selection
  const hold = (event: React.MouseEvent) => event.preventDefault()

  return (
    <div className="bubble" style={{ left: state.left, top: state.top }} onMouseDown={hold} role="toolbar">
      <button
        className={state.strong ? 'bubble-btn on' : 'bubble-btn'}
        title="Bold"
        onClick={() => onMark('strong')}
      >
        <strong>B</strong>
      </button>
      <button
        className={state.em ? 'bubble-btn on' : 'bubble-btn'}
        title="Italic"
        onClick={() => onMark('em')}
      >
        <em>I</em>
      </button>
      <button
        className={state.code ? 'bubble-btn on' : 'bubble-btn'}
        title="Code"
        onClick={() => onMark('code')}
      >
        <code>{'<>'}</code>
      </button>
      <button className={state.link ? 'bubble-btn on' : 'bubble-btn'} title="Link" onClick={onLink}>
        &#128279;
      </button>

      <span className="bubble-sep" />

      {BLOCKS.map((block) => (
        <button
          key={block.kind}
          className={state.block === block.kind ? 'bubble-btn on' : 'bubble-btn'}
          title={block.title}
          onClick={() => onBlock(block.kind)}
        >
          {block.label}
        </button>
      ))}
    </div>
  )
}
