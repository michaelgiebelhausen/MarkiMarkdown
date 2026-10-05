/**
 * Front matter handling.
 *
 * Rules that matter for students' files:
 *  - never throw: a broken YAML block leaves the bytes alone and reports a line number
 *  - never drop unknown keys, comments or quoting the student wrote
 *  - never coerce dates into Date objects (that silently rewrites `created: 2026-08-21`)
 *  - never rewrite a line an edit didn't touch: changes are spliced in (yamlSplice.ts)
 */
import { Document, isAlias, isMap, isNode, isScalar, isSeq, parseDocument, Scalar, type ScalarTag, type Tags, type YAMLSeq } from 'yaml'
import { FrontMatterBlock, type PairSpan, type Place, type ReadOptions, type SeqPlanItem } from './yamlSplice'

export interface SplitResult {
  /** The whole block including both fences and the trailing newline, or null. */
  raw: string | null
  /** Everything after the block. */
  body: string
}

export type FrontMatterData = Record<string, unknown>

export type ParseResult =
  | { ok: true; data: FrontMatterData }
  | { ok: false; line: number; message: string }

/** Values to write. `undefined` skips the key, `null` deletes it. */
export type FrontMatterPatch = Record<string, unknown>

const OPEN = /^---[ \t]*\r?\n/
const CLOSE = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/

export function splitFrontMatter(text: string): SplitResult {
  const open = OPEN.exec(text)
  if (!open) return { raw: null, body: text }

  let offset = open[0].length
  while (offset <= text.length) {
    const nextBreak = text.indexOf('\n', offset)
    const lineEnd = nextBreak === -1 ? text.length : nextBreak + 1
    const line = text.slice(offset, lineEnd)
    if (CLOSE.test(line)) {
      const end = offset + line.length
      const raw = text.slice(0, end)
      // A note can legitimately open with a "---" divider. Only call this front
      // matter if the block between the fences really reads as YAML settings.
      if (!looksLikeSettings(raw)) return { raw: null, body: text }
      return { raw, body: text.slice(end) }
    }
    if (nextBreak === -1) break
    offset = lineEnd
  }
  return { raw: null, body: text }
}

/** Strips the fences from a raw block. Accepts a block with or without them. */
function innerYaml(raw: string): string {
  const open = OPEN.exec(raw)
  if (!open) return raw
  const rest = raw.slice(open[0].length)
  const lines = rest.split(/\r?\n/)
  const out: string[] = []
  for (const line of lines) {
    if (CLOSE.test(line + '\n')) break
    out.push(line)
  }
  return out.join('\n')
}

function detectEol(raw: string): '\n' | '\r\n' {
  return raw.includes('\r\n') ? '\r\n' : '\n'
}

/**
 * True when the fenced block is empty, is broken YAML (so the panel can still offer
 * to repair it), or parses to a mapping. Prose, lists and headings are not settings,
 * so a note that simply opens with a divider keeps all of its text.
 */
function looksLikeSettings(raw: string): boolean {
  const inner = innerYaml(raw)
  if (inner.trim().length === 0) return true
  const doc = parseDocument(inner, { schema: 'core', version: '1.2', uniqueKeys: false })
  if (doc.errors.length > 0) return true
  const value = doc.toJS() as unknown
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * The schema's number tags, but a number read from the note is written back exactly as the
 * note spelled it: `id: 007` stays 007 and `0x1F` stays 0x1F, where the parser's own
 * writer would give 7 and 0x1f. A number set by the app has no spelling, and is written
 * the usual way. A blank spelling is no spelling (Number('') is 0, but writing nothing
 * would read back as null).
 */
function keepNumberSpelling(tags: Tags): Tags {
  return tags.map((tag) => {
    if (typeof tag !== 'object' || tag === null || !('stringify' in tag)) return tag
    const write = tag.stringify
    if (typeof write !== 'function' || !/:(int|float)$/.test(tag.tag)) return tag
    const kept: ScalarTag = {
      ...(tag as ScalarTag),
      stringify: (item, ctx, onComment, onChompKeep) =>
        isScalar(item) &&
        typeof item.value === 'number' &&
        typeof item.source === 'string' &&
        item.source.trim() !== '' &&
        Number(item.source) === item.value
          ? item.source
          : write(item, ctx, onComment, onChompKeep)
    }
    return kept
  })
}

const READ_OPTIONS: ReadOptions = { schema: 'core', version: '1.2', uniqueKeys: false, customTags: keepNumberSpelling }

function readDocument(raw: string): Document | null {
  const doc = parseDocument(innerYaml(raw), READ_OPTIONS)
  if (doc.errors.length > 0) return null
  return doc
}

export function parseFrontMatter(raw: string): ParseResult {
  const inner = innerYaml(raw)
  const doc = parseDocument(inner, { schema: 'core', version: '1.2', uniqueKeys: false })
  if (doc.errors.length > 0) {
    const err = doc.errors[0]
    const before = inner.slice(0, err.pos[0])
    return {
      ok: false,
      line: before.split('\n').length,
      message: err.message
    }
  }
  const js = doc.toJS({ maxAliasCount: 100 }) as unknown
  if (js === null || js === undefined) return { ok: true, data: {} }
  if (typeof js !== 'object' || Array.isArray(js)) return { ok: true, data: {} }
  return { ok: true, data: js as FrontMatterData }
}

/**
 * A top-level key's value exactly as the note writes it, when that value is a piece of
 * text or a number: `id: 007` gives "007" and `id: 0x1F` gives "0x1F", where the parsed
 * data holds 7 and 31. Text gives its text. Anything else (true, null, nothing, a list, a
 * map, a missing key, or YAML that can't be read) gives null. Of two copies of the key,
 * the last counts, as it does in the parsed data.
 */
export function scalarSource(raw: string | null, key: string): string | null {
  if (raw === null) return null
  const doc = readDocument(raw)
  if (!doc || !isMap(doc.contents)) return null
  const pair = doc.contents.items.filter((p) => isScalar(p.key) && p.key.value === key).pop()
  let node: unknown = pair?.value
  if (isAlias(node)) node = node.resolve(doc)
  if (!isScalar(node)) return null
  if (typeof node.value === 'string') return node.value
  if (typeof node.value === 'number') return typeof node.source === 'string' ? node.source : String(node.value)
  return null
}

/**
 * Keys a second-brain script greps line by line, so they are written one item per line.
 * The 1.1 path keys are written only when archiving lines a 1.1 note's paths up.
 */
const BLOCK_LIST_KEYS = new Set(['skills', 'skill_paths', 'domains', 'domain_paths', 'agent_paths', 'artifact_paths'])

/**
 * Tags in these namespaces, in any case and with or without Obsidian's leading #, belong
 * to the app and are rewritten from the ticks. 1.1 used agent/ and artifact/.
 */
export const MIRRORED_TAG = /^#?(skill|domain|agent|artifact)\//i

/**
 * Top-level keys written more than once. The parser accepts them, but the parsed data
 * keeps only one, so a writer that trusted it would silently drop the other. Empty when
 * the front matter cannot be read at all.
 */
export function duplicateTopLevelKeys(raw: string): string[] {
  const doc = readDocument(raw)
  if (!doc || !isMap(doc.contents)) return []
  const seen = new Set<string>()
  const repeated: string[] = []
  for (const pair of doc.contents.items) {
    if (!isScalar(pair.key)) continue
    const key = String(pair.key.value)
    if (seen.has(key) && !repeated.includes(key)) repeated.push(key)
    seen.add(key)
  }
  return repeated
}

/**
 * A patch value that edits a list in place instead of replacing it: items matching
 * removeMatching go unless append still wants them, then each append string not
 * already there is added. Every other item keeps its comment, quoting and type.
 */
export interface ListEdit {
  removeMatching: RegExp
  append: string[]
}

export function isListEdit(value: unknown): value is ListEdit {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const edit = value as Partial<ListEdit>
  return edit.removeMatching instanceof RegExp && Array.isArray(edit.append)
}

/**
 * A patch value that renames items of a list in place: each text item that rename turns
 * into other text takes that text where it stands, keeping its comment and quoting. An
 * item whose new text the list already has (or an earlier item was renamed to) goes
 * instead, so nothing is listed twice. A key that is not a list is left alone.
 */
export interface ListRename {
  rename: (value: string) => string | null
}

function isListRename(value: unknown): value is ListRename {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return typeof (value as Partial<ListRename>).rename === 'function'
}

/**
 * What a ListRename does to each item of a list: null leaves it as it is, a string is its
 * new text, false drops it (its new text is already taken). Null when nothing is renamed.
 */
function renameChoice(node: YAMLSeq, edit: ListRename): (string | null | false)[] | null {
  const text = (item: unknown): string | null => (isScalar(item) && typeof item.value === 'string' ? item.value : null)
  const renamed = node.items.map((item) => {
    const value = text(item)
    if (value === null) return null
    const to = edit.rename(value)
    return to !== null && to !== value ? to : null
  })
  if (renamed.every((to) => to === null)) return null
  const taken = new Set(node.items.filter((_, i) => renamed[i] === null).map(text))
  return renamed.map((to) => {
    if (to === null) return null
    if (taken.has(to)) return false
    taken.add(to)
    return to
  })
}

function applyListRename(doc: Document, key: string, edit: ListRename): void {
  const node = doc.get(key, true)
  if (!isSeq(node)) return
  const choice = renameChoice(node, edit)
  if (choice === null) return
  node.items = node.items.filter((item, i) => {
    const to = choice[i]
    if (typeof to === 'string') (item as Scalar).value = to
    return to !== false
  })
}

/** Which items of a list a ListEdit keeps, and the text of each item it adds. */
function listEditChoice(node: YAMLSeq, edit: ListEdit): { keep: boolean[]; added: string[] } {
  const text = (item: unknown): string | null => (isScalar(item) ? String(item.value) : null)
  const keep = node.items.map((item) => {
    const value = text(item)
    return !(value !== null && edit.removeMatching.test(value) && !edit.append.includes(value))
  })
  const present = node.items.filter((_, i) => keep[i]).map(text)
  const added = edit.append.filter((tag, i) => !present.includes(tag) && edit.append.indexOf(tag) === i)
  return { keep, added }
}

/** `key:` with nothing after it: no comment, anchor or explicit tag that a rewrite would lose. */
function isBareEmpty(node: unknown): boolean {
  if (node === null || node === undefined) return true
  if (!isScalar(node) || node.value !== null) return false
  return !node.comment && !node.commentBefore && !node.anchor && !node.tag
}

/**
 * Applies a ListEdit to one key. A missing key, or one with a bare empty value, becomes
 * a block list, but only when there is something to add. A comma string, a mapping or
 * an empty value carrying a comment is not a list we can edit safely, so it is left
 * exactly as written. When nothing would change the node is not touched at all.
 */
function applyListEdit(doc: Document, key: string, edit: ListEdit): void {
  if (!doc.has(key) || isBareEmpty(doc.get(key, true))) {
    if (edit.append.length === 0) return
    const node = doc.createNode(edit.append) as YAMLSeq
    node.flow = false
    doc.set(key, node)
    return
  }
  const node = doc.get(key, true)
  if (!isSeq(node)) return
  const { keep, added } = listEditChoice(node, edit)
  if (keep.every(Boolean) && added.length === 0) return
  if (!keep.some(Boolean) && added.length === 0) {
    doc.delete(key)
    return
  }
  node.items = node.items.filter((_, i) => keep[i])
  for (const tag of added) node.items.push(doc.createNode(tag))
}

function applyPatch(doc: Document, patch: FrontMatterPatch): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (value === null) {
      doc.delete(key)
      continue
    }
    if (isListEdit(value)) {
      applyListEdit(doc, key, value)
      continue
    }
    if (isListRename(value)) {
      applyListRename(doc, key, value)
      continue
    }
    if (Array.isArray(value)) {
      const node = doc.createNode(value) as YAMLSeq
      node.flow = !BLOCK_LIST_KEYS.has(key)
      doc.set(key, node)
      continue
    }
    if (typeof value === 'string') {
      const node = doc.createNode(value) as Scalar
      doc.set(key, node)
      continue
    }
    doc.set(key, value)
  }
}

function serialise(doc: Document, eol: '\n' | '\r\n'): string {
  const body = doc.toString({ lineWidth: 0, nullStr: '', flowCollectionPadding: false })
  const trimmed = body.replace(/\n+$/, '')
  const lines = trimmed.length > 0 ? trimmed.split('\n') : []
  const out = ['---', ...lines, '---', '']
  return out.join(eol)
}

/**
 * Applies a patch to a raw front matter block, or builds a new block when raw is null.
 * The new block uses eol (default "\n"); an existing block keeps its own line ending.
 * An existing block is edited in place: only the lines of the keys the patch changes are
 * written, and every other line comes back byte for byte.
 */
export function mergeFrontMatter(raw: string | null, patch: FrontMatterPatch, eol?: '\n' | '\r\n'): string {
  if (raw === null) {
    const doc = new Document({})
    applyPatch(doc, patch)
    return serialise(doc, eol ?? '\n')
  }
  if (!readDocument(raw)) return raw
  return writeBack(raw, patch)
}

/**
 * The patched block, spliced when that can be done safely. The whole-block writer is
 * the reference for what a patch means: a splice whose YAML does not read back as the
 * same data as the rewrite (which should never happen) is thrown away for the rewrite.
 * single names a key that must end up written once, whatever copies the block has.
 */
function writeBack(raw: string, patch: FrontMatterPatch, single?: string): string {
  const whole = rewriteWhole(raw, patch, single)
  const spliced = splice(raw, patch, single)
  return spliced !== null && sameData(spliced, whole) ? spliced : whole
}

/** Parses the block, patches the Document and writes every line again. The caller has checked the YAML reads. */
function rewriteWhole(raw: string, patch: FrontMatterPatch, single?: string): string {
  const doc = readDocument(raw) as Document
  if (doc.contents === null) doc.contents = doc.createNode({}) as Document['contents']
  // Duplicate keys are allowed when reading, and set() only replaces the first one.
  if (single !== undefined && isMap(doc.contents)) {
    doc.contents.items = doc.contents.items.filter((pair) => !(isScalar(pair.key) && pair.key.value === single))
  }
  applyPatch(doc, patch)
  return serialise(doc, detectEol(raw))
}

function sameData(a: string, b: string): boolean {
  const left = parseFrontMatter(a)
  const right = parseFrontMatter(b)
  return left.ok && right.ok && sameValue(left.data, right.data)
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameValue(v, b[i]))
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every((k) => Object.hasOwn(right, k) && sameValue(left[k], right[k]))
}

/**
 * The patch applied as text edits, with the same meaning applyPatch gives it: a value
 * that changes is written over the old one (its key, spacing and comment stay when both
 * fit on the key's line), a list is edited item by item, a removed key loses its lines,
 * a new key goes after its related key (skill_paths after skills) or at the end. A value
 * that would not change is not written at all. Null when the block can't be spliced.
 */
function splice(raw: string, patch: FrontMatterPatch, single?: string): string | null {
  try {
    const block = FrontMatterBlock.open(raw, READ_OPTIONS)
    if (!block) return null
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue
      const [span, ...copies] = block.spans(key)
      if (key === single) for (const copy of copies) block.remove(copy)
      if (value === null) {
        if (span) block.remove(span)
      } else if (isListEdit(value)) spliceListEdit(block, key, span, value)
      else if (isListRename(value)) spliceListRename(block, span, value)
      else if (Array.isArray(value)) spliceList(block, key, span, value)
      else spliceValue(block, key, span, value)
    }
    return block.result()
  } catch {
    // Writing a pair on its own can fail where the whole block would not (an alias whose
    // anchor is on another key); the whole-block writer then does the job.
    return null
  }
}

/** A path list goes right after its names (skill_paths after skills), names right before their paths. */
function placeFor(block: FrontMatterBlock, key: string): Place {
  const paths = /^(.+)_paths$/.exec(key)
  const names = paths ? block.span(`${paths[1]}s`) : undefined
  if (names) return { after: names }
  const plural = /^(.+)s$/.exec(key)
  const pathList = plural ? block.span(`${plural[1]}_paths`) : undefined
  return pathList ? { before: pathList } : {}
}

/** The list a span's value becomes when it has to be written afresh. */
function listWith(node: YAMLSeq, items: unknown[]): YAMLSeq {
  const copy = node.clone() as YAMLSeq
  copy.items = items
  return copy
}

function spliceListEdit(block: FrontMatterBlock, key: string, span: PairSpan | undefined, edit: ListEdit): void {
  const node = span?.pair.value
  if (!span || isBareEmpty(node)) {
    if (edit.append.length === 0) return
    const seq = block.doc.createNode(edit.append) as YAMLSeq
    seq.flow = false
    if (span) block.replace(span, seq, block.listStyle())
    else block.insert(key, seq, placeFor(block, key), block.listStyle())
    return
  }
  if (!isSeq(node)) return
  const { keep, added } = listEditChoice(node, edit)
  if (keep.every(Boolean) && added.length === 0) return
  if (!keep.some(Boolean) && added.length === 0) {
    block.remove(span)
    return
  }
  const fresh = added.map((tag) => block.doc.createNode(tag))
  const plan: SeqPlanItem[] = [
    ...node.items.flatMap((_, old) => (keep[old] ? [{ old }] : [])),
    ...fresh.map((add) => ({ add }))
  ]
  if (!block.editSeq(span, plan)) {
    block.replace(span, listWith(node, [...node.items.filter((_, i) => keep[i]), ...fresh]), block.listStyle(span))
  }
}

function spliceListRename(block: FrontMatterBlock, span: PairSpan | undefined, edit: ListRename): void {
  const node = span?.pair.value
  if (!span || !isSeq(node)) return
  const choice = renameChoice(node, edit)
  if (choice === null) return
  const plan: SeqPlanItem[] = []
  const items: unknown[] = []
  node.items.forEach((item, old) => {
    const to = choice[old]
    if (to === false) return
    if (to === null) {
      plan.push({ old })
      items.push(item)
      return
    }
    const value = (item as Scalar).clone() as Scalar
    value.value = to
    plan.push({ old, value })
    items.push(value)
  })
  if (!block.editSeq(span, plan)) block.replace(span, listWith(node, items), block.listStyle(span))
}

/**
 * How a list becomes another, item by item: the longest run of items both have stays,
 * the rest of the old items go, and the new ones are added where they stand. Null when
 * the list would not change.
 */
function diffItems(block: FrontMatterBlock, items: unknown[], want: unknown[]): SeqPlanItem[] | null {
  const have = items.map((item) => (isScalar(item) ? item.value : Symbol('not a scalar')))
  const n = have.length
  const m = want.length
  const common: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      common[i][j] = Object.is(have[i], want[j]) ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1])
    }
  }
  if (common[0][0] === n && n === m) return null
  const plan: SeqPlanItem[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && Object.is(have[i], want[j])) {
      plan.push({ old: i })
      i++
      j++
    } else if (j < m && (i === n || common[i][j + 1] >= common[i + 1][j])) {
      plan.push({ add: block.doc.createNode(want[j]) })
      j++
    } else {
      i++
    }
  }
  return plan
}

function spliceList(block: FrontMatterBlock, key: string, span: PairSpan | undefined, value: unknown[]): void {
  const fresh = block.doc.createNode(value) as YAMLSeq
  fresh.flow = !BLOCK_LIST_KEYS.has(key)
  if (!span) {
    block.insert(key, fresh, placeFor(block, key), block.listStyle())
    return
  }
  const node = span.pair.value
  const style = block.listStyle(span)
  // A list the student wrote keeps its style, except that the keys a script greps line by
  // line are always block lists.
  const plain = value.every((v) => v === null || typeof v !== 'object')
  if (!isSeq(node) || (node.flow && !fresh.flow) || !plain) {
    block.replace(span, fresh, style)
    return
  }
  const plan = diffItems(block, node.items, value)
  if (plan === null) return
  // A block list with no items would read as nothing at all, not as an empty list.
  if ((plan.length === 0 && !node.flow) || !block.editSeq(span, plan)) block.replace(span, fresh, style)
}

/** The node applyPatch would write for a value that is not a list. */
function newValue(block: FrontMatterBlock, old: unknown, value: unknown): unknown {
  if (typeof value === 'string') return block.doc.createNode(value)
  if (isNode(value)) return value
  if (isScalar(old) && (value === null || typeof value !== 'object')) {
    const copy = old.clone() as Scalar
    copy.value = value
    return copy
  }
  return block.doc.createNode(value)
}

function spliceValue(block: FrontMatterBlock, key: string, span: PairSpan | undefined, value: unknown): void {
  const old = span?.pair.value
  const next = newValue(block, old, value)
  if (!span) {
    block.insert(key, next, placeFor(block, key))
    return
  }
  if (isScalar(old) && isScalar(next) && Object.is(old.value, next.value)) return
  // New text keeps the quotes the student chose for the old text.
  if (isScalar(old) && isScalar(next) && typeof old.value === 'string' && typeof next.value === 'string') {
    if (old.type === Scalar.QUOTE_DOUBLE || old.type === Scalar.QUOTE_SINGLE) next.type = old.type
  }
  if (!block.setInPlace(span, next)) block.replace(span, next)
}

export function normaliseTags(value: unknown): string[] {
  if (value === null || value === undefined) return []
  const list = Array.isArray(value) ? value : String(value).split(',')
  const out: string[] = []
  for (const item of list) {
    const tag = String(item).trim().replace(/^#/, '')
    if (tag.length > 0 && !out.includes(tag)) out.push(tag)
  }
  return out
}

/**
 * The text of an archive copy: the working text with `archived:` set. The body bytes
 * are untouched. Returns null when the front matter cannot be read, so nothing is written.
 */
export function addArchived(text: string, archivedAt: string): string | null {
  const { raw, body } = splitFrontMatter(text)
  if (raw === null) return mergeFrontMatter(null, { archived: archivedAt }) + body
  if (!parseFrontMatter(raw).ok || !readDocument(raw)) return null
  // A copy archived from an archive could otherwise carry two stamps.
  return writeBack(raw, { archived: archivedAt }, 'archived') + body
}
