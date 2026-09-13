export type MemberKind = 'agent' | 'artifact'

/** A folder in the roster. Agents do work; artifacts hold what the work produces. */
export interface Member {
  id: string
  kind: MemberKind
  name: string
  emoji: string
  /** Absolute folder path. Empty only for agents migrated from 1.0 settings. */
  path: string
}

/** A named group of agents and artifacts that files into one raw folder. */
export interface Bunch {
  id: string
  name: string
  emoji: string
  /** Absolute path of the raw folder this bunch files into. Empty until chosen. */
  rawPath: string
  agentIds: string[]
  artifactIds: string[]
}

/** One filing, recorded in the app's own ledger. Feeds the team board counts. */
export interface LedgerEntry {
  noteId: string
  bunchId: string
  agentIds: string[]
  artifactIds: string[]
  /** ISO 8601 with offset. */
  filedAt: string
}

export interface Settings {
  members: Member[]
  bunches: Bunch[]
  /** Pre-fills the raw folder when a bunch is created. Empty means none. */
  defaultRawPath?: string
  autosave: boolean
  frontMatterPreset: 'okf' | 'basic'
  /** Also write agent/<name> and artifact/<name> tags, for Obsidian users. */
  mirrorMembersAsTags: boolean
  aiProvider: 'auto' | 'claude' | 'ollama' | 'apiKey' | 'none'
  aiClaudePath?: string
  ollamaModel?: string
  disableHardwareAcceleration: boolean
  seenCoachmark: boolean
  confirmedFileMoves: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  members: [],
  bunches: [],
  autosave: true,
  frontMatterPreset: 'okf',
  mirrorMembersAsTags: true,
  aiProvider: 'auto',
  disableHardwareAcceleration: false,
  seenCoachmark: false,
  confirmedFileMoves: false
}

/** Result of reading a file from disk. */
export interface LoadedFile {
  path: string
  text: string
  eol: '\n' | '\r\n'
  hadBom: boolean
  encoding: 'utf-8' | 'utf-16le' | 'windows-1252'
  mtimeMs: number
}

export interface AiProviderStatus {
  available: boolean
  kind: 'claude' | 'ollama' | 'apiKey' | 'none'
  detail: string
}

export interface DiagnosticsReport {
  appVersion: string
  electron: string
  platform: string
  arch: string
  ai: AiProviderStatus
  memberCount: { agents: number; artifacts: number; bunches: number }
  recentLog: string[]
}
