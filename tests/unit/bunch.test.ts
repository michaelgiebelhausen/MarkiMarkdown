import { describe, expect, test } from 'vitest'
import { buildStamp, membersOf } from '@shared/bunch'
import type { Bunch, Member } from '@shared/types'

const BS = String.fromCharCode(92)
const members: Member[] = [
  { id: 'a1', kind: 'skill', name: 'study-coach', emoji: '🎓', path: `C:${BS}me${BS}agents${BS}study-coach` },
  { id: 'a2', kind: 'skill', name: 'old-skill', emoji: '🤖', path: '' },
  { id: 'x1', kind: 'domain', name: 'thesis', emoji: '📕', path: '/me/artifacts/thesis' }
]
const bunch: Bunch = {
  id: 'b1', name: 'thesis-team', emoji: '👥', rawPath: '/raw',
  skillIds: ['a1', 'a2', 'ghost'], domainIds: ['x1', 'a1']
}

describe('membersOf', () => {
  test('resolves ids to members of the right kind and ignores the rest', () => {
    const { skills, domains } = membersOf(bunch, members)
    expect(skills.map((m) => m.id)).toEqual(['a1', 'a2'])
    expect(domains.map((m) => m.id)).toEqual(['x1'])
  })

  test('dedupes repeated ids', () => {
    expect(membersOf({ ...bunch, skillIds: ['a1', 'a1'] }, members).skills.map((m) => m.id)).toEqual(['a1'])
  })
})

describe('buildStamp', () => {
  test('lists names and forward-slash paths index for index', () => {
    const stamp = buildStamp(bunch, members, false)
    expect(stamp.bunch).toBe('thesis-team')
    expect(stamp.skills).toEqual(['study-coach', 'old-skill'])
    expect(stamp.skillPaths).toEqual(['C:/me/agents/study-coach', ''])
    expect(stamp.domains).toEqual(['thesis'])
    expect(stamp.domainPaths).toEqual(['/me/artifacts/thesis'])
    expect(stamp.skillIds).toEqual(['a1', 'a2'])
    expect(stamp.domainIds).toEqual(['x1'])
    expect(stamp.tags).toEqual([])
  })

  test('mirrors members as skill/ and domain/ tags when asked', () => {
    expect(buildStamp(bunch, members, true).tags).toEqual([
      'skill/study-coach', 'skill/old-skill', 'domain/thesis'
    ])
  })
})
