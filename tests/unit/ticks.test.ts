import { describe, expect, test } from 'vitest'
import { applyTicks, readTicks, type ApplyOptions } from '@shared/ticks'
import { parseFrontMatter, splitFrontMatter } from '@shared/markdown/frontmatter'
import type { Member } from '@shared/types'

const BS = String.fromCharCode(92)
export const members: Member[] = [
  { id: 's1', kind: 'skill', name: 'writer', emoji: '✍️', path: `C:${BS}me${BS}skills${BS}writer` },
  { id: 's2', kind: 'skill', name: 'editor', emoji: '🔍', path: '/me/skills/editor' },
  { id: 'd1', kind: 'domain', name: 'Biology', emoji: '🧪', path: '/me/domains/biology' },
  { id: 'd2', kind: 'domain', name: 'History', emoji: '📜', path: '/me/domains/history' }
]

describe('readTicks', () => {
  test('a note with no front matter has no ticks', () => {
    const r = readTicks(null, members)
    expect(r).toEqual({
      ok: true, skillIds: [], domainIds: [], skillNames: [], domainNames: [],
      unknown: [], bunch: null, usedAliases: false, tagCount: 0
    })
  })

  test('maps names to ids, ignoring case', () => {
    const r = readTicks('---\nskills: [Writer, editor]\ndomains: [biology]\n---\n', members)
    expect(r.skillIds).toEqual(['s1', 's2'])
    expect(r.domainIds).toEqual(['d1'])
    expect(r.skillNames).toEqual(['Writer', 'editor'])
    expect(r.unknown).toEqual([])
  })

  test('reads block lists and comma strings', () => {
    expect(readTicks('---\nskills:\n  - writer\n  - editor\n---\n', members).skillIds).toEqual(['s1', 's2'])
    expect(readTicks('---\ndomains: Biology, History\n---\n', members).domainIds).toEqual(['d1', 'd2'])
  })

  test('reports names nobody in the roster has', () => {
    const r = readTicks('---\nskills: [writer, ghost]\ndomains: [Chemistry]\n---\n', members)
    expect(r.skillIds).toEqual(['s1'])
    expect(r.unknown).toEqual([
      { name: 'ghost', kind: 'skill' },
      { name: 'Chemistry', kind: 'domain' }
    ])
    expect(r.skillNames).toEqual(['writer', 'ghost'])
  })

  test('a skill name is not matched against domains', () => {
    const r = readTicks('---\nskills: [Biology]\n---\n', members)
    expect(r.skillIds).toEqual([])
    expect(r.unknown).toEqual([{ name: 'Biology', kind: 'skill' }])
  })

  test('reads the 1.1 keys as aliases', () => {
    const r = readTicks('---\nagents:\n  - writer\nartifacts:\n  - History\n---\n', members)
    expect(r.skillIds).toEqual(['s1'])
    expect(r.domainIds).toEqual(['d2'])
    expect(r.usedAliases).toBe(true)
  })

  test('the new key wins when both are present', () => {
    const r = readTicks('---\nskills: [writer]\nagents: [editor]\n---\n', members)
    expect(r.skillIds).toEqual(['s1'])
    expect(r.usedAliases).toBe(false)
  })

  test('counts a repeated name once', () => {
    expect(readTicks('---\nskills: [writer, Writer]\n---\n', members).skillIds).toEqual(['s1'])
  })

  test('reads the bunch name and the tag count', () => {
    const r = readTicks('---\nbunch: "  Class prep "\ntags: [a, b, "#c"]\n---\n', members)
    expect(r.bunch).toBe('Class prep')
    expect(r.tagCount).toBe(3)
    expect(readTicks('---\ntitle: x\n---\n', members).bunch).toBeNull()
  })

  test('unreadable YAML reports ok false', () => {
    const r = readTicks('---\ntitle: My note: draft\n---\n', members)
    expect(r.ok).toBe(false)
    expect(r.skillIds).toEqual([])
  })
})

const opts: ApplyOptions = {
  mirrorTags: true,
  preset: 'okf',
  newId: 'NEWID',
  now: '2026-10-04T15:00:00-04:00',
  title: ''
}

function data(raw: string | null): Record<string, unknown> {
  const parsed = parseFrontMatter(raw ?? '')
  if (!parsed.ok) throw new Error('unparseable')
  return parsed.data
}

describe('applyTicks', () => {
  test('gives a bare note an id, type, created and the ticks', () => {
    const out = applyTicks(null, { skillIds: ['s1'], domainIds: ['d1'] }, members, opts)
    const d = data(out)
    expect(d.id).toBe('NEWID')
    expect(d.type).toBe('note')
    expect(d.created).toBe('2026-10-04T15:00:00-04:00')
    expect(d.skills).toEqual(['writer'])
    expect(d.skill_paths).toEqual(['C:/me/skills/writer'])
    expect(d.domains).toEqual(['Biology'])
    expect(d.domain_paths).toEqual(['/me/domains/biology'])
    expect(d.tags).toEqual(['skill/writer', 'domain/biology'])
  })

  test('writes the lists as block lists, one item per line', () => {
    const out = applyTicks(null, { skillIds: ['s1', 's2'], domainIds: [] }, members, opts) as string
    expect(out).toContain('skills:\n  - writer\n  - editor')
    expect(out).toContain('skill_paths:\n  - C:/me/skills/writer\n  - /me/skills/editor')
  })

  test('returns only the front matter block, never body text', () => {
    const out = applyTicks('---\ntitle: x\n---\n', { skillIds: ['s1'], domainIds: [] }, members, opts) as string
    expect(splitFrontMatter(out).body).toBe('')
  })

  test('keeps keys and tags the student wrote', () => {
    const raw = '---\ntitle: Cells\nsource: lab book\ntags: [exam-prep]\n---\n'
    const d = data(applyTicks(raw, { skillIds: ['s1'], domainIds: [] }, members, opts))
    expect(d.title).toBe('Cells')
    expect(d.source).toBe('lab book')
    expect(d.tags).toEqual(['exam-prep', 'skill/writer'])
  })

  test('never changes an existing id, created or type', () => {
    const raw = '---\nid: OLD\ncreated: 2025-01-01\ntype: knowledge\n---\n'
    const d = data(applyTicks(raw, { skillIds: ['s1'], domainIds: [] }, members, opts))
    expect(d.id).toBe('OLD')
    expect(d.created).toBe('2025-01-01')
    expect(d.type).toBe('knowledge')
  })

  test('the basic preset writes no type', () => {
    const d = data(applyTicks(null, { skillIds: ['s1'], domainIds: [] }, members, { ...opts, preset: 'basic' }))
    expect('type' in d).toBe(false)
  })

  test('writes a title only when the note has none and one is given', () => {
    expect(data(applyTicks(null, { skillIds: ['s1'], domainIds: [] }, members, { ...opts, title: 'Cells' })).title).toBe('Cells')
    expect(data(applyTicks('---\ntitle: Mine\n---\n', { skillIds: [], domainIds: [] }, members, { ...opts, title: 'Cells' })).title).toBe('Mine')
    expect('title' in data(applyTicks(null, { skillIds: ['s1'], domainIds: [] }, members, opts))).toBe(false)
  })

  test('unticking everything removes the lists and the mirrored tags only', () => {
    const raw = applyTicks('---\ntags: [exam-prep]\n---\n', { skillIds: ['s1'], domainIds: ['d1'] }, members, opts)
    const d = data(applyTicks(raw, { skillIds: [], domainIds: [] }, members, opts))
    for (const key of ['skills', 'skill_paths', 'domains', 'domain_paths']) expect(key in d).toBe(false)
    expect(d.tags).toEqual(['exam-prep'])
    expect(d.id).toBe('NEWID')
  })

  test('removes the tags key when only mirrored tags were there', () => {
    const raw = applyTicks(null, { skillIds: ['s1'], domainIds: [] }, members, opts)
    const d = data(applyTicks(raw, { skillIds: [], domainIds: [] }, members, opts))
    expect('tags' in d).toBe(false)
  })

  test('with mirroring off, tags are left exactly alone', () => {
    const raw = '---\ntags: [skill/old, exam-prep]\n---\n'
    const d = data(applyTicks(raw, { skillIds: ['s1'], domainIds: [] }, members, { ...opts, mirrorTags: false }))
    expect(d.tags).toEqual(['skill/old', 'exam-prep'])
  })

  test('converts a 1.1 note to the new keys and tags', () => {
    const raw =
      '---\nagents:\n  - writer\nagent_paths:\n  - /old\nartifacts:\n  - Biology\nartifact_paths:\n  - /old2\ntags: [agent/writer, artifact/Biology, keep]\n---\n'
    const before = readTicks(raw, members)
    const d = data(applyTicks(raw, before, members, opts))
    for (const key of ['agents', 'agent_paths', 'artifacts', 'artifact_paths']) expect(key in d).toBe(false)
    expect(d.skills).toEqual(['writer'])
    expect(d.domains).toEqual(['Biology'])
    expect(d.tags).toEqual(['keep', 'skill/writer', 'domain/biology'])
  })

  test('keeps names nobody in the roster has, with an empty path', () => {
    const raw = '---\nskills: [writer, ghost]\n---\n'
    const d = data(applyTicks(raw, { skillIds: ['s1', 's2'], domainIds: [] }, members, opts))
    expect(d.skills).toEqual(['writer', 'editor', 'ghost'])
    expect(d.skill_paths).toEqual(['C:/me/skills/writer', '/me/skills/editor', ''])
  })

  test('sets, keeps and removes the bunch name', () => {
    const set = applyTicks(null, { skillIds: ['s1'], domainIds: [] }, members, { ...opts, bunch: 'Class prep' })
    expect(data(set).bunch).toBe('Class prep')
    expect(data(applyTicks(set, { skillIds: [], domainIds: [] }, members, opts)).bunch).toBe('Class prep')
    expect('bunch' in data(applyTicks(set, { skillIds: [], domainIds: [] }, members, { ...opts, bunch: null }))).toBe(false)
  })

  test('mirrored tags use lower case and dashes', () => {
    const roster: Member[] = [{ id: 'd9', kind: 'domain', name: 'Cell Biology', emoji: '🧪', path: '/x' }]
    expect(data(applyTicks(null, { skillIds: [], domainIds: ['d9'] }, roster, opts)).tags).toEqual(['domain/cell-biology'])
  })

  test('what it writes reads back as the same ticks', () => {
    const out = applyTicks(null, { skillIds: ['s2', 's1'], domainIds: ['d2'] }, members, opts)
    const r = readTicks(out, members)
    expect(new Set(r.skillIds)).toEqual(new Set(['s1', 's2']))
    expect(r.domainIds).toEqual(['d2'])
  })

  test('unreadable YAML is left alone', () => {
    expect(applyTicks('---\ntitle: My note: draft\n---\n', { skillIds: ['s1'], domainIds: [] }, members, opts)).toBeNull()
  })
})
