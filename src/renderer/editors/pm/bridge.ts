import { Node as PMNode, Mark } from 'prosemirror-model'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { toMarkdown } from 'mdast-util-to-markdown'
import { gfmTaskListItemToMarkdown } from 'mdast-util-gfm-task-list-item'
import { schema } from './schema'

type MdNode = { type: string; [key: string]: unknown }

export interface Block {
  start: number
  end: number
}

export interface ParsedDoc {
  doc: PMNode
  blocks: Block[]
  src: string
}

const processor = unified().use(remarkParse).use(remarkGfm)

const TO_MARKDOWN_OPTIONS = {
  bullet: '-' as const,
  emphasis: '*' as const,
  strong: '*' as const,
  listItemIndent: 'one' as const,
  rule: '-' as const,
  fences: true,
  incrementListMarker: true,
  extensions: [gfmTaskListItemToMarkdown()]
}

const NEWLINE = String.fromCharCode(10)
const TAB = String.fromCharCode(9)

const WIKILINK = /\[\[[^\]\n]+\]\]/g

/**
 * The source text of a node, dedented to stand on its own.
 *
 * A node inside a list item starts after the item's indentation, so the first line
 * of the slice has none but every later line still carries it. Left as-is, the
 * serialiser indents the block again and the inner lines drift right on the first
 * edit. Strip the node's own indentation so re-indenting puts it back exactly.
 */
function sliceOf(node: MdNode, src: string): string {
  const pos = node.position as
    | { start: { offset: number; column?: number }; end: { offset: number } }
    | undefined
  if (!pos) return ''
  const raw = src.slice(pos.start.offset, pos.end.offset)
  const indent = (pos.start.column ?? 1) - 1
  if (indent <= 0 || !raw.includes(NEWLINE)) return raw
  return raw
    .split(NEWLINE)
    .map((line, index) => (index === 0 ? line : dropIndent(line, indent)))
    .join(NEWLINE)
}

function dropIndent(line: string, max: number): string {
  let cut = 0
  while (cut < max && (line[cut] === ' ' || line[cut] === TAB)) cut += 1
  return line.slice(cut)
}

/* ------------------------------------------------------------------ *
 * markdown -> ProseMirror
 * ------------------------------------------------------------------ */

/** Splits literal text so that `[[wikilinks]]` become atoms and are never escaped. */
function textWithWikilinks(value: string): PMNode[] {
  const out: PMNode[] = []
  let last = 0
  WIKILINK.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = WIKILINK.exec(value)) !== null) {
    if (match.index > last) out.push(schema.text(value.slice(last, match.index)))
    out.push(schema.nodes.raw_inline.create({ value: match[0] }))
    last = match.index + match[0].length
  }
  if (last < value.length) out.push(schema.text(value.slice(last)))
  return out
}

function withMark(nodes: PMNode[], mark: Mark): PMNode[] {
  return nodes.map((n) => (n.isText || n.type === schema.nodes.raw_inline ? n.mark(mark.addToSet(n.marks)) : n))
}

function inlineFrom(node: MdNode, src: string): PMNode[] {
  switch (node.type) {
    case 'text':
      return textWithWikilinks(String(node.value))
    case 'strong':
      return withMark(inlineChildren(node, src), schema.marks.strong.create())
    case 'emphasis':
      return withMark(inlineChildren(node, src), schema.marks.em.create())
    case 'inlineCode':
      return [schema.text(String(node.value), [schema.marks.code.create()])]
    case 'link': {
      const mark = schema.marks.link.create({
        href: String(node.url ?? ''),
        title: (node.title as string | null) ?? null
      })
      return withMark(inlineChildren(node, src), mark)
    }
    default: {
      const value = sliceOf(node, src)
      if (value === '') return []
      return [schema.nodes.raw_inline.create({ value })]
    }
  }
}

function inlineChildren(node: MdNode, src: string): PMNode[] {
  const kids = (node.children as MdNode[] | undefined) ?? []
  const out: PMNode[] = []
  for (const kid of kids) out.push(...inlineFrom(kid, src))
  return out
}

function listItemFrom(node: MdNode, src: string): PMNode {
  const kids = (node.children as MdNode[] | undefined) ?? []
  const blocks: PMNode[] = []
  for (const kid of kids) blocks.push(blockFrom(kid, src))
  if (blocks.length === 0) blocks.push(schema.nodes.paragraph.create())
  const checked = node.checked === null || node.checked === undefined ? null : Boolean(node.checked)
  return schema.nodes.list_item.create({ checked, spread: Boolean(node.spread) }, blocks)
}

function blockFrom(node: MdNode, src: string): PMNode {
  try {
    switch (node.type) {
      case 'paragraph':
        return schema.nodes.paragraph.create(null, inlineChildren(node, src))
      case 'heading':
        return schema.nodes.heading.create({ level: Number(node.depth) || 1 }, inlineChildren(node, src))
      case 'thematicBreak':
        return schema.nodes.horizontal_rule.create()
      case 'list': {
        const items = ((node.children as MdNode[] | undefined) ?? []).map((c) => listItemFrom(c, src))
        if (items.length === 0) break
        const spread = Boolean(node.spread)
        return node.ordered
          ? schema.nodes.ordered_list.create({ start: Number(node.start) || 1, spread }, items)
          : schema.nodes.bullet_list.create({ spread }, items)
      }
    }
  } catch {
    /* fall through to a verbatim block */
  }
  return schema.nodes.raw_block.create({ value: sliceOf(node, src) })
}

export function parseMarkdown(src: string): ParsedDoc {
  const root = processor.parse(src) as unknown as MdNode
  const children = (root.children as MdNode[] | undefined) ?? []
  const nodes: PMNode[] = []
  const blocks: Block[] = []
  for (const child of children) {
    const pos = child.position as { start: { offset: number }; end: { offset: number } } | undefined
    if (!pos) continue
    nodes.push(blockFrom(child, src))
    blocks.push({ start: pos.start.offset, end: pos.end.offset })
  }
  if (nodes.length === 0) {
    return { doc: schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]), blocks: [], src }
  }
  return { doc: schema.nodes.doc.create(null, nodes), blocks, src }
}

/* ------------------------------------------------------------------ *
 * ProseMirror -> markdown
 * ------------------------------------------------------------------ */

const MARK_ORDER = ['link', 'strong', 'em', 'code']

function markRank(name: string): number {
  const i = MARK_ORDER.indexOf(name)
  return i === -1 ? MARK_ORDER.length : i
}

function wrapMark(mark: Mark, children: MdNode[]): MdNode {
  switch (mark.type.name) {
    case 'strong':
      return { type: 'strong', children }
    case 'em':
      return { type: 'emphasis', children }
    case 'link':
      return { type: 'link', url: mark.attrs.href, title: mark.attrs.title, children }
    default:
      return { type: 'emphasis', children }
  }
}

/** Groups adjacent inline nodes that share a mark, outermost mark first. */
function inlineToMdast(nodes: PMNode[], applied: readonly Mark[] = []): MdNode[] {
  const out: MdNode[] = []
  let i = 0
  while (i < nodes.length) {
    const node = nodes[i]
    const pending = node.marks
      .filter((m) => !applied.some((a) => a.eq(m)))
      .slice()
      .sort((a, b) => markRank(a.type.name) - markRank(b.type.name))

    if (pending.length === 0) {
      if (node.type === schema.nodes.raw_inline) {
        out.push({ type: 'html', value: String(node.attrs.value) })
      } else if (node.isText) {
        out.push({ type: 'text', value: node.text ?? '' })
      }
      i += 1
      continue
    }

    const mark = pending[0]
    if (mark.type.name === 'code') {
      out.push({ type: 'inlineCode', value: node.text ?? '' })
      i += 1
      continue
    }

    let j = i
    const run: PMNode[] = []
    while (j < nodes.length && mark.isInSet(nodes[j].marks)) {
      run.push(nodes[j])
      j += 1
    }
    out.push(wrapMark(mark, inlineToMdast(run, [...applied, mark])))
    i = j
  }
  return out
}

function inlineChildrenOf(node: PMNode): PMNode[] {
  const kids: PMNode[] = []
  node.forEach((child) => kids.push(child))
  return kids
}

function blockToMdast(node: PMNode): MdNode {
  switch (node.type.name) {
    case 'paragraph':
      return { type: 'paragraph', children: inlineToMdast(inlineChildrenOf(node)) }
    case 'heading':
      return {
        type: 'heading',
        depth: node.attrs.level,
        children: inlineToMdast(inlineChildrenOf(node))
      }
    case 'horizontal_rule':
      return { type: 'thematicBreak' }
    case 'raw_block':
      return { type: 'html', value: String(node.attrs.value) }
    case 'bullet_list':
    case 'ordered_list': {
      const items: MdNode[] = []
      node.forEach((item) => items.push(listItemToMdast(item)))
      const spread = Boolean(node.attrs.spread)
      return node.type.name === 'ordered_list'
        ? { type: 'list', ordered: true, start: node.attrs.start, spread, children: items }
        : { type: 'list', ordered: false, spread, children: items }
    }
    default:
      return { type: 'paragraph', children: [] }
  }
}

function listItemToMdast(item: PMNode): MdNode {
  const blocks: MdNode[] = []
  item.forEach((child) => blocks.push(blockToMdast(child)))
  const checked = item.attrs.checked
  return {
    type: 'listItem',
    checked: checked === null || checked === undefined ? null : Boolean(checked),
    spread: Boolean(item.attrs.spread),
    children: blocks
  }
}

/**
 * mdast-util-to-markdown escapes an underscore even between two word characters.
 * CommonMark treats such a run as literal (it can neither open nor close emphasis),
 * so the backslash is pure noise - and students would watch snake_case turn into
 * an escaped form in the code pane as they typed. Undo exactly that case, nothing more.
 */
const INTRAWORD_UNDERSCORE = /(?<=[0-9A-Za-z])\\_(?=[0-9A-Za-z])/g

function unescapeIntrawordUnderscores(text: string): string {
  return text.replace(INTRAWORD_UNDERSCORE, '_')
}

/** Serialises a single top-level block, without a trailing newline. */
export function serializeBlock(node: PMNode): string {
  // A verbatim block is never re-rendered: its bytes go back exactly as they came in.
  if (node.type === schema.nodes.raw_block) return String(node.attrs.value)
  const root = { type: 'root', children: [blockToMdast(node)] }
  const out = toMarkdown(root as never, TO_MARKDOWN_OPTIONS).replace(/\n+$/, '')
  return unescapeIntrawordUnderscores(out)
}

/** Serialises a whole document, with a single trailing newline. */
export function serializeDoc(doc: PMNode): string {
  const children: MdNode[] = []
  doc.forEach((child) => children.push(blockToMdast(child)))
  const root = { type: 'root', children }
  return unescapeIntrawordUnderscores(toMarkdown(root as never, TO_MARKDOWN_OPTIONS))
}

/* ------------------------------------------------------------------ *
 * Block-level patching: the guarantee that untouched text is untouched
 * ------------------------------------------------------------------ */

function childrenOf(doc: PMNode): PMNode[] {
  const kids: PMNode[] = []
  doc.forEach((child) => kids.push(child))
  return kids
}

/**
 * Longest common subsequence over node *identity*. ProseMirror nodes are
 * immutable, so a block the student did not touch is the very same object.
 * Returns newIndex -> oldIndex for matched blocks.
 */
/** Beyond this many differing blocks we stop trying to match them up. */
const MAX_ALIGN = 400

/**
 * Matches old blocks to new ones by *identity*. ProseMirror nodes are immutable, so
 * a block the student did not touch is the very same object.
 *
 * Typing changes one block, so the identical runs at each end are trimmed first and
 * the quadratic part only ever sees the handful of blocks in between. Without that,
 * a term of lecture notes in one file would allocate a table the size of the document
 * squared on every keystroke.
 */
function alignByIdentity(oldKids: PMNode[], newKids: PMNode[]): Map<number, number> {
  const match = new Map<number, number>()
  const n = oldKids.length
  const m = newKids.length

  let head = 0
  while (head < n && head < m && oldKids[head] === newKids[head]) {
    match.set(head, head)
    head += 1
  }

  let tail = 0
  while (tail < n - head && tail < m - head && oldKids[n - 1 - tail] === newKids[m - 1 - tail]) {
    match.set(m - 1 - tail, n - 1 - tail)
    tail += 1
  }

  const oldMid = n - tail - head
  const newMid = m - tail - head
  if (oldMid <= 0 || newMid <= 0) return match
  // Too much moved at once to pair up cheaply; those blocks are simply rewritten.
  if (oldMid > MAX_ALIGN || newMid > MAX_ALIGN) return match

  const table: number[][] = Array.from({ length: oldMid + 1 }, () =>
    new Array<number>(newMid + 1).fill(0)
  )
  for (let i = oldMid - 1; i >= 0; i--) {
    for (let j = newMid - 1; j >= 0; j--) {
      table[i][j] =
        oldKids[head + i] === newKids[head + j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }

  let i = 0
  let j = 0
  while (i < oldMid && j < newMid) {
    if (oldKids[head + i] === newKids[head + j]) {
      match.set(head + j, head + i)
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i += 1
    } else {
      j += 1
    }
  }
  return match
}

/**
 * Rebuilds the markdown for `newDoc`, reusing the original bytes of every block
 * that was not edited. Only blocks the student actually changed are re-serialised.
 */
export interface PatchResult {
  text: string
  /** Offsets into `text`, one per child of the new document, in the same order. */
  blocks: Block[]
}

/**
 * Rebuilds the markdown for `newDoc`, reusing the original bytes of every block that
 * was not edited, and reports where each block landed. Returning the offsets matters:
 * the next edit patches against these, so the block map stays pinned to the very node
 * objects now living in the editor - which is what keeps untouched text untouched.
 */
/**
 * The whitespace a block sits behind on its own line. That indentation lives in the
 * gap between blocks, so when a rebuilt gap replaces it the block would shuffle left
 * and, for a fenced code block, its contents would change meaning.
 */
function indentBefore(src: string, start: number): string {
  let i = start
  while (i > 0) {
    const ch = src[i - 1]
    if (ch === ' ' || ch === TAB) i -= 1
    else break
  }
  if (i > 0 && src[i - 1] !== NEWLINE) return ''
  return src.slice(i, start)
}

export function patchMarkdownDetailed(parsed: ParsedDoc, newDoc: PMNode): PatchResult {
  const { src, blocks } = parsed
  const newKids = childrenOf(newDoc)

  if (blocks.length === 0) {
    const text = serializeDoc(newDoc)
    return { text, blocks: parseMarkdown(text).blocks }
  }
  if (newKids.length === 0) return { text: '', blocks: [] }

  const match = alignByIdentity(childrenOf(parsed.doc), newKids)
  const out: Block[] = []
  let text = src.slice(0, blocks[0].start)

  for (let k = 0; k < newKids.length; k++) {
    const oldIndexAt = match.get(k)
    if (k > 0) {
      const prev = match.get(k - 1)
      const cur = oldIndexAt
      const contiguous = prev !== undefined && cur !== undefined && cur === prev + 1
      text += contiguous
        ? src.slice(blocks[prev].end, blocks[cur].start)
        : NEWLINE + NEWLINE + (oldIndexAt === undefined ? '' : indentBefore(src, blocks[oldIndexAt].start))
    }
    const oldIndex = oldIndexAt
    const piece =
      oldIndex === undefined
        ? serializeBlock(newKids[k])
        : src.slice(blocks[oldIndex].start, blocks[oldIndex].end)
    out.push({ start: text.length, end: text.length + piece.length })
    text += piece
  }

  const lastMatch = match.get(newKids.length - 1)
  text += lastMatch === blocks.length - 1 ? src.slice(blocks[blocks.length - 1].end) : '\n'
  return { text, blocks: out }
}

export function patchMarkdown(parsed: ParsedDoc, newDoc: PMNode): string {
  return patchMarkdownDetailed(parsed, newDoc).text
}
