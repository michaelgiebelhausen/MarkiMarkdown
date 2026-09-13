import { describe, expect, test } from 'vitest'
import { migrateSettings } from '@shared/migrate'

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

describe('migrateSettings from 1.0', () => {
  test('folders become artifacts with the same id, name, emoji and path', () => {
    const out = migrateSettings(v1)
    expect(out.members.find((m) => m.id === 'f1')).toEqual({
      id: 'f1', kind: 'artifact', name: 'Inbox', emoji: '📥', path: '/sb/Inbox'
    })
    expect(out.members.find((m) => m.id === 'f2')?.kind).toBe('artifact')
  })

  test('agents keep their identity but have no folder yet', () => {
    const out = migrateSettings(v1)
    expect(out.members.find((m) => m.id === 'a1')).toEqual({
      id: 'a1', kind: 'agent', name: 'librarian', emoji: '📚', path: ''
    })
  })

  test('an agent that read folders becomes a bunch of that agent and those artifacts', () => {
    const out = migrateSettings(v1)
    expect(out.bunches).toHaveLength(1)
    expect(out.bunches[0]).toEqual({
      id: 'b-a1', name: 'librarian', emoji: '📚', rawPath: '', agentIds: ['a1'], artifactIds: ['f1', 'f2']
    })
  })

  test('tag mirroring is switched on and the old key is gone', () => {
    const out = migrateSettings(v1) as unknown as Record<string, unknown>
    expect(out.mirrorMembersAsTags).toBe(true)
    expect('mirrorAgentsAsTags' in out).toBe(false)
  })

  test('other settings survive', () => {
    const out = migrateSettings(v1) as unknown as Record<string, unknown>
    expect(out.autosave).toBe(false)
    expect(out.seenCoachmark).toBe(true)
    expect(out.windowBounds).toEqual({ width: 1000, height: 700, x: 1, y: 2 })
  })

  test('is idempotent', () => {
    const once = migrateSettings(v1)
    expect(migrateSettings(once)).toEqual(once)
  })
})

describe('migrateSettings with 2.0 settings', () => {
  test('passes members and bunches through and fills defaults', () => {
    const out = migrateSettings({
      members: [{ id: 'x', kind: 'artifact', name: 'Thesis', emoji: '📕', path: '/a/thesis' }],
      bunches: [{ id: 'b', name: 'study', emoji: '👥', rawPath: '/raw', agentIds: [], artifactIds: ['x'] }]
    })
    expect(out.members).toHaveLength(1)
    expect(out.bunches[0].artifactIds).toEqual(['x'])
    expect(out.autosave).toBe(true)
    expect(out.mirrorMembersAsTags).toBe(true)
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
  })
})
