import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, prepare, type Harness } from './helpers'

let h: Harness

test.afterEach(async () => {
  if (h) await h.close()
})

async function open(note: string) {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'bubble.md')
  writeFileSync(notePath, note, 'utf8')
  const harness = await launch(dirs, { openFile: notePath })
  await expect(harness.page.locator('.pm-content')).not.toBeEmpty()
  return harness
}

async function selectFirstParagraph(harness: Harness) {
  await harness.page.locator('.pm-content p').first().click()
  await harness.page.keyboard.press('Home')
  await harness.page.keyboard.press('Shift+End')
}

test('selecting text shows the bubble, and it goes away again', async () => {
  h = await open('Some words to select here.\n')
  await expect(h.page.locator('.bubble')).toHaveCount(0)
  await selectFirstParagraph(h)
  await expect(h.page.locator('.bubble')).toBeVisible()
  await h.page.keyboard.press('ArrowRight')
  await expect(h.page.locator('.bubble')).toHaveCount(0)
  expect(h.errors).toEqual([])
})

test('the bubble makes text bold and the markdown shows it', async () => {
  h = await open('Make me bold.\n')
  await selectFirstParagraph(h)
  await h.page.locator('.bubble-btn[title="Bold"]').click()
  await expect(h.page.locator('.cm-content')).toContainText('**Make me bold.**')
  expect(h.errors).toEqual([])
})

test('the bubble turns a paragraph into a heading', async () => {
  h = await open('Turn me into a heading.\n')
  await selectFirstParagraph(h)
  await h.page.locator('.bubble-btn[title="Heading"]').click()
  await expect(h.page.locator('.cm-content')).toContainText('## Turn me into a heading.')
  await expect(h.page.locator('.pm-content h2')).toBeVisible()
  expect(h.errors).toEqual([])
})

test('the bubble turns a paragraph into a checklist', async () => {
  h = await open('Make me a task.\n')
  await selectFirstParagraph(h)
  await h.page.locator('.bubble-btn[title="Checklist"]').click()
  await expect(h.page.locator('.cm-content')).toContainText('- [ ] Make me a task.')
  expect(h.errors).toEqual([])
})

test('the bubble shows which formatting is already applied', async () => {
  h = await open('Already **bold** here.\n')
  await h.page.locator('.pm-content strong').first().dblclick()
  await expect(h.page.locator('.bubble')).toBeVisible()
  await expect(h.page.locator('.bubble-btn[title="Bold"]')).toHaveClass(/on/)
  expect(h.errors).toEqual([])
})
