import { describe, expect, test } from 'vitest'
import { baseName, dirName, samePath, toForwardSlashes } from '@shared/paths'

const WIN = 'C:\\Users\\sam\\Downloads\\lecture notes.md'
const POSIX = '/Users/sam/Downloads/lecture notes.md'

describe('baseName', () => {
  test('takes the file name off a Windows path', () => {
    expect(baseName(WIN)).toBe('lecture notes.md')
  })
  test('takes the file name off a POSIX path', () => {
    expect(baseName(POSIX)).toBe('lecture notes.md')
  })
  test('copes with mixed separators', () => {
    expect(baseName('C:\\Users\\sam/notes/a.md')).toBe('a.md')
  })
  test('returns the input when there is no separator', () => {
    expect(baseName('a.md')).toBe('a.md')
  })
  test('is empty for an empty path', () => {
    expect(baseName('')).toBe('')
  })
})

describe('dirName', () => {
  test('drops the file from a Windows path', () => {
    expect(dirName(WIN)).toBe('C:\\Users\\sam\\Downloads')
  })
  test('drops the file from a POSIX path', () => {
    expect(dirName(POSIX)).toBe('/Users/sam/Downloads')
  })
  test('returns an empty string when there is no folder part', () => {
    expect(dirName('a.md')).toBe('')
  })
})

describe('samePath', () => {
  test('ignores a trailing separator', () => {
    expect(samePath('C:\\brain\\Inbox', 'C:\\brain\\Inbox\\')).toBe(true)
  })
  test('ignores separator style', () => {
    expect(samePath('C:\\brain\\Inbox', 'C:/brain/Inbox')).toBe(true)
  })
  test('ignores case, because Windows does', () => {
    expect(samePath('C:\\Brain\\inbox', 'c:\\brain\\Inbox')).toBe(true)
  })
  test('tells different folders apart', () => {
    expect(samePath('C:\\brain\\Inbox', 'C:\\brain\\Research')).toBe(false)
  })
  test('does not treat a prefix as a match', () => {
    expect(samePath('C:\\brain\\In', 'C:\\brain\\Inbox')).toBe(false)
  })
})

describe('round trip', () => {
  test('dirName plus baseName reconstructs a Windows path', () => {
    expect(samePath(dirName(WIN) + '\\' + baseName(WIN), WIN)).toBe(true)
  })
})

describe('toForwardSlashes', () => {
  const BS = String.fromCharCode(92)

  test('turns every backslash into a forward slash', () => {
    expect(toForwardSlashes(`C:${BS}Users${BS}me${BS}agents`)).toBe('C:/Users/me/agents')
  })

  test('leaves a POSIX path alone', () => {
    expect(toForwardSlashes('/home/me/agents')).toBe('/home/me/agents')
  })

  test('leaves an empty string empty', () => {
    expect(toForwardSlashes('')).toBe('')
  })
})
