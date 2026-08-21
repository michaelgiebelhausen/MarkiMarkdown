/** Shared type contracts between main, preload and renderer. Types only - no behaviour. */

/** A destination folder in the Funky Bunch. */
export interface FolderMember {
  id: string
  kind: 'folder'
  name: string
  emoji: string
  path: string
  /** Front matter this folder stamps onto notes filed into it. */
  stamp?: { tags?: string[]; type?: string }
}

/** An AI agent in the Funky Bunch. Carries the folders it is allowed to read. */
export interface AgentMember {
  id: string
  kind: 'agent'
  name: string
  emoji: string
  /** ids of FolderMember entries this agent reads. May be empty (tag-only agent). */
  folderIds: string[]
  stamp?: { tags?: string[] }
}

export type Member = FolderMember | AgentMember

export interface Settings {
  members: Member[]
  autosave: boolean
  frontMatterPreset: 'okf' | 'basic'
  /** Also write agents as `agent/<name>` entries in tags, for Obsidian users. */
  mirrorAgentsAsTags: boolean
  aiProvider: 'auto' | 'claude' | 'ollama' | 'apiKey' | 'none'
  aiClaudePath?: string
  ollamaModel?: string
  disableHardwareAcceleration: boolean
  seenCoachmark: boolean
  confirmedFileMoves: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  members: [],
  autosave: true,
  frontMatterPreset: 'okf',
  mirrorAgentsAsTags: false,
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

/** One destination in a filing run. */
export interface FilingTarget {
  folderId: string
  folderPath: string
  folderName: string
  /** Absolute path the note should be written to inside folderPath. */
  destPath: string
}

export interface FilingRequest {
  /** Fully stamped file content, identical for every destination. */
  content: string
  /** Paths the note currently occupies (rewritten in place). */
  currentPaths: string[]
  /** New destinations to write. */
  newTargets: FilingTarget[]
  /** Copies to send to the trash because the student un-selected the folder. */
  removeTargets: { folderPath: string; folderName: string; path: string }[]
  /** The pre-filing original (e.g. in Downloads) to trash if outside every selected folder. */
  originalPath?: string
  noteId: string
  fileName: string
  agentNames: string[]
  /** Names of every folder the note ends up in, for the log line. */
  allFolderNames: string[]
}

export interface FilingResult {
  ok: boolean
  written: { path: string; hash: string }[]
  trashed: string[]
  /** Per-destination failures, reported by folder name. */
  failures: { folderName: string; message: string }[]
  undoToken?: string
}

/** A conflict discovered during preflight, resolved before anything is written. */
export interface FilingConflict {
  folderName: string
  destPath: string
  /** true when the existing file carries the same note id (an older copy of this note). */
  sameId: boolean
}

export type ConflictChoice = 'replace' | 'keepBoth' | 'cancel'

export interface PreflightResult {
  ok: boolean
  conflicts: FilingConflict[]
  /** Folders that cannot be written to at all (missing, read-only, unmounted). */
  unavailable: { folderName: string; message: string }[]
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
  memberCount: { folders: number; agents: number }
  recentLog: string[]
}
