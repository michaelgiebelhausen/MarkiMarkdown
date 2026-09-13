import { test, expect } from '@playwright/test'
import { _electron as electron } from '@playwright/test'
import { existsSync, writeFileSync, readFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Defaults to the freshly built bundle; set MARKI_EXE to test a real installation.
const EXE = process.env.MARKI_EXE ?? join(process.cwd(), 'dist', 'win-unpacked', 'MarkiMarkdown.exe')

test.skip(!existsSync(EXE), 'run "npm run pack:win" first')

test('the packaged application starts, edits and files a note', async () => {
  const root = mkdtempSync(join(tmpdir(), 'marki-pkg-'))
  const userData = join(root, 'userData')
  const downloads = join(root, 'downloads')
  const raw = join(root, 'raw')
  for (const dir of [userData, downloads, raw]) mkdirSync(dir, { recursive: true })

  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({
      seenCoachmark: true,
      autosave: true,
      members: [
        { id: 'a1', kind: 'agent', name: 'librarian', emoji: '\u{1F4DA}', path: join(root, 'librarian') },
        { id: 'x1', kind: 'artifact', name: 'thesis', emoji: '\u{1F4D5}', path: join(root, 'thesis') }
      ],
      bunches: [{ id: 'b1', name: 'study', emoji: '\u{1F465}', rawPath: raw, agentIds: ['a1'], artifactIds: ['x1'] }]
    }),
    'utf8'
  )

  const notePath = join(downloads, 'packaged-note.md')
  writeFileSync(notePath, '# Packaged\n\nHello from the installer.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n', 'utf8')

  const errors: string[] = []
  const app = await electron.launch({
    executablePath: EXE,
    args: [`--user-data-dir=${userData}`, notePath]
  })
  const page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })

  await page.waitForSelector('.app', { timeout: 40000 })
  await expect(page.locator('.pm-content')).toContainText('Packaged')
  await expect(page.locator('.raw-block table')).toBeVisible()

  // edit on the clean side, check the code side follows
  await page.locator('.pm-content p').first().click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Edited in the packaged app.')
  await expect(page.locator('.cm-content')).toContainText('Edited in the packaged app.')

  // file it
  await page.getByRole('button', { name: 'study bunch' }).click()
  await page.getByRole('button', { name: 'File to study' }).click()
  await expect(page.locator('.toast')).toContainText('Filed to study', { timeout: 25000 })

  const filed = join(raw, 'packaged-note.md')
  expect(existsSync(filed)).toBe(true)
  const content = readFileSync(filed, 'utf8')
  expect(content).toContain('bunch: study')
  expect(content).toContain('Edited in the packaged app.')
  expect(content).toContain('| a | b |')
  expect(existsSync(join(raw, 'log.md'))).toBe(false)

  expect(errors).toEqual([])

  await app.close()
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {
    /* disposable */
  }
})
