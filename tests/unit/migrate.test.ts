import { describe, expect, test } from 'vitest'
import { migrateSettings } from '@shared/migrate'
import { DEFAULT_SETTINGS } from '@shared/types'

const v1 = {
  autosave: false,
  seenCoachmark: true,
  mirrorAgentsAsTags: false,
  windowBounds: { width: 1000, height: 700, x: 1, y: 2 },
  members: [
    { id: 'a1', kind: 'agent', name: 'librarian', emoji: '📚', folderIds: ['f1', 'f2', 'missing'] },
    { id: 'a2', kind: 'agent', name: 'tutor', emoji: '🧑', folderIds: [] },
    { id: 'f1', kind: 'folder', name: 'Inbox', emoji: '📥', path: '/sb/Inbox', stamp: { tags: ['raw'] } },
    { id: 'f2', kind: 'folder', name: 'Research', emoji: '🔬', path: '/sb/Research' }
  ]
}

const v11 = {
  autosave: true,
  seenCoachmark: true,
  mirrorMembersAsTags: false,
  confirmedFileMoves: true,
  defaultRawPath: '/brain/raw',
  windowBounds: { width: 1000, height: 700, x: 1, y: 2 },
  members: [
    { id: 'a1', kind: 'agent', name: 'coach', emoji: '🎓', path: '/me/agents/coach' },
    { id: 'x1', kind: 'artifact', name: 'thesis', emoji: '📕', path: '/me/artifacts/thesis' }
  ],
  bunches: [{ id: 'b1', name: 'study', emoji: '👥', rawPath: '/raw', agentIds: ['a1'], artifactIds: ['x1'] }]
}

describe('migrateSettings from 1.0', () => {
  test('folders become domains with the same id, name, emoji and path', () => {
    const out = migrateSettings(v1)
    expect(out.members.find((m) => m.id === 'f1')).toEqual({
      id: 'f1', kind: 'domain', name: 'Inbox', emoji: '📥', path: '/sb/Inbox'
    })
    expect(out.members.find((m) => m.id === 'f2')?.kind).toBe('domain')
  })

  test('agents become skills that keep their identity but have no folder yet', () => {
    const out = migrateSettings(v1)
    expect(out.members.find((m) => m.id === 'a1')).toEqual({
      id: 'a1', kind: 'skill', name: 'librarian', emoji: '📚', path: ''
    })
  })

  test('an agent that read folders becomes a bunch of that skill and those domains', () => {
    const out = migrateSettings(v1)
    expect(out.bunches).toHaveLength(1)
    expect(out.bunches[0]).toEqual({
      id: 'b-a1', name: 'librarian', emoji: '📚', rawPath: '', skillIds: ['a1'], domainIds: ['f1', 'f2']
    })
  })

  test('tag mirroring is switched on and the old keys are gone', () => {
    const out = migrateSettings(v1) as unknown as Record<string, unknown>
    expect(out.mirrorTicksAsTags).toBe(true)
    expect('mirrorAgentsAsTags' in out).toBe(false)
    expect('mirrorMembersAsTags' in out).toBe(false)
  })

  test('other settings survive and the welcome flag carries over', () => {
    const out = migrateSettings(v1) as unknown as Record<string, unknown>
    expect(out.autosave).toBe(false)
    expect(out.seenWelcome).toBe(true)
    expect('seenCoachmark' in out).toBe(false)
    expect(out.windowBounds).toEqual({ width: 1000, height: 700, x: 1, y: 2 })
  })

  test('is idempotent', () => {
    const once = migrateSettings(v1)
    expect(migrateSettings(once)).toEqual(once)
  })
})

describe('migrateSettings from 1.1', () => {
  test('agents become skills and artifacts become domains', () => {
    const out = migrateSettings(v11)
    expect(out.members).toEqual([
      { id: 'a1', kind: 'skill', name: 'coach', emoji: '🎓', path: '/me/agents/coach' },
      { id: 'x1', kind: 'domain', name: 'thesis', emoji: '📕', path: '/me/artifacts/thesis' }
    ])
  })

  test('bunch id lists are renamed', () => {
    const out = migrateSettings(v11)
    expect(out.bunches).toEqual([
      { id: 'b1', name: 'study', emoji: '👥', rawPath: '/raw', skillIds: ['a1'], domainIds: ['x1'] }
    ])
    const raw = out.bunches[0] as unknown as Record<string, unknown>
    expect('agentIds' in raw).toBe(false)
    expect('artifactIds' in raw).toBe(false)
  })

  test('the mirror setting keeps its value under the new name', () => {
    const out = migrateSettings(v11) as unknown as Record<string, unknown>
    expect(out.mirrorTicksAsTags).toBe(false)
    expect('mirrorMembersAsTags' in out).toBe(false)
  })

  test('marks the schema as version 3 and fills the new settings', () => {
    const out = migrateSettings(v11)
    expect(out.schemaVersion).toBe(3)
    expect(out.panes).toEqual({ bunch: true, raw: true, rendered: true })
    expect(out.paneWidths).toEqual(DEFAULT_SETTINGS.paneWidths)
    expect(out.yamlFolded).toBe(true)
    expect(out.seenWelcome).toBe(true)
  })

  test('keeps the rest', () => {
    const out = migrateSettings(v11)
    expect(out.confirmedFileMoves).toBe(true)
    expect(out.defaultRawPath).toBe('/brain/raw')
  })

  test('is idempotent', () => {
    const once = migrateSettings(v11)
    expect(migrateSettings(once)).toEqual(once)
  })
})

describe('migrateSettings with 1.2 settings', () => {
  test('passes members and bunches through and fills defaults', () => {
    const out = migrateSettings({
      schemaVersion: 3,
      members: [{ id: 'x', kind: 'domain', name: 'Thesis', emoji: '📕', path: '/a/thesis' }],
      bunches: [{ id: 'b', name: 'study', emoji: '👥', rawPath: '/raw', skillIds: [], domainIds: ['x'] }]
    })
    expect(out.members).toHaveLength(1)
    expect(out.bunches[0].domainIds).toEqual(['x'])
    expect(out.autosave).toBe(true)
    expect(out.mirrorTicksAsTags).toBe(true)
  })

  test('keeps pane settings that make sense', () => {
    const out = migrateSettings({
      schemaVersion: 3, members: [], bunches: [],
      panes: { bunch: false, raw: true, rendered: false },
      paneWidths: [2, 1, 1],
      yamlFolded: false
    })
    expect(out.panes).toEqual({ bunch: false, raw: true, rendered: false })
    expect(out.paneWidths).toEqual([2, 1, 1])
    expect(out.yamlFolded).toBe(false)
  })

  test('replaces pane settings that do not make sense', () => {
    const out = migrateSettings({
      schemaVersion: 3, members: [], bunches: [],
      panes: { bunch: false, raw: false, rendered: false },
      paneWidths: [1, -1, 'x']
    })
    expect(out.panes).toEqual(DEFAULT_SETTINGS.panes)
    expect(out.paneWidths).toEqual(DEFAULT_SETTINGS.paneWidths)
  })

  test('drops members of an unknown kind', () => {
    const out = migrateSettings({ members: [{ id: 'q', kind: 'folder', name: 'x', emoji: '', path: '' }], bunches: [] })
    expect(out.members).toEqual([])
  })
})

describe('migrateSettings with rubbish', () => {
  test('returns defaults for a non-object', () => {
    expect(migrateSettings(null).members).toEqual([])
    expect(migrateSettings('nope').bunches).toEqual([])
    expect(migrateSettings(null).schemaVersion).toBe(3)
  })
})

describe('migrateSettings with 1.1-shaped members but no bunches key', () => {
  test('keeps paths, renames kinds, and produces no bunches', () => {
    const out = migrateSettings({
      members: [
        { id: 'a1', kind: 'agent', name: 'coach', emoji: '🎓', path: '/me/agents/coach' },
        { id: 'x1', kind: 'artifact', name: 'thesis', emoji: '📕', path: '/me/artifacts/thesis' }
      ]
    })
    expect(out.members).toEqual([
      { id: 'a1', kind: 'skill', name: 'coach', emoji: '🎓', path: '/me/agents/coach' },
      { id: 'x1', kind: 'domain', name: 'thesis', emoji: '📕', path: '/me/artifacts/thesis' }
    ])
    expect(out.bunches).toEqual([])
  })
})

describe('migrateSettings with duplicate ids', () => {
  test('drops a member whose id repeats, keeping the first', () => {
    const out = migrateSettings({
      members: [
        { id: 'a1', kind: 'agent', name: 'first', emoji: '🎓', folderIds: [] },
        { id: 'a1', kind: 'agent', name: 'second', emoji: '🤖', folderIds: [] }
      ]
    })
    expect(out.members).toHaveLength(1)
    expect(out.members[0].name).toBe('first')
  })
})

describe('migrateSettings with members absent (1.0 file)', () => {
  test('migrates to empty members and bunches', () => {
    const out = migrateSettings({ autosave: true })
    expect(out.members).toEqual([])
    expect(out.bunches).toEqual([])
  })
})
