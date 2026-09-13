import { test, expect } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, prepare, team, type Harness } from './helpers'

let h: Harness

test.afterEach(async () => {
  if (h) await h.close()
})

test('undo after filing puts the original back and removes the filed copy', async () => {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'undo-me.md')
  writeFileSync(notePath, '# Undo Me\n\nOriginal words.\n', 'utf8')
  h = await launch(dirs, { openFile: notePath, settings: team(dirs) })

  await expect(h.page.locator('.pm-content')).toContainText('Undo Me')
  await h.page.getByRole('button', { name: 'study bunch' }).click()
  await h.page.getByRole('button', { name: 'File to study' }).click()
  await expect(h.page.locator('.toast')).toContainText('Filed to study', { timeout: 20000 })
  expect(existsSync(join(dirs.raw, 'undo-me.md'))).toBe(true)
  expect(existsSync(notePath)).toBe(false)

  await h.page.getByRole('button', { name: 'Undo' }).click()
  await expect(h.page.locator('.toast')).toContainText('Put back', { timeout: 20000 })
  expect(existsSync(notePath)).toBe(true)
  expect(readFileSync(notePath, 'utf8')).toContain('Original words.')
  expect(existsSync(join(dirs.raw, 'undo-me.md'))).toBe(false)
  expect(h.errors).toEqual([])
})

test('a plain text file offers conversion and converts on request', async () => {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'raw-notes.txt')
  writeFileSync(
    notePath,
    'MEETING NOTES\n\n\u2022 First point\n\u2022 Second point\n\u2022 Third point\n',
    'utf8'
  )
  h = await launch(dirs, { openFile: notePath, settings: team(dirs) })

  await expect(h.page.locator('.notice')).toContainText('plain text')
  await h.page.getByRole('button', { name: 'Convert to Markdown' }).click()
  await expect(h.page.locator('.cm-content')).toContainText('- First point')
  await expect(h.page.locator('.notice')).toHaveCount(0)
  // the original .txt is never touched
  expect(readFileSync(notePath, 'utf8')).toContain('\u2022 First point')
  expect(h.errors).toEqual([])
})

test('the properties panel adds and edits front matter', async () => {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'props.md')
  writeFileSync(notePath, '# My Note\n\nBody text.\n', 'utf8')
  h = await launch(dirs, { openFile: notePath, settings: team(dirs) })

  await expect(h.page.locator('.props')).toHaveCount(0)
  await h.page.getByRole('button', { name: 'More actions' }).click()
  await h.page.getByRole('button', { name: 'Add properties' }).click()

  await expect(h.page.locator('.props')).toBeVisible()
  await expect(h.page.locator('.cm-content')).toContainText('type: note')
  await expect(h.page.locator('.cm-content')).toContainText('title: My Note')

  await h.page.locator('.props-summary').click()
  const tagInput = h.page.locator('.chip-input')
  await tagInput.click()
  await tagInput.fill('week3')
  await tagInput.press('Enter')
  await expect(h.page.locator('.cm-content')).toContainText('week3')
  expect(h.errors).toEqual([])
})

test('broken front matter shows a calm message instead of crashing', async () => {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'broken.md')
  writeFileSync(notePath, '---\ntitle: Notes: week 2\n---\n\n# Body\n', 'utf8')
  h = await launch(dirs, { openFile: notePath, settings: team(dirs) })

  await expect(h.page.locator('.props-broken')).toContainText('could not be read')
  await expect(h.page.locator('.pm-content')).toContainText('Body')

  await h.page.getByRole('button', { name: 'repair them' }).click()
  await expect(h.page.locator('.props-broken')).toHaveCount(0)
  await expect(h.page.locator('.props-summary')).toBeVisible()
  expect(h.errors).toEqual([])
})

test('with nothing selected there is no File button, and the note name is shown', async () => {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'quiet.md')
  writeFileSync(notePath, '# Quiet\n', 'utf8')
  h = await launch(dirs, { openFile: notePath, settings: team(dirs) })

  await expect(h.page.locator('.chip-name')).toHaveText('quiet.md')
  await expect(h.page.getByRole('button', { name: /^File to/ })).toHaveCount(0)
  expect(h.errors).toEqual([])
})
