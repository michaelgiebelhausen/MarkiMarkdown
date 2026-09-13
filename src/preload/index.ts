import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { FilingPlan, FilingOutcome, PreflightOutcome, UndoOutcome } from '../main/ipc/filing'
import type { AiProviderStatus, LedgerEntry, LoadedFile, MemberKind, Settings } from '../shared/types'

type Ok<T> = { ok: true } & T
type Err = { ok: false; message: string }
type Result<T> = Ok<T> | Err

const api = {
  settings: {
    read: (): Promise<Settings & { hasApiKey: boolean }> => ipcRenderer.invoke('settings:read'),
    write: (patch: Partial<Settings>): Promise<Result<{ settings: Settings }>> =>
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
    pathFor: (file: File): string => {
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return ''
      }
    }
  },
  filing: {
    preflight: (plan: FilingPlan): Promise<Result<{ result: PreflightOutcome }>> =>
      ipcRenderer.invoke('filing:preflight', plan),
    run: (plan: FilingPlan): Promise<Result<{ outcome: FilingOutcome }>> =>
      ipcRenderer.invoke('filing:run', plan),
    undo: (): Promise<Result<{ result: UndoOutcome }>> => ipcRenderer.invoke('filing:undo')
  },
  ledger: {
    read: (): Promise<Result<{ entries: LedgerEntry[] }>> => ipcRenderer.invoke('ledger:read'),
    append: (entry: LedgerEntry): Promise<Result<{ entries: LedgerEntry[] }>> =>
      ipcRenderer.invoke('ledger:append', entry)
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
    create: (): Promise<Result<object>> => ipcRenderer.invoke('window:new')
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
