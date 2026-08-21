import { describe, expect, test } from 'vitest'
import { parseMarkdown, patchMarkdownDetailed, serializeDoc } from '@renderer/editors/pm/bridge'
import { schema } from '@renderer/editors/pm/schema'
import { EditorState, TextSelection } from 'prosemirror-state'
import type { Node as PMNode } from 'prosemirror-model'

const FENCE = '```'

const NESTED = [
  '1. Open the file',
  '',
  `   ${FENCE}python`,
  '   open("notes.txt")',
  `   ${FENCE}`,
  '',
  '2. Read it',
  ''
].join('\n')

/** Types text at the given position, the way the editor does. */
function typeAt(doc: PMNode, pos: number, text: string): PMNode {
  const state = EditorState.create({ doc, schema })
  const tr = state.tr.setSelection(TextSelection.near(doc.resolve(pos))).insertText(text)
  return tr.doc
}

/** Position just inside the first paragraph in the document. */
function firstParagraphPos(doc: PMNode): number {
  let found = -1
  doc.descendants((node, pos) => {
    if (found >= 0) return false
    if (node.type === schema.nodes.paragraph) {
      found = pos + 1
      return false
    }
    return true
  })
  return found
}

describe('content nested inside a list item', () => {
  test('a code fence inside a numbered list survives a round trip untouched', () => {
    const parsed = parseMarkdown(NESTED)
    expect(patchMarkdownDetailed(parsed, parsed.doc).text).toBe(NESTED)
  })

  test('the fence is kept as a verbatim block, not re-indented', () => {
    const out = serializeDoc(parseMarkdown(NESTED).doc)
    expect(out).toContain('open("notes.txt")')
    expect(out).not.toContain(`      ${FENCE}python`)
  })

  test('typing in the list item does not grow the indentation each time', () => {
    let parsed = parseMarkdown(NESTED)
    const widths: number[] = []

    for (let round = 0; round < 3; round++) {
      const pos = firstParagraphPos(parsed.doc)
      expect(pos).toBeGreaterThan(0)
      const next = typeAt(parsed.doc, pos, 'X')
      const patched = patchMarkdownDetailed(parsed, next)
      parsed = { doc: next, blocks: patched.blocks, src: patched.text }
      const fenceLine = patched.text.split('\n').find((l) => l.includes(`${FENCE}python`)) ?? ''
      widths.push(fenceLine.length - fenceLine.trimStart().length)
    }

    expect(parsed.src).toContain('open("notes.txt")')
    expect(widths[1]).toBe(widths[0])
    expect(widths[2]).toBe(widths[0])
  })

  test('the code inside the fence is never lost', () => {
    let parsed = parseMarkdown(NESTED)
    for (let round = 0; round < 5; round++) {
      const next = typeAt(parsed.doc, firstParagraphPos(parsed.doc), 'Y')
      const patched = patchMarkdownDetailed(parsed, next)
      parsed = { doc: next, blocks: patched.blocks, src: patched.text }
    }
    expect(parsed.src).toContain('open("notes.txt")')
    expect(parsed.src).toContain(`${FENCE}python`)
  })
  test('the code inside a nested fence keeps its own indentation', () => {
    const parsed = parseMarkdown(NESTED)
    const pos = firstParagraphPos(parsed.doc)
    const next = typeAt(parsed.doc, pos, 'X')
    const out = patchMarkdownDetailed(parsed, next).text
    const lines = out.split('\n')
    const open = lines.find((l) => l.includes('open("notes.txt")')) as string
    const fence = lines.find((l) => l.includes(`${FENCE}python`)) as string
    expect(open).toBeDefined()
    // the code line must sit at the same depth as the fence that opens it
    const indentOf = (l: string) => l.length - l.trimStart().length
    expect(indentOf(open)).toBe(indentOf(fence))
  })

  test('a list with blank lines between its items keeps them', () => {
    const parsed = parseMarkdown(NESTED)
    const next = typeAt(parsed.doc, firstParagraphPos(parsed.doc), 'X')
    const out = patchMarkdownDetailed(parsed, next).text
    expect(out).toContain('\n\n2. Read it')
  })

  test('a tight list stays tight', () => {
    const tight = ['- one', '- two', '- three', ''].join(String.fromCharCode(10))
    const parsed = parseMarkdown(tight)
    const next = typeAt(parsed.doc, firstParagraphPos(parsed.doc), 'X')
    const out = patchMarkdownDetailed(parsed, next).text
    const expected = ['- Xone', '- two', '- three', ''].join(String.fromCharCode(10))
    expect(out).toBe(expected)
  })

  test('an indented top-level fence keeps its indentation when a neighbour is edited', () => {
    const src = ['Intro.', '', '  ' + FENCE + 'js', '  code()', '  ' + FENCE, ''].join(
      String.fromCharCode(10)
    )
    const parsed = parseMarkdown(src)
    const kids: PMNode[] = []
    parsed.doc.forEach((c) => kids.push(c))
    kids[0] = schema.nodes.paragraph.create(null, schema.text('XIntro.'))
    const out = patchMarkdownDetailed(parsed, schema.nodes.doc.create(null, kids)).text

    const lines = out.split(String.fromCharCode(10))
    const open = lines.find((l) => l.includes(FENCE + 'js')) as string
    const code = lines.find((l) => l.includes('code()')) as string
    const indentOf = (l: string) => l.length - l.trimStart().length
    // the fence and its contents must stay at the same relative depth as before
    expect(indentOf(open)).toBe(indentOf(code))
  })
})
