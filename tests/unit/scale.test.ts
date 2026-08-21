import { describe, expect, test } from 'vitest'
import { parseMarkdown, patchMarkdownDetailed } from '@renderer/editors/pm/bridge'
import { schema } from '@renderer/editors/pm/schema'
import type { Node as PMNode } from 'prosemirror-model'

function bigDoc(paragraphs: number): string {
  const out: string[] = []
  for (let i = 0; i < paragraphs; i++) out.push(`Paragraph number ${i} with a sentence in it.`, '')
  return out.join('\n')
}

function children(doc: PMNode): PMNode[] {
  const out: PMNode[] = []
  doc.forEach((c) => out.push(c))
  return out
}

describe('a term of notes in one file', () => {
  test('editing one paragraph of a very long note is quick and keeps the rest', () => {
    const body = bigDoc(4000)
    const parsed = parseMarkdown(body)
    expect(parsed.doc.childCount).toBe(4000)

    const kids = children(parsed.doc)
    kids[2000] = schema.nodes.paragraph.create(null, schema.text('EDITED_SENTINEL'))
    const next = schema.nodes.doc.create(null, kids)

    const started = Date.now()
    const patched = patchMarkdownDetailed(parsed, next)
    const elapsed = Date.now() - started

    expect(patched.text).toContain('EDITED_SENTINEL')
    expect(patched.text).toContain('Paragraph number 0 with a sentence in it.')
    expect(patched.text).toContain('Paragraph number 3999 with a sentence in it.')
    expect(patched.blocks.length).toBe(4000)
    expect(elapsed).toBeLessThan(80)
  })

  test('inserting a paragraph in the middle of a very long note is quick', () => {
    const body = bigDoc(4000)
    const parsed = parseMarkdown(body)
    const kids = children(parsed.doc)
    kids.splice(1500, 0, schema.nodes.paragraph.create(null, schema.text('INSERTED')))
    const next = schema.nodes.doc.create(null, kids)

    const started = Date.now()
    const patched = patchMarkdownDetailed(parsed, next)
    expect(Date.now() - started).toBeLessThan(80)
    expect(patched.blocks.length).toBe(4001)
    expect(patched.text).toContain('INSERTED')
    expect(patched.text).toContain('Paragraph number 1499 with a sentence in it.')
    expect(patched.text).toContain('Paragraph number 1500 with a sentence in it.')
  })

  test('deleting a paragraph from a very long note is quick', () => {
    const body = bigDoc(4000)
    const parsed = parseMarkdown(body)
    const kids = children(parsed.doc).filter((_, i) => i !== 800)
    const next = schema.nodes.doc.create(null, kids)

    const started = Date.now()
    const patched = patchMarkdownDetailed(parsed, next)
    expect(Date.now() - started).toBeLessThan(80)
    expect(patched.blocks.length).toBe(3999)
    expect(patched.text).not.toContain('Paragraph number 800 with')
    expect(patched.text).toContain('Paragraph number 801 with')
  })
})
