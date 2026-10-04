import type { MemberKind } from './types'

/** Anything that makes a folder look like it holds skills rather than one subject's material. */
export const SKILL_MARKERS = ['claude.md', 'agents.md', '.claude', 'skills']

/** Proposes a kind for a folder from the names of its top-level entries. */
export function proposeKind(entryNames: string[]): MemberKind {
  const lower = entryNames.map((name) => name.toLowerCase())
  return SKILL_MARKERS.some((marker) => lower.includes(marker)) ? 'skill' : 'domain'
}
