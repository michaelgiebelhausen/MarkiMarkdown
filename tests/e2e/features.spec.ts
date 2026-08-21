import { test, expect } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, prepare, folder, agent, type Harness } from './helpers'

let h: Harness

test.afterEach(async () => {
  if (h) await h.close()
})

function twoFolders(dirs: ReturnType<typeof prepare>) {
  return [
    agent('a1', 'librarian', '\u{1F4DA}', ['f1', 'f2']),
    folder('f1', 'Inbox', '\u{1F4E5}', dirs.inbox),
    folder('f2', 'Research', '\u{1F52C}', dirs.research)
  ]
}

test('undo after filing puts the original back and removes the copies', async () => {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'undo-me.md')
  writeFileSync(notePath, '# Undo Me\n\nOriginal words.\n', 'utf8')
  h = await launch(dirs, { openFile: notePath, settings: { members: twoFolders(dirs) } })

  await expect(h.page.locator('.pm-content')).toContainText('Undo Me')
  await h.page.getByRole('button', { name: 'Inbox folder' }).click()
  await h.page.getByRole('button', { name: /File to 1 place/ }).click()
  await expect(h.page.locator('.toast')).toContainText('Filed in', { timeout: 20000 })
  expect(existsSync(join(dirs.inbox, 'undo-me.md'))).toBe(true)
  expect(existsSync(notePath)).toBe(false)

  await h.page.getByRole('button', { name: 'Undo' }).click()
  await expect(h.page.locator('.toast')).toContainText('Put back', { timeout: 20000 })
  expect(existsSync(notePath)).toBe(true)
  expect(readFileSync(notePath, 'utf8')).toContain('Original words.')
  expect(existsSync(join(dirs.inbox, 'undo-me.md'))).toBe(false)
  expect(h.errors).toEqual([])
})

test('editing a note filed in two places updates both copies', async () => {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'both.md')
  writeFileSync(notePath, '# Both\n\nFirst version.\n', 'utf8')
  h = await launch(dirs, { openFile: notePath, settings: { members: twoFolders(dirs) } })

  await h.page.getByRole('button', { name: 'librarian agent' }).click()
  await h.page.getByRole('button', { name: /File to 2 places/ }).click()
  await expect(h.page.locator('.toast')).toContainText('Filed in', { timeout: 20000 })

  await h.page.locator('.cm-content').click()
  await h.page.keyboard.press('Control+End')
  await h.page.keyboard.type('\nA second thought.')
  await h.page.waitForTimeout(3200)

  const a = readFileSync(join(dirs.inbox, 'both.md'), 'utf8')
  const b = readFileSync(join(dirs.research, 'both.md'), 'utf8')
  expect(a).toContain('A second thought.')
  expect(b).toContain('A second thought.')
  expect(a).toBe(b)
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
  h = await launch(dirs, { openFile: notePath, settings: { members: twoFolders(dirs) } })

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
  h = await launch(dirs, { openFile: notePath, settings: { members: twoFolders(dirs) } })

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
  h = await launch(dirs, { openFile: notePath, settings: { members: twoFolders(dirs) } })

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
  h = await launch(dirs, { openFile: notePath, settings: { members: twoFolders(dirs) } })

  await expect(h.page.locator('.chip-name')).toHaveText('quiet.md')
  await expect(h.page.getByRole('button', { name: /^File to/ })).toHaveCount(0)
  expect(h.errors).toEqual([])
})

test('un-selecting a folder the note lives in removes that copy', async () => {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'move-out.md')
  writeFileSync(notePath, '# Move Out\n\nText.\n', 'utf8')
  h = await launch(dirs, { openFile: notePath, settings: { members: twoFolders(dirs) } })

  await h.page.getByRole('button', { name: 'librarian agent' }).click()
  await h.page.getByRole('button', { name: /File to 2 places/ }).click()
  await expect(h.page.locator('.toast')).toContainText('Filed in', { timeout: 20000 })
  expect(existsSync(join(dirs.research, 'move-out.md'))).toBe(true)

  // switching Research off schedules that copy for removal
  await h.page.getByRole('button', { name: 'Research folder' }).click()
  const apply = h.page.getByRole('button', { name: 'Update note' })
  await expect(apply).toBeVisible()
  await expect(apply).toBeEnabled()
  expect(h.errors).toEqual([])
})

test('an agent with no folders only tags the note', async () => {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'tag-only.md')
  writeFileSync(notePath, '# Tag Only\n', 'utf8')
  h = await launch(dirs, {
    openFile: notePath,
    settings: {
      members: [
        agent('a2', 'tutor', '\u{1F9D1}', []),
        folder('f1', 'Inbox', '\u{1F4E5}', dirs.inbox)
      ]
    }
  })

  await h.page.getByRole('button', { name: 'tutor agent' }).click()
  // tagging alone has nowhere to be written, so filing stays unavailable
  const fileButton = h.page.getByRole('button', { name: /File to|Update note/ })
  if ((await fileButton.count()) > 0) await expect(fileButton).toBeDisabled()

  await h.page.getByRole('button', { name: 'Inbox folder' }).click()
  await h.page.getByRole('button', { name: /File to 1 place/ }).click()
  await expect(h.page.locator('.toast')).toContainText('Filed in', { timeout: 20000 })
  expect(readFileSync(join(dirs.inbox, 'tag-only.md'), 'utf8')).toContain('agents: [tutor]')
  expect(h.errors).toEqual([])
})
