import { describe, expect, test } from 'vitest'
import { alignPaths, applyTicks, expectedPaths, namedCount, readTicks, type ApplyOptions } from '@shared/ticks'
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
      ok: true, reason: '', skillIds: [], domainIds: [], skillNames: [], domainNames: [],
      unknown: [], spellings: {}, bunch: null, usedAliases: false, tagCount: 0
    })
  })

  test('a readable note has no reason', () => {
    expect(readTicks('---\nskills: [writer]\n---\n', members).reason).toBe('')
  })

  test('the bunch and path keys written twice report ok false', () => {
    for (const key of ['bunch', 'skill_paths', 'domain_paths', 'agent_paths', 'artifact_paths']) {
      const r = readTicks(`---\n${key}: a\ntitle: x\n${key}: b\n---\n`, members)
      expect(r.ok).toBe(false)
      expect(r.reason).toBe(`The key ${key} appears twice at the top of this note.`)
    }
  })

  test('says in plain words why the YAML cannot be ticked', () => {
    expect(readTicks('---\nskills: [writer]\nskills: [editor]\n---\n', members).reason).toBe(
      'The key skills appears twice at the top of this note.'
    )
    expect(readTicks('---\nskills:\n  - writer\n  - name: editor\n---\n', members).reason).toBe(
      'An item under skills is not a plain name.'
    )
    expect(readTicks('---\ndomains:\n  a: Biology\n---\n', members).reason).toBe(
      'domains holds a group of settings instead of a list.'
    )
    const broken = readTicks('---\ntitle: My note: draft\n---\n', members).reason
    expect(broken).toContain('Nested mappings are not allowed')
    expect(broken).toContain('line 1')
    expect(broken).not.toContain('\n')
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

  test('counts a name that reaches the same member only in another case once, keeping the first', () => {
    const roster: Member[] = [...members, { id: 's9', kind: 'skill', name: 'study-coach', emoji: '🎓', path: '/me/skills/study-coach' }]
    const r = readTicks('---\nskills: [Study Coach, study coach]\n---\n', roster)
    expect(r.skillIds).toEqual(['s9'])
    expect(r.skillNames).toEqual(['Study Coach'])
    expect(r.spellings).toEqual({ s9: 'Study Coach' })
  })

  test('the closest of several names for one member is its spelling; another is a silent alias, kept in place', () => {
    const roster: Member[] = [...members, { id: 's9', kind: 'skill', name: 'study-coach', emoji: '🎓', path: '/me/skills/study-coach' }]
    const r = readTicks('---\nskills: [Study Coach, study-coach]\n---\n', roster)
    expect(r.skillIds).toEqual(['s9'])
    expect(r.spellings).toEqual({ s9: 'study-coach' })
    expect(r.skillNames).toEqual(['Study Coach', 'study-coach'])
    expect(r.unknown).toEqual([])
    expect(namedCount(r)).toBe(1)
  })

  test('an alias repeated in another case is kept once', () => {
    const roster: Member[] = [...members, { id: 's9', kind: 'skill', name: 'study-coach', emoji: '🎓', path: '/me/skills/study-coach' }]
    const r = readTicks('---\nskills: [Study Coach, study-coach, STUDY COACH]\n---\n', roster)
    expect(r.skillNames).toEqual(['Study Coach', 'study-coach'])
    expect(r.unknown).toEqual([])
  })

  test('namedCount counts each member once, and names nobody has, but not aliases', () => {
    const roster: Member[] = [...members, { id: 'd9', kind: 'domain', name: 'Cell Biology', emoji: '🧪', path: '/x' }]
    const r = readTicks('---\nskills: [writer, ghost]\ndomains: [cell-biology, Cell Biology, Chemistry]\n---\n', roster)
    expect(namedCount(r)).toBe(4)
    expect(namedCount(r, 'skill')).toBe(2)
    expect(namedCount(r, 'domain')).toBe(2)
  })

  test('keeps unknown names apart unless they differ only in case', () => {
    const r = readTicks('---\nskills: [Study Coach, study-coach, study coach]\n---\n', members)
    expect(r.skillNames).toEqual(['Study Coach', 'study-coach'])
    expect(r.unknown).toEqual([
      { name: 'Study Coach', kind: 'skill' },
      { name: 'study-coach', kind: 'skill' }
    ])
  })

  test('records the spelling the note uses for each member it names', () => {
    const roster: Member[] = [...members, { id: 's9', kind: 'skill', name: 'study-coach', emoji: '🎓', path: '/me/skills/study-coach' }]
    const r = readTicks('---\nskills: [Study Coach, writer]\ndomains: [biology]\n---\n', roster)
    expect(r.spellings).toEqual({ s9: 'Study Coach', s1: 'writer', d1: 'biology' })
  })

  test('an exact name wins over a twin that only shares its name key', () => {
    const roster: Member[] = [
      { id: 'd1', kind: 'domain', name: 'cell-biology', emoji: '🧪', path: '/d/cell-biology' },
      { id: 'd2', kind: 'domain', name: 'Cell Biology', emoji: '🧪', path: '/d/Cell Biology' }
    ]
    expect(readTicks('---\ndomains: [Cell Biology]\n---\n', roster).domainIds).toEqual(['d2'])
    expect(readTicks('---\ndomains: [cell-biology]\n---\n', roster).domainIds).toEqual(['d1'])
    // no exact match: case-insensitive comes before the name key
    expect(readTicks('---\ndomains: [cell biology]\n---\n', roster).domainIds).toEqual(['d2'])
    expect(readTicks('---\ndomains: [Cell-Biology]\n---\n', roster).domainIds).toEqual(['d1'])
    const both = readTicks('---\ndomains: [cell-biology, Cell Biology]\n---\n', roster)
    expect(both.domainIds).toEqual(['d1', 'd2'])
    expect(both.domainNames).toEqual(['cell-biology', 'Cell Biology'])
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

  test('re-applying the ticks a note has lines a hand-edited list up with its paths', () => {
    // What an archive does first: one name was typed in by hand, without a path.
    const raw = '---\ndomains: [biology, Geology]\ndomain_paths: [/me/domains/biology]\n---\n'
    const now = readTicks(raw, members)
    const d = data(applyTicks(raw, { skillIds: now.skillIds, domainIds: now.domainIds }, members, { ...opts, mirrorTags: false }))
    expect(d.domains).toEqual(['biology', 'Geology'])
    expect(d.domain_paths).toEqual(['/me/domains/biology', ''])
    expect('bunch' in d).toBe(false)
  })

  test('converting a 1.1 note renames its agent/ and artifact/ tags even with mirroring off', () => {
    const raw =
      '---\nagents:\n  - writer\nartifacts:\n  - Biology\ntags: [agent/writer, keep, artifact/Biology, skill/old, "#agent/x"]\n---\n'
    const before = readTicks(raw, members)
    const d = data(applyTicks(raw, before, members, { ...opts, mirrorTags: false }))
    expect(d.skills).toEqual(['writer'])
    expect(d.tags).toEqual(['skill/writer', 'keep', 'domain/Biology', 'skill/old', '#skill/x'])
  })

  test('renaming 1.1 tags keeps each one in its place, with its comment and quoting', () => {
    const raw = '---\nagents:\n  - writer\ntags:\n  - keep\n  - agent/writer # mine\n  - "artifact/Biology"\n  - last\n---\n'
    const out = applyTicks(raw, readTicks(raw, members), members, { ...opts, mirrorTags: false }) as string
    expect(out).toContain('tags:\n  - keep\n  - skill/writer # mine\n  - "domain/Biology"\n  - last\n')
  })

  test('a renamed 1.1 tag the list already has is not written twice', () => {
    const raw = '---\nagents: [writer]\ntags: [agent/writer, keep, skill/writer, agent/x, agent/X]\n---\n'
    const d = data(applyTicks(raw, readTicks(raw, members), members, { ...opts, mirrorTags: false }))
    expect(d.tags).toEqual(['keep', 'skill/writer', 'skill/x', 'skill/X'])
  })

  test('with mirroring off, a note already on the new keys keeps its agent/ tags', () => {
    const raw = '---\nskills: [writer]\ntags: [agent/writer]\n---\n'
    const d = data(applyTicks(raw, readTicks(raw, members), members, { ...opts, mirrorTags: false }))
    expect(d.tags).toEqual(['agent/writer'])
  })

  test('keeps names nobody in the roster has, with an empty path', () => {
    const raw = '---\nskills: [writer, ghost]\n---\n'
    const d = data(applyTicks(raw, { skillIds: ['s1', 's2'], domainIds: [] }, members, opts))
    // the note's own names keep their order; the new tick comes after them
    expect(d.skills).toEqual(['writer', 'ghost', 'editor'])
    expect(d.skill_paths).toEqual(['C:/me/skills/writer', '', '/me/skills/editor'])
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

  test('refuses to rewrite when bunch or a paths key is written twice', () => {
    for (const key of ['bunch', 'skill_paths', 'domain_paths', 'agent_paths', 'artifact_paths']) {
      const raw = `---\n${key}: a\n${key}: b\n---\n`
      expect(applyTicks(raw, { skillIds: ['s1'], domainIds: [] }, members, { ...opts, bunch: 'x' })).toBeNull()
    }
  })

  test('never writes the same name twice, keeping the first and its path', () => {
    const roster: Member[] = [
      ...members,
      { id: 's3', kind: 'skill', name: 'writer', emoji: '✍️', path: '/elsewhere/writer' }
    ]
    const d = data(applyTicks(null, { skillIds: ['s1', 's3'], domainIds: [] }, roster, opts))
    expect(d.skills).toEqual(['writer'])
    expect(d.skill_paths).toEqual(['C:/me/skills/writer'])
    expect(d.tags).toEqual(['skill/writer'])
  })

  test('two members whose names differ only in case are both written, each with its own path', () => {
    const roster: Member[] = [
      ...members,
      { id: 's3', kind: 'skill', name: 'Writer', emoji: '✍️', path: '/elsewhere/writer' }
    ]
    const out = applyTicks(null, { skillIds: ['s1', 's3'], domainIds: [] }, roster, opts)
    const d = data(out)
    expect(d.skills).toEqual(['writer', 'Writer'])
    expect(d.skill_paths).toEqual(['C:/me/skills/writer', '/elsewhere/writer'])
    expect(d.tags).toEqual(['skill/writer'])
    expect(readTicks(out, roster).skillIds).toEqual(['s1', 's3'])
  })

  describe('twins that share a name key', () => {
    const roster: Member[] = [
      ...members,
      { id: 'd8', kind: 'domain', name: 'cell-biology', emoji: '🧪', path: '/d/cell-biology' },
      { id: 'd9', kind: 'domain', name: 'Cell Biology', emoji: '🧪', path: '/d/Cell Biology' }
    ]

    test('an unrelated tick keeps both names and both paths', () => {
      const raw = '---\ndomains: [cell-biology, Cell Biology]\ndomain_paths: [/d/cell-biology, /d/Cell Biology]\n---\n'
      const out = applyTicks(raw, { skillIds: ['s1'], domainIds: readTicks(raw, roster).domainIds }, roster, opts)
      const d = data(out)
      expect(d.domains).toEqual(['cell-biology', 'Cell Biology'])
      expect(d.domain_paths).toEqual(['/d/cell-biology', '/d/Cell Biology'])
      expect(readTicks(out, roster).domainIds).toEqual(['d8', 'd9'])
    })

    test('ticking one of them lights only that one', () => {
      const out = applyTicks(null, { skillIds: [], domainIds: ['d9'] }, roster, opts)
      expect(data(out).domains).toEqual(['Cell Biology'])
      expect(data(out).domain_paths).toEqual(['/d/Cell Biology'])
      expect(readTicks(out, roster).domainIds).toEqual(['d9'])
    })
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

  test('keeps the spelling the note already uses, with the roster path', () => {
    const roster: Member[] = [
      ...members,
      { id: 's9', kind: 'skill', name: 'study-coach', emoji: '🎓', path: '/me/skills/study-coach' },
      { id: 'd9', kind: 'domain', name: 'Cell Biology', emoji: '🧪', path: '/me/domains/cell-biology' }
    ]
    const raw = '---\nskills: [Study Coach]\nskill_paths: [/old]\ndomains: [cell biology]\n---\n'
    const d = data(applyTicks(raw, readTicks(raw, roster), roster, opts))
    expect(d.skills).toEqual(['Study Coach'])
    expect(d.skill_paths).toEqual(['/me/skills/study-coach'])
    expect(d.domains).toEqual(['cell biology'])
    expect(d.domain_paths).toEqual(['/me/domains/cell-biology'])
    expect(d.tags).toEqual(['skill/study-coach', 'domain/cell-biology'])
  })

  describe('another spelling of a ticked member', () => {
    const roster: Member[] = [
      ...members,
      { id: 's9', kind: 'skill', name: 'study-coach', emoji: '🎓', path: '/me/skills/study-coach' }
    ]
    const raw = '---\nskills: [Study Coach, writer, study-coach]\n---\n'

    test('keeps its place and spelling, takes the member path, and adds no tag of its own', () => {
      const d = data(applyTicks(raw, { skillIds: ['s9', 's1', 's2'], domainIds: [] }, roster, opts))
      expect(d.skills).toEqual(['Study Coach', 'writer', 'study-coach', 'editor'])
      expect(d.skill_paths).toEqual(['/me/skills/study-coach', 'C:/me/skills/writer', '/me/skills/study-coach', '/me/skills/editor'])
      expect(d.tags).toEqual(['skill/writer', 'skill/study-coach', 'skill/editor'])
    })

    test('goes with the member when the member is unticked', () => {
      const out = applyTicks(raw, { skillIds: ['s1'], domainIds: [] }, roster, opts)
      expect(data(out).skills).toEqual(['writer'])
      expect(readTicks(out, roster).skillIds).toEqual(['s1'])
    })

    test('applying the same ticks twice gives identical bytes, and reads back the same', () => {
      const ticks = readTicks(raw, roster)
      const once = applyTicks(raw, ticks, roster, opts) as string
      expect(applyTicks(once, ticks, roster, opts)).toBe(once)
      const again = readTicks(once, roster)
      expect(again.skillIds).toEqual(ticks.skillIds)
      expect(again.skillNames).toEqual(['Study Coach', 'writer', 'study-coach'])
      expect(again.unknown).toEqual([])
    })
  })

  test('an unrelated tick does not respell a name, and a new tick uses the roster name', () => {
    const roster: Member[] = [
      ...members,
      { id: 's9', kind: 'skill', name: 'study-coach', emoji: '🎓', path: '/me/skills/study-coach' }
    ]
    const raw = '---\nskills: [Study Coach]\n---\n'
    const d = data(applyTicks(raw, { skillIds: ['s9', 's2'], domainIds: [] }, roster, opts))
    expect(d.skills).toEqual(['Study Coach', 'editor'])
    expect(d.skill_paths).toEqual(['/me/skills/study-coach', '/me/skills/editor'])
  })

  describe("the note's order", () => {
    test('names already there keep their order, and new ticks follow in roster order', () => {
      const raw = '---\nskills: [ghost, editor, writer]\n---\n'
      const d = data(applyTicks(raw, readTicks(raw, members), members, opts))
      expect(d.skills).toEqual(['ghost', 'editor', 'writer'])
      expect(d.skill_paths).toEqual(['', '/me/skills/editor', 'C:/me/skills/writer'])

      const roster: Member[] = [
        { id: 's0', kind: 'skill', name: 'alpha', emoji: '🅰️', path: '/a' },
        ...members,
        { id: 's7', kind: 'skill', name: 'omega', emoji: '🔚', path: '/o' }
      ]
      const added = data(applyTicks('---\nskills: [editor]\n---\n', { skillIds: ['s7', 's2', 's0'], domainIds: [] }, roster, opts))
      expect(added.skills).toEqual(['editor', 'alpha', 'omega'])
    })

    test('reading back gives the same ticks in the same order', () => {
      const raw = '---\nskills: [editor, ghost, writer]\ndomains: [History, Biology]\n---\n'
      const before = readTicks(raw, members)
      const out = applyTicks(raw, before, members, opts)
      const after = readTicks(out, members)
      expect(after.skillIds).toEqual(before.skillIds)
      expect(after.domainIds).toEqual(before.domainIds)
      expect(after.skillNames).toEqual(['editor', 'ghost', 'writer'])
      expect(after.domainNames).toEqual(['History', 'Biology'])
    })

    test('applying the same ticks twice gives identical bytes', () => {
      const roster: Member[] = [
        ...members,
        { id: 'd9', kind: 'domain', name: 'Cell Biology', emoji: '🧪', path: '/d/Cell Biology' }
      ]
      const raw =
        '---\ntitle: Notes\nskills: [editor, ghost, Writer]\ndomains: [cell-biology, History, Cell Biology]\ntags: [mine]\n---\n'
      const ticks = { skillIds: ['s2', 's1'], domainIds: ['d9', 'd2', 'd1'] }
      const once = applyTicks(raw, ticks, roster, opts) as string
      const twice = applyTicks(once, ticks, roster, opts)
      expect(twice).toBe(once)
      const thrice = applyTicks(once, readTicks(once, roster), roster, opts)
      expect(thrice).toBe(once)
    })
  })

  describe('a twin removed from the roster', () => {
    // The note named both twins; then cell-biology (d1) was removed from the roster, so
    // both names now reach Cell Biology (d2).
    const roster: Member[] = [
      ...members.filter((m) => m.kind === 'skill'),
      { id: 'd2', kind: 'domain', name: 'Cell Biology', emoji: '🧪', path: '/d/Cell Biology' }
    ]
    const raw = '---\ndomains: [cell-biology, Cell Biology]\ndomain_paths: [/d/cell-biology, /d/Cell Biology]\n---\n'

    test('the exact name is the spelling, and the other is a silent alias, with no chip', () => {
      const r = readTicks(raw, roster)
      expect(r.domainIds).toEqual(['d2'])
      expect(r.spellings).toEqual({ d2: 'Cell Biology' })
      expect(r.domainNames).toEqual(['cell-biology', 'Cell Biology'])
      expect(r.unknown).toEqual([])
    })

    test('ticking a skill keeps both names in place, each with the member path, and one tag', () => {
      const out = applyTicks(raw, { skillIds: ['s1'], domainIds: readTicks(raw, roster).domainIds }, roster, opts)
      const d = data(out)
      expect(d.domains).toEqual(['cell-biology', 'Cell Biology'])
      expect(d.domain_paths).toEqual(['/d/Cell Biology', '/d/Cell Biology'])
      expect(d.tags).toEqual(['skill/writer', 'domain/cell-biology'])
      const again = readTicks(out, roster)
      expect(again.domainIds).toEqual(['d2'])
      expect(again.unknown).toEqual([])
    })

    test('round trip: reading back and writing again changes nothing', () => {
      const ticks = { skillIds: ['s1'], domainIds: ['d2'] }
      const once = applyTicks(raw, ticks, roster, opts) as string
      expect(applyTicks(once, ticks, roster, opts)).toBe(once)
      expect(applyTicks(once, readTicks(once, roster), roster, opts)).toBe(once)
      expect(readTicks(once, roster).domainNames).toEqual(['cell-biology', 'Cell Biology'])
    })

    test('unticking Cell Biology takes both names, so it stays unticked', () => {
      const out = applyTicks(raw, { skillIds: [], domainIds: [] }, roster, opts)
      expect('domains' in data(out)).toBe(false)
      expect(readTicks(out, roster).domainIds).toEqual([])
    })

    test('the closest name wins wherever it sits, and a case-only repeat counts once', () => {
      const r = readTicks('---\ndomains: [cell biology, Cell Biology, CELL BIOLOGY]\n---\n', roster)
      expect(r.spellings).toEqual({ d2: 'Cell Biology' })
      expect(r.domainNames).toEqual(['Cell Biology'])
      expect(r.unknown).toEqual([])
    })
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

describe('expectedPaths', () => {
  test('gives each name its path, in the note order, and an empty path to a name nobody has', () => {
    expect(expectedPaths('---\nskills: [Writer, ghost]\ndomains: [biology]\n---\n', members)).toEqual({
      skill_paths: ['C:/me/skills/writer', ''],
      domain_paths: ['/me/domains/biology']
    })
  })

  test('an alias takes the path of the member it reaches; a name repeated in another case counts once', () => {
    const roster: Member[] = [{ id: 'c', kind: 'skill', name: 'Study Coach', emoji: '', path: '/me/coach' }]
    expect(expectedPaths('---\nskills: [Study Coach, study-coach, STUDY COACH]\n---\n', roster)).toEqual({
      skill_paths: ['/me/coach', '/me/coach'],
      domain_paths: []
    })
  })

  test('agrees with the paths applyTicks writes for the ticks the note has', () => {
    const raw = '---\nskills: [editor, ghost, Writer]\nagents: [writer, other]\ndomains: [History, biology]\n---\n'
    const now = readTicks(raw, members)
    const d = data(applyTicks(raw, { skillIds: now.skillIds, domainIds: now.domainIds }, members, opts))
    expect(expectedPaths(raw, members)).toEqual({ skill_paths: d.skill_paths, domain_paths: d.domain_paths })
  })

  test('no front matter means no paths; YAML the ticks cannot read gives null', () => {
    expect(expectedPaths(null, members)).toEqual({ skill_paths: [], domain_paths: [] })
    expect(expectedPaths('---\ntitle: My note: draft\n---\n', members)).toBeNull()
    expect(expectedPaths('---\nskills: [writer]\nskills: [editor]\n---\n', members)).toBeNull()
  })
})

describe('alignPaths (what archiving does to the YAML)', () => {
  test('leaves a note whose paths already line up byte for byte alone', () => {
    const raw =
      "---\ntitle:    x\nskills:   [ writer ]  # main\nskill_paths: ['C:/me/skills/writer']\ndomains: [Geology]\ndomain_paths:\n  -\n---\n"
    expect(alignPaths(raw, members)).toBe(raw)
    expect(alignPaths('---\ntitle: x\n---\n', members)).toBe('---\ntitle: x\n---\n')
  })

  test('keeps a comment on a name and adds only the missing paths', () => {
    const raw = '---\nskills:\n  - writer # main\n---\n'
    expect(alignPaths(raw, members)).toBe('---\nskills:\n  - writer # main\nskill_paths:\n  - C:/me/skills/writer\n---\n')
  })

  test('keeps a flow list of names as written', () => {
    const raw = '---\nskills: [writer, editor]\nskill_paths: [/old]\n---\n'
    expect(alignPaths(raw, members)).toBe(
      '---\nskills: [writer, editor]\nskill_paths:\n  - C:/me/skills/writer\n  - /me/skills/editor\n---\n'
    )
  })

  test('when the paths are out of step, patches only them: no id, type, title, created or tags', () => {
    const raw =
      "---\ntitle: 'Cells'\ndomains: [Biology, Geology] # two\ndomain_paths: [/x]\nskills: [writer]\nskill_paths:\n  - C:/me/skills/writer\ntags: [a, \"b\", agent/writer]\nnote: keep\n---\n"
    expect(alignPaths(raw, members)).toBe(
      "---\ntitle: 'Cells'\ndomains: [Biology, Geology] # two\ndomain_paths:\n  - /me/domains/biology\n  - \"\"\nskills: [writer]\nskill_paths:\n  - C:/me/skills/writer\ntags: [a, \"b\", agent/writer]\nnote: keep\n---\n"
    )
  })

  test('removes a path list left over when the note names nobody of that kind', () => {
    expect(alignPaths('---\ntitle: x\nskill_paths: [/old]\n---\n', members)).toBe('---\ntitle: x\n---\n')
  })

  test('keeps the CRLF line endings of the note', () => {
    const consistent = '---\r\nskills: [writer] # c\r\nskill_paths:\r\n  - C:/me/skills/writer\r\n---\r\n'
    expect(alignPaths(consistent, members)).toBe(consistent)
    expect(alignPaths('---\r\nskills: [writer] # c\r\ntitle: x\r\n---\r\n', members)).toBe(
      '---\r\nskills: [writer] # c\r\ntitle: x\r\nskill_paths:\r\n  - C:/me/skills/writer\r\n---\r\n'
    )
  })

  test('a 1.1 note keeps its keys: the paths beside agents and artifacts line up', () => {
    const raw = '---\nagents: [writer, ghost]\nagent_paths: [/old]\nartifacts: [Biology]\n---\n'
    expect(alignPaths(raw, members)).toBe(
      '---\nagents: [writer, ghost]\nagent_paths:\n  - C:/me/skills/writer\n  - ""\nartifacts: [Biology]\nartifact_paths:\n  - /me/domains/biology\n---\n'
    )
  })

  test('names split between skills and agents have no one path list to line up, so are left alone', () => {
    const raw = '---\nskills: [writer]\nagents: [editor]\n---\n'
    expect(alignPaths(raw, members)).toBe(raw)
  })

  test('YAML the ticks cannot read, or no front matter at all, gives null', () => {
    expect(alignPaths(null, members)).toBeNull()
    expect(alignPaths('---\ntitle: My note: draft\n---\n', members)).toBeNull()
    expect(alignPaths('---\nskills:\n  - name: writer\n---\n', members)).toBeNull()
  })
})
