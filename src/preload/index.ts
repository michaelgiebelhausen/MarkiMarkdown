import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AiProviderStatus, LedgerEntry, LoadedFile, MemberKind, Settings } from '../shared/types'

type Ok<T> = { ok: true } & T
type Err = { ok: false; message: string }
type Result<T> = Ok<T> | Err

const api = {
  settings: {
    /** `persisting` is false when nothing will be saved to disk this session. */
    read: (): Promise<Settings & { hasApiKey: boolean; persisting: boolean }> => ipcRenderer.invoke('settings:read'),
    /** `persisted` is false when the change is only kept in memory for this session. */
    write: (patch: Partial<Settings>): Promise<Result<{ settings: Settings; persisted: boolean }>> =>
      ipcRenderer.invoke('settings:write', patch),
    saveApiKey: (key: string): Promise<Result<{ saved: boolean }>> =>
      ipcRenderer.invoke('settings:save-api-key', key)
  },
  files: {
    openDialog: (): Promise<Result<{ file: LoadedFile }>> => ipcRenderer.invoke('file:open-dialog'),
    read: (path: string): Promise<Result<{ file: LoadedFile }>> => ipcRenderer.invoke('file:read', path),
    saveAll: (
      paths: string[],
      content: string
    ): Promise<{ ok: boolean; failures: { path: string; message: string }[] }> =>
      ipcRenderer.invoke('file:save-all', paths, content),
    saveAs: (name: string, content: string): Promise<Result<{ path: string }>> =>
      ipcRenderer.invoke('file:save-as', name, content),
    writeNew: (dir: string, fileName: string, content: string): Promise<Result<{ path: string }>> =>
      ipcRenderer.invoke('file:write-new', dir, fileName, content),
    move: (from: string, toDir: string): Promise<Result<{ path: string; notice?: string }>> =>
      ipcRenderer.invoke('file:move', from, toDir),
    pathFor: (file: File): string => {
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return ''
      }
    }
  },
  ledger: {
    read: (): Promise<Result<{ entries: LedgerEntry[] }>> => ipcRenderer.invoke('ledger:read'),
    append: (entry: LedgerEntry): Promise<Result<{ entries: LedgerEntry[]; saved: boolean }>> =>
      ipcRenderer.invoke('ledger:append', entry)
  },
  archive: {
    write: (rawDir: string, fileName: string, date: string, content: string): Promise<Result<{ path: string }>> =>
      ipcRenderer.invoke('archive:write', rawDir, fileName, date, content)
  },
  members: {
    proposeKind: (path: string): Promise<Result<{ kind: MemberKind }>> =>
      ipcRenderer.invoke('members:propose-kind', path),
    missingPaths: (paths: string[]): Promise<Result<{ missing: string[] }>> =>
      ipcRenderer.invoke('members:missing-paths', paths)
  },
  dialogs: {
    pickFolder: (): Promise<Result<{ path: string }>> => ipcRenderer.invoke('dialog:pick-folder'),
    createDefaultFolder: (): Promise<Result<{ path: string }>> =>
      ipcRenderer.invoke('dialog:create-default-folder'),
    confirm: (options: {
      message: string
      detail?: string
      buttons: string[]
      danger?: boolean
    }): Promise<Result<{ index: number }>> => ipcRenderer.invoke('dialog:confirm', options)
  },
  ai: {
    detect: (): Promise<Result<{ status: AiProviderStatus }>> => ipcRenderer.invoke('ai:detect'),
    run: (prompt: string, text: string): Promise<Result<{ text: string }>> =>
      ipcRenderer.invoke('ai:run', prompt, text)
  },
  shell: {
    showItem: (path: string): Promise<Result<object>> => ipcRenderer.invoke('shell:show-item', path),
    openExternal: (url: string): Promise<Result<object>> => ipcRenderer.invoke('shell:open-external', url)
  },
  support: {
    diagnostics: (): Promise<Result<{ report: string }>> => ipcRenderer.invoke('diagnostics:copy'),
    openLogs: (): Promise<Result<object>> => ipcRenderer.invoke('log:open-folder')
  },
  windows: {
    create: (): Promise<Result<object>> => ipcRenderer.invoke('window:new'),
    /** Whether this window's note has unsaved changes, and its name, so closing can ask first. */
    setDirty: (dirty: boolean, name: string): void => ipcRenderer.send('window:set-dirty', dirty, name),
    /** The note was saved after the student chose Save on closing: close for real now. */
    closeNow: (): void => ipcRenderer.send('window:close-now')
  },
  clipboard: {
    readText: (): Promise<Result<{ text: string }>> => ipcRenderer.invoke('clipboard:read-text')
  },
  on: {
    menuAction: (handler: (action: string) => void) => {
      const listener = (_e: unknown, action: string) => handler(action)
      ipcRenderer.on('menu:action', listener)
      return () => {
        ipcRenderer.removeListener('menu:action', listener)
      }
    },
    openPath: (handler: (path: string) => void) => {
      const listener = (_e: unknown, path: string) => handler(path)
      ipcRenderer.on('file:open-path', listener)
      return () => {
        ipcRenderer.removeListener('file:open-path', listener)
      }
    },
    appError: (handler: (payload: { message: string; detail: string }) => void) => {
      const listener = (_e: unknown, payload: { message: string; detail: string }) => handler(payload)
      ipcRenderer.on('app:error', listener)
      return () => {
        ipcRenderer.removeListener('app:error', listener)
      }
    }
  }
}

export type MarkiApi = typeof api

contextBridge.exposeInMainWorld('marki', api)
