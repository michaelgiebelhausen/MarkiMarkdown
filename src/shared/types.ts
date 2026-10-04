export type MemberKind = 'skill' | 'domain'

/** A folder in the roster. Skills do a kind of work; domains gather everything about one subject. */
export interface Member {
  id: string
  kind: MemberKind
  name: string
  emoji: string
  /** Absolute folder path. Empty only for members migrated from 1.0 settings. */
  path: string
}

/** A saved preset: some skills and domains, plus the raw folder their archive copies go to. */
export interface Bunch {
  id: string
  name: string
  emoji: string
  /** Absolute path of the raw folder this bunch archives into. Empty until chosen. */
  rawPath: string
  skillIds: string[]
  domainIds: string[]
}

/** One archive copy, recorded in the app's own ledger. Feeds the grid counts. */
export interface LedgerEntry {
  noteId: string
  /** The bunch that was active when the note was archived, or empty. */
  bunchId: string
  skillIds: string[]
  domainIds: string[]
  /** ISO 8601 with offset. */
  archivedAt: string
}

/** Which of the three panes are ticked in the pane selector. */
export interface PaneSet {
  bunch: boolean
  raw: boolean
  rendered: boolean
}

export interface Settings {
  /** 3 from MarkiMarkdown 1.2 on. Older files are migrated on read. */
  schemaVersion: number
  members: Member[]
  bunches: Bunch[]
  /** Fills the raw folder when no bunch is active. Empty means none. */
  defaultRawPath?: string
  autosave: boolean
  frontMatterPreset: 'okf' | 'basic'
  /** Also write skill/<name> and domain/<name> tags, for Obsidian users. */
  mirrorTicksAsTags: boolean
  aiProvider: 'auto' | 'claude' | 'ollama' | 'apiKey' | 'none'
  aiClaudePath?: string
  ollamaModel?: string
  disableHardwareAcceleration: boolean
  /** The first-run welcome note has been offered. */
  seenWelcome: boolean
  confirmedFileMoves: boolean
  panes: PaneSet
  /** Relative widths of the Funky Bunch, Raw and Rendered panes, in that order. */
  paneWidths: [number, number, number]
  /** The raw pane shows the YAML folded to one summary line. */
  yamlFolded: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 3,
  members: [],
  bunches: [],
  autosave: true,
  frontMatterPreset: 'okf',
  mirrorTicksAsTags: true,
  aiProvider: 'auto',
  disableHardwareAcceleration: false,
  seenWelcome: false,
  confirmedFileMoves: false,
  panes: { bunch: true, raw: true, rendered: true },
  paneWidths: [0.34, 0.33, 0.33],
  yamlFolded: true
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
