import { test, expect } from '@playwright/test'
import { _electron as electron } from '@playwright/test'
import { existsSync, writeFileSync, readFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Defaults to the freshly built bundle; set MARKI_EXE to test a real installation.
const EXE = process.env.MARKI_EXE ?? join(process.cwd(), 'dist', 'win-unpacked', 'MarkiMarkdown.exe')

test.skip(!existsSync(EXE), 'run "npm run pack:win" first')

test('the packaged application starts, edits and archives a note', async () => {
  const root = mkdtempSync(join(tmpdir(), 'marki-pkg-'))
  const userData = join(root, 'userData')
  const downloads = join(root, 'downloads')
  const raw = join(root, 'raw')
  for (const dir of [userData, downloads, raw]) mkdirSync(dir, { recursive: true })

  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({
      seenWelcome: true,
      autosave: true,
      defaultRawPath: raw,
      members: [
        { id: 'a1', kind: 'skill', name: 'librarian', emoji: '\u{1F4DA}', path: join(root, 'librarian') },
        { id: 'x1', kind: 'domain', name: 'thesis', emoji: '\u{1F4D5}', path: join(root, 'thesis') }
      ],
      bunches: [{ id: 'b1', name: 'study', emoji: '\u{1F465}', rawPath: raw, skillIds: ['a1'], domainIds: ['x1'] }]
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

  // tick and archive it
  await page.locator('.pane-bunch').getByRole('button', { name: 'librarian and thesis: 0 notes', exact: true }).click()
  await page.locator('.pane-bunch').getByRole('checkbox', { name: /Archive \/ distribute/ }).check()
  await page.locator('.pane-bunch').getByRole('button', { name: 'Save and archive', exact: true }).click()
  await expect(page.locator('.toast')).toContainText('Saved and archived', { timeout: 25000 })

  const copies = readdirSync(raw)
  expect(copies).toHaveLength(1)
  const content = readFileSync(join(raw, copies[0]), 'utf8')
  expect(content).toContain('skills:')
  expect(content).toContain('archived:')
  expect(content).toContain('Edited in the packaged app.')
  expect(content).toContain('| a | b |')
  // v1 wrote a folder log; v2 must not
  expect(existsSync(join(raw, 'log.md'))).toBe(false)
  // the working copy stays put
  expect(existsSync(notePath)).toBe(true)

  expect(errors).toEqual([])

  await app.close()
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {
    /* disposable */
  }
})
