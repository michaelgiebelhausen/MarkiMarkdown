import type { Member, MemberKind } from './types'
import { normaliseTags, parseFrontMatter } from './markdown/frontmatter'

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
