import type { Bunch, Member, MemberKind } from './types'
import { toForwardSlashes } from './paths'

/** Everything the front matter and the ledger need to say about who a note is for. */
export interface BunchStamp {
  bunch: string
  agents: string[]
  agentPaths: string[]
  artifacts: string[]
  artifactPaths: string[]
  /** Only ids that resolve to a member of the right kind. */
  agentIds: string[]
  artifactIds: string[]
  tags: string[]
}

/** Resolves a bunch's ids to real members, dropping ids that are missing or the wrong kind. */
export function membersOf(bunch: Bunch, members: Member[]): { agents: Member[]; artifacts: Member[] } {
  const byId = new Map(members.map((m) => [m.id, m]))
  const pick = (ids: string[], kind: MemberKind): Member[] =>
    [...new Set(ids)].map((id) => byId.get(id)).filter((m): m is Member => m !== undefined && m.kind === kind)
  return { agents: pick(bunch.agentIds, 'agent'), artifacts: pick(bunch.artifactIds, 'artifact') }
}

export function buildStamp(bunch: Bunch, members: Member[], mirrorAsTags: boolean): BunchStamp {
  const { agents, artifacts } = membersOf(bunch, members)
  const tags: string[] = []
  if (mirrorAsTags) {
    for (const a of agents) tags.push(`agent/${a.name}`)
    for (const b of artifacts) tags.push(`artifact/${b.name}`)
  }
  return {
    bunch: bunch.name,
    agents: agents.map((a) => a.name),
    agentPaths: agents.map((a) => toForwardSlashes(a.path)),
    artifacts: artifacts.map((b) => b.name),
    artifactPaths: artifacts.map((b) => toForwardSlashes(b.path)),
    agentIds: agents.map((a) => a.id),
    artifactIds: artifacts.map((b) => b.id),
    tags
  }
}
