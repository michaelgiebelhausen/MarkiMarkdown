import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, prepare, team, type Dirs, type Harness } from './helpers'

let h: Harness

test.afterEach(async () => {
  if (h) await h.close()
})

type SettingsFor = Record<string, unknown> | ((dirs: Dirs) => Record<string, unknown>)

async function openNote(text: string, settings?: SettingsFor) {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'note.md')
  writeFileSync(notePath, text, 'utf8')
  const chosen = typeof settings === 'function' ? settings(dirs) : (settings ?? team(dirs))
  h = await launch(dirs, { openFile: notePath, settings: chosen })
  await expect(h.page.locator('.pm-content')).not.toBeEmpty()
  return { dirs, notePath }
}

async function menu(action: string) {
  await h.app.evaluate(({ BrowserWindow }, a) => BrowserWindow.getAllWindows()[0].webContents.send('menu:action', a), action)
}

const pane = () => h.page.locator('.pane-bunch')
const source = () => h.page.locator('.cm-content')

test('the grid shows skills across the top and domains down the side', async () => {
  await openNote('# Note\n')
  await expect(pane().locator('th.board-skill')).toHaveText(/librarian/)
  await expect(pane().locator('th.board-domain')).toHaveText(/thesis/)
  await expect(pane().getByRole('button', { name: 'librarian and thesis: 0 notes' })).toBeVisible()
  expect(h.errors).toEqual([])
})

test('ticking a square writes skills, domains and tags into the YAML, and undo takes it back', async () => {
  await openNote('# Note\n\nBody.\n')
  const cell = pane().getByRole('button', { name: 'librarian and thesis: 0 notes' })
  await cell.click()
  await expect(cell).toHaveAttribute('aria-pressed', 'true')
  await expect(source()).toContainText('skills:')
  await expect(source()).toContainText('- librarian')
  await expect(source()).toContainText('domains:')
  await expect(source()).toContainText('- thesis')
  await expect(source()).toContainText('skill/librarian')
  await expect(source()).toContainText('Body.')

  await menu('undo')
  await expect(source()).not.toContainText('skills:')
  await expect(cell).toHaveAttribute('aria-pressed', 'false')
  expect(h.errors).toEqual([])
})

test('clicking a name ticks just that skill or domain', async () => {
  await openNote('# Note\n')
  await pane().getByRole('button', { name: 'thesis domain', exact: true }).click()
  await expect(pane().getByRole('button', { name: 'thesis domain', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(source()).toContainText('domains:')
  await expect(source()).not.toContainText('skills:')
  expect(h.errors).toEqual([])
})

test('typing the YAML by hand lights up the grid', async () => {
  await openNote('---\ndomains: [Thesis]\n---\n# Note\n')
  await expect(pane().getByRole('button', { name: 'thesis domain', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(pane().getByRole('button', { name: 'librarian skill', exact: true })).toHaveAttribute('aria-pressed', 'false')
  expect(h.errors).toEqual([])
})

test('a bunch chip applies its skills and domains, and clicking it again clears only the bunch', async () => {
  await openNote('# Note\n')
  const chip = pane().getByRole('button', { name: 'study bunch', exact: true })
  await chip.click()
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
  await expect(source()).toContainText('bunch: study')
  await expect(pane().getByRole('button', { name: 'librarian and thesis: 0 notes' })).toHaveAttribute('aria-pressed', 'true')

  await chip.click()
  await expect(chip).toHaveAttribute('aria-pressed', 'false')
  await expect(source()).not.toContainText('bunch:')
  await expect(source()).toContainText('skills:')
  expect(h.errors).toEqual([])
})

test('a name nobody has offers to add it', async () => {
  await openNote('---\nskills: [ghost]\n---\n# Note\n')
  await pane().getByRole('button', { name: "ghost isn't a skill yet. Add it?" }).click()
  const dialog = h.page.getByRole('dialog', { name: 'Add a skill' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('ghost')
  expect(h.errors).toEqual([])
})

test('broken YAML greys out the grid and the chips', async () => {
  await openNote('---\ntitle: My note: draft\n---\n# Note\n')
  await expect(pane()).toContainText('Fix the YAML to tick skills and domains')
  await expect(pane().getByRole('button', { name: 'librarian and thesis: 0 notes' })).toBeDisabled()
  await expect(pane().getByRole('button', { name: 'study bunch', exact: true })).toBeDisabled()
  expect(h.errors).toEqual([])
})

test('right-clicking a name opens it for editing', async () => {
  await openNote('# Note\n')
  await pane().getByRole('button', { name: 'librarian skill', exact: true }).click({ button: 'right' })
  await expect(h.page.getByRole('dialog', { name: 'Edit skill' })).toBeVisible()
  expect(h.errors).toEqual([])
})

test('the … buttons say which skill, domain or bunch they edit', async () => {
  await openNote('# Note\n')
  // Hidden until the pointer or the keyboard is on that name, so focus the name first.
  const cases: Array<[string, string, string]> = [
    ['librarian skill', 'Edit librarian skill', 'Edit skill'],
    ['thesis domain', 'Edit thesis domain', 'Edit domain'],
    ['study bunch', 'Edit study bunch', 'Edit bunch']
  ]
  for (const [name, more, dialog] of cases) {
    await pane().getByRole('button', { name, exact: true }).focus()
    await h.page.keyboard.press('Tab')
    const button = pane().getByRole('button', { name: more, exact: true })
    await expect(button).toBeFocused()
    await h.page.keyboard.press('Enter')
    await expect(h.page.getByRole('dialog', { name: dialog })).toBeVisible()
    await h.page.keyboard.press('Escape')
    await expect(h.page.getByRole('dialog')).toHaveCount(0)
  }
  expect(h.errors).toEqual([])
})

test('a new bunch cannot take a name another bunch already has', async () => {
  await openNote('---\nskills: [librarian]\n---\n# Note\n', (dirs) => ({ ...team(dirs), defaultRawPath: dirs.raw }))
  await pane().getByRole('button', { name: '+ Save as bunch' }).click()
  const dialog = h.page.getByRole('dialog', { name: 'Make a bunch' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox', { name: 'Name' }).fill(' STUDY ')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toContainText('Another bunch is already called STUDY.')
  await expect(dialog).toBeVisible()
  await expect(pane().locator('.bunch-chip')).toHaveCount(1)

  await dialog.getByRole('textbox', { name: 'Name' }).fill('revision')
  await expect(dialog).not.toContainText('Another bunch')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(pane().locator('.bunch-chip')).toHaveCount(2)
  expect(h.errors).toEqual([])
})

test('with nobody in the roster the pane explains itself', async () => {
  await openNote('# Note\n', { members: [], bunches: [] })
  await expect(pane().getByRole('button', { name: 'Add a skill' })).toBeVisible()
  await expect(pane().getByRole('button', { name: 'Add a domain' })).toBeVisible()
  expect(h.errors).toEqual([])
})

test('adding a folder with a CLAUDE.md proposes skill', async () => {
  // The folder picker is a native dialog, so this checks the proposal through the IPC directly.
  const { dirs } = await openNote('# Note\n')
  const kind = await h.page.evaluate(
    (path) => window.marki.members.proposeKind(path).then((r) => (r.ok ? r.kind : 'error')),
    dirs.agent
  )
  expect(kind).toBe('skill')
  const other = await h.page.evaluate(
    (path) => window.marki.members.proposeKind(path).then((r) => (r.ok ? r.kind : 'error')),
    dirs.artifact
  )
  expect(other).toBe('domain')
  expect(h.errors).toEqual([])
})
