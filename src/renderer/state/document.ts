import { splitFrontMatter } from '@shared/markdown/frontmatter'
import { baseName } from '@shared/paths'
import type { LoadedFile } from '@shared/types'

export type Owner = 'code' | 'rendered' | 'panel' | null

export interface DocState {
  frontMatterRaw: string | null
  body: string
  eol: '\n' | '\r\n'
  hadBom: boolean
  /** Every place this note currently lives. Empty means it has never been saved. */
  paths: string[]
  /** Where the note was opened from, while it still sits outside the second brain. */
  originalPath?: string
  fileName: string
  dirty: boolean
  owner: Owner
  /** Opened from a .txt file, so we can offer to convert it. */
  isPlainText: boolean
  /** Folders holding another copy of the same note id. */
  siblingPaths: string[]
  /** Bumped whenever the body changes, so panes can tell a real change from an echo. */
  version: number
}

interface Snapshot extends DocState {
  fullText: string
}

const EMPTY: DocState = {
  frontMatterRaw: null,
  body: '',
  eol: '\n',
  hadBom: false,
  paths: [],
  fileName: 'Untitled.md',
  dirty: false,
  owner: null,
  isPlainText: false,
  siblingPaths: [],
  version: 0
}

function asMarkdownName(name: string): string {
  return name.replace(/\.(txt|text)$/i, '.md')
}

/**
 * The one place the document lives. Both panes read from here and write back through
 * it, so they can never disagree, and a single undo stack covers the whole note.
 */
export class DocumentStore {
  state: DocState = { ...EMPTY }

  private listeners = new Set<() => void>()
  private snapshot: Snapshot = { ...EMPTY, fullText: '' }
  private past: DocState[] = []
  private future: DocState[] = []
  private pending: DocState | null = null
  private savedText = ''

  constructor() {
    this.refreshSnapshot()
  }

  /* ---------------- subscription ---------------- */

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): Snapshot => this.snapshot

  private refreshSnapshot(): void {
    this.snapshot = { ...this.state, fullText: this.fullText() }
  }

  private emit(): void {
    this.refreshSnapshot()
    for (const listener of this.listeners) listener()
  }

  /* ---------------- reading ---------------- */

  fullText(): string {
    return (this.state.frontMatterRaw ?? '') + this.state.body
  }

  needsFileName(): boolean {
    return this.state.paths.length === 0 || this.state.isPlainText
  }

  canUndo(): boolean {
    return this.past.length > 0
  }

  canRedo(): boolean {
    return this.future.length > 0
  }

  /* ---------------- loading ---------------- */

  load(file: LoadedFile): void {
    const split = splitFrontMatter(file.text)
    const isPlainText = /\.(txt|text)$/i.test(file.path)
    this.state = {
      frontMatterRaw: split.raw,
      body: split.body,
      eol: file.eol,
      hadBom: file.hadBom,
      paths: isPlainText ? [] : [file.path],
      originalPath: file.path,
      fileName: asMarkdownName(baseName(file.path) || 'Untitled.md'),
      dirty: false,
      owner: null,
      isPlainText,
      siblingPaths: [],
      version: this.state.version + 1
    }
    this.past = []
    this.future = []
    this.pending = null
    this.savedText = file.text
    this.emit()
  }

  /** A brand new empty note. */
  reset(): void {
    this.state = { ...EMPTY, version: this.state.version + 1 }
    this.past = []
    this.future = []
    this.pending = null
    this.savedText = ''
    this.emit()
  }

  /* ---------------- editing ---------------- */

  setOwner(owner: Owner): void {
    if (this.state.owner === owner) return
    this.commitUndoGroup()
    this.state = { ...this.state, owner }
    this.emit()
  }

  private mayWrite(source: Owner): boolean {
    return this.state.owner === null || source === null || this.state.owner === source
  }

  private applyChange(next: Partial<DocState>, source: Owner): void {
    if (!this.mayWrite(source)) return
    const candidate = { ...this.state, ...next }
    if (candidate.frontMatterRaw === this.state.frontMatterRaw && candidate.body === this.state.body) {
      return
    }
    if (this.pending === null) this.pending = this.state
    this.future = []
    this.state = {
      ...candidate,
      version: this.state.version + 1,
      dirty: (candidate.frontMatterRaw ?? '') + candidate.body !== this.savedText
    }
    this.emit()
  }

  /** Called from the code pane, which shows front matter and body together. */
  setFullText(text: string, source: Owner): void {
    const split = splitFrontMatter(text)
    this.applyChange({ frontMatterRaw: split.raw, body: split.body }, source)
  }

  /** Called from the rendered pane, which only ever sees the body. */
  setBody(body: string, source: Owner): void {
    this.applyChange({ body }, source)
  }

  /** Called from the properties panel. */
  setFrontMatter(raw: string | null, source: Owner): void {
    this.applyChange({ frontMatterRaw: raw }, source)
  }

  setFileName(name: string): void {
    this.state = { ...this.state, fileName: asMarkdownName(name) }
    this.emit()
  }

  setSiblings(paths: string[]): void {
    this.state = { ...this.state, siblingPaths: paths }
    this.emit()
  }

  clearPlainText(): void {
    this.state = { ...this.state, isPlainText: false }
    this.emit()
  }

  /* ---------------- undo ---------------- */

  /** Closes the current burst of typing so the next undo stops here. */
  commitUndoGroup(): void {
    if (this.pending === null) return
    this.past.push(this.pending)
    this.pending = null
    if (this.past.length > 200) this.past.shift()
  }

  undo(): void {
    this.commitUndoGroup()
    const previous = this.past.pop()
    if (!previous) return
    this.future.push(this.state)
    this.state = {
      ...previous,
      owner: this.state.owner,
      version: this.state.version + 1,
      dirty: (previous.frontMatterRaw ?? '') + previous.body !== this.savedText
    }
    this.emit()
  }

  redo(): void {
    const next = this.future.pop()
    if (!next) return
    this.past.push(this.state)
    this.state = {
      ...next,
      owner: this.state.owner,
      version: this.state.version + 1,
      dirty: (next.frontMatterRaw ?? '') + next.body !== this.savedText
    }
    this.emit()
  }

  /* ---------------- saving ---------------- */

  markSaved(): void {
    this.savedText = this.fullText()
    this.state = { ...this.state, dirty: false }
    this.emit()
  }

  /**
   * Filing writes a stamped copy (id, agents, filed) to disk. The editor has to take
   * that same text on, or the next autosave would write the unstamped version back
   * over it and the note would quietly lose the very details agents look for.
   */
  afterFiling(paths: string[], stampedText?: string): void {
    const split = stampedText === undefined ? null : splitFrontMatter(stampedText)
    this.state = {
      ...this.state,
      frontMatterRaw: split ? split.raw : this.state.frontMatterRaw,
      body: split ? split.body : this.state.body,
      paths,
      originalPath: undefined,
      isPlainText: false,
      dirty: false,
      version: this.state.version + 1
    }
    this.savedText = this.fullText()
    this.emit()
  }

  /**
   * Undoing a filing can remove the only copy this note ever had on disk (a note
   * that was never saved anywhere before it was filed). The text on screen does not
   * change, but it no longer has a home, so Save has to ask for one again.
   */
  unfile(): void {
    this.state = { ...this.state, paths: [], originalPath: undefined }
    this.emit()
  }
}
