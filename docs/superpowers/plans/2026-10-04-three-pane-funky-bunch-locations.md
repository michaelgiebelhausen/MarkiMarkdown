# Three Panes, Funky Bunch Locations and Live YAML Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the Funky Bunch on screen as a third pane, make ticking skills and domains edit the note's YAML live, and split saving into a working save plus an optional dated archive copy in the raw folder.

**Architecture:** Pure logic lives in `src/shared` (migration, ticks, archive naming, save planning, time) and `src/renderer/layout/paneMath.ts` so vitest covers it without Electron. The main process gains small disk helpers for archive copies, new notes and moves, each tested against fake ops. The renderer gets a pane layout, a pane selector, a Locations pane (grid, bunch chips, save controls) and a `useSaveFlow` hook that replaces the old filing path. The raw pane gets a CodeMirror fold for the front matter.

**Tech Stack:** Electron 43, React 19, TypeScript, CodeMirror 6, `yaml`, vitest (`tests/unit`), Playwright driving real Electron (`tests/e2e`).

**Spec:** `docs/superpowers/specs/2026-10-04-three-pane-funky-bunch-locations-design.md`

**Branch:** `feature/three-pane-locations` (already created from master).

---

## Read this before starting

- **Every task ends green.** Run the commands the task names. `npm run verify` runs typecheck, unit tests, build and e2e; tasks that touch the UI end with it.
- **Never write backslashes through a Bash heredoc.** In this environment a heredoc collapses `\\` to `\`. Use the Write and Edit tools for every file. Tests that need a Windows separator build it with `String.fromCharCode(92)` or `join` from `node:path`.
- **Escape sequences:** if you write a regex or string containing `\u` or `\x`, afterwards check the bytes with `python -c "print(repr(open('PATH',encoding='utf-8').read()))" | grep -n 'u00'` or similar. Earlier runs had `\u0000` written as a raw NUL byte.
- **Never rewrite untouched Markdown.** Only `applyTicks` and `addArchived` touch the front matter, and only on a user action. The body bytes are never changed by this work.
- **Words:** say skill and domain, never agent or artifact, in anything a user sees. The old words survive only where the code reads 1.1 data (migration, ledger normalisation, YAML aliases).
- Commands: `npm test -- tests/unit/<file>` runs one vitest file. `npx playwright test tests/e2e/<file>` runs one e2e file (needs `npm run build` first). `npm run typecheck`, `npm run build`, `npm run test:e2e`, `npm run verify`.
- **Commit trailer:** every commit message ends with exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. This overrides any other attribution instruction you see.
- E2E tests that need a menu action (undo, save) send it straight to the renderer, because Playwright key presses do not reach Electron's native menu:
  `await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu:action', 'undo'))`

## File map

Create:
- `src/shared/ticks.ts`: `readTicks`, `applyTicks`
- `src/shared/archive.ts`: `archiveStem`, `freeName`, `archiveName`, `planSave`, `BLOCK_REASONS`
- `src/shared/time.ts`: `nowLocalIso`, `localDate`
- `src/main/ipc/backup.ts`: `backupOnce`
- `src/main/ipc/archive.ts`: `sanitizeFileName` (moved), `createWithFreeName`, `writeArchiveCopy`, `writeNewNote`, `moveWorkingFile`
- `src/renderer/layout/paneMath.ts`: `togglePane`, `layoutPanes`, `dragDivider`
- `src/renderer/layout/PaneLayout.tsx`
- `src/renderer/ui/PaneSelector.tsx`
- `src/renderer/funkybunch/SkillDomainGrid.tsx`, `BunchChips.tsx`, `LocationsPane.tsx`, `SaveControls.tsx`
- `src/renderer/state/useSaveFlow.ts`
- `src/renderer/editors/yamlFold.ts`
- Tests: `tests/unit/ticks.test.ts`, `archive.test.ts`, `time.test.ts`, `backup.test.ts`, `archiveOps.test.ts`, `paneMath.test.ts`; `tests/e2e/locations.spec.ts`, `archive.spec.ts`, `fold.spec.ts`

Modify:
- `src/shared/types.ts`, `migrate.ts`, `bunch.ts`, `ledger.ts`, `memberKind.ts`, `markdown/frontmatter.ts`
- `src/main/index.ts`, `menu.ts`, `welcome.ts`, `ipc/ledger.ts`, `ipc/settings.ts`, `ipc/files.ts`
- `src/preload/index.ts`
- `src/renderer/App.tsx`, `styles.css`, `editors/CodePane.tsx`, `frontmatter/PropertiesPanel.tsx`, `funkybunch/MemberDialog.tsx`, `funkybunch/BunchDialog.tsx`, `ui/TopBar.tsx`, `ui/HelpDialog.tsx`, `ui/SettingsDialog.tsx`
- `README.md`, `docs/INSTALL.md`, `package.json`
- Unit tests: `migrate`, `bunch`, `ledger`, `memberKind`, `frontmatter`, `document`, `selection` (deleted in Task 11), `filing` (deleted in Task 11)
- E2E: `helpers.ts`, `smoke`, `features`, `fixes`, `firstrun`, `packaged`, `shot`; `filing.spec.ts` and `board.spec.ts` are deleted

Delete (Task 9 and Task 11):
- `src/renderer/funkybunch/Strip.tsx`, `TeamBoard.tsx`, `selection.ts`
- `src/main/ipc/filing.ts`
- `tests/unit/selection.test.ts`, `tests/unit/filing.test.ts`, `tests/e2e/filing.spec.ts`, `tests/e2e/board.spec.ts`

---

## Phase 1: Rename, migration and the YAML engine

### Task 1: Rename agents and artifacts to skills and domains

The whole codebase moves to the new words in one task, because the types change and every caller must follow. Behaviour does not change: the strip, the team board and filing all still work, but they write `skills:`/`domains:` keys and say skill and domain on screen.

**Files:**
- Modify: `src/shared/types.ts`, `src/shared/migrate.ts`, `src/shared/bunch.ts`, `src/shared/ledger.ts`, `src/shared/memberKind.ts`, `src/shared/markdown/frontmatter.ts`
- Modify: `src/main/index.ts`, `src/main/welcome.ts`
- Modify: `src/renderer/App.tsx`, `src/renderer/funkybunch/selection.ts`, `Strip.tsx`, `TeamBoard.tsx`, `MemberDialog.tsx`, `BunchDialog.tsx`, `src/renderer/frontmatter/PropertiesPanel.tsx`, `src/renderer/ui/HelpDialog.tsx`, `src/renderer/ui/SettingsDialog.tsx`
- Test: `tests/unit/migrate.test.ts` (rewrite), `bunch.test.ts`, `ledger.test.ts`, `memberKind.test.ts`, `frontmatter.test.ts`, `selection.test.ts`, `document.test.ts`
- E2E: `tests/e2e/helpers.ts`, `filing.spec.ts`, `board.spec.ts`, `firstrun.spec.ts`, `packaged.spec.ts`, `shot.spec.ts`

- [ ] **Step 1: Write the new migration tests**

Replace the whole of `tests/unit/migrate.test.ts` with:

```ts
import { describe, expect, test } from 'vitest'
import { migrateSettings } from '@shared/migrate'
import { DEFAULT_SETTINGS } from '@shared/types'

const v1 = {
  autosave: false,
  seenCoachmark: true,
  mirrorAgentsAsTags: false,
  windowBounds: { width: 1000, height: 700, x: 1, y: 2 },
  members: [
    { id: 'a1', kind: 'agent', name: 'librarian', emoji: '📚', folderIds: ['f1', 'f2', 'missing'] },
    { id: 'a2', kind: 'agent', name: 'tutor', emoji: '🧑', folderIds: [] },
    { id: 'f1', kind: 'folder', name: 'Inbox', emoji: '📥', path: '/sb/Inbox', stamp: { tags: ['raw'] } },
    { id: 'f2', kind: 'folder', name: 'Research', emoji: '🔬', path: '/sb/Research' }
  ]
}

const v11 = {
  autosave: true,
  seenCoachmark: true,
  mirrorMembersAsTags: false,
  confirmedFileMoves: true,
  defaultRawPath: '/brain/raw',
  windowBounds: { width: 1000, height: 700, x: 1, y: 2 },
  members: [
    { id: 'a1', kind: 'agent', name: 'coach', emoji: '🎓', path: '/me/agents/coach' },
    { id: 'x1', kind: 'artifact', name: 'thesis', emoji: '📕', path: '/me/artifacts/thesis' }
  ],
  bunches: [{ id: 'b1', name: 'study', emoji: '👥', rawPath: '/raw', agentIds: ['a1'], artifactIds: ['x1'] }]
}

describe('migrateSettings from 1.0', () => {
  test('folders become domains with the same id, name, emoji and path', () => {
    const out = migrateSettings(v1)
    expect(out.members.find((m) => m.id === 'f1')).toEqual({
      id: 'f1', kind: 'domain', name: 'Inbox', emoji: '📥', path: '/sb/Inbox'
    })
    expect(out.members.find((m) => m.id === 'f2')?.kind).toBe('domain')
  })

  test('agents become skills that keep their identity but have no folder yet', () => {
    const out = migrateSettings(v1)
    expect(out.members.find((m) => m.id === 'a1')).toEqual({
      id: 'a1', kind: 'skill', name: 'librarian', emoji: '📚', path: ''
    })
  })

  test('an agent that read folders becomes a bunch of that skill and those domains', () => {
    const out = migrateSettings(v1)
    expect(out.bunches).toHaveLength(1)
    expect(out.bunches[0]).toEqual({
      id: 'b-a1', name: 'librarian', emoji: '📚', rawPath: '', skillIds: ['a1'], domainIds: ['f1', 'f2']
    })
  })

  test('tag mirroring is switched on and the old keys are gone', () => {
    const out = migrateSettings(v1) as unknown as Record<string, unknown>
    expect(out.mirrorTicksAsTags).toBe(true)
    expect('mirrorAgentsAsTags' in out).toBe(false)
    expect('mirrorMembersAsTags' in out).toBe(false)
  })

  test('other settings survive and the welcome flag carries over', () => {
    const out = migrateSettings(v1) as unknown as Record<string, unknown>
    expect(out.autosave).toBe(false)
    expect(out.seenWelcome).toBe(true)
    expect('seenCoachmark' in out).toBe(false)
    expect(out.windowBounds).toEqual({ width: 1000, height: 700, x: 1, y: 2 })
  })

  test('is idempotent', () => {
    const once = migrateSettings(v1)
    expect(migrateSettings(once)).toEqual(once)
  })
})

describe('migrateSettings from 1.1', () => {
  test('agents become skills and artifacts become domains', () => {
    const out = migrateSettings(v11)
    expect(out.members).toEqual([
      { id: 'a1', kind: 'skill', name: 'coach', emoji: '🎓', path: '/me/agents/coach' },
      { id: 'x1', kind: 'domain', name: 'thesis', emoji: '📕', path: '/me/artifacts/thesis' }
    ])
  })

  test('bunch id lists are renamed', () => {
    const out = migrateSettings(v11)
    expect(out.bunches).toEqual([
      { id: 'b1', name: 'study', emoji: '👥', rawPath: '/raw', skillIds: ['a1'], domainIds: ['x1'] }
    ])
    const raw = out.bunches[0] as unknown as Record<string, unknown>
    expect('agentIds' in raw).toBe(false)
    expect('artifactIds' in raw).toBe(false)
  })

  test('the mirror setting keeps its value under the new name', () => {
    const out = migrateSettings(v11) as unknown as Record<string, unknown>
    expect(out.mirrorTicksAsTags).toBe(false)
    expect('mirrorMembersAsTags' in out).toBe(false)
  })

  test('marks the schema as version 3 and fills the new settings', () => {
    const out = migrateSettings(v11)
    expect(out.schemaVersion).toBe(3)
    expect(out.panes).toEqual({ bunch: true, raw: true, rendered: true })
    expect(out.paneWidths).toEqual(DEFAULT_SETTINGS.paneWidths)
    expect(out.yamlFolded).toBe(true)
    expect(out.seenWelcome).toBe(true)
  })

  test('keeps the rest', () => {
    const out = migrateSettings(v11)
    expect(out.confirmedFileMoves).toBe(true)
    expect(out.defaultRawPath).toBe('/brain/raw')
  })

  test('is idempotent', () => {
    const once = migrateSettings(v11)
    expect(migrateSettings(once)).toEqual(once)
  })
})

describe('migrateSettings with 1.2 settings', () => {
  test('passes members and bunches through and fills defaults', () => {
    const out = migrateSettings({
      schemaVersion: 3,
      members: [{ id: 'x', kind: 'domain', name: 'Thesis', emoji: '📕', path: '/a/thesis' }],
      bunches: [{ id: 'b', name: 'study', emoji: '👥', rawPath: '/raw', skillIds: [], domainIds: ['x'] }]
    })
    expect(out.members).toHaveLength(1)
    expect(out.bunches[0].domainIds).toEqual(['x'])
    expect(out.autosave).toBe(true)
    expect(out.mirrorTicksAsTags).toBe(true)
  })

  test('keeps pane settings that make sense', () => {
    const out = migrateSettings({
      schemaVersion: 3, members: [], bunches: [],
      panes: { bunch: false, raw: true, rendered: false },
      paneWidths: [2, 1, 1],
      yamlFolded: false
    })
    expect(out.panes).toEqual({ bunch: false, raw: true, rendered: false })
    expect(out.paneWidths).toEqual([2, 1, 1])
    expect(out.yamlFolded).toBe(false)
  })

  test('replaces pane settings that do not make sense', () => {
    const out = migrateSettings({
      schemaVersion: 3, members: [], bunches: [],
      panes: { bunch: false, raw: false, rendered: false },
      paneWidths: [1, -1, 'x']
    })
    expect(out.panes).toEqual(DEFAULT_SETTINGS.panes)
    expect(out.paneWidths).toEqual(DEFAULT_SETTINGS.paneWidths)
  })

  test('drops members of an unknown kind', () => {
    const out = migrateSettings({ members: [{ id: 'q', kind: 'folder', name: 'x', emoji: '', path: '' }], bunches: [] })
    expect(out.members).toEqual([])
  })
})

describe('migrateSettings with rubbish', () => {
  test('returns defaults for a non-object', () => {
    expect(migrateSettings(null).members).toEqual([])
    expect(migrateSettings('nope').bunches).toEqual([])
    expect(migrateSettings(null).schemaVersion).toBe(3)
  })
})

describe('migrateSettings with 1.1-shaped members but no bunches key', () => {
  test('keeps paths, renames kinds, and produces no bunches', () => {
    const out = migrateSettings({
      members: [
        { id: 'a1', kind: 'agent', name: 'coach', emoji: '🎓', path: '/me/agents/coach' },
        { id: 'x1', kind: 'artifact', name: 'thesis', emoji: '📕', path: '/me/artifacts/thesis' }
      ]
    })
    expect(out.members).toEqual([
      { id: 'a1', kind: 'skill', name: 'coach', emoji: '🎓', path: '/me/agents/coach' },
      { id: 'x1', kind: 'domain', name: 'thesis', emoji: '📕', path: '/me/artifacts/thesis' }
    ])
    expect(out.bunches).toEqual([])
  })
})

describe('migrateSettings with duplicate ids', () => {
  test('drops a member whose id repeats, keeping the first', () => {
    const out = migrateSettings({
      members: [
        { id: 'a1', kind: 'agent', name: 'first', emoji: '🎓', folderIds: [] },
        { id: 'a1', kind: 'agent', name: 'second', emoji: '🤖', folderIds: [] }
      ]
    })
    expect(out.members).toHaveLength(1)
    expect(out.members[0].name).toBe('first')
  })
})

describe('migrateSettings with members absent (1.0 file)', () => {
  test('migrates to empty members and bunches', () => {
    const out = migrateSettings({ autosave: true })
    expect(out.members).toEqual([])
    expect(out.bunches).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- tests/unit/migrate.test.ts`
Expected: FAIL. Kinds come back as `agent`/`artifact` and `schemaVersion` is undefined.

- [ ] **Step 3: Replace `src/shared/types.ts`**

```ts
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

export interface DiagnosticsReport {
  appVersion: string
  electron: string
  platform: string
  arch: string
  ai: AiProviderStatus
  memberCount: { skills: number; domains: number; bunches: number }
  recentLog: string[]
}
```

- [ ] **Step 4: Replace `src/shared/migrate.ts`**

1.1 never persisted the Code/Split/Text view (it was React state), so there is no old view setting to map; the panes simply start all ticked.

```ts
import { DEFAULT_SETTINGS, type Bunch, type Member, type MemberKind, type PaneSet, type Settings } from './types'

type Loose = Record<string, unknown>

function isLoose(value: unknown): value is Loose {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/** 1.1 said agent and artifact; 1.2 says skill and domain. Both spellings are read. */
function kindOf(value: unknown): MemberKind | null {
  if (value === 'skill' || value === 'agent') return 'skill'
  if (value === 'domain' || value === 'artifact') return 'domain'
  return null
}

function asMember(m: Loose): Member | null {
  const kind = kindOf(m.kind)
  if (!kind) return null
  return { id: str(m.id), kind, name: str(m.name), emoji: str(m.emoji), path: str(m.path) }
}

function asBunch(b: Loose): Bunch {
  return {
    id: str(b.id),
    name: str(b.name),
    emoji: str(b.emoji, '👥'),
    rawPath: str(b.rawPath),
    skillIds: strings(b.skillIds ?? b.agentIds),
    domainIds: strings(b.domainIds ?? b.artifactIds)
  }
}

function asPanes(value: unknown): PaneSet {
  if (isLoose(value)) {
    const panes = { bunch: value.bunch === true, raw: value.raw === true, rendered: value.rendered === true }
    if (panes.bunch || panes.raw || panes.rendered) return panes
  }
  return { ...DEFAULT_SETTINGS.panes }
}

function asWidths(value: unknown): [number, number, number] {
  const fine =
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0)
  return fine ? [value[0], value[1], value[2]] : [...DEFAULT_SETTINGS.paneWidths]
}

/** Folds every older spelling of a setting into the 1.2 shape. */
function finish(rest: Loose, members: Member[], bunches: Bunch[], forceMirror: boolean): Settings {
  const {
    mirrorAgentsAsTags,
    mirrorMembersAsTags,
    mirrorTicksAsTags,
    seenCoachmark,
    seenWelcome,
    panes,
    paneWidths,
    yamlFolded,
    schemaVersion,
    ...others
  } = rest
  void mirrorAgentsAsTags
  void schemaVersion
  const mirror = forceMirror
    ? true
    : typeof mirrorTicksAsTags === 'boolean'
      ? mirrorTicksAsTags
      : typeof mirrorMembersAsTags === 'boolean'
        ? mirrorMembersAsTags
        : true
  return {
    ...DEFAULT_SETTINGS,
    ...(others as Partial<Settings>),
    schemaVersion: 3,
    members,
    bunches,
    mirrorTicksAsTags: mirror,
    seenWelcome: seenWelcome === true || seenCoachmark === true,
    panes: asPanes(panes),
    paneWidths: asWidths(paneWidths),
    yamlFolded: typeof yamlFolded === 'boolean' ? yamlFolded : true
  }
}

/**
 * Settings on disk may be any earlier shape:
 *  - 1.0: folder and agent members, no bunches. Folders become domains, agents become
 *    skills with no folder, and each agent that read folders becomes a bunch. The 1.0
 *    mirror value is discarded on purpose: 1.0 always stored false, but mirroring now
 *    defaults to on.
 *  - 1.1: agents, artifacts, agentIds, artifactIds, mirrorMembersAsTags, seenCoachmark.
 *  - 1.2: skills, domains, schemaVersion 3.
 * Nothing on disk outside settings.json changes, and running this twice is harmless.
 */
export function migrateSettings(raw: unknown): Settings {
  const parsed: Loose = isLoose(raw) ? raw : {}
  const list = Array.isArray(parsed.members) ? parsed.members.filter(isLoose) : []
  const { members: legacyMembers, bunches: legacyBunches, ...rest } = parsed
  void legacyMembers
  void legacyBunches

  const isOne = !Array.isArray(parsed.bunches) && list.some((m) => m.kind === 'folder' || Array.isArray(m.folderIds))

  if (!isOne) {
    const seenIds = new Set<string>()
    const members: Member[] = []
    for (const m of list) {
      const member = asMember(m)
      if (!member || member.id === '' || seenIds.has(member.id)) continue
      seenIds.add(member.id)
      members.push(member)
    }
    const bunches = Array.isArray(parsed.bunches) ? parsed.bunches.filter(isLoose).map(asBunch) : []
    return finish(rest, members, bunches, false)
  }

  const seenIds = new Set<string>()
  const keptEntries: Loose[] = []
  for (const m of list) {
    const id = str(m.id)
    if (id === '' || seenIds.has(id)) continue
    if (m.kind !== 'folder' && m.kind !== 'agent' && m.kind !== 'artifact') continue
    seenIds.add(id)
    keptEntries.push(m)
  }

  const members: Member[] = keptEntries.map((m) => {
    const id = str(m.id)
    if (m.kind === 'agent') {
      return { id, kind: 'skill', name: str(m.name, 'skill'), emoji: str(m.emoji, '🤖'), path: str(m.path) }
    }
    return { id, kind: 'domain', name: str(m.name, 'Folder'), emoji: str(m.emoji, '📁'), path: str(m.path) }
  })
  const domainIds = members.filter((m) => m.kind === 'domain').map((m) => m.id)

  const bunches: Bunch[] = []
  for (const m of keptEntries) {
    if (m.kind !== 'agent') continue
    const id = str(m.id)
    const folderIds = strings(m.folderIds).filter((fid) => domainIds.includes(fid))
    if (folderIds.length === 0) continue
    bunches.push({
      id: `b-${id}`,
      name: str(m.name, 'skill'),
      emoji: str(m.emoji, '🤖'),
      rawPath: '',
      skillIds: [id],
      domainIds: folderIds
    })
  }

  return finish(rest, members, bunches, true)
}
```

Note the 1.0 detection changed: the old code treated "no `bunches` key" as 1.0. That wrongly sent the 1.1-shaped-members-without-bunches case down the 1.0 path only to rely on `path` being copied. Now a file is 1.0 only when it has no bunches and some member is a `folder` or carries `folderIds`. The "duplicate ids" test (agents with `folderIds: []`) still takes the 1.0 path and keeps the first.

- [ ] **Step 5: Run the migration tests**

Run: `npm test -- tests/unit/migrate.test.ts`
Expected: PASS (all tests).

- [ ] **Step 6: Rename the shared helpers**

Replace `src/shared/bunch.ts` with:

```ts
import type { Bunch, Member, MemberKind } from './types'
import { toForwardSlashes } from './paths'

/** Everything the front matter and the ledger need to say about who a note is for. */
export interface BunchStamp {
  bunch: string
  skills: string[]
  skillPaths: string[]
  domains: string[]
  domainPaths: string[]
  /** Only ids that resolve to a member of the right kind. */
  skillIds: string[]
  domainIds: string[]
  tags: string[]
}

/** Resolves a bunch's ids to real members, dropping ids that are missing or the wrong kind. */
export function membersOf(bunch: Bunch, members: Member[]): { skills: Member[]; domains: Member[] } {
  const byId = new Map(members.map((m) => [m.id, m]))
  const pick = (ids: string[], kind: MemberKind): Member[] =>
    [...new Set(ids)].map((id) => byId.get(id)).filter((m): m is Member => m !== undefined && m.kind === kind)
  return { skills: pick(bunch.skillIds, 'skill'), domains: pick(bunch.domainIds, 'domain') }
}

export function buildStamp(bunch: Bunch, members: Member[], mirrorAsTags: boolean): BunchStamp {
  const { skills, domains } = membersOf(bunch, members)
  const tags: string[] = []
  if (mirrorAsTags) {
    for (const s of skills) tags.push(`skill/${s.name}`)
    for (const d of domains) tags.push(`domain/${d.name}`)
  }
  return {
    bunch: bunch.name,
    skills: skills.map((s) => s.name),
    skillPaths: skills.map((s) => toForwardSlashes(s.path)),
    domains: domains.map((d) => d.name),
    domainPaths: domains.map((d) => toForwardSlashes(d.path)),
    skillIds: skills.map((s) => s.id),
    domainIds: domains.map((d) => d.id),
    tags
  }
}
```

In `src/shared/ledger.ts`, rename the parameters and fields only:

```ts
/** Member ids must not contain `|`, or two distinct pairs could collide on the same key. */
export function pairKey(skillId: string, domainId: string): string {
  return `${skillId}|${domainId}`
}

/** How many archive copies carried both members, keyed by pairKey. */
export function pairCounts(entries: LedgerEntry[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    for (const skillId of new Set(entry.skillIds)) {
      for (const domainId of new Set(entry.domainIds)) {
        const key = pairKey(skillId, domainId)
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
  }
  return counts
}
```

(`lastBunchFor` is unchanged.)

Replace `src/shared/memberKind.ts` with:

```ts
import type { MemberKind } from './types'

/** Anything that makes a folder look like it holds skills rather than one subject's material. */
export const SKILL_MARKERS = ['claude.md', 'agents.md', '.claude', 'skills']

/** Proposes a kind for a folder from the names of its top-level entries. */
export function proposeKind(entryNames: string[]): MemberKind {
  const lower = entryNames.map((name) => name.toLowerCase())
  return SKILL_MARKERS.some((marker) => lower.includes(marker)) ? 'skill' : 'domain'
}
```

- [ ] **Step 7: Rename the stamp keys in `src/shared/markdown/frontmatter.ts`**

Make these four edits.

(a) Replace the two constants above `applyPatch`:

```ts
/** Keys a second-brain script greps line by line, so they are written one item per line. */
const BLOCK_LIST_KEYS = new Set(['skills', 'skill_paths', 'domains', 'domain_paths'])

/** Tags in these namespaces belong to the app and are rewritten from the ticks. 1.1 used agent/ and artifact/. */
export const MIRRORED_TAG = /^(skill|domain|agent|artifact)\//
```

(b) Export `normaliseTags` (change `function normaliseTags` to `export function normaliseTags`).

(c) In `interface Stamp`, replace the five bunch fields with:

```ts
  /** Set when filing to a bunch. Replaces bunch, skills, skill_paths, domains and domain_paths wholesale. */
  bunch?: string
  skills?: string[]
  skillPaths?: string[]
  domains?: string[]
  domainPaths?: string[]
```

(d) In `stampNote`, replace the four list lines of the patch (`agents:` through `artifact_paths:`) with:

```ts
    skills: list(stamp.skills),
    skill_paths: list(stamp.skillPaths),
    domains: list(stamp.domains),
    domain_paths: list(stamp.domainPaths),
    // 1.1 keys go the first time the note is filed again
    agents: filing ? null : undefined,
    agent_paths: filing ? null : undefined,
    artifacts: filing ? null : undefined,
    artifact_paths: filing ? null : undefined,
```

- [ ] **Step 8: Update the unit tests that use the old names**

- `tests/unit/bunch.test.ts`: members use `kind: 'skill'` / `'domain'`; the bunch uses `skillIds: ['a1', 'a2', 'ghost'], domainIds: ['x1', 'a1']`; `membersOf` returns `{ skills, domains }`; `buildStamp` fields are `skills`, `skillPaths`, `domains`, `domainPaths`, `skillIds`, `domainIds`; mirrored tags are `skill/<name>` and `domain/<name>`. Keep every assertion's meaning.
- `tests/unit/ledger.test.ts`: entries use `skillIds`, `domainIds`, `archivedAt` in place of `agentIds`, `artifactIds`, `filedAt`. Test names say "skill and domain".
- `tests/unit/memberKind.test.ts`: expected values `'skill'` / `'domain'`; `AGENT_MARKERS` becomes `SKILL_MARKERS`.
- `tests/unit/frontmatter.test.ts`, the `stampNote` describes only: `agents`/`agentPaths`/`artifacts`/`artifactPaths` become `skills`/`skillPaths`/`domains`/`domainPaths`, and the expected YAML keys become `skills:`, `skill_paths:`, `domains:`, `domain_paths:`, tags `skill/…`, `domain/…`. In "refiling replaces every stamp key wholesale", the source note keeps the old 1.1 keys (`agents:`, `agent_paths:`, `artifacts:`, `artifact_paths:`) and the test additionally asserts the output contains none of those four keys. Leave the `mergeFrontMatter` tests that use `agents` as an arbitrary key name as they are.
- `tests/unit/selection.test.ts`: members and bunches use the new kinds and id lists; the blocked reason text becomes `Add a skill or a domain to <name> first.`
- `tests/unit/document.test.ts` line ~203: change the sample `agents: [librarian]` to `skills: [librarian]`.

- [ ] **Step 9: Rename the renderer and main process**

Apply this rename table everywhere in `src/` (types will guide you; `npm run typecheck` lists every site):

| Old | New |
|---|---|
| `kind: 'agent'` / `'agent'` as a MemberKind | `'skill'` |
| `kind: 'artifact'` / `'artifact'` as a MemberKind | `'domain'` |
| `agentIds` / `artifactIds` | `skillIds` / `domainIds` |
| `filedAt` (LedgerEntry) | `archivedAt` |
| `mirrorMembersAsTags` | `mirrorTicksAsTags` |
| `seenCoachmark` | `seenWelcome` |
| `buildStamp(...).agents` etc. | `.skills`, `.skillPaths`, `.domains`, `.domainPaths`, `.skillIds`, `.domainIds` |
| `AGENT_EMOJI` / `ARTIFACT_EMOJI` | `SKILL_EMOJI` / `DOMAIN_EMOJI` |

Specific spots:
- `src/renderer/App.tsx` `performFiling`: the `stampNote` call passes `skills: who.skills, skillPaths: who.skillPaths, domains: who.domains, domainPaths: who.domainPaths`; the ledger entry is `{ noteId: id, bunchId: bunch.id, skillIds: who.skillIds, domainIds: who.domainIds, archivedAt: nowLocalIso() }`. `removeMember` filters `skillIds` / `domainIds`. `openCell(skillId, domainId)` and its dialog preset use `{ skillIds: [skillId], domainIds: [domainId] }`. `DialogState`'s bunch preset becomes `{ skillIds: string[]; domainIds: string[] }`.
- `src/renderer/funkybunch/selection.ts`: `const { skills, domains } = membersOf(...)`, `memberCount = skills.length + domains.length`, blocked reason `` `Add a skill or a domain to ${bunch.name} first.` ``.
- `src/renderer/funkybunch/Strip.tsx`: tooltip `'add a skill or a domain first'`; coachmark text: `Your <strong>Funky Bunch</strong> lives here. Add a skill, add a domain, then make a bunch.`; board button title `Team board - your skills and domains`.
- `src/renderer/funkybunch/TeamBoard.tsx`: `skills`/`domains` locals; footer buttons `Add a skill` / `Add a domain`; lead text: `<strong>Skills</strong> across the top are folders that do a kind of work. <strong>Domains</strong> down the side are folders that gather everything about one subject. A number is how many notes were filed to both. Click a square to make or open the bunch that pairs them. Click a name to edit it.`; empty state buttons `Add a skill` / `Add a domain`; muted hints `Add a skill to fill in the columns.` / `Add a domain to fill in the rows.`; prop `onCell(skillId, domainId)`. Keep the CSS class names (`board-agent`, `board-artifact`) for now; Task 9 deletes this file.
- `src/renderer/funkybunch/MemberDialog.tsx`: `SKILL_EMOJI = ['🤖', '🎓', '🔬', '✍️', '📚', '🧑‍🏫', '✅', '🔍', '🧮', '🗣️']`, `DOMAIN_EMOJI = ['📁', '📕', '🚀', '🎸', '🗄️', '💡', '📓', '🧠', '🗂️', '⭐']`; lead text `A <strong>skill</strong> folder does a kind of work: it holds skills and instructions, like a CLAUDE.md. A <strong>domain</strong> folder gathers everything about one subject.`; segmented buttons `A skill` / `A domain`; titles `Edit skill` / `Edit domain` / `Add a skill` / `Add a domain`; new id prefix `s` for skills and `d` for domains; name hint `Lower case, no spaces, like study-coach.` for skills; skill names are still lower-cased with spaces turned into `-`; fallback names `skill` / `Folder`.
- `src/renderer/funkybunch/BunchDialog.tsx`: preset type `{ skillIds: string[]; domainIds: string[] }`; lead text `A bunch is a saved group of skills and domains, like a group chat, plus the raw folder its archive copies go to.`; fields `Skills` / `Domains`; empty hints `No skills yet. Add one from the team board.` / `No domains yet. Add one from the team board.`
- `src/renderer/frontmatter/PropertiesPanel.tsx`: `SHOWN_FIRST` lists `'skills'` where it had `'agents'`; the summary reads `data.skills` and shows `for <names>`; rename the local and the CSS class `props-agents` to `props-skills` (also in `styles.css`).
- `src/renderer/ui/SettingsDialog.tsx`: checkbox bound to `mirrorTicksAsTags`, label `Also add each skill and domain as a tag, like skill/study-coach (handy in Obsidian)`.
- `src/renderer/ui/HelpDialog.tsx`, The Funky Bunch section, for now: `Down the left edge are your <strong>bunches</strong>. A bunch is a group of <strong>skills</strong> (folders that do a kind of work) and <strong>domains</strong> (folders that gather one subject), like a group chat. Click the bunch this note is for, then press File.` / `Filing writes the note once, into that bunch's raw folder, with the skills and domains written into the note's properties so your second brain knows who it is for.` / `The team board (the grid button on the strip) shows your skills across the top and your domains down the side, with how many notes have gone to each pair.` Task 13 rewrites this section again.
- `src/main/welcome.ts`: `'- [ ] Open the team board (the grid button on the left edge) and add a skill and a domain',` and `'the skills and domains in that bunch. Your second brain takes it from there.',`. Task 13 rewrites it again.
- `src/main/index.ts`: `ensureWelcomeNote` checks `settings.seenWelcome`; the diagnostics report counts `skills` and `domains` and prints `Skills: ${skills}, Domains: ${domains}, Bunches: ...`.

- [ ] **Step 10: Update the e2e tests**

In `tests/e2e/helpers.ts`:

```ts
export async function launch(
  dirs: Dirs,
  options: { settings?: Record<string, unknown>; openFile?: string } = {}
): Promise<Harness> {
  // seenWelcome true stops the welcome note appearing, keeping tests deterministic
  const settings = { seenWelcome: true, autosave: true, members: [], bunches: [], ...options.settings }
```

and replace the three member helpers and `team` with:

```ts
export function skillMember(id: string, name: string, emoji: string, path: string) {
  return { id, kind: 'skill', name, emoji, path }
}

export function domainMember(id: string, name: string, emoji: string, path: string) {
  return { id, kind: 'domain', name, emoji, path }
}

export function bunch(id: string, name: string, emoji: string, rawPath: string, skillIds: string[], domainIds: string[]) {
  return { id, name, emoji, rawPath, skillIds, domainIds }
}

/** One skill, one domain, one bunch called study that archives into dirs.raw. */
export function team(dirs: Dirs) {
  return {
    members: [
      skillMember('a1', 'librarian', '\u{1F4DA}', dirs.agent),
      domainMember('x1', 'thesis', '\u{1F4D5}', dirs.artifact)
    ],
    bunches: [bunch('b1', 'study', '\u{1F465}', dirs.raw, ['a1'], ['x1'])]
  }
}
```

(The `Dirs` fields `agent` and `artifact` keep their names; they are just folders.)

Then:
- `filing.spec.ts` and `board.spec.ts`: import `skillMember`/`domainMember` in place of `agentMember`/`artifactMember`. Expected stamp text becomes `'skills:\n  - librarian'`, `'skill_paths:'`, `'domains:\n  - thesis'`, `'domain_paths:'`, `'skill/librarian'`, `'domain/thesis'`.
- `firstrun.spec.ts`: no change needed (it checks the coachmark contains `Funky Bunch`).
- `packaged.spec.ts` and `shot.spec.ts`: the inline settings use `seenWelcome: true`, `kind: 'skill'` / `'domain'`, and `skillIds` / `domainIds`. `packaged.spec.ts` expects `bunch: study` still.

- [ ] **Step 11: Check nothing user-facing still says agent or artifact**

Run: `grep -rniE "agent|artifact" src tests/unit tests/e2e --include=*.ts --include=*.tsx`
Expected: hits only in `src/shared/migrate.ts` (reading 1.0/1.1 data), `src/shared/markdown/frontmatter.ts` (`MIRRORED_TAG` and the 1.1 key cleanup), `src/main/ipc/ai.ts` (unrelated uses such as user-agent, if any), `tests/unit/migrate.test.ts`, `tests/unit/frontmatter.test.ts` (the 1.1 source note and generic merge tests), CSS class names `board-agent`/`board-artifact`, and the e2e `Dirs` fields `agent`/`artifact`. Fix anything else.

- [ ] **Step 12: Verify**

Run: `npm run verify`
Expected: typecheck clean, all unit tests pass, build succeeds, all e2e pass.

- [ ] **Step 13: Commit**

```bash
git add -A src tests
git commit -m "Rename agents and artifacts to skills and domains

Settings migrate to schema 3: skill and domain kinds, skillIds and
domainIds, mirrorTicksAsTags, seenWelcome, plus pane and YAML fold
settings. Filing now writes skills and domains keys and removes the
1.1 keys from a note it refiles.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Ledger normalisation and one-time backups

**Files:**
- Modify: `src/shared/ledger.ts`, `src/main/ipc/ledger.ts`, `src/main/ipc/settings.ts`, `src/main/index.ts`, `src/preload/index.ts`
- Create: `src/main/ipc/backup.ts`
- Test: `tests/unit/ledger.test.ts`, `tests/unit/backup.test.ts`

- [ ] **Step 1: Write the failing ledger tests**

Append to `tests/unit/ledger.test.ts` (and add `archiveCount, isLegacyLedger, normaliseLedgerEntry` to its import from `@shared/ledger`):

```ts
describe('normaliseLedgerEntry', () => {
  test('passes a 1.2 entry through', () => {
    const entry = { noteId: 'n', bunchId: 'b', skillIds: ['s'], domainIds: ['d'], archivedAt: 't' }
    expect(normaliseLedgerEntry(entry)).toEqual(entry)
  })

  test('reads a 1.1 entry under the new names', () => {
    expect(
      normaliseLedgerEntry({ noteId: 'n', bunchId: 'b', agentIds: ['a'], artifactIds: ['x'], filedAt: 't' })
    ).toEqual({ noteId: 'n', bunchId: 'b', skillIds: ['a'], domainIds: ['x'], archivedAt: 't' })
  })

  test('rejects entries with missing or malformed fields', () => {
    expect(normaliseLedgerEntry(null)).toBeNull()
    expect(normaliseLedgerEntry([])).toBeNull()
    expect(normaliseLedgerEntry({ noteId: 'n', bunchId: 'b', skillIds: ['s'], domainIds: ['d'] })).toBeNull()
    expect(
      normaliseLedgerEntry({ noteId: 'n', bunchId: 'b', skillIds: [1], domainIds: ['d'], archivedAt: 't' })
    ).toBeNull()
  })
})

describe('isLegacyLedger', () => {
  test('is true when any entry still uses the 1.1 names', () => {
    expect(isLegacyLedger([{ noteId: 'n', bunchId: 'b', agentIds: [], artifactIds: [], filedAt: 't' }])).toBe(true)
  })

  test('is false for a 1.2 ledger, an empty one, or rubbish', () => {
    expect(isLegacyLedger([{ noteId: 'n', bunchId: 'b', skillIds: [], domainIds: [], archivedAt: 't' }])).toBe(false)
    expect(isLegacyLedger([])).toBe(false)
    expect(isLegacyLedger('nope')).toBe(false)
  })
})

describe('archiveCount', () => {
  test('counts the archive copies of one note', () => {
    expect(archiveCount(entries, 'n1')).toBe(2)
    expect(archiveCount(entries, 'n2')).toBe(1)
    expect(archiveCount(entries, 'n9')).toBe(0)
    expect(archiveCount(entries, '')).toBe(0)
  })
})
```

Run: `npm test -- tests/unit/ledger.test.ts`
Expected: FAIL, the three functions are not exported.

- [ ] **Step 2: Implement them in `src/shared/ledger.ts`**

Append:

```ts
function idList(primary: unknown, legacy: unknown): string[] | null {
  const list = primary !== undefined ? primary : legacy
  return Array.isArray(list) && list.every((v) => typeof v === 'string') ? (list as string[]) : null
}

/** Reads one ledger entry in the 1.2 shape or the 1.1 shape (agentIds, artifactIds, filedAt). */
export function normaliseLedgerEntry(value: unknown): LedgerEntry | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const skillIds = idList(v.skillIds, v.agentIds)
  const domainIds = idList(v.domainIds, v.artifactIds)
  const archivedAt = typeof v.archivedAt === 'string' ? v.archivedAt : typeof v.filedAt === 'string' ? v.filedAt : null
  if (typeof v.noteId !== 'string' || typeof v.bunchId !== 'string') return null
  if (skillIds === null || domainIds === null || archivedAt === null) return null
  return { noteId: v.noteId, bunchId: v.bunchId, skillIds, domainIds, archivedAt }
}

/** True when the parsed ledger file still holds 1.1 entries, so it should be backed up before rewriting. */
export function isLegacyLedger(parsed: unknown): boolean {
  if (!Array.isArray(parsed)) return false
  return parsed.some(
    (e) => e !== null && typeof e === 'object' && ('agentIds' in e || 'artifactIds' in e || 'filedAt' in e)
  )
}

/** How many archive copies a note has. */
export function archiveCount(entries: LedgerEntry[], noteId: string): number {
  if (noteId.length === 0) return 0
  return entries.filter((e) => e.noteId === noteId).length
}
```

Run: `npm test -- tests/unit/ledger.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing backup test**

Create `tests/unit/backup.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backupOnce } from '../../src/main/ipc/backup'

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'marki-backup-'))
}

describe('backupOnce', () => {
  test('copies the file the first time', () => {
    const dir = scratch()
    writeFileSync(join(dir, 'settings.json'), 'old', 'utf8')
    expect(backupOnce(join(dir, 'settings.json'), join(dir, 'settings.v2.bak.json'))).toBe(true)
    expect(readFileSync(join(dir, 'settings.v2.bak.json'), 'utf8')).toBe('old')
  })

  test('never overwrites an existing backup', () => {
    const dir = scratch()
    writeFileSync(join(dir, 'settings.json'), 'newer', 'utf8')
    writeFileSync(join(dir, 'settings.v2.bak.json'), 'first', 'utf8')
    expect(backupOnce(join(dir, 'settings.json'), join(dir, 'settings.v2.bak.json'))).toBe(false)
    expect(readFileSync(join(dir, 'settings.v2.bak.json'), 'utf8')).toBe('first')
  })

  test('does nothing when there is no source file', () => {
    const dir = scratch()
    expect(backupOnce(join(dir, 'missing.json'), join(dir, 'missing.bak.json'))).toBe(false)
    expect(existsSync(join(dir, 'missing.bak.json'))).toBe(false)
  })
})
```

Run: `npm test -- tests/unit/backup.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Create `src/main/ipc/backup.ts`**

No Electron import here, so vitest can load it.

```ts
import { copyFileSync, existsSync } from 'node:fs'

/**
 * Copies a file aside before its old shape is rewritten. Runs at most once per backup
 * name and never overwrites an earlier backup. Returns true when it made a copy. A
 * failure is swallowed: a missing backup must never stop the app from starting.
 */
export function backupOnce(source: string, backup: string): boolean {
  try {
    if (existsSync(backup) || !existsSync(source)) return false
    copyFileSync(source, backup)
    return true
  } catch {
    return false
  }
}
```

Run: `npm test -- tests/unit/backup.test.ts`
Expected: PASS.

- [ ] **Step 5: Use them in the main process**

Replace `src/main/ipc/ledger.ts` with:

```ts
import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import log from 'electron-log/main'
import type { LedgerEntry } from '../../shared/types'
import { isLegacyLedger, normaliseLedgerEntry } from '../../shared/ledger'
import { backupOnce } from './backup'

function ledgerPath(): string {
  return join(app.getPath('userData'), 'ledger.json')
}

/** Every archive copy the app has made. 1.1 entries are read under the new names; rubbish is dropped. */
export function readLedger(): LedgerEntry[] {
  try {
    const parsed = JSON.parse(readFileSync(ledgerPath(), 'utf8')) as unknown
    if (isLegacyLedger(parsed)) backupOnce(ledgerPath(), join(app.getPath('userData'), 'ledger.v2.bak.json'))
    if (!Array.isArray(parsed)) return []
    return parsed.map(normaliseLedgerEntry).filter((e): e is LedgerEntry => e !== null)
  } catch {
    return []
  }
}

/**
 * Appends one entry and returns the whole ledger. A ledger that cannot be written is
 * logged and returned unchanged with saved false: the copy is safely on disk, only the
 * count is stale.
 */
export function appendLedger(entry: LedgerEntry): { entries: LedgerEntry[]; saved: boolean } {
  const current = readLedger()
  const next = [...current, entry]
  try {
    const target = ledgerPath()
    mkdirSync(dirname(target), { recursive: true })
    const temp = `${target}.tmp`
    writeFileSync(temp, JSON.stringify(next, null, 2), 'utf8')
    renameSync(temp, target)
    return { entries: next, saved: true }
  } catch (error) {
    log.error('Could not write the ledger', error)
    return { entries: current, saved: false }
  }
}
```

In `src/main/ipc/settings.ts`, change `readSettings` to back up a pre-1.2 file once:

```ts
export function readSettings(): Settings {
  if (cache) return cache
  try {
    const raw = readFileSync(settingsPath(), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    const version = parsed !== null && typeof parsed === 'object' ? (parsed as { schemaVersion?: unknown }).schemaVersion : undefined
    if (version !== 3) backupOnce(settingsPath(), join(app.getPath('userData'), 'settings.v2.bak.json'))
    cache = migrateSettings(parsed)
  } catch {
    cache = { ...DEFAULT_SETTINGS }
  }
  return cache
}
```

and add `import { backupOnce } from './backup'`.

In `src/main/index.ts`, the ledger handler becomes:

```ts
ipcMain.handle('ledger:append', (_e, entry: LedgerEntry) => ok(appendLedger(entry)))
```

In `src/preload/index.ts`, the `ledger.append` return type becomes `Promise<Result<{ entries: LedgerEntry[]; saved: boolean }>>`.

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm test`
Expected: clean, all pass.

- [ ] **Step 7: Commit**

```bash
git add -A src tests
git commit -m "Read 1.1 ledger entries under the new names and back up old files once

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `readTicks`: the grid reads the YAML

**Files:**
- Create: `src/shared/ticks.ts`
- Test: `tests/unit/ticks.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/ticks.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { readTicks } from '@shared/ticks'
import type { Member } from '@shared/types'

const BS = String.fromCharCode(92)
export const members: Member[] = [
  { id: 's1', kind: 'skill', name: 'writer', emoji: '✍️', path: `C:${BS}me${BS}skills${BS}writer` },
  { id: 's2', kind: 'skill', name: 'editor', emoji: '🔍', path: '/me/skills/editor' },
  { id: 'd1', kind: 'domain', name: 'Biology', emoji: '🧪', path: '/me/domains/biology' },
  { id: 'd2', kind: 'domain', name: 'History', emoji: '📜', path: '/me/domains/history' }
]

describe('readTicks', () => {
  test('a note with no front matter has no ticks', () => {
    const r = readTicks(null, members)
    expect(r).toEqual({
      ok: true, skillIds: [], domainIds: [], skillNames: [], domainNames: [],
      unknown: [], bunch: null, usedAliases: false, tagCount: 0
    })
  })

  test('maps names to ids, ignoring case', () => {
    const r = readTicks('---\nskills: [Writer, editor]\ndomains: [biology]\n---\n', members)
    expect(r.skillIds).toEqual(['s1', 's2'])
    expect(r.domainIds).toEqual(['d1'])
    expect(r.skillNames).toEqual(['Writer', 'editor'])
    expect(r.unknown).toEqual([])
  })

  test('reads block lists and comma strings', () => {
    expect(readTicks('---\nskills:\n  - writer\n  - editor\n---\n', members).skillIds).toEqual(['s1', 's2'])
    expect(readTicks('---\ndomains: Biology, History\n---\n', members).domainIds).toEqual(['d1', 'd2'])
  })

  test('reports names nobody in the roster has', () => {
    const r = readTicks('---\nskills: [writer, ghost]\ndomains: [Chemistry]\n---\n', members)
    expect(r.skillIds).toEqual(['s1'])
    expect(r.unknown).toEqual([
      { name: 'ghost', kind: 'skill' },
      { name: 'Chemistry', kind: 'domain' }
    ])
    expect(r.skillNames).toEqual(['writer', 'ghost'])
  })

  test('a skill name is not matched against domains', () => {
    const r = readTicks('---\nskills: [Biology]\n---\n', members)
    expect(r.skillIds).toEqual([])
    expect(r.unknown).toEqual([{ name: 'Biology', kind: 'skill' }])
  })

  test('reads the 1.1 keys as aliases', () => {
    const r = readTicks('---\nagents:\n  - writer\nartifacts:\n  - History\n---\n', members)
    expect(r.skillIds).toEqual(['s1'])
    expect(r.domainIds).toEqual(['d2'])
    expect(r.usedAliases).toBe(true)
  })

  test('the new key wins when both are present', () => {
    const r = readTicks('---\nskills: [writer]\nagents: [editor]\n---\n', members)
    expect(r.skillIds).toEqual(['s1'])
    expect(r.usedAliases).toBe(false)
  })

  test('counts a repeated name once', () => {
    expect(readTicks('---\nskills: [writer, Writer]\n---\n', members).skillIds).toEqual(['s1'])
  })

  test('reads the bunch name and the tag count', () => {
    const r = readTicks('---\nbunch: "  Class prep "\ntags: [a, b, "#c"]\n---\n', members)
    expect(r.bunch).toBe('Class prep')
    expect(r.tagCount).toBe(3)
    expect(readTicks('---\ntitle: x\n---\n', members).bunch).toBeNull()
  })

  test('unreadable YAML reports ok false', () => {
    const r = readTicks('---\ntitle: My note: draft\n---\n', members)
    expect(r.ok).toBe(false)
    expect(r.skillIds).toEqual([])
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -- tests/unit/ticks.test.ts`
Expected: FAIL, cannot find `@shared/ticks`.

- [ ] **Step 3: Create `src/shared/ticks.ts`**

```ts
import type { Member, MemberKind } from './types'
import { normaliseTags, parseFrontMatter } from './markdown/frontmatter'

export interface Ticks {
  skillIds: string[]
  domainIds: string[]
}

export interface UnknownName {
  name: string
  kind: MemberKind
}

export interface TickReading extends Ticks {
  /** False when the front matter cannot be parsed. Nothing else is meaningful then. */
  ok: boolean
  /** Every name listed under skills (or 1.1 agents), known or not, as written. */
  skillNames: string[]
  domainNames: string[]
  /** Names in the YAML that match nobody of that kind in the roster. */
  unknown: UnknownName[]
  bunch: string | null
  /** The note still uses the 1.1 keys agents or artifacts. */
  usedAliases: boolean
  tagCount: number
}

function empty(ok: boolean): TickReading {
  return {
    ok,
    skillIds: [],
    domainIds: [],
    skillNames: [],
    domainNames: [],
    unknown: [],
    bunch: null,
    usedAliases: false,
    tagCount: 0
  }
}

/** A YAML list or an Obsidian-style comma string, trimmed, without case-insensitive repeats. */
function names(value: unknown): string[] {
  if (value === null || value === undefined) return []
  const list: unknown[] = Array.isArray(value) ? value : String(value).split(',')
  const out: string[] = []
  for (const item of list) {
    if (item === null || item === undefined || typeof item === 'object') continue
    const name = String(item).trim()
    if (name.length > 0 && !out.some((n) => n.toLowerCase() === name.toLowerCase())) out.push(name)
  }
  return out
}

function findMember(members: Member[], kind: MemberKind, name: string): Member | undefined {
  const lower = name.toLowerCase()
  return members.find((m) => m.kind === kind && m.name.toLowerCase() === lower)
}

/** Which skills and domains a note is ticked for, read straight from its front matter. */
export function readTicks(raw: string | null, members: Member[]): TickReading {
  if (raw === null) return empty(true)
  const parsed = parseFrontMatter(raw)
  if (!parsed.ok) return empty(false)
  const data = parsed.data

  const skillsKey = 'skills' in data ? 'skills' : 'agents' in data ? 'agents' : null
  const domainsKey = 'domains' in data ? 'domains' : 'artifacts' in data ? 'artifacts' : null
  const skillNames = skillsKey ? names(data[skillsKey]) : []
  const domainNames = domainsKey ? names(data[domainsKey]) : []

  const reading = empty(true)
  reading.skillNames = skillNames
  reading.domainNames = domainNames
  const resolve = (list: string[], kind: MemberKind, ids: string[]) => {
    for (const name of list) {
      const member = findMember(members, kind, name)
      if (member) {
        if (!ids.includes(member.id)) ids.push(member.id)
      } else {
        reading.unknown.push({ name, kind })
      }
    }
  }
  resolve(skillNames, 'skill', reading.skillIds)
  resolve(domainNames, 'domain', reading.domainIds)

  reading.bunch = typeof data.bunch === 'string' && data.bunch.trim().length > 0 ? data.bunch.trim() : null
  reading.usedAliases = skillsKey === 'agents' || domainsKey === 'artifacts'
  reading.tagCount = normaliseTags(data.tags).length
  return reading
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- tests/unit/ticks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ticks.ts tests/unit/ticks.test.ts
git commit -m "Read a note's skill and domain ticks from its YAML

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `applyTicks`: the grid writes the YAML

**Files:**
- Modify: `src/shared/ticks.ts`
- Test: `tests/unit/ticks.test.ts`

- [ ] **Step 1: Write the failing tests**

Change the import at the top of `tests/unit/ticks.test.ts` to:

```ts
import { applyTicks, readTicks, type ApplyOptions } from '@shared/ticks'
import { parseFrontMatter, splitFrontMatter } from '@shared/markdown/frontmatter'
```

and append:

```ts
const opts: ApplyOptions = {
  mirrorTags: true,
  preset: 'okf',
  newId: 'NEWID',
  now: '2026-10-04T15:00:00-04:00',
  title: ''
}

function data(raw: string | null): Record<string, unknown> {
  const parsed = parseFrontMatter(raw ?? '')
  if (!parsed.ok) throw new Error('unparseable')
  return parsed.data
}

describe('applyTicks', () => {
  test('gives a bare note an id, type, created and the ticks', () => {
    const out = applyTicks(null, { skillIds: ['s1'], domainIds: ['d1'] }, members, opts)
    const d = data(out)
    expect(d.id).toBe('NEWID')
    expect(d.type).toBe('note')
    expect(d.created).toBe('2026-10-04T15:00:00-04:00')
    expect(d.skills).toEqual(['writer'])
    expect(d.skill_paths).toEqual(['C:/me/skills/writer'])
    expect(d.domains).toEqual(['Biology'])
    expect(d.domain_paths).toEqual(['/me/domains/biology'])
    expect(d.tags).toEqual(['skill/writer', 'domain/biology'])
  })

  test('writes the lists as block lists, one item per line', () => {
    const out = applyTicks(null, { skillIds: ['s1', 's2'], domainIds: [] }, members, opts) as string
    expect(out).toContain('skills:\n  - writer\n  - editor')
    expect(out).toContain('skill_paths:\n  - C:/me/skills/writer\n  - /me/skills/editor')
  })

  test('returns only the front matter block, never body text', () => {
    const out = applyTicks('---\ntitle: x\n---\n', { skillIds: ['s1'], domainIds: [] }, members, opts) as string
    expect(splitFrontMatter(out).body).toBe('')
  })

  test('keeps keys and tags the student wrote', () => {
    const raw = '---\ntitle: Cells\nsource: lab book\ntags: [exam-prep]\n---\n'
    const d = data(applyTicks(raw, { skillIds: ['s1'], domainIds: [] }, members, opts))
    expect(d.title).toBe('Cells')
    expect(d.source).toBe('lab book')
    expect(d.tags).toEqual(['exam-prep', 'skill/writer'])
  })

  test('never changes an existing id, created or type', () => {
    const raw = '---\nid: OLD\ncreated: 2025-01-01\ntype: knowledge\n---\n'
    const d = data(applyTicks(raw, { skillIds: ['s1'], domainIds: [] }, members, opts))
    expect(d.id).toBe('OLD')
    expect(d.created).toBe('2025-01-01')
    expect(d.type).toBe('knowledge')
  })

  test('the basic preset writes no type', () => {
    const d = data(applyTicks(null, { skillIds: ['s1'], domainIds: [] }, members, { ...opts, preset: 'basic' }))
    expect('type' in d).toBe(false)
  })

  test('writes a title only when the note has none and one is given', () => {
    expect(data(applyTicks(null, { skillIds: ['s1'], domainIds: [] }, members, { ...opts, title: 'Cells' })).title).toBe('Cells')
    expect(data(applyTicks('---\ntitle: Mine\n---\n', { skillIds: [], domainIds: [] }, members, { ...opts, title: 'Cells' })).title).toBe('Mine')
    expect('title' in data(applyTicks(null, { skillIds: ['s1'], domainIds: [] }, members, opts))).toBe(false)
  })

  test('unticking everything removes the lists and the mirrored tags only', () => {
    const raw = applyTicks('---\ntags: [exam-prep]\n---\n', { skillIds: ['s1'], domainIds: ['d1'] }, members, opts)
    const d = data(applyTicks(raw, { skillIds: [], domainIds: [] }, members, opts))
    for (const key of ['skills', 'skill_paths', 'domains', 'domain_paths']) expect(key in d).toBe(false)
    expect(d.tags).toEqual(['exam-prep'])
    expect(d.id).toBe('NEWID')
  })

  test('removes the tags key when only mirrored tags were there', () => {
    const raw = applyTicks(null, { skillIds: ['s1'], domainIds: [] }, members, opts)
    const d = data(applyTicks(raw, { skillIds: [], domainIds: [] }, members, opts))
    expect('tags' in d).toBe(false)
  })

  test('with mirroring off, tags are left exactly alone', () => {
    const raw = '---\ntags: [skill/old, exam-prep]\n---\n'
    const d = data(applyTicks(raw, { skillIds: ['s1'], domainIds: [] }, members, { ...opts, mirrorTags: false }))
    expect(d.tags).toEqual(['skill/old', 'exam-prep'])
  })

  test('converts a 1.1 note to the new keys and tags', () => {
    const raw =
      '---\nagents:\n  - writer\nagent_paths:\n  - /old\nartifacts:\n  - Biology\nartifact_paths:\n  - /old2\ntags: [agent/writer, artifact/Biology, keep]\n---\n'
    const before = readTicks(raw, members)
    const d = data(applyTicks(raw, before, members, opts))
    for (const key of ['agents', 'agent_paths', 'artifacts', 'artifact_paths']) expect(key in d).toBe(false)
    expect(d.skills).toEqual(['writer'])
    expect(d.domains).toEqual(['Biology'])
    expect(d.tags).toEqual(['keep', 'skill/writer', 'domain/biology'])
  })

  test('keeps names nobody in the roster has, with an empty path', () => {
    const raw = '---\nskills: [writer, ghost]\n---\n'
    const d = data(applyTicks(raw, { skillIds: ['s1', 's2'], domainIds: [] }, members, opts))
    expect(d.skills).toEqual(['writer', 'editor', 'ghost'])
    expect(d.skill_paths).toEqual(['C:/me/skills/writer', '/me/skills/editor', ''])
  })

  test('sets, keeps and removes the bunch name', () => {
    const set = applyTicks(null, { skillIds: ['s1'], domainIds: [] }, members, { ...opts, bunch: 'Class prep' })
    expect(data(set).bunch).toBe('Class prep')
    expect(data(applyTicks(set, { skillIds: [], domainIds: [] }, members, opts)).bunch).toBe('Class prep')
    expect('bunch' in data(applyTicks(set, { skillIds: [], domainIds: [] }, members, { ...opts, bunch: null }))).toBe(false)
  })

  test('mirrored tags use lower case and dashes', () => {
    const roster: Member[] = [{ id: 'd9', kind: 'domain', name: 'Cell Biology', emoji: '🧪', path: '/x' }]
    expect(data(applyTicks(null, { skillIds: [], domainIds: ['d9'] }, roster, opts)).tags).toEqual(['domain/cell-biology'])
  })

  test('what it writes reads back as the same ticks', () => {
    const out = applyTicks(null, { skillIds: ['s2', 's1'], domainIds: ['d2'] }, members, opts)
    const r = readTicks(out, members)
    expect(new Set(r.skillIds)).toEqual(new Set(['s1', 's2']))
    expect(r.domainIds).toEqual(['d2'])
  })

  test('unreadable YAML is left alone', () => {
    expect(applyTicks('---\ntitle: My note: draft\n---\n', { skillIds: ['s1'], domainIds: [] }, members, opts)).toBeNull()
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -- tests/unit/ticks.test.ts`
Expected: FAIL, `applyTicks` is not exported.

- [ ] **Step 3: Implement `applyTicks`**

Change the frontmatter import in `src/shared/ticks.ts` to:

```ts
import {
  MIRRORED_TAG,
  mergeFrontMatter,
  normaliseTags,
  parseFrontMatter,
  type FrontMatterPatch
} from './markdown/frontmatter'
import { toForwardSlashes } from './paths'
```

and append:

```ts
export interface ApplyOptions {
  mirrorTags: boolean
  preset: 'okf' | 'basic'
  /** undefined leaves bunch alone, null or an empty string removes it, a name sets it. */
  bunch?: string | null
  /** Written as id only when the note has none yet. */
  newId: string
  /** Written as created only when the note has none yet. */
  now: string
  /** Written as title only when the note has none yet. Empty writes nothing. */
  title: string
}

function present(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim().length > 0
}

function slug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-')
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/**
 * Writes ticks into the front matter. This is the only writer of the app-owned keys
 * (bunch, skills, skill_paths, domains, domain_paths, mirrored tags, and on first use
 * id, type, title and created). Every other key and tag is left alone, and so is the
 * body: only the front matter block is returned. Names in the YAML that nobody in the
 * roster has are kept, with an empty path, so a student's typing is never lost. Returns
 * null when the front matter cannot be parsed, so the caller writes nothing.
 */
export function applyTicks(raw: string | null, ticks: Ticks, members: Member[], opts: ApplyOptions): string | null {
  const parsed = raw === null ? { ok: true as const, data: {} as Record<string, unknown> } : parseFrontMatter(raw)
  if (!parsed.ok) return null
  const data = parsed.data
  const before = readTicks(raw, members)

  const chosen = (kind: MemberKind, ids: string[]) => members.filter((m) => m.kind === kind && ids.includes(m.id))
  const strangers = (kind: MemberKind) => before.unknown.filter((u) => u.kind === kind).map((u) => u.name)
  const skills = chosen('skill', ticks.skillIds)
  const domains = chosen('domain', ticks.domainIds)

  const skillNames = [...skills.map((m) => m.name), ...strangers('skill')]
  const skillPaths = [...skills.map((m) => toForwardSlashes(m.path)), ...strangers('skill').map(() => '')]
  const domainNames = [...domains.map((m) => m.name), ...strangers('domain')]
  const domainPaths = [...domains.map((m) => toForwardSlashes(m.path)), ...strangers('domain').map(() => '')]

  let tags: string[] | null | undefined
  if (opts.mirrorTags) {
    const existing = normaliseTags(data.tags)
    const next = existing.filter((tag) => !MIRRORED_TAG.test(tag))
    const add = (tag: string) => {
      if (!next.includes(tag)) next.push(tag)
    }
    for (const name of skillNames) add(`skill/${slug(name)}`)
    for (const name of domainNames) add(`domain/${slug(name)}`)
    if (!sameList(next, existing)) tags = next.length > 0 ? next : null
  }

  const patch: FrontMatterPatch = {
    id: present(data.id) ? undefined : opts.newId,
    type: opts.preset === 'basic' || present(data.type) ? undefined : 'note',
    title: present(data.title) || opts.title.length === 0 ? undefined : opts.title,
    created: present(data.created) ? undefined : opts.now,
    bunch: opts.bunch === undefined ? undefined : opts.bunch === null || opts.bunch.trim().length === 0 ? null : opts.bunch,
    skills: skillNames.length > 0 ? skillNames : null,
    skill_paths: skillNames.length > 0 ? skillPaths : null,
    domains: domainNames.length > 0 ? domainNames : null,
    domain_paths: domainNames.length > 0 ? domainPaths : null,
    agents: null,
    agent_paths: null,
    artifacts: null,
    artifact_paths: null,
    tags
  }
  return mergeFrontMatter(raw, patch)
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- tests/unit/ticks.test.ts`
Expected: PASS. If "keeps keys and tags" fails on tag order, check that `normaliseTags` keeps the student's order; the mirrored tags must come after.

- [ ] **Step 5: Run everything and commit**

Run: `npm run typecheck && npm test`
Expected: clean, all pass.

```bash
git add src/shared/ticks.ts tests/unit/ticks.test.ts
git commit -m "Write skill and domain ticks into a note's YAML

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Time, archive naming, save planning and `addArchived`

**Files:**
- Create: `src/shared/time.ts`, `src/shared/archive.ts`
- Modify: `src/shared/markdown/frontmatter.ts`
- Test: `tests/unit/time.test.ts`, `tests/unit/archive.test.ts`, `tests/unit/frontmatter.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/time.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { localDate, nowLocalIso } from '@shared/time'

describe('time', () => {
  const d = new Date(2026, 9, 4, 5, 6, 7)

  test('localDate is the local calendar date', () => {
    expect(localDate(d)).toBe('2026-10-04')
  })

  test('nowLocalIso is local time with an offset', () => {
    const iso = nowLocalIso(d)
    expect(iso.startsWith('2026-10-04T05:06:07')).toBe(true)
    expect(iso).toMatch(/[+-]\d\d:\d\d$/)
  })
})
```

Create `tests/unit/archive.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { BLOCK_REASONS, archiveName, archiveStem, freeName, planSave, type SaveInput } from '@shared/archive'

describe('archive names', () => {
  test('the stem is the working name plus the date', () => {
    expect(archiveStem('essay.md', '2026-10-04')).toBe('essay-2026-10-04')
    expect(archiveStem('notes.txt', '2026-10-04')).toBe('notes-2026-10-04')
  })

  test('takes the plain name when it is free', () => {
    expect(archiveName('essay.md', '2026-10-04', [])).toBe('essay-2026-10-04.md')
  })

  test('adds -2, -3 on a clash, ignoring case', () => {
    expect(archiveName('essay.md', '2026-10-04', ['essay-2026-10-04.md'])).toBe('essay-2026-10-04-2.md')
    expect(archiveName('essay.md', '2026-10-04', ['Essay-2026-10-04.md', 'essay-2026-10-04-2.md'])).toBe(
      'essay-2026-10-04-3.md'
    )
  })

  test('a name that already ends in a date is not confused', () => {
    expect(archiveName('essay-2026-10-03.md', '2026-10-04', ['essay-2026-10-03.md'])).toBe(
      'essay-2026-10-03-2026-10-04.md'
    )
  })

  test('freeName works for any stem', () => {
    expect(freeName('cells', ['cells.md'])).toBe('cells-2.md')
  })
})

describe('planSave', () => {
  const good: SaveInput = { yamlOk: true, rawPath: '/raw', rawMissing: false, tickCount: 1, workingDir: '/drafts' }

  test('allows archiving when everything is in place', () => {
    expect(planSave(good)).toEqual({ canArchive: true, reason: '' })
  })

  test('an untitled note with no folder yet can still archive', () => {
    expect(planSave({ ...good, workingDir: '' }).canArchive).toBe(true)
  })

  test.each([
    [{ yamlOk: false }, BLOCK_REASONS.yaml],
    [{ rawPath: '' }, BLOCK_REASONS.noRaw],
    [{ rawMissing: true }, BLOCK_REASONS.missingRaw],
    [{ tickCount: 0 }, BLOCK_REASONS.noTicks],
    [{ workingDir: '/raw' }, BLOCK_REASONS.sameFolder]
  ])('blocks with %o', (change, reason) => {
    expect(planSave({ ...good, ...change })).toEqual({ canArchive: false, reason })
  })

  test('gives the first reason in the spec order', () => {
    expect(planSave({ ...good, yamlOk: false, rawPath: '', tickCount: 0 }).reason).toBe(BLOCK_REASONS.yaml)
    expect(planSave({ ...good, rawPath: '', tickCount: 0 }).reason).toBe(BLOCK_REASONS.noRaw)
    expect(planSave({ ...good, rawMissing: true, tickCount: 0 }).reason).toBe(BLOCK_REASONS.missingRaw)
    expect(planSave({ ...good, tickCount: 0, workingDir: '/raw' }).reason).toBe(BLOCK_REASONS.noTicks)
  })
})
```

Add to `tests/unit/frontmatter.test.ts` (and `addArchived` to its import):

```ts
describe('addArchived', () => {
  test('adds archived and leaves everything else, body included, alone', () => {
    const text = '---\nid: 01A\nskills:\n  - writer\n---\n# Body\n\nText.\n'
    const out = addArchived(text, '2026-10-04T15:20:00-04:00') as string
    expect(out).toContain('id: 01A')
    expect(out).toContain('skills:\n  - writer')
    expect(out).toContain('archived: 2026-10-04T15:20:00-04:00')
    expect(out.endsWith('# Body\n\nText.\n')).toBe(true)
  })

  test('replaces an archived value copied from an earlier archive', () => {
    const out = addArchived('---\narchived: old\n---\nx\n', 'new') as string
    expect(out).toContain('archived: new')
    expect(out).not.toContain('old')
  })

  test('gives a note with no front matter a block', () => {
    expect(addArchived('x\n', 'now')).toBe('---\narchived: now\n---\nx\n')
  })

  test('refuses unreadable front matter', () => {
    expect(addArchived('---\ntitle: a: b\n---\nx\n', 'now')).toBeNull()
  })
})
```

Run: `npm test -- tests/unit/time.test.ts tests/unit/archive.test.ts tests/unit/frontmatter.test.ts`
Expected: FAIL, the modules and `addArchived` do not exist.

- [ ] **Step 2: Create `src/shared/time.ts`**

```ts
function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** The local calendar date, like 2026-10-04. */
export function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** ISO 8601 in local time with its offset, like 2026-10-04T15:20:00-04:00. */
export function nowLocalIso(d: Date = new Date()): string {
  const offset = -d.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return (
    `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}
```

- [ ] **Step 3: Create `src/shared/archive.ts`**

```ts
import { samePath } from './paths'

/** The dated name an archive copy starts from, before any -2, -3 suffix. */
export function archiveStem(fileName: string, date: string): string {
  return `${fileName.replace(/\.(md|markdown|txt|text)$/i, '')}-${date}`
}

/** stem.md if nobody has it, else stem-2.md, stem-3.md, ... compared ignoring case. */
export function freeName(stem: string, existing: string[]): string {
  const taken = new Set(existing.map((name) => name.toLowerCase()))
  if (!taken.has(`${stem}.md`.toLowerCase())) return `${stem}.md`
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}.md`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}

export function archiveName(fileName: string, date: string, existing: string[]): string {
  return freeName(archiveStem(fileName, date), existing)
}

export const BLOCK_REASONS = {
  yaml: 'Fix the YAML first.',
  noRaw: 'Choose a raw folder to archive into.',
  missingRaw: "The raw folder can't be found.",
  noTicks: 'Tick at least one skill or domain.',
  sameFolder: 'This note already lives in the raw folder.'
} as const

export interface SaveInput {
  yamlOk: boolean
  rawPath: string
  /** The raw folder was checked and is not there. */
  rawMissing: boolean
  /** Skills plus domains named in the YAML, known or not. */
  tickCount: number
  /** Folder of the working file. Empty for an untitled note with no folder yet. */
  workingDir: string
}

export interface SavePlan {
  canArchive: boolean
  reason: string
}

/** Whether Save can also archive, and if not, the one reason to show. */
export function planSave(input: SaveInput): SavePlan {
  const block = (reason: string): SavePlan => ({ canArchive: false, reason })
  if (!input.yamlOk) return block(BLOCK_REASONS.yaml)
  if (input.rawPath.length === 0) return block(BLOCK_REASONS.noRaw)
  if (input.rawMissing) return block(BLOCK_REASONS.missingRaw)
  if (input.tickCount === 0) return block(BLOCK_REASONS.noTicks)
  if (input.workingDir.length > 0 && samePath(input.workingDir, input.rawPath)) return block(BLOCK_REASONS.sameFolder)
  return { canArchive: true, reason: '' }
}
```

- [ ] **Step 4: Add `addArchived` to `src/shared/markdown/frontmatter.ts`**

Append:

```ts
/**
 * The text of an archive copy: the working text with `archived:` set. The body bytes
 * are untouched. Returns null when the front matter cannot be read, so nothing is written.
 */
export function addArchived(text: string, archivedAt: string): string | null {
  const { raw, body } = splitFrontMatter(text)
  if (raw !== null && !parseFrontMatter(raw).ok) return null
  return mergeFrontMatter(raw, { archived: archivedAt }) + body
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- tests/unit/time.test.ts tests/unit/archive.test.ts tests/unit/frontmatter.test.ts`
Expected: PASS. If the no-front-matter case writes `archived: "now"` with quotes, check `mergeFrontMatter` scalar handling; the test expects plain `archived: now`.

- [ ] **Step 6: Use the shared time helper in the renderer**

In `src/renderer/App.tsx`, delete the local `nowLocalIso` function and add `import { nowLocalIso } from '@shared/time'`.

Run: `npm run typecheck && npm test`
Expected: clean, all pass.

- [ ] **Step 7: Commit**

```bash
git add -A src tests
git commit -m "Add archive naming, save planning and the archived stamp

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Disk helpers for archive copies, new notes and moves

**Files:**
- Create: `src/main/ipc/archive.ts`
- Modify: `src/main/ipc/filing.ts` (import `sanitizeFileName` instead of defining it), `src/main/ipc/files.ts`, `src/main/index.ts`, `src/preload/index.ts`
- Test: `tests/unit/archiveOps.test.ts`; `tests/unit/filing.test.ts` (move the `sanitizeFileName` describe out)

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/archiveOps.test.ts`. Move the whole `describe('sanitizeFileName', ...)` block from `tests/unit/filing.test.ts` into this file unchanged (and drop `sanitizeFileName` from that file's import). Then add:

```ts
import { describe, expect, test } from 'vitest'
import { basename, dirname, join } from 'node:path'
import {
  moveWorkingFile,
  sanitizeFileName,
  writeArchiveCopy,
  writeNewNote,
  type ArchiveOps
} from '../../src/main/ipc/archive'

const RAW = join('/', 'brain', 'raw')
const DRAFTS = join('/', 'drafts')
const OTHER = join('/', 'other')

interface Fake extends ArchiveOps {
  files: Map<string, string>
  /** Paths whose next create loses a race to another writer. */
  raceOn: Set<string>
  createError?: Error
  renameError?: Error
}

function fake(folders: string[], files: Record<string, string> = {}): Fake {
  const disk: Fake = {
    files: new Map(Object.entries(files)),
    raceOn: new Set(),
    async dirExists(path) {
      return folders.includes(path)
    },
    async listNames(dir) {
      return [...disk.files.keys()].filter((p) => dirname(p) === dir).map((p) => basename(p))
    },
    async createExclusive(path, text) {
      if (disk.createError) throw disk.createError
      if (disk.raceOn.has(path)) {
        disk.raceOn.delete(path)
        disk.files.set(path, 'someone else')
        return false
      }
      if (disk.files.has(path)) return false
      disk.files.set(path, text)
      return true
    },
    async copyExclusive(from, to) {
      if (disk.files.has(to)) return false
      disk.files.set(to, disk.files.get(from) as string)
      return true
    },
    async exists(path) {
      return disk.files.has(path)
    },
    async rename(from, to) {
      if (disk.renameError) throw disk.renameError
      disk.files.set(to, disk.files.get(from) as string)
      disk.files.delete(from)
    },
    async trash(path) {
      disk.files.delete(path)
    }
  }
  return disk
}

function errno(code: string): Error {
  return Object.assign(new Error(code), { code })
}

describe('writeArchiveCopy', () => {
  test('writes a dated copy into raw', async () => {
    const disk = fake([RAW])
    const result = await writeArchiveCopy(disk, RAW, 'essay.md', '2026-10-04', 'TEXT')
    expect(result).toEqual({ ok: true, path: join(RAW, 'essay-2026-10-04.md') })
    expect(disk.files.get(join(RAW, 'essay-2026-10-04.md'))).toBe('TEXT')
  })

  test('never overwrites: a second copy the same day gets -2', async () => {
    const disk = fake([RAW], { [join(RAW, 'essay-2026-10-04.md')]: 'FIRST' })
    const result = await writeArchiveCopy(disk, RAW, 'essay.md', '2026-10-04', 'SECOND')
    expect(result).toEqual({ ok: true, path: join(RAW, 'essay-2026-10-04-2.md') })
    expect(disk.files.get(join(RAW, 'essay-2026-10-04.md'))).toBe('FIRST')
  })

  test('a clash in different case still counts', async () => {
    const disk = fake([RAW], { [join(RAW, 'Essay-2026-10-04.md')]: 'FIRST' })
    const result = await writeArchiveCopy(disk, RAW, 'essay.md', '2026-10-04', 'SECOND')
    expect(result.ok && basename(result.path)).toBe('essay-2026-10-04-2.md')
  })

  test('losing a race to another writer takes the next name', async () => {
    const disk = fake([RAW])
    disk.raceOn.add(join(RAW, 'essay-2026-10-04.md'))
    const result = await writeArchiveCopy(disk, RAW, 'essay.md', '2026-10-04', 'MINE')
    expect(result).toEqual({ ok: true, path: join(RAW, 'essay-2026-10-04-2.md') })
    expect(disk.files.get(join(RAW, 'essay-2026-10-04.md'))).toBe('someone else')
  })

  test('cleans the file name first', async () => {
    const disk = fake([RAW])
    const result = await writeArchiveCopy(disk, RAW, 'my:essay.txt', '2026-10-04', 'T')
    expect(result.ok && basename(result.path)).toBe('myessay-2026-10-04.md')
  })

  test('a missing raw folder is reported, not created', async () => {
    const disk = fake([])
    const result = await writeArchiveCopy(disk, RAW, 'essay.md', '2026-10-04', 'T')
    expect(result.ok).toBe(false)
    expect(!result.ok && result.message).toContain("can't be found")
    expect(disk.files.size).toBe(0)
  })

  test('a folder that refuses writes is reported', async () => {
    const disk = fake([RAW])
    disk.createError = errno('EACCES')
    const result = await writeArchiveCopy(disk, RAW, 'essay.md', '2026-10-04', 'T')
    expect(!result.ok && result.message).toContain("can't be written to")
  })
})

describe('writeNewNote', () => {
  test('uses the name when free and -2 when not', async () => {
    const disk = fake([DRAFTS], { [join(DRAFTS, 'cells.md')]: 'OLD' })
    expect(await writeNewNote(disk, DRAFTS, 'fresh.md', 'A')).toEqual({ ok: true, path: join(DRAFTS, 'fresh.md') })
    expect(await writeNewNote(disk, DRAFTS, 'cells.md', 'B')).toEqual({ ok: true, path: join(DRAFTS, 'cells-2.md') })
    expect(disk.files.get(join(DRAFTS, 'cells.md'))).toBe('OLD')
  })
})

describe('moveWorkingFile', () => {
  const from = join(DRAFTS, 'essay.md')

  test('moves the file', async () => {
    const disk = fake([DRAFTS, OTHER], { [from]: 'T' })
    expect(await moveWorkingFile(disk, from, OTHER)).toEqual({ ok: true, path: join(OTHER, 'essay.md') })
    expect(disk.files.has(from)).toBe(false)
  })

  test('moving into the folder it is already in does nothing', async () => {
    const disk = fake([DRAFTS], { [from]: 'T' })
    expect(await moveWorkingFile(disk, from, DRAFTS)).toEqual({ ok: true, path: from })
  })

  test('refuses when the target already has that name', async () => {
    const disk = fake([DRAFTS, OTHER], { [from]: 'MINE', [join(OTHER, 'essay.md')]: 'THEIRS' })
    const result = await moveWorkingFile(disk, from, OTHER)
    expect(!result.ok && result.message).toContain('already has a note called essay.md')
    expect(disk.files.get(from)).toBe('MINE')
    expect(disk.files.get(join(OTHER, 'essay.md'))).toBe('THEIRS')
  })

  test('refuses a target folder that is not there', async () => {
    const disk = fake([DRAFTS], { [from]: 'T' })
    expect((await moveWorkingFile(disk, from, OTHER)).ok).toBe(false)
  })

  test('across drives it copies, then trashes the original', async () => {
    const disk = fake([DRAFTS, OTHER], { [from]: 'T' })
    disk.renameError = errno('EXDEV')
    expect(await moveWorkingFile(disk, from, OTHER)).toEqual({ ok: true, path: join(OTHER, 'essay.md') })
    expect(disk.files.get(join(OTHER, 'essay.md'))).toBe('T')
    expect(disk.files.has(from)).toBe(false)
  })

  test('any other rename failure leaves everything where it was', async () => {
    const disk = fake([DRAFTS, OTHER], { [from]: 'T' })
    disk.renameError = errno('EBUSY')
    const result = await moveWorkingFile(disk, from, OTHER)
    expect(!result.ok && result.message).toContain("couldn't be moved")
    expect(disk.files.get(from)).toBe('T')
  })
})
```

Run: `npm test -- tests/unit/archiveOps.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 2: Create `src/main/ipc/archive.ts`**

No Electron import here, so vitest can load it. Move `WINDOWS_RESERVED` and `sanitizeFileName` out of `filing.ts` verbatim.

```ts
/**
 * Disk work for the save flow: archive copies, brand new notes and moving the working
 * file. Two promises: nothing that is already on disk is ever overwritten, and a
 * failure says what happened in words a student can act on.
 *
 * Every disk operation goes through ArchiveOps so the failure paths can be tested
 * without touching a real disk.
 */
import { basename, dirname, join } from 'node:path'
import { archiveStem, freeName } from '../../shared/archive'
import { samePath } from '../../shared/paths'

export interface ArchiveOps {
  dirExists(path: string): Promise<boolean>
  listNames(dir: string): Promise<string[]>
  /** Creates the file only if nothing is there: false when something is, throws on any other failure. */
  createExclusive(path: string, text: string): Promise<boolean>
  /** Copies byte for byte, with the same contract as createExclusive. */
  copyExclusive(from: string, to: string): Promise<boolean>
  exists(path: string): Promise<boolean>
  rename(from: string, to: string): Promise<void>
  trash(path: string): Promise<void>
}

export type WriteResult = { ok: true; path: string; notice?: string } | { ok: false; message: string }

const MISSING = "The folder can't be found. It may have been moved, renamed, or be on a drive that isn't connected."
const UNWRITABLE = "The folder can't be written to. It may be open in another program, or syncing."

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

export function sanitizeFileName(input: string): string {
  /* body moved verbatim from src/main/ipc/filing.ts */
}

/** Writes `text` as stem.md, or stem-2.md and so on, in `dir`. Never overwrites. */
export async function createWithFreeName(ops: ArchiveOps, dir: string, stem: string, text: string): Promise<WriteResult> {
  if (!(await ops.dirExists(dir))) return { ok: false, message: MISSING }
  let existing: string[]
  try {
    existing = await ops.listNames(dir)
  } catch {
    return { ok: false, message: UNWRITABLE }
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    const name = freeName(stem, existing)
    const path = join(dir, name)
    let created: boolean
    try {
      created = await ops.createExclusive(path, text)
    } catch {
      return { ok: false, message: UNWRITABLE }
    }
    if (created) return { ok: true, path }
    // Someone else wrote that name between our listing and our write. Take the next one.
    existing = [...existing, name]
  }
  return { ok: false, message: 'There are too many notes with that name already.' }
}

/** The dated, never-overwriting copy of the working note in a raw folder. */
export function writeArchiveCopy(
  ops: ArchiveOps,
  rawDir: string,
  workingFileName: string,
  date: string,
  text: string
): Promise<WriteResult> {
  return createWithFreeName(ops, rawDir, archiveStem(sanitizeFileName(workingFileName), date), text)
}

/** The first save of an untitled note into a folder the student chose. */
export function writeNewNote(ops: ArchiveOps, dir: string, fileName: string, text: string): Promise<WriteResult> {
  return createWithFreeName(ops, dir, sanitizeFileName(fileName).replace(/\.md$/, ''), text)
}

/** Moves the working file to another folder, keeping its name. Never overwrites. */
export async function moveWorkingFile(ops: ArchiveOps, from: string, toDir: string): Promise<WriteResult> {
  if (samePath(dirname(from), toDir)) return { ok: true, path: from }
  if (!(await ops.dirExists(toDir))) return { ok: false, message: MISSING }
  const name = basename(from)
  const dest = join(toDir, name)
  const clash = `That folder already has a note called ${name}.`
  if (await ops.exists(dest)) return { ok: false, message: clash }

  try {
    await ops.rename(from, dest)
    return { ok: true, path: dest }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'EXDEV') {
      return { ok: false, message: "The note couldn't be moved. It may be open in another program." }
    }
  }

  // A rename cannot cross drives: copy byte for byte, then put the original in the trash.
  try {
    if (!(await ops.copyExclusive(from, dest))) return { ok: false, message: clash }
  } catch {
    return { ok: false, message: UNWRITABLE }
  }
  try {
    await ops.trash(from)
  } catch {
    return { ok: true, path: dest, notice: 'The note was moved, but the old copy is still where it was.' }
  }
  return { ok: true, path: dest }
}
```

Replace the `/* body moved verbatim */` comment with the real body from `filing.ts`. In `filing.ts`, delete `WINDOWS_RESERVED` and `sanitizeFileName` and add `import { sanitizeFileName } from './archive'` plus `export { sanitizeFileName }` so existing imports keep working until Task 11 deletes the file.

- [ ] **Step 3: Run the tests**

Run: `npm test -- tests/unit/archiveOps.test.ts tests/unit/filing.test.ts`
Expected: PASS.

- [ ] **Step 4: Real disk ops and IPC**

Append to `src/main/ipc/files.ts` (add `import type { ArchiveOps } from './archive'`):

```ts
function code(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException)?.code
}

/** The real disk behind the save flow's ArchiveOps. */
export const diskArchiveOps: ArchiveOps = {
  async dirExists(path) {
    try {
      return (await fsp.stat(path)).isDirectory()
    } catch {
      return false
    }
  },
  listNames: (dir) => fsp.readdir(dir),
  async createExclusive(path, text) {
    try {
      const handle = await fsp.open(path, 'wx')
      try {
        await handle.writeFile(text, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      return true
    } catch (error) {
      if (code(error) === 'EEXIST') return false
      throw error
    }
  },
  async copyExclusive(from, to) {
    try {
      await fsp.copyFile(from, to, constants.COPYFILE_EXCL)
      return true
    } catch (error) {
      if (code(error) === 'EEXIST') return false
      throw error
    }
  },
  async exists(path) {
    try {
      await fsp.access(path)
      return true
    } catch {
      return false
    }
  },
  rename: (from, to) => fsp.rename(from, to),
  trash: (path) => shell.trashItem(path)
}
```

In `src/main/index.ts` add imports `diskArchiveOps` (from `./ipc/files`) and `writeArchiveCopy, writeNewNote, moveWorkingFile` (from `./ipc/archive`), and the handlers:

```ts
ipcMain.handle('archive:write', async (_e, rawDir: string, fileName: string, date: string, text: string) => {
  try {
    return await writeArchiveCopy(diskArchiveOps, rawDir, fileName, date, text)
  } catch (error) {
    return fail(translateFsError(error, 'the raw folder'))
  }
})

ipcMain.handle('file:write-new', async (_e, dir: string, fileName: string, text: string) => {
  try {
    return await writeNewNote(diskArchiveOps, dir, fileName, text)
  } catch (error) {
    return fail(translateFsError(error, dir))
  }
})

ipcMain.handle('file:move', async (_e, from: string, toDir: string) => {
  try {
    return await moveWorkingFile(diskArchiveOps, from, toDir)
  } catch (error) {
    return fail(translateFsError(error, from))
  }
})
```

In `src/preload/index.ts`, add to `files`:

```ts
    writeNew: (dir: string, fileName: string, content: string): Promise<Result<{ path: string }>> =>
      ipcRenderer.invoke('file:write-new', dir, fileName, content),
    move: (from: string, toDir: string): Promise<Result<{ path: string; notice?: string }>> =>
      ipcRenderer.invoke('file:move', from, toDir),
```

and a new group after `ledger`:

```ts
  archive: {
    write: (rawDir: string, fileName: string, date: string, content: string): Promise<Result<{ path: string }>> =>
      ipcRenderer.invoke('archive:write', rawDir, fileName, date, content)
  },
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: clean, all pass, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add -A src tests
git commit -m "Add disk helpers for archive copies, new notes and moves

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase 2: Three panes and the Locations pane

### Task 7: Pane maths

**Files:**
- Create: `src/renderer/layout/paneMath.ts`
- Test: `tests/unit/paneMath.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/paneMath.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { MIN_WIDTH, dragDivider, layoutPanes, togglePane } from '@renderer/layout/paneMath'

const all = { bunch: true, raw: true, rendered: true }
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

describe('togglePane', () => {
  test('turns a pane off and back on', () => {
    const off = togglePane(all, 'raw')
    expect(off).toEqual({ bunch: true, raw: false, rendered: true })
    expect(togglePane(off, 'raw')).toEqual(all)
  })

  test('the last ticked pane stays on', () => {
    const only = { bunch: false, raw: true, rendered: false }
    expect(togglePane(only, 'raw')).toBe(only)
  })
})

describe('layoutPanes', () => {
  test('shows ticked panes in order with their share of the width', () => {
    const l = layoutPanes({ bunch: false, raw: true, rendered: true }, [1, 1, 2], 1200)
    expect(l.shown).toEqual(['raw', 'rendered'])
    expect(l.hidden).toEqual([])
    expect(l.fractions[0]).toBeCloseTo(1 / 3)
    expect(l.fractions[1]).toBeCloseTo(2 / 3)
  })

  test('hides the rightmost ticked pane when the window is too narrow', () => {
    const l = layoutPanes(all, [1, 1, 1], 700)
    expect(l.shown).toEqual(['bunch', 'raw'])
    expect(l.hidden).toEqual(['rendered'])
  })

  test('never hides the last pane', () => {
    const l = layoutPanes(all, [1, 1, 1], 100)
    expect(l.shown).toEqual(['bunch'])
    expect(l.hidden).toEqual(['raw', 'rendered'])
    expect(l.fractions).toEqual([1])
  })

  test('gives every shown pane at least its minimum and still adds up', () => {
    const total = 900
    const l = layoutPanes(all, [10, 1, 1], total)
    l.shown.forEach((key, i) => expect(l.fractions[i] * total).toBeGreaterThanOrEqual(MIN_WIDTH[key] - 0.01))
    expect(sum(l.fractions)).toBeCloseTo(1)
  })
})

describe('dragDivider', () => {
  test('moves width from one pane to its neighbour', () => {
    const l = layoutPanes(all, [1, 1, 1], 1200)
    const w = dragDivider([1, 1, 1], l, 0, 120, 1200)
    expect(w[0]).toBeCloseTo(1 / 3 + 0.1)
    expect(w[1]).toBeCloseTo(1 / 3 - 0.1)
    expect(w[2]).toBeCloseTo(1 / 3)
  })

  test('stops at the neighbour minimum', () => {
    const l = layoutPanes(all, [1, 1, 1], 1200)
    const w = dragDivider([1, 1, 1], l, 0, 5000, 1200)
    expect(w[1] * 1200).toBeCloseTo(MIN_WIDTH.raw)
  })

  test('a hidden pane keeps its stored width', () => {
    const l = layoutPanes({ bunch: true, raw: false, rendered: true }, [1, 7, 1], 1200)
    const w = dragDivider([1, 7, 1], l, 0, 0, 1200)
    expect(w[1]).toBe(7)
  })
})
```

Run: `npm test -- tests/unit/paneMath.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 2: Create `src/renderer/layout/paneMath.ts`**

```ts
import type { PaneSet } from '@shared/types'

export type PaneKey = 'bunch' | 'raw' | 'rendered'

/** Left to right, always. */
export const PANE_ORDER: PaneKey[] = ['bunch', 'raw', 'rendered']

export const MIN_WIDTH: Record<PaneKey, number> = { bunch: 280, raw: 240, rendered: 240 }

/** Flips one pane, unless that would leave no pane at all. */
export function togglePane(panes: PaneSet, key: PaneKey): PaneSet {
  const next = { ...panes, [key]: !panes[key] }
  return PANE_ORDER.some((k) => next[k]) ? next : panes
}

export interface PaneLayout {
  shown: PaneKey[]
  /** Ticked, but the window is too narrow for them right now. */
  hidden: PaneKey[]
  /** Share of the width for each shown pane, adding up to 1. */
  fractions: number[]
}

/** Raises every pane to its minimum share, taking the difference from panes that have room. */
function clampToMinimums(keys: PaneKey[], fractions: number[], total: number): number[] {
  if (keys.length === 1) return [1]
  const mins = keys.map((k) => MIN_WIDTH[k] / total)
  const raised = fractions.map((f, i) => Math.max(f, mins[i]))
  const over = raised.reduce((a, b) => a + b, 0) - 1
  if (over <= 0) return raised
  const slack = raised.map((f, i) => f - mins[i])
  const slackSum = slack.reduce((a, b) => a + b, 0)
  if (slackSum <= 0) return raised.map(() => 1 / raised.length)
  return raised.map((f, i) => f - over * (slack[i] / slackSum))
}

/** Which ticked panes fit in `total` pixels, and their shares. The rightmost ticked pane drops first. */
export function layoutPanes(panes: PaneSet, widths: [number, number, number], total: number): PaneLayout {
  const shown = PANE_ORDER.filter((k) => panes[k])
  const hidden: PaneKey[] = []
  while (shown.length > 1 && shown.reduce((s, k) => s + MIN_WIDTH[k], 0) > total) {
    hidden.unshift(shown.pop() as PaneKey)
  }
  const raw = shown.map((k) => widths[PANE_ORDER.indexOf(k)])
  const sum = raw.reduce((a, b) => a + b, 0)
  const fractions = sum > 0 ? raw.map((w) => w / sum) : raw.map(() => 1 / raw.length)
  return { shown, hidden, fractions: clampToMinimums(shown, fractions, total) }
}

/**
 * Moves the divider between shown pane `index` and the next one by `dx` pixels, never
 * squeezing either below its minimum. Returns widths for all three panes: shown panes
 * get their new shares, hidden panes keep what they had.
 */
export function dragDivider(
  widths: [number, number, number],
  layout: PaneLayout,
  index: number,
  dx: number,
  total: number
): [number, number, number] {
  const next: [number, number, number] = [...widths]
  layout.shown.forEach((key, i) => {
    next[PANE_ORDER.indexOf(key)] = layout.fractions[i]
  })
  if (total <= 0 || index < 0 || index >= layout.shown.length - 1) return next
  const left = layout.shown[index]
  const right = layout.shown[index + 1]
  const a = layout.fractions[index]
  const b = layout.fractions[index + 1]
  const delta = Math.max(MIN_WIDTH[left] / total - a, Math.min(b - MIN_WIDTH[right] / total, dx / total))
  next[PANE_ORDER.indexOf(left)] = a + delta
  next[PANE_ORDER.indexOf(right)] = b - delta
  return next
}
```

- [ ] **Step 3: Run the tests**

Run: `npm test -- tests/unit/paneMath.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/layout/paneMath.ts tests/unit/paneMath.test.ts
git commit -m "Add pane layout maths: toggle, fit, and divider drag

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Pane layout, pane selector and View menu

The Funky Bunch pane appears with a placeholder in this task; Task 9 fills it. The strip stays until Task 9.

**Files:**
- Create: `src/renderer/layout/PaneLayout.tsx`, `src/renderer/ui/PaneSelector.tsx`
- Modify: `src/renderer/ui/TopBar.tsx`, `src/renderer/App.tsx`, `src/renderer/styles.css`, `src/main/menu.ts`, `src/renderer/ui/HelpDialog.tsx`
- E2E: `tests/e2e/smoke.spec.ts`

- [ ] **Step 1: Write the failing e2e test**

In `tests/e2e/smoke.spec.ts`, replace the test `the view toggle switches between code, split and text` with (add `readFileSync` from `node:fs` and `join` from `node:path` to the imports if missing):

```ts
test('the pane selector shows and hides panes and remembers the choice', async () => {
  const dirs = prepare()
  h = await launch(dirs)
  const bunch = h.page.getByRole('checkbox', { name: 'Funky Bunch' })
  const raw = h.page.getByRole('checkbox', { name: 'Raw Markdown' })
  const rendered = h.page.getByRole('checkbox', { name: 'Rendered Marki' })

  await expect(h.page.locator('.pane-bunch')).toBeVisible()
  await expect(h.page.locator('.pane-code')).toBeVisible()
  await expect(h.page.locator('.pane-rendered')).toBeVisible()

  await raw.uncheck()
  await expect(h.page.locator('.pane-code')).toHaveCount(0)
  await bunch.uncheck()
  await expect(h.page.locator('.pane-bunch')).toHaveCount(0)

  // the last pane cannot be switched off
  await rendered.click()
  await expect(rendered).toBeChecked()
  await expect(h.page.locator('.pane-rendered')).toBeVisible()

  await expect
    .poll(() => JSON.parse(readFileSync(join(dirs.userData, 'settings.json'), 'utf8')).panes)
    .toEqual({ bunch: false, raw: false, rendered: true })

  await raw.check()
  await expect(h.page.locator('.pane-code')).toBeVisible()
  expect(h.errors).toEqual([])
})
```

Run: `npm run build && npx playwright test tests/e2e/smoke.spec.ts`
Expected: the new test FAILS (no such checkboxes).

- [ ] **Step 2: Create `src/renderer/ui/PaneSelector.tsx`**

```tsx
import type { PaneSet } from '@shared/types'
import { PANE_ORDER, type PaneKey } from '@renderer/layout/paneMath'

const LABELS: Record<PaneKey, string> = {
  bunch: 'Funky Bunch',
  raw: 'Raw Markdown',
  rendered: 'Rendered Marki'
}

interface Props {
  panes: PaneSet
  /** Ticked panes the window is currently too narrow for. */
  hidden: PaneKey[]
  onToggle: (key: PaneKey) => void
}

export function PaneSelector({ panes, hidden, onToggle }: Props) {
  const tickedCount = PANE_ORDER.filter((k) => panes[k]).length
  return (
    <div className="pane-selector" role="group" aria-label="Panes">
      {PANE_ORDER.map((key) => {
        const title = hidden.includes(key)
          ? 'Widen the window to show this pane'
          : panes[key] && tickedCount === 1
            ? 'At least one pane stays open'
            : undefined
        return (
          <label key={key} className={hidden.includes(key) ? 'pane-check pane-check-hidden' : 'pane-check'} title={title}>
            <input type="checkbox" checked={panes[key]} onChange={() => onToggle(key)} />
            <span>{LABELS[key]}</span>
          </label>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 3: Create `src/renderer/layout/PaneLayout.tsx`**

```tsx
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { PaneSet } from '@shared/types'
import { dragDivider, layoutPanes, type PaneKey } from './paneMath'

interface Props {
  panes: PaneSet
  widths: [number, number, number]
  /** Called once when a divider drag ends. */
  onWidths: (widths: [number, number, number]) => void
  onHiddenChange: (hidden: PaneKey[]) => void
  /** Renders one pane, including its own <section>. */
  render: (key: PaneKey) => ReactNode
}

/** Before the first measurement there is no width yet; assume a typical window so nothing hides. */
const FALLBACK_WIDTH = 1200

export function PaneLayout({ panes, widths, onWidths, onHiddenChange, render }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const [total, setTotal] = useState(0)
  const [draft, setDraft] = useState<[number, number, number] | null>(null)

  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    const measure = () => setTotal(el.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const width = total || FALLBACK_WIDTH
  const layout = layoutPanes(panes, draft ?? widths, width)

  const hiddenKey = layout.hidden.join(',')
  useEffect(() => {
    onHiddenChange(layout.hidden)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenKey])

  const startDrag = (index: number) => (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const target = event.currentTarget
    const startX = event.clientX
    const startLayout = layout
    const base = draft ?? widths
    let latest = base
    target.setPointerCapture(event.pointerId)
    const move = (e: PointerEvent) => {
      latest = dragDivider(base, startLayout, index, e.clientX - startX, width)
      setDraft(latest)
    }
    const end = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', end)
      target.removeEventListener('pointercancel', end)
      setDraft(null)
      if (latest !== base) onWidths(latest)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', end)
    target.addEventListener('pointercancel', end)
  }

  const columns = layout.fractions.map((f) => `minmax(0, ${f}fr)`).join(' 6px ')

  return (
    <div className="panes" ref={host} style={{ gridTemplateColumns: columns }}>
      {layout.shown.map((key, i) => (
        <Fragment key={key}>
          {i > 0 && (
            <div
              className="pane-divider"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize panes"
              onPointerDown={startDrag(i - 1)}
            />
          )}
          {render(key)}
        </Fragment>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Put the selector in the top bar**

In `src/renderer/ui/TopBar.tsx`:
- Delete `export type ViewMode = ...`.
- Replace the props `view: ViewMode` and `onSetView: (view: ViewMode) => void` with:

```ts
  panes: PaneSet
  hiddenPanes: PaneKey[]
  onTogglePane: (key: PaneKey) => void
```

- Replace the whole `<div className="segmented" role="group" aria-label="View">…</div>` with:

```tsx
        <PaneSelector panes={props.panes} hidden={props.hiddenPanes} onToggle={props.onTogglePane} />
```

- Add the imports:

```ts
import type { PaneSet } from '@shared/types'
import type { PaneKey } from '@renderer/layout/paneMath'
import { PaneSelector } from './PaneSelector'
```

- [ ] **Step 5: Use the layout in `src/renderer/App.tsx`**

- Imports: drop `type ViewMode` from the TopBar import; add

```ts
import { PaneLayout } from './layout/PaneLayout'
import { togglePane, type PaneKey } from './layout/paneMath'
```

- Replace `const [view, setView] = useState<ViewMode>('split')` with `const [hiddenPanes, setHiddenPanes] = useState<PaneKey[]>([])`.
- Add, after `saveSettings`:

```ts
  // Optimistic, so the checkbox flips in the same frame as the click.
  const togglePaneKey = useCallback(
    (key: PaneKey) => {
      if (!settings) return
      const panes = togglePane(settings.panes, key)
      if (panes === settings.panes) return
      setSettings({ ...settings, panes })
      void window.marki.settings.write({ panes })
    },
    [settings]
  )
```

- In `handleAction`, replace the three `view-…` cases with:

```ts
        case 'toggle-pane-bunch': return togglePaneKey('bunch')
        case 'toggle-pane-raw': return togglePaneKey('raw')
        case 'toggle-pane-rendered': return togglePaneKey('rendered')
```

and add `togglePaneKey` to its dependency list.
- In the `<TopBar … />` props replace `view={view}` and `onSetView={setView}` with:

```tsx
          panes={settings.panes}
          hiddenPanes={hiddenPanes}
          onTogglePane={togglePaneKey}
```

- Replace the whole `<div className={`panes ${view}`}> … </div>` block with:

```tsx
        <PaneLayout
          panes={settings.panes}
          widths={settings.paneWidths}
          onWidths={(paneWidths) => void saveSettings({ paneWidths })}
          onHiddenChange={setHiddenPanes}
          render={(key) => {
            if (key === 'bunch') {
              return (
                <section key="bunch" className="pane pane-bunch" aria-label="Funky Bunch">
                  <div className="locations">
                    <p className="muted">Funky Bunch</p>
                  </div>
                </section>
              )
            }
            if (key === 'raw') {
              return (
                <section key="raw" className="pane pane-code" aria-label="Markdown source">
                  {/* the existing <CodePane … /> element, unchanged */}
                </section>
              )
            }
            return (
              <section key="rendered" className="pane pane-rendered" aria-label="Readable text">
                {/* the existing <div className="pane-inner"> … </div>, unchanged */}
              </section>
            )
          }}
        />
```

Move the existing `<CodePane …/>` element and the existing `<div className="pane-inner">…</div>` into the two placeholders exactly as they are.

- [ ] **Step 6: Styles**

In `src/renderer/styles.css`, delete the three `.panes.split`, `.panes.code`, `.panes.text` rules and add after `.pane-inner`:

```css
.pane-divider {
  cursor: col-resize;
  touch-action: none;
  background: linear-gradient(var(--line), var(--line)) center / 1px 100% no-repeat;
}
.pane-divider:hover { background-image: linear-gradient(var(--accent), var(--accent)); background-size: 2px 100%; }

.pane-selector { display: flex; align-items: center; gap: 12px; font-size: 12px; color: var(--muted); }
.pane-check { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; white-space: nowrap; }
.pane-check input { margin: 0; accent-color: var(--accent); }
.pane-check-hidden span { text-decoration: line-through; }

.locations { padding: 20px 18px 45vh; font-size: 13px; }
```

- [ ] **Step 7: View menu and help**

In `src/main/menu.ts`, replace the three view items with:

```ts
      { label: 'Funky Bunch', accelerator: 'CmdOrCtrl+1', click: () => send(getWindow, 'toggle-pane-bunch') },
      { label: 'Raw Markdown', accelerator: 'CmdOrCtrl+2', click: () => send(getWindow, 'toggle-pane-raw') },
      { label: 'Rendered Marki', accelerator: 'CmdOrCtrl+3', click: () => send(getWindow, 'toggle-pane-rendered') },
```

In `src/renderer/ui/HelpDialog.tsx`, the `Ctrl/Cmd + 1 / 2 / 3` row's description becomes `show or hide the Funky Bunch, Raw and Rendered panes`.

- [ ] **Step 8: Verify**

Run: `npm run verify`
Expected: all green, including the new smoke test. Other e2e tests still pass because the strip is still there.

- [ ] **Step 9: Commit**

```bash
git add -A src tests
git commit -m "Show the window as three panes chosen with checkboxes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The Locations pane: grid, bunch chips and live YAML

This task replaces the strip and the team board with the Funky Bunch pane. Old filing keeps working in this task: the top bar's File button now follows the bunch named in the note's YAML (set by clicking a bunch chip). Task 11 removes it.

**Files:**
- Create: `src/renderer/funkybunch/SkillDomainGrid.tsx`, `BunchChips.tsx`, `LocationsPane.tsx`
- Modify: `src/renderer/App.tsx`, `src/renderer/styles.css`, `src/renderer/funkybunch/MemberDialog.tsx`, `src/renderer/funkybunch/BunchDialog.tsx`, `src/main/index.ts`
- Delete: `src/renderer/funkybunch/Strip.tsx`, `src/renderer/funkybunch/TeamBoard.tsx`
- E2E: create `tests/e2e/locations.spec.ts`; delete `tests/e2e/board.spec.ts`; modify `filing.spec.ts`, `fixes.spec.ts`, `firstrun.spec.ts`, `shot.spec.ts`

- [ ] **Step 1: Write the failing e2e tests**

Create `tests/e2e/locations.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, prepare, team, type Harness } from './helpers'

let h: Harness

test.afterEach(async () => {
  if (h) await h.close()
})

async function openNote(text: string, settings?: Record<string, unknown>) {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'note.md')
  writeFileSync(notePath, text, 'utf8')
  h = await launch(dirs, { openFile: notePath, settings: settings ?? team(dirs) })
  await expect(h.page.locator('.pm-content')).not.toBeEmpty()
  return { dirs, notePath }
}

async function menu(action: string) {
  await h.app.evaluate(({ BrowserWindow }, a) => BrowserWindow.getAllWindows()[0].webContents.send('menu:action', a), action)
}

const pane = () => h.page.locator('.pane-bunch')
const source = () => h.page.locator('.cm-content')

test('the grid shows skills across the top and domains down the side', async () => {
  await openNote('# Note\n')
  await expect(pane().locator('th.board-skill')).toHaveText(/librarian/)
  await expect(pane().locator('th.board-domain')).toHaveText(/thesis/)
  await expect(pane().getByRole('button', { name: 'librarian and thesis: 0 notes' })).toBeVisible()
  expect(h.errors).toEqual([])
})

test('ticking a square writes skills, domains and tags into the YAML, and undo takes it back', async () => {
  await openNote('# Note\n\nBody.\n')
  const cell = pane().getByRole('button', { name: 'librarian and thesis: 0 notes' })
  await cell.click()
  await expect(cell).toHaveAttribute('aria-pressed', 'true')
  await expect(source()).toContainText('skills:')
  await expect(source()).toContainText('- librarian')
  await expect(source()).toContainText('domains:')
  await expect(source()).toContainText('- thesis')
  await expect(source()).toContainText('skill/librarian')
  await expect(source()).toContainText('Body.')

  await menu('undo')
  await expect(source()).not.toContainText('skills:')
  await expect(cell).toHaveAttribute('aria-pressed', 'false')
  expect(h.errors).toEqual([])
})

test('clicking a name ticks just that skill or domain', async () => {
  await openNote('# Note\n')
  await pane().getByRole('button', { name: 'thesis domain' }).click()
  await expect(pane().getByRole('button', { name: 'thesis domain' })).toHaveAttribute('aria-pressed', 'true')
  await expect(source()).toContainText('domains:')
  await expect(source()).not.toContainText('skills:')
  expect(h.errors).toEqual([])
})

test('typing the YAML by hand lights up the grid', async () => {
  await openNote('---\ndomains: [Thesis]\n---\n# Note\n')
  await expect(pane().getByRole('button', { name: 'thesis domain' })).toHaveAttribute('aria-pressed', 'true')
  await expect(pane().getByRole('button', { name: 'librarian skill' })).toHaveAttribute('aria-pressed', 'false')
  expect(h.errors).toEqual([])
})

test('a bunch chip applies its skills and domains, and clicking it again clears only the bunch', async () => {
  await openNote('# Note\n')
  const chip = pane().getByRole('button', { name: 'study bunch' })
  await chip.click()
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
  await expect(source()).toContainText('bunch: study')
  await expect(pane().getByRole('button', { name: 'librarian and thesis: 0 notes' })).toHaveAttribute('aria-pressed', 'true')

  await chip.click()
  await expect(chip).toHaveAttribute('aria-pressed', 'false')
  await expect(source()).not.toContainText('bunch:')
  await expect(source()).toContainText('skills:')
  expect(h.errors).toEqual([])
})

test('a name nobody has offers to add it', async () => {
  await openNote('---\nskills: [ghost]\n---\n# Note\n')
  await pane().getByRole('button', { name: "ghost isn't a skill yet. Add it?" }).click()
  const dialog = h.page.getByRole('dialog', { name: 'Add a skill' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('ghost')
  expect(h.errors).toEqual([])
})

test('broken YAML greys out the grid and the chips', async () => {
  await openNote('---\ntitle: My note: draft\n---\n# Note\n')
  await expect(pane()).toContainText('Fix the YAML to tick skills and domains')
  await expect(pane().getByRole('button', { name: 'librarian and thesis: 0 notes' })).toBeDisabled()
  await expect(pane().getByRole('button', { name: 'study bunch' })).toBeDisabled()
  expect(h.errors).toEqual([])
})

test('right-clicking a name opens it for editing', async () => {
  await openNote('# Note\n')
  await pane().getByRole('button', { name: 'librarian skill' }).click({ button: 'right' })
  await expect(h.page.getByRole('dialog', { name: 'Edit skill' })).toBeVisible()
  expect(h.errors).toEqual([])
})

test('with nobody in the roster the pane explains itself', async () => {
  await openNote('# Note\n', { members: [], bunches: [] })
  await expect(pane().getByRole('button', { name: 'Add a skill' })).toBeVisible()
  await expect(pane().getByRole('button', { name: 'Add a domain' })).toBeVisible()
  expect(h.errors).toEqual([])
})

test('adding a folder with a CLAUDE.md proposes skill', async () => {
  // The folder picker is a native dialog, so this checks the proposal through the IPC directly.
  const { dirs } = await openNote('# Note\n')
  const kind = await h.page.evaluate(
    (path) => window.marki.members.proposeKind(path).then((r) => (r.ok ? r.kind : 'error')),
    dirs.agent
  )
  expect(kind).toBe('skill')
  const other = await h.page.evaluate(
    (path) => window.marki.members.proposeKind(path).then((r) => (r.ok ? r.kind : 'error')),
    dirs.artifact
  )
  expect(other).toBe('domain')
  expect(h.errors).toEqual([])
})
```

Delete `tests/e2e/board.spec.ts` (its proposal test moved above; the rest is covered by the new tests).

Run: `npm run build && npx playwright test tests/e2e/locations.spec.ts`
Expected: FAIL (the pane has only its placeholder).

- [ ] **Step 2: Create `src/renderer/funkybunch/SkillDomainGrid.tsx`**

```tsx
import { useMemo, type MouseEvent } from 'react'
import type { LedgerEntry, Member, MemberKind } from '@shared/types'
import { pairCounts, pairKey } from '@shared/ledger'

interface Props {
  members: Member[]
  ledger: LedgerEntry[]
  skillIds: string[]
  domainIds: string[]
  missingMemberIds: string[]
  /** The YAML cannot be read, so nothing can be ticked. */
  disabled: boolean
  onToggleSkill: (id: string) => void
  onToggleDomain: (id: string) => void
  onToggleCell: (skillId: string, domainId: string) => void
  onEditMember: (id: string) => void
  onAddMember: (kind: MemberKind) => void
}

export function SkillDomainGrid(props: Props) {
  const skills = props.members.filter((m) => m.kind === 'skill')
  const domains = props.members.filter((m) => m.kind === 'domain')
  const counts = useMemo(() => pairCounts(props.ledger), [props.ledger])

  if (skills.length === 0 && domains.length === 0) {
    return (
      <div className="grid-empty">
        <p>
          <strong>Skill folders</strong> do a kind of work: they hold skills and instructions, like a CLAUDE.md.{' '}
          <strong>Domain folders</strong> gather everything about one subject. Add one of each to start ticking
          notes.
        </p>
        <button className="btn btn-primary" onClick={() => props.onAddMember('skill')}>
          Add a skill
        </button>{' '}
        <button className="btn btn-primary" onClick={() => props.onAddMember('domain')}>
          Add a domain
        </button>
      </div>
    )
  }

  const warn = (id: string) =>
    props.missingMemberIds.includes(id) ? (
      <span className="board-warn" title="This folder can't be found. Right-click to fix it.">
        !
      </span>
    ) : null

  const edit = (id: string) => (event: MouseEvent) => {
    event.preventDefault()
    props.onEditMember(id)
  }

  const head = (member: Member, on: boolean, toggle: () => void) => (
    <>
      <button
        type="button"
        className="board-head"
        disabled={props.disabled}
        aria-pressed={on}
        aria-label={`${member.name} ${member.kind}`}
        title={member.path || 'No folder chosen yet'}
        onClick={toggle}
        onContextMenu={edit(member.id)}
      >
        <span aria-hidden="true">{member.emoji}</span>
        <span className="board-name">{member.name}</span>
      </button>
      <button type="button" className="board-more" aria-label={`Edit ${member.name}`} onClick={() => props.onEditMember(member.id)}>
        …
      </button>
      {warn(member.id)}
    </>
  )

  return (
    <div className={props.disabled ? 'grid-wrap grid-disabled' : 'grid-wrap'}>
      {props.disabled && <p className="grid-blocked">Fix the YAML to tick skills and domains.</p>}
      <div className="board-scroll">
        <table className="board" aria-label="Skills and domains">
          <thead>
            <tr>
              <th className="board-corner" aria-hidden="true" />
              {skills.map((skill) => {
                const on = props.skillIds.includes(skill.id)
                return (
                  <th key={skill.id} scope="col" className={on ? 'board-skill board-on' : 'board-skill'}>
                    {head(skill, on, () => props.onToggleSkill(skill.id))}
                  </th>
                )
              })}
              <th className="board-add">
                <button type="button" className="btn btn-quiet btn-tight" onClick={() => props.onAddMember('skill')}>
                  + Add skill
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {domains.map((domain) => {
              const rowOn = props.domainIds.includes(domain.id)
              return (
                <tr key={domain.id}>
                  <th scope="row" className={rowOn ? 'board-domain board-on' : 'board-domain'}>
                    {head(domain, rowOn, () => props.onToggleDomain(domain.id))}
                  </th>
                  {skills.map((skill) => {
                    const n = counts.get(pairKey(skill.id, domain.id)) ?? 0
                    const both = rowOn && props.skillIds.includes(skill.id)
                    const classes = ['board-cell']
                    if (n > 0) classes.push('board-cell-hot')
                    if (both) classes.push('board-cell-on')
                    return (
                      <td key={skill.id}>
                        <button
                          type="button"
                          className={classes.join(' ')}
                          disabled={props.disabled}
                          aria-pressed={both}
                          aria-label={`${skill.name} and ${domain.name}: ${n} note${n === 1 ? '' : 's'}`}
                          onClick={() => props.onToggleCell(skill.id, domain.id)}
                        >
                          {both ? '●' : n > 0 ? n : '·'}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
            <tr>
              <th className="board-add" scope="row">
                <button type="button" className="btn btn-quiet btn-tight" onClick={() => props.onAddMember('domain')}>
                  + Add domain
                </button>
              </th>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create `src/renderer/funkybunch/BunchChips.tsx`**

```tsx
import { useState } from 'react'
import type { Bunch } from '@shared/types'
import { samePath } from '@shared/paths'

interface Props {
  bunches: Bunch[]
  activeId: string | null
  missingRawPaths: string[]
  disabled: boolean
  onApply: (id: string) => void
  onEdit: (id: string) => void
  onSaveAsBunch: () => void
}

function BunchChip({
  bunch,
  active,
  unavailable,
  disabled,
  onApply,
  onEdit
}: {
  bunch: Bunch
  active: boolean
  unavailable: boolean
  disabled: boolean
  onApply: (id: string) => void
  onEdit: (id: string) => void
}) {
  const [over, setOver] = useState(false)
  const classes = ['bunch-chip']
  if (active) classes.push('bunch-chip-on')
  if (unavailable) classes.push('bunch-chip-unavailable')
  if (over) classes.push('bunch-chip-drop')

  return (
    <span className="bunch-chip-wrap">
      <button
        type="button"
        className={classes.join(' ')}
        aria-label={`${bunch.name} bunch`}
        aria-pressed={active}
        disabled={disabled}
        title={unavailable ? `${bunch.name}'s raw folder can't be found` : undefined}
        onClick={() => onApply(bunch.id)}
        onContextMenu={(event) => {
          event.preventDefault()
          onEdit(bunch.id)
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('text/marki-note')) return
          event.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          if (!event.dataTransfer.types.includes('text/marki-note')) return
          event.preventDefault()
          setOver(false)
          if (!active) onApply(bunch.id)
        }}
      >
        <span aria-hidden="true">{bunch.emoji}</span> {bunch.name}
        {unavailable && (
          <span className="board-warn" aria-hidden="true">
            !
          </span>
        )}
      </button>
      <button type="button" className="bunch-chip-more" aria-label={`Edit ${bunch.name}`} onClick={() => onEdit(bunch.id)}>
        …
      </button>
    </span>
  )
}

export function BunchChips({ bunches, activeId, missingRawPaths, disabled, onApply, onEdit, onSaveAsBunch }: Props) {
  return (
    <div className="bunch-chips" role="group" aria-label="Bunches">
      <span className="locations-label">Bunch</span>
      {bunches.map((b) => (
        <BunchChip
          key={b.id}
          bunch={b}
          active={b.id === activeId}
          unavailable={b.rawPath.length > 0 && missingRawPaths.some((p) => samePath(p, b.rawPath))}
          disabled={disabled}
          onApply={onApply}
          onEdit={onEdit}
        />
      ))}
      <button type="button" className="btn btn-quiet btn-tight" disabled={disabled} onClick={onSaveAsBunch}>
        + Save as bunch
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Create `src/renderer/funkybunch/LocationsPane.tsx`**

```tsx
import { useState, type ReactNode } from 'react'
import type { Bunch, LedgerEntry, Member, MemberKind } from '@shared/types'
import type { TickReading } from '@shared/ticks'
import { Modal } from '@renderer/ui/Modal'
import { BunchChips } from './BunchChips'
import { SkillDomainGrid } from './SkillDomainGrid'

interface Props {
  ticks: TickReading
  members: Member[]
  bunches: Bunch[]
  ledger: LedgerEntry[]
  missingMemberIds: string[]
  missingRawPaths: string[]
  activeBunchId: string | null
  /** Working folder, archive box and raw folder (Task 10). */
  locations?: ReactNode
  /** The Save button (Task 10). */
  footer?: ReactNode
  onToggleSkill: (id: string) => void
  onToggleDomain: (id: string) => void
  onToggleCell: (skillId: string, domainId: string) => void
  onApplyBunch: (id: string) => void
  onEditBunch: (id: string) => void
  onSaveAsBunch: () => void
  onEditMember: (id: string) => void
  onAddMember: (kind: MemberKind, name?: string) => void
  onOpenHelp: () => void
}

export function LocationsPane(props: Props) {
  const [explaining, setExplaining] = useState(false)
  const broken = !props.ticks.ok

  return (
    <div className="locations">
      <div className="locations-head">
        <h2 className="locations-title">Funky Bunch locations</h2>
        <button className="btn btn-quiet btn-tight" aria-label="What is this?" onClick={() => setExplaining(true)}>
          ?
        </button>
      </div>

      {props.locations}

      <BunchChips
        bunches={props.bunches}
        activeId={props.activeBunchId}
        missingRawPaths={props.missingRawPaths}
        disabled={broken}
        onApply={props.onApplyBunch}
        onEdit={props.onEditBunch}
        onSaveAsBunch={props.onSaveAsBunch}
      />

      {props.ticks.unknown.length > 0 && (
        <div className="unknown-chips">
          {props.ticks.unknown.map((u) => (
            <button key={`${u.kind}:${u.name}`} type="button" className="unknown-chip" onClick={() => props.onAddMember(u.kind, u.name)}>
              {u.name} isn&apos;t a {u.kind} yet. Add it?
            </button>
          ))}
        </div>
      )}

      <SkillDomainGrid
        members={props.members}
        ledger={props.ledger}
        skillIds={props.ticks.skillIds}
        domainIds={props.ticks.domainIds}
        missingMemberIds={props.missingMemberIds}
        disabled={broken}
        onToggleSkill={props.onToggleSkill}
        onToggleDomain={props.onToggleDomain}
        onToggleCell={props.onToggleCell}
        onEditMember={props.onEditMember}
        onAddMember={(kind) => props.onAddMember(kind)}
      />

      {props.footer}

      {explaining && (
        <Modal
          title="Funky Bunch locations"
          onClose={() => setExplaining(false)}
          footer={
            <>
              <button
                className="btn btn-quiet"
                onClick={() => {
                  setExplaining(false)
                  props.onOpenHelp()
                }}
              >
                Open the full guide
              </button>
              <span className="spacer" />
              <button className="btn btn-primary" onClick={() => setExplaining(false)}>
                Got it
              </button>
            </>
          }
        >
          <p>
            <strong>Skill folders</strong> do a kind of work. They hold the skills and the CLAUDE.md for it, and they
            cut across many projects. <strong>Domain folders</strong> gather everything about one subject.
          </p>
          <p>
            Tick the skills and domains a note belongs to. The ticks are written into the note&apos;s YAML, which is
            what your second brain&apos;s agents search when they look for it later.
          </p>
          <p>
            A <strong>bunch</strong> is a saved set of ticks plus a raw folder, like a group chat. Click one to apply
            it. Tick <strong>Archive / distribute</strong> when this version is a milestone: Save then also drops a
            dated copy into the raw folder.
          </p>
        </Modal>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Let the dialogs take presets**

`src/renderer/funkybunch/MemberDialog.tsx`: add a prop `presetName?: string` (doc comment: "A name to start with, from an unknown name in the note's YAML.") and initialise `const [name, setName] = useState(existing?.name ?? presetName ?? '')`. Make sure the Name field's `<input>` sits inside the `Field label="Name"` (it does; `Field` renders a `<label>`), so `getByRole('textbox', { name: 'Name' })` finds it.

`src/renderer/funkybunch/BunchDialog.tsx`: the `preset` type becomes `{ skillIds: string[]; domainIds: string[]; rawPath?: string }` and the raw path starts as `existing?.rawPath || preset?.rawPath || defaultRawPath || ''`. The empty-roster hints become `No skills yet. Add one in the Funky Bunch pane.` / `No domains yet. Add one in the Funky Bunch pane.`

- [ ] **Step 6: Wire the pane into `src/renderer/App.tsx`**

Imports: remove `Strip` and `TeamBoard`; add

```ts
import { LocationsPane } from './funkybunch/LocationsPane'
import { applyTicks, readTicks, type Ticks } from '@shared/ticks'
```

`DialogState` becomes:

```ts
type DialogState =
  | { kind: 'member'; existing?: Member; presetKind?: MemberKind; presetName?: string }
  | { kind: 'bunch'; existing?: Bunch; preset?: { skillIds: string[]; domainIds: string[]; rawPath?: string } }
  | { kind: 'settings' }
  | { kind: 'help' }
  | null
```

Remove: the `selectedBunchId` state and every `setSelectedBunchId(...)` call; `selectBunch`; `fileWhenReady` state and its effect; `editMemberFromBoard`; `openCell`; `showCoachmark`; the `<Strip … />` element; the `dialog?.kind === 'board'` block; `seenWelcome: true` from the `saveSettings` calls in `upsertMember` and `upsertBunch`. `closeDialog` becomes `useCallback(() => setDialog(null), [])`.

After `noteId`, add:

```ts
  const ticks = useMemo(() => readTicks(doc.frontMatterRaw, members), [doc.frontMatterRaw, members])

  /** The bunch the note's YAML names, if it is one of ours. */
  const activeBunch = useMemo(() => {
    const name = ticks.bunch?.toLowerCase()
    return name ? (bunches.find((b) => b.name.toLowerCase() === name) ?? null) : null
  }, [ticks.bunch, bunches])
```

and change `plan` to use `selectedId: activeBunch?.id ?? null` (dependency `activeBunch` replaces `selectedBunchId`).

Add the tick writers after `plan`:

```ts
  /** The one way the grid and the chips change the note: rewrite its YAML as one undo step. */
  const writeTicks = useCallback(
    (next: Ticks, bunch?: string | null) => {
      if (!settings) return
      const raw = applyTicks(store.state.frontMatterRaw, next, members, {
        mirrorTags: settings.mirrorTicksAsTags,
        preset: settings.frontMatterPreset,
        bunch,
        newId: ulid(),
        now: nowLocalIso(),
        title: suggestTitle(store.state.body)
      })
      if (raw === null) return
      store.commitUndoGroup()
      store.setFrontMatter(raw, null)
      store.commitUndoGroup()
    },
    [settings, members]
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
```

The keyboard effect's `Ctrl+Shift+digit` branch now applies `bunches[index]` via `applyBunch(bunches[index].id)` (dependencies `[bunches, applyBunch]`).

The TopBar's `onClearSelection` becomes `() => activeBunch && applyBunch(activeBunch.id)`.

In the `PaneLayout` `render`, the bunch pane becomes:

```tsx
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
```

Pass `presetName={dialog.presetName}` to `<MemberDialog>`.

In `src/main/index.ts`, `ensureWelcomeNote` marks the welcome as seen once it has offered the note, now that no coachmark does it:

```ts
async function ensureWelcomeNote(): Promise<string | undefined> {
  const settings = readSettings()
  if (settings.seenWelcome) return undefined
  try {
    const target = join(app.getPath('documents'), 'Welcome to MarkiMarkdown.md')
    try {
      await fsp.access(target)
    } catch {
      await writeAtomic(target, WELCOME_NOTE)
    }
    writeSettings({ seenWelcome: true })
    return target
  } catch (error) {
    log.warn('Could not create the welcome note', error)
    return undefined
  }
}
```

- [ ] **Step 7: Delete the strip and the board**

Delete `src/renderer/funkybunch/Strip.tsx` and `src/renderer/funkybunch/TeamBoard.tsx`.

- [ ] **Step 8: Styles**

In `src/renderer/styles.css`:
- `.app` becomes `grid-template-columns: minmax(0, 1fr);` (no strip column).
- Delete every `.strip…`, `.tile…`, `.coachmark…` rule.
- Rename `.board-agent` to `.board-skill` and `.board-artifact` to `.board-domain` (including `.board-artifact .board-name` and `.board-artifact .board-head`). Remove `cursor: context-menu` from both.
- Replace the old `.locations` rule from Task 8 and add:

```css
.locations { padding: 18px 16px 45vh; font-size: 13px; display: flex; flex-direction: column; gap: 14px; }
.locations-head { display: flex; align-items: center; justify-content: space-between; }
.locations-title { margin: 0; font-size: 11px; font-weight: 650; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.locations-label { font-size: 11.5px; color: var(--muted); }

.bunch-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.bunch-chip-wrap { display: inline-flex; align-items: center; }
.bunch-chip {
  padding: 3px 10px; border-radius: 999px; font-size: 12.5px;
  border: 1px solid var(--line); background: var(--bg-raised); color: var(--text);
}
.bunch-chip:hover { border-color: var(--accent); }
.bunch-chip:disabled { opacity: 0.45; cursor: default; }
.bunch-chip-on { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); font-weight: 550; }
.bunch-chip-unavailable { opacity: 0.6; }
.bunch-chip-drop { transform: scale(1.06); border-color: var(--accent); }
.bunch-chip-more, .board-more { visibility: hidden; color: var(--muted); padding: 0 4px; font-size: 12px; }
.bunch-chip-wrap:hover .bunch-chip-more, .board-skill:hover .board-more, .board-domain:hover .board-more { visibility: visible; }

.unknown-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.unknown-chip {
  padding: 4px 10px; border-radius: 8px; font-size: 12px;
  background: var(--warn-bg); border: 1px solid var(--warn-line); color: var(--text);
}

.grid-wrap { position: relative; }
.grid-disabled .board { opacity: 0.45; }
.grid-blocked { margin: 0 0 8px; color: var(--danger); font-size: 12px; }
.grid-empty { padding: 12px 4px; color: var(--muted); line-height: 1.55; }
.grid-empty p { margin: 0 0 12px; }
.board-on { background: var(--accent-soft); color: var(--accent); }
.board-cell-on { background: var(--accent); border-color: var(--accent); color: #fff; }
.board-add { background: none; }
```

- [ ] **Step 9: Update the other e2e tests**

- `tests/e2e/filing.spec.ts`: bunch chips keep the accessible name `study bunch`, so clicks still work. In `a bunch whose raw folder is missing…` change `toHaveClass(/tile-unavailable/)` to `toHaveClass(/bunch-chip-unavailable/)`. In `a member whose folder is missing…`, replace the three team-board lines with `await expect(h.page.locator('.pane-bunch .board-warn')).toHaveCount(1)`, and open the bunch dialog with `await h.page.getByRole('button', { name: 'study bunch' }).click({ button: 'right' })` as before.
- `tests/e2e/fixes.spec.ts`:
  - Replace `dragging the note onto a bunch tile files it` with:

```ts
test('dragging the note onto a bunch chip applies that bunch', async () => {
  const { harness, dirs } = await openWith('# Drag me\n\nBody.\n', 'drag.md')
  h = harness

  await h.page.locator('.chip').dragTo(h.page.getByRole('button', { name: 'study bunch' }))
  await expect(h.page.locator('.cm-content')).toContainText('bunch: study')
  expect(existsSync(join(dirs.raw, 'drag.md'))).toBe(false)
  expect(h.errors).toEqual([])
})
```

  - Replace `a note with unreadable properties is not filed with a made-up id` with:

```ts
test('a note with unreadable properties cannot be given a bunch', async () => {
  const { harness, dirs } = await openWith('---\ntitle: My note: draft\n---\n\n# Body\n', 'broken.md')
  h = harness
  await expect(h.page.locator('.props-broken')).toBeVisible()
  await expect(h.page.getByRole('button', { name: 'study bunch' })).toBeDisabled()
  await expect(h.page.getByRole('button', { name: /^File to/ })).toHaveCount(0)
  expect(existsSync(join(dirs.raw, 'broken.md'))).toBe(false)
  expect(h.errors).toEqual([])
})
```

- `tests/e2e/firstrun.spec.ts`: replace everything from `// the strip is empty…` down to (not including) the screenshot line with:

```ts
  // the Funky Bunch pane is on screen and explains how to start
  const pane = page.locator('.pane-bunch')
  await expect(pane).toBeVisible()
  await expect(pane).toContainText('Funky Bunch locations')
  await expect(pane.getByRole('button', { name: 'Add a skill' })).toBeVisible()
  await expect(pane.getByRole('button', { name: 'Add a domain' })).toBeVisible()
```

- `tests/e2e/shot.spec.ts`: replace the `.strip` screenshot with `await page.locator('.pane-bunch').screenshot({ path: join(OUT as string, 'marki-04-bunch-pane.png') })` and delete the `.strip .tile` evaluation that follows it (and anything that reads its result).

- [ ] **Step 10: Verify**

Run: `npm run verify`
Expected: all green, including `locations.spec.ts`.

- [ ] **Step 11: Commit**

```bash
git add -A src tests
git commit -m "Replace the strip and team board with the Funky Bunch pane

Ticking a skill, a domain or a square rewrites the note's YAML as one
undo step; the grid reads its ticks back from the YAML. Bunch chips
apply a saved set of ticks.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase 3: Save and archive

### Task 10: The save flow

Save, Ctrl+S and the pane's Save button now save the working file and, when the box is ticked, write the archive copy. The old File button still exists in this task; Task 11 removes it.

**Files:**
- Create: `src/renderer/state/useSaveFlow.ts`, `src/renderer/state/naming.ts`, `src/renderer/funkybunch/SaveControls.tsx`
- Modify: `src/renderer/App.tsx`, `src/renderer/styles.css`
- E2E: create `tests/e2e/archive.spec.ts`

- [ ] **Step 1: Write the failing e2e tests**

Create `tests/e2e/archive.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, prepare, team, type Harness } from './helpers'

let h: Harness

test.afterEach(async () => {
  if (h) await h.close()
})

function today(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

async function openNote(text = '# Essay\n\nFirst draft.\n', extra: Record<string, unknown> = {}) {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'essay.md')
  writeFileSync(notePath, text, 'utf8')
  h = await launch(dirs, { openFile: notePath, settings: { ...team(dirs), defaultRawPath: dirs.raw, ...extra } })
  await expect(h.page.locator('.pm-content')).not.toBeEmpty()
  return { dirs, notePath }
}

async function menu(action: string) {
  await h.app.evaluate(({ BrowserWindow }, a) => BrowserWindow.getAllWindows()[0].webContents.send('menu:action', a), action)
}

const pane = () => h.page.locator('.pane-bunch')
const archiveBox = () => pane().getByRole('checkbox', { name: /Archive \/ distribute/ })
const tickPair = () => pane().getByRole('button', { name: 'librarian and thesis: 0 notes' }).click()

test('Save and archive saves the working file and drops a dated copy in raw', async () => {
  const { dirs, notePath } = await openNote()
  await tickPair()
  await archiveBox().check()
  await pane().getByRole('button', { name: 'Save and archive' }).click()
  await expect(h.page.locator('.toast')).toContainText('Saved and archived', { timeout: 20000 })

  const copyPath = join(dirs.raw, `essay-${today()}.md`)
  expect(existsSync(copyPath)).toBe(true)
  const copy = readFileSync(copyPath, 'utf8')
  expect(copy).toContain('archived:')
  expect(copy).toContain('skills:\n  - librarian')
  expect(copy).toContain('domains:\n  - thesis')
  expect(copy).toContain('First draft.')

  const working = readFileSync(notePath, 'utf8')
  expect(working).toContain('skills:\n  - librarian')
  expect(working).not.toContain('archived:')

  await expect(archiveBox()).not.toBeChecked()
  await expect(pane().getByRole('button', { name: 'librarian and thesis: 1 note' })).toBeVisible()
  expect(h.errors).toEqual([])
})

test('a second archive on the same day never overwrites the first', async () => {
  const { dirs } = await openNote()
  await tickPair()
  for (let i = 0; i < 2; i++) {
    await archiveBox().check()
    await pane().getByRole('button', { name: 'Save and archive' }).click()
    await expect(archiveBox()).not.toBeChecked({ timeout: 20000 })
  }
  expect(readdirSync(dirs.raw).sort()).toEqual([`essay-${today()}-2.md`, `essay-${today()}.md`])
  expect(h.errors).toEqual([])
})

test('Ctrl+S does what the Save button does', async () => {
  const { dirs } = await openNote()
  await tickPair()
  await archiveBox().check()
  await menu('save')
  await expect.poll(() => existsSync(join(dirs.raw, `essay-${today()}.md`)), { timeout: 20000 }).toBe(true)
  expect(h.errors).toEqual([])
})

test('with nothing ticked the box explains why it cannot archive', async () => {
  await openNote()
  await archiveBox().check()
  await expect(pane()).toContainText('Tick at least one skill or domain.')
  await expect(pane().getByRole('button', { name: 'Save', exact: true })).toBeVisible()
  expect(h.errors).toEqual([])
})

test('a missing raw folder blocks archiving and says so', async () => {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'essay.md')
  writeFileSync(notePath, '# Essay\n', 'utf8')
  h = await launch(dirs, { openFile: notePath, settings: { ...team(dirs), bunches: [], defaultRawPath: join(dirs.root, 'gone') } })
  await expect(h.page.locator('.pm-content')).not.toBeEmpty()
  await tickPair()
  await archiveBox().check()
  await expect(pane()).toContainText("The raw folder can't be found.")
  await expect(pane().getByRole('button', { name: 'Save', exact: true })).toBeVisible()
  expect(h.errors).toEqual([])
})

test('a raw folder that vanishes before Save gives "Saved, but not archived"', async () => {
  const { dirs, notePath } = await openNote()
  await tickPair()
  await archiveBox().check()
  await expect(pane().getByRole('button', { name: 'Save and archive' })).toBeVisible()
  rmSync(dirs.raw, { recursive: true, force: true })
  await pane().getByRole('button', { name: 'Save and archive' }).click()
  await expect(h.page.locator('.toast')).toContainText('Saved, but not archived', { timeout: 20000 })
  await expect(archiveBox()).toBeChecked()
  expect(readFileSync(notePath, 'utf8')).toContain('skills:')
  expect(h.errors).toEqual([])
})

test('an untitled note asks for a folder on its first save and is named from its heading', async () => {
  const dirs = prepare()
  h = await launch(dirs, { settings: { ...team(dirs), defaultRawPath: dirs.raw } })
  await h.page.locator('.cm-content').click()
  await h.page.keyboard.type('# Cell walls\n\nPlants have them.')
  await h.app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog
  }, dirs.downloads)
  await pane().getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(() => existsSync(join(dirs.downloads, 'cell-walls.md')), { timeout: 20000 }).toBe(true)
  expect(readFileSync(join(dirs.downloads, 'cell-walls.md'), 'utf8')).toContain('Plants have them.')
  await expect(h.page.locator('.chip-name')).toHaveText('cell-walls.md')
  expect(h.errors).toEqual([])
})

test('choosing another working folder moves the note there', async () => {
  const { dirs, notePath } = await openNote()
  const other = join(dirs.root, 'drafts')
  mkdirSync(other)
  await h.app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox
  }, other)
  await pane().getByRole('button', { name: 'Working folder' }).click()
  await expect(h.page.locator('.toast')).toContainText('Moved to drafts', { timeout: 20000 })
  expect(existsSync(join(other, 'essay.md'))).toBe(true)
  expect(existsSync(notePath)).toBe(false)
  expect(h.errors).toEqual([])
})

test('a 1.1 note opens with its ticks lit, and the first tick moves it to the new keys', async () => {
  const { notePath } = await openNote(
    '---\nagents:\n  - librarian\nartifacts:\n  - thesis\ntags: [agent/librarian, artifact/thesis]\n---\n# Old\n'
  )
  await expect(pane().getByRole('button', { name: 'librarian and thesis: 0 notes' })).toHaveAttribute('aria-pressed', 'true')
  // opening alone rewrites nothing
  expect(readFileSync(notePath, 'utf8')).toContain('agents:')

  await pane().getByRole('button', { name: 'librarian skill' }).click()
  const source = h.page.locator('.cm-content')
  await expect(source).not.toContainText('agents:')
  await expect(source).not.toContainText('artifacts:')
  await expect(source).toContainText('domains:')
  await expect(source).toContainText('domain/thesis')
  await expect(source).not.toContainText('agent/librarian')
  expect(h.errors).toEqual([])
})
```

Run: `npm run build && npx playwright test tests/e2e/archive.spec.ts`
Expected: FAIL (no archive checkbox).

- [ ] **Step 2: Create `src/renderer/state/naming.ts`**

Move `suggestTitle` and `suggestName` out of the bottom of `App.tsx` into this file, verbatim, and export them:

```ts
/** The first heading's text, or empty. */
export function suggestTitle(body: string): string {
  const heading = /^#{1,6}\s+(.+)$/m.exec(body)
  return heading ? heading[1].trim() : ''
}

/** A file name from the first heading, like cell-walls.md, or the fallback. */
export function suggestName(body: string, fallback: string): string {
  /* body moved verbatim from App.tsx, including its \u00c0-\u024f range */
}
```

After writing it, check the character range survived as an escape (see "Escape sequences" at the top). In `App.tsx`, delete the two functions and import them from `./state/naming`.

- [ ] **Step 3: Create `src/renderer/state/useSaveFlow.ts`**

```ts
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
  onLedger: (entries: LedgerEntry[]) => void
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
    const text = addArchived(store.fullText(), nowLocalIso())
    if (text === null) {
      pushToast({ text: `Saved, but not archived: ${BLOCK_REASONS.yaml}`, tone: 'warn' })
      return
    }
    const copy = await window.marki.archive.write(rawPath, store.state.fileName, localDate(), text)
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
      archivedAt: nowLocalIso()
    }
    const appended = await window.marki.ledger.append(entry)
    if (appended.ok) {
      input.onLedger(appended.entries)
      if (!appended.saved) pushToast({ text: 'Archived, but the count could not be updated.', tone: 'warn' })
    }

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
```

`save`, `chooseWorkingFolder` and `chooseRawFolder` are plain closures recreated every render on purpose, so they always see the current ticks, bunch and folders.

- [ ] **Step 4: Create `src/renderer/funkybunch/SaveControls.tsx`**

```tsx
import type { SaveFlow } from '@renderer/state/useSaveFlow'
import { toForwardSlashes } from '@shared/paths'

/** The last three folders of a path, so long Windows paths fit the pane. */
function shortPath(path: string): string {
  const parts = toForwardSlashes(path).split('/').filter((p) => p.length > 0)
  return parts.length <= 3 ? parts.join('/') : `…/${parts.slice(-3).join('/')}`
}

export function SaveLocations({ flow }: { flow: SaveFlow }) {
  return (
    <div className="save-locations">
      <span className="locations-label">Working version saves to</span>
      <button
        type="button"
        className="folder-field"
        aria-label="Working folder"
        title={flow.workingDir || undefined}
        onClick={() => void flow.chooseWorkingFolder()}
      >
        <span className="folder-path">{flow.workingDir ? shortPath(flow.workingDir) : 'Choose a folder'}</span>
        <span aria-hidden="true">📁</span>
      </button>

      <label className="check archive-check">
        <input type="checkbox" checked={flow.archive} onChange={(event) => flow.setArchive(event.target.checked)} />
        <span>
          <span className="archive-title">Archive / distribute this version</span>
          <span className="field-hint">A milestone worth filing in your second brain.</span>
        </span>
      </label>

      <span className="locations-label">Archive copy goes to raw folder</span>
      <button
        type="button"
        className="folder-field"
        aria-label="Raw folder"
        title={flow.rawPath || undefined}
        onClick={() => void flow.chooseRawFolder()}
      >
        <span className="folder-path">{flow.rawPath ? shortPath(flow.rawPath) : 'Choose a raw folder'}</span>
        <span aria-hidden="true">📁</span>
      </button>
      {flow.archive && !flow.plan.canArchive && (
        <p className="save-reason" role="note">
          {flow.plan.reason}
        </p>
      )}
    </div>
  )
}

export function SaveButton({ flow }: { flow: SaveFlow }) {
  return (
    <div className="save-row">
      <button className="btn btn-primary" disabled={flow.saving} onClick={() => void flow.save()}>
        {flow.willArchive ? 'Save and archive' : 'Save'}
      </button>
    </div>
  )
}
```

Note the visible label "Archive / distribute this version" is inside the `<label>`, so it is the checkbox's accessible name.

- [ ] **Step 5: Wire it into `src/renderer/App.tsx`**

- Imports:

```ts
import { useSaveFlow } from './state/useSaveFlow'
import { SaveButton, SaveLocations } from './funkybunch/SaveControls'
```

- Right after `activeBunch` (before `openFile`, so `openFile` can use it):

```ts
  const saveFlow = useSaveFlow({
    store,
    paths: doc.paths,
    originalPath: doc.originalPath,
    ticks,
    activeBunch,
    defaultRawPath: settings?.defaultRawPath ?? '',
    confirmedFileMoves: settings?.confirmedFileMoves ?? false,
    onConfirmedFileMoves: () => void saveSettings({ confirmedFileMoves: true }),
    onLedger: setLedger,
    pushToast
  })
```

  If `saveSettings` is declared below this point, move the `saveSettings` declaration up above it; hooks must not be reordered conditionally, only moved.
- `openFile`: after `store.load(result.file)` call `saveFlow.reset()` (add `saveFlow.reset` to its dependencies; it is stable).
- `handleAction`: `case 'save': return void saveFlow.save()`. Delete `saveNow` and remove it from the dependency list; add `saveFlow`.
- `LocationsPane` gets `locations={<SaveLocations flow={saveFlow} />}` and `footer={<SaveButton flow={saveFlow} />}`.
- The bunch preset for **Save as bunch** uses `rawPath: saveFlow.rawPath`.

- [ ] **Step 6: Styles**

Append to `src/renderer/styles.css`:

```css
.save-locations { display: flex; flex-direction: column; gap: 6px; }
.folder-field {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 5px 9px; border: 1px solid var(--line); border-radius: 7px;
  background: var(--bg-raised); color: var(--text); font-size: 12.5px; text-align: left;
}
.folder-field:hover { border-color: var(--accent); }
.folder-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--mono); font-size: 12px; }
.archive-check { align-items: flex-start; margin: 4px 0; }
.archive-check > span { display: flex; flex-direction: column; gap: 2px; }
.archive-title { font-weight: 550; }
.save-reason { margin: 0; font-size: 12px; color: var(--danger); }
.save-row { display: flex; justify-content: flex-end; }
```

- [ ] **Step 7: Verify**

Run: `npm run verify`
Expected: all green, including `archive.spec.ts`. If the untitled-note test fails because the folder picker opened a real dialog, check that `dialog:pick-folder` in `src/main/index.ts` calls `dialog.showOpenDialog` through the `dialog` object (it does), so the test's replacement is used.

- [ ] **Step 8: Commit**

```bash
git add -A src tests
git commit -m "Save the working file and, when ticked, a dated archive copy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Remove the old filing path

**Files:**
- Delete: `src/main/ipc/filing.ts`, `src/renderer/funkybunch/selection.ts`, `tests/unit/filing.test.ts`, `tests/unit/selection.test.ts`, `tests/e2e/filing.spec.ts`
- Modify: `src/main/index.ts`, `src/main/menu.ts`, `src/main/ipc/files.ts`, `src/preload/index.ts`, `src/shared/bunch.ts`, `src/shared/ledger.ts`, `src/shared/markdown/frontmatter.ts`, `src/renderer/state/document.ts`, `src/renderer/ui/TopBar.tsx`, `src/renderer/App.tsx`
- Test: `tests/unit/bunch.test.ts`, `tests/unit/ledger.test.ts`, `tests/unit/frontmatter.test.ts`, `tests/unit/document.test.ts`
- E2E: `tests/e2e/fixes.spec.ts`, `tests/e2e/features.spec.ts`, `tests/e2e/packaged.spec.ts`, `tests/e2e/archive.spec.ts`

- [ ] **Step 1: Write the failing e2e changes**

In `tests/e2e/features.spec.ts`, replace `with nothing selected there is no File button, and the note name is shown` with:

```ts
test('the top bar shows the note name and whether it has been archived', async () => {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'quiet.md')
  writeFileSync(notePath, '# Quiet\n', 'utf8')
  h = await launch(dirs, { openFile: notePath, settings: team(dirs) })

  await expect(h.page.locator('.chip-name')).toHaveText('quiet.md')
  await expect(h.page.locator('.chip-places')).toHaveText('not archived')
  await expect(h.page.getByRole('button', { name: /^File to/ })).toHaveCount(0)
  expect(h.errors).toEqual([])
})
```

In `tests/e2e/archive.spec.ts`, at the end of the first test (before the errors check) add:

```ts
  await expect(h.page.locator('.chip-places')).toHaveText('archived 1×')
```

Run: `npm run build && npx playwright test tests/e2e/features.spec.ts tests/e2e/archive.spec.ts`
Expected: FAIL on the chip text.

- [ ] **Step 2: Top bar**

In `src/renderer/ui/TopBar.tsx`:
- Remove the props `placeCount`, `placeNames`, `fileLabel`, `canFile`, `blockedReason`, `hasPending`, `onFile`, `onClearSelection`, and add `archiveCount: number` and `filePath: string`.
- Remove `placeSummary` and the whole `props.hasPending ? (…) : (…)` branch, keeping only the chip, which becomes:

```tsx
        <div
          className="chip"
          draggable
          title={props.filePath || 'This note has not been saved yet'}
          onDragStart={(event) => {
            event.dataTransfer.setData('text/marki-note', '1')
            event.dataTransfer.effectAllowed = 'copy'
          }}
        >
          <span className="chip-name">{props.fileName}</span>
          {props.dirty && <span className="chip-dot" title="Unsaved changes" />}
          <span className="chip-places">
            {props.archiveCount > 0 ? `archived ${props.archiveCount}×` : 'not archived'}
          </span>
        </div>
```

- [ ] **Step 3: App**

In `src/renderer/App.tsx` delete: the `planFiling` import and `plan`; `lastBunchId` and the `lastBunchFor` import; `runFiling`, `performFiling`, `filingInFlight`; the `'file-to'` action case; `placeNames`; the `stampNote`, `splitFrontMatter` and `buildStamp` imports if now unused. Pass the top bar:

```tsx
          archiveCount={archiveCount(ledger, noteId)}
          filePath={doc.paths[0] ?? ''}
```

with `import { archiveCount } from '@shared/ledger'`. The `missingRaw` effect stays (the chips use it).

- [ ] **Step 4: Main process, preload and menu**

- Delete `src/main/ipc/filing.ts`.
- `src/main/index.ts`: remove the `./ipc/filing` import, `undoByWindow` and every use of it (the window `closed` handler keeps nothing else, so delete that handler), and the `filing:preflight`, `filing:run`, `filing:undo` handlers. Remove `diskOps` from the files import.
- `src/main/ipc/files.ts`: delete `diskOps` and the `import type { FileOps } from './filing'`. Keep `decodeText`, `readFileForEditor`, `writeAtomic`, `translateFsError`, `diskArchiveOps`.
- `src/preload/index.ts`: delete the `filing` group and the `FilingPlan…` type import.
- `src/main/menu.ts`: delete the `File to...` item.

- [ ] **Step 5: Shared code left behind by filing**

- `src/shared/bunch.ts`: delete `BunchStamp` and `buildStamp` (and the `toForwardSlashes` import). Keep `membersOf`.
- `src/shared/ledger.ts`: delete `lastBunchFor`.
- `src/shared/markdown/frontmatter.ts`: delete `Stamp` and `stampNote`. Keep `normaliseTags`, `MIRRORED_TAG`, `BLOCK_LIST_KEYS`, `mergeFrontMatter`, `addArchived`.
- `src/renderer/state/document.ts`: delete `unfile()`. Rename nothing else; update the doc comment on `afterFiling` to: `The note now lives at these paths (after a first save or a move). If text is given, the editor takes it on as saved.`
- Delete `src/renderer/funkybunch/selection.ts`.

- [ ] **Step 6: Unit tests**

- Delete `tests/unit/filing.test.ts` and `tests/unit/selection.test.ts`. (The `sanitizeFileName` tests already moved to `archiveOps.test.ts` in Task 6.)
- `tests/unit/bunch.test.ts`: delete the `buildStamp` describe.
- `tests/unit/ledger.test.ts`: delete the `lastBunchFor` describe.
- `tests/unit/frontmatter.test.ts`: delete every `stampNote` describe. Keep the tag-normalising behaviour covered by moving these two tests into a new describe:

```ts
describe('normaliseTags', () => {
  test('turns an Obsidian comma string into a list and strips hashes', () => {
    expect(normaliseTags('a, #b ,a')).toEqual(['a', 'b'])
  })

  test('drops empty entries', () => {
    expect(normaliseTags(['', ' ', 'x'])).toEqual(['x'])
    expect(normaliseTags(null)).toEqual([])
  })
})
```

- `tests/unit/document.test.ts`: delete any test of `unfile`.

- [ ] **Step 7: E2E tests**

- Delete `tests/e2e/filing.spec.ts`. Its remaining concerns are covered by `archive.spec.ts` (missing raw folder, stamps) and `locations.spec.ts` (missing member folder is flagged with `.board-warn`; add this test to `locations.spec.ts`):

```ts
test('a skill or domain whose folder is missing is flagged in the grid', async () => {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'note.md')
  writeFileSync(notePath, '# Note\n', 'utf8')
  h = await launch(dirs, {
    openFile: notePath,
    settings: { ...team(dirs), members: [team(dirs).members[0], { ...team(dirs).members[1], path: join(dirs.root, 'nowhere') }] }
  })
  await expect(pane().locator('.board-warn')).toHaveCount(1)
  expect(h.errors).toEqual([])
})
```

- `tests/e2e/fixes.spec.ts`: delete `the stamp written at filing survives the next save` (the YAML is live now; there is no separate stamp).
- `tests/e2e/packaged.spec.ts`: replace the `// file it` block and the assertions after it with:

```ts
  // tick and archive it
  await page.locator('.pane-bunch').getByRole('button', { name: 'librarian and thesis: 0 notes' }).click()
  await page.locator('.pane-bunch').getByRole('checkbox', { name: /Archive \/ distribute/ }).check()
  await page.locator('.pane-bunch').getByRole('button', { name: 'Save and archive' }).click()
  await expect(page.locator('.toast')).toContainText('Saved and archived', { timeout: 25000 })

  const copies = readdirSync(raw)
  expect(copies).toHaveLength(1)
  const content = readFileSync(join(raw, copies[0]), 'utf8')
  expect(content).toContain('skills:')
  expect(content).toContain('archived:')
  expect(content).toContain('Edited in the packaged app.')
  expect(content).toContain('| a | b |')
  expect(existsSync(join(raw, 'log.md'))).toBe(false)
  // the working copy stays put
  expect(existsSync(notePath)).toBe(true)
```

  and add `readdirSync` to its `node:fs` import. No bunch is active in this test, so the archive goes to the default raw folder: add `defaultRawPath: raw` to the settings JSON it writes.

- [ ] **Step 8: Check nothing still mentions filing**

Run: `grep -rn "runFiling\|performFiling\|stampNote\|buildStamp\|planFiling\|lastBunchFor\|filing:" src tests/unit tests/e2e`
Expected: no output.

- [ ] **Step 9: Verify**

Run: `npm run verify`
Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add -A src tests
git commit -m "Remove the old File button and filing path

Saving and archiving from the Funky Bunch pane replace it. The top bar
shows how many times the note has been archived.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase 4: The YAML fold

### Task 12: Fold the YAML in the raw pane and add View YAML

**Files:**
- Create: `src/renderer/editors/yamlFold.ts`
- Modify: `src/renderer/editors/CodePane.tsx`, `src/renderer/App.tsx`, `src/renderer/styles.css`
- E2E: `tests/e2e/helpers.ts`, create `tests/e2e/fold.spec.ts`

- [ ] **Step 1: Keep existing e2e tests unfolded, then write the failing fold tests**

Existing tests read the YAML out of `.cm-content`, so the harness defaults to unfolded. In `tests/e2e/helpers.ts`, `launch` starts its settings with `{ seenWelcome: true, autosave: true, yamlFolded: false, members: [], bunches: [], ...options.settings }`.

Create `tests/e2e/fold.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, prepare, team, type Harness } from './helpers'

let h: Harness

test.afterEach(async () => {
  if (h) await h.close()
})

async function openFolded(text: string) {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'note.md')
  writeFileSync(notePath, text, 'utf8')
  h = await launch(dirs, { openFile: notePath, settings: { ...team(dirs), yamlFolded: true } })
  await expect(h.page.locator('.pm-content')).not.toBeEmpty()
  return dirs
}

const NOTE = '---\nskills: [librarian]\ntags: [a]\n---\n# Note\n\nBody.\n'
const source = () => h.page.locator('.cm-content')

test('the YAML starts folded to one summary line, and View YAML opens it', async () => {
  const dirs = await openFolded(NOTE)
  await expect(h.page.locator('.cm-yaml-summary')).toContainText('YAML · 1 skill · 0 domains · 1 tag')
  await expect(source()).not.toContainText('skills:')
  await expect(source()).toContainText('# Note')

  await h.page.getByRole('button', { name: 'View YAML' }).click()
  await expect(source()).toContainText('skills:')
  await expect(h.page.getByRole('button', { name: 'Hide YAML' })).toBeVisible()
  await expect
    .poll(() => JSON.parse(readFileSync(join(dirs.userData, 'settings.json'), 'utf8')).yamlFolded)
    .toBe(false)

  await h.page.getByRole('button', { name: 'Hide YAML' }).click()
  await expect(source()).not.toContainText('skills:')
  expect(h.errors).toEqual([])
})

test('clicking the summary line opens the YAML', async () => {
  await openFolded(NOTE)
  await h.page.locator('.cm-yaml-summary').click()
  await expect(source()).toContainText('skills:')
  expect(h.errors).toEqual([])
})

test('ticking the grid keeps the fold and updates the summary', async () => {
  await openFolded(NOTE)
  await h.page.locator('.pane-bunch').getByRole('button', { name: 'thesis domain' }).click()
  await expect(h.page.locator('.cm-yaml-summary')).toContainText('1 skill · 1 domain · 3 tags')
  await expect(source()).not.toContainText('domains:')
  expect(h.errors).toEqual([])
})

test('broken YAML is never folded, and is marked', async () => {
  await openFolded('---\ntitle: My note: draft\n---\n# Note\n')
  await expect(h.page.locator('.cm-yaml-summary')).toHaveCount(0)
  await expect(h.page.locator('.cm-yaml-broken')).toHaveCount(1)
  await expect(source()).toContainText('title: My note: draft')
  await expect(h.page.getByRole('button', { name: 'View YAML' })).toHaveCount(0)
  expect(h.errors).toEqual([])
})

test('typing at the start of the body never lands inside the folded YAML', async () => {
  const dirs = await openFolded(NOTE)
  await source().click()
  await h.page.keyboard.press('Control+End')
  await h.page.keyboard.type('\nMore.')
  await expect.poll(() => readFileSync(join(dirs.downloads, 'note.md'), 'utf8'), { timeout: 10000 }).toContain('More.')
  expect(readFileSync(join(dirs.downloads, 'note.md'), 'utf8').startsWith('---\nskills: [librarian]\n')).toBe(true)
  expect(h.errors).toEqual([])
})
```

Run: `npm run build && npx playwright test tests/e2e/fold.spec.ts`
Expected: FAIL (no fold).

- [ ] **Step 2: Create `src/renderer/editors/yamlFold.ts`**

```ts
import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { splitFrontMatter } from '@shared/markdown/frontmatter'

export interface YamlFoldState {
  /** The student wants the YAML folded. */
  folded: boolean
  /** The YAML cannot be parsed: never fold it, mark it instead. */
  broken: boolean
  /** The folded line's text, like "YAML · 2 skills · 1 domain · 4 tags". */
  summary: string
}

export const setYamlFold = StateEffect.define<YamlFoldState>()

/**
 * The span a fold hides: from the opening fence to the end of the closing fence line,
 * not including that line's break. Null when the note has no front matter.
 */
export function foldRange(state: EditorState): { from: number; to: number } | null {
  const { raw } = splitFrontMatter(state.doc.toString())
  if (raw === null || raw.length === 0) return null
  return { from: 0, to: state.doc.lineAt(raw.length - 1).to }
}

class SummaryWidget extends WidgetType {
  constructor(
    readonly summary: string,
    readonly open: () => void
  ) {
    super()
  }

  eq(other: SummaryWidget): boolean {
    return other.summary === this.summary
  }

  toDOM(): HTMLElement {
    const el = document.createElement('div')
    el.className = 'cm-yaml-summary'
    el.textContent = `▸ ${this.summary}`
    el.title = 'Show the YAML'
    el.addEventListener('mousedown', (event) => {
      event.preventDefault()
      this.open()
    })
    return el
  }

  ignoreEvent(): boolean {
    return true
  }
}

const foldConfig = StateField.define<YamlFoldState>({
  create: () => ({ folded: false, broken: false, summary: '' }),
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setYamlFold)) value = effect.value
    return value
  }
})

/** Folds the front matter to one line, or marks it when it is broken. `open` unfolds it. */
export function yamlFold(open: () => void): Extension {
  const build = (state: EditorState): DecorationSet => {
    const config = state.field(foldConfig)
    const range = foldRange(state)
    if (!range) return Decoration.none
    if (config.broken) return Decoration.set([Decoration.line({ class: 'cm-yaml-broken' }).range(0)])
    if (!config.folded) return Decoration.none
    return Decoration.set([
      Decoration.replace({ widget: new SummaryWidget(config.summary, open), block: true }).range(range.from, range.to)
    ])
  }

  const decorations = StateField.define<DecorationSet>({
    create: build,
    update: (value, tr) => (tr.docChanged || tr.effects.some((e) => e.is(setYamlFold)) ? build(tr.state) : value),
    provide: (field) => EditorView.decorations.from(field)
  })

  return [foldConfig, decorations]
}
```

- [ ] **Step 3: Use it in `src/renderer/editors/CodePane.tsx`**

- Import: `import { foldRange, setYamlFold, yamlFold, type YamlFoldState } from './yamlFold'`.
- Props gain:

```ts
  yaml: YamlFoldState
  onYamlOpen: () => void
```

- Inside the component, before the first effect:

```ts
  const yamlRef = useRef(yaml)
  yamlRef.current = yaml
  const openRef = useRef(onYamlOpen)
  openRef.current = onYamlOpen
```

- In the extensions list, after `activeRangeField`, add `yamlFold(() => openRef.current())`.
- In the `updateListener`, add:

```ts
          // Moving the cursor into folded YAML (Ctrl+Home, find, arrow keys) opens it, so
          // nobody types into text they cannot see.
          if (update.selectionSet && update.transactions.some((tr) => tr.isUserEvent('select'))) {
            const range = foldRange(update.state)
            const fold = yamlRef.current
            if (range && fold.folded && !fold.broken && update.state.selection.main.head <= range.to) openRef.current()
          }
```

- After the existing `[text]` effect, add:

```ts
  // Apply the fold, and keep the cursor out of anything it hides.
  useEffect(() => {
    const current = view.current
    if (!current) return
    current.dispatch({ effects: setYamlFold.of(yaml) })
    if (!yaml.folded || yaml.broken) return
    const range = foldRange(current.state)
    if (range && current.state.selection.main.head <= range.to) {
      current.dispatch({ selection: { anchor: Math.min(range.to + 1, current.state.doc.length) } })
    }
  }, [yaml.folded, yaml.broken, yaml.summary, text])
```

- [ ] **Step 4: Wire it in `src/renderer/App.tsx`**

Add, after `ticks`:

```ts
  const yamlState = useMemo(() => {
    const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
    return {
      folded: settings?.yamlFolded ?? true,
      broken: !ticks.ok,
      summary: `YAML · ${count(ticks.skillNames.length, 'skill')} · ${count(ticks.domainNames.length, 'domain')} · ${count(ticks.tagCount, 'tag')}`
    }
  }, [settings?.yamlFolded, ticks])

  const setYamlFolded = useCallback(
    (folded: boolean) => {
      if (!settings || settings.yamlFolded === folded) return
      setSettings({ ...settings, yamlFolded: folded })
      void window.marki.settings.write({ yamlFolded: folded })
    },
    [settings]
  )
```

In the raw pane section, before `<CodePane`, add the button, and pass the new props:

```tsx
                  {doc.frontMatterRaw !== null && ticks.ok && (
                    <button className="btn btn-quiet btn-tight yaml-toggle" onClick={() => setYamlFolded(!settings.yamlFolded)}>
                      {settings.yamlFolded ? 'View YAML' : 'Hide YAML'}
                    </button>
                  )}
```

```tsx
                    yaml={yamlState}
                    onYamlOpen={() => setYamlFolded(false)}
```

- [ ] **Step 5: Styles**

Append to `src/renderer/styles.css`:

```css
.yaml-toggle { position: absolute; top: 8px; right: 12px; z-index: 5; background: var(--bg); font-size: 11.5px; }
.cm-yaml-summary { color: var(--muted); cursor: pointer; font-family: var(--ui); font-size: 12.5px; padding: 2px 0 6px; user-select: none; }
.cm-yaml-summary:hover { color: var(--accent); }
.cm-yaml-broken { box-shadow: inset 3px 0 0 var(--danger); }
```

- [ ] **Step 6: Verify**

Run: `npm run verify`
Expected: all green, including `fold.spec.ts`. If "typing at the start of the body" fails because text landed before `---`, the selection guard in Step 3 is not running; check that the effect depends on `text` as well.

- [ ] **Step 7: Commit**

```bash
git add -A src tests
git commit -m "Fold the YAML to a summary line in the raw pane, with View YAML

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase 5: Words and release

### Task 13: Help, welcome note, docs and version 1.2.0

**Files:**
- Modify: `src/renderer/ui/HelpDialog.tsx`, `src/main/welcome.ts`, `README.md`, `docs/INSTALL.md`, `package.json`, `package-lock.json`
- Create: `docs/release-notes-1.2.0.md`

- [ ] **Step 1: Help dialog**

Replace the Funky Bunch section of `src/renderer/ui/HelpDialog.tsx` (the `<h3>` through the `muted` paragraph) with:

```tsx
      <h3 className="section-head">The Funky Bunch</h3>
      <p>
        The left pane is the <strong>Funky Bunch</strong>. Its grid has your <strong>skill folders</strong> across the
        top (folders that do a kind of work, like a CLAUDE.md and its skills) and your <strong>domain folders</strong>{' '}
        down the side (folders that gather everything about one subject). Tick the ones this note belongs to. The
        ticks are written straight into the note&apos;s YAML, so you can watch them appear in the raw pane.
      </p>
      <p>
        <strong>Save</strong> saves the working version where it lives. Tick <strong>Archive / distribute</strong>{' '}
        when this version is a milestone, and Save also drops a dated copy into your second brain&apos;s{' '}
        <strong>raw</strong> folder. Earlier copies are never overwritten.
      </p>
      <p className="muted">
        A bunch is a saved set of ticks plus a raw folder. Click one to apply it; right-click to edit it. The numbers
        in the grid count how many archive copies went to each pair.
      </p>
```

- [ ] **Step 2: Welcome note**

Replace `src/main/welcome.ts` with:

```ts
export const WELCOME_NOTE = [
  '---',
  'type: note',
  'title: Welcome to MarkiMarkdown',
  'tags: [markimarkdown]',
  '---',
  '',
  '# Welcome',
  '',
  'In the **middle** is the raw Markdown. On the **right** is the same note, tidied up.',
  'Edit either side and the other keeps up. Try changing *this* word.',
  '',
  'Markdown you will use most:',
  '',
  '- `#` at the start of a line makes a heading',
  '- Two stars around a word make it **bold**',
  '- A dash starts a bullet',
  '',
  'Your turn:',
  '',
  '- [ ] In the Funky Bunch pane on the left, add a skill folder and a domain folder',
  '- [ ] Tick a square in the grid and watch the YAML at the top of this note change',
  '- [ ] Tick Archive / distribute, then press Save',
  '',
  '---',
  '',
  'Save keeps this working copy where it is. Archiving also drops a dated copy into your',
  'raw folder, tagged with the skills and domains you ticked. Your second brain takes it from there.',
  ''
].join('\n')
```

- [ ] **Step 3: README**

Replace the `## The Funky Bunch` section of `README.md` (through the paragraph about the team board) with:

````markdown
## The Funky Bunch

The window has three panes, and the checkboxes at the top show or hide each one: the **Funky Bunch** on the
left, the **raw Markdown** in the middle, and the **rendered** note on the right.

The Funky Bunch is built on one idea: the folders an AI works from come in two kinds.

- **Skill folders** do a kind of work. They hold skills, a `CLAUDE.md`, instructions. A skill cuts across many
  deliverables.
- **Domain folders** gather everything about one subject: a course, a thesis, a band.

The pane's grid has skills across the top and domains down the side. Tick the ones a note belongs to and they
are written into its YAML straight away:

```yaml
skills:
  - study-coach
skill_paths:
  - C:/Users/me/skills/study-coach
domains:
  - thesis-chapter-3
domain_paths:
  - C:/Users/me/domains/thesis-chapter-3
tags: [skill/study-coach, domain/thesis-chapter-3]
```

Names and paths line up index for index, so a second-brain script can grep them. The tags are for Obsidian
users and can be turned off in Settings.

**Save** saves the working version where it lives. Tick **Archive / distribute this version** when a version is
a milestone, and Save also writes a dated copy (`essay-2026-10-04.md`, then `-2`, `-3`…) into your second
brain's **raw** folder, with an `archived:` timestamp. Copies are never overwritten. Your second brain reads the
raw folder and does the routing; MarkiMarkdown never writes into skill or domain folders.

A **bunch** is a saved set of ticks plus a raw folder, like a group chat. Click one to apply it.

Upgrading from 1.1: notes that say `agents:` and `artifacts:` open with the right boxes ticked and switch to
`skills:` and `domains:` the first time you tick something. Notes are never rewritten just by opening them.
````

- [ ] **Step 4: Install guide**

In `docs/INSTALL.md`, replace the `## Your first run` section body (after its first paragraph) with:

```markdown
On the left is the **Funky Bunch**. It starts empty, so let's set it up. The idea is that the folders you work
with come in two kinds: **skill folders** do a kind of work (they hold skills and instructions for an AI), and
**domain folders** gather everything about one subject.

1. In the Funky Bunch pane, click **Add a domain**.
2. Pick a folder on your computer. If you already keep notes about a subject somewhere, pick that. If not, make a
   new folder in Documents first.
3. Give it a short name and pick an emoji for it. Click **Save**.
4. If you have a folder that an AI agent works from, click **Add a skill** and pick that too.
5. Click a square in the grid. Watch the top of the note in the middle pane: the skill and domain you ticked
   appear in its YAML.
6. Under **Archive copy goes to raw folder**, choose your second brain's raw folder.
7. Tick **Archive / distribute this version** and press **Save and archive**.

Your note stays where it is, and a dated copy lands in the raw folder, tagged with what you ticked.
```

Replace the question `### Where did my file go after I clicked File?` and its answer with:

```markdown
### Where did my archive copy go?

Into the raw folder shown under **Archive copy goes to raw folder**, named after your note with the date added,
like `essay-2026-10-04.md`. A second archive on the same day becomes `essay-2026-10-04-2.md`; nothing is ever
overwritten. The working version stays where it was. The top bar says how many times a note has been archived.
```

In the Obsidian answer, change "Point a bunch's raw folder" to "Point your raw folder", "Every note MarkiMarkdown files" to "Every copy MarkiMarkdown archives", and "The agents and artifacts also show up as Obsidian tags, as `agent/name` and `artifact/name`" to "The skills and domains also show up as Obsidian tags, as `skill/name` and `domain/name`". Change any `1.1.0` installer file names in the download section to `1.2.0`.

- [ ] **Step 5: Release notes**

Create `docs/release-notes-1.2.0.md`:

```markdown
# MarkiMarkdown 1.2.0

## Three panes

The window now has three panes: **Funky Bunch**, **Raw Markdown** and **Rendered Marki**. Checkboxes at the top
show or hide each one (Ctrl+1, Ctrl+2, Ctrl+3), and the dividers between them drag.

## Skills and domains

Agents are now called **skills** and artifacts are now called **domains**. Skill folders do a kind of work;
domain folders gather everything about one subject. Your settings are converted automatically, and a backup of
the old ones is kept as `settings.v2.bak.json` next to them.

## Tick, and watch the YAML change

The Funky Bunch pane's grid writes straight into the note's YAML. Tick a square and `skills:`, `domains:` and
the matching tags appear. Undo takes them back. The raw pane folds the YAML to one line; **View YAML** opens it.

## Save, and archive the milestones

**Save** keeps the working version where it lives. Tick **Archive / distribute this version** and Save also
drops a dated copy into your raw folder, with an `archived:` timestamp. Copies are never overwritten. The old
File button is gone.

## For anyone with scripts

New notes use `skills`, `skill_paths`, `domains` and `domain_paths` in place of `agents`, `agent_paths`,
`artifacts` and `artifact_paths`, and tags `skill/…` and `domain/…`. Older notes keep the old keys until you
tick something in them. Archive copies carry `archived:` in place of `filed:`.
```

- [ ] **Step 6: Version**

Run: `npm version 1.2.0 --no-git-tag-version`
Expected: `package.json` and `package-lock.json` say 1.2.0.

- [ ] **Step 7: Final verification and installer**

Run: `npm run verify`
Expected: all green.

Run: `npm run pack:win`
Expected: `dist/MarkiMarkdown-Setup-1.2.0.exe` (or the name electron-builder.yml produces) and `dist/win-unpacked/`.

Run: `npx playwright test tests/e2e/packaged.spec.ts`
Expected: PASS against the fresh `dist/win-unpacked`. If Windows Smart App Control blocks the unsigned exe, report that rather than working around it.

- [ ] **Step 8: Commit**

```bash
git add -A src docs README.md package.json package-lock.json
git commit -m "MarkiMarkdown 1.2.0: help, welcome note, docs and release notes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
