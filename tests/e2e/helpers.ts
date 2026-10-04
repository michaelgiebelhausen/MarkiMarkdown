import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface Dirs {
  root: string
  userData: string
  downloads: string
  raw: string
  agent: string
  artifact: string
}

export interface Harness extends Dirs {
  app: ElectronApplication
  page: Page
  errors: string[]
  /**
   * Quits the app. Closing a window that still has unsaved changes (or a save under way)
   * asks first; that fails the test unless it passes `expectUnsaved: true`, so a note left
   * dirty by accident is caught. Calling it again does nothing.
   */
  close: (options?: { expectUnsaved?: boolean }) => Promise<void>
}

/** Creates a throwaway home for one test run. */
export function prepare(): Dirs {
  const root = mkdtempSync(join(tmpdir(), 'marki-e2e-'))
  const dirs: Dirs = {
    root,
    userData: join(root, 'userData'),
    downloads: join(root, 'downloads'),
    raw: join(root, 'brain', 'raw'),
    agent: join(root, 'agents', 'librarian'),
    artifact: join(root, 'artifacts', 'thesis')
  }
  for (const dir of [dirs.userData, dirs.downloads, dirs.raw, dirs.agent, dirs.artifact]) {
    mkdirSync(dir, { recursive: true })
  }
  // CLAUDE.md exists for the kind-proposal test in locations.spec.ts
  writeFileSync(join(dirs.agent, 'CLAUDE.md'), '# librarian\n', 'utf8')
  return dirs
}

export async function launch(
  dirs: Dirs,
  options: { settings?: Record<string, unknown>; openFile?: string; keepSettingsFile?: boolean } = {}
): Promise<Harness> {
  // seenWelcome true stops the welcome note appearing, keeping tests deterministic
  // yamlFolded false keeps the YAML readable in .cm-content for tests that look for it
  const settings = { seenWelcome: true, autosave: true, yamlFolded: false, members: [], bunches: [], ...options.settings }
  // keepSettingsFile leaves whatever the test put at settings.json, even something unreadable
  if (!options.keepSettingsFile) writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify(settings), 'utf8')

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

  let closed = false
  return {
    ...dirs,
    app,
    page,
    errors,
    close: async (closeOptions = {}) => {
      if (closed) return
      closed = true
      // A note left unsaved asks "Save changes?" on the way out: answer Don't save (or
      // Close, for a window that stopped responding), and leave a mark on disk, since the
      // app is gone by the time anyone could ask it.
      const marker = join(dirs.root, 'asked-on-close.txt')
      try {
        // A save whose toast a test has just seen is still finishing: give it a moment to
        // tell the main process it is done, so only a save still under way counts.
        await page.waitForTimeout(150)
        await app.evaluate(({ dialog }, file) => {
          const fs = process.getBuiltinModule('node:fs') as typeof import('node:fs')
          dialog.showMessageBoxSync = ((...args: unknown[]) => {
            const options = args[args.length - 1] as { message?: string; buttons?: string[] }
            fs.appendFileSync(file, `${options.message ?? ''}\n`, 'utf8')
            const buttons = options.buttons ?? []
            const leave = buttons.findIndex((b) => b === "Don't save" || b === 'Close')
            return leave >= 0 ? leave : 0
          }) as typeof dialog.showMessageBoxSync
        }, marker)
      } catch {
        /* the app may already have gone */
      }
      await app.close()
      const asked = existsSync(marker)
      try {
        rmSync(dirs.root, { recursive: true, force: true })
      } catch {
        /* Windows can hold a handle briefly; the temp dir is disposable anyway */
      }
      if (asked && !closeOptions.expectUnsaved) {
        throw new Error(
          'Closing the app asked about unsaved changes. Finish (or wait for) the save, or call close({ expectUnsaved: true }) if the test means to leave the note unsaved.'
        )
      }
    }
  }
}

export function skillMember(id: string, name: string, emoji: string, path: string) {
  return { id, kind: 'skill', name, emoji, path }
}

export function domainMember(id: string, name: string, emoji: string, path: string) {
  return { id, kind: 'domain', name, emoji, path }
}

export function bunch(id: string, name: string, emoji: string, rawPath: string, skillIds: string[], domainIds: string[]) {
  return { id, name, emoji, rawPath, skillIds, domainIds }
}

/** One skill, one domain, one bunch called study that archives into dirs.raw. */
export function team(dirs: Dirs) {
  return {
    members: [
      skillMember('a1', 'librarian', '\u{1F4DA}', dirs.agent),
      domainMember('x1', 'thesis', '\u{1F4D5}', dirs.artifact)
    ],
    bunches: [bunch('b1', 'study', '\u{1F465}', dirs.raw, ['a1'], ['x1'])]
  }
}
