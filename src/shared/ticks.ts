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
   * False when the front matter cannot be parsed, when a key the ticks write (the lists,
   * bunch, or a *_paths key) is written twice, when skills, domains, agents, artifacts or
   * tags holds a mapping, or when a skills, domains, agents or artifacts list holds
   * something other than plain values. Nothing else is meaningful then.
   */
  ok: boolean
  /** Why ok is false, in plain words a student can act on. Empty when ok. */
  reason: string
  /**
   * Every name listed under skills and then 1.1 agents, known or not, as written. Two
   * names count once only when they reach the same member, or, for names nobody has,
   * when they differ only in case; the first spelling is kept.
   */
  skillNames: string[]
  domainNames: string[]
  /** Names in the YAML that match nobody of that kind in the roster. */
  unknown: UnknownName[]
  /**
   * For each member the note names, by member id, the spelling the note uses for it
   * (the first, when it names the member more than once). applyTicks writes this back
   * instead of the roster's name, so ticking something else never respells it.
   */
  spellings: Record<string, string>
  bunch: string | null
  /** The note still has the 1.1 key agents or artifacts, alone or beside the new key. */
  usedAliases: boolean
  tagCount: number
}

function empty(ok: boolean, reason = ''): TickReading {
  return {
    ok,
    reason: ok ? '' : reason,
    skillIds: [],
    domainIds: [],
    skillNames: [],
    domainNames: [],
    unknown: [],
    spellings: {},
    bunch: null,
    usedAliases: false,
    tagCount: 0
  }
}

/**
 * The loosest way two names are compared: trimmed, lower case, and any run of spaces,
 * dashes or underscores counted as one dash. The roster saves "Study Coach" as
 * study-coach, and a student who types either spelling into the YAML means the same skill.
 * It is only the last resort when matching a name to a member (see findMember), and two
 * names are never merged merely because their keys match.
 */
export function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_-]+/g, '-')
}

/**
 * A YAML list or an Obsidian-style comma string, trimmed, empty items dropped, repeats
 * kept (readTicks decides which names count once). Objects are never stringified: a
 * mapping, or a mapping inside a list, gives nothing.
 */
function names(value: unknown): string[] {
  if (value === null || value === undefined) return []
  if (typeof value === 'object' && !Array.isArray(value)) return []
  const list: unknown[] = Array.isArray(value) ? value : String(value).split(',')
  const out: string[] = []
  for (const item of list) {
    if (item === null || item === undefined || typeof item === 'object') continue
    const name = String(item).trim()
    if (name.length > 0) out.push(name)
  }
  return out
}

/** Keys whose value ticks read as a list. A mapping in any of them cannot be ticked safely. */
const LIST_KEYS = ['skills', 'domains', 'agents', 'artifacts', 'tags']

/** Keys applyTicks rewrites wholesale from names, so every item must be a plain name. */
const NAME_KEYS = ['skills', 'domains', 'agents', 'artifacts']

/**
 * Keys applyTicks writes or removes. Written twice, the parsed data keeps only one, so
 * rewriting would silently drop the other, or leave a stale copy beside the new one.
 */
const OWNED_KEYS = [...LIST_KEYS, 'bunch', 'skill_paths', 'domain_paths', 'agent_paths', 'artifact_paths']

/** The parser's message on one line, with where it happened. */
function parseReason(line: number, message: string): string {
  const first = (message.split('\n')[0] ?? '').trim().replace(/:$/, '')
  const where = /\bline \d+/.test(first) ? first : `${first} at line ${line}`
  return `The YAML at the top of this note can't be read: ${where}.`
}

function isMapping(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A list with a mapping or a nested list in it: rewriting it from names would drop that item. */
function hasNonScalarItem(value: unknown): boolean {
  return Array.isArray(value) && value.some((item) => typeof item === 'object' && item !== null)
}

/**
 * The member of this kind a name in the YAML means: the one with exactly that name, else
 * one whose name differs only in case, else one with the same name key. Two members can
 * share a key (1.1 rosters were de-duplicated by id only), so the closer matches come
 * first: "Cell Biology" always means the member called Cell Biology, never its
 * cell-biology twin.
 */
function findMember(members: Member[], kind: MemberKind, name: string): Member | undefined {
  const ofKind = members.filter((m) => m.kind === kind)
  const wanted = name.trim()
  const lower = wanted.toLowerCase()
  const key = nameKey(wanted)
  return (
    ofKind.find((m) => m.name.trim() === wanted) ??
    ofKind.find((m) => m.name.trim().toLowerCase() === lower) ??
    ofKind.find((m) => nameKey(m.name) === key)
  )
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
  if (!parsed.ok) return empty(false, parseReason(parsed.line, parsed.message))
  const data = parsed.data
  const twice = duplicateTopLevelKeys(raw).find((key) => OWNED_KEYS.includes(key))
  if (twice !== undefined) return empty(false, `The key ${twice} appears twice at the top of this note.`)
  const mapping = LIST_KEYS.find((key) => isMapping(data[key]))
  if (mapping !== undefined) return empty(false, `${mapping} holds a group of settings instead of a list.`)
  const nested = NAME_KEYS.find((key) => hasNonScalarItem(data[key]))
  if (nested !== undefined) return empty(false, `An item under ${nested} is not a plain name.`)

  const reading = empty(true)
  // A name counts once only when it reaches a member already counted, or, when nobody has
  // it, when it differs from an unknown name already counted only in case. Names that
  // merely share a name key stay apart, so neither is dropped on the next write.
  const resolve = (key: string, alias: string, kind: MemberKind, ids: string[], out: string[]) => {
    const unknownSeen: string[] = []
    for (const name of [...names(data[key]), ...names(data[alias])]) {
      const member = findMember(members, kind, name)
      if (member) {
        if (ids.includes(member.id)) continue
        ids.push(member.id)
        reading.spellings[member.id] = name
      } else {
        const lower = name.toLowerCase()
        if (unknownSeen.includes(lower)) continue
        unknownSeen.push(lower)
        reading.unknown.push({ name, kind })
      }
      out.push(name)
    }
  }
  resolve('skills', 'agents', 'skill', reading.skillIds, reading.skillNames)
  resolve('domains', 'artifacts', 'domain', reading.domainIds, reading.domainNames)

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
 * body: only the front matter block is returned. A member the note already names keeps
 * the spelling the note uses for it (readTicks' spellings); a newly ticked member is
 * written under the roster's name; paths are always the roster's. Names in the YAML that
 * nobody in the roster has are kept, with an empty path, so a student's typing is never
 * lost. Two names are folded into one only when they reach the same member (or, for
 * unknown names, differ only in case), never because they merely look alike, and the
 * same name is never written twice. The tags list is edited in place, so the student's
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
      // Mirrored tags follow the roster's name, so they stay the same whatever the spelling.
      const tagNames: string[] = []
      for (const m of members.filter((m) => m.kind === kind && ids.includes(m.id))) {
        // A member the note already names keeps the note's spelling; a new tick gets the
        // roster's name. The path is always the roster's.
        const name = before.spellings[m.id] ?? m.name
        // Exactly the same name twice would read back as one member, so the first wins.
        if (names.includes(name)) continue
        names.push(name)
        paths.push(toForwardSlashes(m.path))
        tagNames.push(m.name)
      }
      // readTicks has already counted these once each, and none of them reaches a member.
      for (const u of before.unknown.filter((u) => u.kind === kind)) {
        if (names.includes(u.name)) continue
        names.push(u.name)
        paths.push('')
        tagNames.push(u.name)
      }
      return { names, paths, tagNames }
    }
    const skills = list('skill', ticks.skillIds)
    const domains = list('domain', ticks.domainIds)

    let tags: ListEdit | undefined
    if (opts.mirrorTags) {
      const append: string[] = []
      const add = (tag: string) => {
        if (!append.includes(tag)) append.push(tag)
      }
      for (const name of skills.tagNames) add(`skill/${slug(name)}`)
      for (const name of domains.tagNames) add(`domain/${slug(name)}`)
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
