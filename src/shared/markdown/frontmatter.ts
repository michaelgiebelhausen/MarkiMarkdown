/**
 * Front matter handling.
 *
 * Rules that matter for students' files:
 *  - never throw: a broken YAML block leaves the bytes alone and reports a line number
 *  - never drop unknown keys, comments or quoting the student wrote
 *  - never coerce dates into Date objects (that silently rewrites `created: 2026-08-21`)
 */
import { Document, isScalar, isSeq, parseDocument, type Scalar, type YAMLSeq } from 'yaml'

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

function readDocument(raw: string): Document | null {
  const doc = parseDocument(innerYaml(raw), {
    schema: 'core',
    version: '1.2',
    uniqueKeys: false
  })
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

/** Keys a second-brain script greps line by line, so they are written one item per line. */
const BLOCK_LIST_KEYS = new Set(['skills', 'skill_paths', 'domains', 'domain_paths'])

/** Tags in these namespaces, in any case, belong to the app and are rewritten from the ticks. 1.1 used agent/ and artifact/. */
export const MIRRORED_TAG = /^(skill|domain|agent|artifact)\//i

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
 * Applies a ListEdit to one key. A missing key becomes a block list, but only when
 * there is something to add. A comma string, a mapping or an empty value is not a
 * list we can edit safely, so it is left exactly as written. When nothing would
 * change the node is not touched at all.
 */
function applyListEdit(doc: Document, key: string, edit: ListEdit): void {
  if (!doc.has(key)) {
    if (edit.append.length === 0) return
    const node = doc.createNode(edit.append) as YAMLSeq
    node.flow = false
    doc.set(key, node)
    return
  }
  const node = doc.get(key, true)
  if (!isSeq(node)) return
  const text = (item: unknown): string | null => (isScalar(item) ? String(item.value) : null)
  const removed = node.items.filter((item) => {
    const value = text(item)
    return value !== null && edit.removeMatching.test(value) && !edit.append.includes(value)
  })
  const kept = node.items.filter((item) => !removed.includes(item))
  const present = kept.map(text)
  const added = edit.append.filter((tag, i) => !present.includes(tag) && edit.append.indexOf(tag) === i)
  if (removed.length === 0 && added.length === 0) return
  if (kept.length === 0 && added.length === 0) {
    doc.delete(key)
    return
  }
  node.items = kept
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
 */
export function mergeFrontMatter(raw: string | null, patch: FrontMatterPatch, eol?: '\n' | '\r\n'): string {
  if (raw === null) {
    const doc = new Document({})
    applyPatch(doc, patch)
    return serialise(doc, eol ?? '\n')
  }
  const doc = readDocument(raw)
  if (!doc) return raw
  if (doc.contents === null) doc.contents = doc.createNode({}) as Document["contents"]
  applyPatch(doc, patch)
  return serialise(doc, detectEol(raw))
}

export interface Stamp {
  id: string
  /** Omitted entirely for the plain preset, which keeps front matter minimal. */
  type?: string
  filed: string
  created: string
  tags?: string[]
  title?: string
  /** Set when filing to a bunch. Replaces bunch, skills, skill_paths, domains and domain_paths wholesale. */
  bunch?: string
  skills?: string[]
  skillPaths?: string[]
  domains?: string[]
  domainPaths?: string[]
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

/** Applies filing metadata to a whole document, preserving id, created and the body bytes. */
export function stampNote(text: string, stamp: Stamp): string {
  const { raw, body } = splitFrontMatter(text)
  const existing = raw === null ? { ok: true as const, data: {} as FrontMatterData } : parseFrontMatter(raw)
  if (!existing.ok) return text

  const current = existing.data
  const filing = stamp.bunch !== undefined
  const before = normaliseTags(current.tags)
  const tags = before.filter((tag) => !filing || !MIRRORED_TAG.test(tag))
  const stripped = filing && tags.length !== before.length
  for (const tag of normaliseTags(stamp.tags)) {
    if (!tags.includes(tag)) tags.push(tag)
  }

  // undefined leaves a key alone, null removes it, a list writes it
  const list = (value: string[] | undefined): string[] | null | undefined =>
    value === undefined ? undefined : value.length > 0 ? value : null

  const patch: FrontMatterPatch = {
    id: typeof current.id === 'string' && current.id.length > 0 ? undefined : stamp.id,
    type:
      stamp.type === undefined || (typeof current.type === 'string' && current.type.length > 0)
        ? undefined
        : stamp.type,
    created:
      typeof current.created === 'string' && current.created.length > 0 ? undefined : stamp.created,
    filed: stamp.filed,
    tags: tags.length > 0 ? tags : stripped ? null : undefined,
    bunch: stamp.bunch === undefined ? undefined : stamp.bunch.length > 0 ? stamp.bunch : null,
    skills: list(stamp.skills),
    skill_paths: list(stamp.skillPaths),
    domains: list(stamp.domains),
    domain_paths: list(stamp.domainPaths),
    // 1.1 keys go the first time the note is filed again
    agents: filing ? null : undefined,
    agent_paths: filing ? null : undefined,
    artifacts: filing ? null : undefined,
    artifact_paths: filing ? null : undefined,
    title: stamp.title
  }

  const merged = mergeFrontMatter(raw, patch)
  return merged + body
}

/**
 * The text of an archive copy: the working text with `archived:` set. The body bytes
 * are untouched. Returns null when the front matter cannot be read, so nothing is written.
 */
export function addArchived(text: string, archivedAt: string): string | null {
  const { raw, body } = splitFrontMatter(text)
  if (raw !== null && !parseFrontMatter(raw).ok) return null
  return mergeFrontMatter(raw, { archived: archivedAt }) + body
}
