import { test, expect } from '@playwright/test'
import { readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs'
import { join, sep } from 'node:path'
import { launch, prepare, team, bunch, skillMember, domainMember, type Harness } from './helpers'

let h: Harness

test.afterEach(async () => {
  if (h) await h.close()
})

const NOTE = '# Lecture Notes\n\nSome content about memory.\n'

async function openWith(settings?: Record<string, unknown>) {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'lecture-notes.md')
  writeFileSync(notePath, NOTE, 'utf8')
  const harness = await launch(dirs, { openFile: notePath, settings: settings ?? team(dirs) })
  await expect(harness.page.locator('.pm-content')).toContainText('Lecture Notes')
  return { harness, notePath, dirs }
}

test('filing to a bunch writes one stamped copy into raw and moves the note there', async () => {
  const { harness, notePath, dirs } = await openWith()
  h = harness

  await h.page.getByRole('button', { name: 'study bunch', exact: true }).click()
  const fileButton = h.page.getByRole('button', { name: 'File to study' })
  await expect(fileButton).toBeVisible()
  await fileButton.click()
  await expect(h.page.locator('.toast')).toContainText('Filed to study', { timeout: 20000 })

  const filed = join(dirs.raw, 'lecture-notes.md')
  expect(existsSync(filed)).toBe(true)
  expect(existsSync(notePath)).toBe(false)
  expect(readdirSync(dirs.raw)).toEqual(['lecture-notes.md'])

  const text = readFileSync(filed, 'utf8')
  expect(text).toContain('bunch: study')
  expect(text).toContain('skills:\n  - librarian')
  expect(text).toContain('skill_paths:')
  expect(text).toContain(dirs.agent.split(sep).join('/'))
  expect(text).toContain('domains:\n  - thesis')
  expect(text).toContain('domain_paths:')
  expect(text).toContain(dirs.artifact.split(sep).join('/'))
  expect(text).toContain('skill/librarian')
  expect(text).toContain('domain/thesis')
  expect(text).toContain('type: note')
  expect(text).toMatch(/id:\s*\S+/)
  expect(text).toContain('# Lecture Notes')
  expect(text).toContain('Some content about memory.')

  // The YAML still names the bunch, so the File button stays in the top bar until Task 11 removes it.
  await expect(h.page.getByRole('button', { name: 'study bunch', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(h.errors).toEqual([])
})

test('after filing, edits keep going to the same file in raw', async () => {
  const { harness, dirs } = await openWith()
  h = harness

  await h.page.getByRole('button', { name: 'study bunch', exact: true }).click()
  await h.page.getByRole('button', { name: 'File to study' }).click()
  await expect(h.page.locator('.toast')).toContainText('Filed to study', { timeout: 20000 })

  await h.page.locator('.cm-content').click()
  await h.page.keyboard.press('Control+End')
  await h.page.keyboard.type('\nA later thought.')

  const filed = join(dirs.raw, 'lecture-notes.md')
  await expect.poll(() => readFileSync(filed, 'utf8'), { timeout: 10000 }).toContain('A later thought.')
  const text = readFileSync(filed, 'utf8')
  expect(text).toContain('A later thought.')
  expect(text).toContain('bunch: study')
  expect(readdirSync(dirs.raw)).toEqual(['lecture-notes.md'])
  expect(h.errors).toEqual([])
})

test('a bunch whose raw folder is missing is flagged and cannot be filed to', async () => {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'lecture-notes.md')
  writeFileSync(notePath, NOTE, 'utf8')
  h = await launch(dirs, {
    openFile: notePath,
    settings: {
      ...team(dirs),
      bunches: [bunch('b1', 'study', '\u{1F465}', join(dirs.root, 'gone'), ['a1'], ['x1'])]
    }
  })
  await expect(h.page.locator('.pm-content')).toContainText('Lecture Notes')

  const chip = h.page.getByRole('button', { name: 'study bunch', exact: true })
  await expect(chip).toHaveClass(/bunch-chip-unavailable/)
  await chip.click()
  await expect(h.page.getByRole('button', { name: 'File to study' })).toBeDisabled()
  await expect(h.page.locator('.blocked')).toContainText('cannot be reached')
  expect(h.errors).toEqual([])
})

test('a member whose folder is missing is flagged in the grid but filing still works', async () => {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'lecture-notes.md')
  writeFileSync(notePath, NOTE, 'utf8')
  const nowhere = join(dirs.root, 'nowhere')
  h = await launch(dirs, {
    openFile: notePath,
    settings: {
      ...team(dirs),
      members: [
        skillMember('a1', 'librarian', '\u{1F4DA}', dirs.agent),
        domainMember('x1', 'thesis', '\u{1F4D5}', nowhere)
      ]
    }
  })
  await expect(h.page.locator('.pm-content')).toContainText('Lecture Notes')

  await expect(h.page.locator('.pane-bunch .board-warn')).toHaveCount(1)

  await h.page.getByRole('button', { name: 'study bunch', exact: true }).click({ button: 'right' })
  const bunchDialog = h.page.getByRole('dialog', { name: 'Edit bunch' })
  await expect(bunchDialog.locator('.board-warn')).toHaveCount(1)
  await h.page.keyboard.press('Escape')

  await h.page.getByRole('button', { name: 'study bunch', exact: true }).click()
  await h.page.getByRole('button', { name: 'File to study' }).click()
  await expect(h.page.locator('.toast')).toContainText('Filed to study', { timeout: 20000 })

  const text = readFileSync(join(dirs.raw, 'lecture-notes.md'), 'utf8')
  expect(text).toContain('domain_paths:')
  expect(text).toContain(nowhere.split(sep).join('/'))
  expect(h.errors).toEqual([])
})

test('a bunch with no raw folder uses the default and remembers it', async () => {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'lecture-notes.md')
  writeFileSync(notePath, NOTE, 'utf8')
  h = await launch(dirs, {
    openFile: notePath,
    settings: {
      ...team(dirs),
      bunches: [bunch('b1', 'study', '\u{1F465}', '', ['a1'], ['x1'])],
      defaultRawPath: dirs.raw
    }
  })
  await expect(h.page.locator('.pm-content')).toContainText('Lecture Notes')

  await h.page.getByRole('button', { name: 'study bunch', exact: true }).click()
  await h.page.getByRole('button', { name: 'File to study' }).click()
  await expect(h.page.locator('.toast')).toContainText('Filed to study', { timeout: 20000 })

  expect(existsSync(join(dirs.raw, 'lecture-notes.md'))).toBe(true)
  const saved = JSON.parse(readFileSync(join(dirs.userData, 'settings.json'), 'utf8'))
  expect(saved.bunches[0].rawPath).toBe(dirs.raw)
  expect(h.errors).toEqual([])
})

test('an empty bunch cannot be filed to and says why', async () => {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'lecture-notes.md')
  writeFileSync(notePath, NOTE, 'utf8')
  h = await launch(dirs, {
    openFile: notePath,
    settings: { ...team(dirs), bunches: [bunch('b1', 'lonely', '\u{1FAE5}', dirs.raw, [], [])] }
  })
  await h.page.getByRole('button', { name: 'lonely bunch', exact: true }).click()
  await expect(h.page.getByRole('button', { name: 'File to lonely' })).toBeDisabled()
  await expect(h.page.locator('.blocked')).toContainText('Add a skill or a domain')
  expect(h.errors).toEqual([])
})
