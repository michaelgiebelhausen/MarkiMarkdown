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

/** Answers the next "Save changes?" questions with this button, and counts how often it was asked. */
async function answerSaveChanges(button: number) {
  await h.app.evaluate(({ dialog }, b) => {
    const g = globalThis as unknown as { asked: number }
    g.asked = 0
    dialog.showMessageBox = (async () => {
      g.asked += 1
      return { response: b, checkboxChecked: false }
    }) as typeof dialog.showMessageBox
    dialog.showMessageBoxSync = (() => {
      g.asked += 1
      return b
    }) as typeof dialog.showMessageBoxSync
  }, button)
}

const asked = () => h.app.evaluate(() => (globalThis as unknown as { asked: number }).asked)

async function openPath(path: string) {
  await h.app.evaluate(({ BrowserWindow }, p) => BrowserWindow.getAllWindows()[0].webContents.send('file:open-path', p), path)
}

test('opening another note over an unsaved untitled one asks first', async () => {
  const dirs = prepare()
  const other = join(dirs.downloads, 'other.md')
  writeFileSync(other, '# Other\n\nSecond note.\n', 'utf8')
  h = await launch(dirs, { settings: { ...team(dirs), defaultRawPath: dirs.raw } })
  await h.page.locator('.cm-content').click()
  await h.page.keyboard.type('# Draft\n\nNot saved anywhere yet.')

  await answerSaveChanges(2) // Cancel
  await openPath(other)
  await expect.poll(asked).toBe(1)
  await h.page.waitForTimeout(300)
  await expect(h.page.locator('.pm-content')).toContainText('Not saved anywhere yet.')
  await expect(h.page.locator('.chip-name')).toHaveText('Untitled.md')

  await answerSaveChanges(1) // Don't save
  await openPath(other)
  await expect(h.page.locator('.pm-content')).toContainText('Second note.')
  await expect(h.page.locator('.chip-name')).toHaveText('other.md')
  expect(await asked()).toBe(1)
  expect(h.errors).toEqual([])
})

test('choosing Save before opening another note saves first', async () => {
  const { dirs, notePath } = await openNote({ autosave: false })
  const other = join(dirs.downloads, 'other.md')
  writeFileSync(other, '# Other\n\nSecond note.\n', 'utf8')
  await typeAtEnd(' Keep this.')
  await answerSaveChanges(0) // Save
  await openPath(other)
  await expect(h.page.locator('.pm-content')).toContainText('Second note.')
  expect(readFileSync(notePath, 'utf8')).toContain('Keep this.')

  // a clean note opens another without asking
  await answerSaveChanges(2)
  await openPath(notePath)
  await expect(h.page.locator('.chip-name')).toHaveText('essay.md')
  expect(await asked()).toBe(0)
  expect(h.errors).toEqual([])
})

/** Opens a second window, so closing the first one does not end the app, and returns the first one's id. */
async function secondWindow(): Promise<number> {
  const first = await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id)
  await h.page.evaluate(() => window.marki.windows.create())
  await expect.poll(() => h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2)
  return first
}

const isOpen = (id: number) =>
  h.app.evaluate(({ BrowserWindow }, i) => {
    const win = BrowserWindow.fromId(i)
    return win !== null && !win.isDestroyed()
  }, id)

async function closeWindow(id: number) {
  await h.app.evaluate(({ BrowserWindow }, i) => BrowserWindow.fromId(i)?.close(), id)
}

test('closing a window with unsaved changes asks: Cancel keeps it, Save saves and then closes', async () => {
  const { notePath } = await openNote({ autosave: false })
  const first = await secondWindow()
  await typeAtEnd(' Unsaved words.')
  await expect(h.page.locator('.chip-dot')).toHaveCount(1)
  await h.page.waitForTimeout(300)

  await answerSaveChanges(2) // Cancel
  await closeWindow(first)
  expect(await asked()).toBe(1)
  expect(await isOpen(first)).toBe(true)
  await expect(h.page.locator('.cm-content')).toContainText('Unsaved words.')

  await answerSaveChanges(0) // Save
  await closeWindow(first)
  await expect.poll(() => isOpen(first), { timeout: 20000 }).toBe(false)
  expect(readFileSync(notePath, 'utf8')).toContain('Unsaved words.')
  expect(await asked()).toBe(1)
})

test("closing a window with unsaved changes and choosing Don't save closes it and leaves the file", async () => {
  const { notePath } = await openNote({ autosave: false })
  const first = await secondWindow()
  await typeAtEnd(' Throw these away.')
  await expect(h.page.locator('.chip-dot')).toHaveCount(1)
  await h.page.waitForTimeout(300)

  await answerSaveChanges(1) // Don't save
  await closeWindow(first)
  await expect.poll(() => isOpen(first), { timeout: 20000 }).toBe(false)
  expect(readFileSync(notePath, 'utf8')).toBe('# Essay\n\nFirst draft.\n')
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
