import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DocumentStore } from './document'
import type { Bunch, LedgerEntry, Member } from '@shared/types'
import { namedCount, readTicks, type TickReading } from '@shared/ticks'
import { BLOCK_REASONS, planSave, type SavePlan } from '@shared/archive'
import { ulid } from 'ulid'
import { addArchived, mergeFrontMatter, parseFrontMatter, splitFrontMatter } from '@shared/markdown/frontmatter'
import { baseName, dirName, samePath } from '@shared/paths'
import { localDate, nowLocalIso } from '@shared/time'
import { noteIdOf } from '@shared/ledger'
import type { ToastMessage } from '@renderer/ui/Toast'
import { suggestName } from './naming'

export interface SaveFlowInput {
  store: DocumentStore
  paths: string[]
  originalPath?: string
  ticks: TickReading
  /** The roster, so a save reads its ticks from exactly the text it writes. */
  members: Member[]
  activeBunch: Bunch | null
  defaultRawPath: string
  confirmedFileMoves: boolean
  onConfirmedFileMoves: () => void
  /** The ledger after a successful, saved append. */
  onLedger: (entries: LedgerEntry[]) => void
  /** The append failed or was not saved to disk: keep the counts on screen and say so. */
  onLedgerNotSaved: () => void
  pushToast: (toast: Omit<ToastMessage, 'id'>) => void
}

/** What became of the archive copy a save was asked to make. */
export type ArchiveOutcome = 'not-wanted' | 'done' | 'failed'

/** What one save did, for a caller that acts on it (Save first, before opening another note or closing). */
export interface SaveOutcome {
  /** The working file now holds the text this save read. */
  written: boolean
  /** The note that was saved is still the one open. */
  stillOpen: boolean
  /**
   * Whether the archive box was ticked and the copy and its ledger entry were made.
   * 'not-wanted' when nothing was written, since no archive step ran.
   */
  archived: ArchiveOutcome
  /** Why the archive step didn't finish, when it failed. */
  reason?: string
}

export interface SaveFlow {
  /** Folder of the working file, or the folder chosen for an untitled note, or empty. */
  workingDir: string
  rawPath: string
  rawMissing: boolean
  archive: boolean
  setArchive: (value: boolean) => void
  plan: SavePlan
  /** The next Save will also archive. */
  willArchive: boolean
  /** A save, a move or a folder choice is under way: Save and both folder buttons wait for it. */
  busy: boolean
  /**
   * Goes up each time a save, a move, a folder choice or an autosave that wrote something
   * finishes, so an autosave that was held back (or text typed during one) gets its turn.
   */
  settled: number
  chooseWorkingFolder: () => Promise<void>
  chooseRawFolder: () => Promise<void>
  /**
   * Save, Ctrl+S and the Save button. Pressed while another save or a move is running, it
   * queues one more save that runs once that job has finished, as long as the same note
   * is still open then.
   */
  save: () => Promise<void>
  /**
   * Waits for whatever is running, then saves, and says what the save did (for "Save first"
   * before an open or a close). It went through when `written` and `stillOpen` are both true.
   */
  saveAndWait: () => Promise<SaveOutcome>
  /** Save As: a new file the student names. Shares the same guard, and queues like Save. */
  saveAs: () => Promise<void>
  /** The quiet autosave. Shares the one-at-a-time guard, so it never races a save or a move. */
  autosave: () => Promise<void>
  /** A different note was opened: forget the folder choice, untick the box. */
  reset: () => void
}

const SAVE_FAILED = "The note couldn't be saved."
const MOVE_FAILED = "The note couldn't be moved."
const RAW_FAILED = "The raw folder couldn't be changed."
const SAVE_STOPPED = 'Another note was opened, so this save stopped. Save again.'
const MOVE_STOPPED = 'Another note was opened, so the note was not moved. Choose the folder again.'
const RAW_STOPPED = 'Another note was opened, so the raw folder was not changed.'
const LEDGER_NOT_SAVED = "The archive copy was made, but the archive counts couldn't be updated."
const SOMETHING_WRONG = 'something went wrong.'
/** The write went through, but by then the student had opened a different note. */
const savedElsewhere = (name: string) => `Saved ${name}. Another note is open now.`

/** A file-system message ends with a full stop; this sits inside a longer sentence. */
const clause = (message: string) => message.trim().replace(/\.$/, '')

type Job = 'user' | 'auto'

/** How far one save got, so a failure part-way can still say what was done. */
interface SaveProgress {
  written: boolean
  archiving: boolean
  generation: number
}

/** A Save or Save As pressed while another job ran, and the note (by load generation) it was pressed on. */
interface FollowUp {
  kind: 'save' | 'save-as'
  generation: number
}

export function useSaveFlow(input: SaveFlowInput): SaveFlow {
  const { store, paths, originalPath, ticks, members, activeBunch, defaultRawPath, pushToast } = input
  const [archive, setArchive] = useState(false)
  const [pendingDir, setPendingDir] = useState('')
  const [rawOverride, setRawOverride] = useState<string | null>(null)
  const [rawMissing, setRawMissing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [settled, setSettled] = useState(0)
  const running = useRef<{ job: Job; done: Promise<void> } | null>(null)
  /**
   * Save or Save As pressed while another job ran: each runs once that job finishes, at most
   * once per kind and note, and only while the note it was pressed on is still open.
   */
  const followUps = useRef<FollowUp[]>([])
  const [followUpTurn, setFollowUpTurn] = useState(0)
  /** The note (by load generation) whose failed autosave was already reported. */
  const autosaveWarned = useRef<number | null>(null)

  // A different bunch brings its own raw folder.
  useEffect(() => setRawOverride(null), [activeBunch?.id])

  const workingDir = paths[0] ? dirName(paths[0]) : pendingDir || (originalPath ? dirName(originalPath) : '')
  const rawPath = rawOverride ?? (activeBunch?.rawPath || defaultRawPath || '')

  // Is the raw folder there? Checked when it changes and whenever the window regains focus.
  useEffect(() => {
    if (rawPath.length === 0) {
      setRawMissing(false)
      return
    }
    let cancelled = false
    const check = () => {
      void window.marki.members.missingPaths([rawPath]).then((result) => {
        if (!cancelled && result.ok) setRawMissing(result.missing.length > 0)
      })
    }
    check()
    window.addEventListener('focus', check)
    return () => {
      cancelled = true
      window.removeEventListener('focus', check)
    }
  }, [rawPath])

  const tickCount = namedCount(ticks)
  const plan = useMemo(
    () => planSave({ yamlOk: ticks.ok, rawPath, rawMissing, tickCount, workingDir }),
    [ticks.ok, rawPath, rawMissing, tickCount, workingDir]
  )

  /**
   * One save, move, folder choice or autosave at a time. A move must never run while a
   * save is writing the same file, and a double click must not start a second save over
   * the first. A click that lands while a quiet autosave is writing waits for it, then
   * goes ahead; anything else that lands while a click's job runs is dropped (the buttons
   * are disabled meanwhile, and that job is already doing the work), except Save and
   * Save As, which call `whenBusy` to queue themselves.
   */
  const exclusive = async (job: Job, body: () => Promise<boolean | void>, whenBusy?: () => void): Promise<void> => {
    if (job === 'user' && running.current?.job === 'auto') await running.current.done
    if (running.current) {
      whenBusy?.()
      return
    }
    let finish = () => {}
    const done = new Promise<void>((resolve) => (finish = resolve))
    running.current = { job, done }
    if (job === 'user') setBusy(true)
    let wrote: boolean | void = true
    try {
      wrote = await body()
    } finally {
      running.current = null
      finish()
      if (job === 'user') setBusy(false)
      // A failed autosave waits for the next keystroke rather than retrying every pause.
      if (job === 'user' || wrote === true) setSettled((n) => n + 1)
      // Run a queued save from the next render, so it sees everything this job changed.
      if (followUps.current.length > 0) setFollowUpTurn((n) => n + 1)
    }
  }

  /** True while the note that was open when `generation` was read is still the one open. */
  const sameNote = (generation: number) => store.loadGeneration === generation

  /** Writes an id into the front matter when it has none (and can be read). */
  const addMissingId = () => {
    const raw = store.state.frontMatterRaw
    if (raw === null) return
    const front = parseFrontMatter(raw)
    if (!front.ok) return
    const id = front.data.id
    if (id !== null && id !== undefined && String(id).trim().length > 0) return
    store.commitUndoGroup()
    store.setFrontMatter(mergeFrontMatter(raw, { id: ulid() }, store.state.eol), null)
    store.commitUndoGroup()
  }

  /** A save went through: a later failed autosave of this note is worth reporting again. */
  const savedOk = () => {
    autosaveWarned.current = null
  }

  /**
   * Says whether the working file now holds the text, whether the note is still the one
   * open, and what became of the archive copy. Once the write has gone through, the archive
   * copy and the ledger still follow even if another note was opened meanwhile (neither
   * touches the store); only the store is left alone then.
   */
  const runSave = async (progress: SaveProgress): Promise<SaveOutcome> => {
    // Decided once, at the click: the text written to the working file and copied to the
    // archive, the ticks the ledger records, and whether to archive at all. Typing during
    // the save, or unticking the box, counts for the next save, not this one.
    const generation = store.loadGeneration
    const archiving = archive
    progress.generation = generation
    progress.archiving = archiving
    const notWritten = (): SaveOutcome => ({ written: false, stillOpen: sameNote(generation), archived: 'not-wanted' })
    // An archived note needs an id, so the copy and the ledger can be traced back to it.
    // A 1.1 note or a hand-typed one may have none: give it one now, as its own undo step,
    // so the working file and the copy both carry it.
    if (archiving && plan.canArchive) addMissingId()
    const text = store.fullText()
    const split = splitFrontMatter(text)
    const reading = readTicks(split.raw, members)
    const fileName = store.state.fileName

    // 1. the working version. A failed write says why; a different note opened before
    // anything was written stops the save; one opened after it was written does not.
    let path = store.state.paths[0]
    if (!path) {
      // Opened from a .txt (or .text) file: the Markdown version is a new file named after
      // it, and the original is never touched. An untitled note is named from its heading.
      const source = store.state.originalPath
      let dir = workingDir
      if (!dir) {
        const picked = await window.marki.dialogs.pickFolder()
        if (!picked.ok) return notWritten()
        if (!sameNote(generation)) {
          pushToast({ text: SAVE_STOPPED, tone: 'warn' })
          return notWritten()
        }
        dir = picked.path
        setPendingDir(dir)
      }
      const name = source ? fileName : suggestName(split.body, fileName)
      const written = await window.marki.files.writeNew(dir, name, text)
      if (!written.ok) {
        pushToast({ text: written.message, tone: 'warn' })
        return notWritten()
      }
      path = written.path
      const savedPath = written.path
      if (!sameNote(generation)) {
        pushToast({ text: savedElsewhere(baseName(savedPath)), actionLabel: 'Show', onAction: () => void window.marki.shell.showItem(savedPath) })
      } else {
        store.afterFiling([savedPath], { written: text })
        store.setFileName(baseName(savedPath) || fileName)
        const folder = baseName(dir) || dir
        if (source) {
          const sourceName = baseName(source)
          const where = samePath(dirName(savedPath), dirName(source)) ? `next to ${sourceName}` : `in ${folder}`
          const ext = /\.[^.]+$/.exec(sourceName)?.[0] ?? ''
          pushToast({
            text: `Saved as ${baseName(savedPath)} ${where}. The ${ext || 'original'} file is unchanged.`,
            actionLabel: 'Show',
            onAction: () => void window.marki.shell.showItem(savedPath)
          })
        } else {
          pushToast({ text: `Saved to ${folder}.` })
        }
      }
    } else {
      const saved = await window.marki.files.saveAll([path], text)
      if (!saved.ok) {
        pushToast({ text: saved.failures[0]?.message ?? SAVE_FAILED, tone: 'warn' })
        return notWritten()
      }
      if (sameNote(generation)) store.markSaved(text)
      else pushToast({ text: savedElsewhere(baseName(path) || fileName) })
    }
    progress.written = true
    savedOk()
    const stillOpen = sameNote(generation)
    if (!archiving) return { written: true, stillOpen, archived: 'not-wanted' }
    const notArchived = (reason: string): SaveOutcome => ({ written: true, stillOpen, archived: 'failed', reason })

    // 2. the archive copy, checked again against where the note now lives
    const now = planSave({
      yamlOk: reading.ok,
      rawPath,
      rawMissing,
      tickCount: namedCount(reading),
      workingDir: dirName(path)
    })
    if (!now.canArchive) {
      pushToast({ text: `Saved, but not archived: ${now.reason}`, tone: 'warn' })
      return notArchived(now.reason)
    }
    // One moment for the file name, the archived: stamp and the ledger, so a save at
    // midnight can't name the copy one day and stamp it the next.
    const at = new Date()
    const archivedAt = nowLocalIso(at)
    const copyText = addArchived(text, archivedAt)
    if (copyText === null) {
      pushToast({ text: `Saved, but not archived: ${BLOCK_REASONS.yaml}`, tone: 'warn' })
      return notArchived(BLOCK_REASONS.yaml)
    }
    const copyName = baseName(path) || fileName
    const copy = await window.marki.archive.write(rawPath, copyName, localDate(at), copyText)
    if (!copy.ok) {
      pushToast({ text: `Saved, but not archived: ${copy.message}`, tone: 'warn', duration: 10000 })
      return notArchived(copy.message)
    }

    // 3. the ledger, which feeds the grid counts. The copy now exists, so it is recorded
    // even if another note was opened meanwhile: nothing here reads or touches the store.
    const entry: LedgerEntry = {
      noteId: noteIdOf(split.raw),
      bunchId: activeBunch?.id ?? '',
      skillIds: reading.skillIds,
      domainIds: reading.domainIds,
      archivedAt
    }
    const appended = await window.marki.ledger.append(entry)
    // An append that was not saved may hand back an empty or stale list: keep the counts
    // already on screen rather than wiping them.
    const recorded = appended.ok && appended.saved
    if (recorded) input.onLedger(appended.entries)
    else input.onLedgerNotSaved()

    // The box belongs to whichever note is open now: only untick it for this one.
    if (sameNote(generation)) setArchive(false)
    pushToast({
      text: `Saved and archived to ${baseName(rawPath) || rawPath}.`,
      actionLabel: 'Show',
      onAction: () => void window.marki.shell.showItem(copy.path)
    })
    return recorded ? { written: true, stillOpen, archived: 'done' } : notArchived(LEDGER_NOT_SAVED)
  }

  /** Runs one save inside the guard (already held) and says what it did. */
  const guardedSave = async (): Promise<SaveOutcome> => {
    const progress: SaveProgress = { written: false, archiving: false, generation: store.loadGeneration }
    try {
      return await runSave(progress)
    } catch {
      // A rejected IPC call must never leave the student thinking the note was saved,
      // nor thinking it was lost when only the archive step failed.
      pushToast({ text: progress.written ? `Saved, but not archived: ${SOMETHING_WRONG}` : SAVE_FAILED, tone: 'warn' })
      return {
        written: progress.written,
        stillOpen: sameNote(progress.generation),
        archived: progress.written && progress.archiving ? 'failed' : 'not-wanted',
        reason: progress.written && progress.archiving ? SOMETHING_WRONG : undefined
      }
    }
  }

  /** Remembers a Save or Save As pressed while another job runs, for the note open now. */
  const queue = (kind: FollowUp['kind']) => () => {
    const generation = store.loadGeneration
    if (followUps.current.some((f) => f.kind === kind && f.generation === generation)) return
    followUps.current.push({ kind, generation })
  }

  const save = () =>
    exclusive(
      'user',
      async () => {
        await guardedSave()
      },
      // Pressed while another save or a move runs: save once more when it has finished.
      queue('save')
    )

  /**
   * Runs a queued Save or Save As, but only for the note it was pressed on: once another
   * note is open, that one was already saved or let go when it was replaced.
   */
  const runFollowUp = (next: FollowUp) =>
    exclusive(
      'user',
      async () => {
        if (!sameNote(next.generation)) return
        if (next.kind === 'save') await guardedSave()
        else await guardedSaveAs()
      },
      // Something else got the guard first: go back to the front of the line.
      () => {
        followUps.current.unshift(next)
      }
    )

  // The newest runFollowUp, for the queue to call from a fresh render.
  const runFollowUpRef = useRef(runFollowUp)
  runFollowUpRef.current = runFollowUp
  useEffect(() => {
    if (followUpTurn === 0) return
    let next = followUps.current.shift()
    while (next && !sameNote(next.generation)) next = followUps.current.shift()
    if (next) void runFollowUpRef.current(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followUpTurn])

  const saveAndWait = async (): Promise<SaveOutcome> => {
    while (running.current) await running.current.done
    let outcome: SaveOutcome = { written: false, stillOpen: false, archived: 'not-wanted' }
    await exclusive('user', async () => {
      // This save covers a Save already queued for the same note.
      const generation = store.loadGeneration
      followUps.current = followUps.current.filter((f) => f.kind !== 'save' || f.generation !== generation)
      outcome = await guardedSave()
    })
    return outcome
  }

  const runSaveAs = async () => {
    const generation = store.loadGeneration
    const text = store.fullText()
    const fileName = store.state.fileName
    const result = await window.marki.files.saveAs(fileName, text)
    if (!result.ok) {
      // Cancelling the dialog says nothing; a failed write says why.
      if (result.message) pushToast({ text: result.message, tone: 'warn' })
      return
    }
    savedOk()
    const name = baseName(result.path) || fileName
    // Only the text written counts as saved, and only the note it came from moves.
    if (!sameNote(generation)) {
      pushToast({ text: savedElsewhere(name) })
      return
    }
    store.afterFiling([result.path], { written: text })
    store.setFileName(name)
    pushToast({ text: `Saved as ${name}.` })
  }

  const guardedSaveAs = async () => {
    try {
      await runSaveAs()
    } catch {
      pushToast({ text: SAVE_FAILED, tone: 'warn' })
    }
  }

  // Pressed while another save or a move runs: Save As once that has finished.
  const saveAs = () => exclusive('user', guardedSaveAs, queue('save-as'))

  const runMove = async () => {
    const generation = store.loadGeneration
    const stopped = () => {
      if (sameNote(generation)) return false
      pushToast({ text: MOVE_STOPPED, tone: 'warn' })
      return true
    }

    const picked = await window.marki.dialogs.pickFolder()
    if (!picked.ok) return
    if (stopped()) return
    const current = store.state.paths[0]
    if (!current) {
      setPendingDir(picked.path)
      return
    }
    if (samePath(dirName(current), picked.path)) return
    if (!input.confirmedFileMoves) {
      const answer = await window.marki.dialogs.confirm({
        message: 'Move this note?',
        detail: `The working file moves to ${picked.path}. It is not copied, so it will no longer be where it is now.`,
        buttons: ['Move', 'Cancel']
      })
      if (!answer.ok || answer.index !== 0) return
      if (stopped()) return
      input.onConfirmedFileMoves()
    }
    if (store.state.dirty) {
      const text = store.fullText()
      const saved = await window.marki.files.saveAll([current], text)
      if (!saved.ok) {
        pushToast({ text: saved.failures[0]?.message ?? SAVE_FAILED, tone: 'warn' })
        return
      }
      savedOk()
      // Written, so not "stopped"; but the note open now is a different one, so don't move.
      if (!sameNote(generation)) {
        const name = baseName(current) || current
        pushToast({ text: `Saved ${name}. Another note was opened, so it was not moved. Choose the folder again.`, tone: 'warn' })
        return
      }
      store.markSaved(text)
    }
    const moved = await window.marki.files.move(current, picked.path)
    if (!moved.ok) {
      pushToast({ text: moved.message, tone: 'warn' })
      return
    }
    // The file has moved either way; only the note still open learns its new home.
    // Whatever was typed since the last save stays unsaved: the moved file doesn't have it.
    if (sameNote(generation)) {
      store.afterFiling([moved.path])
      store.setFileName(baseName(moved.path) || store.state.fileName)
    }
    pushToast(
      moved.notice
        ? { text: moved.notice, tone: 'warn' }
        : { text: `Moved to ${baseName(picked.path) || picked.path}.` }
    )
  }

  const chooseWorkingFolder = () =>
    exclusive('user', async () => {
      try {
        await runMove()
      } catch {
        pushToast({ text: MOVE_FAILED, tone: 'warn' })
      }
    })

  const chooseRawFolder = () =>
    exclusive('user', async () => {
      try {
        const generation = store.loadGeneration
        const picked = await window.marki.dialogs.pickFolder()
        if (!picked.ok) return
        if (!sameNote(generation)) {
          pushToast({ text: RAW_STOPPED, tone: 'warn' })
          return
        }
        setRawOverride(picked.path)
      } catch {
        pushToast({ text: RAW_FAILED, tone: 'warn' })
      }
    })

  const autosave = () =>
    exclusive('auto', async () => {
      const { dirty, isPlainText } = store.state
      const where = store.state.paths
      if (!dirty || where.length === 0 || isPlainText) return false
      const generation = store.loadGeneration
      const text = store.fullText()
      const fileName = baseName(where[0] ?? '') || store.state.fileName
      // Quiet when it works. When it fails, the note stays marked unsaved and the next
      // pause tries again; the student is told once per note, until a save goes through.
      const warn = (reason: string) => {
        if (!sameNote(generation) || autosaveWarned.current === generation) return
        autosaveWarned.current = generation
        pushToast({
          text: `Autosave couldn't write ${fileName}: ${clause(reason)}. Your text is still here; press Save to try again.`,
          tone: 'warn',
          duration: 10000
        })
      }
      try {
        const result = await window.marki.files.saveAll(where, text)
        if (!result.ok) {
          warn(result.failures[0]?.message ?? 'the file could not be written')
          return false
        }
        savedOk()
        if (!sameNote(generation)) return false
        store.markSaved(text)
        return true
      } catch {
        warn('the file could not be written')
        return false
      }
    })

  const reset = useCallback(() => {
    // A Save or Save As still queued belonged to the note that was replaced.
    followUps.current = []
    setPendingDir('')
    setArchive(false)
    setRawOverride(null)
  }, [])

  return {
    workingDir,
    rawPath,
    rawMissing,
    archive,
    setArchive,
    plan,
    willArchive: archive && plan.canArchive,
    busy,
    settled,
    chooseWorkingFolder,
    chooseRawFolder,
    save,
    saveAndWait,
    saveAs,
    autosave,
    reset
  }
}
