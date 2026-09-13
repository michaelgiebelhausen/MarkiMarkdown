import { describe, expect, test } from 'vitest'
import { planFiling, type SelectionInput } from '@renderer/funkybunch/selection'
import type { Bunch, Member } from '@shared/types'

const members: Member[] = [
  { id: 'a1', kind: 'agent', name: 'librarian', emoji: '📚', path: '/agents/librarian' },
  { id: 'x1', kind: 'artifact', name: 'thesis', emoji: '📕', path: '/artifacts/thesis' }
]

const study: Bunch = { id: 'b1', name: 'study', emoji: '👥', rawPath: '/sb/raw', agentIds: ['a1'], artifactIds: ['x1'] }
const empty: Bunch = { id: 'b2', name: 'lonely', emoji: '🫥', rawPath: '/sb/raw', agentIds: ['ghost'], artifactIds: [] }
const noRaw: Bunch = { id: 'b3', name: 'later', emoji: '⏳', rawPath: '', agentIds: ['a1'], artifactIds: [] }

function input(over: Partial<SelectionInput> = {}): SelectionInput {
  return { bunches: [study, empty, noRaw], members, selectedId: null, missingRawPaths: [], ...over }
}

const tile = (id: string, over: Partial<SelectionInput> = {}) => planFiling(input(over)).tiles.find((t) => t.id === id)!

describe('planFiling with nothing selected', () => {
  test('cannot file and shows one tile per bunch', () => {
    const plan = planFiling(input())
    expect(plan.bunch).toBeNull()
    expect(plan.canFile).toBe(false)
    expect(plan.fileLabel).toBe('File')
    expect(plan.tiles.map((t) => t.id)).toEqual(['b1', 'b2', 'b3'])
    expect(plan.tiles.every((t) => !t.picked)).toBe(true)
  })

  test('counts only members that really exist', () => {
    expect(tile('b1').memberCount).toBe(2)
    expect(tile('b2').memberCount).toBe(0)
    expect(tile('b2').empty).toBe(true)
  })

  test('dots the bunch the note was last filed to', () => {
    expect(tile('b1', { lastBunchId: 'b1' }).dotted).toBe(true)
    expect(tile('b2', { lastBunchId: 'b1' }).dotted).toBe(false)
  })
})

describe('planFiling with a bunch selected', () => {
  test('a healthy bunch can be filed to', () => {
    const plan = planFiling(input({ selectedId: 'b1' }))
    expect(plan.bunch?.id).toBe('b1')
    expect(plan.canFile).toBe(true)
    expect(plan.fileLabel).toBe('File to study')
    expect(plan.blockedReason).toBe('')
    expect(tile('b1', { selectedId: 'b1' }).picked).toBe(true)
  })

  test('a bunch with no members is blocked', () => {
    const plan = planFiling(input({ selectedId: 'b2' }))
    expect(plan.canFile).toBe(false)
    expect(plan.blockedReason).toContain('lonely')
    expect(plan.blockedReason).toContain('Add an agent or an artifact')
  })

  test('a bunch whose raw folder is missing is blocked and flagged', () => {
    const plan = planFiling(input({ selectedId: 'b1', missingRawPaths: ['/sb/raw/'] }))
    expect(plan.canFile).toBe(false)
    expect(plan.blockedReason).toContain('cannot be reached')
    expect(plan.tiles.find((t) => t.id === 'b1')?.unavailable).toBe(true)
  })

  test('a bunch with no raw folder yet is not blocked, the app asks at filing time', () => {
    const plan = planFiling(input({ selectedId: 'b3', missingRawPaths: [''] }))
    expect(plan.canFile).toBe(true)
    expect(plan.tiles.find((t) => t.id === 'b3')?.unavailable).toBe(false)
  })

  test('an unknown selection behaves like no selection', () => {
    expect(planFiling(input({ selectedId: 'nope' })).bunch).toBeNull()
  })
})
