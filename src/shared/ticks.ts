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
   * Every name listed under skills and then 1.1 agents, known or not, as written and in
   * the note's order. Each member the note names appears once as its spelling (below).
   * Another name reaching the same member is dropped when it differs from that spelling
   * only in case, and otherwise kept as a silent alias: listed here, so it is written
   * back in place, but not ticked twice and not in unknown. Names nobody has, and
   * aliases, count once when they differ only in case; the first is kept. To count
   * names without aliases, use namedCount.
   */
  skillNames: string[]
  domainNames: string[]
  /** Names in the YAML that match nobody of that kind in the roster. */
  unknown: UnknownName[]
  /**
   * For each member the note names, by member id, the spelling the note uses for it:
   * when several names reach it, the closest (exactly its name, then its name in another
   * case, then its name key; the first of equally close ones). applyTicks writes this back
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
  return matchMember(members, kind, name)?.member
}

/**
 * findMember, and how close the match is: 0 for exactly the member's name, 1 for the name
 * in another case, 2 for the same name key only.
 */
function matchMember(members: Member[], kind: MemberKind, name: string): { member: Member; rank: number } | undefined {
  const ofKind = members.filter((m) => m.kind === kind)
  const wanted = name.trim()
  const lower = wanted.toLowerCase()
  const key = nameKey(wanted)
  const exact = ofKind.find((m) => m.name.trim() === wanted)
  if (exact) return { member: exact, rank: 0 }
  const cased = ofKind.find((m) => m.name.trim().toLowerCase() === lower)
  if (cased) return { member: cased, rank: 1 }
  const keyed = ofKind.find((m) => nameKey(m.name) === key)
  return keyed ? { member: keyed, rank: 2 } : undefined
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
  // Every member the note names is represented by the closest of the names that reach it
  // (exactly its name, then its name in another case, then its name key; the first of
  // equally close names), wherever that name sits in the list. Another name that reaches
  // the same member counts once with it when it differs from that spelling only in case;
  // otherwise it is kept as a silent alias (it may be the name of a twin since removed
  // from the roster): listed, so it is written back in place, but not ticked again and
  // not reported as unknown. Names nobody has, and aliases, count once when they differ
  // only in case. Names keep the note's order.
  const resolve = (key: string, alias: string, kind: MemberKind, ids: string[], out: string[]) => {
    const all = [...names(data[key]), ...names(data[alias])]
    const matches = all.map((name) => matchMember(members, kind, name))
    const best = new Map<string, number>()
    matches.forEach((match, index) => {
      if (!match) return
      const previous = best.get(match.member.id)
      if (previous === undefined || match.rank < (matches[previous]?.rank ?? Infinity)) best.set(match.member.id, index)
    })
    const seen: string[] = []
    all.forEach((name, index) => {
      const match = matches[index]
      const lower = name.toLowerCase()
      if (match) {
        const chosen = best.get(match.member.id) ?? index
        if (chosen === index) {
          ids.push(match.member.id)
          reading.spellings[match.member.id] = name
          out.push(name)
          return
        }
        // Another spelling of a member the note already names: a silent alias. It is kept
        // in place, so nothing the student typed disappears, but it ticks nothing more and
        // asks nothing (no chip).
        if ((all[chosen] ?? '').toLowerCase() === lower || seen.includes(lower)) return
        seen.push(lower)
        out.push(name)
        return
      }
      if (seen.includes(lower)) return
      seen.push(lower)
      reading.unknown.push({ name, kind })
      out.push(name)
    })
  }
  resolve('skills', 'agents', 'skill', reading.skillIds, reading.skillNames)
  resolve('domains', 'artifacts', 'domain', reading.domainIds, reading.domainNames)

  reading.bunch = typeof data.bunch === 'string' && data.bunch.trim().length > 0 ? data.bunch.trim() : null
  reading.usedAliases = 'agents' in data || 'artifacts' in data
  reading.tagCount = normaliseTags(data.tags).length
  return reading
}

/**
 * How many skills and domains (or only one kind) the note names: each member once, plus
 * each name nobody has. Aliases are not counted again.
 */
export function namedCount(reading: TickReading, kind?: MemberKind): number {
  const unknown = reading.unknown.filter((u) => kind === undefined || u.kind === kind).length
  const skills = kind === 'domain' ? 0 : reading.skillIds.length
  const domains = kind === 'skill' ? 0 : reading.domainIds.length
  return skills + domains + unknown
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

/** A 1.1 mirrored tag: its # (if any), and agent or artifact. */
const OLD_MIRRORED_TAG = /^(#?)(agent|artifact)\//i

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
 * lost; so is an alias (a second name for a member the note already names more closely),
 * in place, with the member's path and no mirrored tag of its own, unless that member is
 * unticked. Two names are folded into one only when they differ only in
 * case and reach the same member (or nobody), never because they merely look alike, and
 * the same name is never written twice. Names the note already has keep its order; newly
 * ticked members follow, in roster order. The tags list is edited in place, so the student's
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

    const list = (kind: MemberKind, ids: string[], noteNames: string[]) => {
      const names: string[] = []
      const paths: string[] = []
      // Mirrored tags follow the roster's name, so they stay the same whatever the spelling.
      const tagNames: string[] = []
      const push = (name: string, path: string, tag: string | null) => {
        // Exactly the same name twice would read back as one member, so the first wins.
        if (names.includes(name)) return
        names.push(name)
        paths.push(path)
        if (tag !== null) tagNames.push(tag)
      }
      const ofKind = members.filter((m) => m.kind === kind)
      const spelledBy = new Map<string, Member>()
      for (const m of ofKind) {
        const spelling = before.spellings[m.id]
        if (spelling !== undefined) spelledBy.set(spelling, m)
      }
      // 1. The names the note already has, in its own order. A member it names keeps the
      // note's spelling, with the roster's path; an alias (another spelling of a member
      // the note names) keeps its own spelling and also takes the member's path, but no
      // tag of its own, since the member's tag covers it; an unknown name keeps an empty
      // path. A member unticked now goes, and so does every alias of it, or the next read
      // would tick it again.
      for (const name of noteNames) {
        const member = spelledBy.get(name)
        if (member) {
          if (ids.includes(member.id)) push(name, toForwardSlashes(member.path), member.name)
          continue
        }
        const reaches = findMember(members, kind, name)
        if (reaches) {
          if (ids.includes(reaches.id)) push(name, toForwardSlashes(reaches.path), null)
          continue
        }
        push(name, '', name)
      }
      // 2. Members ticked now that the note did not name yet, in roster order, under the
      // roster's name.
      for (const m of ofKind) {
        if (ids.includes(m.id) && before.spellings[m.id] === undefined) push(m.name, toForwardSlashes(m.path), m.name)
      }
      return { names, paths, tagNames }
    }
    const skills = list('skill', ticks.skillIds, before.skillNames)
    const domains = list('domain', ticks.domainIds, before.domainNames)

    let tags: ListEdit | undefined
    if (opts.mirrorTags) {
      const append: string[] = []
      const add = (tag: string) => {
        if (!append.includes(tag)) append.push(tag)
      }
      for (const name of skills.tagNames) add(`skill/${slug(name)}`)
      for (const name of domains.tagNames) add(`domain/${slug(name)}`)
      tags = { removeMatching: MIRRORED_TAG, append }
    } else if (before.usedAliases && Array.isArray(data.tags)) {
      // Mirroring is off, so no tags are written for the ticks; but moving a 1.1 note to
      // the new keys still renames its 1.1 tags, agent/x to skill/x and artifact/x to
      // domain/x, keeping the rest of each tag as written.
      const append: string[] = []
      for (const tag of data.tags) {
        if (typeof tag !== 'string') continue
        const old = OLD_MIRRORED_TAG.exec(tag)
        if (!old) continue
        const renamed = `${old[1]}${old[2].toLowerCase() === 'agent' ? 'skill' : 'domain'}/${tag.slice(old[0].length)}`
        if (!append.includes(renamed)) append.push(renamed)
      }
      if (append.length > 0) tags = { removeMatching: OLD_MIRRORED_TAG, append }
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
