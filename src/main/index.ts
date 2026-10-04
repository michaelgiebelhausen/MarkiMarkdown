import { app, BrowserWindow, ipcMain, dialog, shell, screen, Menu, clipboard } from 'electron'
import { join } from 'node:path'
import { promises as fsp } from 'node:fs'
import log from 'electron-log/main'
import { readSettings, writeSettings, saveApiKey, loadApiKey, settingsPersisting } from './ipc/settings'
import { diskArchiveOps, readFileForEditor, writeAtomic, translateFsError } from './ipc/files'
import { writeArchiveCopy, writeNewNote, moveWorkingFile } from './ipc/archive'
import { readLedger, appendLedger } from './ipc/ledger'
import { proposeKind } from '../shared/memberKind'
import type { LedgerEntry } from '../shared/types'
import { createDefaultRunner, detectProvider, runPrompt } from './ipc/ai'
import { buildMenu } from './menu'
import { WELCOME_NOTE } from './welcome'

log.initialize()
log.transports.file.level = 'info'

const isDev = !app.isPackaged
const pendingOpen: string[] = []

if (readSettings().disableHardwareAcceleration) app.disableHardwareAcceleration()

/* ------------------------------------------------------------------ *
 * Nothing may ever reach the student as a raw crash dialog
 * ------------------------------------------------------------------ */
function reportToWindows(message: string, detail: string): void {
  log.error(message, detail)
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('app:error', { message, detail })
  }
}

process.on('uncaughtException', (error) => {
  reportToWindows('Something went wrong inside MarkiMarkdown.', String(error?.stack ?? error))
})
process.on('unhandledRejection', (reason) => {
  reportToWindows('Something went wrong inside MarkiMarkdown.', String(reason))
})

/* ------------------------------------------------------------------ *
 * Windows
 * ------------------------------------------------------------------ */
function safeBounds(): { width: number; height: number; x?: number; y?: number } {
  const stored = readSettings() as unknown as { windowBounds?: { width: number; height: number; x: number; y: number } }
  const fallback = { width: 1200, height: 800 }
  const bounds = stored.windowBounds
  if (!bounds) return fallback
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return bounds.x < a.x + a.width && bounds.x + bounds.width > a.x && bounds.y < a.y + a.height && bounds.y + bounds.height > a.y
  })
  if (!visible) return fallback
  return { width: Math.max(900, bounds.width), height: Math.max(560, bounds.height), x: bounds.x, y: bounds.y }
}

/* ------------------------------------------------------------------ *
 * Never close a window over unsaved changes without asking
 * ------------------------------------------------------------------ */
/** Windows whose note has unsaved changes (or a save still under way), by window id, with the note's name. */
const unsaved = new Map<number, string>()
/** Windows whose note was saved after the student chose Save on closing. */
const closeApproved = new Set<number>()
/**
 * Windows saving before they close (the student chose Save), and whether a quit is waiting
 * for them. Closing such a window again neither asks again nor starts a second save.
 */
const quitAfterSave = new Map<number, boolean>()
/** Windows whose page has stopped responding: they can't save, so closing only offers Close. */
const unresponsive = new Set<number>()

/**
 * A quit is under way. Quitting closes every window in one go, so this stays true until
 * every window has had its say, and only then goes back to false if one of them kept the
 * quit from finishing.
 */
let quitting = false
/** The student pressed Cancel during this quit: the other windows stay open without asking. */
let quitCancelled = false
app.on('before-quit', () => {
  quitting = true
  quitCancelled = false
})

/** A window kept this quit from finishing: once the other windows have heard it, it is over. */
function quitHeldUp(): void {
  setImmediate(() => {
    quitting = false
    quitCancelled = false
  })
}

const SAVE = 0
const DONT_SAVE = 1
const CANCEL = 2

function askToSave(win: BrowserWindow, name: string): number {
  try {
    return dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Save', "Don't save", 'Cancel'],
      defaultId: SAVE,
      cancelId: CANCEL,
      message: `Save changes to ${name}?`,
      detail: "If you don't save, your changes will be lost."
    })
  } catch (error) {
    // Keeping the window open is the only answer that can't lose the note.
    log.warn('Could not ask about unsaved changes', error)
    return CANCEL
  }
}

const CLOSE_STUCK = 0

/** The page has stopped responding, so it can't save now: Close or Cancel. */
function askToCloseStuck(win: BrowserWindow, name: string): number {
  try {
    return dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Close', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'This window has stopped responding.',
      detail: `Changes to ${name} that weren't saved can't be saved now. Close the window anyway, or Cancel to give it a moment.`
    })
  } catch (error) {
    log.warn('Could not ask about closing a window that stopped responding', error)
    return 1
  }
}

ipcMain.on('window:set-dirty', (event, dirty: unknown, name: unknown) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  if (dirty === true) unsaved.set(win.id, typeof name === 'string' && name.length > 0 ? name : 'this note')
  else unsaved.delete(win.id)
})

ipcMain.on('window:close-now', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed()) return
  const resumeQuit = quitAfterSave.get(win.id) ?? false
  quitAfterSave.delete(win.id)
  closeApproved.add(win.id)
  win.close()
  if (resumeQuit) app.quit()
})

// The save chosen on closing didn't go through (or its archive copy didn't): the window
// stays open, any quit that waited for it is off, and the next close asks afresh.
ipcMain.on('window:stay-open', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) quitAfterSave.delete(win.id)
})

export function createWindow(openPath?: string): BrowserWindow {
  const win = new BrowserWindow({
    ...safeBounds(),
    minWidth: 900,
    minHeight: 560,
    show: false,
    title: 'MarkiMarkdown',
    backgroundColor: '#FCFCFB',
    autoHideMenuBar: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true
    }
  })

  win.once('ready-to-show', () => win.show())

  const id = win.id

  /**
   * The page has gone (crashed or killed): whatever it had not saved went with it, and it
   * can no longer answer a save, so closing must not ask about it or wait for it.
   */
  const forgetGonePage = (reason: string) => {
    if (unsaved.has(id) || quitAfterSave.has(id)) {
      log.error(`A window's page stopped (${reason}) with changes that weren't saved: ${unsaved.get(id) ?? 'this note'}`)
    }
    unsaved.delete(id)
    quitAfterSave.delete(id)
    unresponsive.delete(id)
  }

  /** True when the window may close now; otherwise it has asked, or is saving first. */
  const mayClose = (): boolean => {
    if (closeApproved.has(id)) return true
    const duringQuit = quitting
    // The page has crashed: whatever it had not saved went with it, and it can no longer
    // save. isCrashed() can turn true before render-process-gone reaches us, so treat it
    // the same way here rather than asking about changes nobody can save.
    if (win.webContents.isCrashed()) {
      forgetGonePage('crashed')
      return true
    }
    const saving = quitAfterSave.has(id)
    const note = unsaved.get(id)
    if (!saving && !note) return true

    // A page that has stopped responding can't save now: offer only Close or Cancel.
    if (unresponsive.has(id)) {
      if (duringQuit && quitCancelled) return false
      if (askToCloseStuck(win, note ?? 'this note') === CLOSE_STUCK) return true
      if (duringQuit) {
        quitCancelled = true
        quitHeldUp()
      }
      return false
    }

    // Already saving because the student chose Save: wait for that save rather than
    // asking again or saving twice. A quit asked for meanwhile carries on once it is done.
    if (saving) {
      if (duringQuit) {
        quitAfterSave.set(id, true)
        quitHeldUp()
      }
      return false
    }

    // The student already pressed Cancel on this quit for another window.
    if (duringQuit && quitCancelled) return false

    // Unsaved changes: ask first. Save hands the save to the window, which closes it again
    // through window:close-now once the note is saved; a failed save leaves it open.
    const answer = askToSave(win, note ?? 'this note')
    if (answer === DONT_SAVE) return true
    if (duringQuit) {
      if (answer === CANCEL) quitCancelled = true
      quitHeldUp()
    }
    if (answer === SAVE) {
      // A quit waits for this window: carry on with it only once the note is saved.
      quitAfterSave.set(id, duringQuit)
      win.webContents.send('menu:action', 'save-then-close')
    }
    return false
  }

  win.on('close', (event) => {
    if (!mayClose()) {
      event.preventDefault()
      return
    }
    const [width, height] = win.getSize()
    const [x, y] = win.getPosition()
    // The window is going away, so there is no one left to tell; writeSettings logs a failure.
    writeSettings({ windowBounds: { width, height, x, y } } as never)
  })

  win.on('unresponsive', () => unresponsive.add(id))
  win.on('responsive', () => unresponsive.delete(id))

  // The page has gone (crashed or killed): whatever it had not saved went with it, and it
  // can no longer answer a save, so closing must not ask about it or wait for it.
  win.webContents.on('render-process-gone', (_event, details) => forgetGonePage(details.reason))

  win.on('closed', () => {
    unsaved.delete(id)
    closeApproved.delete(id)
    quitAfterSave.delete(id)
    unresponsive.delete(id)
  })

  // Spelling suggestions, and never a browser context menu
  win.webContents.on('context-menu', (_event, params) => {
    const items: Electron.MenuItemConstructorOptions[] = []
    for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
      items.push({ label: suggestion, click: () => win.webContents.replaceMisspelling(suggestion) })
    }
    if (params.misspelledWord) {
      if (items.length > 0) items.push({ type: 'separator' })
      items.push({
        label: 'Add to dictionary',
        click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
      })
      items.push({ type: 'separator' })
    }
    items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' })
    Menu.buildFromTemplate(items).popup({ window: win })
  })

  // External links open in the real browser, never inside the editor
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  if (openPath) {
    win.webContents.once('did-finish-load', () => win.webContents.send('file:open-path', openPath))
  }
  return win
}

/* ------------------------------------------------------------------ *
 * One instance, several windows
 * ------------------------------------------------------------------ */
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const path = argv.find((a) => /\.(md|markdown|txt|text)$/i.test(a))
    createWindow(path)
  })
}

app.on('open-file', (event, path) => {
  event.preventDefault()
  if (app.isReady()) createWindow(path)
  else pendingOpen.push(path)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

/* ------------------------------------------------------------------ *
 * First run: a welcome note the student can actually file
 * ------------------------------------------------------------------ */
async function ensureWelcomeNote(): Promise<string | undefined> {
  const settings = readSettings()
  if (settings.seenWelcome) return undefined
  try {
    const target = join(app.getPath('documents'), 'Welcome to MarkiMarkdown.md')
    try {
      await fsp.access(target)
    } catch {
      await writeAtomic(target, WELCOME_NOTE)
    }
    if (!writeSettings({ seenWelcome: true }).persisted) {
      log.warn('Could not remember that the welcome note was shown; it will open again next time')
    }
    return target
  } catch (error) {
    log.warn('Could not create the welcome note', error)
    return undefined
  }
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(buildMenu(() => BrowserWindow.getFocusedWindow(), createWindow))

  try {
    const languages = [app.getLocale() || 'en-US']
    for (const win of BrowserWindow.getAllWindows()) win.webContents.session.setSpellCheckerLanguages(languages)
  } catch {
    /* spell check is a nicety, never a failure */
  }

  const argPath = process.argv.find((a) => /\.(md|markdown|txt|text)$/i.test(a))
  const first = pendingOpen.shift() ?? argPath ?? (await ensureWelcomeNote())
  const win = createWindow(first)

  try {
    win.webContents.session.setSpellCheckerLanguages([app.getLocale() || 'en-US'])
  } catch {
    /* ignore */
  }

  for (const extra of pendingOpen) createWindow(extra)
  pendingOpen.length = 0

  if (process.platform === 'darwin' && app.isPackaged && !app.isInApplicationsFolder()) {
    const answer = dialog.showMessageBoxSync({
      type: 'question',
      buttons: ['Move to Applications', 'Not now'],
      defaultId: 0,
      message: 'Move MarkiMarkdown to your Applications folder?',
      detail: 'Running it from the disk image can stop updates and file associations from working.'
    })
    if (answer === 0) {
      try {
        app.moveToApplicationsFolder()
      } catch (error) {
        log.warn('Could not move to Applications', error)
      }
    }
  }
})

/* ------------------------------------------------------------------ *
 * IPC - every handler returns a result object, never throws
 * ------------------------------------------------------------------ */
function ok<T extends object>(value: T) {
  return { ok: true as const, ...value }
}
function fail(message: string) {
  return { ok: false as const, message }
}

ipcMain.handle('settings:read', () => {
  const settings = readSettings()
  return { ...settings, hasApiKey: loadApiKey() !== undefined, persisting: settingsPersisting() }
})

ipcMain.handle('settings:write', (_e, patch) => {
  try {
    return ok(writeSettings(patch))
  } catch (error) {
    return fail(translateFsError(error, 'your settings'))
  }
})

ipcMain.handle('settings:save-api-key', (_e, key: string) => ok({ saved: saveApiKey(key) }))

ipcMain.handle('dialog:pick-folder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const options: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return { ok: false as const, message: '' }
  return ok({ path: result.filePaths[0] })
})

ipcMain.handle('dialog:create-default-folder', async () => {
  try {
    const base = join(app.getPath('documents'), 'Second Brain', 'raw')
    await fsp.mkdir(base, { recursive: true })
    return ok({ path: base })
  } catch (error) {
    return fail(translateFsError(error, 'your Documents folder'))
  }
})

async function ipcReadFile(path: string) {
  try {
    return ok({ file: await readFileForEditor(path) })
  } catch (error) {
    return fail(translateFsError(error, path))
  }
}

ipcMain.handle('file:read', (_e, path: string) => ipcReadFile(path))

ipcMain.handle('file:open-dialog', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile'],
    filters: [
      { name: 'Notes', extensions: ['md', 'markdown', 'txt', 'text'] },
      { name: 'All files', extensions: ['*'] }
    ]
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return { ok: false as const, message: '' }
  return ipcReadFile(result.filePaths[0])
})

ipcMain.handle('file:save-all', async (_e, paths: string[], content: string) => {
  const failures: { path: string; message: string }[] = []
  for (const path of paths) {
    try {
      await writeAtomic(path, content)
    } catch (error) {
      failures.push({ path, message: translateFsError(error, path) })
    }
  }
  return { ok: failures.length === 0, failures }
})

ipcMain.handle('file:save-as', async (event, suggestedName: string, content: string) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const options: Electron.SaveDialogOptions = {
    defaultPath: suggestedName,
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  }
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return { ok: false as const, message: '' }
  try {
    await writeAtomic(result.filePath, content)
    return ok({ path: result.filePath })
  } catch (error) {
    return fail(translateFsError(error, result.filePath))
  }
})

ipcMain.handle('archive:write', async (_e, rawDir: string, fileName: string, date: string, text: string) => {
  try {
    return await writeArchiveCopy(diskArchiveOps, rawDir, fileName, date, text)
  } catch (error) {
    return fail(translateFsError(error, 'the raw folder'))
  }
})

ipcMain.handle('file:write-new', async (_e, dir: string, fileName: string, text: string) => {
  try {
    return await writeNewNote(diskArchiveOps, dir, fileName, text)
  } catch (error) {
    return fail(translateFsError(error, dir))
  }
})

ipcMain.handle('file:move', async (_e, from: string, toDir: string) => {
  try {
    return await moveWorkingFile(diskArchiveOps, from, toDir)
  } catch (error) {
    return fail(translateFsError(error, from))
  }
})

ipcMain.handle('ledger:read', () => ok({ entries: readLedger() }))

ipcMain.handle('ledger:append', (_e, entry: LedgerEntry) => ok(appendLedger(entry)))

ipcMain.handle('members:propose-kind', async (_e, path: string) => {
  try {
    return ok({ kind: proposeKind(await fsp.readdir(path)) })
  } catch {
    return ok({ kind: 'domain' as const })
  }
})

/** Which of these folders are not there right now. An empty path counts as missing. */
ipcMain.handle('members:missing-paths', async (_e, paths: string[]) => {
  const missing: string[] = []
  for (const path of paths) {
    if (path.length === 0) {
      missing.push(path)
      continue
    }
    try {
      if (!(await fsp.stat(path)).isDirectory()) missing.push(path)
    } catch {
      missing.push(path)
    }
  }
  return ok({ missing: [...new Set(missing)] })
})

ipcMain.handle('shell:show-item', (_e, path: string) => {
  try {
    shell.showItemInFolder(path)
    return ok({})
  } catch {
    return fail('That folder could not be opened.')
  }
})

ipcMain.handle('shell:open-external', (_e, url: string) => {
  if (/^https?:/.test(url)) shell.openExternal(url)
  return ok({})
})

ipcMain.handle('ai:detect', async () => {
  try {
    const settings = readSettings()
    const status = await detectProvider(createDefaultRunner(), {
      claudePath: settings.aiClaudePath,
      apiKey: loadApiKey()
    })
    return ok({ status })
  } catch {
    return ok({
      status: {
        available: false,
        kind: 'none' as const,
        detail: 'No AI provider was found on this computer.'
      }
    })
  }
})

ipcMain.handle('ai:run', async (_e, prompt: string, text: string) => {
  try {
    const settings = readSettings()
    const runner = createDefaultRunner()
    const status = await detectProvider(runner, {
      claudePath: settings.aiClaudePath,
      apiKey: loadApiKey()
    })
    if (!status.available) return fail(status.detail)
    const result = await runPrompt(runner, status, prompt, text, {
      apiKey: loadApiKey(),
      model: settings.ollamaModel
    })
    return result.ok ? ok({ text: result.text }) : fail(result.message)
  } catch {
    return fail('The AI could not be reached. Check Settings to see which provider is set up.')
  }
})

ipcMain.handle('diagnostics:copy', async () => {
  const settings = readSettings()
  let aiDetail = 'not checked'
  try {
    const status = await detectProvider(createDefaultRunner(), {
      claudePath: settings.aiClaudePath,
      apiKey: loadApiKey()
    })
    aiDetail = `${status.kind}: ${status.detail}`
  } catch {
    aiDetail = 'detection failed'
  }
  const skills = settings.members.filter((m) => m.kind === 'skill').length
  const domains = settings.members.filter((m) => m.kind === 'domain').length
  const report = [
    `MarkiMarkdown ${app.getVersion()}`,
    `Electron ${process.versions.electron}, Node ${process.versions.node}`,
    `${process.platform} ${process.arch}`,
    `Skills: ${skills}, Domains: ${domains}, Bunches: ${settings.bunches.length}`,
    `AI: ${aiDetail}`,
    `Logs: ${log.transports.file.getFile().path}`
  ].join('\n')
  clipboard.writeText(report)
  return ok({ report })
})

ipcMain.handle('log:open-folder', () => {
  try {
    shell.showItemInFolder(log.transports.file.getFile().path)
    return ok({})
  } catch {
    return fail('The log folder could not be opened.')
  }
})

ipcMain.handle(
  'dialog:confirm',
  async (event, options: { message: string; detail?: string; buttons: string[]; danger?: boolean }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const config: Electron.MessageBoxOptions = {
      type: options.danger ? 'warning' : 'question',
      buttons: options.buttons,
      defaultId: 0,
      cancelId: options.buttons.length - 1,
      message: options.message,
      detail: options.detail
    }
    const result = win ? await dialog.showMessageBox(win, config) : await dialog.showMessageBox(config)
    return ok({ index: result.response })
  }
)

ipcMain.handle('clipboard:read-text', () => ok({ text: clipboard.readText() }))

ipcMain.handle('window:new', () => {
  createWindow()
  return ok({})
})
