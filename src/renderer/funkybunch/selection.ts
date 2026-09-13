import type { Bunch, Member } from '@shared/types'
import { membersOf } from '@shared/bunch'
import { samePath } from '@shared/paths'

export interface SelectionInput {
  bunches: Bunch[]
  members: Member[]
  /** The tile the student clicked, if any. */
  selectedId: string | null
  /** The bunch this note was last filed to, from the ledger. */
  lastBunchId?: string
  /** Raw folders that cannot be reached right now. */
  missingRawPaths: string[]
}

export interface Tile {
  id: string
  name: string
  emoji: string
  /** Selected for the next filing. */
  picked: boolean
  /** This note was last filed to this bunch. */
  dotted: boolean
  /** The raw folder is set but missing. */
  unavailable: boolean
  /** No agents and no artifacts resolve. */
  empty: boolean
  memberCount: number
}

export interface Plan {
  tiles: Tile[]
  bunch: Bunch | null
  canFile: boolean
  fileLabel: string
  blockedReason: string
}

export function planFiling(input: SelectionInput): Plan {
  const tiles: Tile[] = input.bunches.map((b) => {
    const { agents, artifacts } = membersOf(b, input.members)
    const memberCount = agents.length + artifacts.length
    return {
      id: b.id,
      name: b.name,
      emoji: b.emoji,
      picked: b.id === input.selectedId,
      dotted: b.id === input.lastBunchId,
      unavailable: b.rawPath.length > 0 && input.missingRawPaths.some((p) => samePath(p, b.rawPath)),
      empty: memberCount === 0,
      memberCount
    }
  })

  const bunch = input.bunches.find((b) => b.id === input.selectedId) ?? null
  if (!bunch) return { tiles, bunch: null, canFile: false, fileLabel: 'File', blockedReason: '' }

  const tile = tiles.find((t) => t.id === bunch.id) as Tile
  let blockedReason = ''
  if (tile.empty) blockedReason = `Add an agent or an artifact to ${bunch.name} first.`
  else if (tile.unavailable) blockedReason = `${bunch.name}'s raw folder cannot be reached right now.`

  return {
    tiles,
    bunch,
    canFile: blockedReason.length === 0,
    fileLabel: `File to ${bunch.name}`,
    blockedReason
  }
}
