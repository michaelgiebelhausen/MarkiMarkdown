import { describe, expect, test } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { replaceFileSync, type WriteFs } from '../../src/main/ipc/writeGuard'

function failing(code: string) {
  return Object.assign(new Error(code), { code })
}

/** An fs whose rename fails with `code` for the first `failures` attempts. */
function flakyFs(code: string, failures: number) {
  const calls: string[] = []
  const files = new Map<string, string>()
  let left = failures
  const fs: WriteFs = {
    writeFileSync: (path, text) => {
      calls.push(`write ${path}`)
      files.set(path, text)
    },
    renameSync: (from, to) => {
      calls.push(`rename ${from} -> ${to}`)
      if (left > 0) {
        left -= 1
        throw failing(code)
      }
      files.set(to, files.get(from) ?? '')
      files.delete(from)
    }
  }
  return { fs, calls, files }
}

describe('replaceFileSync', () => {
  test('writes a temp file and renames it over the target', () => {
    const dir = mkdtempSync(join(tmpdir(), 'marki-write-'))
    const target = join(dir, 'settings.json')
    replaceFileSync(target, '{"a":1}')
    expect(readFileSync(target, 'utf8')).toBe('{"a":1}')
    expect(existsSync(`${target}.tmp`)).toBe(false)
  })

  for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
    test(`retries a brief ${code} and then succeeds`, () => {
      const { fs, files } = flakyFs(code, 2)
      const pauses: number[] = []
      replaceFileSync('/x/settings.json', 'new', fs, (ms) => pauses.push(ms))
      expect(files.get('/x/settings.json')).toBe('new')
      expect(pauses).toEqual([50, 50])
    })
  }

  test('gives up after three retries and throws the last error', () => {
    const { fs, calls } = flakyFs('EPERM', 10)
    const pauses: number[] = []
    expect(() => replaceFileSync('/x/settings.json', 'new', fs, (ms) => pauses.push(ms))).toThrow('EPERM')
    expect(pauses).toHaveLength(3)
    expect(calls.filter((c) => c.startsWith('rename'))).toHaveLength(4)
  })

  test('does not retry an error that will not clear by itself', () => {
    const { fs } = flakyFs('ENOSPC', 1)
    const pauses: number[] = []
    expect(() => replaceFileSync('/x/settings.json', 'new', fs, (ms) => pauses.push(ms))).toThrow('ENOSPC')
    expect(pauses).toEqual([])
  })
})
