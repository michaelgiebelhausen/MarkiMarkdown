import { DEFAULT_SETTINGS, type Bunch, type Member, type MemberKind, type PaneSet, type Settings } from './types'

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

/** 1.1 said agent and artifact; 1.2 says skill and domain. Both spellings are read. */
function kindOf(value: unknown): MemberKind | null {
  if (value === 'skill' || value === 'agent') return 'skill'
  if (value === 'domain' || value === 'artifact') return 'domain'
  return null
}

function asMember(m: Loose): Member | null {
  const kind = kindOf(m.kind)
  if (!kind) return null
  return { id: str(m.id), kind, name: str(m.name), emoji: str(m.emoji), path: str(m.path) }
}

function asBunch(b: Loose): Bunch {
  return {
    id: str(b.id),
    name: str(b.name),
    emoji: str(b.emoji, '👥'),
    rawPath: str(b.rawPath),
    skillIds: strings(b.skillIds ?? b.agentIds),
    domainIds: strings(b.domainIds ?? b.artifactIds)
  }
}

function asPanes(value: unknown): PaneSet {
  if (isLoose(value)) {
    const panes = { bunch: value.bunch === true, raw: value.raw === true, rendered: value.rendered === true }
    if (panes.bunch || panes.raw || panes.rendered) return panes
  }
  return { ...DEFAULT_SETTINGS.panes }
}

function asWidths(value: unknown): [number, number, number] {
  const fine =
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0)
  return fine ? [value[0], value[1], value[2]] : [...DEFAULT_SETTINGS.paneWidths]
}

/** Folds every older spelling of a setting into the 1.2 shape. */
function finish(rest: Loose, members: Member[], bunches: Bunch[], forceMirror: boolean): Settings {
  const {
    mirrorAgentsAsTags,
    mirrorMembersAsTags,
    mirrorTicksAsTags,
    seenCoachmark,
    seenWelcome,
    panes,
    paneWidths,
    yamlFolded,
    schemaVersion,
    ...others
  } = rest
  void mirrorAgentsAsTags
  void schemaVersion
  const mirror = forceMirror
    ? true
    : typeof mirrorTicksAsTags === 'boolean'
      ? mirrorTicksAsTags
      : typeof mirrorMembersAsTags === 'boolean'
        ? mirrorMembersAsTags
        : true
  return {
    ...DEFAULT_SETTINGS,
    ...(others as Partial<Settings>),
    schemaVersion: 3,
    members,
    bunches,
    mirrorTicksAsTags: mirror,
    seenWelcome: seenWelcome === true || seenCoachmark === true,
    panes: asPanes(panes),
    paneWidths: asWidths(paneWidths),
    yamlFolded: typeof yamlFolded === 'boolean' ? yamlFolded : true
  }
}

/**
 * Settings on disk may be any earlier shape:
 *  - 1.0: folder and agent members, no bunches. Folders become domains, agents become
 *    skills with no folder, and each agent that read folders becomes a bunch. The 1.0
 *    mirror value is discarded on purpose: 1.0 always stored false, but mirroring now
 *    defaults to on.
 *  - 1.1: agents, artifacts, agentIds, artifactIds, mirrorMembersAsTags, seenCoachmark.
 *  - 1.2: skills, domains, schemaVersion 3.
 * Nothing on disk outside settings.json changes, and running this twice is harmless.
 */
export function migrateSettings(raw: unknown): Settings {
  const parsed: Loose = isLoose(raw) ? raw : {}
  const list = Array.isArray(parsed.members) ? parsed.members.filter(isLoose) : []
  const { members: legacyMembers, bunches: legacyBunches, ...rest } = parsed
  void legacyMembers
  void legacyBunches

  const isOne = !Array.isArray(parsed.bunches) && list.some((m) => m.kind === 'folder' || Array.isArray(m.folderIds))

  if (!isOne) {
    const seenIds = new Set<string>()
    const members: Member[] = []
    for (const m of list) {
      const member = asMember(m)
      if (!member || member.id === '' || seenIds.has(member.id)) continue
      seenIds.add(member.id)
      members.push(member)
    }
    const bunches = Array.isArray(parsed.bunches) ? parsed.bunches.filter(isLoose).map(asBunch) : []
    return finish(rest, members, bunches, false)
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
      return { id, kind: 'skill', name: str(m.name, 'skill'), emoji: str(m.emoji, '🤖'), path: str(m.path) }
    }
    return { id, kind: 'domain', name: str(m.name, 'Folder'), emoji: str(m.emoji, '📁'), path: str(m.path) }
  })
  const domainIds = members.filter((m) => m.kind === 'domain').map((m) => m.id)

  const bunches: Bunch[] = []
  for (const m of keptEntries) {
    if (m.kind !== 'agent') continue
    const id = str(m.id)
    const folderIds = strings(m.folderIds).filter((fid) => domainIds.includes(fid))
    if (folderIds.length === 0) continue
    bunches.push({
      id: `b-${id}`,
      name: str(m.name, 'skill'),
      emoji: str(m.emoji, '🤖'),
      rawPath: '',
      skillIds: [id],
      domainIds: folderIds
    })
  }

  return finish(rest, members, bunches, true)
}
