import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import {
  looksLikePlainText,
  convertTextToMarkdown,
  type ConversionResult
} from '@shared/markdown/txtToMd'

/** Convenience: the count reported for one rule, or 0 when the rule never fired. */
function changeCount(r: ConversionResult, rule: string): number {
  const hit = r.changes.find((c) => c.rule === rule)
  return hit ? hit.count : 0
}

/** The rules that fired, in report order. */
function firedRules(r: ConversionResult): string[] {
  return r.changes.map((c) => c.rule)
}

describe('looksLikePlainText', () => {
  test('true for ordinary prose with no Markdown syntax', () => {
    expect(looksLikePlainText('Lecture notes\n\nThe cell wall is rigid.\n')).toBe(true)
  })

  test('true for an empty document', () => {
    expect(looksLikePlainText('')).toBe(true)
  })

  test('true for plain-text bullets, which are exactly what we want to offer to convert', () => {
    expect(looksLikePlainText('Topics\n\n\u2022 mitosis\n\u2022 meiosis\n')).toBe(true)
    expect(looksLikePlainText('Topics\n\n\u2013 mitosis\n\u2013 meiosis\n')).toBe(true)
  })

  test('false when the document already has an ATX heading', () => {
    expect(looksLikePlainText('# Lecture notes\n\nThe cell wall is rigid.\n')).toBe(false)
  })

  test('false when the document already has hyphen bullets', () => {
    expect(looksLikePlainText('Topics\n\n- mitosis\n- meiosis\n')).toBe(false)
  })

  test('false when the document already has asterisk bullets', () => {
    expect(looksLikePlainText('Topics\n\n* mitosis\n')).toBe(false)
  })

  test('false when the document has a fenced code block', () => {
    expect(looksLikePlainText('Example\n\n```\nprint(1)\n```\n')).toBe(false)
  })

  test('false when the document has an inline link', () => {
    expect(looksLikePlainText('See [the syllabus](https://example.com) for dates.\n')).toBe(false)
  })

  test('false when the document has bold text', () => {
    expect(looksLikePlainText('This is **important** for the exam.\n')).toBe(false)
  })

  test('false for a document that is already Markdown', () => {
    const alreadyMarkdown = [
      '# Biology 101',
      '',
      'Notes from **lecture 3**, see [the slides](https://example.com/slides).',
      '',
      '- mitosis',
      '- meiosis',
      ''
    ].join('\n')
    expect(looksLikePlainText(alreadyMarkdown)).toBe(false)
  })

  test('a thematic break or setext underline is not mistaken for a bullet', () => {
    expect(looksLikePlainText('PROJECT NOTES\n=============\n\nBody.\n')).toBe(true)
    expect(looksLikePlainText('Some text\n\n---\n\nMore text\n')).toBe(true)
  })

  test('never throws when handed something that is not a string', () => {
    expect(() => looksLikePlainText(undefined as unknown as string)).not.toThrow()
    expect(looksLikePlainText(undefined as unknown as string)).toBe(false)
  })
})

describe('convertTextToMarkdown - bullets', () => {
  test('converts a run of two or more identical bullet characters to "- "', () => {
    const r = convertTextToMarkdown('Shopping\n\n\u2022 milk\n\u2022 eggs\n\u2022 bread\n')
    expect(r.markdown).toBe('Shopping\n\n- milk\n- eggs\n- bread\n')
    expect(changeCount(r, 'bullets')).toBe(3)
  })

  test('converts every plain-text bullet character in the set', () => {
    const markers = ['\u2022', '\u25E6', '\u25AA', '\u00B7', '\u2013', '\u2014', '*']
    for (const m of markers) {
      const r = convertTextToMarkdown(`${m} one\n${m} two\n`)
      expect(r.markdown).toBe('- one\n- two\n')
      expect(changeCount(r, 'bullets')).toBe(2)
    }
  })

  test('leaves a lone "* " line alone because it has no sibling', () => {
    const src = 'Here is a note.\n\n* just one line\n\nAnd more text.\n'
    const r = convertTextToMarkdown(src)
    expect(r.markdown).toBe(src)
    expect(changeCount(r, 'bullets')).toBe(0)
  })

  test('leaves a lone bullet character alone', () => {
    const src = 'A sentence.\n\n\u2022 only item\n\nAnother sentence.\n'
    expect(convertTextToMarkdown(src).markdown).toBe(src)
  })

  test('does not convert adjacent lines that use different bullet characters', () => {
    const src = '\u2022 first\n\u2013 second\n'
    const r = convertTextToMarkdown(src)
    expect(r.markdown).toBe(src)
    expect(changeCount(r, 'bullets')).toBe(0)
  })

  test('converts two separate runs independently and preserves indentation', () => {
    const src = '\u2022 a\n\u2022 b\n\ntext\n\n  \u2013 c\n  \u2013 d\n'
    const r = convertTextToMarkdown(src)
    expect(r.markdown).toBe('- a\n- b\n\ntext\n\n  - c\n  - d\n')
    expect(changeCount(r, 'bullets')).toBe(4)
  })

  test('requires a space after the bullet character', () => {
    const src = '\u2022milk\n\u2022eggs\n'
    expect(convertTextToMarkdown(src).markdown).toBe(src)
  })

  test('leaves hyphen bullets that are already Markdown untouched', () => {
    const src = '- milk\n- eggs\n'
    const r = convertTextToMarkdown(src)
    expect(r.markdown).toBe(src)
    expect(changeCount(r, 'bullets')).toBe(0)
  })
})

describe('convertTextToMarkdown - numbering', () => {
  test('converts a run of "1)" style numbering to "1. "', () => {
    const r = convertTextToMarkdown('Steps:\n\n1) open the file\n2) edit it\n3) save it\n')
    expect(r.markdown).toBe('Steps:\n\n1. open the file\n2. edit it\n3. save it\n')
    expect(changeCount(r, 'numbering')).toBe(3)
  })

  test('leaves a lone "1)" line alone because it has no sibling', () => {
    const src = 'See the guide.\n\n1) only step\n\nDone.\n'
    const r = convertTextToMarkdown(src)
    expect(r.markdown).toBe(src)
    expect(changeCount(r, 'numbering')).toBe(0)
  })

  test('reports no change when the numbering is already "1." style', () => {
    const src = '1. open the file\n2. edit it\n'
    const r = convertTextToMarkdown(src)
    expect(r.markdown).toBe(src)
    expect(changeCount(r, 'numbering')).toBe(0)
  })

  test('counts only the lines it actually rewrote in a mixed run', () => {
    const r = convertTextToMarkdown('1) first\n2. second\n3) third\n')
    expect(r.markdown).toBe('1. first\n2. second\n3. third\n')
    expect(changeCount(r, 'numbering')).toBe(2)
  })
})

describe('convertTextToMarkdown - headings', () => {
  test('promotes all-caps lines when the document has at least three of them', () => {
    const src = [
      'INTRODUCTION AND SCOPE',
      '',
      'Some body text here.',
      '',
      'METHODS AND MATERIALS',
      '',
      'More body text here.',
      '',
      'RESULTS AND DISCUSSION',
      '',
      'Final body text here.',
      ''
    ].join('\n')
    const r = convertTextToMarkdown(src)
    expect(r.markdown).toBe(
      [
        '## INTRODUCTION AND SCOPE',
        '',
        'Some body text here.',
        '',
        '## METHODS AND MATERIALS',
        '',
        'More body text here.',
        '',
        '## RESULTS AND DISCUSSION',
        '',
        'Final body text here.',
        ''
      ].join('\n')
    )
    expect(changeCount(r, 'headings')).toBe(3)
  })

  test('does not promote all-caps lines when there are only two of them', () => {
    const src = 'FIRST SECTION\n\nBody one.\n\nSECOND SECTION\n\nBody two.\n'
    const r = convertTextToMarkdown(src)
    expect(r.markdown).toBe(src)
    expect(changeCount(r, 'headings')).toBe(0)
  })

  test('promotes a single all-caps line carrying a setext underline and removes the underline', () => {
    const r = convertTextToMarkdown('PROJECT NOTES\n=============\n\nBody text follows here.\n')
    expect(r.markdown).toBe('## PROJECT NOTES\n\nBody text follows here.\n')
    expect(changeCount(r, 'headings')).toBe(1)
  })

  test('accepts a hyphen setext underline whose length is within three of the line', () => {
    const r = convertTextToMarkdown('PROJECT NOTES\n----------\n\nBody text follows here.\n')
    expect(r.markdown).toBe('## PROJECT NOTES\n\nBody text follows here.\n')
    expect(changeCount(r, 'headings')).toBe(1)
  })

  test('ignores an underline whose length is nowhere near the line length', () => {
    const src = 'PROJECT NOTES\n===\n\nBody text follows here.\n'
    const r = convertTextToMarkdown(src)
    expect(r.markdown).toBe(src)
    expect(changeCount(r, 'headings')).toBe(0)
  })

  test('a one-word line such as NASA never becomes a heading', () => {
    const src = 'NASA\n\nSome text about the agency.\n'
    const r = convertTextToMarkdown(src)
    expect(r.markdown).toBe(src)
    expect(changeCount(r, 'headings')).toBe(0)
  })

  test('a one-word line is skipped even while its neighbours are promoted', () => {
    const src = [
      'NASA',
      '',
      'The agency was founded long ago.',
      '',
      'BUDGET AND FUNDING',
      '',
      'More text.',
      '',
      'FUTURE MISSIONS',
      '',
      'Still more text.',
      '',
      'OPEN QUESTIONS',
      '',
      'End.',
      ''
    ].join('\n')
    const r = convertTextToMarkdown(src)
    expect(r.markdown.startsWith('NASA\n')).toBe(true)
    expect(r.markdown).not.toContain('## NASA')
    expect(r.markdown).toContain('## BUDGET AND FUNDING')
    expect(r.markdown).toContain('## FUTURE MISSIONS')
    expect(r.markdown).toContain('## OPEN QUESTIONS')
    expect(changeCount(r, 'headings')).toBe(3)
  })
})

describe('convertTextToMarkdown - heading false positives', () => {
  test('a line ending in a colon is never a heading', () => {
    const src = [
      'TODO LIST:',
      '',
      'Something here.',
      '',
      'FIRST SECTION',
      '',
      'Text one.',
      '',
      'SECOND SECTION',
      '',
      'Text two.',
      '',
      'THIRD SECTION',
      '',
      'Text three.',
      ''
    ].join('\n')
    const r = convertTextToMarkdown(src)
    expect(r.markdown.startsWith('TODO LIST:\n')).toBe(true)
    expect(r.markdown).not.toContain('## TODO LIST:')
    expect(changeCount(r, 'headings')).toBe(3)
  })

  test('lines ending in other sentence punctuation are never headings', () => {
    for (const tail of ['.', '!', '?', ':', ';', ',']) {
      const src = `ALL CAPS SENTENCE HERE${tail}\n${'='.repeat(22)}\n\nBody.\n`
      const r = convertTextToMarkdown(src)
      expect(r.markdown).toBe(src)
      expect(changeCount(r, 'headings')).toBe(0)
    }
  })

  test('a line with more than eight words is never a heading', () => {
    const line = 'ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE'
    const src = `${line}\n${'='.repeat(line.length)}\n\nBody.\n`
    const r = convertTextToMarkdown(src)
    expect(r.markdown).toBe(src)
    expect(changeCount(r, 'headings')).toBe(0)
  })

  test('a line with only one word is never a heading even with a setext underline', () => {
    const src = 'OVERVIEW\n========\n\nBody.\n'
    const r = convertTextToMarkdown(src)
    expect(r.markdown).toBe(src)
    expect(changeCount(r, 'headings')).toBe(0)
  })

  test('a mixed-case line is never a heading', () => {
    const src = 'Project Notes\n=============\n\nBody.\n'
    const r = convertTextToMarkdown(src)
    expect(r.markdown).toBe(src)
    expect(changeCount(r, 'headings')).toBe(0)
  })

  test('a line with no letters at all is never a heading', () => {
    const src = '123 456\n=======\n\nBody.\n'
    const r = convertTextToMarkdown(src)
    expect(r.markdown).toBe(src)
    expect(changeCount(r, 'headings')).toBe(0)
  })

  test('an all-caps line without a blank line before it is never a heading', () => {
    const src = 'Intro paragraph.\nMETHODS AND MATERIALS\n\nBody.\n\nRESULTS AND SCOPE\n\nMore.\n\nOPEN QUESTIONS\n\nEnd.\n'
    const r = convertTextToMarkdown(src)
    expect(r.markdown).not.toContain('## METHODS AND MATERIALS')
  })

  test('an all-caps bullet line is never promoted to a heading', () => {
    const src = '\u2022 FIRST ITEM\n\u2022 SECOND ITEM\n'
    const r = convertTextToMarkdown(src)
    expect(r.markdown).toBe('- FIRST ITEM\n- SECOND ITEM\n')
    expect(changeCount(r, 'headings')).toBe(0)
  })

  test('a setext underline is only honoured when a blank line or the end of file follows it', () => {
    const src = 'PROJECT NOTES\n=============\nBody text follows immediately.\n'
    const r = convertTextToMarkdown(src)
    expect(r.markdown).toBe(src)
    expect(changeCount(r, 'headings')).toBe(0)
  })
})

describe('convertTextToMarkdown - unwrap', () => {
  test('joins a hard-wrapped paragraph into one line', () => {
    const src =
      'The quick brown fox jumps over the lazy dog and\n' +
      'then it runs away into the deep dark forest to\n' +
      'find something else entirely to do today.\n'
    const r = convertTextToMarkdown(src)
    expect(r.markdown).toBe(
      'The quick brown fox jumps over the lazy dog and then it runs away into the deep dark forest to find something else entirely to do today.\n'
    )
    expect(changeCount(r, 'unwrap')).toBe(1)
  })

  test('does not join across a blank line', () => {
    const src =
      'The quick brown fox jumps over the lazy dog and\n' +
      'then it runs away into the deep dark forest to\n' +
      '\n' +
      'A second paragraph that is also long enough to\n' +
      'be considered hard wrapped by any measure here.\n'
    const r = convertTextToMarkdown(src)
    expect(r.markdown.split('\n\n').length).toBe(2)
    expect(changeCount(r, 'unwrap')).toBe(2)
  })

  test('does not unwrap an address block of short lines', () => {
    const src = 'Emily Dickinson\n123 Main Street\nAmherst MA 01002\n'
    const r = convertTextToMarkdown(src)
    expect(r.markdown).toBe(src)
    expect(changeCount(r, 'unwrap')).toBe(0)
  })

  test('does not unwrap a poem with short lines', () => {
    const src = 'Roses are red\nViolets are blue\nSugar is sweet\nAnd so are you\n'
    const r = convertTextToMarkdown(src)
    expect(r.markdown).toBe(src)
    expect(changeCount(r, 'unwrap')).toBe(0)
  })

  test('does not unwrap when one line is far shorter than the longest', () => {
    const src =
      'The quick brown fox jumps over the lazy dog and\n' +
      'short bit here\n' +
      'then it runs away into the deep dark forest to.\n'
    const r = convertTextToMarkdown(src)
    expect(r.markdown).toBe(src)
    expect(changeCount(r, 'unwrap')).toBe(0)
  })

  test('does not unwrap when a line ends with two or more spaces', () => {
    const src =
      'This line is definitely long enough to be wrapped  \n' +
      'and this second line is also quite long indeed.\n'
    const r = convertTextToMarkdown(src)
    expect(r.markdown).toBe(src)
    expect(changeCount(r, 'unwrap')).toBe(0)
  })

  test('does not unwrap when a line contains a digit followed by a comma', () => {
    const src =
      'On January 5, 2024 the committee met to discuss\n' +
      'the budget for the coming year in great detail.\n'
    const r = convertTextToMarkdown(src)
    expect(r.markdown).toBe(src)
    expect(changeCount(r, 'unwrap')).toBe(0)
  })

  test('the same paragraph without the digit-comma does get unwrapped', () => {
    const src =
      'On January 5 2024 the committee met to discuss\n' +
      'the budget for the coming year in great detail.\n'
    const r = convertTextToMarkdown(src)
    expect(changeCount(r, 'unwrap')).toBe(1)
  })

  test('does not unwrap list items even when they are long', () => {
    const src =
      '- This is a bullet item that is quite long here\n' +
      '- Another bullet item that is also fairly long.\n'
    const r = convertTextToMarkdown(src)
    expect(r.markdown).toBe(src)
    expect(changeCount(r, 'unwrap')).toBe(0)
  })

  test('does not unwrap a heading into the paragraph that follows it', () => {
    const src =
      '## A heading that happens to be rather long here\n' +
      'and a following line that is also long enough..\n'
    const r = convertTextToMarkdown(src)
    expect(r.markdown).toBe(src)
    expect(changeCount(r, 'unwrap')).toBe(0)
  })

  test('a single line is never treated as a wrapped run', () => {
    const src = 'Just one line that is long enough to be a wrapped line.\n'
    const r = convertTextToMarkdown(src)
    expect(r.markdown).toBe(src)
    expect(changeCount(r, 'unwrap')).toBe(0)
  })
})

describe('convertTextToMarkdown - citations', () => {
  test('removes bracketed numeric citations when there are two or more', () => {
    const r = convertTextToMarkdown(
      'The study found a strong effect [1] in most cases.\n\nOther work disagrees [12] with that conclusion.\n'
    )
    expect(r.markdown).toBe(
      'The study found a strong effect in most cases.\n\nOther work disagrees with that conclusion.\n'
    )
    expect(changeCount(r, 'citations')).toBe(2)
  })

  test('keeps a single citation marker because one is not a pattern', () => {
    const src = 'See note [1] for details.\n'
    const r = convertTextToMarkdown(src)
    expect(r.markdown).toBe(src)
    expect(changeCount(r, 'citations')).toBe(0)
  })

  test('never strips the label of a Markdown link', () => {
    const src = 'See [1](https://a.example) and [2](https://b.example) here.\n'
    const r = convertTextToMarkdown(src)
    expect(r.markdown).toBe(src)
    expect(changeCount(r, 'citations')).toBe(0)
  })

  test('leaves non-numeric brackets alone', () => {
    const src = 'Use [ctrl] and [alt] together.\n'
    expect(convertTextToMarkdown(src).markdown).toBe(src)
  })
})

describe('convertTextToMarkdown - line endings and robustness', () => {
  test('normalises CRLF to LF', () => {
    expect(convertTextToMarkdown('Line one.\r\nLine two.\r\n').markdown).toBe('Line one.\nLine two.\n')
  })

  test('normalises a bare CR to LF', () => {
    expect(convertTextToMarkdown('Line one.\rLine two.\r').markdown).toBe('Line one.\nLine two.\n')
  })

  test('returns an empty result for an empty document', () => {
    const r = convertTextToMarkdown('')
    expect(r.markdown).toBe('')
    expect(r.changes).toEqual([])
  })

  test('never throws when handed something that is not a string', () => {
    expect(() => convertTextToMarkdown(undefined as unknown as string)).not.toThrow()
    const r = convertTextToMarkdown(undefined as unknown as string)
    expect(r.markdown).toBe('')
    expect(r.changes).toEqual([])
  })

  test('reports no changes for prose that needs none', () => {
    const src = 'A short note.\n\nAnother short note.\n'
    const r = convertTextToMarkdown(src)
    expect(r.markdown).toBe(src)
    expect(r.changes).toEqual([])
  })
})

describe('convertTextToMarkdown - change reporting', () => {
  const mixed = [
    'PROJECT NOTES',
    '=============',
    '',
    '\u2022 milk',
    '\u2022 eggs',
    '',
    '1) first',
    '2) second',
    '',
    'The quick brown fox jumps over the lazy dog and',
    'then it runs away into the deep dark forest to',
    'find something else entirely to do today.',
    '',
    'Source [1] and source [2].',
    ''
  ].join('\n')

  test('reports every rule that fired, in a stable order, with its count', () => {
    const r = convertTextToMarkdown(mixed)
    expect(firedRules(r)).toEqual(['bullets', 'numbering', 'headings', 'unwrap', 'citations'])
    expect(changeCount(r, 'bullets')).toBe(2)
    expect(changeCount(r, 'numbering')).toBe(2)
    expect(changeCount(r, 'headings')).toBe(1)
    expect(changeCount(r, 'unwrap')).toBe(1)
    expect(changeCount(r, 'citations')).toBe(2)
  })

  test('never reports a rule with a count of zero', () => {
    const r = convertTextToMarkdown(mixed)
    for (const c of r.changes) expect(c.count).toBeGreaterThan(0)
  })

  test('converting an already-converted document changes nothing further', () => {
    const once = convertTextToMarkdown(mixed)
    const twice = convertTextToMarkdown(once.markdown)
    expect(twice.markdown).toBe(once.markdown)
    expect(twice.changes).toEqual([])
  })
})

/**
 * Multiset of non-whitespace characters, keyed by code point.
 * Whitespace is excluded because line joining, indentation stripping and line
 * ending normalisation are all allowed to move whitespace around.
 */
function nonWhitespaceCounts(s: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const ch of s) {
    if (/\s/.test(ch)) continue
    counts.set(ch, (counts.get(ch) ?? 0) + 1)
  }
  return counts
}

/**
 * The only characters the converter is ever allowed to INVENT, and why:
 *   '-'  the bullet marker written by the bullets rule
 *   '#'  the heading marker written by the headings rule
 *   '.'  the ordered list marker written by the numbering rule, which trades
 *        the student's ')' for a '.', so it is a substitution, not an invention
 * Every other non-whitespace character in the output must have come from the input.
 */
const MARKER_CHARS = new Set(['-', '#', '.'])

const fragmentArb = fc.constantFrom(
  'alpha beta',
  'GAMMA DELTA',
  'ALL CAPS HEADING',
  'The quick brown fox jumps over the lazy dog again',
  '\u2022 ',
  '\u25E6 ',
  '\u25AA ',
  '\u00B7 ',
  '\u2013 ',
  '\u2014 ',
  '* ',
  '- ',
  '+ ',
  '1) ',
  '2. ',
  '10) ',
  '# ',
  '## ',
  '> ',
  '[1]',
  '[12]',
  '[abc]',
  '(',
  ')',
  '[',
  ']',
  '**bold**',
  '=====',
  '-----',
  '   ',
  '\t',
  '.',
  ',',
  ':',
  ';',
  '!',
  '?',
  '5,',
  '\u00e9',
  '\u4e2d',
  '\ud83d\ude42',
  '\u00a0',
  ''
)
const lineArb = fc.array(fragmentArb, { maxLength: 6 }).map((parts) => parts.join(''))
const docArb = fc.array(lineArb, { maxLength: 12 }).map((lines) => lines.join('\n'))
const crlfDocArb = docArb.map((doc) => doc.replace(/\n/g, '\r\n'))
const textArb = fc.oneof(docArb, crlfDocArb, fc.string(), fc.string({ unit: 'binary' }))

describe('convertTextToMarkdown - properties', () => {
  test('never throws and never invents the student characters, for arbitrary input', () => {
    fc.assert(
      fc.property(textArb, (input) => {
        const result = convertTextToMarkdown(input)

        expect(typeof result.markdown).toBe('string')
        expect(Array.isArray(result.changes)).toBe(true)
        for (const c of result.changes) {
          expect(typeof c.rule).toBe('string')
          expect(Number.isInteger(c.count)).toBe(true)
          expect(c.count).toBeGreaterThan(0)
        }

        expect(result.markdown.includes('\r')).toBe(false)

        const before = nonWhitespaceCounts(input)
        const after = nonWhitespaceCounts(result.markdown)

        for (const [ch, n] of after) {
          if (MARKER_CHARS.has(ch)) continue
          expect(n).toBeLessThanOrEqual(before.get(ch) ?? 0)
        }

        const increase = (ch: string): number =>
          Math.max(0, (after.get(ch) ?? 0) - (before.get(ch) ?? 0))
        const decrease = (ch: string): number =>
          Math.max(0, (before.get(ch) ?? 0) - (after.get(ch) ?? 0))

        const lineCount = input.replace(/\r\n?/g, '\n').split('\n').length
        expect(increase('-')).toBeLessThanOrEqual(lineCount)
        expect(increase('#')).toBeLessThanOrEqual(2 * lineCount)
        expect(increase('.')).toBeLessThanOrEqual(decrease(')'))
      }),
      { numRuns: 1000 }
    )
  })

  test('looksLikePlainText always answers with a boolean and never throws', () => {
    fc.assert(
      fc.property(textArb, (input) => {
        expect(typeof looksLikePlainText(input)).toBe('boolean')
      }),
      { numRuns: 500 }
    )
  })
})
