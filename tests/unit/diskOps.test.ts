import { afterEach, describe, expect, test, vi } from 'vitest'
import { promises as fsp, chmodSync, mkdtempSync, writeFileSync, existsSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { diskArchiveOps } from '../../src/main/ipc/files'

vi.mock('electron', () => ({ shell: { trashItem: async () => undefined } }))
vi.mock('electron-log/main', () => ({ default: { error: () => undefined, warn: () => undefined } }))

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'marki-disk-'))
}

function errno(code: string): Error {
  return Object.assign(new Error(code), { code })
}

const realOpen = fsp.open.bind(fsp)

afterEach(() => {
  vi.restoreAllMocks()
})

describe('diskArchiveOps.createExclusive', () => {
  test('writes a new file', async () => {
    const dir = scratch()
    expect(await diskArchiveOps.createExclusive(join(dir, 'a.md'), 'TEXT')).toBe(true)
    expect(readFileSync(join(dir, 'a.md'), 'utf8')).toBe('TEXT')
  })

  test('returns false and leaves an existing file alone', async () => {
    const dir = scratch()
    writeFileSync(join(dir, 'a.md'), 'FIRST', 'utf8')
    expect(await diskArchiveOps.createExclusive(join(dir, 'a.md'), 'SECOND')).toBe(false)
    expect(readFileSync(join(dir, 'a.md'), 'utf8')).toBe('FIRST')
  })

  test('throws other open failures', async () => {
    const dir = scratch()
    await expect(diskArchiveOps.createExclusive(join(dir, 'missing', 'a.md'), 'T')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  test('a write that fails half way removes the partial file and rethrows', async () => {
    const dir = scratch()
    vi.spyOn(fsp, 'open').mockImplementation(async (...args: Parameters<typeof fsp.open>) => {
      const handle = await realOpen(...args)
      Object.assign(handle, {
        writeFile: async () => {
          throw errno('ENOSPC')
        }
      })
      return handle
    })
    await expect(diskArchiveOps.createExclusive(join(dir, 'a.md'), 'TEXT')).rejects.toMatchObject({ code: 'ENOSPC' })
    expect(existsSync(join(dir, 'a.md'))).toBe(false)
  })

  test('a sync that fails removes the partial file and rethrows', async () => {
    const dir = scratch()
    vi.spyOn(fsp, 'open').mockImplementation(async (...args: Parameters<typeof fsp.open>) => {
      const handle = await realOpen(...args)
      Object.assign(handle, {
        sync: async () => {
          throw errno('EIO')
        }
      })
      return handle
    })
    await expect(diskArchiveOps.createExclusive(join(dir, 'a.md'), 'TEXT')).rejects.toMatchObject({ code: 'EIO' })
    expect(existsSync(join(dir, 'a.md'))).toBe(false)
  })
})

describe('diskArchiveOps.copyExclusive', () => {
  test('copies, then flushes the copy to disk before reporting success', async () => {
    const dir = scratch()
    writeFileSync(join(dir, 'from.md'), 'TEXT', 'utf8')
    const synced: string[] = []
    vi.spyOn(fsp, 'open').mockImplementation(async (...args: Parameters<typeof fsp.open>) => {
      const handle = await realOpen(...args)
      const realSync = handle.sync.bind(handle)
      Object.assign(handle, {
        sync: async () => {
          synced.push(String(args[0]))
          await realSync()
        }
      })
      return handle
    })
    expect(await diskArchiveOps.copyExclusive(join(dir, 'from.md'), join(dir, 'to.md'))).toBe(true)
    expect(readFileSync(join(dir, 'to.md'), 'utf8')).toBe('TEXT')
    expect(synced).toEqual([join(dir, 'to.md')])
  })

  test('a copy that cannot be flushed is removed and not reported as done', async () => {
    const dir = scratch()
    writeFileSync(join(dir, 'from.md'), 'TEXT', 'utf8')
    vi.spyOn(fsp, 'open').mockImplementation(async (...args: Parameters<typeof fsp.open>) => {
      const handle = await realOpen(...args)
      Object.assign(handle, {
        sync: async () => {
          throw errno('EIO')
        }
      })
      return handle
    })
    await expect(diskArchiveOps.copyExclusive(join(dir, 'from.md'), join(dir, 'to.md'))).rejects.toMatchObject({
      code: 'EIO'
    })
    expect(readFileSync(join(dir, 'from.md'), 'utf8')).toBe('TEXT')
    expect(existsSync(join(dir, 'to.md'))).toBe(false)
  })

  test('a read-only copy is made writable just long enough to flush it, then made read-only again', async () => {
    const dir = scratch()
    writeFileSync(join(dir, 'from.md'), 'TEXT', 'utf8')
    chmodSync(join(dir, 'from.md'), 0o444)
    const synced: string[] = []
    vi.spyOn(fsp, 'open').mockImplementation(async (...args: Parameters<typeof fsp.open>) => {
      const handle = await realOpen(...args)
      const realSync = handle.sync.bind(handle)
      Object.assign(handle, {
        sync: async () => {
          await realSync()
          synced.push(`${String(args[0])}|${String(args[1])}`)
        }
      })
      return handle
    })
    expect(await diskArchiveOps.copyExclusive(join(dir, 'from.md'), join(dir, 'to.md'))).toBe(true)
    expect(readFileSync(join(dir, 'to.md'), 'utf8')).toBe('TEXT')
    expect(synced).toEqual([`${join(dir, 'to.md')}|r+`])
    expect(statSync(join(dir, 'to.md')).mode & 0o200).toBe(0)
  })

  test('returns false when the target is already there', async () => {
    const dir = scratch()
    writeFileSync(join(dir, 'from.md'), 'MINE', 'utf8')
    writeFileSync(join(dir, 'to.md'), 'THEIRS', 'utf8')
    expect(await diskArchiveOps.copyExclusive(join(dir, 'from.md'), join(dir, 'to.md'))).toBe(false)
    expect(readFileSync(join(dir, 'to.md'), 'utf8')).toBe('THEIRS')
  })
})
