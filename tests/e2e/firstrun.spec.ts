import { test, expect } from '@playwright/test'
import { _electron as electron } from '@playwright/test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SHOT = process.env.MARKI_SHOT_DIR

test('the very first launch shows a welcome note and invites a first folder', async () => {
  const root = mkdtempSync(join(tmpdir(), 'marki-first-'))
  const userData = join(root, 'userData')
  const documents = join(root, 'Documents')
  mkdirSync(userData, { recursive: true })
  mkdirSync(documents, { recursive: true })

  const errors: string[] = []
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: process.cwd()
  })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => errors.push(String(e.message)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })

  await page.waitForSelector('.app', { timeout: 30000 })

  // a real note is open, not an empty screen
  await expect(page.locator('.pm-content')).toContainText('Welcome', { timeout: 15000 })
  await expect(page.locator('.cm-content')).toContainText('# Welcome')

  // the strip is empty apart from the two add buttons, and the coachmark points at folders
  await expect(page.locator('.tile-add')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Add an agent' })).toBeVisible()
  await expect(page.locator('.coachmark')).toContainText('Funky Bunch')

  // it must actually be on screen, not clipped away by the narrow strip
  const reallyVisible = await page.evaluate(() => {
    const mark = document.querySelector('.coachmark')
    if (!mark) return 'missing'
    const r = mark.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return 'empty'
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return hit && mark.contains(hit) ? 'visible' : 'covered or clipped'
  })
  expect(reallyVisible).toBe('visible')
  await expect(page.getByRole('button', { name: 'Choose a folder' })).toBeVisible()

  if (SHOT) await page.screenshot({ path: join(SHOT, 'marki-05-firstrun.png') })

  expect(errors).toEqual([])
  await app.close()
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {
    /* disposable */
  }
})
