import type { Bunch, Member, MemberKind } from './types'

/** Resolves a bunch's ids to real members, dropping ids that are missing or the wrong kind. */
export function membersOf(bunch: Bunch, members: Member[]): { skills: Member[]; domains: Member[] } {
  const byId = new Map(members.map((m) => [m.id, m]))
  const pick = (ids: string[], kind: MemberKind): Member[] =>
    [...new Set(ids)].map((id) => byId.get(id)).filter((m): m is Member => m !== undefined && m.kind === kind)
  return { skills: pick(bunch.skillIds, 'skill'), domains: pick(bunch.domainIds, 'domain') }
}
