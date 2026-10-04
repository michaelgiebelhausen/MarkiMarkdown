import type { Bunch, Member, MemberKind } from './types'
import { toForwardSlashes } from './paths'

/** Everything the front matter and the ledger need to say about who a note is for. */
export interface BunchStamp {
  bunch: string
  skills: string[]
  skillPaths: string[]
  domains: string[]
  domainPaths: string[]
  /** Only ids that resolve to a member of the right kind. */
  skillIds: string[]
  domainIds: string[]
  tags: string[]
}

/** Resolves a bunch's ids to real members, dropping ids that are missing or the wrong kind. */
export function membersOf(bunch: Bunch, members: Member[]): { skills: Member[]; domains: Member[] } {
  const byId = new Map(members.map((m) => [m.id, m]))
  const pick = (ids: string[], kind: MemberKind): Member[] =>
    [...new Set(ids)].map((id) => byId.get(id)).filter((m): m is Member => m !== undefined && m.kind === kind)
  return { skills: pick(bunch.skillIds, 'skill'), domains: pick(bunch.domainIds, 'domain') }
}

export function buildStamp(bunch: Bunch, members: Member[], mirrorAsTags: boolean): BunchStamp {
  const { skills, domains } = membersOf(bunch, members)
  const tags: string[] = []
  if (mirrorAsTags) {
    for (const s of skills) tags.push(`skill/${s.name}`)
    for (const d of domains) tags.push(`domain/${d.name}`)
  }
  return {
    bunch: bunch.name,
    skills: skills.map((s) => s.name),
    skillPaths: skills.map((s) => toForwardSlashes(s.path)),
    domains: domains.map((d) => d.name),
    domainPaths: domains.map((d) => toForwardSlashes(d.path)),
    skillIds: skills.map((s) => s.id),
    domainIds: domains.map((d) => d.id),
    tags
  }
}
