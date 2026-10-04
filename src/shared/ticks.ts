import type { Member, MemberKind } from './types'
import {
  MIRRORED_TAG,
  duplicateTopLevelKeys,
  mergeFrontMatter,
  normaliseTags,
  parseFrontMatter,
  type FrontMatterPatch,
  type ListEdit
} from './markdown/frontmatter'
import { toForwardSlashes } from './paths'

export interface Ticks {
  skillIds: string[]
  domainIds: string[]
}

export interface UnknownName {
  name: string
  kind: MemberKind
}

export interface TickReading extends Ticks {
  /**
   * False when the front matter cannot be parsed, when skills, domains, agents,
   * artifacts or tags holds a mapping or is written twice, or when a skills, domains,
   * agents or artifacts list holds something other than plain values. Nothing else is
   * meaningful then.
   */
  ok: boolean
  /** Every name listed under skills and then 1.1 agents, known or not, as written. */
  skillNames: string[]
  domainNames: string[]
  /** Names in the YAML that match nobody of that kind in the roster. */
  unknown: UnknownName[]
  bunch: string | null
  /** The note still has the 1.1 key agents or artifacts, alone or beside the new key. */
  usedAliases: boolean
  tagCount: number
}

function empty(ok: boolean): TickReading {
  return {
    ok,
    skillIds: [],
    domainIds: [],
    skillNames: [],
    domainNames: [],
    unknown: [],
    bunch: null,
    usedAliases: false,
    tagCount: 0
  }
}

/** Adds a name unless the list already has it in any case. */
function addName(out: string[], name: string): boolean {
  if (out.some((n) => n.toLowerCase() === name.toLowerCase())) return false
  out.push(name)
  return true
}

/**
 * A YAML list or an Obsidian-style comma string, trimmed, without case-insensitive
 * repeats. Objects are never stringified: a mapping, or a mapping inside a list, gives nothing.
 */
function names(value: unknown): string[] {
  if (value === null || value === undefined) return []
  if (typeof value === 'object' && !Array.isArray(value)) return []
  const list: unknown[] = Array.isArray(value) ? value : String(value).split(',')
  const out: string[] = []
  for (const item of list) {
    if (item === null || item === undefined || typeof item === 'object') continue
    const name = String(item).trim()
    if (name.length > 0) addName(out, name)
  }
  return out
}

/** Keys whose value ticks read as a list. A mapping in any of them cannot be ticked safely. */
const LIST_KEYS = ['skills', 'domains', 'agents', 'artifacts', 'tags']

/** Keys applyTicks rewrites wholesale from names, so every item must be a plain name. */
const NAME_KEYS = ['skills', 'domains', 'agents', 'artifacts']

function isMapping(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A list with a mapping or a nested list in it: rewriting it from names would drop that item. */
function hasNonScalarItem(value: unknown): boolean {
  return Array.isArray(value) && value.some((item) => typeof item === 'object' && item !== null)
}

function findMember(members: Member[], kind: MemberKind, name: string): Member | undefined {
  const lower = name.toLowerCase()
  return members.find((m) => m.kind === kind && m.name.toLowerCase() === lower)
}

/**
 * Which skills and domains a note is ticked for, read straight from its front matter.
 * Names come from the new key first, then from its 1.1 alias when that is also there.
 * A mapping where a list belongs, a list item that is not a plain value, or a list key
 * written twice reports ok false, as unreadable YAML does: none of them can be ticked
 * without losing something the student wrote.
 */
export function readTicks(raw: string | null, members: Member[]): TickReading {
  if (raw === null) return empty(true)
  const parsed = parseFrontMatter(raw)
  if (!parsed.ok) return empty(false)
  const data = parsed.data
  if (LIST_KEYS.some((key) => isMapping(data[key]))) return empty(false)
  if (NAME_KEYS.some((key) => hasNonScalarItem(data[key]))) return empty(false)
  if (duplicateTopLevelKeys(raw).some((key) => LIST_KEYS.includes(key))) return empty(false)

  const both = (key: string, alias: string) => {
    const out = names(data[key])
    for (const name of names(data[alias])) addName(out, name)
    return out
  }
  const skillNames = both('skills', 'agents')
  const domainNames = both('domains', 'artifacts')

  const reading = empty(true)
  reading.skillNames = skillNames
  reading.domainNames = domainNames
  const resolve = (list: string[], kind: MemberKind, ids: string[]) => {
    for (const name of list) {
      const member = findMember(members, kind, name)
      if (member) {
        if (!ids.includes(member.id)) ids.push(member.id)
      } else {
        reading.unknown.push({ name, kind })
      }
    }
  }
  resolve(skillNames, 'skill', reading.skillIds)
  resolve(domainNames, 'domain', reading.domainIds)

  reading.bunch = typeof data.bunch === 'string' && data.bunch.trim().length > 0 ? data.bunch.trim() : null
  reading.usedAliases = 'agents' in data || 'artifacts' in data
  reading.tagCount = normaliseTags(data.tags).length
  return reading
}

export interface ApplyOptions {
  mirrorTags: boolean
  preset: 'okf' | 'basic'
  /** undefined leaves bunch alone, null or a blank string removes it, a name sets it, trimmed. */
  bunch?: string | null
  /** Line ending for a brand-new block when the note has no front matter yet. Default "\n". */
  eol?: '\n' | '\r\n'
  /** Written as id only when the note has none yet. */
  newId: string
  /** Written as created only when the note has none yet. */
  now: string
  /** Written as title only when the note has none yet. Empty writes nothing. */
  title: string
}

function present(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim().length > 0
}

function slug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-')
}

/**
 * Writes ticks into the front matter. This is the only writer of the app-owned keys
 * (bunch, skills, skill_paths, domains, domain_paths, mirrored tags, and on first use
 * id, type, title and created). Every other key and tag is left alone, and so is the
 * body: only the front matter block is returned. Names in the YAML that nobody in the
 * roster has are kept, with an empty path, so a student's typing is never lost, and no
 * name is written twice in any case. The tags list is edited in place, so the student's
 * own tags keep their style, comments and quoting; tags written as a comma string are
 * left alone. Returns null, so the caller writes nothing, when the front matter cannot
 * be parsed, holds a mapping where a list belongs (or inside a list of names), repeats a
 * list key, or cannot be rewritten for any other reason. It never throws.
 */
export function applyTicks(raw: string | null, ticks: Ticks, members: Member[], opts: ApplyOptions): string | null {
  try {
    const parsed = raw === null ? { ok: true as const, data: {} as Record<string, unknown> } : parseFrontMatter(raw)
    if (!parsed.ok) return null
    const data = parsed.data
    const before = readTicks(raw, members)
    if (!before.ok) return null

    const list = (kind: MemberKind, ids: string[]) => {
      const names: string[] = []
      const paths: string[] = []
      for (const m of members.filter((m) => m.kind === kind && ids.includes(m.id))) {
        if (addName(names, m.name)) paths.push(toForwardSlashes(m.path))
      }
      for (const u of before.unknown.filter((u) => u.kind === kind)) {
        if (addName(names, u.name)) paths.push('')
      }
      return { names, paths }
    }
    const skills = list('skill', ticks.skillIds)
    const domains = list('domain', ticks.domainIds)

    let tags: ListEdit | undefined
    if (opts.mirrorTags) {
      const append: string[] = []
      const add = (tag: string) => {
        if (!append.includes(tag)) append.push(tag)
      }
      for (const name of skills.names) add(`skill/${slug(name)}`)
      for (const name of domains.names) add(`domain/${slug(name)}`)
      tags = { removeMatching: MIRRORED_TAG, append }
    }

    const bunch = opts.bunch === undefined ? undefined : (opts.bunch ?? '').trim()
    const patch: FrontMatterPatch = {
      id: present(data.id) ? undefined : opts.newId,
      type: opts.preset === 'basic' || present(data.type) ? undefined : 'note',
      title: present(data.title) || opts.title.length === 0 ? undefined : opts.title,
      created: present(data.created) ? undefined : opts.now,
      bunch: bunch === undefined ? undefined : bunch.length === 0 ? null : bunch,
      skills: skills.names.length > 0 ? skills.names : null,
      skill_paths: skills.names.length > 0 ? skills.paths : null,
      domains: domains.names.length > 0 ? domains.names : null,
      domain_paths: domains.names.length > 0 ? domains.paths : null,
      agents: null,
      agent_paths: null,
      artifacts: null,
      artifact_paths: null,
      tags
    }
    return mergeFrontMatter(raw, patch, opts.eol)
  } catch {
    return null
  }
}
