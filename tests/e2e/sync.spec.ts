import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, prepare, type Harness } from './helpers'

let h: Harness

test.afterEach(async () => {
  if (h) await h.close()
})

function longNote(): string {
  const out: string[] = ['# Top of the note', '']
  for (let i = 1; i <= 60; i++) out.push(`Paragraph number ${i} sits here.`, '')
  out.push('# Bottom of the note', '')
  return out.join('\n')
}

test('the block under the cursor is tinted on both sides', async () => {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'tint.md')
  writeFileSync(notePath, '# One\n\nSecond block here.\n\nThird block here.\n', 'utf8')
  h = await launch(dirs, { openFile: notePath })

  await h.page.locator('.pm-content p').first().click()
  await expect(h.page.locator('.pm-content .pm-active')).toHaveCount(1)
  await expect(h.page.locator('.pm-content .pm-active')).toContainText('Second block here.')
  await expect(h.page.locator('.cm-marki-active')).not.toHaveCount(0)
  expect(h.errors).toEqual([])
})

test('scrolling one pane brings the other along', async () => {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'scroll.md')
  writeFileSync(notePath, longNote(), 'utf8')
  h = await launch(dirs, { openFile: notePath })
  await expect(h.page.locator('.pm-content')).toContainText('Top of the note')

  const renderedTop = () => h.page.evaluate(() => document.querySelector('.pane-rendered')!.scrollTop)
  expect(await renderedTop()).toBe(0)

  await h.page.evaluate(() => {
    const scroller = document.querySelector('.pane-code .cm-scroller') as HTMLElement
    scroller.scrollTop = scroller.scrollHeight * 0.6
    scroller.dispatchEvent(new Event('scroll'))
  })
  await h.page.waitForTimeout(600)

  expect(await renderedTop()).toBeGreaterThan(100)
  expect(h.errors).toEqual([])
})
