import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DocumentStore } from './document'
import type { Bunch, LedgerEntry, Member } from '@shared/types'
import { readTicks, type TickReading } from '@shared/ticks'
import { BLOCK_REASONS, planSave, type SavePlan } from '@shared/archive'
import { addArchived, parseFrontMatter, splitFrontMatter } from '@shared/markdown/frontmatter'
import { baseName, dirName, samePath } from '@shared/paths'
import { localDate, nowLocalIso } from '@shared/time'
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
  save: () => Promise<void>
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

type Job = 'user' | 'auto'

export function useSaveFlow(input: SaveFlowInput): SaveFlow {
  const { store, paths, originalPath, ticks, members, activeBunch, defaultRawPath, pushToast } = input
  const [archive, setArchive] = useState(false)
  const [pendingDir, setPendingDir] = useState('')
  const [rawOverride, setRawOverride] = useState<string | null>(null)
  const [rawMissing, setRawMissing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [settled, setSettled] = useState(0)
  const running = useRef<{ job: Job; done: Promise<void> } | null>(null)

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

  const tickCount = ticks.skillNames.length + ticks.domainNames.length
  const plan = useMemo(
    () => planSave({ yamlOk: ticks.ok, rawPath, rawMissing, tickCount, workingDir }),
    [ticks.ok, rawPath, rawMissing, tickCount, workingDir]
  )

  /**
   * One save, move, folder choice or autosave at a time. A move must never run while a
   * save is writing the same file, and a double click must not start a second save over
   * the first. A click that lands while a quiet autosave is writing waits for it, then
   * goes ahead; anything that lands while a click's job runs is dropped (the buttons are
   * disabled meanwhile, and that job is already doing the work).
   */
  const exclusive = async (job: Job, body: () => Promise<boolean | void>): Promise<void> => {
    if (job === 'user' && running.current?.job === 'auto') await running.current.done
    if (running.current) return
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
    }
  }

  /** True while the note that was open when `generation` was read is still the one open. */
  const sameNote = (generation: number) => store.loadGeneration === generation

  const runSave = async () => {
    // Decided once, at the click: the text written to the working file and copied to the
    // archive, the ticks the ledger records, and whether to archive at all. Typing during
    // the save, or unticking the box, counts for the next save, not this one.
    const generation = store.loadGeneration
    const archiving = archive
    const text = store.fullText()
    const split = splitFrontMatter(text)
    const reading = readTicks(split.raw, members)

    /** Stop, without touching the store, when a different note was opened meanwhile. */
    const stopped = () => {
      if (sameNote(generation)) return false
      pushToast({ text: SAVE_STOPPED, tone: 'warn' })
      return true
    }

    // 1. the working version
    let path = store.state.paths[0]
    if (!path) {
      let dir = workingDir
      if (!dir) {
        const picked = await window.marki.dialogs.pickFolder()
        if (!picked.ok) return
        if (stopped()) return
        dir = picked.path
        setPendingDir(dir)
      }
      const written = await window.marki.files.writeNew(dir, suggestName(split.body, store.state.fileName), text)
      if (stopped()) return
      if (!written.ok) {
        pushToast({ text: written.message, tone: 'warn' })
        return
      }
      store.afterFiling([written.path], { written: text })
      store.setFileName(baseName(written.path) || store.state.fileName)
      path = written.path
    } else {
      const saved = await window.marki.files.saveAll([path], text)
      if (stopped()) return
      if (!saved.ok) {
        pushToast({ text: saved.failures[0]?.message ?? SAVE_FAILED, tone: 'warn' })
        return
      }
      store.markSaved(text)
    }
    if (!archiving) return

    // 2. the archive copy, checked again against where the note now lives
    const now = planSave({
      yamlOk: reading.ok,
      rawPath,
      rawMissing,
      tickCount: reading.skillNames.length + reading.domainNames.length,
      workingDir: dirName(path)
    })
    if (!now.canArchive) {
      pushToast({ text: `Saved, but not archived: ${now.reason}`, tone: 'warn' })
      return
    }
    // One moment for the file name, the archived: stamp and the ledger, so a save at
    // midnight can't name the copy one day and stamp it the next.
    const at = new Date()
    const archivedAt = nowLocalIso(at)
    const copyText = addArchived(text, archivedAt)
    if (copyText === null) {
      pushToast({ text: `Saved, but not archived: ${BLOCK_REASONS.yaml}`, tone: 'warn' })
      return
    }
    const copy = await window.marki.archive.write(rawPath, store.state.fileName, localDate(at), copyText)
    if (!copy.ok) {
      pushToast({ text: `Saved, but not archived: ${copy.message}`, tone: 'warn', duration: 10000 })
      return
    }

    // 3. the ledger, which feeds the grid counts. The copy now exists, so it is recorded
    // even if another note was opened meanwhile: nothing here reads or touches the store.
    const front = parseFrontMatter(split.raw ?? '')
    const entry: LedgerEntry = {
      noteId: front.ok && typeof front.data.id === 'string' ? front.data.id : '',
      bunchId: activeBunch?.id ?? '',
      skillIds: reading.skillIds,
      domainIds: reading.domainIds,
      archivedAt
    }
    const appended = await window.marki.ledger.append(entry)
    // An append that was not saved may hand back an empty or stale list: keep the counts
    // already on screen rather than wiping them.
    if (appended.ok && appended.saved) input.onLedger(appended.entries)
    else input.onLedgerNotSaved()

    // The box belongs to whichever note is open now: only untick it for this one.
    if (sameNote(generation)) setArchive(false)
    pushToast({
      text: `Saved and archived to ${baseName(rawPath) || rawPath}.`,
      actionLabel: 'Show',
      onAction: () => void window.marki.shell.showItem(copy.path)
    })
  }

  const save = () =>
    exclusive('user', async () => {
      try {
        await runSave()
      } catch {
        // A rejected IPC call must never leave the student thinking the note was saved.
        pushToast({ text: SAVE_FAILED, tone: 'warn' })
      }
    })

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
      if (stopped()) return
      if (!saved.ok) {
        pushToast({ text: saved.failures[0]?.message ?? SAVE_FAILED, tone: 'warn' })
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
      try {
        const result = await window.marki.files.saveAll(where, text)
        if (!result.ok || !sameNote(generation)) return false
        store.markSaved(text)
        return true
      } catch {
        // Quiet by design: the note stays marked unsaved and the next pause tries again.
        return false
      }
    })

  const reset = useCallback(() => {
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
    autosave,
    reset
  }
}
