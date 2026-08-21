import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ulid } from 'ulid'
import { DocumentStore } from './state/document'
import { CodePane, type CodeCommands } from './editors/CodePane'
import { RenderedPane, type RenderedCommands } from './editors/RenderedPane'
import { SyncController } from './editors/sync'
import { PropertiesPanel } from './frontmatter/PropertiesPanel'
import { Strip } from './funkybunch/Strip'
import { FolderDialog, AgentDialog } from './funkybunch/MemberDialogs'
import { SettingsDialog } from './ui/SettingsDialog'
import { HelpDialog } from './ui/HelpDialog'
import { PromptDialog } from './ui/PromptDialog'
import { TopBar, type ViewMode } from './ui/TopBar'
import { ToastStack, type ToastMessage } from './ui/Toast'
import { emptySelection, planFiling, toggle, type SelectionInput } from './funkybunch/selection'
import { baseName, dirName, samePath } from '@shared/paths'
import {
  parseFrontMatter,
  splitFrontMatter,
  stampNote,
  mergeFrontMatter
} from '@shared/markdown/frontmatter'
import { convertTextToMarkdown, looksLikePlainText } from '@shared/markdown/txtToMd'
import { tidyMarkdown } from '@shared/markdown/tidy'
import type { AgentMember, FolderMember, Member, Settings } from '@shared/types'

const store = new DocumentStore()
const sync = new SyncController()

function nowLocalIso(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const offset = -d.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}

function nowStamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const isFolder = (m: Member): m is FolderMember => m.kind === 'folder'
const isAgent = (m: Member): m is AgentMember => m.kind === 'agent'

export default function App() {
  const doc = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [selection, setSelection] = useState<SelectionInput>(emptySelection([]))
  const [view, setView] = useState<ViewMode>('split')
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [dialog, setDialog] = useState<
    | { kind: 'folder'; existing?: FolderMember }
    | { kind: 'agent'; existing?: AgentMember }
    | { kind: 'settings' }
    | { kind: 'help' }
    | null
  >(null)
  const [busy, setBusy] = useState('')
  const [missingFolders, setMissingFolders] = useState<string[]>([])
  const commands = useRef<RenderedCommands | null>(null)
  const codeCommands = useRef<CodeCommands | null>(null)
  const aiRun = useRef(0)
  const [askingLink, setAskingLink] = useState(false)
  const filingInFlight = useRef(false)
  const [fileWhenReady, setFileWhenReady] = useState(false)
  const toastId = useRef(1)

  const pushToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = toastId.current++
    setToasts((current) => [...current, { ...toast, id }])
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  /* ---------------- settings ---------------- */

  useEffect(() => {
    window.marki.settings.read().then((loaded) => {
      setSettings(loaded)
      setSelection((current) => ({ ...current, members: loaded.members }))
    })
  }, [])

  const saveSettings = useCallback(async (patch: Partial<Settings>) => {
    const result = await window.marki.settings.write(patch)
    if (result.ok) {
      setSettings(result.settings)
      setSelection((current) => ({ ...current, members: result.settings.members }))
    }
    return result
  }, [])

  const members = settings?.members ?? []
  const folders = members.filter(isFolder)

  /* ---------------- note identity ---------------- */

  const frontMatter = useMemo(() => {
    if (doc.frontMatterRaw === null) return { ok: true as const, data: {} as Record<string, unknown> }
    return parseFrontMatter(doc.frontMatterRaw)
  }, [doc.frontMatterRaw])

  const noteAgents = useMemo(() => {
    if (!frontMatter.ok) return []
    const value = frontMatter.data.agents
    if (Array.isArray(value)) return value.map(String)
    if (typeof value === 'string') return value.split(',').map((v) => v.trim()).filter(Boolean)
    return []
  }, [frontMatter])

  const noteId = frontMatter.ok && typeof frontMatter.data.id === 'string' ? frontMatter.data.id : ''

  const currentFolderPaths = useMemo(
    () => doc.paths.map(dirName),
    [doc.paths]
  )

  /**
   * Toggling and planning must both see where the note currently lives, otherwise
   * clicking a folder the note is already in reads as "add" instead of "remove".
   */
  const withContext = useCallback(
    (input: SelectionInput): SelectionInput => ({
      ...input,
      members,
      currentPaths: currentFolderPaths,
      currentAgents: noteAgents
    }),
    [members, currentFolderPaths, noteAgents]
  )

  const plan = useMemo(
    () => planFiling(withContext(selection), missingFolders),
    [selection, withContext, missingFolders]
  )

  const toggleTile = useCallback(
    (id: string) => setSelection((current) => toggle(withContext(current), id)),
    [withContext]
  )

  /* ---------------- check folders really exist ---------------- */

  useEffect(() => {
    if (folders.length === 0) return
    let cancelled = false
    const check = async () => {
      const missing: string[] = []
      for (const folder of folders) {
        const result = await window.marki.filing.preflight({
          content: '',
          fileName: 'probe.md',
          noteId: 'probe',
          agentNames: [],
          currentPaths: [],
          addFolders: [{ name: folder.name, path: folder.path }],
          allFolderNames: [],
          now: ''
        })
        if (result.ok && result.result.unavailable.length > 0) missing.push(folder.path)
      }
      if (!cancelled) setMissingFolders(missing)
    }
    check()
    return () => {
      cancelled = true
    }
  }, [folders.map((f) => f.path).join('|')])

  /* ---------------- siblings ---------------- */

  useEffect(() => {
    if (!noteId || folders.length === 0) return
    let cancelled = false
    window.marki.filing
      .findSiblings(folders.map((f) => f.path), noteId, doc.paths)
      .then((result) => {
        if (cancelled || !result.ok) return
        setSelection((current) => ({ ...current, siblingPaths: result.paths.map(dirName) }))
      })
  }, [noteId, doc.paths.join('|'), folders.map((f) => f.path).join('|')])

  /* ---------------- opening files ---------------- */

  const openFile = useCallback(
    async (path?: string) => {
      const result = path ? await window.marki.files.read(path) : await window.marki.files.openDialog()
      if (!result.ok) {
        if (result.message) pushToast({ text: result.message, tone: 'warn' })
        return
      }
      store.load(result.file)
      setSelection((current) => ({ ...current, pickedIds: [], droppedIds: [], siblingPaths: [] }))
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
  }, [plan, doc, folders, noteId, frontMatter, settings, pushToast, openFile])

  const performFiling = useCallback(async () => {

    let fileName = doc.fileName
    if (doc.paths.length === 0 || doc.isPlainText) {
      const suggested = suggestName(doc.body, fileName)
      fileName = suggested
    }

    const stampTags: string[] = []
    for (const id of [...plan.addFolderIds, ...plan.keepFolderIds]) {
      const folder = folders.find((f) => f.id === id)
      for (const tag of folder?.stamp?.tags ?? []) if (!stampTags.includes(tag)) stampTags.push(tag)
    }
    if (settings?.mirrorAgentsAsTags) {
      for (const agent of plan.agentNames) stampTags.push(`agent/${agent}`)
    }

    const id = noteId || ulid()
    const created =
      frontMatter.ok && typeof frontMatter.data.created === 'string' ? frontMatter.data.created : nowLocalIso()

    // Broken YAML makes stampNote a no-op, which would file a note with no id and no
    // agents while the log claimed otherwise. Say so instead of filing something wrong.
    if (!frontMatter.ok) {
      pushToast({
        text: 'The properties at the top of this note cannot be read, so it cannot be filed yet. Fix them on the left, or press Repair above the note.',
        tone: 'warn',
        duration: 10000
      })
      return
    }

    const content = stampNote(store.fullText(), {
      id,
      // the plain preset keeps front matter minimal; OKF wants a type on every concept
      type: settings?.frontMatterPreset === 'basic' ? undefined : 'note',
      filed: nowLocalIso(),
      created,
      tags: stampTags,
      agents: plan.agentNames
    })

    const addFolders = plan.addFolderIds
      .map((fid) => folders.find((f) => f.id === fid))
      .filter((f): f is FolderMember => Boolean(f))
      .map((f) => ({ name: f.name, path: f.path }))

    const removeFolders = plan.removeFolderIds
      .map((fid) => folders.find((f) => f.id === fid))
      .filter((f): f is FolderMember => Boolean(f))
      .map((f) => ({
        name: f.name,
        path: f.path,
        filePath: doc.paths.find((p) => samePath(dirName(p), f.path)) ?? ''
      }))
      .filter((r) => r.filePath.length > 0)

    const allFolderNames = [...plan.addFolderIds, ...plan.keepFolderIds]
      .map((fid) => folders.find((f) => f.id === fid)?.name)
      .filter((n): n is string => Boolean(n))

    const basePlan = {
      content,
      fileName,
      noteId: id,
      agentNames: plan.agentNames,
      currentPaths: doc.paths.filter((p) =>
        plan.keepFolderIds.some((fid) => {
          const folder = folders.find((f) => f.id === fid)
          return folder ? samePath(dirName(p), folder.path) : false
        })
      ),
      originalPath: doc.originalPath,
      addFolders,
      removeFolders,
      allFolderNames,
      now: nowStamp()
    }

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

    const check = await window.marki.filing.preflight(basePlan)
    if (!check.ok) {
      pushToast({ text: check.message, tone: 'warn' })
      return
    }

    let conflictChoice: 'replace' | 'keepBoth' | 'cancel' = 'replace'
    const clashes = check.result.conflicts.filter((c) => !c.sameId)
    if (clashes.length > 0) {
      const answer = await window.marki.dialogs.confirm({
        message: `${clashes[0].folderName} already has a different note called ${fileName}.`,
        detail: 'You can replace it, keep both, or stop here.',
        buttons: ['Keep both', 'Replace', 'Cancel'],
        danger: true
      })
      if (!answer.ok || answer.index === 2) return
      conflictChoice = answer.index === 0 ? 'keepBoth' : 'replace'
    }

    if (plan.removeFolderIds.length > 0) {
      const names = plan.removeFolderIds.map((fid) => folders.find((f) => f.id === fid)?.name).join(', ')
      const answer = await window.marki.dialogs.confirm({
        message: `Remove the copy in ${names}?`,
        detail: 'It goes to the Trash, so you can still get it back.',
        buttons: ['Remove', 'Cancel'],
        danger: true
      })
      if (!answer.ok || answer.index === 1) return
    }

    setBusy('Filing...')
    const result = await window.marki.filing.run({ ...basePlan, conflictChoice })
    setBusy('')

    if (!result.ok) {
      pushToast({ text: result.message, tone: 'warn' })
      return
    }

    const outcome = result.outcome
    if (!outcome.ok) {
      pushToast({
        text: outcome.failures.map((f) => f.message).join(' '),
        tone: 'warn',
        actionLabel: 'Try again',
        onAction: () => void runFiling()
      })
      return
    }

    const undoOriginal = doc.originalPath
    store.setFileName(fileName)
    store.afterFiling(outcome.written.map((w) => w.path), content)
    setSelection((current) => ({ ...current, pickedIds: [], droppedIds: [] }))

    const where = allFolderNames.join(', ')
    const forWho = plan.agentNames.length > 0 ? ` for ${plan.agentNames.join(', ')}` : ''
    pushToast({
      text: outcome.notice || `Filed in ${where}${forWho}.`,
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
          pushToast({ text: undone.result.message })
          const back = undoOriginal
          if (back) void openFile(back)
        } else {
          pushToast({ text: undone.message, tone: 'warn' })
        }
      }
    })
  }, [plan, doc, folders, noteId, frontMatter, settings, pushToast, openFile])

  // Dropping the note on a tile selects it first; file once that has taken effect.
  useEffect(() => {
    if (!fileWhenReady) return
    setFileWhenReady(false)
    if (plan.canFile) void runFiling()
    else if (plan.blockedReason) pushToast({ text: plan.blockedReason, tone: 'warn' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileWhenReady, plan.canFile])

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
        case 'view-code': return setView('code')
        case 'view-split': return setView('split')
        case 'view-text': return setView('text')
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
    [openFile, saveNow, addProperties, tidy, convert, cleanWithAi, runFiling, doc.fileName, doc.paths, pushToast]
  )

  useEffect(() => window.marki.on.menuAction(handleAction), [handleAction])

  /* ---------------- member editing ---------------- */

  const upsertMember = useCallback(
    async (member: Member) => {
      const next = members.some((m) => m.id === member.id)
        ? members.map((m) => (m.id === member.id ? member : m))
        : [...members, member]
      await saveSettings({ members: next, seenCoachmark: true })
      setDialog(null)
    },
    [members, saveSettings]
  )

  const removeMember = useCallback(
    async (id: string) => {
      const next = members
        .filter((m) => m.id !== id)
        .map((m) => (isAgent(m) ? { ...m, folderIds: m.folderIds.filter((f) => f !== id) } : m))
      await saveSettings({ members: next })
      setDialog(null)
    },
    [members, saveSettings]
  )

  const editMember = useCallback(
    (id: string) => {
      const member = members.find((m) => m.id === id)
      if (!member) return
      setDialog(isFolder(member) ? { kind: 'folder', existing: member } : { kind: 'agent', existing: member })
    },
    [members]
  )

  /* ---------------- keyboard ---------------- */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey
      if (!mod) return
      if (event.shiftKey && event.key >= '1' && event.key <= '9') {
        const index = Number(event.key) - 1
        const tile = plan.tiles[index]
        if (tile) {
          event.preventDefault()
          toggleTile(tile.id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [plan.tiles, toggleTile])

  // Typing bursts collapse into one undo step.
  useEffect(() => {
    const timer = window.setTimeout(() => store.commitUndoGroup(), 500)
    return () => window.clearTimeout(timer)
  }, [doc.version])

  const knownTags = useMemo(() => {
    const tags = new Set<string>()
    for (const folder of folders) for (const tag of folder.stamp?.tags ?? []) tags.add(tag)
    const inline = doc.body.match(/(?:^|\s)#([A-Za-z0-9][\w/-]*)/g) ?? []
    for (const raw of inline) tags.add(raw.trim().slice(1))
    return [...tags]
  }, [folders, doc.body])

  const placeNames = useMemo(
    () =>
      doc.paths.map((p) => {
        const dir = dirName(p)
        return folders.find((f) => samePath(f.path, dir))?.name ?? (baseName(dir) || dir)
      }),
    [doc.paths, folders]
  )

  if (!settings) return <div className="booting">Opening MarkiMarkdown...</div>

  const showCoachmark = !settings.seenCoachmark && folders.length === 0

  return (
    <div className="app">
      <Strip
        plan={plan}
        onToggle={toggleTile}
        onAddFolder={() => setDialog({ kind: 'folder' })}
        onAddAgent={() => setDialog({ kind: 'agent' })}
        onEdit={editMember}
        onSettings={() => setDialog({ kind: 'settings' })}
        onDropNote={(id) => {
          toggleTile(id)
          setFileWhenReady(true)
        }}
        showCoachmark={showCoachmark}
        onDismissCoachmark={() => void saveSettings({ seenCoachmark: true })}
      />

      <div className="workspace">
        <TopBar
          fileName={doc.fileName}
          dirty={doc.dirty}
          placeCount={doc.paths.length}
          placeNames={placeNames}
          fileLabel={plan.fileLabel}
          canFile={plan.canFile}
          blockedReason={plan.blockedReason}
          hasPending={plan.pendingCount > 0}
          view={view}
          busy={busy}
          onSetView={setView}
          onFile={() => void runFiling()}
          onClearSelection={() => setSelection((current) => ({ ...current, pickedIds: [], droppedIds: [] }))}
          onMenu={handleAction}
          onCancelBusy={() => {
            aiRun.current += 1
            setBusy('')
          }}
        />

        <div className={`panes ${view}`}>
          {view !== 'text' && (
            <section className="pane pane-code" aria-label="Markdown source">
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
          )}
          {view !== 'code' && (
            <section className="pane pane-rendered" aria-label="Readable text">
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
          )}
        </div>
      </div>

      <ToastStack toasts={toasts} dismiss={dismissToast} />

      {dialog?.kind === 'folder' && (
        <FolderDialog
          existing={dialog.existing}
          siblings={folders}
          onSave={upsertMember}
          onDelete={dialog.existing ? () => void removeMember(dialog.existing!.id) : undefined}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'agent' && (
        <AgentDialog
          existing={dialog.existing}
          folders={folders}
          onSave={upsertMember}
          onDelete={dialog.existing ? () => void removeMember(dialog.existing!.id) : undefined}
          onClose={() => setDialog(null)}
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
