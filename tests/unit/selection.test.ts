import { describe, expect, test } from 'vitest'
import { planFiling, toggle, emptySelection } from '@renderer/funkybunch/selection'
import type { Member, SelectionInput } from '@renderer/funkybunch/selection'

const inbox: Member = { id: 'f1', kind: 'folder', name: 'Inbox', emoji: '📥', path: '/sb/Inbox' }
const research: Member = { id: 'f2', kind: 'folder', name: 'Research', emoji: '🔬', path: '/sb/Research' }
const archive: Member = { id: 'f3', kind: 'folder', name: 'Archive', emoji: '🗄️', path: '/sb/Archive' }
const librarian: Member = { id: 'a1', kind: 'agent', name: 'librarian', emoji: '📚', folderIds: ['f1', 'f2'] }
const tutor: Member = { id: 'a2', kind: 'agent', name: 'tutor', emoji: '🧑‍🏫', folderIds: [] }

const members = [librarian, tutor, inbox, research, archive]

function input(over: Partial<SelectionInput> = {}): SelectionInput {
  return { ...emptySelection(members), ...over }
}

const tile = (p: ReturnType<typeof planFiling>, id: string) => p.tiles.find((t) => t.id === id)!

describe('planFiling - a fresh note from Downloads', () => {
  test('nothing is selected, so there is nothing to file', () => {
    const plan = planFiling(input())
    expect(plan.pendingCount).toBe(0)
    expect(plan.canFile).toBe(false)
    expect(plan.addFolderIds).toEqual([])
  })

  test('picking a folder makes it the single destination', () => {
    const plan = planFiling(toggle(input(), 'f1'))
    expect(plan.addFolderIds).toEqual(['f1'])
    expect(plan.canFile).toBe(true)
    expect(plan.fileLabel).toBe('File to 1 place')
    expect(tile(plan, 'f1').picked).toBe(true)
  })

  test('picking an agent also selects the folders that agent reads', () => {
    const plan = planFiling(toggle(input(), 'a1'))
    expect(plan.agentNames).toEqual(['librarian'])
    expect(plan.addFolderIds).toEqual(['f1', 'f2'])
    expect(plan.fileLabel).toBe('File to 2 places')
    expect(tile(plan, 'a1').picked).toBe(true)
    expect(tile(plan, 'f1').implied).toBe(true)
    expect(tile(plan, 'f2').implied).toBe(true)
    expect(tile(plan, 'f3').implied).toBe(false)
  })

  test('a folder implied by an agent can be switched off again', () => {
    let sel = toggle(input(), 'a1')
    sel = toggle(sel, 'f2')
    const plan = planFiling(sel)
    expect(plan.addFolderIds).toEqual(['f1'])
    expect(plan.agentNames).toEqual(['librarian'])
    expect(tile(plan, 'f2').implied).toBe(false)
    expect(tile(plan, 'f2').picked).toBe(false)
  })

  test('an agent with no folders only tags the note', () => {
    const plan = planFiling(toggle(input(), 'a2'))
    expect(plan.agentNames).toEqual(['tutor'])
    expect(plan.addFolderIds).toEqual([])
    expect(plan.canFile).toBe(false)
  })

  test('two agents sharing a folder select it once', () => {
    const shared: Member = { id: 'a3', kind: 'agent', name: 'grader', emoji: '✅', folderIds: ['f1'] }
    let sel = emptySelection([...members, shared])
    sel = toggle(sel, 'a1')
    sel = toggle(sel, 'a3')
    const plan = planFiling(sel)
    expect(plan.addFolderIds).toEqual(['f1', 'f2'])
    expect(plan.agentNames).toEqual(['librarian', 'grader'])
  })
})

describe('planFiling - a note that already lives somewhere', () => {
  const filed = () => input({ currentPaths: ['/sb/Inbox'], currentAgents: ['librarian'] })

  test('shows a dot on the folder it lives in and the agent it is tagged for', () => {
    const plan = planFiling(filed())
    expect(tile(plan, 'f1').dotted).toBe(true)
    expect(tile(plan, 'a1').dotted).toBe(true)
    expect(tile(plan, 'f2').dotted).toBe(false)
  })

  test('stays where it is when nothing is toggled', () => {
    const plan = planFiling(filed())
    expect(plan.keepFolderIds).toEqual(['f1'])
    expect(plan.addFolderIds).toEqual([])
    expect(plan.removeFolderIds).toEqual([])
    expect(plan.pendingCount).toBe(0)
  })

  test('adding a second folder files one new copy and keeps the first', () => {
    const plan = planFiling(toggle(filed(), 'f2'))
    expect(plan.addFolderIds).toEqual(['f2'])
    expect(plan.keepFolderIds).toEqual(['f1'])
    expect(plan.fileLabel).toBe('File to 1 place')
  })

  test('switching off a folder it lives in schedules that copy for removal', () => {
    let sel = filed()
    sel = toggle(sel, 'f2')
    sel = toggle(sel, 'f1')
    const plan = planFiling(sel)
    expect(plan.removeFolderIds).toEqual(['f1'])
    expect(plan.addFolderIds).toEqual(['f2'])
    expect(plan.canFile).toBe(true)
  })

  test('refuses to remove the only remaining copy', () => {
    const plan = planFiling(toggle(filed(), 'f1'))
    expect(plan.removeFolderIds).toEqual(['f1'])
    expect(plan.wouldOrphan).toBe(true)
    expect(plan.canFile).toBe(false)
    expect(plan.blockedReason).toContain('only copy')
  })

  test('switching off a tagged agent drops it from the agents list', () => {
    const plan = planFiling(toggle(filed(), 'a1'))
    expect(plan.agentNames).toEqual([])
    expect(plan.pendingCount).toBeGreaterThan(0)
    expect(plan.canFile).toBe(true)
    expect(plan.fileLabel).toBe('Update note')
  })

  test('keeps an agent name the app does not know about', () => {
    const plan = planFiling(input({ currentPaths: ['/sb/Inbox'], currentAgents: ['some-other-bot'] }))
    expect(plan.agentNames).toEqual(['some-other-bot'])
  })

  test('marks folders holding another copy of the same note as siblings', () => {
    const plan = planFiling(input({ currentPaths: ['/sb/Inbox'], siblingPaths: ['/sb/Archive'] }))
    expect(tile(plan, 'f3').sibling).toBe(true)
    expect(tile(plan, 'f1').sibling).toBe(false)
  })

  test('marks a folder whose path has gone missing as unavailable and refuses to file into it', () => {
    const plan = planFiling(toggle(input(), 'f2'), ['/sb/Research'])
    expect(tile(plan, 'f2').unavailable).toBe(true)
    expect(plan.canFile).toBe(false)
    expect(plan.blockedReason).toContain('Research')
  })

  test('compares folder paths without being confused by trailing separators or case', () => {
    const plan = planFiling(input({ currentPaths: ['/sb/inbox/'] }))
    expect(tile(plan, 'f1').dotted).toBe(true)
  })
})

describe('toggle', () => {
  test('is its own inverse', () => {
    const start = input()
    const there = toggle(start, 'f1')
    const back = toggle(there, 'f1')
    expect(planFiling(back).addFolderIds).toEqual([])
    expect(planFiling(there).addFolderIds).toEqual(['f1'])
  })

  test('does not mutate the input', () => {
    const start = input()
    const before = JSON.stringify(start)
    toggle(start, 'f1')
    expect(JSON.stringify(start)).toBe(before)
  })

  test('ignores an unknown id', () => {
    expect(() => toggle(input(), 'nope')).not.toThrow()
    expect(planFiling(toggle(input(), 'nope')).pendingCount).toBe(0)
  })
})
