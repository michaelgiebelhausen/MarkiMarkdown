/**
 * Text surgery on a front matter block.
 *
 * The YAML is parsed with a LineCounter so every node knows which lines it sits on. An
 * edit then replaces only the characters it has to (a value, an item, a pair's own lines)
 * and every other byte of the block, spacing, indentation, folded text, blank lines and
 * line endings included, comes back exactly as the student wrote it. New text is written
 * with the block's own line ending.
 *
 * This module knows nothing about what an edit means; frontmatter.ts decides that. Every
 * method that cannot do its job safely says so (false, or null from result()) rather than
 * guessing, and the caller then falls back to rewriting the whole block.
 */
import {
  Document,
  LineCounter,
  Pair,
  Scalar,
  YAMLMap,
  YAMLSeq,
  isCollection,
  isMap,
  isNode,
  isPair,
  isScalar,
  isSeq,
  parseDocument,
  type DocumentOptions,
  type ParseOptions,
  type SchemaOptions,
  type ToStringOptions
} from 'yaml'

export type ReadOptions = ParseOptions & DocumentOptions & SchemaOptions

/** Options for every piece of YAML written here, the same ones the whole-block writer uses. */
const WRITE: ToStringOptions = { lineWidth: 0, nullStr: '', flowCollectionPadding: false }

const OPEN = /^---[ \t]*$/
const CLOSE = /^(?:---|\.\.\.)[ \t]*$/

interface Line {
  /** Offset of the line's first character in the raw block. */
  start: number
  /** The line without its line ending. */
  text: string
  /** Offset just past the line ending (or the end of the block). */
  end: number
}

/** A top-level key with the lines it occupies, from the key's line to its value's last line. */
export interface PairSpan {
  /** The key's text, or null for a key that is not a plain scalar. */
  key: unknown
  pair: Pair
  /** Raw line index of the key. */
  first: number
  /** Raw line index of the value's last line (comments after it are not included). */
  last: number
}

/** Where a new key goes: after one pair, before one, or (neither) at the end of the block. */
export interface Place {
  after?: PairSpan
  before?: PairSpan
}

/**
 * One item of a list after an edit, in the list's new order: an item the list already
 * has (old is its index), optionally with a new value written in its place, or a new
 * item. Old items must keep their relative order.
 */
export type SeqPlanItem = { old: number; value?: Scalar } | { add: unknown }

interface Edit {
  from: number
  to: number
  text: string
  order: number
}

function splitLines(raw: string): Line[] {
  const lines: Line[] = []
  let pos = 0
  while (pos < raw.length) {
    const nl = raw.indexOf('\n', pos)
    const end = nl === -1 ? raw.length : nl + 1
    let textEnd = nl === -1 ? raw.length : nl
    if (nl !== -1 && textEnd > pos && raw[textEnd - 1] === '\r') textEnd--
    lines.push({ start: pos, text: raw.slice(pos, textEnd), end })
    pos = end
  }
  return lines
}

function withoutComments<T>(node: T): T {
  if (!isNode(node)) return node
  const copy = node.clone()
  copy.comment = undefined
  copy.commentBefore = undefined
  copy.spaceBefore = false
  return copy as T
}

export class FrontMatterBlock {
  private readonly eol: string
  private readonly spansList: PairSpan[] = []
  /** Whitespace in front of every top-level key (nearly always none). */
  private indent = ''
  private readonly edits: Edit[] = []
  private editCount = 0

  private constructor(
    private readonly raw: string,
    private readonly lines: Line[],
    /** Raw line index of the closing fence. */
    private readonly close: number,
    /** The YAML between the fences, lines joined with "\n", as parsed. */
    private readonly inner: string,
    private readonly counter: LineCounter,
    readonly doc: Document,
    private readonly options: ReadOptions
  ) {
    this.eol = raw.includes('\r\n') ? '\r\n' : '\n'
  }

  /**
   * Reads a fenced block for splicing. Null when it can't be spliced safely: no fences,
   * YAML that doesn't parse, a stray carriage return the parser would count as a line
   * break, or top-level YAML that isn't a block mapping (or empty).
   */
  static open(raw: string, options: ReadOptions): FrontMatterBlock | null {
    const lines = splitLines(raw)
    if (lines.length < 2 || !OPEN.test(lines[0].text) || lines[0].end === lines[0].start + lines[0].text.length) return null
    let close = -1
    for (let i = 1; i < lines.length; i++) {
      if (CLOSE.test(lines[i].text)) {
        close = i
        break
      }
    }
    if (close === -1) return null
    const innerLines = lines.slice(1, close).map((line) => line.text)
    if (innerLines.some((text) => text.includes('\r'))) return null
    const inner = innerLines.join('\n')
    const counter = new LineCounter()
    const doc = parseDocument(inner, { ...options, lineCounter: counter })
    if (doc.errors.length > 0) return null
    const contents = doc.contents
    if (contents !== null && (!isMap(contents) || contents.flow)) return null
    const block = new FrontMatterBlock(raw, lines, close, inner, counter, doc, options)
    return block.readSpans() ? block : null
  }

  /** Builds the pair spans. False when a key sits somewhere a line edit can't reach. */
  private readSpans(): boolean {
    const map = this.doc.contents
    if (!isMap(map)) return true
    let previous = 0
    let indent: string | null = null
    for (const pair of map.items) {
      const key = pair.key
      if (!isNode(key) || !key.range) return false
      const first = this.lineOf(key.range[0])
      const before = this.lines[first].text.slice(0, this.colOf(key.range[0]))
      const shape = /^([ \t]*)(\?[ \t]+)?$/.exec(before)
      if (!shape || first <= previous) return false
      indent ??= shape[1]
      const last = isNode(pair.value) && pair.value.range ? this.lastLine(pair.value, first) : first
      this.spansList.push({ key: isScalar(key) ? key.value : null, pair, first, last })
      previous = last
    }
    this.indent = indent ?? ''
    return true
  }

  /* ---------------- positions ---------------- */

  /** Raw line index of an offset in the parsed YAML (inner line n is raw line n + 1). */
  private lineOf(offset: number): number {
    return this.counter.linePos(offset).line
  }

  private colOf(offset: number): number {
    return this.counter.linePos(offset).col - 1
  }

  /** Raw offset of an offset in the parsed YAML. */
  private rawAt(offset: number): number {
    return this.lines[this.lineOf(offset)].start + this.colOf(offset)
  }

  private contentEndOf(line: number): number {
    return this.lines[line].start + this.lines[line].text.length
  }

  /** The offset just past a node's last character of content, trailing comments and blank lines left out. */
  private contentEnd(node: unknown): number {
    if (isPair(node)) return this.contentEnd(isNode(node.value) && node.value.range ? node.value : node.key)
    if (!isNode(node) || !node.range) return 0
    let end = node.range[1]
    if (isCollection(node) && !node.flow && node.items.length > 0) end = this.contentEnd(node.items[node.items.length - 1])
    while (end > node.range[0] && /\s/.test(this.inner[end - 1])) end--
    return end
  }

  /** The raw line holding a node's last character of content, never before floor. */
  private lastLine(node: unknown, floor: number): number {
    const end = this.contentEnd(node)
    return Math.max(floor, end > 0 ? this.lineOf(end - 1) : floor)
  }

  /* ---------------- reading ---------------- */

  spans(key: string): PairSpan[] {
    return this.spansList.filter((span) => span.key === key)
  }

  span(key: string): PairSpan | undefined {
    return this.spansList.find((span) => span.key === key)
  }

  /**
   * How the block indents its block lists, read from the given list or else the first
   * one in the block, so a list written here lines up with the student's own.
   */
  listStyle(prefer?: PairSpan): ToStringOptions {
    const isBlockSeq = (span: PairSpan | undefined) => span !== undefined && isSeq(span.pair.value) && !span.pair.value.flow
    const sample = isBlockSeq(prefer) ? prefer : this.spansList.find(isBlockSeq)
    if (!sample) return {}
    const item = (sample.pair.value as YAMLSeq).items[0]
    const key = sample.pair.key
    if (!isNode(item) || !item.range || !isNode(key) || !key.range) return {}
    const dash = this.lines[this.lineOf(item.range[0])].text.slice(0, this.colOf(item.range[0])).lastIndexOf('-')
    if (dash < 0) return {}
    const step = dash - this.colOf(key.range[0])
    return step <= 0 ? { indentSeq: false } : { indent: step, indentSeq: true }
  }

  /* ---------------- rendering ---------------- */

  private render(contents: unknown, style: ToStringOptions = {}): string[] {
    const tmp = new Document(null, this.options)
    tmp.contents = contents as Document['contents']
    return tmp.toString({ ...WRITE, ...style }).replace(/\n+$/, '').split('\n')
  }

  /** `key: value` as lines, with the block's key indentation. */
  private pairLines(key: unknown, value: unknown, style: ToStringOptions): string[] {
    const map = new YAMLMap()
    map.items.push(new Pair(withoutComments(key), value))
    return this.render(map, style).map((line) => this.indent + line)
  }

  /** A value written after `key: `, or null when it would not fit on that one line. */
  private valueText(value: unknown): string | null {
    const map = new YAMLMap()
    map.items.push(new Pair(new Scalar('k'), withoutComments(value)))
    const lines = this.render(map)
    return lines.length === 1 && lines[0].startsWith('k: ') ? lines[0].slice(3) : null
  }

  /** A list item written after `- ` (block) or between commas (flow), or null when it needs more than one line. */
  private itemText(value: unknown, flow: boolean): string | null {
    const seq = new YAMLSeq()
    seq.flow = flow
    seq.items.push(withoutComments(value))
    const lines = this.render(seq)
    if (lines.length !== 1) return null
    const line = lines[0]
    if (flow) return line.startsWith('[') && line.endsWith(']') ? line.slice(1, -1) : null
    return line.startsWith('- ') ? line.slice(2) : null
  }

  /* ---------------- edits ---------------- */

  private edit(from: number, to: number, text: string, rank = 0): Edit {
    return { from, to, text, order: rank * 1e6 + this.editCount++ }
  }

  private deleteLines(first: number, last: number): Edit {
    return this.edit(this.lines[first].start, this.lines[last].end, '')
  }

  private insertBefore(line: number, newLines: string[], rank = 0): Edit {
    return this.edit(this.lines[line].start, this.lines[line].start, newLines.map((l) => l + this.eol).join(''), rank)
  }

  /** Removes a pair's lines. */
  remove(span: PairSpan): void {
    this.edits.push(this.deleteLines(span.first, span.last))
  }

  /** Writes a pair afresh over its own lines (and only those). */
  replace(span: PairSpan, value: unknown, style: ToStringOptions = {}): void {
    // A block list's own comment sits below its last line, outside the span, and stays there.
    let own = value
    if (isCollection(value) && !value.flow && value.comment) {
      own = value.clone()
      ;(own as YAMLSeq).comment = undefined
    }
    const text = this.pairLines(span.pair.key, own, style).join(this.eol)
    this.edits.push(this.edit(this.lines[span.first].start, this.contentEndOf(span.last), text))
  }

  /**
   * Writes a new value over the old one's characters only, so the key, the spacing after
   * the colon and a comment after the value stay. False when either value is more than
   * one line, the old value is empty, or carries an anchor or tag.
   */
  setInPlace(span: PairSpan, value: unknown): boolean {
    const old = span.pair.value
    if (!isScalar(old) || !isScalar(value) || !old.range || old.anchor || old.tag) return false
    const [from, to] = old.range
    if (from === to || this.lineOf(from) !== span.first || this.lineOf(to - 1) !== span.first) return false
    const text = this.valueText(value)
    if (text === null) return false
    this.edits.push(this.edit(this.rawAt(from), this.rawAt(to), text))
    return true
  }

  /** Adds `key: value` after or before a pair, or at the end of the block. */
  insert(key: string, value: unknown, place: Place = {}, style: ToStringOptions = {}): void {
    const newLines = this.pairLines(new Scalar(key), value, style)
    if (place.after) {
      this.edits.push(this.insertBefore(place.after.last + 1, newLines))
      return
    }
    if (place.before) {
      this.edits.push(this.insertBefore(place.before.first, newLines))
      return
    }
    // At the end: after the last pair, so comments and blank lines below it stay at the
    // bottom; before the closing fence when there are no pairs. Ranked after inserts
    // placed beside a pair, so a key added next to the last pair stays next to it.
    const last = this.spansList[this.spansList.length - 1]
    this.edits.push(this.insertBefore(last ? last.last + 1 : this.close, newLines, 1))
  }

  /**
   * Edits a list item by item: removed items lose their lines (block) or their text and
   * one comma (flow), new items are written beside their neighbours in the same style,
   * and every other item, comments and quoting included, is not touched. False, with
   * nothing changed, when the list can't be edited that way.
   */
  editSeq(span: PairSpan, plan: SeqPlanItem[]): boolean {
    const seq = span.pair.value
    if (!isSeq(seq) || !seq.range) return false
    const edits = seq.flow ? this.flowSeqEdits(seq, plan) : this.blockSeqEdits(seq, plan)
    if (edits === null) return false
    this.edits.push(...edits)
    return true
  }

  private blockSeqEdits(seq: YAMLSeq, plan: SeqPlanItem[]): Edit[] | null {
    const info: { first: number; last: number; prefix: string }[] = []
    for (const item of seq.items) {
      if (!isNode(item) || !item.range) return null
      const first = this.lineOf(item.range[0])
      const prefix = this.lines[first].text.slice(0, this.colOf(item.range[0]))
      if (!/^[ \t]*-[ \t]+$/.test(prefix)) return null
      info.push({ first, last: this.lastLine(item, first), prefix })
    }
    if (info.length === 0) return null
    const kept = new Set(plan.flatMap((p) => ('old' in p ? [p.old] : [])))
    const edits: Edit[] = []
    info.forEach((item, i) => {
      if (!kept.has(i)) edits.push(this.deleteLines(item.first, item.last))
    })
    let anchor = -1
    for (const p of plan) {
      if ('old' in p) {
        anchor = p.old
        if (p.value === undefined) continue
        const item = seq.items[p.old]
        if (!isScalar(item) || !item.range || info[p.old].first !== info[p.old].last) return null
        const text = this.itemText(p.value, false)
        if (text === null) return null
        edits.push(this.edit(this.rawAt(item.range[0]), this.rawAt(item.range[1]), text))
        continue
      }
      const text = this.itemText(p.add, false)
      if (text === null) return null
      const ref = info[anchor === -1 ? 0 : anchor]
      edits.push(this.insertBefore(anchor === -1 ? ref.first : ref.last + 1, [ref.prefix + text]))
    }
    return edits
  }

  private flowSeqEdits(seq: YAMLSeq, plan: SeqPlanItem[]): Edit[] | null {
    const pos: { from: number; to: number }[] = []
    for (const item of seq.items) {
      if (!isNode(item) || !item.range) return null
      pos.push({ from: item.range[0], to: this.contentEnd(item) })
    }
    const texts = new Map<SeqPlanItem, string>()
    for (const p of plan) {
      const value = 'old' in p ? p.value : p.add
      if ('old' in p && value === undefined) continue
      const text = this.itemText(value, true)
      if (text === null) return null
      texts.set(p, text)
    }
    const n = pos.length
    const between = n >= 2 ? this.inner.slice(pos[0].to, pos[1].from) : ''
    // The parsed copy joins lines with "\n"; a separator that spans lines takes the block's ending.
    const sep = /^\s*,\s*$/.test(between) ? between.replace(/\n/g, this.eol) : ', '
    const kept = new Set(plan.flatMap((p) => ('old' in p ? [p.old] : [])))
    const edits: Edit[] = []
    const replace = (from: number, to: number, text: string) => edits.push(this.edit(this.rawAt(from), this.rawAt(to), text))

    if (kept.size === 0) {
      const all = plan.map((p) => texts.get(p)!).join(sep)
      if (n > 0) replace(pos[0].from, pos[n - 1].to, all)
      else if (this.inner[seq.range![0]] === '[') replace(seq.range![0] + 1, seq.range![0] + 1, all)
      else return null
      return edits
    }
    // Each run of removed items goes with one comma: the one after it, or for a run at
    // the end, the one before it.
    for (let i = 0; i < n; ) {
      if (kept.has(i)) {
        i++
        continue
      }
      let j = i
      while (j + 1 < n && !kept.has(j + 1)) j++
      if (j < n - 1) replace(pos[i].from, pos[j + 1].from, '')
      else replace(pos[i - 1].to, pos[j].to, '')
      i = j + 1
    }
    let anchor = -1
    const front: string[] = []
    for (const p of plan) {
      if ('old' in p) {
        if (anchor === -1 && front.length > 0) replace(pos[p.old].from, pos[p.old].from, front.map((t) => t + sep).join(''))
        anchor = p.old
        const text = texts.get(p)
        if (text !== undefined) replace(pos[p.old].from, pos[p.old].to, text)
        continue
      }
      if (anchor === -1) front.push(texts.get(p)!)
      else replace(pos[anchor].to, pos[anchor].to, sep + texts.get(p)!)
    }
    return edits
  }

  /* ---------------- result ---------------- */

  /**
   * The block with every edit applied, or null when two edits would overlap. Edits at the
   * same place go in the order they were made (inserts beside a pair before inserts at
   * the end), after any removal that starts there.
   */
  result(): string | null {
    const ranges = this.edits.filter((e) => e.to > e.from).sort((a, b) => a.from - b.from)
    for (let i = 1; i < ranges.length; i++) if (ranges[i].from < ranges[i - 1].to) return null
    for (const e of this.edits) {
      if (e.to === e.from && ranges.some((r) => r.from < e.from && e.from < r.to)) return null
    }
    const ordered = [...this.edits].sort((a, b) => {
      if (a.from !== b.from) return b.from - a.from
      const aRange = a.to > a.from
      const bRange = b.to > b.from
      if (aRange !== bRange) return aRange ? -1 : 1
      return b.order - a.order
    })
    let text = this.raw
    for (const e of ordered) text = text.slice(0, e.from) + e.text + text.slice(e.to)
    return text
  }
}
