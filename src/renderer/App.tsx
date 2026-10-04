import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ulid } from 'ulid'
import { DocumentStore } from './state/document'
import { CodePane, type CodeCommands } from './editors/CodePane'
import { RenderedPane, type RenderedCommands } from './editors/RenderedPane'
import { SyncController } from './editors/sync'
import { PropertiesPanel } from './frontmatter/PropertiesPanel'
import { MemberDialog } from './funkybunch/MemberDialog'
import { BunchDialog } from './funkybunch/BunchDialog'
import { LocationsPane } from './funkybunch/LocationsPane'
import { SettingsDialog } from './ui/SettingsDialog'
import { HelpDialog } from './ui/HelpDialog'
import { PromptDialog } from './ui/PromptDialog'
import { TopBar } from './ui/TopBar'
import { PaneLayout } from './layout/PaneLayout'
import { togglePane, type PaneKey } from './layout/paneMath'
import { ToastStack, type ToastMessage } from './ui/Toast'
import { planFiling } from './funkybunch/selection'
import { baseName, dirName, samePath } from '@shared/paths'
import {
  parseFrontMatter,
  splitFrontMatter,
  stampNote,
  mergeFrontMatter
} from '@shared/markdown/frontmatter'
import { convertTextToMarkdown, looksLikePlainText } from '@shared/markdown/txtToMd'
import { tidyMarkdown } from '@shared/markdown/tidy'
import { buildStamp } from '@shared/bunch'
import { lastBunchFor } from '@shared/ledger'
import { nowLocalIso } from '@shared/time'
import { applyTicks, readTicks, type Ticks } from '@shared/ticks'
import type { Bunch, LedgerEntry, Member, MemberKind, Settings } from '@shared/types'

const store = new DocumentStore()
const sync = new SyncController()

type DialogState =
  | { kind: 'member'; existing?: Member; presetKind?: MemberKind; presetName?: string }
  | { kind: 'bunch'; existing?: Bunch; preset?: { skillIds: string[]; domainIds: string[]; rawPath?: string } }
  | { kind: 'settings' }
  | { kind: 'help' }
  | null

export default function App() {
  const doc = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [hiddenPanes, setHiddenPanes] = useState<PaneKey[]>([])
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [dialog, setDialog] = useState<DialogState>(null)
  const [busy, setBusy] = useState('')
  const [missingRaw, setMissingRaw] = useState<string[]>([])
  const [missingMemberIds, setMissingMemberIds] = useState<string[]>([])
  const commands = useRef<RenderedCommands | null>(null)
  const codeCommands = useRef<CodeCommands | null>(null)
  const aiRun = useRef(0)
  const [askingLink, setAskingLink] = useState(false)
  const filingInFlight = useRef(false)
  const toastId = useRef(1)

  const pushToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = toastId.current++
    setToasts((current) => [...current, { ...toast, id }])
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  /* ---------------- settings and ledger ---------------- */

  useEffect(() => {
    window.marki.settings.read().then(setSettings)
    window.marki.ledger.read().then((result) => {
      if (result.ok) setLedger(result.entries)
    })
  }, [])

  /** Each "this is not being saved" warning is shown once per session and stays until dismissed. */
  const warnedNotSaving = useRef(new Set<'settings' | 'ledger'>())
  const warnNotSaving = useCallback(
    (what: 'settings' | 'ledger') => {
      if (warnedNotSaving.current.has(what)) return
      warnedNotSaving.current.add(what)
      pushToast({
        text:
          what === 'settings'
            ? "MarkiMarkdown can't save its settings right now, so changes to your skills, domains and bunches will be lost when you close it. Check that the settings folder isn't locked by another program, then restart."
            : "MarkiMarkdown can't update its archive counts right now. Your notes and archive copies are safe.",
        tone: 'warn',
        duration: 0
      })
    },
    [pushToast]
  )

  /** Applies a settings write's reply, and says so once when it only lives in memory. */
  const applySettingsReply = useCallback(
    (result: Awaited<ReturnType<typeof window.marki.settings.write>>) => {
      if (!result.ok) return
      setSettings(result.settings)
      if (!result.persisted) warnNotSaving('settings')
    },
    [warnNotSaving]
  )

  const saveSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const result = await window.marki.settings.write(patch)
      applySettingsReply(result)
      return result
    },
    [applySettingsReply]
  )

  /** The newest settings, even before React re-renders, so quick toggles build on each other. */
  const settingsRef = useRef<Settings | null>(null)
  settingsRef.current = settings

  // Optimistic, so the checkbox flips in the same frame as the click.
  const togglePaneKey = useCallback(
    (key: PaneKey) => {
      const current = settingsRef.current
      if (!current) return
      const panes = togglePane(current.panes, key)
      if (panes === current.panes) return
      const next = { ...current, panes }
      settingsRef.current = next
      setSettings(next)
      // The reply carries every write so far, so the last one to land is always complete.
      void window.marki.settings.write({ panes }).then(applySettingsReply)
    },
    [applySettingsReply]
  )

  const members = settings?.members ?? []
  const bunches = settings?.bunches ?? []

  /* ---------------- note identity ---------------- */

  const frontMatter = useMemo(() => {
    if (doc.frontMatterRaw === null) return { ok: true as const, data: {} as Record<string, unknown> }
    return parseFrontMatter(doc.frontMatterRaw)
  }, [doc.frontMatterRaw])

  const noteId = frontMatter.ok && typeof frontMatter.data.id === 'string' ? frontMatter.data.id : ''

  const ticks = useMemo(() => readTicks(doc.frontMatterRaw, members), [doc.frontMatterRaw, members])

  /** The bunch the note's YAML names, if it is one of ours. */
  const activeBunch = useMemo(() => {
    const name = ticks.bunch?.toLowerCase()
    return name ? (bunches.find((b) => b.name.toLowerCase() === name) ?? null) : null
  }, [ticks.bunch, bunches])

  const lastBunchId = useMemo(() => lastBunchFor(ledger, noteId), [ledger, noteId])

  const plan = useMemo(
    () => planFiling({ bunches, members, selectedId: activeBunch?.id ?? null, lastBunchId, missingRawPaths: missingRaw }),
    [bunches, members, activeBunch, lastBunchId, missingRaw]
  )

  /** The one way the grid and the chips change the note: rewrite its YAML as one undo step. */
  const writeTicks = useCallback(
    (next: Ticks, bunch?: string | null) => {
      if (!settings) return
      const raw = applyTicks(store.state.frontMatterRaw, next, members, {
        mirrorTags: settings.mirrorTicksAsTags,
        preset: settings.frontMatterPreset,
        bunch,
        eol: store.state.eol,
        newId: ulid(),
        now: nowLocalIso(),
        title: suggestTitle(store.state.body)
      })
      if (raw === null) {
        pushToast({ text: "This note's YAML can't be changed safely from here. Fix it in the Raw Markdown pane first.", tone: 'warn' })
        return
      }
      store.commitUndoGroup()
      store.setFrontMatter(raw, null)
      store.commitUndoGroup()
    },
    [settings, members, pushToast]
  )

  const flip = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  const toggleSkill = useCallback(
    (id: string) => writeTicks({ skillIds: flip(ticks.skillIds, id), domainIds: ticks.domainIds }),
    [writeTicks, ticks]
  )

  const toggleDomain = useCallback(
    (id: string) => writeTicks({ skillIds: ticks.skillIds, domainIds: flip(ticks.domainIds, id) }),
    [writeTicks, ticks]
  )

  const toggleCell = useCallback(
    (skillId: string, domainId: string) => {
      const both = ticks.skillIds.includes(skillId) && ticks.domainIds.includes(domainId)
      const add = (list: string[], id: string) => (list.includes(id) ? list : [...list, id])
      writeTicks(
        both
          ? { skillIds: ticks.skillIds.filter((x) => x !== skillId), domainIds: ticks.domainIds.filter((x) => x !== domainId) }
          : { skillIds: add(ticks.skillIds, skillId), domainIds: add(ticks.domainIds, domainId) }
      )
    },
    [writeTicks, ticks]
  )

  /** Clicking the active bunch clears the bunch name but keeps the ticks. */
  const applyBunch = useCallback(
    (id: string) => {
      const bunch = bunches.find((b) => b.id === id)
      if (!bunch) return
      if (activeBunch?.id === bunch.id) writeTicks(ticks, null)
      else writeTicks({ skillIds: bunch.skillIds, domainIds: bunch.domainIds }, bunch.name)
    },
    [bunches, activeBunch, writeTicks, ticks]
  )

  /* ---------------- check folders really exist ---------------- */

  const rawKey = bunches.map((b) => b.rawPath).join('|')
  useEffect(() => {
    const paths = bunches.map((b) => b.rawPath).filter((p) => p.length > 0)
    if (paths.length === 0) {
      setMissingRaw([])
      return
    }
    let cancelled = false
    window.marki.members.missingPaths(paths).then((result) => {
      if (!cancelled && result.ok) setMissingRaw(result.missing)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawKey])

  const memberKey = members.map((m) => m.id + ':' + m.path).join('|')
  useEffect(() => {
    const withPath = members.filter((m) => m.path.length > 0)
    const withoutPath = members.filter((m) => m.path.length === 0).map((m) => m.id)
    if (withPath.length === 0) {
      setMissingMemberIds(withoutPath)
      return
    }
    let cancelled = false
    window.marki.members.missingPaths(withPath.map((m) => m.path)).then((result) => {
      if (cancelled || !result.ok) return
      const gone = withPath.filter((m) => result.missing.some((p) => samePath(p, m.path))).map((m) => m.id)
      setMissingMemberIds([...withoutPath, ...gone])
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberKey])

  /* ---------------- opening files ---------------- */

  const openFile = useCallback(
    async (path?: string) => {
      const result = path ? await window.marki.files.read(path) : await window.marki.files.openDialog()
      if (!result.ok) {
        if (result.message) pushToast({ text: result.message, tone: 'warn' })
        return
      }
      store.load(result.file)
    },
    [pushToast]
  )

  useEffect(() => window.marki.on.openPath((path) => void openFile(path)), [openFile])

  /**
   * Dropping a note onto the window opens it. Handled at the window, in the capture
   * phase, so the editors never get the chance to paste the file path in as text.
   */
  useEffect(() => {
    const allow = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }

    const drop = (event: DragEvent) => {
      const files = event.dataTransfer?.files
      if (!files || files.length === 0) return
      event.preventDefault()
      event.stopPropagation()

      const file = files[0]
      const path = window.marki.files.pathFor(file)
      if (!path) {
        pushToast({ text: 'That could not be opened from here. Try File then Open.', tone: 'warn' })
        return
      }
      if (!/\.(md|markdown|txt|text)$/i.test(path)) {
        pushToast({
          text: 'MarkiMarkdown opens Markdown and plain text notes. That looks like a different kind of file.',
          tone: 'warn'
        })
        return
      }
      void openFile(path)
    }

    window.addEventListener('dragover', allow, true)
    window.addEventListener('drop', drop, true)
    return () => {
      window.removeEventListener('dragover', allow, true)
      window.removeEventListener('drop', drop, true)
    }
  }, [openFile, pushToast])

  useEffect(
    () =>
      window.marki.on.appError(({ message }) =>
        pushToast({ text: message, tone: 'warn', actionLabel: 'Copy details', onAction: () => window.marki.support.diagnostics() })
      ),
    [pushToast]
  )

  /* ---------------- saving ---------------- */

  const saveNow = useCallback(async (): Promise<boolean> => {
    if (store.state.paths.length === 0 || store.state.isPlainText) {
      const result = await window.marki.files.saveAs(store.state.fileName, store.fullText())
      if (!result.ok) {
        if (result.message) pushToast({ text: result.message, tone: 'warn' })
        return false
      }
      store.afterFiling([result.path])
      store.setFileName(baseName(result.path) || store.state.fileName)
      pushToast({ text: 'Saved.' })
      return true
    }
    const result = await window.marki.files.saveAll(store.state.paths, store.fullText())
    if (!result.ok) {
      pushToast({ text: result.failures[0]?.message ?? 'The note could not be saved.', tone: 'warn' })
      return false
    }
    store.markSaved()
    return true
  }, [pushToast])

  // Autosave: quiet, and only for notes that already have a home.
  useEffect(() => {
    if (!settings?.autosave) return
    if (!doc.dirty || doc.paths.length === 0 || doc.isPlainText) return
    const timer = window.setTimeout(() => {
      window.marki.files.saveAll(store.state.paths, store.fullText()).then((result) => {
        if (result.ok) store.markSaved()
      })
    }, 2000)
    return () => window.clearTimeout(timer)
  }, [doc.dirty, doc.version, doc.paths.length, doc.isPlainText, settings?.autosave])

  /* ---------------- filing ---------------- */

  const runFiling = useCallback(async () => {
    // A double click must not start a second filing over the top of the first.
    if (filingInFlight.current) return
    if (!plan.canFile) {
      if (plan.blockedReason) pushToast({ text: plan.blockedReason, tone: 'warn' })
      return
    }
    filingInFlight.current = true
    try {
      await performFiling()
    } finally {
      filingInFlight.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, doc, members, bunches, noteId, frontMatter, settings, pushToast, openFile])

  const performFiling = useCallback(async () => {
    const bunch = plan.bunch
    if (!bunch || !settings) return

    // Broken YAML makes stampNote a no-op, which would file a note with no id and no
    // skills. Say so instead of filing something wrong.
    if (!frontMatter.ok) {
      pushToast({
        text: 'The properties at the top of this note cannot be read, so it cannot be filed yet. Fix them on the left, or press Repair above the note.',
        tone: 'warn',
        duration: 10000
      })
      return
    }

    // A bunch made before its raw folder was chosen gets one now, and remembers it.
    let rawPath = bunch.rawPath
    if (rawPath.length === 0) {
      if (settings.defaultRawPath) {
        rawPath = settings.defaultRawPath
      } else {
        const picked = await window.marki.dialogs.pickFolder()
        if (!picked.ok) return
        rawPath = picked.path
      }
      const rawSave = await saveSettings({ bunches: bunches.map((b) => (b.id === bunch.id ? { ...b, rawPath } : b)) })
      if (!rawSave.ok) pushToast({ text: rawSave.message, tone: 'warn' })
    }

    let fileName = doc.fileName
    if (doc.paths.length === 0 || doc.isPlainText) fileName = suggestName(doc.body, fileName)

    const id = noteId || ulid()
    const created =
      frontMatter.ok && typeof frontMatter.data.created === 'string' ? frontMatter.data.created : nowLocalIso()

    const who = buildStamp(bunch, members, settings.mirrorTicksAsTags)
    const content = stampNote(store.fullText(), {
      id,
      // the plain preset keeps front matter minimal; OKF wants a type on every concept
      type: settings.frontMatterPreset === 'basic' ? undefined : 'note',
      filed: nowLocalIso(),
      created,
      tags: who.tags,
      bunch: who.bunch,
      skills: who.skills,
      skillPaths: who.skillPaths,
      domains: who.domains,
      domainPaths: who.domainPaths
    })

    // Belt and braces: if the stamp did not actually land, do not write anything.
    const stampedFront = splitFrontMatter(content).raw
    const stampedOk = stampedFront !== null && parseFrontMatter(stampedFront).ok
    if (!stampedOk) {
      pushToast({
        text: 'The properties at the top of this note cannot be read, so it cannot be filed yet.',
        tone: 'warn'
      })
      return
    }

    // A note opened from a .txt has no Markdown home yet; its .txt is what gets moved.
    const currentPath = doc.paths[0] ?? doc.originalPath
    const basePlan = { content, fileName, noteId: id, currentPath, raw: { name: bunch.name, path: rawPath } }

    const check = await window.marki.filing.preflight(basePlan)
    if (!check.ok) {
      pushToast({ text: check.message, tone: 'warn' })
      return
    }
    if (check.result.unavailable) {
      pushToast({ text: check.result.unavailable, tone: 'warn' })
      return
    }

    let conflictChoice: 'replace' | 'keepBoth' | 'cancel' = 'replace'
    if (check.result.conflict && !check.result.conflict.sameId) {
      const answer = await window.marki.dialogs.confirm({
        message: `${bunch.name} already has a different note called ${fileName}.`,
        detail: 'You can replace it, keep both, or stop here.',
        buttons: ['Keep both', 'Replace', 'Cancel'],
        danger: true
      })
      if (!answer.ok || answer.index === 2) return
      conflictChoice = answer.index === 0 ? 'keepBoth' : 'replace'
    }

    setBusy('Filing...')
    const result = await window.marki.filing.run({ ...basePlan, conflictChoice })
    setBusy('')

    if (!result.ok) {
      pushToast({ text: result.message, tone: 'warn' })
      return
    }

    const outcome = result.outcome
    if (!outcome.ok || !outcome.writtenPath) {
      pushToast({
        text: outcome.failure ?? 'The note could not be filed.',
        tone: 'warn',
        actionLabel: 'Try again',
        onAction: () => void runFiling()
      })
      return
    }

    const cameFrom = currentPath
    const writtenPath = outcome.writtenPath
    store.setFileName(baseName(writtenPath) || fileName)
    store.afterFiling([writtenPath], content)

    const entry: LedgerEntry = {
      noteId: id,
      bunchId: bunch.id,
      skillIds: who.skillIds,
      domainIds: who.domainIds,
      archivedAt: nowLocalIso()
    }
    const appended = await window.marki.ledger.append(entry)
    if (appended.ok) {
      setLedger(appended.entries)
      if (!appended.saved) warnNotSaving('ledger')
    } else {
      warnNotSaving('ledger')
    }

    pushToast({
      text: outcome.notice || `Filed to ${bunch.name}.`,
      actionLabel: 'Undo',
      onAction: async () => {
        // Undo goes back to before the filing, so anything typed since would go too.
        if (store.state.dirty) {
          const answer = await window.marki.dialogs.confirm({
            message: 'Undo the filing?',
            detail:
              'You have typed something since filing. Undoing puts the note back where it came from and those newer changes are lost.',
            buttons: ['Undo anyway', 'Keep my changes'],
            danger: true
          })
          if (!answer.ok || answer.index === 1) return
        }
        const undone = await window.marki.filing.undo()
        if (undone.ok) {
          pushToast({ text: undone.result.message, tone: undone.result.ok ? undefined : 'warn' })
          if (undone.result.ok && cameFrom) void openFile(cameFrom)
          // A note that had never been saved anywhere has no cameFrom to reopen: the
          // copy filing wrote is now trashed, so forget the path and make Save ask
          // for a home again, without touching the text on screen.
          else if (undone.result.ok) store.unfile()
        } else {
          pushToast({ text: undone.message, tone: 'warn' })
        }
      }
    })
  }, [plan, doc, members, bunches, noteId, frontMatter, settings, pushToast, openFile, saveSettings, warnNotSaving])

  /* ---------------- actions from the menu and the top bar ---------------- */

  const addProperties = useCallback(() => {
    if (doc.frontMatterRaw !== null) return
    const title = suggestTitle(doc.body) || doc.fileName.replace(/\.md$/i, '')
    const raw = mergeFrontMatter(null, {
      type: settings?.frontMatterPreset === 'basic' ? undefined : 'note',
      title,
      created: nowLocalIso(),
      tags: []
    })
    store.setFrontMatter(raw, null)
    store.commitUndoGroup()
  }, [doc.frontMatterRaw, doc.body, doc.fileName, settings?.frontMatterPreset])

  const tidy = useCallback(() => {
    const result = tidyMarkdown(doc.body)
    if (result.changes === 0) {
      pushToast({ text: 'Nothing to tidy - this note is already neat.' })
      return
    }
    store.setBody(result.markdown, null)
    store.commitUndoGroup()
    pushToast({
      text: `Tidied ${result.changes} thing${result.changes === 1 ? '' : 's'}.`,
      actionLabel: 'Undo',
      onAction: () => store.undo()
    })
  }, [doc.body, pushToast])

  const convert = useCallback(() => {
    const result = convertTextToMarkdown(doc.body)
    const total = result.changes.reduce((sum, c) => sum + c.count, 0)
    store.setBody(result.markdown, null)
    store.commitUndoGroup()
    store.clearPlainText()
    pushToast({
      text: total === 0 ? 'Nothing needed changing.' : `Converted ${total} thing${total === 1 ? '' : 's'} to Markdown.`,
      actionLabel: 'Undo',
      onAction: () => store.undo()
    })
  }, [doc.body, pushToast])

  const cleanWithAi = useCallback(async () => {
    const detected = await window.marki.ai.detect()
    if (!detected.ok || !detected.status.available) {
      setDialog({ kind: 'settings' })
      pushToast({
        text: detected.ok ? detected.status.detail : 'No AI provider was found.',
        tone: 'warn'
      })
      return
    }
    const runId = ++aiRun.current
    setBusy('Working... usually 10-30 s')
    const prompt = [
      'You are tidying a student note written in Markdown.',
      'Fix spelling, grammar and clumsy sentences. Remove chat-assistant filler such as',
      '"Sure! Here is" or "Let me know if you would like".',
      'Keep the meaning, the headings, the lists and the structure.',
      'Do not add new sections and do not remove information.',
      'Reply with the corrected Markdown only, with no commentary and no code fence.'
    ].join(' ')
    const result = await window.marki.ai.run(prompt, doc.body)
    // The student pressed Cancel (or started another run) while this was in flight:
    // a late answer must never overwrite what they have been typing since.
    if (runId !== aiRun.current) return
    setBusy('')
    if (!result.ok) {
      pushToast({ text: result.message, tone: 'warn' })
      return
    }
    if (result.text.trim() === doc.body.trim()) {
      pushToast({ text: 'The AI did not suggest any changes.' })
      return
    }
    store.setBody(result.text.endsWith('\n') ? result.text : result.text + '\n', null)
    store.commitUndoGroup()
    pushToast({ text: 'Cleaned up.', actionLabel: 'Undo', onAction: () => store.undo() })
  }, [doc.body, pushToast])

  const handleAction = useCallback(
    (action: string) => {
      switch (action) {
        case 'open': return void openFile()
        case 'save': return void saveNow()
        case 'save-as': return void (async () => {
          const result = await window.marki.files.saveAs(doc.fileName, store.fullText())
          if (result.ok) {
            store.afterFiling([result.path])
            store.setFileName(baseName(result.path) || doc.fileName)
            pushToast({ text: 'Saved.' })
          }
        })()
        case 'undo': return store.undo()
        case 'redo': return store.redo()
        // Formatting has to work in whichever pane the student is actually in.
        case 'bold':
          return store.state.owner === 'code'
            ? codeCommands.current?.wrap('**', '**')
            : commands.current?.toggleStrong()
        case 'italic':
          return store.state.owner === 'code'
            ? codeCommands.current?.wrap('*', '*')
            : commands.current?.toggleEm()
        case 'link': return setAskingLink(true)
        case 'paste-plain': return void (async () => {
          const clip = await window.marki.clipboard.readText()
          if (!clip.ok || clip.text.length === 0) return
          if (store.state.owner === 'code') codeCommands.current?.insert(clip.text)
          else commands.current?.insertPlain(clip.text)
        })()
        case 'add-properties': return addProperties()
        case 'tidy': return tidy()
        case 'convert': return convert()
        case 'ai-clean': return void cleanWithAi()
        case 'file-to': return void runFiling()
        case 'toggle-pane-bunch': return togglePaneKey('bunch')
        case 'toggle-pane-raw': return togglePaneKey('raw')
        case 'toggle-pane-rendered': return togglePaneKey('rendered')
        case 'settings': return setDialog({ kind: 'settings' })
        case 'help': return setDialog({ kind: 'help' })
        case 'diagnostics': return void (async () => {
          await window.marki.support.diagnostics()
          pushToast({ text: 'Diagnostics copied. Paste them into an email to your instructor.' })
        })()
        case 'logs': return void window.marki.support.openLogs()
        case 'show-in-folder': return void (doc.paths[0] && window.marki.shell.showItem(doc.paths[0]))
        case 'jump': return commands.current?.jumpToActive()
        default: return
      }
    },
    [openFile, saveNow, addProperties, tidy, convert, cleanWithAi, runFiling, togglePaneKey, doc.fileName, doc.paths, pushToast]
  )

  useEffect(() => window.marki.on.menuAction(handleAction), [handleAction])

  /* ---------------- roster and bunch editing ---------------- */

  const closeDialog = useCallback(() => setDialog(null), [])

  const upsertMember = useCallback(
    async (member: Member) => {
      const next = members.some((m) => m.id === member.id)
        ? members.map((m) => (m.id === member.id ? member : m))
        : [...members, member]
      const result = await saveSettings({ members: next })
      if (!result.ok) {
        pushToast({ text: result.message, tone: 'warn' })
        return
      }
      closeDialog()
    },
    [members, saveSettings, closeDialog, pushToast]
  )

  const removeMember = useCallback(
    async (id: string) => {
      const result = await saveSettings({
        members: members.filter((m) => m.id !== id),
        bunches: bunches.map((b) => ({
          ...b,
          skillIds: b.skillIds.filter((x) => x !== id),
          domainIds: b.domainIds.filter((x) => x !== id)
        }))
      })
      if (!result.ok) {
        pushToast({ text: result.message, tone: 'warn' })
        return
      }
      closeDialog()
    },
    [members, bunches, saveSettings, closeDialog, pushToast]
  )

  const upsertBunch = useCallback(
    async (bunch: Bunch) => {
      const next = bunches.some((b) => b.id === bunch.id)
        ? bunches.map((b) => (b.id === bunch.id ? bunch : b))
        : [...bunches, bunch]
      const result = await saveSettings({ bunches: next })
      if (!result.ok) {
        pushToast({ text: result.message, tone: 'warn' })
        return
      }
      closeDialog()
    },
    [bunches, saveSettings, closeDialog, pushToast]
  )

  const removeBunch = useCallback(
    async (id: string) => {
      const result = await saveSettings({ bunches: bunches.filter((b) => b.id !== id) })
      if (!result.ok) {
        pushToast({ text: result.message, tone: 'warn' })
        return
      }
      closeDialog()
    },
    [bunches, saveSettings, closeDialog, pushToast]
  )

  const editBunch = useCallback(
    (id: string) => {
      const bunch = bunches.find((b) => b.id === id)
      if (bunch) setDialog({ kind: 'bunch', existing: bunch })
    },
    [bunches]
  )

  /* ---------------- keyboard ---------------- */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey
      if (!mod) return
      const digit = /^Digit([1-9])$/.exec(event.code)
      if (event.shiftKey && digit) {
        const index = Number(digit[1]) - 1
        const bunch = bunches[index]
        if (bunch) {
          event.preventDefault()
          applyBunch(bunch.id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [bunches, applyBunch])

  // Typing bursts collapse into one undo step.
  useEffect(() => {
    const timer = window.setTimeout(() => store.commitUndoGroup(), 500)
    return () => window.clearTimeout(timer)
  }, [doc.version])

  const knownTags = useMemo(() => {
    const tags = new Set<string>()
    const inline = doc.body.match(/(?:^|\s)#([A-Za-z0-9][\w/-]*)/g) ?? []
    for (const raw of inline) tags.add(raw.trim().slice(1))
    return [...tags]
  }, [doc.body])

  const placeNames = useMemo(
    () =>
      doc.paths.map((p) => {
        const dir = dirName(p)
        return bunches.find((b) => b.rawPath.length > 0 && samePath(b.rawPath, dir))?.name ?? (baseName(dir) || dir)
      }),
    [doc.paths, bunches]
  )

  if (!settings) return <div className="booting">Opening MarkiMarkdown...</div>

  return (
    <div className="app">
      <div className="workspace">
        <TopBar
          fileName={doc.fileName}
          dirty={doc.dirty}
          placeCount={doc.paths.length}
          placeNames={placeNames}
          fileLabel={plan.fileLabel}
          canFile={plan.canFile}
          blockedReason={plan.blockedReason}
          hasPending={plan.bunch !== null}
          panes={settings.panes}
          hiddenPanes={hiddenPanes}
          onTogglePane={togglePaneKey}
          busy={busy}
          onFile={() => void runFiling()}
          onClearSelection={() => activeBunch && applyBunch(activeBunch.id)}
          onMenu={handleAction}
          onCancelBusy={() => {
            aiRun.current += 1
            setBusy('')
          }}
        />

        <PaneLayout
          panes={settings.panes}
          widths={settings.paneWidths}
          onWidths={(paneWidths) => void saveSettings({ paneWidths })}
          onHiddenChange={setHiddenPanes}
          render={(key) => {
            if (key === 'bunch') {
              return (
                <section key="bunch" className="pane pane-bunch" aria-label="Funky Bunch">
                  <LocationsPane
                    ticks={ticks}
                    members={members}
                    bunches={bunches}
                    ledger={ledger}
                    missingMemberIds={missingMemberIds}
                    missingRawPaths={missingRaw}
                    activeBunchId={activeBunch?.id ?? null}
                    onToggleSkill={toggleSkill}
                    onToggleDomain={toggleDomain}
                    onToggleCell={toggleCell}
                    onApplyBunch={applyBunch}
                    onEditBunch={editBunch}
                    onSaveAsBunch={() =>
                      setDialog({
                        kind: 'bunch',
                        preset: {
                          skillIds: ticks.skillIds,
                          domainIds: ticks.domainIds,
                          rawPath: activeBunch?.rawPath || settings.defaultRawPath || ''
                        }
                      })
                    }
                    onEditMember={(id) => {
                      const member = members.find((m) => m.id === id)
                      if (member) setDialog({ kind: 'member', existing: member })
                    }}
                    onAddMember={(kind, name) => setDialog({ kind: 'member', presetKind: kind, presetName: name })}
                    onOpenHelp={() => setDialog({ kind: 'help' })}
                  />
                </section>
              )
            }
            if (key === 'raw') {
              return (
                <section key="raw" className="pane pane-code" aria-label="Markdown source">
                  <CodePane
                    store={store}
                    text={doc.fullText}
                    sync={sync}
                    onFocusOwner={() => store.setOwner('code')}
                    registerCommands={(api) => {
                      codeCommands.current = api
                    }}
                  />
                </section>
              )
            }
            return (
              <section key="rendered" className="pane pane-rendered" aria-label="Readable text">
                <div className="pane-inner">
                  {doc.isPlainText && looksLikePlainText(doc.body) && (
                    <div className="notice">
                      <span>This looks like plain text.</span>
                      <button className="btn btn-quiet" onClick={convert}>
                        Convert to Markdown
                      </button>
                    </div>
                  )}
                  <PropertiesPanel
                    raw={doc.frontMatterRaw}
                    onChange={(raw) => {
                      store.setFrontMatter(raw, null)
                      store.commitUndoGroup()
                    }}
                    knownTags={knownTags}
                  />
                  <RenderedPane
                    store={store}
                    body={doc.body}
                    version={doc.version}
                    sync={sync}
                    onFocusOwner={() => store.setOwner('rendered')}
                    onRequestLink={() => setAskingLink(true)}
                    registerCommands={(api) => {
                      commands.current = api
                    }}
                  />
                </div>
              </section>
            )
          }}
        />
      </div>

      <ToastStack toasts={toasts} dismiss={dismissToast} />

      {dialog?.kind === 'member' && (
        <MemberDialog
          key={dialog.existing?.id ?? 'new-member'}
          existing={dialog.existing}
          presetKind={dialog.presetKind}
          presetName={dialog.presetName}
          siblings={members}
          onSave={upsertMember}
          onDelete={dialog.existing ? () => void removeMember(dialog.existing!.id) : undefined}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'bunch' && (
        <BunchDialog
          key={dialog.existing?.id ?? 'new-bunch'}
          existing={dialog.existing}
          preset={dialog.preset}
          members={members}
          defaultRawPath={settings.defaultRawPath}
          missingMemberIds={missingMemberIds}
          onSave={upsertBunch}
          onDelete={dialog.existing ? () => void removeBunch(dialog.existing!.id) : undefined}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'settings' && (
        <SettingsDialog
          settings={settings}
          onSave={saveSettings}
          onClose={() => setDialog(null)}
          notify={(text) => pushToast({ text })}
        />
      )}
      {dialog?.kind === 'help' && <HelpDialog onClose={() => setDialog(null)} />}

      {askingLink && (
        <PromptDialog
          title="Add a link"
          label="Link address"
          hint="Paste a web address, or leave it empty to remove the link."
          confirmLabel="Add link"
          allowEmpty
          emptyLabel="Remove link"
          onClose={() => setAskingLink(false)}
          onSubmit={(href) => {
            setAskingLink(false)
            const inCode = store.state.owner === 'code'
            if (href.length === 0) {
              if (!inCode) commands.current?.removeLink()
              return
            }
            if (inCode) codeCommands.current?.wrap('[', `](${href})`)
            else commands.current?.setLink(href)
          }}
        />
      )}
    </div>
  )
}

function suggestTitle(body: string): string {
  const heading = /^#{1,6}\s+(.+)$/m.exec(body)
  return heading ? heading[1].trim() : ''
}

function suggestName(body: string, fallback: string): string {
  const title = suggestTitle(body)
  if (!title) return fallback
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return slug ? `${slug}.md` : fallback
}
