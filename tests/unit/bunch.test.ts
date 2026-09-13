import { describe, expect, test } from 'vitest'
import { buildStamp, membersOf } from '@shared/bunch'
import type { Bunch, Member } from '@shared/types'

const BS = String.fromCharCode(92)
const members: Member[] = [
  { id: 'a1', kind: 'agent', name: 'study-coach', emoji: '🎓', path: `C:${BS}me${BS}agents${BS}study-coach` },
  { id: 'a2', kind: 'agent', name: 'old-agent', emoji: '🤖', path: '' },
  { id: 'x1', kind: 'artifact', name: 'thesis', emoji: '📕', path: '/me/artifacts/thesis' }
]
const bunch: Bunch = {
  id: 'b1', name: 'thesis-team', emoji: '👥', rawPath: '/raw',
  agentIds: ['a1', 'a2', 'ghost'], artifactIds: ['x1', 'a1']
}

describe('membersOf', () => {
  test('resolves ids to members of the right kind and ignores the rest', () => {
    const { agents, artifacts } = membersOf(bunch, members)
    expect(agents.map((m) => m.id)).toEqual(['a1', 'a2'])
    expect(artifacts.map((m) => m.id)).toEqual(['x1'])
  })
})

describe('buildStamp', () => {
  test('lists names and forward-slash paths index for index', () => {
    const stamp = buildStamp(bunch, members, false)
    expect(stamp.bunch).toBe('thesis-team')
    expect(stamp.agents).toEqual(['study-coach', 'old-agent'])
    expect(stamp.agentPaths).toEqual(['C:/me/agents/study-coach', ''])
    expect(stamp.artifacts).toEqual(['thesis'])
    expect(stamp.artifactPaths).toEqual(['/me/artifacts/thesis'])
    expect(stamp.agentIds).toEqual(['a1', 'a2'])
    expect(stamp.artifactIds).toEqual(['x1'])
    expect(stamp.tags).toEqual([])
  })

  test('mirrors members as agent/ and artifact/ tags when asked', () => {
    expect(buildStamp(bunch, members, true).tags).toEqual([
      'agent/study-coach', 'agent/old-agent', 'artifact/thesis'
    ])
  })
})
