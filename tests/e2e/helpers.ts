import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface Dirs {
  root: string
  userData: string
  downloads: string
  inbox: string
  research: string
}

export interface Harness extends Dirs {
  app: ElectronApplication
  page: Page
  errors: string[]
  close: () => Promise<void>
}

/** Creates a throwaway home for one test run. */
export function prepare(): Dirs {
  const root = mkdtempSync(join(tmpdir(), 'marki-e2e-'))
  const dirs: Dirs = {
    root,
    userData: join(root, 'userData'),
    downloads: join(root, 'downloads'),
    inbox: join(root, 'brain', 'Inbox'),
    research: join(root, 'brain', 'Research')
  }
  for (const dir of [dirs.userData, dirs.downloads, dirs.inbox, dirs.research]) {
    mkdirSync(dir, { recursive: true })
  }
  return dirs
}

export async function launch(
  dirs: Dirs,
  options: { settings?: Record<string, unknown>; openFile?: string } = {}
): Promise<Harness> {
  // seenCoachmark true stops the welcome note appearing, keeping tests deterministic
  const settings = { seenCoachmark: true, autosave: true, members: [], ...options.settings }
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify(settings), 'utf8')

  const args = ['.', `--user-data-dir=${dirs.userData}`]
  if (options.openFile) args.push(options.openFile)

  const errors: string[] = []
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  )
  const app = await electron.launch({ args, cwd: process.cwd(), env })
  const page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  await page.waitForSelector('.app', { timeout: 30000 })

  return {
    ...dirs,
    app,
    page,
    errors,
    close: async () => {
      await app.close()
      try {
        rmSync(dirs.root, { recursive: true, force: true })
      } catch {
        /* Windows can hold a handle briefly; the temp dir is disposable anyway */
      }
    }
  }
}

export function folder(id: string, name: string, emoji: string, path: string, tags: string[] = []) {
  return { id, kind: 'folder', name, emoji, path, stamp: { tags } }
}

export function agent(id: string, name: string, emoji: string, folderIds: string[]) {
  return { id, kind: 'agent', name, emoji, folderIds }
}
