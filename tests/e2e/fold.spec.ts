import { test, expect } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, prepare, team, type Harness } from './helpers'

let h: Harness

test.afterEach(async () => {
  if (h) await h.close()
})

async function openFolded(text: string) {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'note.md')
  writeFileSync(notePath, text, 'utf8')
  h = await launch(dirs, { openFile: notePath, settings: { ...team(dirs), yamlFolded: true } })
  await expect(h.page.locator('.pm-content')).not.toBeEmpty()
  return dirs
}

const NOTE = '---\nskills: [librarian]\ntags: [a]\n---\n# Note\n\nBody.\n'
const source = () => h.page.locator('.cm-content')

test('the YAML starts folded to one summary line, and View YAML opens it', async () => {
  const dirs = await openFolded(NOTE)
  await expect(h.page.locator('.cm-yaml-summary')).toContainText('YAML · 1 skill · 0 domains · 1 tag')
  await expect(source()).not.toContainText('skills:')
  await expect(source()).toContainText('# Note')

  await h.page.getByRole('button', { name: 'View YAML' }).click()
  await expect(source()).toContainText('skills:')
  await expect(h.page.getByRole('button', { name: 'Hide YAML' })).toBeVisible()
  await expect
    .poll(() => JSON.parse(readFileSync(join(dirs.userData, 'settings.json'), 'utf8')).yamlFolded)
    .toBe(false)

  await h.page.getByRole('button', { name: 'Hide YAML' }).click()
  await expect(source()).not.toContainText('skills:')
  expect(h.errors).toEqual([])
})

test('clicking the summary line opens the YAML', async () => {
  await openFolded(NOTE)
  await h.page.locator('.cm-yaml-summary').click()
  await expect(source()).toContainText('skills:')
  expect(h.errors).toEqual([])
})

test('ticking the grid keeps the fold and updates the summary', async () => {
  await openFolded(NOTE)
  await h.page.locator('.pane-bunch').getByRole('button', { name: 'thesis domain', exact: true }).click()
  await expect(h.page.locator('.cm-yaml-summary')).toContainText('1 skill · 1 domain · 3 tags')
  await expect(source()).not.toContainText('domains:')
  expect(h.errors).toEqual([])
})

test('broken YAML is never folded, and is marked', async () => {
  await openFolded('---\ntitle: My note: draft\n---\n# Note\n')
  await expect(h.page.locator('.cm-yaml-summary')).toHaveCount(0)
  await expect(h.page.locator('.cm-yaml-broken')).toHaveCount(1)
  await expect(source()).toContainText('title: My note: draft')
  await expect(h.page.getByRole('button', { name: 'View YAML' })).toHaveCount(0)
  expect(h.errors).toEqual([])
})

test('typing at the start of the body never lands inside the folded YAML', async () => {
  const dirs = await openFolded(NOTE)
  await source().click()
  await h.page.keyboard.press('Control+End')
  await h.page.keyboard.type('\nMore.')
  await expect.poll(() => readFileSync(join(dirs.downloads, 'note.md'), 'utf8'), { timeout: 10000 }).toContain('More.')
  expect(readFileSync(join(dirs.downloads, 'note.md'), 'utf8').startsWith('---\nskills: [librarian]\n')).toBe(true)
  expect(h.errors).toEqual([])
})

test('Backspace at the start of the body cannot join it to the hidden closing fence', async () => {
  const dirs = await openFolded(NOTE)
  // Focus without clicking: the fold has already put the cursor at the start of the body.
  await source().focus()
  await h.page.keyboard.press('Backspace')
  // The deletion would have changed hidden text, so it is refused and the YAML opens.
  await expect(source()).toContainText('skills:')
  await h.page.keyboard.type('X')
  await expect
    .poll(() => readFileSync(join(dirs.downloads, 'note.md'), 'utf8'), { timeout: 10000 })
    .toBe('---\nskills: [librarian]\ntags: [a]\n---\nX# Note\n\nBody.\n')
  expect(h.errors).toEqual([])
})
