import { describe, expect, test } from 'vitest'
import { Scalar } from 'yaml'
import {
  splitFrontMatter,
  parseFrontMatter,
  mergeFrontMatter,
  MIRRORED_TAG,
  duplicateTopLevelKeys,
  normaliseTags,
  addArchived
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

  test('a new block uses the line ending it is given', () => {
    const out = mergeFrontMatter(null, { title: 'Notes' }, '\r\n')
    expect(out).toBe('---\r\ntitle: Notes\r\n---\r\n')
  })

  test('an existing block keeps its own line ending whatever it is given', () => {
    const out = mergeFrontMatter('---\ntitle: Old\n---\n', { title: 'New' }, '\r\n')
    expect(out).toBe('---\ntitle: New\n---\n')
  })

  test('numbers the note wrote keep their spelling; numbers the app writes are plain', () => {
    const raw = '---\nid: 007\ncode: 0x1F\nscore: 1.50\nbig: 1e3\nlist: [007, 2]\n---\n'
    const out = mergeFrontMatter(raw, { count: 5 })
    expect(out).toBe('---\nid: 007\ncode: 0x1F\nscore: 1.50\nbig: 1e3\nlist: [007, 2]\ncount: 5\n---\n')
  })

  test('a number with an empty or blank spelling is written as the number, never as nothing', () => {
    // Number('') and Number(' ') are both 0, so an empty spelling must not count as one.
    for (const source of ['', '  ']) {
      const zero = Object.assign(new Scalar(0), { source })
      const out = mergeFrontMatter('---\ntitle: x\n---\n', { count: zero })
      expect(out).toBe('---\ntitle: x\ncount: 0\n---\n')
      expect(parseFrontMatter(out)).toEqual({ ok: true, data: { title: 'x', count: 0 } })
    }
  })

  test('the archive stamp keeps a number id as written', () => {
    expect(addArchived('---\nid: 007\n---\nBody\n', '2026-10-04T10:00:00-04:00')).toBe(
      '---\nid: 007\narchived: 2026-10-04T10:00:00-04:00\n---\nBody\n'
    )
  })
})

describe('mergeFrontMatter list edits', () => {
  const edit = (append: string[]) => ({ tags: { removeMatching: MIRRORED_TAG, append } })

  test('edits a block list in place, keeping comments, quoting and numbers', () => {
    const raw = '---\ntags:\n  - "exam-prep" # mine\n  - 2026\n  - skill/old\n---\n'
    const out = mergeFrontMatter(raw, edit(['skill/writer']))
    expect(out).toBe('---\ntags:\n  - "exam-prep" # mine\n  - 2026\n  - skill/writer\n---\n')
  })

  test('keeps a flow list flow', () => {
    const out = mergeFrontMatter('---\ntags: [a, skill/old]\n---\n', edit(['skill/new']))
    expect(out).toBe('---\ntags: [a, skill/new]\n---\n')
  })

  test('matches mirrored tags whatever their case', () => {
    const out = mergeFrontMatter('---\ntags: [Skill/Old, keep]\n---\n', edit([]))
    expect(out).toBe('---\ntags: [keep]\n---\n')
  })

  test('does not add a tag that is already there', () => {
    const raw = '---\ntags: [skill/writer, exam-prep]\n---\n'
    expect(mergeFrontMatter(raw, edit(['skill/writer']))).toBe(raw)
  })

  test('creates a missing key as a block list', () => {
    const out = mergeFrontMatter('---\ntitle: x\n---\n', edit(['skill/writer', 'domain/biology']))
    expect(out).toBe('---\ntitle: x\ntags:\n  - skill/writer\n  - domain/biology\n---\n')
  })

  test('creates nothing when there is nothing to add', () => {
    expect(mergeFrontMatter('---\ntitle: x\n---\n', edit([]))).toBe('---\ntitle: x\n---\n')
  })

  test('removes the key when every item was removed', () => {
    expect(mergeFrontMatter('---\ntitle: x\ntags: [skill/old]\n---\n', edit([]))).toBe('---\ntitle: x\n---\n')
  })

  test('leaves an empty list alone when there is nothing to add', () => {
    const raw = '---\ntags: []\n---\n'
    expect(mergeFrontMatter(raw, edit([]))).toBe(raw)
  })

  test('leaves a comma string, a mapping or a commented empty value completely alone', () => {
    for (const raw of [
      '---\ntags: exam-prep, skill/old\n---\n',
      '---\ntags:\n  a: skill/old\n---\n',
      '---\ntags: # later\n---\n'
    ]) {
      expect(mergeFrontMatter(raw, edit(['skill/writer']))).toBe(raw)
    }
  })

  test('fills an empty value like a missing key when there is something to add', () => {
    expect(mergeFrontMatter('---\ntags:\ntitle: x\n---\n', edit(['skill/writer']))).toBe(
      '---\ntags:\n  - skill/writer\ntitle: x\n---\n'
    )
  })

  test('leaves an empty value alone when there is nothing to add', () => {
    const raw = '---\ntags:\n---\n'
    expect(mergeFrontMatter(raw, edit([]))).toBe(raw)
  })

  test('removes #-prefixed mirrored tags too', () => {
    const out = mergeFrontMatter('---\ntags: ["#skill/old", "#Domain/old", "#idea"]\n---\n', edit([]))
    expect(out).toBe('---\ntags: ["#idea"]\n---\n')
  })
})

describe('MIRRORED_TAG', () => {
  test('matches the app namespaces with or without a leading #', () => {
    for (const tag of ['skill/a', 'Domain/b', 'agent/c', 'artifact/d', '#skill/a', '#DOMAIN/b']) {
      expect(MIRRORED_TAG.test(tag)).toBe(true)
    }
    for (const tag of ['skills/a', 'idea', '##skill/a', 'my-skill/a', '#idea']) {
      expect(MIRRORED_TAG.test(tag)).toBe(false)
    }
  })
})

describe('duplicateTopLevelKeys', () => {
  test('lists each top-level key written more than once', () => {
    expect(duplicateTopLevelKeys('---\nskills: [a]\ntitle: x\nskills: [b]\ntags: []\ntags: []\n---\n')).toEqual([
      'skills',
      'tags'
    ])
  })

  test('is empty for ordinary, empty or unreadable front matter', () => {
    expect(duplicateTopLevelKeys('---\nskills: [a]\nnested:\n  skills: [b]\n---\n')).toEqual([])
    expect(duplicateTopLevelKeys('---\n---\n')).toEqual([])
    expect(duplicateTopLevelKeys('---\ntitle: My note: draft\n---\n')).toEqual([])
  })
})

describe('normaliseTags', () => {
  test('turns an Obsidian comma string into a list and strips hashes', () => {
    expect(normaliseTags('a, #b ,a')).toEqual(['a', 'b'])
  })

  test('drops empty entries', () => {
    expect(normaliseTags(['', ' ', 'x'])).toEqual(['x'])
    expect(normaliseTags(null)).toEqual([])
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

describe('addArchived', () => {
  test('adds archived and leaves everything else, body included, alone', () => {
    const text = '---\nid: 01A\nskills:\n  - writer\n---\n# Body\n\nText.\n'
    const out = addArchived(text, '2026-10-04T15:20:00-04:00') as string
    expect(out).toContain('id: 01A')
    expect(out).toContain('skills:\n  - writer')
    expect(out).toContain('archived: 2026-10-04T15:20:00-04:00')
    expect(out.endsWith('# Body\n\nText.\n')).toBe(true)
  })

  test('replaces an archived value copied from an earlier archive', () => {
    const out = addArchived('---\narchived: old\n---\nx\n', 'new') as string
    expect(out).toContain('archived: new')
    expect(out).not.toContain('old')
  })

  test('writes archived exactly once when the source has the key twice', () => {
    const out = addArchived('---\narchived: a\nid: 1\narchived: b\n---\nb\n', 'new') as string
    expect(out.match(/^archived:/gm)).toHaveLength(1)
    expect(out).toContain('archived: new')
    expect(out).toContain('id: 1')
    expect(out.endsWith('---\nb\n')).toBe(true)
  })

  test('keeps CRLF and drops every archived key', () => {
    const out = addArchived('---\r\narchived: a\r\narchived: b\r\n---\r\nbody\r\n', 'new') as string
    expect(out).toBe('---\r\narchived: new\r\n---\r\nbody\r\n')
  })

  test('gives a note with no front matter a block', () => {
    expect(addArchived('x\n', 'now')).toBe('---\narchived: now\n---\nx\n')
  })

  test('refuses unreadable front matter', () => {
    expect(addArchived('---\ntitle: a: b\n---\nx\n', 'now')).toBeNull()
  })
})
