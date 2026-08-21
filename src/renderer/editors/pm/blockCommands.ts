import { setBlockType, wrapIn, lift } from 'prosemirror-commands'
import type { Command, EditorState, Transaction } from 'prosemirror-state'
import type { NodeType } from 'prosemirror-model'
import { schema } from './schema'
import type { BlockKind } from '../BubbleMenu'

type Dispatch = ((tr: Transaction) => void) | undefined

/** Which of the bubble menu's block choices the cursor is currently sitting in. */
export function currentBlockKind(state: EditorState): BlockKind {
  const $from = state.selection.$from
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (node.type === schema.nodes.list_item) {
      if (node.attrs.checked !== null && node.attrs.checked !== undefined) return 'task'
      const parent = $from.node(depth - 1)
      return parent.type === schema.nodes.ordered_list ? 'ordered' : 'bullet'
    }
  }
  const block = $from.parent
  if (block.type === schema.nodes.heading) {
    const level = Number(block.attrs.level)
    return level <= 1 ? 'h1' : level === 2 ? 'h2' : 'h3'
  }
  return 'paragraph'
}

function liftOutOfList(state: EditorState, dispatch: Dispatch): boolean {
  const $from = state.selection.$from
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type === schema.nodes.list_item) return lift(state, dispatch)
  }
  return false
}

/** Wraps the current block in a list, or retypes the list it is already in. */
function toList(listType: NodeType, checked: boolean | null): Command {
  return (state, dispatch) => {
    const $from = state.selection.$from
    for (let depth = $from.depth; depth > 0; depth--) {
      if ($from.node(depth) !== undefined && $from.node(depth).type === schema.nodes.list_item) {
        const itemPos = $from.before(depth)
        const listPos = $from.before(depth - 1)
        const list = $from.node(depth - 1)
        const item = $from.node(depth)
        if (!dispatch) return true
        const tr = state.tr
        if (list.type !== listType) tr.setNodeMarkup(listPos, listType, listType === schema.nodes.ordered_list ? { start: 1 } : null)
        tr.setNodeMarkup(tr.mapping.map(itemPos), undefined, { ...item.attrs, checked })
        dispatch(tr)
        return true
      }
    }
    return wrapIn(listType)(state, (tr) => {
      if (!dispatch) return
      // a freshly wrapped item needs its checked attribute set for a checklist
      const wrapped = tr.selection.$from
      for (let depth = wrapped.depth; depth > 0; depth--) {
        if (wrapped.node(depth).type === schema.nodes.list_item) {
          const pos = wrapped.before(depth)
          tr.setNodeMarkup(pos, undefined, { ...wrapped.node(depth).attrs, checked })
          break
        }
      }
      dispatch(tr)
    })
  }
}

export function blockCommand(kind: BlockKind): Command {
  switch (kind) {
    case 'paragraph':
      return (state, dispatch) =>
        liftOutOfList(state, dispatch) || setBlockType(schema.nodes.paragraph)(state, dispatch)
    case 'h1':
    case 'h2':
    case 'h3': {
      const level = Number(kind.slice(1))
      return (state, dispatch) => {
        liftOutOfList(state, dispatch)
        return setBlockType(schema.nodes.heading, { level })(state, dispatch)
      }
    }
    case 'bullet':
      return toList(schema.nodes.bullet_list, null)
    case 'ordered':
      return toList(schema.nodes.ordered_list, null)
    case 'task':
      return toList(schema.nodes.bullet_list, false)
    default:
      return () => false
  }
}
