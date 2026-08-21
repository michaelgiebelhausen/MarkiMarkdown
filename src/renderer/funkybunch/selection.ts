import type { AgentMember, FolderMember, Member } from '@shared/types'
import { samePath } from '@shared/paths'

export type { Member, AgentMember, FolderMember }
export { samePath }

export interface SelectionInput {
  members: Member[]
  /** Folder paths this note currently occupies. */
  currentPaths: string[]
  /** Agent names already written in the note's front matter. */
  currentAgents: string[]
  /** Tiles the student switched ON. */
  pickedIds: string[]
  /** Tiles the student switched OFF. */
  droppedIds: string[]
  /** Folder paths holding another copy of the same note. */
  siblingPaths: string[]
}

export interface Tile {
  id: string
  kind: 'folder' | 'agent'
  name: string
  emoji: string
  /** The note lives here, or this agent is already listed. */
  dotted: boolean
  /** Selected for the next filing. */
  picked: boolean
  /** A folder pulled in by a selected agent rather than chosen directly. */
  implied: boolean
  /** Another copy of this note lives here. */
  sibling: boolean
  /** The folder is missing or unwritable. */
  unavailable: boolean
}

export interface Plan {
  tiles: Tile[]
  addFolderIds: string[]
  keepFolderIds: string[]
  removeFolderIds: string[]
  agentNames: string[]
  pendingCount: number
  canFile: boolean
  wouldOrphan: boolean
  fileLabel: string
  blockedReason: string
}

export function emptySelection(members: Member[]): SelectionInput {
  return { members, currentPaths: [], currentAgents: [], pickedIds: [], droppedIds: [], siblingPaths: [] }
}


const isFolder = (m: Member): m is FolderMember => m.kind === 'folder'
const isAgent = (m: Member): m is AgentMember => m.kind === 'agent'

function uniq(values: string[]): string[] {
  return values.filter((v, i) => values.indexOf(v) === i)
}

export function toggle(input: SelectionInput, id: string): SelectionInput {
  const known = input.members.some((m) => m.id === id)
  if (!known) return input
  const currentlyOn = isOn(input, id)
  return {
    ...input,
    pickedIds: currentlyOn ? input.pickedIds.filter((p) => p !== id) : uniq([...input.pickedIds, id]),
    droppedIds: currentlyOn ? uniq([...input.droppedIds, id]) : input.droppedIds.filter((d) => d !== id)
  }
}

export function clearSelection(input: SelectionInput): SelectionInput {
  return { ...input, pickedIds: [], droppedIds: [] }
}

/** Whether a tile currently reads as selected, before any display refinements. */
function isOn(input: SelectionInput, id: string): boolean {
  const member = input.members.find((m) => m.id === id)
  if (!member) return false
  if (input.droppedIds.includes(id)) return false
  if (input.pickedIds.includes(id)) return true
  if (isFolder(member)) {
    if (input.currentPaths.some((p) => samePath(p, member.path))) return true
    return impliedFolderIds(input).includes(id)
  }
  return input.currentAgents.includes(member.name)
}

function activeAgents(input: SelectionInput): AgentMember[] {
  return input.members.filter(isAgent).filter((a) => {
    if (input.droppedIds.includes(a.id)) return false
    return input.pickedIds.includes(a.id) || input.currentAgents.includes(a.name)
  })
}

/**
 * Only an agent the student just switched ON pulls its folders in. An agent already
 * recorded in the note's front matter must not keep proposing new copies every time
 * the note is opened.
 */
function impliedFolderIds(input: SelectionInput): string[] {
  const ids: string[] = []
  const justPicked = input.members
    .filter(isAgent)
    .filter((a) => input.pickedIds.includes(a.id) && !input.droppedIds.includes(a.id))
  for (const agent of justPicked) {
    for (const fid of agent.folderIds) {
      if (!input.droppedIds.includes(fid) && !ids.includes(fid)) ids.push(fid)
    }
  }
  return ids
}

export function planFiling(input: SelectionInput, missingFolderPaths: string[] = []): Plan {
  const folders = input.members.filter(isFolder)
  const implied = impliedFolderIds(input)

  const currentFolderIds = folders
    .filter((f) => input.currentPaths.some((p) => samePath(p, f.path)))
    .map((f) => f.id)

  const selectedFolderIds = folders
    .filter((f) => {
      if (input.droppedIds.includes(f.id)) return false
      return (
        input.pickedIds.includes(f.id) ||
        currentFolderIds.includes(f.id) ||
        implied.includes(f.id)
      )
    })
    .map((f) => f.id)

  const addFolderIds = selectedFolderIds.filter((id) => !currentFolderIds.includes(id))
  const keepFolderIds = selectedFolderIds.filter((id) => currentFolderIds.includes(id))
  const removeFolderIds = currentFolderIds.filter((id) => !selectedFolderIds.includes(id))

  const known = activeAgents(input).map((a) => a.name)
  const knownNames = input.members.filter(isAgent).map((a) => a.name)
  const unknown = input.currentAgents.filter(
    (n) => !knownNames.includes(n) && !known.includes(n)
  )
  const agentNames = uniq([...known, ...unknown])

  const tiles: Tile[] = input.members.map((m) => {
    const folder = isFolder(m) ? m : null
    return {
      id: m.id,
      kind: m.kind,
      name: m.name,
      emoji: m.emoji,
      dotted: folder
        ? currentFolderIds.includes(m.id)
        : input.currentAgents.includes(m.name),
      picked: folder ? selectedFolderIds.includes(m.id) : known.includes(m.name),
      implied: folder
        ? implied.includes(m.id) && !input.pickedIds.includes(m.id) && !currentFolderIds.includes(m.id)
        : false,
      sibling: folder ? input.siblingPaths.some((p) => samePath(p, folder.path)) : false,
      unavailable: folder ? missingFolderPaths.some((p) => samePath(p, folder.path)) : false
    }
  })

  const agentsChanged =
    agentNames.length !== input.currentAgents.length ||
    agentNames.some((n) => !input.currentAgents.includes(n))

  const pendingCount = addFolderIds.length + removeFolderIds.length + (agentsChanged ? 1 : 0)
  const wouldOrphan = selectedFolderIds.length === 0 && removeFolderIds.length > 0

  const brokenTargets = tiles.filter((t) => t.unavailable && selectedFolderIds.includes(t.id))

  let blockedReason = ''
  if (wouldOrphan) blockedReason = 'That is the only copy - file it somewhere else first.'
  else if (brokenTargets.length > 0) {
    blockedReason = `${brokenTargets.map((t) => t.name).join(', ')} cannot be reached right now.`
  }

  // Changing only the agent list is worth saving, but there has to be a file to save it into.
  const hasDestination = selectedFolderIds.length > 0
  const somethingToDo =
    addFolderIds.length > 0 || removeFolderIds.length > 0 || (agentsChanged && hasDestination)
  const canFile = somethingToDo && !wouldOrphan && brokenTargets.length === 0

  const places = addFolderIds.length
  const fileLabel =
    places > 0 ? `File to ${places} place${places === 1 ? '' : 's'}` : pendingCount > 0 ? 'Update note' : 'File'

  return {
    tiles,
    addFolderIds,
    keepFolderIds,
    removeFolderIds,
    agentNames,
    pendingCount,
    canFile,
    wouldOrphan,
    fileLabel,
    blockedReason
  }
}
