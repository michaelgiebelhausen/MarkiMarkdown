import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { parseMarkdown, patchMarkdown } from '@renderer/editors/pm/bridge'
import { splitFrontMatter } from '@shared/markdown/frontmatter'
import { schema } from '@renderer/editors/pm/schema'
import type { Node as PMNode } from 'prosemirror-model'

const dir = join(process.cwd(), 'tests', 'fixtures')
const names = readdirSync(dir).filter((n) => n.endsWith('.md'))

function bodyOf(name: string): string {
  const text = readFileSync(join(dir, name), 'utf8')
  return splitFrontMatter(text).body
}

function children(doc: PMNode): PMNode[] {
  const out: PMNode[] = []
  doc.forEach((c) => out.push(c))
  return out
}

describe('byte fidelity across real-world exports', () => {
  test('there are fixtures to check', () => {
    expect(names.length).toBeGreaterThanOrEqual(4)
  })

  for (const name of names) {
    test(`${name}: opening and saving without editing changes nothing`, () => {
      const body = bodyOf(name)
      const parsed = parseMarkdown(body)
      expect(patchMarkdown(parsed, parsed.doc)).toBe(body)
    })

    test(`${name}: editing one paragraph leaves every other block byte-identical`, () => {
      const body = bodyOf(name)
      const parsed = parseMarkdown(body)
      const kids = children(parsed.doc)
      const target = kids.findIndex((k) => k.type.name === 'paragraph')
      expect(target).toBeGreaterThanOrEqual(0)

      const edited = kids.slice()
      edited[target] = schema.nodes.paragraph.create(null, schema.text('EDITED_SENTINEL'))
      const out = patchMarkdown(parsed, schema.nodes.doc.create(null, edited))

      expect(out).toContain('EDITED_SENTINEL')

      // every other original block must still appear verbatim
      for (let i = 0; i < parsed.blocks.length; i++) {
        if (i === target) continue
        const original = body.slice(parsed.blocks[i].start, parsed.blocks[i].end)
        expect(out).toContain(original)
      }
    })
  }

  test('obsidian constructs are never escaped or renumbered', () => {
    const body = bodyOf('obsidian.md')
    const parsed = parseMarkdown(body)
    const kids = children(parsed.doc)
    // edit a paragraph that holds none of the constructs asserted below
    const target = kids.findIndex(
      (k) => k.type.name === 'paragraph' && k.textContent.includes('describes forgetting')
    )
    expect(target).toBeGreaterThanOrEqual(0)
    const edited = kids.slice()
    edited[target] = schema.nodes.paragraph.create(null, schema.text('EDITED'))
    const out = patchMarkdown(parsed, schema.nodes.doc.create(null, edited))

    expect(out).toContain('EDITED')
    expect(out).toContain('[[Cognitive Load Theory]]')
    expect(out).toContain('==Highlighted claim==')
    expect(out).toContain('> [!note] Callout')
    expect(out).toContain('[^1]: The footnote body.')
    expect(out).toContain('snake_case')
    expect(out).not.toContain(String.raw`\[`)
    expect(out).not.toContain(String.raw`snake\_case`)
  })

  test('a CRLF document keeps its CRLF line endings', () => {
    const body = bodyOf('crlf.md')
    expect(body).toContain('\r\n')
    const parsed = parseMarkdown(body)
    expect(patchMarkdown(parsed, parsed.doc)).toBe(body)
  })

  test('fenced code and tables stay put when a neighbouring paragraph is edited', () => {
    const body = bodyOf('chatgpt.md')
    const parsed = parseMarkdown(body)
    const kids = children(parsed.doc)
    const target = kids.findIndex((k) => k.type.name === 'paragraph')
    const edited = kids.slice()
    edited[target] = schema.nodes.paragraph.create(null, schema.text('EDITED'))
    const out = patchMarkdown(parsed, schema.nodes.doc.create(null, edited))
    expect(out).toContain('```python\ndef recall(cue):\n    return memory.get(cue)\n```')
  })
})
