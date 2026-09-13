import type { MemberKind } from './types'

/** Anything that makes a folder look like it does work rather than holds work. */
export const AGENT_MARKERS = ['claude.md', 'agents.md', '.claude', 'skills']

/** Proposes a kind for a folder from the names of its top-level entries. */
export function proposeKind(entryNames: string[]): MemberKind {
  const lower = entryNames.map((name) => name.toLowerCase())
  return AGENT_MARKERS.some((marker) => lower.includes(marker)) ? 'agent' : 'artifact'
}
