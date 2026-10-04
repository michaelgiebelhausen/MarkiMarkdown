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
  // 1.2's own note, so an upgrader never reopens the 1.1 one
  await expect(page.locator('.chip-name')).toHaveText('Welcome to MarkiMarkdown 1.2.md')

  // the Funky Bunch pane is on screen and explains how to start
  const pane = page.locator('.pane-bunch')
  await expect(pane).toBeVisible()
  await expect(pane).toContainText('Funky Bunch locations')
  await expect(pane.getByRole('button', { name: 'Add a skill' })).toBeVisible()
  await expect(pane.getByRole('button', { name: 'Add a domain' })).toBeVisible()

  if (SHOT) await page.screenshot({ path: join(SHOT, 'marki-05-firstrun.png') })

  expect(errors).toEqual([])
  await app.close()
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {
    /* disposable */
  }
})
