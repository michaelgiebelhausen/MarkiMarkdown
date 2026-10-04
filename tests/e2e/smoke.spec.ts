import { test, expect } from '@playwright/test'
import { chmodSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, prepare, type Harness } from './helpers'

let h: Harness

test.afterEach(async () => {
  if (h) await h.close()
})

test('the window opens with both panes and no errors', async () => {
  h = await launch(prepare())
  await expect(h.page.locator('.pane-code')).toBeVisible()
  await expect(h.page.locator('.pane-rendered')).toBeVisible()
  await expect(h.page.locator('.pane-bunch')).toBeVisible()
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

test('the pane selector shows and hides panes and remembers the choice', async () => {
  const dirs = prepare()
  h = await launch(dirs)
  const bunch = h.page.getByRole('checkbox', { name: 'Funky Bunch' })
  const raw = h.page.getByRole('checkbox', { name: 'Raw Markdown' })
  const rendered = h.page.getByRole('checkbox', { name: 'Rendered Marki' })

  await expect(h.page.locator('.pane-bunch')).toBeVisible()
  await expect(h.page.locator('.pane-code')).toBeVisible()
  await expect(h.page.locator('.pane-rendered')).toBeVisible()

  await raw.uncheck()
  await expect(h.page.locator('.pane-code')).toHaveCount(0)
  await bunch.uncheck()
  await expect(h.page.locator('.pane-bunch')).toHaveCount(0)

  // the last pane cannot be switched off
  await rendered.click()
  await expect(rendered).toBeChecked()
  await expect(h.page.locator('.pane-rendered')).toBeVisible()

  await expect
    .poll(() => JSON.parse(readFileSync(join(dirs.userData, 'settings.json'), 'utf8')).panes)
    .toEqual({ bunch: false, raw: false, rendered: true })

  await raw.check()
  await expect(h.page.locator('.pane-code')).toBeVisible()
  expect(h.errors).toEqual([])
})

/** Sends a View menu action the way the menu's accelerator would. */
async function menuAction(harness: Harness, ...actions: string[]) {
  await harness.app.evaluate(({ BrowserWindow }, list) => {
    const win = BrowserWindow.getAllWindows()[0]
    for (const action of list) win.webContents.send('menu:action', action)
  }, actions)
}

test('two pane toggles sent back to back both stick', async () => {
  const dirs = prepare()
  h = await launch(dirs)
  await expect(h.page.locator('.pane-bunch')).toBeVisible()

  await menuAction(h, 'toggle-pane-bunch', 'toggle-pane-raw')

  await expect(h.page.locator('.pane-bunch')).toHaveCount(0)
  await expect(h.page.locator('.pane-code')).toHaveCount(0)
  await expect(h.page.locator('.pane-rendered')).toBeVisible()
  await expect
    .poll(() => JSON.parse(readFileSync(join(dirs.userData, 'settings.json'), 'utf8')).panes)
    .toEqual({ bunch: false, raw: false, rendered: true })
  expect(h.errors).toEqual([])
})

test('a divider drag ends when a pane is toggled in the middle of it', async () => {
  const dirs = prepare()
  h = await launch(dirs)
  const grid = h.page.locator('.panes')
  const columns = () => grid.evaluate((el) => (el as HTMLElement).style.gridTemplateColumns)
  await expect(h.page.locator('.pane-divider')).toHaveCount(2)
  // DEFAULT_SETTINGS.paneWidths, which the first write puts on disk
  const initialWidths = JSON.stringify([0.34, 0.33, 0.33])

  const box = await h.page.locator('.pane-divider').nth(1).boundingBox()
  expect(box).not.toBeNull()
  const x = box!.x + box!.width / 2
  const y = box!.y + box!.height / 2
  const before = await columns()
  await h.page.mouse.move(x, y)
  await h.page.mouse.down()
  await h.page.mouse.move(x - 60, y, { steps: 4 })
  await expect.poll(columns).not.toBe(before)

  await menuAction(h, 'toggle-pane-bunch')
  await expect(h.page.locator('.pane-bunch')).toHaveCount(0)
  // Ending the drag saves the widths it reached; let that save land before comparing.
  const saved = () => JSON.parse(readFileSync(join(dirs.userData, 'settings.json'), 'utf8'))
  await expect.poll(() => saved().panes).toEqual({ bunch: false, raw: true, rendered: true })
  await expect.poll(() => JSON.stringify(saved().paneWidths)).not.toBe(initialWidths)
  await h.page.waitForTimeout(300)
  const afterToggle = await columns()

  // The drag is over: moving the held mouse further changes nothing.
  await h.page.mouse.move(x - 160, y, { steps: 4 })
  expect(await columns()).toBe(afterToggle)
  await h.page.mouse.up()
  expect(await columns()).toBe(afterToggle)

  await expect
    .poll(() => JSON.parse(readFileSync(join(dirs.userData, 'settings.json'), 'utf8')).panes)
    .toEqual({ bunch: false, raw: true, rendered: true })
  expect(h.errors).toEqual([])
})

test('settings that cannot be saved are reported once, and the warning stays', async () => {
  const dirs = prepare()
  h = await launch(dirs)
  const file = join(dirs.userData, 'settings.json')
  // A read-only settings file cannot be replaced, so every save fails.
  chmodSync(file, 0o444)
  try {
    await h.page.getByRole('checkbox', { name: 'Funky Bunch' }).uncheck()
    await h.page.getByRole('checkbox', { name: 'Funky Bunch' }).check()
    const warning = h.page.locator('.toast', { hasText: "can't save its settings right now" })
    await expect(warning).toHaveCount(1)
    await h.page.waitForTimeout(7000)
    await expect(warning).toHaveCount(1)
  } finally {
    chmodSync(file, 0o644)
  }
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
