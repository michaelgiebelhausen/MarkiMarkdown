import { test, expect } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, prepare, folder, agent, type Harness } from './helpers'

let h: Harness

test.afterEach(async () => {
  if (h) await h.close()
})

async function openWith(note: string, name = 'note.md') {
  const dirs = prepare()
  const notePath = join(dirs.downloads, name)
  writeFileSync(notePath, note, 'utf8')
  const harness = await launch(dirs, {
    openFile: notePath,
    settings: {
      members: [
        agent('a1', 'librarian', '\u{1F4DA}', ['f1']),
        folder('f1', 'Inbox', '\u{1F4E5}', dirs.inbox)
      ]
    }
  })
  await expect(harness.page.locator('.pm-content')).not.toBeEmpty()
  return { harness, notePath, dirs }
}

test('dragging the note onto a folder tile files it', async () => {
  const { harness, dirs, notePath } = await openWith('# Drag me\n\nBody.\n', 'drag.md')
  h = harness

  await h.page.locator('.chip').dragTo(h.page.getByRole('button', { name: 'Inbox folder' }))
  await expect(h.page.locator('.toast')).toContainText('Filed in', { timeout: 20000 })

  expect(existsSync(join(dirs.inbox, 'drag.md'))).toBe(true)
  expect(existsSync(notePath)).toBe(false)
  expect(h.errors).toEqual([])
})

test('Ctrl+B works while the cursor is in the Markdown pane', async () => {
  const { harness } = await openWith('Make this bold.\n', 'bold.md')
  h = harness

  await h.page.locator('.cm-content').click()
  await h.page.keyboard.press('Control+a')
  await h.page.keyboard.press('Control+b')

  await expect(h.page.locator('.cm-content')).toContainText('**Make this bold.**')
  await expect(h.page.locator('.pm-content strong')).toHaveText('Make this bold.')
  expect(h.errors).toEqual([])
})

test('a note called log.md does not overwrite the folder log', async () => {
  const { harness, dirs } = await openWith('# My reading log\n\nEntries.\n', 'log.md')
  h = harness

  await h.page.getByRole('button', { name: 'Inbox folder' }).click()
  await h.page.getByRole('button', { name: /File to 1 place/ }).click()
  await expect(h.page.locator('.toast')).toContainText('Filed in', { timeout: 20000 })

  const log = readFileSync(join(dirs.inbox, 'log.md'), 'utf8')
  expect(log).toContain('Filing log')
  expect(log).not.toContain('Entries.')
  expect(existsSync(join(dirs.inbox, 'log-note.md'))).toBe(true)
  expect(readFileSync(join(dirs.inbox, 'log-note.md'), 'utf8')).toContain('Entries.')
  expect(h.errors).toEqual([])
})

test('a note that starts with a divider keeps all of its text', async () => {
  const { harness } = await openWith('---\n\nOpening line.\n\n---\n\nSecond part.\n', 'divider.md')
  h = harness
  await expect(h.page.locator('.pm-content')).toContainText('Opening line.')
  await expect(h.page.locator('.pm-content')).toContainText('Second part.')
  await expect(h.page.locator('.props')).toHaveCount(0)
  expect(h.errors).toEqual([])
})

test('a wikilink survives being made bold in the clean pane', async () => {
  const { harness } = await openWith('See [[Working memory]] today\n', 'wiki.md')
  h = harness

  await h.page.locator('.pm-content p').first().click()
  await h.page.keyboard.press('Home')
  await h.page.keyboard.press('Shift+End')
  await h.page.locator('.bubble-btn[title="Bold"]').click()

  const source = await h.page.locator('.cm-content').innerText()
  expect(source).toContain('[[Working memory]]')
  expect(source).not.toContain('\ufffc')
  expect(h.errors).toEqual([])
})

test('a note with unreadable properties is not filed with a made-up id', async () => {
  const { harness, dirs } = await openWith('---\ntitle: My note: draft\n---\n\n# Body\n', 'broken.md')
  h = harness
  await expect(h.page.locator('.props-broken')).toBeVisible()

  await h.page.getByRole('button', { name: 'Inbox folder' }).click()
  await h.page.getByRole('button', { name: /File to 1 place/ }).click()

  await expect(h.page.locator('.toast')).toContainText('cannot be read', { timeout: 15000 })
  expect(existsSync(join(dirs.inbox, 'broken.md'))).toBe(false)
  expect(existsSync(join(dirs.inbox, 'log.md'))).toBe(false)
  expect(h.errors).toEqual([])
})

test('the stamp written at filing survives the next save', async () => {
  const { harness, dirs } = await openWith('# Keep the stamp\n\nBody.\n', 'stamp.md')
  h = harness

  await h.page.getByRole('button', { name: 'librarian agent' }).click()
  await h.page.getByRole('button', { name: /File to 1 place/ }).click()
  await expect(h.page.locator('.toast')).toContainText('Filed in', { timeout: 20000 })

  const filed = join(dirs.inbox, 'stamp.md')
  expect(readFileSync(filed, 'utf8')).toContain('agents: [librarian]')

  // keep typing; autosave must not write the unstamped text back over it
  await h.page.locator('.cm-content').click()
  await h.page.keyboard.press('Control+End')
  await h.page.keyboard.type('\nA later line.')
  await h.page.waitForTimeout(3200)

  const after = readFileSync(filed, 'utf8')
  expect(after).toContain('agents: [librarian]')
  expect(after).toContain('A later line.')
  expect(after).toMatch(/id:\s*\S+/)
  expect(h.errors).toEqual([])
})

test('dropping a file on the window does not paste its path into the note', async () => {
  const { harness } = await openWith('# Keep me clean\n', 'drop-target.md')
  h = harness
  const before = await h.page.locator('.cm-content').innerText()

  await h.page.evaluate(() => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['# other'], 'other.md', { type: 'text/markdown' }))
    for (const kind of ['dragover', 'drop']) {
      window.dispatchEvent(
        new DragEvent(kind, { dataTransfer: transfer, bubbles: true, cancelable: true })
      )
    }
  })
  await h.page.waitForTimeout(500)

  const after = await h.page.locator('.cm-content').innerText()
  expect(after).toBe(before)
  expect(after).not.toContain('other.md')
  expect(h.errors).toEqual([])
})
