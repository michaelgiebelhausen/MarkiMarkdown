import { test, expect } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, prepare, team, type Harness } from './helpers'

let h: Harness

test.afterEach(async () => {
  if (h) await h.close()
})

function today(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

async function openNote(text = '# Essay\n\nFirst draft.\n', extra: Record<string, unknown> = {}) {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'essay.md')
  writeFileSync(notePath, text, 'utf8')
  h = await launch(dirs, { openFile: notePath, settings: { ...team(dirs), defaultRawPath: dirs.raw, ...extra } })
  await expect(h.page.locator('.pm-content')).not.toBeEmpty()
  return { dirs, notePath }
}

async function menu(action: string) {
  await h.app.evaluate(({ BrowserWindow }, a) => BrowserWindow.getAllWindows()[0].webContents.send('menu:action', a), action)
}

const pane = () => h.page.locator('.pane-bunch')
const archiveBox = () => pane().getByRole('checkbox', { name: /Archive \/ distribute/ })
const saveButton = () => pane().getByRole('button', { name: 'Save', exact: true })
const saveAndArchive = () => pane().getByRole('button', { name: 'Save and archive', exact: true })
const tickPair = () => pane().getByRole('button', { name: 'librarian and thesis: 0 notes', exact: true }).click()
const workingFolderButton = () => pane().getByRole('button', { name: 'Working folder', exact: true })
const rawFolderButton = () => pane().getByRole('button', { name: 'Raw folder', exact: true })

/** The folder picker opens but does not answer until releaseFolderPicker, so a save can be caught mid-way. */
async function holdFolderPicker(dir: string) {
  await h.app.evaluate(({ dialog }, d) => {
    const g = globalThis as unknown as { releasePick?: () => void }
    delete g.releasePick
    dialog.showOpenDialog = (() =>
      new Promise((resolve) => {
        g.releasePick = () => resolve({ canceled: false, filePaths: [d] })
      })) as typeof dialog.showOpenDialog
  }, dir)
}

async function releaseFolderPicker() {
  const asked = () => h.app.evaluate(() => typeof (globalThis as unknown as { releasePick?: () => void }).releasePick)
  await expect.poll(asked, { timeout: 10000 }).toBe('function')
  await h.app.evaluate(() => (globalThis as unknown as { releasePick: () => void }).releasePick())
}

async function typeUntitled(text: string) {
  await h.page.locator('.cm-content').click()
  await h.page.keyboard.type(text)
}

test('Save and archive saves the working file and drops a dated copy in raw', async () => {
  const { dirs, notePath } = await openNote()
  await tickPair()
  await archiveBox().check()
  await saveAndArchive().click()
  await expect(h.page.locator('.toast')).toContainText('Saved and archived', { timeout: 20000 })

  const copyPath = join(dirs.raw, `essay-${today()}.md`)
  expect(existsSync(copyPath)).toBe(true)
  const copy = readFileSync(copyPath, 'utf8')
  expect(copy).toContain('archived:')
  expect(copy).toContain('skills:\n  - librarian')
  expect(copy).toContain('domains:\n  - thesis')
  expect(copy).toContain('First draft.')

  const working = readFileSync(notePath, 'utf8')
  expect(working).toContain('skills:\n  - librarian')
  expect(working).not.toContain('archived:')

  await expect(archiveBox()).not.toBeChecked()
  await expect(pane().getByRole('button', { name: 'librarian and thesis: 1 note', exact: true })).toBeVisible()
  await expect(h.page.locator('.chip-places')).toHaveText('archived 1×')
  expect(h.errors).toEqual([])
})

test('a second archive on the same day never overwrites the first', async () => {
  const { dirs } = await openNote()
  await tickPair()
  for (let i = 0; i < 2; i++) {
    await archiveBox().check()
    await saveAndArchive().click()
    await expect(archiveBox()).not.toBeChecked({ timeout: 20000 })
  }
  expect(readdirSync(dirs.raw).sort()).toEqual([`essay-${today()}-2.md`, `essay-${today()}.md`])
  expect(h.errors).toEqual([])
})

test('Ctrl+S does what the Save button does', async () => {
  const { dirs } = await openNote()
  await tickPair()
  await archiveBox().check()
  await menu('save')
  await expect.poll(() => existsSync(join(dirs.raw, `essay-${today()}.md`)), { timeout: 20000 }).toBe(true)
  expect(h.errors).toEqual([])
})

test('with nothing ticked the box explains why it cannot archive', async () => {
  await openNote()
  await archiveBox().check()
  await expect(pane()).toContainText('Tick at least one skill or domain.')
  await expect(saveButton()).toBeVisible()
  expect(h.errors).toEqual([])
})

test('a missing raw folder blocks archiving and says so', async () => {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'essay.md')
  writeFileSync(notePath, '# Essay\n', 'utf8')
  h = await launch(dirs, { openFile: notePath, settings: { ...team(dirs), bunches: [], defaultRawPath: join(dirs.root, 'gone') } })
  await expect(h.page.locator('.pm-content')).not.toBeEmpty()
  await tickPair()
  await archiveBox().check()
  await expect(pane()).toContainText("The raw folder can't be found.")
  await expect(saveButton()).toBeVisible()
  expect(h.errors).toEqual([])
  await h.close({ expectUnsaved: true })
})

test('a raw folder that vanishes before Save gives "Saved, but not archived"', async () => {
  const { dirs, notePath } = await openNote()
  await tickPair()
  await archiveBox().check()
  await expect(saveAndArchive()).toBeVisible()
  rmSync(dirs.raw, { recursive: true, force: true })
  await saveAndArchive().click()
  await expect(h.page.locator('.toast')).toContainText('Saved, but not archived', { timeout: 20000 })
  await expect(archiveBox()).toBeChecked()
  expect(readFileSync(notePath, 'utf8')).toContain('skills:')
  expect(h.errors).toEqual([])
})

test('an untitled note asks for a folder on its first save and is named from its heading', async () => {
  const dirs = prepare()
  h = await launch(dirs, { settings: { ...team(dirs), defaultRawPath: dirs.raw } })
  await h.page.locator('.cm-content').click()
  await h.page.keyboard.type('# Cell walls\n\nPlants have them.')
  await h.app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog
  }, dirs.downloads)
  await saveButton().click()
  await expect.poll(() => existsSync(join(dirs.downloads, 'cell-walls.md')), { timeout: 20000 }).toBe(true)
  expect(readFileSync(join(dirs.downloads, 'cell-walls.md'), 'utf8')).toContain('Plants have them.')
  await expect(h.page.locator('.chip-name')).toHaveText('cell-walls.md')
  await expect(h.page.locator('.toast')).toContainText('Saved to downloads.')
  expect(h.errors).toEqual([])
})

test('a note opened from a .txt is saved as a .md named after it, beside it, and says so', async () => {
  const dirs = prepare()
  const txt = join(dirs.downloads, 'notes.txt')
  const original = '# Lecture three\n\nJust some text.\n'
  writeFileSync(txt, original, 'utf8')
  h = await launch(dirs, { openFile: txt, settings: { ...team(dirs), defaultRawPath: dirs.raw } })
  await expect(h.page.locator('.pm-content')).toContainText('Just some text.')
  await saveButton().click()

  await expect(h.page.locator('.toast')).toContainText(
    'Saved as notes.md next to notes.txt. The .txt file is unchanged.',
    { timeout: 20000 }
  )
  await expect(h.page.locator('.toast').getByRole('button', { name: 'Show', exact: true })).toBeVisible()
  expect(readFileSync(join(dirs.downloads, 'notes.md'), 'utf8')).toContain('Just some text.')
  expect(existsSync(join(dirs.downloads, 'lecture-three.md'))).toBe(false)
  expect(readFileSync(txt, 'utf8')).toBe(original)
  expect(h.errors).toEqual([])
})

test('while a save is under way the buttons wait, and typing during it is saved later, not counted now', async () => {
  const dirs = prepare()
  h = await launch(dirs, { settings: { ...team(dirs), defaultRawPath: dirs.raw } })
  await typeUntitled('# Cell walls\n\nPlants have them.')
  await holdFolderPicker(dirs.downloads)
  await saveButton().click()

  await expect(saveButton()).toBeDisabled()
  await expect(workingFolderButton()).toBeDisabled()
  await expect(rawFolderButton()).toBeDisabled()

  // typed after Save was clicked, while the folder picker is still open
  await h.page.locator('.cm-content').click()
  await h.page.keyboard.press('Control+End')
  await h.page.keyboard.type(' Typed later.')
  await releaseFolderPicker()

  const saved = join(dirs.downloads, 'cell-walls.md')
  await expect.poll(() => existsSync(saved), { timeout: 20000 }).toBe(true)
  const first = readFileSync(saved, 'utf8')
  expect(first).toContain('Plants have them.')
  expect(first).not.toContain('Typed later.')
  await expect(saveButton()).toBeEnabled()
  await expect(workingFolderButton()).toBeEnabled()

  // still unsaved, so autosave writes it on the next pause
  await expect.poll(() => readFileSync(saved, 'utf8'), { timeout: 20000 }).toContain('Typed later.')
  expect(h.errors).toEqual([])
})

test('a note opened mid-save stops that save and is left alone', async () => {
  const dirs = prepare()
  const other = join(dirs.downloads, 'other.md')
  writeFileSync(other, '# Other\n\nSecond note.\n', 'utf8')
  const target = join(dirs.root, 'target')
  mkdirSync(target)
  h = await launch(dirs, { settings: { ...team(dirs), defaultRawPath: dirs.raw } })
  await typeUntitled('# Cell walls\n\nPlants have them.')
  await holdFolderPicker(target)
  await saveButton().click()

  // Opening over unsaved changes asks first: answer "Don't save".
  await h.app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox
  })
  await h.app.evaluate(({ BrowserWindow }, p) => BrowserWindow.getAllWindows()[0].webContents.send('file:open-path', p), other)
  await expect(h.page.locator('.pm-content')).toContainText('Second note.')
  await releaseFolderPicker()

  await expect(h.page.locator('.toast')).toContainText('Another note was opened, so this save stopped. Save again.', {
    timeout: 20000
  })
  expect(readdirSync(target)).toEqual([])
  expect(readFileSync(other, 'utf8')).toBe('# Other\n\nSecond note.\n')
  await expect(h.page.locator('.chip-name')).toHaveText('other.md')
  expect(h.errors).toEqual([])
})

test('choosing another working folder moves the note there', async () => {
  const { dirs, notePath } = await openNote()
  const other = join(dirs.root, 'drafts')
  mkdirSync(other)
  await h.app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox
  }, other)
  await pane().getByRole('button', { name: 'Working folder', exact: true }).click()
  await expect(h.page.locator('.toast')).toContainText('Moved to drafts', { timeout: 20000 })
  expect(existsSync(join(other, 'essay.md'))).toBe(true)
  expect(existsSync(notePath)).toBe(false)
  expect(h.errors).toEqual([])
})

test('a 1.1 note opens with its ticks lit, and the first tick moves it to the new keys', async () => {
  const { notePath } = await openNote(
    '---\nagents:\n  - librarian\nartifacts:\n  - thesis\ntags: [agent/librarian, artifact/thesis]\n---\n# Old\n'
  )
  await expect(pane().getByRole('button', { name: 'librarian and thesis: 0 notes', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  // opening alone rewrites nothing
  expect(readFileSync(notePath, 'utf8')).toContain('agents:')

  await pane().getByRole('button', { name: 'librarian skill', exact: true }).click()
  const source = h.page.locator('.cm-content')
  await expect(source).not.toContainText('agents:')
  await expect(source).not.toContainText('artifacts:')
  await expect(source).toContainText('domains:')
  await expect(source).toContainText('domain/thesis')
  await expect(source).not.toContainText('agent/librarian')
  expect(h.errors).toEqual([])
  await h.close({ expectUnsaved: true })
})

test('archiving a note with no id gives it one, in the working file, the copy and the ledger', async () => {
  const { dirs, notePath } = await openNote(
    '---\nagents:\n  - librarian\nartifacts:\n  - thesis\ntags: [agent/librarian, artifact/thesis]\n---\n# Old\n'
  )
  await archiveBox().check()
  await saveAndArchive().click()
  await expect(h.page.locator('.toast')).toContainText('Saved and archived', { timeout: 20000 })

  const copy = readFileSync(join(dirs.raw, `essay-${today()}.md`), 'utf8')
  const id = /^id: (\S+)$/m.exec(copy)?.[1]
  expect(id).toBeTruthy()
  expect(readFileSync(notePath, 'utf8')).toContain(`id: ${id}`)
  // the ledger entry carries the id, so this note's own count goes up
  await expect(h.page.locator('.chip-places')).toHaveText('archived 1×')
  expect(h.errors).toEqual([])
})

test('a hand-typed number id is recorded exactly as written', async () => {
  const { dirs } = await openNote('---\nid: 007\nskills: [librarian]\ndomains: [thesis]\n---\n# Agent\n')
  await archiveBox().check()
  await saveAndArchive().click()
  await expect(h.page.locator('.toast')).toContainText('Saved and archived', { timeout: 20000 })

  const ledger = JSON.parse(readFileSync(join(dirs.userData, 'ledger.json'), 'utf8')) as { noteId: string }[]
  expect(ledger.map((e) => e.noteId)).toEqual(['007'])
  await expect(h.page.locator('.chip-places')).toHaveText('archived 1×')
  expect(h.errors).toEqual([])
})
