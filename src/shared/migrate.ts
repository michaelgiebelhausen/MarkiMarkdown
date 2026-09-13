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
 * disk outside settings.json changes, and running this twice is harmless. The 1.0
 * `mirrorAgentsAsTags` value is deliberately discarded rather than carried over: every
 * 1.0 file persisted an explicit `false`, but the product decision for 2.0 is that tag
 * mirroring defaults to on.
 */
export function migrateSettings(raw: unknown): Settings {
  const parsed: Loose = isLoose(raw) ? raw : {}
  const list = Array.isArray(parsed.members) ? parsed.members.filter(isLoose) : []
  const { mirrorAgentsAsTags: legacyMirror, members: legacyMembers, ...rest } = parsed
  void legacyMirror
  void legacyMembers

  if (Array.isArray(parsed.bunches)) {
    const seenIds = new Set<string>()
    const members: Member[] = []
    for (const m of list) {
      const member = asMember(m)
      if (!member || member.id === '' || seenIds.has(member.id)) continue
      seenIds.add(member.id)
      members.push(member)
    }
    return {
      ...DEFAULT_SETTINGS,
      ...(rest as Partial<Settings>),
      members,
      bunches: parsed.bunches.filter(isLoose).map(asBunch)
    }
  }

  const seenIds = new Set<string>()
  const keptEntries: Loose[] = []
  for (const m of list) {
    const id = str(m.id)
    if (id === '' || seenIds.has(id)) continue
    if (m.kind !== 'folder' && m.kind !== 'agent' && m.kind !== 'artifact') continue
    seenIds.add(id)
    keptEntries.push(m)
  }

  const members: Member[] = keptEntries.map((m) => {
    const id = str(m.id)
    if (m.kind === 'agent') {
      return { id, kind: 'agent', name: str(m.name, 'agent'), emoji: str(m.emoji, '🤖'), path: str(m.path) }
    }
    return { id, kind: 'artifact', name: str(m.name, 'Folder'), emoji: str(m.emoji, '📁'), path: str(m.path) }
  })
  const artifactIds = members.filter((m) => m.kind === 'artifact').map((m) => m.id)

  const bunches: Bunch[] = []
  for (const m of keptEntries) {
    if (m.kind !== 'agent') continue
    const id = str(m.id)
    const folderIds = strings(m.folderIds).filter((fid) => artifactIds.includes(fid))
    if (folderIds.length === 0) continue
    bunches.push({
      id: `b-${id}`,
      name: str(m.name, 'agent'),
      emoji: str(m.emoji, '🤖'),
      rawPath: '',
      agentIds: [id],
      artifactIds: folderIds
    })
  }

  return { ...DEFAULT_SETTINGS, ...(rest as Partial<Settings>), members, bunches, mirrorMembersAsTags: true }
}
