import { test, expect } from '@playwright/test'
import { launch, prepare, type Harness } from './helpers'

let h: Harness

test.afterEach(async () => {
  if (h) await h.close()
})

test('the window opens with both panes and no errors', async () => {
  h = await launch(prepare())
  await expect(h.page.locator('.pane-code')).toBeVisible()
  await expect(h.page.locator('.pane-rendered')).toBeVisible()
  await expect(h.page.locator('.strip')).toBeVisible()
  expect(h.errors).toEqual([])
})

test('typing markdown on the left renders on the right', async () => {
  h = await launch(prepare())
  const code = h.page.locator('.cm-content')
  await code.click()
  await h.page.keyboard.type('## A heading\n\nSome **bold** text.')
  await expect(h.page.locator('.pm-content h2')).toHaveText('A heading')
  await expect(h.page.locator('.pm-content strong')).toHaveText('bold')
  expect(h.errors).toEqual([])
})

test('editing a word on the right updates the code on the left', async () => {
  h = await launch(prepare())
  const code = h.page.locator('.cm-content')
  await code.click()
  await h.page.keyboard.type('Hello world.')
  await expect(h.page.locator('.pm-content')).toContainText('Hello world.')

  const rendered = h.page.locator('.pm-content')
  await rendered.click()
  await h.page.keyboard.press('End')
  await h.page.keyboard.type(' Added.')

  await expect(h.page.locator('.cm-content')).toContainText('Hello world. Added.')
  expect(h.errors).toEqual([])
})

test('a table survives an edit to a neighbouring paragraph', async () => {
  h = await launch(prepare())
  const code = h.page.locator('.cm-content')
  await code.click()
  await h.page.keyboard.type('Intro line.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n')
  await expect(h.page.locator('.raw-block table')).toBeVisible()

  await h.page.locator('.pm-content p').first().click()
  await h.page.keyboard.press('End')
  await h.page.keyboard.type(' Edited.')

  const source = await h.page.locator('.cm-content').innerText()
  expect(source).toContain('| a | b |')
  expect(source).toContain('| --- | --- |')
  expect(source).toContain('Intro line. Edited.')
  expect(h.errors).toEqual([])
})

test('the view toggle switches between code, split and text', async () => {
  h = await launch(prepare())
  await h.page.getByRole('button', { name: 'Code' }).click()
  await expect(h.page.locator('.pane-rendered')).toHaveCount(0)
  await h.page.getByRole('button', { name: 'Text' }).click()
  await expect(h.page.locator('.pane-code')).toHaveCount(0)
  await h.page.getByRole('button', { name: 'Split' }).click()
  await expect(h.page.locator('.pane-code')).toBeVisible()
  await expect(h.page.locator('.pane-rendered')).toBeVisible()
  expect(h.errors).toEqual([])
})

test('a checklist item keeps its box and its words on one line', async () => {
  h = await launch(prepare())
  await h.page.locator('.cm-content').click()
  await h.page.keyboard.type('- [ ] Read chapter three')

  const item = h.page.locator('.pm-content li').first()
  await expect(item).toBeVisible()
  const box = await item.boundingBox()
  expect(box).not.toBeNull()
  // one line of 17px text is about 28px tall; two lines would be well over 45
  expect(box!.height).toBeLessThan(42)
  expect(h.errors).toEqual([])
})

test('clicking the box in a checklist ticks it in the markdown', async () => {
  h = await launch(prepare())
  await h.page.locator('.cm-content').click()
  await h.page.keyboard.type('- [ ] Read chapter three')
  await expect(h.page.locator('.pm-content li')).toHaveCount(1)

  await h.page.locator('.pm-content li').first().click({ position: { x: 6, y: 10 } })
  await expect(h.page.locator('.cm-content')).toContainText('- [x] Read chapter three')
  expect(h.errors).toEqual([])
})
