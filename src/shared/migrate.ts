import { DEFAULT_SETTINGS, type Bunch, type Member, type Settings } from './types'

type Loose = Record<string, unknown>

function isLoose(value: unknown): value is Loose {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function asMember(m: Loose): Member | null {
  if (m.kind !== 'agent' && m.kind !== 'artifact') return null
  return { id: str(m.id), kind: m.kind, name: str(m.name), emoji: str(m.emoji), path: str(m.path) }
}

function asBunch(b: Loose): Bunch {
  return {
    id: str(b.id),
    name: str(b.name),
    emoji: str(b.emoji, '👥'),
    rawPath: str(b.rawPath),
    agentIds: strings(b.agentIds),
    artifactIds: strings(b.artifactIds)
  }
}

/**
 * Settings on disk may still be the 1.0 shape: folder and agent members, no bunches.
 * Folders become artifacts. Agents keep their name and emoji but have no folder until
 * the student picks one. Each agent that read folders becomes a bunch of that agent
 * and those artifacts, with the raw folder left for the student to choose. Nothing on
 * disk outside settings.json changes, and running this twice is harmless.
 */
export function migrateSettings(raw: unknown): Settings {
  const parsed: Loose = isLoose(raw) ? raw : {}
  const list = Array.isArray(parsed.members) ? parsed.members.filter(isLoose) : []
  const { mirrorAgentsAsTags: legacyMirror, members: legacyMembers, ...rest } = parsed
  void legacyMirror
  void legacyMembers

  if (Array.isArray(parsed.bunches)) {
    return {
      ...DEFAULT_SETTINGS,
      ...(rest as Partial<Settings>),
      members: list.map(asMember).filter((m): m is Member => m !== null),
      bunches: parsed.bunches.filter(isLoose).map(asBunch)
    }
  }

  const members: Member[] = []
  for (const m of list) {
    if (m.kind === 'folder') {
      members.push({ id: str(m.id), kind: 'artifact', name: str(m.name, 'Folder'), emoji: str(m.emoji, '📁'), path: str(m.path) })
    } else if (m.kind === 'agent') {
      members.push({ id: str(m.id), kind: 'agent', name: str(m.name, 'agent'), emoji: str(m.emoji, '🤖'), path: '' })
    }
  }
  const artifactIds = members.filter((m) => m.kind === 'artifact').map((m) => m.id)

  const bunches: Bunch[] = []
  for (const m of list) {
    if (m.kind !== 'agent') continue
    const folderIds = strings(m.folderIds).filter((id) => artifactIds.includes(id))
    if (folderIds.length === 0) continue
    bunches.push({
      id: `b-${str(m.id)}`,
      name: str(m.name, 'agent'),
      emoji: str(m.emoji, '🤖'),
      rawPath: '',
      agentIds: [str(m.id)],
      artifactIds: folderIds
    })
  }

  return { ...DEFAULT_SETTINGS, ...(rest as Partial<Settings>), members, bunches, mirrorMembersAsTags: true }
}
