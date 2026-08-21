import { Menu, app, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'

type GetWindow = () => BrowserWindow | null

function send(getWindow: GetWindow, action: string): void {
  getWindow()?.webContents.send('menu:action', action)
}

export function buildMenu(getWindow: GetWindow, newWindow: () => BrowserWindow): Menu {
  const isMac = process.platform === 'darwin'

  const template: MenuItemConstructorOptions[] = []

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings...', accelerator: 'Cmd+,', click: () => send(getWindow, 'settings') },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    })
  }

  template.push({
    label: 'File',
    submenu: [
      { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => newWindow() },
      { label: 'Open...', accelerator: 'CmdOrCtrl+O', click: () => send(getWindow, 'open') },
      { type: 'separator' },
      { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send(getWindow, 'save') },
      { label: 'Save As...', accelerator: 'CmdOrCtrl+Shift+S', click: () => send(getWindow, 'save-as') },
      { type: 'separator' },
      { label: 'File to...', accelerator: 'CmdOrCtrl+Shift+F', click: () => send(getWindow, 'file-to') },
      { label: 'Show in Folder', click: () => send(getWindow, 'show-in-folder') },
      { type: 'separator' },
      ...(isMac
        ? [{ role: 'close' as const }]
        : [
            { label: 'Settings...', accelerator: 'Ctrl+,', click: () => send(getWindow, 'settings') },
            { type: 'separator' as const },
            { role: 'quit' as const }
          ])
    ]
  })

  template.push({
    label: 'Edit',
    submenu: [
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send(getWindow, 'undo') },
      { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => send(getWindow, 'redo') },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { label: 'Paste as Plain Text', accelerator: 'CmdOrCtrl+Shift+V', click: () => send(getWindow, 'paste-plain') },
      { role: 'selectAll' }
    ]
  })

  template.push({
    label: 'Format',
    submenu: [
      { label: 'Bold', accelerator: 'CmdOrCtrl+B', click: () => send(getWindow, 'bold') },
      { label: 'Italic', accelerator: 'CmdOrCtrl+I', click: () => send(getWindow, 'italic') },
      { label: 'Link', accelerator: 'CmdOrCtrl+K', click: () => send(getWindow, 'link') },
      { type: 'separator' },
      { label: 'Add Properties', click: () => send(getWindow, 'add-properties') },
      { label: 'Tidy Formatting', click: () => send(getWindow, 'tidy') },
      { label: 'Clean Up with AI', click: () => send(getWindow, 'ai-clean') },
      { label: 'Convert to Markdown', click: () => send(getWindow, 'convert') }
    ]
  })

  template.push({
    label: 'View',
    submenu: [
      { label: 'Code Only', accelerator: 'CmdOrCtrl+1', click: () => send(getWindow, 'view-code') },
      { label: 'Split', accelerator: 'CmdOrCtrl+2', click: () => send(getWindow, 'view-split') },
      { label: 'Text Only', accelerator: 'CmdOrCtrl+3', click: () => send(getWindow, 'view-text') },
      { type: 'separator' },
      { label: 'Jump to Other Side', accelerator: 'CmdOrCtrl+E', click: () => send(getWindow, 'jump') },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }])
    ]
  })

  template.push({
    role: 'help',
    submenu: [
      { label: 'How to Use MarkiMarkdown', click: () => send(getWindow, 'help') },
      { type: 'separator' },
      { label: 'Copy Diagnostics', click: () => send(getWindow, 'diagnostics') },
      { label: 'Open Log Folder', click: () => send(getWindow, 'logs') },
      {
        label: 'Report a Problem',
        click: () => shell.openExternal('https://github.com/markimarkdown/markimarkdown/issues/new')
      }
    ]
  })

  return Menu.buildFromTemplate(template)
}
