import { test, expect } from '@playwright/test'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, prepare, folder, agent, type Harness } from './helpers'

let h: Harness

test.afterEach(async () => {
  if (h) await h.close()
})

const NOTE = '# Lecture Notes\n\nSome content about memory.\n'

async function openWith(note = NOTE) {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'lecture-notes.md')
  writeFileSync(notePath, note, 'utf8')
  const harness = await launch(dirs, {
    openFile: notePath,
    settings: {
      members: [
        agent('a1', 'librarian', '📚', ['f1', 'f2']),
        agent('a2', 'tutor', '🧑', []),
        folder('f1', 'Inbox', '📥', dirs.inbox, ['raw']),
        folder('f2', 'Research', '🔬', dirs.research)
      ]
    }
  })
  await expect(harness.page.locator('.pm-content')).toContainText('Lecture Notes')
  return { harness, notePath }
}

test('picking an agent files the note into every folder that agent reads', async () => {
  const { harness, notePath } = await openWith()
  h = harness

  await h.page.getByRole('button', { name: 'librarian agent' }).click()
  const fileButton = h.page.getByRole('button', { name: /File to 2 places/ })
  await expect(fileButton).toBeVisible()
  await fileButton.click()

  await expect(h.page.locator('.toast')).toContainText('Filed in', { timeout: 20000 })

  const inboxCopy = join(h.inbox, 'lecture-notes.md')
  const researchCopy = join(h.research, 'lecture-notes.md')
  expect(existsSync(inboxCopy)).toBe(true)
  expect(existsSync(researchCopy)).toBe(true)

  const a = readFileSync(inboxCopy, 'utf8')
  expect(readFileSync(researchCopy, 'utf8')).toBe(a)
  expect(a).toContain('agents: [librarian]')
  expect(a).toContain('type: note')
  expect(a).toContain('# Lecture Notes')
  expect(a).toContain('Some content about memory.')
  expect(/id:\s*\S+/.test(a)).toBe(true)
  expect(a).toContain('raw')

  const inboxLog = readFileSync(join(h.inbox, 'log.md'), 'utf8')
  expect(inboxLog).toContain('lecture-notes.md')
  expect(inboxLog).toContain('librarian')
  expect(inboxLog).toContain('Research')
  expect(readFileSync(join(h.research, 'log.md'), 'utf8')).toContain('Inbox')

  expect(existsSync(notePath)).toBe(false)
  await expect(h.page.locator('.chip-places')).toHaveText('2 places')
  expect(h.errors).toEqual([])
})

test('picking a single folder files one copy and keeps the note editable', async () => {
  const { harness } = await openWith()
  h = harness

  await h.page.getByRole('button', { name: 'Inbox folder' }).click()
  await h.page.getByRole('button', { name: /File to 1 place/ }).click()
  await expect(h.page.locator('.toast')).toContainText('Filed in', { timeout: 20000 })

  const copy = join(h.inbox, 'lecture-notes.md')
  expect(existsSync(copy)).toBe(true)
  expect(readFileSync(copy, 'utf8')).not.toContain('agents:')

  // keep editing: the saved file follows
  await h.page.locator('.cm-content').click()
  await h.page.keyboard.press('Control+End')
  await h.page.keyboard.type('\nA later thought.')
  await h.page.waitForTimeout(3000)
  expect(readFileSync(copy, 'utf8')).toContain('A later thought.')
  expect(h.errors).toEqual([])
})
