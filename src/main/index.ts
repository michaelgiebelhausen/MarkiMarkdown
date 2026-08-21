import { app, BrowserWindow, ipcMain, dialog, shell, screen, Menu, clipboard } from 'electron'
import { join } from 'node:path'
import { promises as fsp } from 'node:fs'
import log from 'electron-log/main'
import { readSettings, writeSettings, saveApiKey, loadApiKey } from './ipc/settings'
import { diskOps, readFileForEditor, writeAtomic, translateFsError, findSiblings } from './ipc/files'
import { preflight, runFiling, undoFiling, type FilingPlan, type UndoRecord } from './ipc/filing'
import { createDefaultRunner, detectProvider, runPrompt } from './ipc/ai'
import { buildMenu } from './menu'
import { WELCOME_NOTE } from './welcome'

log.initialize()
log.transports.file.level = 'info'

const isDev = !app.isPackaged
const pendingOpen: string[] = []
// One undo slot per window: two windows filing at once must not undo each other's work.
const undoByWindow = new Map<number, UndoRecord>()

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

  win.on('closed', () => {
    undoByWindow.delete(win.webContents.id)
  })

  win.on('close', () => {
    const [width, height] = win.getSize()
    const [x, y] = win.getPosition()
    writeSettings({ windowBounds: { width, height, x, y } } as never)
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
  if (settings.seenCoachmark) return undefined
  try {
    const target = join(app.getPath('documents'), 'Welcome to MarkiMarkdown.md')
    try {
      await fsp.access(target)
    } catch {
      await writeAtomic(target, WELCOME_NOTE)
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

ipcMain.handle('settings:read', () => ({ ...readSettings(), hasApiKey: loadApiKey() !== undefined }))

ipcMain.handle('settings:write', (_e, patch) => {
  try {
    return ok({ settings: writeSettings(patch) })
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
    const base = join(app.getPath('documents'), 'Second Brain', 'Inbox')
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

ipcMain.handle('filing:preflight', async (_e, plan: FilingPlan) => {
  try {
    return ok({ result: await preflight(diskOps, plan) })
  } catch (error) {
    return fail(translateFsError(error, 'those folders'))
  }
})

ipcMain.handle('filing:run', async (event, plan: FilingPlan) => {
  try {
    const outcome = await runFiling(diskOps, plan)
    undoByWindow.set(event.sender.id, outcome.undo)
    return { ok: true as const, outcome }
  } catch (error) {
    return fail(translateFsError(error, 'those folders'))
  }
})

ipcMain.handle('filing:undo', async (event) => {
  const record = undoByWindow.get(event.sender.id)
  if (!record) return fail('There is nothing to put back.')
  try {
    const result = await undoFiling(diskOps, record)
    undoByWindow.delete(event.sender.id)
    return { ok: true as const, result }
  } catch (error) {
    return fail(translateFsError(error, 'those files'))
  }
})

ipcMain.handle('siblings:find', async (_e, folders: string[], noteId: string, selfPaths: string[]) => {
  try {
    return ok({ paths: await findSiblings(folders, noteId, selfPaths) })
  } catch {
    return ok({ paths: [] as string[] })
  }
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
  const folders = settings.members.filter((m: { kind: string }) => m.kind === 'folder').length
  const agents = settings.members.length - folders
  const report = [
    `MarkiMarkdown ${app.getVersion()}`,
    `Electron ${process.versions.electron}, Node ${process.versions.node}`,
    `${process.platform} ${process.arch}`,
    `Folders: ${folders}, Agents: ${agents}`,
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
