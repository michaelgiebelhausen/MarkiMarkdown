import { describe, expect, test } from 'vitest'
import { tidyMarkdown } from '@shared/markdown/tidy'

describe('tidyMarkdown', () => {
  test('leaves an already neat note completely alone', () => {
    const src = '# Title\n\nA sentence.\n\n- one\n- two\n'
    const result = tidyMarkdown(src)
    expect(result.markdown).toBe(src)
    expect(result.changes).toBe(0)
  })

  test('collapses runs of blank lines down to one', () => {
    const result = tidyMarkdown('One.\n\n\n\n\nTwo.\n')
    expect(result.markdown).toBe('One.\n\nTwo.\n')
    expect(result.changes).toBeGreaterThan(0)
  })

  test('puts a blank line before a heading that is jammed against text', () => {
    const result = tidyMarkdown('Some text.\n## Heading\nMore.\n')
    expect(result.markdown).toBe('Some text.\n\n## Heading\n\nMore.\n')
  })

  test('normalises bullet markers to dashes', () => {
    const result = tidyMarkdown('* one\n* two\n')
    expect(result.markdown).toBe('- one\n- two\n')
  })

  test('fixes a heading level that skips a step', () => {
    const result = tidyMarkdown('# One\n\n### Three\n\nText.\n')
    expect(result.markdown).toContain('## Three')
  })

  test('does not touch headings inside a fenced code block', () => {
    const src = '# Real\n\n```\n### not a heading\n*   not a bullet\n```\n'
    const result = tidyMarkdown(src)
    expect(result.markdown).toContain('### not a heading')
    expect(result.markdown).toContain('*   not a bullet')
  })

  test('leaves front matter untouched', () => {
    const src = '---\ntitle: A\n\n\nb: c\n---\n\nText.\n'
    const result = tidyMarkdown(src)
    expect(result.markdown.startsWith('---\ntitle: A\n\n\nb: c\n---\n')).toBe(true)
  })

  test('strips trailing spaces except a deliberate line break', () => {
    const result = tidyMarkdown('one   \ntwo  \nthree \n')
    expect(result.markdown).toBe('one\ntwo  \nthree\n')
  })

  test('ends the file with exactly one newline', () => {
    expect(tidyMarkdown('text').markdown).toBe('text\n')
    expect(tidyMarkdown('text\n\n\n').markdown).toBe('text\n')
  })

  test('is stable when run twice', () => {
    const src = 'Some text.\n## Heading\n*  one\n\n\n\n*  two   \n'
    const once = tidyMarkdown(src).markdown
    const twice = tidyMarkdown(once).markdown
    expect(twice).toBe(once)
  })

  test('never throws', () => {
    for (const input of ['', '\n', '---\n', '```\n', '#'.repeat(50)]) {
      expect(() => tidyMarkdown(input)).not.toThrow()
    }
  })
})
