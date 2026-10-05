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

describe('mergeFrontMatter leaves every line it does not change byte for byte', () => {
  /** Front matter as a student types it: odd spacing, 4-space lists, a folded value, comments. */
  const HAND = [
    '---',
    'title:    My  Notes   # working title',
    'created: 2026-08-21',
    'id: 007',
    'description: >',
    '  A folded description',
    '  over two lines.',
    '',
    'tags:',
    '    - "exam-prep"   # mine',
    '    - skill/old',
    '    - biology',
    '# skills below',
    'skills:',
    '    - writer',
    '? odd key',
    ': odd value',
    'course:',
    '    name: Bio 101',
    '    code:   B-101',
    '---',
    ''
  ].join('\n')
  const tagEdit = (append: string[]) => ({ tags: { removeMatching: MIRRORED_TAG, append } })

  test('a changed value replaces only the value, keeping the spacing and comment around it', () => {
    expect(mergeFrontMatter(HAND, { title: 'New: draft' })).toBe(HAND.replace('My  Notes', '"New: draft"'))
  })

  test('the same holds with CRLF line endings', () => {
    const crlf = HAND.replace(/\n/g, '\r\n')
    expect(mergeFrontMatter(crlf, { title: 'Week 3' })).toBe(crlf.replace('My  Notes', 'Week 3'))
    expect(mergeFrontMatter(crlf, tagEdit(['skill/writer']))).toBe(
      crlf.replace('    - skill/old\r\n    - biology\r\n', '    - biology\r\n    - skill/writer\r\n')
    )
  })

  test('a folded value that changes is replaced by its own lines, and the blank line after it stays', () => {
    expect(mergeFrontMatter(HAND, { description: 'Short.' })).toBe(
      HAND.replace('description: >\n  A folded description\n  over two lines.\n', 'description: Short.\n')
    )
  })

  test('removing a key removes exactly its lines', () => {
    expect(mergeFrontMatter(HAND, { course: null })).toBe(HAND.replace('course:\n    name: Bio 101\n    code:   B-101\n', ''))
    expect(mergeFrontMatter(HAND, { 'odd key': null })).toBe(HAND.replace('? odd key\n: odd value\n', ''))
  })

  test('a tag edit touches only the tags it removes and adds, in the list’s own indentation', () => {
    expect(mergeFrontMatter(HAND, tagEdit(['skill/writer', 'domain/biology']))).toBe(
      HAND.replace('    - skill/old\n    - biology\n', '    - biology\n    - skill/writer\n    - domain/biology\n')
    )
  })

  test('a list set from the properties panel changes only the items that differ', () => {
    expect(mergeFrontMatter(HAND, { tags: ['exam-prep', 'biology', 'week-3'] })).toBe(
      HAND.replace('    - skill/old\n    - biology\n', '    - biology\n    - week-3\n')
    )
    expect(mergeFrontMatter(HAND, { tags: ['exam-prep', 'skill/old', 'biology'] })).toBe(HAND)
  })

  test('emptying a block list writes an empty list, not an empty value', () => {
    expect(mergeFrontMatter(HAND, { tags: [] })).toBe(
      HAND.replace('tags:\n    - "exam-prep"   # mine\n    - skill/old\n    - biology\n', 'tags: []\n')
    )
  })

  test('a flow list keeps its own spacing and separators', () => {
    expect(mergeFrontMatter('---\ntags: [ a,  skill/old ,c ]\n---\n', tagEdit(['skill/x']))).toBe(
      '---\ntags: [ a,  c,  skill/x ]\n---\n'
    )
    expect(mergeFrontMatter('---\ntags: [a,b,c] # mine\n---\n', { tags: ['a', 'c', 'd'] })).toBe('---\ntags: [a,c,d] # mine\n---\n')
  })

  test('a flow list written over several lines grows in the block’s line ending', () => {
    expect(mergeFrontMatter('---\r\ntags: [\r\n  a,\r\n  b\r\n]\r\n---\r\n', { tags: ['z', 'a', 'b', 'c'] })).toBe(
      '---\r\ntags: [\r\n  z,\r\n  a,\r\n  b,\r\n  c\r\n]\r\n---\r\n'
    )
  })

  test('a path list goes in right after its names, indented like the block’s other lists', () => {
    expect(mergeFrontMatter(HAND, { skills: ['writer', 'editor'], skill_paths: ['/w', '/e'] })).toBe(
      HAND.replace('    - writer\n', '    - writer\n    - editor\nskill_paths:\n    - /w\n    - /e\n')
    )
  })

  test('a new key goes after the last key, above comments at the bottom, or before the fence', () => {
    expect(mergeFrontMatter('---\ntitle:   x\n\n# end\n---\n', { status: 'draft' })).toBe('---\ntitle:   x\nstatus: draft\n\n# end\n---\n')
    expect(mergeFrontMatter('---\n# only a comment\n---\n', { status: 'draft' })).toBe('---\n# only a comment\nstatus: draft\n---\n')
  })

  test('a value that would not change is not written, so its quotes and spelling stay', () => {
    const raw = "---\ntitle: 'Notes'\nid: 007\n---\n"
    expect(mergeFrontMatter(raw, { title: 'Notes', id: 7 })).toBe(raw)
  })

  test('new text keeps the quotes the old text had', () => {
    expect(mergeFrontMatter("---\ntitle:  'Old'  # c\n---\n", { title: 'New' })).toBe("---\ntitle:  'New'  # c\n---\n")
  })

  test('each untouched line keeps its own line ending; new lines use the block’s', () => {
    expect(mergeFrontMatter('---\r\ntitle:  a\nnote: b\r\n---\r\n', { title: 'c', status: 'x' })).toBe(
      '---\r\ntitle:  c\nnote: b\r\nstatus: x\r\n---\r\n'
    )
  })

  test('a 1.1 tag renamed in place keeps its quotes and comment', () => {
    const rename = { rename: (tag: string) => tag.replace(/^agent\//, 'skill/') }
    expect(mergeFrontMatter('---\ntags:\n  - "agent/x" # c\n  - keep\n---\n', { tags: rename })).toBe(
      '---\ntags:\n  - "skill/x" # c\n  - keep\n---\n'
    )
  })

  test('a block whose keys are all indented stays indented', () => {
    expect(mergeFrontMatter('---\n  title: x\n  tags:\n    - a\n---\n', { status: 'draft', tags: ['a', 'b'] })).toBe(
      '---\n  title: x\n  tags:\n    - a\n    - b\n  status: draft\n---\n'
    )
  })

  test('the archive stamp is the only line added to a hand-written block', () => {
    expect(addArchived(`${HAND}Body\n`, '2026-10-04T10:00:00-04:00')).toBe(
      HAND.replace('    code:   B-101\n', '    code:   B-101\narchived: 2026-10-04T10:00:00-04:00\n') + 'Body\n'
    )
  })

  test('YAML that cannot be spliced line by line is still patched, by rewriting the block', () => {
    expect(mergeFrontMatter('---\n{title: a}\n---\n', { title: 'b' })).toBe('---\n{title: b}\n---\n')
  })

  test('an archive stamp copied from an earlier archive is replaced where it stands', () => {
    expect(addArchived('---\narchived:  old  # copy\nid:   1\n---\nx\n', 'new')).toBe('---\narchived:  new  # copy\nid:   1\n---\nx\n')
  })
})
