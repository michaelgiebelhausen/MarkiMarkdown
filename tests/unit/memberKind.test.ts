import { describe, expect, test } from 'vitest'
import { proposeKind } from '@shared/memberKind'

describe('proposeKind', () => {
  test('a folder with CLAUDE.md is a skill folder', () => {
    expect(proposeKind(['CLAUDE.md', 'notes.md'])).toBe('skill')
  })

  test('a folder with AGENTS.md is a skill folder', () => {
    expect(proposeKind(['AGENTS.md'])).toBe('skill')
  })

  test('a folder with a .claude directory is a skill folder', () => {
    expect(proposeKind(['.claude', 'README.md'])).toBe('skill')
  })

  test('a folder with a skills directory is a skill folder', () => {
    expect(proposeKind(['skills'])).toBe('skill')
  })

  test('matching ignores case', () => {
    expect(proposeKind(['claude.md'])).toBe('skill')
    expect(proposeKind(['Skills'])).toBe('skill')
  })

  test('anything else is a domain', () => {
    expect(proposeKind(['chapter-1.md', 'figures'])).toBe('domain')
    expect(proposeKind([])).toBe('domain')
  })
})
