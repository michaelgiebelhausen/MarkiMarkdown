import { describe, expect, test } from 'vitest'
import { proposeKind } from '@shared/memberKind'

describe('proposeKind', () => {
  test('a folder with CLAUDE.md is an agent', () => {
    expect(proposeKind(['CLAUDE.md', 'notes.md'])).toBe('agent')
  })

  test('a folder with AGENTS.md is an agent', () => {
    expect(proposeKind(['AGENTS.md'])).toBe('agent')
  })

  test('a folder with a .claude directory is an agent', () => {
    expect(proposeKind(['.claude', 'README.md'])).toBe('agent')
  })

  test('a folder with a skills directory is an agent', () => {
    expect(proposeKind(['skills'])).toBe('agent')
  })

  test('matching ignores case', () => {
    expect(proposeKind(['claude.md'])).toBe('agent')
    expect(proposeKind(['Skills'])).toBe('agent')
  })

  test('anything else is an artifact', () => {
    expect(proposeKind(['chapter-1.md', 'figures'])).toBe('artifact')
    expect(proposeKind([])).toBe('artifact')
  })
})
