import { describe, expect, test } from 'vitest'
import {
  splitFrontMatter,
  parseFrontMatter,
  mergeFrontMatter,
  stampNote
} from '@shared/markdown/frontmatter'

describe('splitFrontMatter', () => {
  test('returns null raw when the document has no front matter', () => {
    const r = splitFrontMatter('# Hello\n\nSome text.\n')
    expect(r.raw).toBeNull()
    expect(r.body).toBe('# Hello\n\nSome text.\n')
  })

  test('splits a leading YAML block from the body', () => {
    const r = splitFrontMatter('---\ntitle: Notes\n---\n# Hello\n')
    expect(r.raw).toBe('---\ntitle: Notes\n---\n')
    expect(r.body).toBe('# Hello\n')
  })

  test('tolerates CRLF line endings', () => {
    const r = splitFrontMatter('---\r\ntitle: Notes\r\n---\r\n# Hello\r\n')
    expect(r.raw).toBe('---\r\ntitle: Notes\r\n---\r\n')
    expect(r.body).toBe('# Hello\r\n')
  })

  test('accepts three dots as the closing fence', () => {
    const r = splitFrontMatter('---\ntitle: Notes\n...\nbody\n')
    expect(r.raw).toBe('---\ntitle: Notes\n...\n')
    expect(r.body).toBe('body\n')
  })

  test('does not treat a thematic break in the middle of a document as front matter', () => {
    const r = splitFrontMatter('# Hello\n\n---\n\nMore\n')
    expect(r.raw).toBeNull()
  })

  test('does not treat an unterminated opening fence as front matter', () => {
    const r = splitFrontMatter('---\ntitle: Notes\n# Hello\n')
    expect(r.raw).toBeNull()
    expect(r.body).toBe('---\ntitle: Notes\n# Hello\n')
  })

  test('handles an empty front matter block', () => {
    const r = splitFrontMatter('---\n---\nbody\n')
    expect(r.raw).toBe('---\n---\n')
    expect(r.body).toBe('body\n')
  })
})

describe('parseFrontMatter', () => {
  test('reads simple scalar and list values', () => {
    const r = parseFrontMatter('---\ntitle: Notes\ntags: [a, b]\n---\n')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.title).toBe('Notes')
    expect(r.data.tags).toEqual(['a', 'b'])
  })

  test('keeps dates as strings rather than Date objects', () => {
    const r = parseFrontMatter('---\ncreated: 2026-08-21\n---\n')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.created).toBe('2026-08-21')
    expect(r.data.created).not.toBeInstanceOf(Date)
  })

  test('reports a syntax error with a line number instead of throwing', () => {
    const r = parseFrontMatter('---\ntitle: Notes: week 2\n---\n')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.line).toBeGreaterThan(0)
    expect(r.message).toBeTruthy()
  })

  test('tolerates duplicate keys instead of throwing', () => {
    const r = parseFrontMatter('---\ntitle: One\ntitle: Two\n---\n')
    expect(r.ok).toBe(true)
  })
})

describe('mergeFrontMatter', () => {
  test('creates a block when there was none', () => {
    const out = mergeFrontMatter(null, { title: 'Notes', type: 'note' })
    expect(out.startsWith('---\n')).toBe(true)
    expect(out).toContain('title: Notes')
    expect(out).toContain('type: note')
    expect(out.endsWith('---\n')).toBe(true)
  })

  test('preserves unknown keys and their order', () => {
    const raw = '---\naliases: [old-name]\ncssclasses: [wide]\ntitle: Old\n---\n'
    const out = mergeFrontMatter(raw, { title: 'New' })
    expect(out).toContain('aliases:')
    expect(out).toContain('cssclasses:')
    expect(out).toContain('title: New')
    expect(out.indexOf('aliases')).toBeLessThan(out.indexOf('title'))
  })

  test('preserves comments in the existing block', () => {
    const raw = '---\n# my notes\ntitle: Old\n---\n'
    const out = mergeFrontMatter(raw, { title: 'New' })
    expect(out).toContain('# my notes')
  })

  test('quotes a value containing a colon so the result re-parses', () => {
    const out = mergeFrontMatter(null, { title: 'Notes: week 2' })
    const round = parseFrontMatter(out)
    expect(round.ok).toBe(true)
    if (!round.ok) return
    expect(round.data.title).toBe('Notes: week 2')
  })

  test('quotes a value starting with a hash so it is not read as a comment', () => {
    const out = mergeFrontMatter(null, { title: '#ai' })
    const round = parseFrontMatter(out)
    expect(round.ok).toBe(true)
    if (!round.ok) return
    expect(round.data.title).toBe('#ai')
  })

  test('does not fold long values onto multiple lines', () => {
    const long = 'x'.repeat(300)
    const out = mergeFrontMatter(null, { description: long })
    const round = parseFrontMatter(out)
    expect(round.ok).toBe(true)
    if (!round.ok) return
    expect(round.data.description).toBe(long)
  })

  test('writes tags as a flow list', () => {
    const out = mergeFrontMatter(null, { tags: ['ai', 'class'] })
    expect(out).toContain('tags: [ai, class]')
  })

  test('omits keys whose value is undefined', () => {
    const out = mergeFrontMatter(null, { title: 'Notes', agents: undefined })
    expect(out).not.toContain('agents')
  })

  test('removes a key when the value is null', () => {
    const raw = '---\ntitle: Notes\nagents: [librarian]\n---\n'
    const out = mergeFrontMatter(raw, { agents: null })
    expect(out).not.toContain('agents')
    expect(out).toContain('title: Notes')
  })

  test('leaves an unparseable block untouched', () => {
    const raw = '---\ntitle: Notes: week 2\n---\n'
    const out = mergeFrontMatter(raw, { type: 'note' })
    expect(out).toBe(raw)
  })

  test('uses the same line ending as the source block', () => {
    const raw = '---\r\ntitle: Old\r\n---\r\n'
    const out = mergeFrontMatter(raw, { title: 'New' })
    expect(out).toContain('\r\n')
    expect(out.includes('\n\n')).toBe(false)
  })
})

describe('stampNote', () => {
  const base = { id: 'X', type: 'note', filed: 'n', created: 'c' }

  test('adds id, type and filed to a note with no front matter', () => {
    const out = stampNote('# Hello\n', {
      id: '01ABC',
      type: 'note',
      filed: '2026-08-21T10:00:00-05:00',
      created: '2026-08-21T09:00:00-05:00'
    })
    expect(out).toContain('id: 01ABC')
    expect(out).toContain('type: note')
    expect(out.endsWith('# Hello\n')).toBe(true)
  })

  test('never changes an id that is already present', () => {
    const src = '---\nid: ORIGINAL\n---\n# Hello\n'
    const out = stampNote(src, { ...base, id: 'NEW' })
    expect(out).toContain('id: ORIGINAL')
    expect(out).not.toContain('NEW')
  })

  test('never changes an existing created timestamp', () => {
    const src = '---\ncreated: 2020-01-01\n---\n# Hello\n'
    const out = stampNote(src, { ...base, created: '2026-08-21' })
    expect(out).toContain('created: 2020-01-01')
  })

  test('unions incoming tags with existing ones without duplicating', () => {
    const src = '---\ntags: [ai]\n---\nbody\n'
    const out = stampNote(src, { ...base, tags: ['ai', 'class'] })
    const parsed = parseFrontMatter(String(splitFrontMatter(out).raw))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.data.tags).toEqual(['ai', 'class'])
  })

  test('normalises an Obsidian comma string of tags into a list', () => {
    const src = '---\ntags: ai, class\n---\nbody\n'
    const out = stampNote(src, { ...base, tags: ['extra'] })
    const parsed = parseFrontMatter(String(splitFrontMatter(out).raw))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.data.tags).toEqual(['ai', 'class', 'extra'])
  })

  test('strips a leading hash from tags', () => {
    const out = stampNote('body\n', { ...base, tags: ['#ai'] })
    const parsed = parseFrontMatter(String(splitFrontMatter(out).raw))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.data.tags).toEqual(['ai'])
  })

  test('writes agents as a block list and omits the key when the list is empty', () => {
    const withAgents = stampNote('body\n', { ...base, agents: ['librarian'] })
    expect(withAgents).toContain('agents:\n  - librarian')
    const without = stampNote('body\n', { ...base, agents: [] })
    expect(without).not.toContain('agents')
  })

  test('leaves the body bytes untouched', () => {
    const body = '# Hello\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n[[wikilink]] and snake_case\n'
    const out = stampNote(body, base)
    expect(out.endsWith(body)).toBe(true)
  })

  test('does not damage a note whose front matter is unparseable', () => {
    const src = '---\ntitle: Notes: week 2\n---\n# Hello\n'
    const out = stampNote(src, base)
    expect(out).toBe(src)
  })
})

describe('stampNote without a type', () => {
  test('omits the type key entirely when none is given', () => {
    const out = stampNote('body\n', { id: 'X', filed: 'n', created: 'c' })
    expect(out).not.toContain('type:')
    expect(out).toContain('id: X')
  })

  test('still leaves an existing type alone', () => {
    const out = stampNote('---\ntype: source\n---\nbody\n', { id: 'X', filed: 'n', created: 'c' })
    expect(out).toContain('type: source')
  })
})

describe('splitFrontMatter must not swallow a leading divider', () => {
  test('a note that opens with a horizontal rule keeps all of its text', () => {
    const src = '---\n\nSome opening text.\n\n---\n\nMore text.\n'
    const r = splitFrontMatter(src)
    expect(r.raw).toBeNull()
    expect(r.body).toBe(src)
  })

  test('a divider followed by a heading is not front matter', () => {
    const src = '---\n# Title\n---\nBody\n'
    expect(splitFrontMatter(src).raw).toBeNull()
  })

  test('a list at the top is not front matter', () => {
    const src = '---\n- one\n- two\n---\nBody\n'
    expect(splitFrontMatter(src).raw).toBeNull()
  })

  test('real front matter is still recognised', () => {
    const r = splitFrontMatter('---\ntitle: Notes\ntags: [a]\n---\nBody\n')
    expect(r.raw).toBe('---\ntitle: Notes\ntags: [a]\n---\n')
  })

  test('an empty front matter block is still front matter', () => {
    expect(splitFrontMatter('---\n---\nBody\n').raw).toBe('---\n---\n')
  })

  test('front matter that is broken YAML is still treated as front matter', () => {
    // otherwise the properties panel could never offer to repair it
    const r = splitFrontMatter('---\ntitle: Notes: week 2\n---\nBody\n')
    expect(r.raw).toBe('---\ntitle: Notes: week 2\n---\n')
  })
})

describe('stampNote with a bunch', () => {
  const base = { id: 'X', type: 'note', filed: 'n', created: 'c' }
  const who = {
    bunch: 'thesis',
    agents: ['study-coach', 'research-assistant'],
    agentPaths: ['C:/Users/me/agents/study-coach', 'C:/Users/me/agents/research-assistant'],
    artifacts: ['thesis-chapter-3'],
    artifactPaths: ['C:/Users/me/artifacts/thesis-chapter-3']
  }

  function data(out: string) {
    const parsed = parseFrontMatter(String(splitFrontMatter(out).raw))
    expect(parsed.ok).toBe(true)
    return parsed.ok ? parsed.data : {}
  }

  test('writes five parallel keys as block lists', () => {
    const out = stampNote('body\n', { ...base, ...who })
    expect(out).toContain('bunch: thesis')
    expect(out).toContain('agents:\n  - study-coach\n  - research-assistant')
    expect(out).toContain('agent_paths:\n  - C:/Users/me/agents/study-coach')
    expect(out).toContain('artifacts:\n  - thesis-chapter-3')
    expect(out).toContain('artifact_paths:\n  - C:/Users/me/artifacts/thesis-chapter-3')
    const parsed = data(out)
    expect(parsed.agents).toEqual(who.agents)
    expect(parsed.agent_paths).toEqual(who.agentPaths)
    expect(parsed.artifacts).toEqual(who.artifacts)
    expect(parsed.artifact_paths).toEqual(who.artifactPaths)
    expect(out.endsWith('body\n')).toBe(true)
  })

  test('refiling replaces every stamp key wholesale', () => {
    const src =
      '---\nbunch: old\nagents:\n  - gone\nagent_paths:\n  - /old/gone\nartifacts:\n  - stale\nartifact_paths:\n  - /old/stale\n---\nbody\n'
    const out = stampNote(src, { ...base, ...who })
    expect(out).not.toContain('old')
    expect(out).not.toContain('gone')
    expect(out).not.toContain('stale')
    expect(data(out).bunch).toBe('thesis')
  })

  test('an empty list removes the key instead of writing []', () => {
    const src = '---\nbunch: old\nartifacts:\n  - stale\nartifact_paths:\n  - /old/stale\n---\nbody\n'
    const out = stampNote(src, { ...base, ...who, artifacts: [], artifactPaths: [] })
    expect(out).not.toContain('artifacts')
    expect(out).not.toContain('artifact_paths')
    expect(out).not.toContain('[]')
  })

  test('an agent with no folder yet still gets a slot in agent_paths', () => {
    const out = stampNote('body\n', { ...base, ...who, agents: ['a', 'b'], agentPaths: ['', '/b'] })
    expect(data(out).agent_paths).toEqual(['', '/b'])
  })

  test('mirrored tags from the last filing are replaced, hand-written tags stay', () => {
    const src = '---\ntags: [ai, agent/old, artifact/stale]\n---\nbody\n'
    const out = stampNote(src, { ...base, ...who, tags: ['agent/study-coach', 'artifact/thesis-chapter-3'] })
    expect(data(out).tags).toEqual(['ai', 'agent/study-coach', 'artifact/thesis-chapter-3'])
  })

  test('a stamp without a bunch leaves mirrored tags alone', () => {
    const src = '---\ntags: [ai, agent/old]\n---\nbody\n'
    const out = stampNote(src, { ...base, tags: ['extra'] })
    expect(data(out).tags).toEqual(['ai', 'agent/old', 'extra'])
  })
})
