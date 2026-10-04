import { test, expect } from '@playwright/test'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, prepare, team, type Harness } from './helpers'

let h: Harness

test.afterEach(async () => {
  if (h) await h.close()
})

async function openWith(note: string, name = 'note.md') {
  const dirs = prepare()
  const notePath = join(dirs.downloads, name)
  writeFileSync(notePath, note, 'utf8')
  const harness = await launch(dirs, { openFile: notePath, settings: team(dirs) })
  await expect(harness.page.locator('.pm-content')).not.toBeEmpty()
  return { harness, notePath, dirs }
}

test('dragging the note onto a bunch chip applies that bunch', async () => {
  const { harness, dirs } = await openWith('# Drag me\n\nBody.\n', 'drag.md')
  h = harness

  await h.page.locator('.chip').dragTo(h.page.getByRole('button', { name: 'study bunch', exact: true }))
  await expect(h.page.locator('.cm-content')).toContainText('bunch: study')
  expect(existsSync(join(dirs.raw, 'drag.md'))).toBe(false)
  expect(h.errors).toEqual([])
  await h.close({ expectUnsaved: true })
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
  await h.close({ expectUnsaved: true })
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

  // Click the start of the line: with three panes the middle of this narrow paragraph
  // lands on the wikilink itself, which selects the link instead of placing a cursor.
  await h.page.locator('.pm-content p').first().click({ position: { x: 2, y: 8 } })
  await h.page.keyboard.press('Home')
  await h.page.keyboard.press('Shift+End')
  await h.page.locator('.bubble-btn[title="Bold"]').click()

  const source = await h.page.locator('.cm-content').innerText()
  expect(source).toContain('[[Working memory]]')
  expect(source).not.toContain('\ufffc')
  expect(h.errors).toEqual([])
  await h.close({ expectUnsaved: true })
})

test('a note with unreadable properties cannot be given a bunch', async () => {
  const { harness, dirs } = await openWith('---\ntitle: My note: draft\n---\n\n# Body\n', 'broken.md')
  h = harness
  await expect(h.page.locator('.props-broken')).toBeVisible()
  await expect(h.page.getByRole('button', { name: 'study bunch', exact: true })).toBeDisabled()
  await expect(h.page.getByRole('button', { name: /^File to/ })).toHaveCount(0)
  expect(existsSync(join(dirs.raw, 'broken.md'))).toBe(false)
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
