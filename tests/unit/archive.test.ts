import { describe, expect, test } from 'vitest'
import { BLOCK_REASONS, archiveStem, freeName, planSave, type SaveInput } from '@shared/archive'

/** The name the archive copy gets, as the archive writer picks it. */
const archiveName = (fileName: string, date: string, existing: string[]) => freeName(archiveStem(fileName, date), existing)

describe('archive names', () => {
  test('the stem is the working name plus the date', () => {
    expect(archiveStem('essay.md', '2026-10-04')).toBe('essay-2026-10-04')
    expect(archiveStem('notes.txt', '2026-10-04')).toBe('notes-2026-10-04')
  })

  test('takes the plain name when it is free', () => {
    expect(archiveName('essay.md', '2026-10-04', [])).toBe('essay-2026-10-04.md')
  })

  test('adds -2, -3 on a clash, ignoring case', () => {
    expect(archiveName('essay.md', '2026-10-04', ['essay-2026-10-04.md'])).toBe('essay-2026-10-04-2.md')
    expect(archiveName('essay.md', '2026-10-04', ['Essay-2026-10-04.md', 'essay-2026-10-04-2.md'])).toBe(
      'essay-2026-10-04-3.md'
    )
  })

  test('a name that already ends in a date is not confused', () => {
    expect(archiveName('essay-2026-10-03.md', '2026-10-04', ['essay-2026-10-03.md'])).toBe(
      'essay-2026-10-03-2026-10-04.md'
    )
  })

  test('a very long name is cut so the whole archive file name fits in 255 characters', () => {
    const stem = archiveStem(`${'x'.repeat(300)}.md`, '2026-10-04')
    expect(stem).toBe(`${'x'.repeat(237)}-2026-10-04`)
    expect(`${stem}-999.md`.length).toBe(255)
    expect(archiveName(`${'x'.repeat(300)}.md`, '2026-10-04', []).length).toBeLessThanOrEqual(255)
  })

  test('cutting never splits an emoji in half', () => {
    const stem = archiveStem(`ab${'\u{1F600}'.repeat(150)}.md`, '2026-10-04')
    const base = stem.slice(0, -'-2026-10-04'.length)
    expect(base.length).toBe(236)
    expect(/[\uD800-\uDBFF]$/.test(base)).toBe(false)
    expect(base.endsWith('\u{1F600}')).toBe(true)
  })

  test('a cut that ends in spaces or dots drops them', () => {
    const stem = archiveStem(`${'x'.repeat(234)} . ${'y'.repeat(50)}.md`, '2026-10-04')
    expect(stem).toBe(`${'x'.repeat(234)}-2026-10-04`)
  })

  test('short names are not touched', () => {
    expect(archiveStem('essay. .md', '2026-10-04')).toBe('essay. -2026-10-04')
  })

  test('freeName works for any stem', () => {
    expect(freeName('cells', ['cells.md'])).toBe('cells-2.md')
  })
})

describe('planSave', () => {
  const good: SaveInput = { yamlOk: true, rawPath: '/raw', rawMissing: false, tickCount: 1, workingDir: '/drafts' }

  test('allows archiving when everything is in place', () => {
    expect(planSave(good)).toEqual({ canArchive: true, reason: '' })
  })

  test('an untitled note with no folder yet can still archive', () => {
    expect(planSave({ ...good, workingDir: '' }).canArchive).toBe(true)
  })

  test.each([
    [{ yamlOk: false }, BLOCK_REASONS.yaml],
    [{ rawPath: '' }, BLOCK_REASONS.noRaw],
    [{ rawMissing: true }, BLOCK_REASONS.missingRaw],
    [{ tickCount: 0 }, BLOCK_REASONS.noTicks],
    [{ workingDir: '/raw' }, BLOCK_REASONS.sameFolder]
  ])('blocks with %o', (change, reason) => {
    expect(planSave({ ...good, ...change })).toEqual({ canArchive: false, reason })
  })

  test('a raw path of only spaces counts as no raw folder', () => {
    expect(planSave({ ...good, rawPath: '   ' })).toEqual({ canArchive: false, reason: BLOCK_REASONS.noRaw })
    expect(planSave({ ...good, rawPath: '\t\n' }).reason).toBe(BLOCK_REASONS.noRaw)
  })

  test('gives the first reason in the spec order', () => {
    expect(planSave({ ...good, yamlOk: false, rawPath: '', tickCount: 0 }).reason).toBe(BLOCK_REASONS.yaml)
    expect(planSave({ ...good, rawPath: '', tickCount: 0 }).reason).toBe(BLOCK_REASONS.noRaw)
    expect(planSave({ ...good, rawMissing: true, tickCount: 0 }).reason).toBe(BLOCK_REASONS.missingRaw)
    expect(planSave({ ...good, tickCount: 0, workingDir: '/raw' }).reason).toBe(BLOCK_REASONS.noTicks)
  })
})
