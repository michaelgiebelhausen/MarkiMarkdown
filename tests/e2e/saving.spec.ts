import { test, expect } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, prepare, team, type Harness } from './helpers'

let h: Harness

test.afterEach(async () => {
  if (h) await h.close()
})

function today(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

async function openNote(extra: Record<string, unknown> = {}) {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'essay.md')
  writeFileSync(notePath, '# Essay\n\nFirst draft.\n', 'utf8')
  h = await launch(dirs, { openFile: notePath, settings: { ...team(dirs), defaultRawPath: dirs.raw, ...extra } })
  await expect(h.page.locator('.pm-content')).not.toBeEmpty()
  return { dirs, notePath }
}

async function menu(action: string) {
  await h.app.evaluate(({ BrowserWindow }, a) => BrowserWindow.getAllWindows()[0].webContents.send('menu:action', a), action)
}

async function typeAtEnd(text: string) {
  await h.page.locator('.cm-content').click()
  await h.page.keyboard.press('Control+End')
  await h.page.keyboard.type(text)
}

const pane = () => h.page.locator('.pane-bunch')
const toasts = () => h.page.locator('.toast')

/**
 * file:save-all writes straight away, but its first reply waits for releaseSave, so a save
 * can be caught after its write and before it hears back. Later calls reply at once.
 */
async function holdFirstSaveReply() {
  await h.app.evaluate(({ ipcMain }) => {
    const fs = process.getBuiltinModule('node:fs') as typeof import('node:fs')
    const g = globalThis as unknown as { releaseSave?: () => void; saveCalls: number }
    g.saveCalls = 0
    delete g.releaseSave
    ipcMain.removeHandler('file:save-all')
    ipcMain.handle('file:save-all', (_e, paths: string[], content: string) => {
      g.saveCalls += 1
      for (const path of paths) fs.writeFileSync(path, content, 'utf8')
      if (g.saveCalls > 1) return { ok: true, failures: [] }
      return new Promise((resolve) => {
        g.releaseSave = () => resolve({ ok: true, failures: [] })
      })
    })
  })
}

async function releaseSaveReply() {
  const held = () => h.app.evaluate(() => typeof (globalThis as unknown as { releaseSave?: () => void }).releaseSave)
  await expect.poll(held, { timeout: 10000 }).toBe('function')
  await h.app.evaluate(() => (globalThis as unknown as { releaseSave: () => void }).releaseSave())
}

const saveCalls = () => h.app.evaluate(() => (globalThis as unknown as { saveCalls: number }).saveCalls)

test('Save As writes the new file and the note lives there; a failed one says so, a cancelled one says nothing', async () => {
  const { dirs } = await openNote({ autosave: false })
  await h.app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = (async () => ({ canceled: true, filePath: '' })) as typeof dialog.showSaveDialog
  })
  await menu('save-as')
  await h.page.waitForTimeout(500)
  await expect(toasts()).toHaveCount(0)

  const copy = join(dirs.downloads, 'copy.md')
  await h.app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: target })) as typeof dialog.showSaveDialog
  }, copy)
  await typeAtEnd(' Edited.')
  await menu('save-as')
  await expect(toasts().filter({ hasText: 'Saved as copy.md.' })).toHaveCount(1)
  await expect(h.page.locator('.chip-name')).toHaveText('copy.md')
  expect(readFileSync(copy, 'utf8')).toContain('Edited.')
  await expect(h.page.locator('.chip-dot')).toHaveCount(0)

  // a write that fails says why, and the note stays where it was
  await h.app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('file:save-as')
    ipcMain.handle('file:save-as', () => ({ ok: false, message: 'later.md is in use by another program. Close it there and try again.' }))
  })
  await typeAtEnd(' More.')
  await menu('save-as')
  await expect(toasts().filter({ hasText: 'later.md is in use by another program.' })).toHaveCount(1)
  await expect(h.page.locator('.chip-name')).toHaveText('copy.md')
  await expect(h.page.locator('.chip-dot')).toHaveCount(1)
  expect(h.errors).toEqual([])
})

test('a save whose write finished after another note was opened says it was saved, and still archives', async () => {
  const { dirs, notePath } = await openNote({ autosave: false })
  const other = join(dirs.downloads, 'other.md')
  writeFileSync(other, '# Other\n\nSecond note.\n', 'utf8')
  // Opening over unsaved changes asks first: answer "Don't save".
  await h.app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox
  })
  await pane().getByRole('button', { name: 'librarian and thesis: 0 notes', exact: true }).click()
  await pane().getByRole('checkbox', { name: /Archive \/ distribute/ }).check()
  await holdFirstSaveReply()
  await menu('save')

  const held = () => h.app.evaluate(() => typeof (globalThis as unknown as { releaseSave?: () => void }).releaseSave)
  await expect.poll(held, { timeout: 10000 }).toBe('function')
  await h.app.evaluate(({ BrowserWindow }, p) => BrowserWindow.getAllWindows()[0].webContents.send('file:open-path', p), other)
  await expect(h.page.locator('.pm-content')).toContainText('Second note.')
  await releaseSaveReply()

  await expect(toasts().filter({ hasText: 'Saved essay.md. Another note is open now.' })).toHaveCount(1, { timeout: 20000 })
  await expect(toasts().filter({ hasText: 'Saved and archived to raw.' })).toHaveCount(1, { timeout: 20000 })
  await expect(toasts().filter({ hasText: 'this save stopped' })).toHaveCount(0)
  expect(readFileSync(notePath, 'utf8')).toContain('skills:')
  expect(existsSync(join(dirs.raw, `essay-${today()}.md`))).toBe(true)
  // the note open now is left exactly as it was
  await expect(h.page.locator('.chip-name')).toHaveText('other.md')
  await expect(h.page.locator('.chip-dot')).toHaveCount(0)
  expect(readFileSync(other, 'utf8')).toBe('# Other\n\nSecond note.\n')
  expect(h.errors).toEqual([])
})

test('Ctrl+S pressed during a save queues exactly one more save', async () => {
  const { notePath } = await openNote({ autosave: false })
  await typeAtEnd(' One.')
  await holdFirstSaveReply()
  await menu('save')
  const held = () => h.app.evaluate(() => typeof (globalThis as unknown as { releaseSave?: () => void }).releaseSave)
  await expect.poll(held, { timeout: 10000 }).toBe('function')

  await typeAtEnd(' Two.')
  await menu('save')
  await menu('save')
  await releaseSaveReply()

  await expect.poll(() => readFileSync(notePath, 'utf8'), { timeout: 20000 }).toContain('Two.')
  await expect.poll(saveCalls, { timeout: 10000 }).toBe(2)
  await h.page.waitForTimeout(1000)
  expect(await saveCalls()).toBe(2)
  await expect(h.page.locator('.chip-dot')).toHaveCount(0)
  expect(h.errors).toEqual([])
})

test('a failed autosave says so once, and keeps the text', async () => {
  const { notePath } = await openNote()
  await h.app.evaluate(({ ipcMain }) => {
    const g = globalThis as unknown as { saveCalls: number }
    g.saveCalls = 0
    ipcMain.removeHandler('file:save-all')
    ipcMain.handle('file:save-all', (_e, paths: string[]) => {
      g.saveCalls += 1
      return { ok: false, failures: [{ path: paths[0], message: 'essay.md is in use by another program. Close it there and try again.' }] }
    })
  })
  await typeAtEnd(' Unsaved one.')
  const warning = toasts().filter({ hasText: "Autosave couldn't write essay.md" })
  await expect(warning).toHaveText(
    /Autosave couldn't write essay\.md: essay\.md is in use by another program\. Close it there and try again\. Your text is still here; press Save to try again\./,
    { timeout: 20000 }
  )

  await typeAtEnd(' Unsaved two.')
  await expect.poll(saveCalls, { timeout: 20000 }).toBeGreaterThanOrEqual(2)
  await expect(warning).toHaveCount(1)
  await expect(h.page.locator('.cm-content')).toContainText('Unsaved two.')
  expect(readFileSync(notePath, 'utf8')).toBe('# Essay\n\nFirst draft.\n')
  expect(h.errors).toEqual([])
})
