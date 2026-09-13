import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, prepare, team, agentMember, artifactMember, type Harness } from './helpers'

let h: Harness

test.afterEach(async () => {
  if (h) await h.close()
})

async function openWith(extra: Record<string, unknown> = {}) {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'board.md')
  writeFileSync(notePath, '# Board\n\nText.\n', 'utf8')
  const harness = await launch(dirs, { openFile: notePath, settings: { ...team(dirs), ...extra } })
  await expect(harness.page.locator('.pm-content')).toContainText('Board')
  return { harness, dirs }
}

test('the team board lists agents across the top, artifacts down the side, and counts filings', async () => {
  const { harness } = await openWith()
  h = harness

  await h.page.getByRole('button', { name: 'Team board' }).click()
  const board = h.page.getByRole('dialog', { name: 'Team board' })
  await expect(board.locator('th.board-agent')).toHaveText(/librarian/)
  await expect(board.locator('th.board-artifact')).toHaveText(/thesis/)
  await expect(board.getByRole('button', { name: 'librarian and thesis: 0 notes' })).toBeVisible()
  await board.getByRole('button', { name: 'Done' }).click()

  await h.page.getByRole('button', { name: 'study bunch' }).click()
  await h.page.getByRole('button', { name: 'File to study' }).click()
  await expect(h.page.locator('.toast')).toContainText('Filed to study', { timeout: 20000 })

  await h.page.getByRole('button', { name: 'Team board' }).click()
  await expect(h.page.getByRole('button', { name: 'librarian and thesis: 1 note' })).toBeVisible()
  expect(h.errors).toEqual([])
})

test('clicking a square with exactly one bunch opens that bunch', async () => {
  const { harness } = await openWith()
  h = harness

  await h.page.getByRole('button', { name: 'Team board' }).click()
  await h.page.getByRole('button', { name: 'librarian and thesis: 0 notes' }).click()
  const dialog = h.page.getByRole('dialog', { name: 'Edit bunch' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('input').first()).toHaveValue('study')
  expect(h.errors).toEqual([])
})

test('clicking a square with no bunch starts a new one with both members ticked', async () => {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'board.md')
  writeFileSync(notePath, '# Board\n\nText.\n', 'utf8')
  h = await launch(dirs, {
    openFile: notePath,
    settings: {
      ...team(dirs),
      members: [
        agentMember('a1', 'librarian', '\u{1F4DA}', dirs.agent),
        artifactMember('x1', 'thesis', '\u{1F4D5}', dirs.artifact),
        artifactMember('x2', 'notes', '\u{1F4D3}', dirs.downloads)
      ],
      defaultRawPath: dirs.raw
    }
  })
  await expect(h.page.locator('.pm-content')).toContainText('Board')

  await h.page.getByRole('button', { name: 'Team board' }).click()
  await h.page.getByRole('button', { name: 'librarian and notes: 0 notes' }).click()
  const dialog = h.page.getByRole('dialog', { name: 'Make a bunch' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('checkbox', { name: /librarian/ })).toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: /notes/ })).toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: /thesis/ })).not.toBeChecked()

  const save = dialog.getByRole('button', { name: 'Save' })
  await expect(save).toBeDisabled()
  await dialog.locator('input').first().fill('notes-team')
  await expect(save).toBeEnabled()
  await save.click()

  // back on the board, and the strip now has two bunches
  await expect(h.page.getByRole('dialog', { name: 'Team board' })).toBeVisible()
  await h.page.getByRole('button', { name: 'Done' }).click()
  await expect(h.page.getByRole('button', { name: 'notes-team bunch' })).toBeVisible()
  expect(h.errors).toEqual([])
})

test('adding a folder with a CLAUDE.md proposes agent', async () => {
  // The folder picker is a native dialog, so this checks the proposal through the IPC directly.
  const { harness, dirs } = await openWith()
  h = harness
  const kind = await h.page.evaluate(
    (path) => window.marki.members.proposeKind(path).then((r) => (r.ok ? r.kind : 'error')),
    dirs.agent
  )
  expect(kind).toBe('agent')
  const other = await h.page.evaluate(
    (path) => window.marki.members.proposeKind(path).then((r) => (r.ok ? r.kind : 'error')),
    dirs.artifact
  )
  expect(other).toBe('artifact')
})
