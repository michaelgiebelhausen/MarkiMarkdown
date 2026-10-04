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

  test('reads names from both the new key and the 1.1 key, new key first', () => {
    const r = readTicks('---\nskills: [editor]\nagents: [writer, Editor]\n---\n', members)
    expect(r.skillIds).toEqual(['s2', 's1'])
    expect(r.skillNames).toEqual(['editor', 'writer'])
    expect(r.usedAliases).toBe(true)
  })

  test('an empty new key does not hide names under the 1.1 key', () => {
    const r = readTicks('---\nskills:\nagents: [writer, ghost]\n---\n', members)
    expect(r.skillIds).toEqual(['s1'])
    expect(r.unknown).toEqual([{ name: 'ghost', kind: 'skill' }])
    expect(r.usedAliases).toBe(true)
  })

  test('a mapping where a list belongs reports ok false', () => {
    for (const key of ['skills', 'domains', 'agents', 'artifacts', 'tags']) {
      const r = readTicks(`---\n${key}:\n  a: writer\n---\n`, members)
      expect(r.ok).toBe(false)
      expect(r.skillNames).toEqual([])
    }
  })

  test('a mapping or a nested list inside a list reports ok false', () => {
    for (const key of ['skills', 'domains', 'agents', 'artifacts']) {
      expect(readTicks(`---\n${key}:\n  - writer\n  - name: editor\n---\n`, members).ok).toBe(false)
      expect(readTicks(`---\n${key}:\n  - writer\n  - [editor, Biology]\n---\n`, members).ok).toBe(false)
    }
  })

  test('a list key written twice reports ok false', () => {
    for (const key of ['skills', 'domains', 'agents', 'artifacts', 'tags']) {
      const r = readTicks(`---\n${key}: [writer]\ntitle: x\n${key}: [editor]\n---\n`, members)
      expect(r.ok).toBe(false)
    }
    // any other key written twice is the student's business
    expect(readTicks('---\ntitle: a\ntitle: b\nskills: [writer]\n---\n', members).ok).toBe(true)
  })

  test('counts a repeated name once', () => {
    expect(readTicks('---\nskills: [writer, Writer]\n---\n', members).skillIds).toEqual(['s1'])
  })

  test('matches a skill name written with spaces to the slugged name the roster saved', () => {
    const roster: Member[] = [...members, { id: 's9', kind: 'skill', name: 'study-coach', emoji: '🎓', path: '/me/skills/study-coach' }]
    const r = readTicks('---\nskills: [Study Coach]\n---\n', roster)
    expect(r.skillIds).toEqual(['s9'])
    expect(r.unknown).toEqual([])
    expect(readTicks('---\nskills: [study_coach]\n---\n', roster).skillIds).toEqual(['s9'])
  })

  test('matches a domain name ignoring case and runs of spaces', () => {
    const roster: Member[] = [...members, { id: 'd9', kind: 'domain', name: 'Cell Biology', emoji: '🧪', path: '/x' }]
    const r = readTicks('---\ndomains: ["cell   biology"]\n---\n', roster)
    expect(r.domainIds).toEqual(['d9'])
    expect(r.unknown).toEqual([])
    expect(readTicks('---\ndomains: [cell-biology]\n---\n', roster).domainIds).toEqual(['d9'])
  })

  test('counts names that differ only in spaces and dashes once', () => {
    const r = readTicks('---\nskills: [Study Coach, study-coach]\n---\n', members)
    expect(r.skillNames).toEqual(['Study Coach'])
    expect(r.unknown).toEqual([{ name: 'Study Coach', kind: 'skill' }])
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

  test('edits the tags list in place instead of rewriting it', () => {
    const raw = '---\ntags:\n  - "exam-prep" # mine\n  - 2026\n  - "#idea"\n  - skill/old\n---\n'
    const out = applyTicks(raw, { skillIds: ['s1'], domainIds: [] }, members, opts) as string
    expect(out).toContain('tags:\n  - "exam-prep" # mine\n  - 2026\n  - "#idea"\n  - skill/writer\n')
  })

  test('leaves a comma-string of tags alone', () => {
    const raw = '---\ntags: exam-prep, notes\n---\n'
    const out = applyTicks(raw, { skillIds: ['s1'], domainIds: [] }, members, opts) as string
    expect(out).toContain('tags: exam-prep, notes\n')
  })

  test('an empty tags key is filled like a missing one', () => {
    const out = applyTicks('---\ntitle: x\ntags:\n---\n', { skillIds: ['s1'], domainIds: [] }, members, opts) as string
    expect(out).toContain('tags:\n  - skill/writer\n')
    expect(data(out).tags).toEqual(['skill/writer'])
  })

  test('an empty tags key with nothing to add stays as written', () => {
    const out = applyTicks('---\ntitle: x\ntags:\n---\n', { skillIds: [], domainIds: [] }, members, opts) as string
    expect(out).toContain('tags:')
    expect(data(out).tags).toBeNull()
  })

  test('an empty tags key that carries a comment is left alone', () => {
    const out = applyTicks('---\ntags: # fill in later\n---\n', { skillIds: ['s1'], domainIds: [] }, members, opts) as string
    expect(out).toContain('# fill in later')
    expect(data(out).tags).toBeNull()
  })

  test('replaces a #-prefixed mirrored tag instead of keeping it beside the new one', () => {
    const raw = '---\ntags: ["#skill/old", "#idea", keep]\n---\n'
    const d = data(applyTicks(raw, { skillIds: ['s1'], domainIds: [] }, members, opts))
    expect(d.tags).toEqual(['#idea', 'keep', 'skill/writer'])
  })

  test('a new tags key is a block list', () => {
    const out = applyTicks(null, { skillIds: ['s1'], domainIds: ['d1'] }, members, opts) as string
    expect(out).toContain('tags:\n  - skill/writer\n  - domain/biology\n')
  })

  test('removes mirrored tags whatever their case', () => {
    const raw = '---\ntags: [Skill/Old, keep]\n---\n'
    expect(data(applyTicks(raw, { skillIds: [], domainIds: [] }, members, opts)).tags).toEqual(['keep'])
  })

  test('refuses to rewrite a mapping where a list belongs', () => {
    for (const key of ['skills', 'domains', 'agents', 'artifacts', 'tags']) {
      expect(applyTicks(`---\n${key}:\n  a: writer\n---\n`, { skillIds: ['s1'], domainIds: [] }, members, opts)).toBeNull()
    }
  })

  test('refuses to rewrite a list holding a mapping, so the mapping is never dropped', () => {
    const raw = '---\nskills:\n  - writer\n  - name: editor\n    note: mine\n---\n'
    expect(applyTicks(raw, { skillIds: ['s1'], domainIds: [] }, members, opts)).toBeNull()
  })

  test('refuses to rewrite a list key written twice', () => {
    const raw = '---\nskills: [writer]\nskills: [ghost]\n---\n'
    expect(applyTicks(raw, { skillIds: ['s1'], domainIds: [] }, members, opts)).toBeNull()
  })

  test('never writes the same name twice, keeping the first and its path', () => {
    const roster: Member[] = [
      ...members,
      { id: 's3', kind: 'skill', name: 'Writer', emoji: '✍️', path: '/elsewhere/writer' }
    ]
    const d = data(applyTicks(null, { skillIds: ['s1', 's3'], domainIds: [] }, roster, opts))
    expect(d.skills).toEqual(['writer'])
    expect(d.skill_paths).toEqual(['C:/me/skills/writer'])
    expect(d.tags).toEqual(['skill/writer'])
  })

  test('returns null instead of throwing on YAML it cannot rewrite', () => {
    const raw = '---\nskills: &a [writer]\nsee: *a\n---\n'
    let out: string | null = ''
    expect(() => {
      out = applyTicks(raw, { skillIds: ['s1', 's2'], domainIds: [] }, members, opts)
    }).not.toThrow()
    expect(out).toBeNull()
  })

  test('moves names under both the new and the 1.1 key to the new key', () => {
    const raw = '---\nskills:\nagents: [writer, ghost]\n---\n'
    const d = data(applyTicks(raw, readTicks(raw, members), members, opts))
    expect('agents' in d).toBe(false)
    expect(d.skills).toEqual(['writer', 'ghost'])
    expect(d.skill_paths).toEqual(['C:/me/skills/writer', ''])
  })

  test('writes the roster spelling for a name the student wrote differently', () => {
    const roster: Member[] = [
      ...members,
      { id: 's9', kind: 'skill', name: 'study-coach', emoji: '🎓', path: '/me/skills/study-coach' },
      { id: 'd9', kind: 'domain', name: 'Cell Biology', emoji: '🧪', path: '/me/domains/cell-biology' }
    ]
    const raw = '---\nskills: [Study Coach]\ndomains: [cell biology]\n---\n'
    const d = data(applyTicks(raw, readTicks(raw, roster), roster, opts))
    expect(d.skills).toEqual(['study-coach'])
    expect(d.skill_paths).toEqual(['/me/skills/study-coach'])
    expect(d.domains).toEqual(['Cell Biology'])
    expect(d.domain_paths).toEqual(['/me/domains/cell-biology'])
  })

  test('writes the bunch name trimmed', () => {
    const out = applyTicks(null, { skillIds: [], domainIds: [] }, members, { ...opts, bunch: '  Class prep ' }) as string
    expect(out).toContain('bunch: Class prep\n')
  })

  test('a brand-new block uses the line ending it is given', () => {
    const out = applyTicks(null, { skillIds: ['s1'], domainIds: [] }, members, { ...opts, eol: '\r\n' }) as string
    expect(out).toContain('\r\n')
    expect(out.replace(/\r\n/g, '')).not.toContain('\n')
  })
})
