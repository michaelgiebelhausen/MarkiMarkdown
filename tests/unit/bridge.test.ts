import { describe, expect, test } from 'vitest'
import {
  parseMarkdown,
  serializeDoc,
  patchMarkdown,
  patchMarkdownDetailed
} from '@renderer/editors/pm/bridge'
import { schema } from '@renderer/editors/pm/schema'

/** Replaces the text of the nth top-level paragraph, the way typing in the pane would. */
function editParagraph(doc: import('prosemirror-model').Node, index: number, text: string) {
  const children: import('prosemirror-model').Node[] = []
  doc.forEach((child, _offset, i) => {
    children.push(i === index ? schema.nodes.paragraph.create(null, schema.text(text)) : child)
  })
  return schema.nodes.doc.create(null, children)
}

describe('parseMarkdown', () => {
  test('gives one block per top-level construct', () => {
    const src = '# Title\n\nFirst.\n\nSecond.\n'
    const parsed = parseMarkdown(src)
    expect(parsed.doc.childCount).toBe(3)
    expect(parsed.blocks.length).toBe(3)
  })

  test('records source offsets that slice back to the original text', () => {
    const src = '# Title\n\nFirst.\n'
    const parsed = parseMarkdown(src)
    expect(src.slice(parsed.blocks[0].start, parsed.blocks[0].end)).toBe('# Title')
    expect(src.slice(parsed.blocks[1].start, parsed.blocks[1].end)).toBe('First.')
  })

  test('reads headings, emphasis, links and inline code', () => {
    const parsed = parseMarkdown('## Sub\n\nA **bold** and *thin* [link](http://x) and `code`.\n')
    expect(parsed.doc.child(0).type.name).toBe('heading')
    expect(parsed.doc.child(0).attrs.level).toBe(2)
    const marks = new Set<string>()
    parsed.doc.child(1).descendants((n) => {
      n.marks.forEach((m) => marks.add(m.type.name))
    })
    expect(marks).toEqual(new Set(['strong', 'em', 'link', 'code']))
  })

  test('reads bullet, ordered and task lists', () => {
    const parsed = parseMarkdown('- one\n- two\n\n1. first\n\n- [ ] todo\n- [x] done\n')
    expect(parsed.doc.child(0).type.name).toBe('bullet_list')
    expect(parsed.doc.child(1).type.name).toBe('ordered_list')
    const tasks = parsed.doc.child(2)
    expect(tasks.child(0).attrs.checked).toBe(false)
    expect(tasks.child(1).attrs.checked).toBe(true)
  })

  test('turns a table into a single read-only raw block', () => {
    const src = '| a | b |\n| --- | --- |\n| 1 | 2 |\n'
    const parsed = parseMarkdown(src)
    expect(parsed.doc.childCount).toBe(1)
    expect(parsed.doc.child(0).type.name).toBe('raw_block')
    expect(parsed.doc.child(0).attrs.value).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |')
  })

  test('turns block quotes, fenced code and raw HTML into raw blocks', () => {
    const parsed = parseMarkdown('> quoted\n\n```js\ncode()\n```\n\n<div>hi</div>\n')
    expect(parsed.doc.childCount).toBe(3)
    for (let i = 0; i < 3; i++) expect(parsed.doc.child(i).type.name).toBe('raw_block')
  })

  test('keeps a wikilink inside a paragraph as a raw inline node', () => {
    const parsed = parseMarkdown('See [[My Note]] please.\n')
    const names: string[] = []
    parsed.doc.child(0).forEach((n) => names.push(n.type.name))
    expect(names).toContain('raw_inline')
    let value = ''
    parsed.doc.child(0).forEach((n) => {
      if (n.type.name === 'raw_inline') value = n.attrs.value
    })
    expect(value).toBe('[[My Note]]')
  })

  test('never throws on unusual input', () => {
    const nasty = '---\n\n[^1]: note\n\nfootnote[^1]\n\n<!-- c -->\n\n    indented code\n'
    expect(() => parseMarkdown(nasty)).not.toThrow()
  })
})

describe('serializeDoc', () => {
  test('round-trips canonical markdown unchanged', () => {
    const src = [
      '# Title',
      '',
      'A **bold** and *thin* word.',
      '',
      '- one',
      '- two',
      '',
      '1. first',
      '2. second',
      '',
      '- [ ] todo',
      '- [x] done',
      '',
      '---',
      '',
      'End with a [link](http://x) and `code`.',
      ''
    ].join('\n')
    expect(serializeDoc(parseMarkdown(src).doc)).toBe(src)
  })

  test('writes raw blocks back byte for byte', () => {
    const src = '| a | b |\n| --- | --- |\n| 1 | 2 |\n'
    expect(serializeDoc(parseMarkdown(src).doc)).toBe(src)
  })
})

describe('patchMarkdown', () => {
  test('leaves every untouched block byte-identical when one paragraph changes', () => {
    const src = [
      '---',
      'title: Kept',
      '---',
      '',
      '## Setext-ish heading',
      '',
      'Original words here.',
      '',
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      'A [[wikilink]] and snake_case and 1984. survive.',
      ''
    ].join('\n')
    // front matter is never given to the editor, so patch only sees the body
    const body = src.slice(src.indexOf('## Setext'))
    const parsed = parseMarkdown(body)
    const paragraphIndex = 1
    const next = editParagraph(parsed.doc, paragraphIndex, 'Edited words here.')
    const out = patchMarkdown(parsed, next)

    expect(out).toContain('Edited words here.')
    expect(out).toContain('| a | b |')
    expect(out).toContain('[[wikilink]] and snake_case and 1984. survive.')
    expect(out).not.toContain(String.raw`\[`)
    expect(out).not.toContain(String.raw`snake\_case`)
  })

  test('returns the original text exactly when nothing changed', () => {
    const body = 'Alpha.\n\n> quoted\n\nOmega with 5*3 and _under_score_.\n'
    const parsed = parseMarkdown(body)
    expect(patchMarkdown(parsed, parsed.doc)).toBe(body)
  })

  test('handles a block being inserted', () => {
    const body = 'One.\n\nTwo.\n'
    const parsed = parseMarkdown(body)
    const kids: import('prosemirror-model').Node[] = []
    parsed.doc.forEach((c) => kids.push(c))
    kids.splice(1, 0, schema.nodes.paragraph.create(null, schema.text('Inserted.')))
    const out = patchMarkdown(parsed, schema.nodes.doc.create(null, kids))
    expect(out).toBe('One.\n\nInserted.\n\nTwo.\n')
  })

  test('handles a block being deleted', () => {
    const body = 'One.\n\nTwo.\n\nThree.\n'
    const parsed = parseMarkdown(body)
    const kids: import('prosemirror-model').Node[] = []
    parsed.doc.forEach((c, _o, i) => {
      if (i !== 1) kids.push(c)
    })
    const out = patchMarkdown(parsed, schema.nodes.doc.create(null, kids))
    expect(out).toBe('One.\n\nThree.\n')
  })

  test('preserves the trailing newline state of the source', () => {
    const withNl = parseMarkdown('One.\n')
    expect(patchMarkdown(withNl, withNl.doc)).toBe('One.\n')
    const withoutNl = parseMarkdown('One.')
    expect(patchMarkdown(withoutNl, withoutNl.doc)).toBe('One.')
  })

  test('serialises a newly typed heading in canonical form', () => {
    const body = 'Text.\n'
    const parsed = parseMarkdown(body)
    const kids: import('prosemirror-model').Node[] = []
    parsed.doc.forEach((c) => kids.push(c))
    kids.push(schema.nodes.heading.create({ level: 2 }, schema.text('New heading')))
    const out = patchMarkdown(parsed, schema.nodes.doc.create(null, kids))
    expect(out).toBe('Text.\n\n## New heading\n')
  })
})

describe('patchMarkdownDetailed', () => {
  test('returns block offsets that line up with the new document', () => {
    const body = 'One.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nThree.\n'
    const parsed = parseMarkdown(body)
    const kids: import('prosemirror-model').Node[] = []
    parsed.doc.forEach((c) => kids.push(c))
    kids[0] = schema.nodes.paragraph.create(null, schema.text('Edited.'))
    const next = schema.nodes.doc.create(null, kids)

    const result = patchMarkdownDetailed(parsed, next)

    expect(result.text).toContain('Edited.')
    expect(result.blocks.length).toBe(next.childCount)
    expect(result.text.slice(result.blocks[0].start, result.blocks[0].end)).toBe('Edited.')
    expect(result.text.slice(result.blocks[1].start, result.blocks[1].end)).toBe(
      '| a | b |\n| --- | --- |\n| 1 | 2 |'
    )
    expect(result.text.slice(result.blocks[2].start, result.blocks[2].end)).toBe('Three.')
  })

  test('stays byte-identical across repeated patches, the way typing does', () => {
    const body = 'Alpha.\n\n> quoted\n\n[[link]] and snake_case.\n'
    let parsed = parseMarkdown(body)

    for (const word of ['One', 'Two', 'Three']) {
      const kids: import('prosemirror-model').Node[] = []
      parsed.doc.forEach((c) => kids.push(c))
      kids[0] = schema.nodes.paragraph.create(null, schema.text(word))
      const next = schema.nodes.doc.create(null, kids)
      const result = patchMarkdownDetailed(parsed, next)
      parsed = { doc: next, blocks: result.blocks, src: result.text }
    }

    expect(parsed.src).toBe('Three\n\n> quoted\n\n[[link]] and snake_case.\n')
  })

  test('agrees with patchMarkdown on the text', () => {
    const body = 'One.\n\nTwo.\n'
    const parsed = parseMarkdown(body)
    expect(patchMarkdownDetailed(parsed, parsed.doc).text).toBe(patchMarkdown(parsed, parsed.doc))
  })
})
