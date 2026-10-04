import type { Member, MemberKind } from './types'
import {
  MIRRORED_TAG,
  mergeFrontMatter,
  normaliseTags,
  parseFrontMatter,
  type FrontMatterPatch
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
  /** False when the front matter cannot be parsed. Nothing else is meaningful then. */
  ok: boolean
  /** Every name listed under skills (or 1.1 agents), known or not, as written. */
  skillNames: string[]
  domainNames: string[]
  /** Names in the YAML that match nobody of that kind in the roster. */
  unknown: UnknownName[]
  bunch: string | null
  /** The note still uses the 1.1 keys agents or artifacts. */
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

/** A YAML list or an Obsidian-style comma string, trimmed, without case-insensitive repeats. */
function names(value: unknown): string[] {
  if (value === null || value === undefined) return []
  const list: unknown[] = Array.isArray(value) ? value : String(value).split(',')
  const out: string[] = []
  for (const item of list) {
    if (item === null || item === undefined || typeof item === 'object') continue
    const name = String(item).trim()
    if (name.length > 0 && !out.some((n) => n.toLowerCase() === name.toLowerCase())) out.push(name)
  }
  return out
}

function findMember(members: Member[], kind: MemberKind, name: string): Member | undefined {
  const lower = name.toLowerCase()
  return members.find((m) => m.kind === kind && m.name.toLowerCase() === lower)
}

/** Which skills and domains a note is ticked for, read straight from its front matter. */
export function readTicks(raw: string | null, members: Member[]): TickReading {
  if (raw === null) return empty(true)
  const parsed = parseFrontMatter(raw)
  if (!parsed.ok) return empty(false)
  const data = parsed.data

  const skillsKey = 'skills' in data ? 'skills' : 'agents' in data ? 'agents' : null
  const domainsKey = 'domains' in data ? 'domains' : 'artifacts' in data ? 'artifacts' : null
  const skillNames = skillsKey ? names(data[skillsKey]) : []
  const domainNames = domainsKey ? names(data[domainsKey]) : []

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
  reading.usedAliases = skillsKey === 'agents' || domainsKey === 'artifacts'
  reading.tagCount = normaliseTags(data.tags).length
  return reading
}

export interface ApplyOptions {
  mirrorTags: boolean
  preset: 'okf' | 'basic'
  /** undefined leaves bunch alone, null or an empty string removes it, a name sets it. */
  bunch?: string | null
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

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/**
 * Writes ticks into the front matter. This is the only writer of the app-owned keys
 * (bunch, skills, skill_paths, domains, domain_paths, mirrored tags, and on first use
 * id, type, title and created). Every other key and tag is left alone, and so is the
 * body: only the front matter block is returned. Names in the YAML that nobody in the
 * roster has are kept, with an empty path, so a student's typing is never lost. Returns
 * null when the front matter cannot be parsed, so the caller writes nothing.
 */
export function applyTicks(raw: string | null, ticks: Ticks, members: Member[], opts: ApplyOptions): string | null {
  const parsed = raw === null ? { ok: true as const, data: {} as Record<string, unknown> } : parseFrontMatter(raw)
  if (!parsed.ok) return null
  const data = parsed.data
  const before = readTicks(raw, members)

  const chosen = (kind: MemberKind, ids: string[]) => members.filter((m) => m.kind === kind && ids.includes(m.id))
  const strangers = (kind: MemberKind) => before.unknown.filter((u) => u.kind === kind).map((u) => u.name)
  const skills = chosen('skill', ticks.skillIds)
  const domains = chosen('domain', ticks.domainIds)

  const skillNames = [...skills.map((m) => m.name), ...strangers('skill')]
  const skillPaths = [...skills.map((m) => toForwardSlashes(m.path)), ...strangers('skill').map(() => '')]
  const domainNames = [...domains.map((m) => m.name), ...strangers('domain')]
  const domainPaths = [...domains.map((m) => toForwardSlashes(m.path)), ...strangers('domain').map(() => '')]

  let tags: string[] | null | undefined
  if (opts.mirrorTags) {
    const existing = normaliseTags(data.tags)
    const next = existing.filter((tag) => !MIRRORED_TAG.test(tag))
    const add = (tag: string) => {
      if (!next.includes(tag)) next.push(tag)
    }
    for (const name of skillNames) add(`skill/${slug(name)}`)
    for (const name of domainNames) add(`domain/${slug(name)}`)
    if (!sameList(next, existing)) tags = next.length > 0 ? next : null
  }

  const patch: FrontMatterPatch = {
    id: present(data.id) ? undefined : opts.newId,
    type: opts.preset === 'basic' || present(data.type) ? undefined : 'note',
    title: present(data.title) || opts.title.length === 0 ? undefined : opts.title,
    created: present(data.created) ? undefined : opts.now,
    bunch: opts.bunch === undefined ? undefined : opts.bunch === null || opts.bunch.trim().length === 0 ? null : opts.bunch,
    skills: skillNames.length > 0 ? skillNames : null,
    skill_paths: skillNames.length > 0 ? skillPaths : null,
    domains: domainNames.length > 0 ? domainNames : null,
    domain_paths: domainNames.length > 0 ? domainPaths : null,
    agents: null,
    agent_paths: null,
    artifacts: null,
    artifact_paths: null,
    tags
  }
  return mergeFrontMatter(raw, patch)
}
