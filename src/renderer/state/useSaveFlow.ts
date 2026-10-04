import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DocumentStore } from './document'
import type { Bunch, LedgerEntry } from '@shared/types'
import type { TickReading } from '@shared/ticks'
import { BLOCK_REASONS, planSave, type SavePlan } from '@shared/archive'
import { addArchived, parseFrontMatter } from '@shared/markdown/frontmatter'
import { baseName, dirName, samePath } from '@shared/paths'
import { localDate, nowLocalIso } from '@shared/time'
import type { ToastMessage } from '@renderer/ui/Toast'
import { suggestName } from './naming'

export interface SaveFlowInput {
  store: DocumentStore
  paths: string[]
  originalPath?: string
  ticks: TickReading
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
  saving: boolean
  chooseWorkingFolder: () => Promise<void>
  chooseRawFolder: () => Promise<void>
  save: () => Promise<void>
  /** A different note was opened: forget the folder choice, untick the box. */
  reset: () => void
}

export function useSaveFlow(input: SaveFlowInput): SaveFlow {
  const { store, paths, originalPath, ticks, activeBunch, defaultRawPath, pushToast } = input
  const [archive, setArchive] = useState(false)
  const [pendingDir, setPendingDir] = useState('')
  const [rawOverride, setRawOverride] = useState<string | null>(null)
  const [rawMissing, setRawMissing] = useState(false)
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)

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

  const runSave = async () => {
    // 1. the working version
    let path = store.state.paths[0]
    if (!path) {
      let dir = workingDir
      if (!dir) {
        const picked = await window.marki.dialogs.pickFolder()
        if (!picked.ok) return
        dir = picked.path
        setPendingDir(dir)
      }
      const written = await window.marki.files.writeNew(dir, suggestName(store.state.body, store.state.fileName), store.fullText())
      if (!written.ok) {
        pushToast({ text: written.message, tone: 'warn' })
        return
      }
      store.afterFiling([written.path])
      store.setFileName(baseName(written.path) || store.state.fileName)
      path = written.path
    } else {
      const saved = await window.marki.files.saveAll([path], store.fullText())
      if (!saved.ok) {
        pushToast({ text: saved.failures[0]?.message ?? "The note couldn't be saved.", tone: 'warn' })
        return
      }
      store.markSaved()
    }
    if (!archive) return

    // 2. the archive copy, checked again against where the note now lives
    const now = planSave({ yamlOk: ticks.ok, rawPath, rawMissing, tickCount, workingDir: dirName(path) })
    if (!now.canArchive) {
      pushToast({ text: `Saved, but not archived: ${now.reason}`, tone: 'warn' })
      return
    }
    // One moment for the file name, the archived: stamp and the ledger, so a save at
    // midnight can't name the copy one day and stamp it the next.
    const at = new Date()
    const archivedAt = nowLocalIso(at)
    const text = addArchived(store.fullText(), archivedAt)
    if (text === null) {
      pushToast({ text: `Saved, but not archived: ${BLOCK_REASONS.yaml}`, tone: 'warn' })
      return
    }
    const copy = await window.marki.archive.write(rawPath, store.state.fileName, localDate(at), text)
    if (!copy.ok) {
      pushToast({ text: `Saved, but not archived: ${copy.message}`, tone: 'warn', duration: 10000 })
      return
    }

    // 3. the ledger, which feeds the grid counts
    const front = parseFrontMatter(store.state.frontMatterRaw ?? '')
    const entry: LedgerEntry = {
      noteId: front.ok && typeof front.data.id === 'string' ? front.data.id : '',
      bunchId: activeBunch?.id ?? '',
      skillIds: ticks.skillIds,
      domainIds: ticks.domainIds,
      archivedAt
    }
    const appended = await window.marki.ledger.append(entry)
    // An append that was not saved may hand back an empty or stale list: keep the counts
    // already on screen rather than wiping them.
    if (appended.ok && appended.saved) input.onLedger(appended.entries)
    else input.onLedgerNotSaved()

    setArchive(false)
    pushToast({
      text: `Saved and archived to ${baseName(rawPath) || rawPath}.`,
      actionLabel: 'Show',
      onAction: () => void window.marki.shell.showItem(copy.path)
    })
  }

  const save = async () => {
    // A double click must not start a second save over the top of the first.
    if (inFlight.current) return
    inFlight.current = true
    setSaving(true)
    try {
      await runSave()
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  const chooseWorkingFolder = async () => {
    const picked = await window.marki.dialogs.pickFolder()
    if (!picked.ok) return
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
      input.onConfirmedFileMoves()
    }
    if (store.state.dirty) {
      const saved = await window.marki.files.saveAll([current], store.fullText())
      if (!saved.ok) {
        pushToast({ text: saved.failures[0]?.message ?? "The note couldn't be saved.", tone: 'warn' })
        return
      }
      store.markSaved()
    }
    const moved = await window.marki.files.move(current, picked.path)
    if (!moved.ok) {
      pushToast({ text: moved.message, tone: 'warn' })
      return
    }
    store.afterFiling([moved.path])
    store.setFileName(baseName(moved.path) || store.state.fileName)
    pushToast(
      moved.notice
        ? { text: moved.notice, tone: 'warn' }
        : { text: `Moved to ${baseName(picked.path) || picked.path}.` }
    )
  }

  const chooseRawFolder = async () => {
    const picked = await window.marki.dialogs.pickFolder()
    if (picked.ok) setRawOverride(picked.path)
  }

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
    saving,
    chooseWorkingFolder,
    chooseRawFolder,
    save,
    reset
  }
}
