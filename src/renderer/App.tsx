import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ulid } from 'ulid'
import { DocumentStore } from './state/document'
import { suggestTitle } from './state/naming'
import { useSaveFlow } from './state/useSaveFlow'
import { SaveButton, SaveLocations } from './funkybunch/SaveControls'
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
import { baseName, samePath } from '@shared/paths'
import { parseFrontMatter, mergeFrontMatter } from '@shared/markdown/frontmatter'
import { convertTextToMarkdown, looksLikePlainText } from '@shared/markdown/txtToMd'
import { tidyMarkdown } from '@shared/markdown/tidy'
import { archiveCount } from '@shared/ledger'
import { nowLocalIso } from '@shared/time'
import { applyTicks, readTicks, type TickReading, type Ticks } from '@shared/ticks'
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
  const toastId = useRef(1)

  const pushToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = toastId.current++
    setToasts((current) => [...current, { ...toast, id }])
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  /* ---------------- settings and ledger ---------------- */

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

  useEffect(() => {
    window.marki.settings.read().then((loaded) => {
      setSettings(loaded)
      // Saving was off before anything was changed; say so now, not after the first change.
      if (!loaded.persisting) warnNotSaving('settings')
    })
    window.marki.ledger.read().then((result) => {
      if (result.ok) setLedger(result.entries)
    })
  }, [warnNotSaving])

  /** The newest settings, even before React re-renders, so quick toggles build on each other. */
  const settingsRef = useRef<Settings | null>(null)
  settingsRef.current = settings

  /** Numbers every settings write, so only the reply to the newest one is applied. */
  const settingsWrites = useRef(0)

  /**
   * Sends one settings write and applies its reply. Every reply carries the whole merged
   * settings, so an older reply landing after a newer write was sent is safely skipped:
   * applying it would briefly undo that newer change (an optimistic pane toggle, say).
   * Each reply is still checked for "not saved to disk".
   *
   * A write that fails is reported here, once, so every caller (the dialogs, the settings
   * checkboxes, the pane toggles) tells the student; callers only decide what to do next.
   */
  const saveSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const ticket = ++settingsWrites.current
      const failed = "Your change couldn't be saved. Try again."
      let result: Awaited<ReturnType<typeof window.marki.settings.write>>
      try {
        result = await window.marki.settings.write(patch)
      } catch {
        result = { ok: false, message: failed }
      }
      if (!result.ok) {
        pushToast({ text: result.message || failed, tone: 'warn' })
        return result
      }
      if (!result.persisted) warnNotSaving('settings')
      if (ticket === settingsWrites.current) {
        settingsRef.current = result.settings
        setSettings(result.settings)
      }
      return result
    },
    [warnNotSaving, pushToast]
  )

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
      // The reply carries every write so far, so the newest one is always complete.
      void saveSettings({ panes })
    },
    [saveSettings]
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

  /** What the raw pane's YAML fold shows: folded or open, broken or not, and its one line. */
  const yamlState = useMemo(() => {
    const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
    return {
      folded: settings?.yamlFolded ?? true,
      broken: !ticks.ok,
      summary: `YAML · ${count(ticks.skillNames.length, 'skill')} · ${count(ticks.domainNames.length, 'domain')} · ${count(ticks.tagCount, 'tag')}`
    }
  }, [settings?.yamlFolded, ticks])

  // Optimistic like the pane toggles, so the fold opens in the same frame as the click.
  const setYamlFolded = useCallback(
    (folded: boolean) => {
      const current = settingsRef.current
      if (!current || current.yamlFolded === folded) return
      const next = { ...current, yamlFolded: folded }
      settingsRef.current = next
      setSettings(next)
      void saveSettings({ yamlFolded: folded })
    },
    [saveSettings]
  )

  /** The bunch the note's YAML names, if it is one of ours. */
  const activeBunch = useMemo(() => {
    const name = ticks.bunch?.toLowerCase()
    return name ? (bunches.find((b) => b.name.toLowerCase() === name) ?? null) : null
  }, [ticks.bunch, bunches])

  const saveFlow = useSaveFlow({
    store,
    paths: doc.paths,
    originalPath: doc.originalPath,
    ticks,
    members,
    activeBunch,
    defaultRawPath: settings?.defaultRawPath ?? '',
    confirmedFileMoves: settings?.confirmedFileMoves ?? false,
    onConfirmedFileMoves: () => void saveSettings({ confirmedFileMoves: true }),
    onLedger: setLedger,
    onLedgerNotSaved: () => warnNotSaving('ledger'),
    pushToast
  })

  /**
   * The one way the grid and the chips change the note: rewrite its YAML as one undo step.
   * `update` gets the ticks read from the YAML as it is right now, not as it was when the
   * grid last drew, so two quick clicks build on each other instead of the second undoing
   * the first.
   */
  const writeTicks = useCallback(
    (update: (current: TickReading) => Ticks, bunch?: string | null) => {
      const current = settingsRef.current
      if (!current) return
      const roster = current.members
      const reading = readTicks(store.state.frontMatterRaw, roster)
      const raw = reading.ok
        ? applyTicks(store.state.frontMatterRaw, update(reading), roster, {
            mirrorTags: current.mirrorTicksAsTags,
            preset: current.frontMatterPreset,
            bunch,
            eol: store.state.eol,
            newId: ulid(),
            now: nowLocalIso(),
            title: suggestTitle(store.state.body)
          })
        : null
      if (raw === null) {
        pushToast({
          text: reading.ok
            ? "This note's YAML can't be changed safely from here. Fix it in the Raw Markdown pane first."
            : "The YAML at the top of this note can't be read, so nothing was ticked. Fix it in the Raw Markdown pane first.",
          tone: 'warn'
        })
        return
      }
      store.commitUndoGroup()
      store.setFrontMatter(raw, null)
      store.commitUndoGroup()
    },
    [pushToast]
  )

  const flip = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  const toggleSkill = useCallback(
    (id: string) => writeTicks((now) => ({ skillIds: flip(now.skillIds, id), domainIds: now.domainIds })),
    [writeTicks]
  )

  const toggleDomain = useCallback(
    (id: string) => writeTicks((now) => ({ skillIds: now.skillIds, domainIds: flip(now.domainIds, id) })),
    [writeTicks]
  )

  const toggleCell = useCallback(
    (skillId: string, domainId: string) =>
      writeTicks((now) => {
        const add = (list: string[], id: string) => (list.includes(id) ? list : [...list, id])
        return now.skillIds.includes(skillId) && now.domainIds.includes(domainId)
          ? { skillIds: now.skillIds.filter((x) => x !== skillId), domainIds: now.domainIds.filter((x) => x !== domainId) }
          : { skillIds: add(now.skillIds, skillId), domainIds: add(now.domainIds, domainId) }
      }),
    [writeTicks]
  )

  /** Clicking the active bunch clears the bunch name but keeps the ticks. */
  const applyBunch = useCallback(
    (id: string) => {
      const bunch = bunches.find((b) => b.id === id)
      if (!bunch) return
      // Whether it is the active one is read from the YAML now, for the same reason as above.
      const named = readTicks(store.state.frontMatterRaw, members).bunch
      const active = named !== null && named.toLowerCase() === bunch.name.trim().toLowerCase()
      if (active) writeTicks((now) => now, null)
      else writeTicks(() => ({ skillIds: bunch.skillIds, domainIds: bunch.domainIds }), bunch.name)
    },
    [bunches, members, writeTicks]
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
      saveFlow.reset()
    },
    [pushToast, saveFlow.reset]
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

  // Save, Ctrl+S and the pane's Save button all go through saveFlow.save.

  // Autosave: quiet, and only for notes that already have a home. It waits while a save,
  // a move or a folder choice is under way, and tries again once that has finished
  // (settled), so text typed during a save is autosaved too. saveFlow.autosave writes
  // exactly the text it read and marks only that as saved.
  const autosaveRef = useRef(saveFlow.autosave)
  autosaveRef.current = saveFlow.autosave
  useEffect(() => {
    if (!settings?.autosave || saveFlow.busy) return
    if (!doc.dirty || doc.paths.length === 0 || doc.isPlainText) return
    const timer = window.setTimeout(() => void autosaveRef.current(), 2000)
    return () => window.clearTimeout(timer)
  }, [doc.dirty, doc.version, doc.paths.length, doc.isPlainText, settings?.autosave, saveFlow.busy, saveFlow.settled])

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
        case 'save': return void saveFlow.save()
        case 'save-as': return void (async () => {
          const generation = store.loadGeneration
          const text = store.fullText()
          const result = await window.marki.files.saveAs(doc.fileName, text)
          if (!result.ok) return
          // Only the text written counts as saved, and only the note it came from moves.
          if (store.loadGeneration === generation) {
            store.afterFiling([result.path], { written: text })
            store.setFileName(baseName(result.path) || doc.fileName)
          }
          pushToast({ text: 'Saved.' })
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
    [openFile, saveFlow, addProperties, tidy, convert, cleanWithAi, togglePaneKey, doc.fileName, doc.paths, pushToast]
  )

  // saveFlow is a new object every render, so handleAction is too. The menu listener is
  // attached once and always calls the newest handleAction through this ref.
  const handleActionRef = useRef(handleAction)
  handleActionRef.current = handleAction
  useEffect(() => window.marki.on.menuAction((action) => handleActionRef.current(action)), [])

  /* ---------------- roster and bunch editing ---------------- */

  const closeDialog = useCallback(() => setDialog(null), [])

  // Each of these builds its new list from settingsRef at the moment it runs, not from the
  // lists the last render saw, so a change that landed since is never written back over.
  // saveSettings reports a failed write; a dialog then stays open so nothing is lost.

  const upsertMember = useCallback(
    async (member: Member) => {
      const current = settingsRef.current
      if (!current) return
      const list = current.members
      const next = list.some((m) => m.id === member.id)
        ? list.map((m) => (m.id === member.id ? member : m))
        : [...list, member]
      const result = await saveSettings({ members: next })
      if (result.ok) closeDialog()
    },
    [saveSettings, closeDialog]
  )

  const removeMember = useCallback(
    async (id: string) => {
      const current = settingsRef.current
      if (!current) return
      const result = await saveSettings({
        members: current.members.filter((m) => m.id !== id),
        bunches: current.bunches.map((b) => ({
          ...b,
          skillIds: b.skillIds.filter((x) => x !== id),
          domainIds: b.domainIds.filter((x) => x !== id)
        }))
      })
      if (result.ok) closeDialog()
    },
    [saveSettings, closeDialog]
  )

  const upsertBunch = useCallback(
    async (bunch: Bunch) => {
      const current = settingsRef.current
      if (!current) return
      const list = current.bunches
      const next = list.some((b) => b.id === bunch.id)
        ? list.map((b) => (b.id === bunch.id ? bunch : b))
        : [...list, bunch]
      const result = await saveSettings({ bunches: next })
      if (result.ok) closeDialog()
    },
    [saveSettings, closeDialog]
  )

  const removeBunch = useCallback(
    async (id: string) => {
      const current = settingsRef.current
      if (!current) return
      const result = await saveSettings({ bunches: current.bunches.filter((b) => b.id !== id) })
      if (result.ok) closeDialog()
    },
    [saveSettings, closeDialog]
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
      // A dialog has the student's attention: a bunch changing behind it would be a surprise.
      if (event.shiftKey && digit && document.querySelector('[role="dialog"]') === null) {
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

  if (!settings) return <div className="booting">Opening MarkiMarkdown...</div>

  return (
    <div className="app">
      <div className="workspace">
        <TopBar
          fileName={doc.fileName}
          dirty={doc.dirty}
          archiveCount={archiveCount(ledger, noteId)}
          filePath={doc.paths[0] ?? ''}
          panes={settings.panes}
          hiddenPanes={hiddenPanes}
          onTogglePane={togglePaneKey}
          busy={busy}
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
                    locations={<SaveLocations flow={saveFlow} />}
                    footer={<SaveButton flow={saveFlow} />}
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
                          rawPath: saveFlow.rawPath
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
                  {doc.frontMatterRaw !== null && ticks.ok && (
                    <button
                      type="button"
                      className="btn btn-quiet btn-tight yaml-toggle"
                      onClick={() => setYamlFolded(!settings.yamlFolded)}
                    >
                      {settings.yamlFolded ? 'View YAML' : 'Hide YAML'}
                    </button>
                  )}
                  <CodePane
                    store={store}
                    text={doc.fullText}
                    sync={sync}
                    onFocusOwner={() => store.setOwner('code')}
                    registerCommands={(api) => {
                      codeCommands.current = api
                    }}
                    yaml={yamlState}
                    onYamlOpen={() => setYamlFolded(false)}
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
          bunches={bunches}
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
