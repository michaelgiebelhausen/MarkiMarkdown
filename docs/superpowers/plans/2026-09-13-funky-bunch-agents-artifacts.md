# Funky Bunch v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace "copy a note into every selected folder" with "file a note once into a bunch's raw folder, stamped with the agents and artifacts involved", plus a team board that shows agents across the top and artifacts down the side.

**Architecture:** Pure logic lives in `src/shared` (migration, stamp building, ledger maths, kind proposal) so vitest covers it without Electron. The main process keeps disk work (filing, ledger file, settings migration on read). The renderer gets a rewritten strip (bunch tiles), three dialogs (member, bunch, team board) and a rewired `App.tsx`. The editor panes are untouched.

**Tech Stack:** Electron 43, React 19, TypeScript, `yaml`, vitest (unit, `tests/unit`), Playwright driving real Electron (`tests/e2e`).

**Spec:** `docs/superpowers/specs/2026-09-13-funky-bunch-agents-artifacts-design.md`

**Branch:** `feature/funky-bunch-v2` (already created, spec committed).

---

## Read this before starting

- **Typecheck goes red in Task 5 and comes back green in Task 12.** That is expected. Between those tasks, run only the unit tests each task names. Do not "fix" unrelated type errors early; the later tasks replace those files.
- **Never write backslashes through a Bash heredoc.** In this environment a heredoc collapses `\\` to `\`. Use the Write tool for every file in this plan. Tests that need a Windows separator build it with `String.fromCharCode(92)` or `sep` from `node:path`.
- **Never rewrite untouched Markdown.** `stampNote` only rewrites the front matter block. Keep it that way.
- Commands: `npm test -- <file>` runs one vitest file. `npm run typecheck`, `npm run build`, `npm run test:e2e`, `npm run verify` (all four).
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## File map

Create:
- `src/shared/migrate.ts` — 1.0 settings → 2.0 settings, pure
- `src/shared/memberKind.ts` — propose agent/artifact from a folder listing, pure
- `src/shared/ledger.ts` — pair counts and last bunch, pure
- `src/shared/bunch.ts` — resolve a bunch's members, build its stamp, pure
- `src/main/ipc/ledger.ts` — `ledger.json` in userData
- `src/renderer/funkybunch/MemberDialog.tsx` — one dialog for agents and artifacts
- `src/renderer/funkybunch/BunchDialog.tsx`
- `src/renderer/funkybunch/TeamBoard.tsx`
- `tests/unit/migrate.test.ts`, `tests/unit/memberKind.test.ts`, `tests/unit/ledger.test.ts`, `tests/unit/bunch.test.ts`
- `tests/e2e/board.spec.ts`

Modify:
- `src/shared/types.ts`, `src/shared/paths.ts`, `src/shared/markdown/frontmatter.ts`
- `src/main/ipc/settings.ts`, `src/main/ipc/filing.ts` (rewrite), `src/main/index.ts`, `src/main/welcome.ts`
- `src/preload/index.ts`
- `src/renderer/funkybunch/selection.ts` (rewrite), `src/renderer/funkybunch/Strip.tsx` (rewrite)
- `src/renderer/App.tsx` (rewrite), `src/renderer/ui/SettingsDialog.tsx`, `src/renderer/ui/HelpDialog.tsx`, `src/renderer/styles.css`
- `README.md`
- `tests/unit/frontmatter.test.ts`, `tests/unit/paths.test.ts`, `tests/unit/selection.test.ts` (rewrite), `tests/unit/filing.test.ts` (rewrite)
- `tests/e2e/helpers.ts`, `filing.spec.ts` (rewrite), `features.spec.ts`, `fixes.spec.ts`, `firstrun.spec.ts`, `packaged.spec.ts`, `shot.spec.ts`

Delete:
- `src/renderer/funkybunch/MemberDialogs.tsx` (replaced by `MemberDialog.tsx` and `BunchDialog.tsx`)

---

### Task 1: Forward-slash paths

**Files:**
- Modify: `src/shared/paths.ts`
- Test: `tests/unit/paths.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/paths.test.ts` (inside the file, after the existing imports add `toForwardSlashes` to the import list from `@shared/paths`):

```ts
describe('toForwardSlashes', () => {
  const BS = String.fromCharCode(92)

  test('turns every backslash into a forward slash', () => {
    expect(toForwardSlashes(`C:${BS}Users${BS}me${BS}agents`)).toBe('C:/Users/me/agents')
  })

  test('leaves a POSIX path alone', () => {
    expect(toForwardSlashes('/home/me/agents')).toBe('/home/me/agents')
  })

  test('leaves an empty string empty', () => {
    expect(toForwardSlashes('')).toBe('')
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- tests/unit/paths.test.ts`
Expected: FAIL, `toForwardSlashes` is not exported.

- [ ] **Step 3: Implement**

Append to `src/shared/paths.ts`:

```ts
/** Paths written into front matter use forward slashes on every platform so scripts can grep them. */
export function toForwardSlashes(path: string): string {
  return path.split(BACKSLASH).join('/')
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- tests/unit/paths.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/paths.ts tests/unit/paths.test.ts
git commit -m "Add toForwardSlashes for stamp paths

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The bunch stamp in front matter

**Files:**
- Modify: `src/shared/markdown/frontmatter.ts`
- Test: `tests/unit/frontmatter.test.ts`

- [ ] **Step 1: Update the existing agents test and add the bunch tests**

In `tests/unit/frontmatter.test.ts`, replace the test named `writes agents when given and omits the key when the list is empty` with:

```ts
  test('writes agents as a block list and omits the key when the list is empty', () => {
    const withAgents = stampNote('body\n', { ...base, agents: ['librarian'] })
    expect(withAgents).toContain('agents:\n  - librarian')
    const without = stampNote('body\n', { ...base, agents: [] })
    expect(without).not.toContain('agents')
  })
```

Then append a new describe block at the end of the file:

```ts
describe('stampNote with a bunch', () => {
  const base = { id: 'X', type: 'note', filed: 'n', created: 'c' }
  const who = {
    bunch: 'thesis',
    agents: ['study-coach', 'research-assistant'],
    agentPaths: ['C:/Users/me/agents/study-coach', 'C:/Users/me/agents/research-assistant'],
    artifacts: ['thesis-chapter-3'],
    artifactPaths: ['C:/Users/me/artifacts/thesis-chapter-3']
  }

  function data(out: string) {
    const parsed = parseFrontMatter(String(splitFrontMatter(out).raw))
    expect(parsed.ok).toBe(true)
    return parsed.ok ? parsed.data : {}
  }

  test('writes five parallel keys as block lists', () => {
    const out = stampNote('body\n', { ...base, ...who })
    expect(out).toContain('bunch: thesis')
    expect(out).toContain('agents:\n  - study-coach\n  - research-assistant')
    expect(out).toContain('agent_paths:\n  - C:/Users/me/agents/study-coach')
    expect(out).toContain('artifacts:\n  - thesis-chapter-3')
    expect(out).toContain('artifact_paths:\n  - C:/Users/me/artifacts/thesis-chapter-3')
    const parsed = data(out)
    expect(parsed.agents).toEqual(who.agents)
    expect(parsed.agent_paths).toEqual(who.agentPaths)
    expect(parsed.artifacts).toEqual(who.artifacts)
    expect(parsed.artifact_paths).toEqual(who.artifactPaths)
    expect(out.endsWith('body\n')).toBe(true)
  })

  test('refiling replaces every stamp key wholesale', () => {
    const src =
      '---\nbunch: old\nagents:\n  - gone\nagent_paths:\n  - /old/gone\nartifacts:\n  - stale\nartifact_paths:\n  - /old/stale\n---\nbody\n'
    const out = stampNote(src, { ...base, ...who })
    expect(out).not.toContain('old')
    expect(out).not.toContain('gone')
    expect(out).not.toContain('stale')
    expect(data(out).bunch).toBe('thesis')
  })

  test('an empty list removes the key instead of writing []', () => {
    const src = '---\nbunch: old\nartifacts:\n  - stale\nartifact_paths:\n  - /old/stale\n---\nbody\n'
    const out = stampNote(src, { ...base, ...who, artifacts: [], artifactPaths: [] })
    expect(out).not.toContain('artifacts')
    expect(out).not.toContain('artifact_paths')
    expect(out).not.toContain('[]')
  })

  test('an agent with no folder yet still gets a slot in agent_paths', () => {
    const out = stampNote('body\n', { ...base, ...who, agents: ['a', 'b'], agentPaths: ['', '/b'] })
    expect(data(out).agent_paths).toEqual(['', '/b'])
  })

  test('mirrored tags from the last filing are replaced, hand-written tags stay', () => {
    const src = '---\ntags: [ai, agent/old, artifact/stale]\n---\nbody\n'
    const out = stampNote(src, { ...base, ...who, tags: ['agent/study-coach', 'artifact/thesis-chapter-3'] })
    expect(data(out).tags).toEqual(['ai', 'agent/study-coach', 'artifact/thesis-chapter-3'])
  })

  test('a stamp without a bunch leaves mirrored tags alone', () => {
    const src = '---\ntags: [ai, agent/old]\n---\nbody\n'
    const out = stampNote(src, { ...base, tags: ['extra'] })
    expect(data(out).tags).toEqual(['ai', 'agent/old', 'extra'])
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npm test -- tests/unit/frontmatter.test.ts`
Expected: FAIL. The block-list assertion fails (arrays are written in flow style today) and the bunch keys are missing.

- [ ] **Step 3: Implement**

In `src/shared/markdown/frontmatter.ts`:

Add above `function applyPatch`:

```ts
/** Keys a second-brain script greps line by line, so they are written one item per line. */
const BLOCK_LIST_KEYS = new Set(['agents', 'agent_paths', 'artifacts', 'artifact_paths'])

/** Tags in these namespaces are written by filing and replaced on every filing. */
const MIRRORED_TAG = /^(agent|artifact)\//
```

In `applyPatch`, change the array branch so it reads:

```ts
    if (Array.isArray(value)) {
      const node = doc.createNode(value) as YAMLSeq
      node.flow = !BLOCK_LIST_KEYS.has(key)
      doc.set(key, node)
      continue
    }
```

Replace the `Stamp` interface with:

```ts
export interface Stamp {
  id: string
  /** Omitted entirely for the plain preset, which keeps front matter minimal. */
  type?: string
  filed: string
  created: string
  tags?: string[]
  title?: string
  /** Set when filing to a bunch. Replaces bunch, agents, agent_paths, artifacts and artifact_paths wholesale. */
  bunch?: string
  agents?: string[]
  agentPaths?: string[]
  artifacts?: string[]
  artifactPaths?: string[]
}
```

Replace the body of `stampNote` from `const current = existing.data` down to the `const patch` declaration's closing brace with:

```ts
  const current = existing.data
  const filing = stamp.bunch !== undefined
  const tags = normaliseTags(current.tags).filter((tag) => !filing || !MIRRORED_TAG.test(tag))
  for (const tag of normaliseTags(stamp.tags)) {
    if (!tags.includes(tag)) tags.push(tag)
  }

  // undefined leaves a key alone, null removes it, a list writes it
  const list = (value: string[] | undefined): string[] | null | undefined =>
    value === undefined ? undefined : value.length > 0 ? value : null

  const patch: FrontMatterPatch = {
    id: typeof current.id === 'string' && current.id.length > 0 ? undefined : stamp.id,
    type:
      stamp.type === undefined || (typeof current.type === 'string' && current.type.length > 0)
        ? undefined
        : stamp.type,
    created:
      typeof current.created === 'string' && current.created.length > 0 ? undefined : stamp.created,
    filed: stamp.filed,
    tags: tags.length > 0 ? tags : undefined,
    bunch: stamp.bunch === undefined ? undefined : stamp.bunch.length > 0 ? stamp.bunch : null,
    agents: list(stamp.agents),
    agent_paths: list(stamp.agentPaths),
    artifacts: list(stamp.artifacts),
    artifact_paths: list(stamp.artifactPaths),
    title: stamp.title
  }
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- tests/unit/frontmatter.test.ts`
Expected: PASS. If the `yaml` library quotes `C:/Users/...` values, the substring assertions still pass because the quote sits before `C:`; if one fails, loosen only that `toContain` to `toMatch(/agent_paths:\n  - "?C:\/Users\/me\/agents\/study-coach/)`.

- [ ] **Step 5: Commit**

```bash
git add src/shared/markdown/frontmatter.ts tests/unit/frontmatter.test.ts
git commit -m "Stamp bunch, agents and artifacts with parallel path lists

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Propose a member kind from a folder listing

**Files:**
- Create: `src/shared/memberKind.ts`
- Test: `tests/unit/memberKind.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/memberKind.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { proposeKind } from '@shared/memberKind'

describe('proposeKind', () => {
  test('a folder with CLAUDE.md is an agent', () => {
    expect(proposeKind(['CLAUDE.md', 'notes.md'])).toBe('agent')
  })

  test('a folder with AGENTS.md is an agent', () => {
    expect(proposeKind(['AGENTS.md'])).toBe('agent')
  })

  test('a folder with a .claude directory is an agent', () => {
    expect(proposeKind(['.claude', 'README.md'])).toBe('agent')
  })

  test('a folder with a skills directory is an agent', () => {
    expect(proposeKind(['skills'])).toBe('agent')
  })

  test('matching ignores case', () => {
    expect(proposeKind(['claude.md'])).toBe('agent')
    expect(proposeKind(['Skills'])).toBe('agent')
  })

  test('anything else is an artifact', () => {
    expect(proposeKind(['chapter-1.md', 'figures'])).toBe('artifact')
    expect(proposeKind([])).toBe('artifact')
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npm test -- tests/unit/memberKind.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `src/shared/memberKind.ts`:

```ts
import type { MemberKind } from './types'

/** Anything that makes a folder look like it does work rather than holds work. */
export const AGENT_MARKERS = ['claude.md', 'agents.md', '.claude', 'skills']

/** Proposes a kind for a folder from the names of its top-level entries. */
export function proposeKind(entryNames: string[]): MemberKind {
  const lower = entryNames.map((name) => name.toLowerCase())
  return AGENT_MARKERS.some((marker) => lower.includes(marker)) ? 'agent' : 'artifact'
}
```

`MemberKind` does not exist yet; add this one line to `src/shared/types.ts` directly above `export interface FolderMember` (the rest of that file changes in Task 5):

```ts
export type MemberKind = 'agent' | 'artifact'
```

- [ ] **Step 4: Run the test**

Run: `npm test -- tests/unit/memberKind.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/memberKind.ts src/shared/types.ts tests/unit/memberKind.test.ts
git commit -m "Propose agent or artifact from a folder listing

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Ledger maths

**Files:**
- Create: `src/shared/ledger.ts`
- Test: `tests/unit/ledger.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ledger.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { lastBunchFor, pairCounts, pairKey } from '@shared/ledger'
import type { LedgerEntry } from '@shared/types'

const entries: LedgerEntry[] = [
  { noteId: 'n1', bunchId: 'b1', agentIds: ['a1', 'a2'], artifactIds: ['x1'], filedAt: '2026-09-13T10:00:00+00:00' },
  { noteId: 'n2', bunchId: 'b1', agentIds: ['a1'], artifactIds: ['x1', 'x2'], filedAt: '2026-09-13T11:00:00+00:00' },
  { noteId: 'n1', bunchId: 'b2', agentIds: ['a2'], artifactIds: ['x2'], filedAt: '2026-09-13T12:00:00+00:00' }
]

describe('pairCounts', () => {
  test('counts how many filings carried both an agent and an artifact', () => {
    const counts = pairCounts(entries)
    expect(counts.get(pairKey('a1', 'x1'))).toBe(2)
    expect(counts.get(pairKey('a2', 'x1'))).toBe(1)
    expect(counts.get(pairKey('a1', 'x2'))).toBe(1)
    expect(counts.get(pairKey('a2', 'x2'))).toBe(1)
    expect(counts.get(pairKey('a3', 'x1'))).toBeUndefined()
  })

  test('an empty ledger has no counts', () => {
    expect(pairCounts([]).size).toBe(0)
  })
})

describe('lastBunchFor', () => {
  test('returns the most recent bunch a note was filed to', () => {
    expect(lastBunchFor(entries, 'n1')).toBe('b2')
    expect(lastBunchFor(entries, 'n2')).toBe('b1')
  })

  test('returns undefined for an unknown or empty note id', () => {
    expect(lastBunchFor(entries, 'n9')).toBeUndefined()
    expect(lastBunchFor(entries, '')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npm test -- tests/unit/ledger.test.ts`
Expected: FAIL, module not found (and `LedgerEntry` missing).

- [ ] **Step 3: Implement**

Add to `src/shared/types.ts` directly under the `MemberKind` line:

```ts
/** One filing, recorded in the app's own ledger. Feeds the team board counts. */
export interface LedgerEntry {
  noteId: string
  bunchId: string
  agentIds: string[]
  artifactIds: string[]
  /** ISO 8601 with offset. */
  filedAt: string
}
```

Create `src/shared/ledger.ts`:

```ts
import type { LedgerEntry } from './types'

export function pairKey(agentId: string, artifactId: string): string {
  return `${agentId}|${artifactId}`
}

/** How many filings carried both members, keyed by pairKey. */
export function pairCounts(entries: LedgerEntry[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    for (const agentId of entry.agentIds) {
      for (const artifactId of entry.artifactIds) {
        const key = pairKey(agentId, artifactId)
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
  }
  return counts
}

/** The bunch a note was most recently filed to, if it ever was. */
export function lastBunchFor(entries: LedgerEntry[], noteId: string): string | undefined {
  if (noteId.length === 0) return undefined
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].noteId === noteId) return entries[i].bunchId
  }
  return undefined
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- tests/unit/ledger.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/ledger.ts src/shared/types.ts tests/unit/ledger.test.ts
git commit -m "Add ledger pair counts and last-bunch lookup

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: New settings shape, migration and bunch helpers

Typecheck goes red here (App, dialogs, selection, main still use the old types). That is expected until Task 12.

**Files:**
- Modify: `src/shared/types.ts` (rewrite)
- Create: `src/shared/migrate.ts`, `src/shared/bunch.ts`
- Test: `tests/unit/migrate.test.ts`, `tests/unit/bunch.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/migrate.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { migrateSettings } from '@shared/migrate'

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

describe('migrateSettings from 1.0', () => {
  test('folders become artifacts with the same id, name, emoji and path', () => {
    const out = migrateSettings(v1)
    expect(out.members.find((m) => m.id === 'f1')).toEqual({
      id: 'f1', kind: 'artifact', name: 'Inbox', emoji: '📥', path: '/sb/Inbox'
    })
    expect(out.members.find((m) => m.id === 'f2')?.kind).toBe('artifact')
  })

  test('agents keep their identity but have no folder yet', () => {
    const out = migrateSettings(v1)
    expect(out.members.find((m) => m.id === 'a1')).toEqual({
      id: 'a1', kind: 'agent', name: 'librarian', emoji: '📚', path: ''
    })
  })

  test('an agent that read folders becomes a bunch of that agent and those artifacts', () => {
    const out = migrateSettings(v1)
    expect(out.bunches).toHaveLength(1)
    expect(out.bunches[0]).toEqual({
      id: 'b-a1', name: 'librarian', emoji: '📚', rawPath: '', agentIds: ['a1'], artifactIds: ['f1', 'f2']
    })
  })

  test('tag mirroring is switched on and the old key is gone', () => {
    const out = migrateSettings(v1) as unknown as Record<string, unknown>
    expect(out.mirrorMembersAsTags).toBe(true)
    expect('mirrorAgentsAsTags' in out).toBe(false)
  })

  test('other settings survive', () => {
    const out = migrateSettings(v1) as unknown as Record<string, unknown>
    expect(out.autosave).toBe(false)
    expect(out.seenCoachmark).toBe(true)
    expect(out.windowBounds).toEqual({ width: 1000, height: 700, x: 1, y: 2 })
  })

  test('is idempotent', () => {
    const once = migrateSettings(v1)
    expect(migrateSettings(once)).toEqual(once)
  })
})

describe('migrateSettings with 2.0 settings', () => {
  test('passes members and bunches through and fills defaults', () => {
    const out = migrateSettings({
      members: [{ id: 'x', kind: 'artifact', name: 'Thesis', emoji: '📕', path: '/a/thesis' }],
      bunches: [{ id: 'b', name: 'study', emoji: '👥', rawPath: '/raw', agentIds: [], artifactIds: ['x'] }]
    })
    expect(out.members).toHaveLength(1)
    expect(out.bunches[0].artifactIds).toEqual(['x'])
    expect(out.autosave).toBe(true)
    expect(out.mirrorMembersAsTags).toBe(true)
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
  })
})
```

Create `tests/unit/bunch.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { buildStamp, membersOf } from '@shared/bunch'
import type { Bunch, Member } from '@shared/types'

const BS = String.fromCharCode(92)
const members: Member[] = [
  { id: 'a1', kind: 'agent', name: 'study-coach', emoji: '🎓', path: `C:${BS}me${BS}agents${BS}study-coach` },
  { id: 'a2', kind: 'agent', name: 'old-agent', emoji: '🤖', path: '' },
  { id: 'x1', kind: 'artifact', name: 'thesis', emoji: '📕', path: '/me/artifacts/thesis' }
]
const bunch: Bunch = {
  id: 'b1', name: 'thesis-team', emoji: '👥', rawPath: '/raw',
  agentIds: ['a1', 'a2', 'ghost'], artifactIds: ['x1', 'a1']
}

describe('membersOf', () => {
  test('resolves ids to members of the right kind and ignores the rest', () => {
    const { agents, artifacts } = membersOf(bunch, members)
    expect(agents.map((m) => m.id)).toEqual(['a1', 'a2'])
    expect(artifacts.map((m) => m.id)).toEqual(['x1'])
  })
})

describe('buildStamp', () => {
  test('lists names and forward-slash paths index for index', () => {
    const stamp = buildStamp(bunch, members, false)
    expect(stamp.bunch).toBe('thesis-team')
    expect(stamp.agents).toEqual(['study-coach', 'old-agent'])
    expect(stamp.agentPaths).toEqual(['C:/me/agents/study-coach', ''])
    expect(stamp.artifacts).toEqual(['thesis'])
    expect(stamp.artifactPaths).toEqual(['/me/artifacts/thesis'])
    expect(stamp.agentIds).toEqual(['a1', 'a2'])
    expect(stamp.artifactIds).toEqual(['x1'])
    expect(stamp.tags).toEqual([])
  })

  test('mirrors members as agent/ and artifact/ tags when asked', () => {
    expect(buildStamp(bunch, members, true).tags).toEqual([
      'agent/study-coach', 'agent/old-agent', 'artifact/thesis'
    ])
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npm test -- tests/unit/migrate.test.ts tests/unit/bunch.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Rewrite `src/shared/types.ts`**

Replace the whole file with:

```ts
export type MemberKind = 'agent' | 'artifact'

/** A folder in the roster. Agents do work; artifacts hold what the work produces. */
export interface Member {
  id: string
  kind: MemberKind
  name: string
  emoji: string
  /** Absolute folder path. Empty only for agents migrated from 1.0 settings. */
  path: string
}

/** A named group of agents and artifacts that files into one raw folder. */
export interface Bunch {
  id: string
  name: string
  emoji: string
  /** Absolute path of the raw folder this bunch files into. Empty until chosen. */
  rawPath: string
  agentIds: string[]
  artifactIds: string[]
}

/** One filing, recorded in the app's own ledger. Feeds the team board counts. */
export interface LedgerEntry {
  noteId: string
  bunchId: string
  agentIds: string[]
  artifactIds: string[]
  /** ISO 8601 with offset. */
  filedAt: string
}

export interface Settings {
  members: Member[]
  bunches: Bunch[]
  /** Pre-fills the raw folder when a bunch is created. Empty means none. */
  defaultRawPath?: string
  autosave: boolean
  frontMatterPreset: 'okf' | 'basic'
  /** Also write agent/<name> and artifact/<name> tags, for Obsidian users. */
  mirrorMembersAsTags: boolean
  aiProvider: 'auto' | 'claude' | 'ollama' | 'apiKey' | 'none'
  aiClaudePath?: string
  ollamaModel?: string
  disableHardwareAcceleration: boolean
  seenCoachmark: boolean
  confirmedFileMoves: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  members: [],
  bunches: [],
  autosave: true,
  frontMatterPreset: 'okf',
  mirrorMembersAsTags: true,
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
  memberCount: { agents: number; artifacts: number; bunches: number }
  recentLog: string[]
}
```

- [ ] **Step 4: Create `src/shared/migrate.ts`**

```ts
import { DEFAULT_SETTINGS, type Bunch, type Member, type Settings } from './types'

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

function asMember(m: Loose): Member | null {
  if (m.kind !== 'agent' && m.kind !== 'artifact') return null
  return { id: str(m.id), kind: m.kind, name: str(m.name), emoji: str(m.emoji), path: str(m.path) }
}

function asBunch(b: Loose): Bunch {
  return {
    id: str(b.id),
    name: str(b.name),
    emoji: str(b.emoji, '👥'),
    rawPath: str(b.rawPath),
    agentIds: strings(b.agentIds),
    artifactIds: strings(b.artifactIds)
  }
}

/**
 * Settings on disk may still be the 1.0 shape: folder and agent members, no bunches.
 * Folders become artifacts. Agents keep their name and emoji but have no folder until
 * the student picks one. Each agent that read folders becomes a bunch of that agent
 * and those artifacts, with the raw folder left for the student to choose. Nothing on
 * disk outside settings.json changes, and running this twice is harmless.
 */
export function migrateSettings(raw: unknown): Settings {
  const parsed: Loose = isLoose(raw) ? raw : {}
  const list = Array.isArray(parsed.members) ? parsed.members.filter(isLoose) : []
  const { mirrorAgentsAsTags: legacyMirror, members: legacyMembers, ...rest } = parsed
  void legacyMirror
  void legacyMembers

  if (Array.isArray(parsed.bunches)) {
    return {
      ...DEFAULT_SETTINGS,
      ...(rest as Partial<Settings>),
      members: list.map(asMember).filter((m): m is Member => m !== null),
      bunches: parsed.bunches.filter(isLoose).map(asBunch)
    }
  }

  const members: Member[] = []
  for (const m of list) {
    if (m.kind === 'folder') {
      members.push({ id: str(m.id), kind: 'artifact', name: str(m.name, 'Folder'), emoji: str(m.emoji, '📁'), path: str(m.path) })
    } else if (m.kind === 'agent') {
      members.push({ id: str(m.id), kind: 'agent', name: str(m.name, 'agent'), emoji: str(m.emoji, '🤖'), path: '' })
    }
  }
  const artifactIds = members.filter((m) => m.kind === 'artifact').map((m) => m.id)

  const bunches: Bunch[] = []
  for (const m of list) {
    if (m.kind !== 'agent') continue
    const folderIds = strings(m.folderIds).filter((id) => artifactIds.includes(id))
    if (folderIds.length === 0) continue
    bunches.push({
      id: `b-${str(m.id)}`,
      name: str(m.name, 'agent'),
      emoji: str(m.emoji, '🤖'),
      rawPath: '',
      agentIds: [str(m.id)],
      artifactIds: folderIds
    })
  }

  return { ...DEFAULT_SETTINGS, ...(rest as Partial<Settings>), members, bunches, mirrorMembersAsTags: true }
}
```

- [ ] **Step 5: Create `src/shared/bunch.ts`**

```ts
import type { Bunch, Member, MemberKind } from './types'
import { toForwardSlashes } from './paths'

/** Everything the front matter and the ledger need to say about who a note is for. */
export interface BunchStamp {
  bunch: string
  agents: string[]
  agentPaths: string[]
  artifacts: string[]
  artifactPaths: string[]
  /** Only ids that resolve to a member of the right kind. */
  agentIds: string[]
  artifactIds: string[]
  tags: string[]
}

/** Resolves a bunch's ids to real members, dropping ids that are missing or the wrong kind. */
export function membersOf(bunch: Bunch, members: Member[]): { agents: Member[]; artifacts: Member[] } {
  const byId = new Map(members.map((m) => [m.id, m]))
  const pick = (ids: string[], kind: MemberKind): Member[] =>
    ids.map((id) => byId.get(id)).filter((m): m is Member => m !== undefined && m.kind === kind)
  return { agents: pick(bunch.agentIds, 'agent'), artifacts: pick(bunch.artifactIds, 'artifact') }
}

export function buildStamp(bunch: Bunch, members: Member[], mirrorAsTags: boolean): BunchStamp {
  const { agents, artifacts } = membersOf(bunch, members)
  const tags: string[] = []
  if (mirrorAsTags) {
    for (const a of agents) tags.push(`agent/${a.name}`)
    for (const b of artifacts) tags.push(`artifact/${b.name}`)
  }
  return {
    bunch: bunch.name,
    agents: agents.map((a) => a.name),
    agentPaths: agents.map((a) => toForwardSlashes(a.path)),
    artifacts: artifacts.map((b) => b.name),
    artifactPaths: artifacts.map((b) => toForwardSlashes(b.path)),
    agentIds: agents.map((a) => a.id),
    artifactIds: artifacts.map((b) => b.id),
    tags
  }
}
```

- [ ] **Step 6: Run the tests**

Run: `npm test -- tests/unit/migrate.test.ts tests/unit/bunch.test.ts tests/unit/ledger.test.ts tests/unit/memberKind.test.ts`
Expected: PASS for all four files.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/shared/migrate.ts src/shared/bunch.ts tests/unit/migrate.test.ts tests/unit/bunch.test.ts
git commit -m "Introduce agents, artifacts and bunches in settings with 1.0 migration

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Main process: single-destination filing, ledger file, migration on read

**Files:**
- Modify: `src/main/ipc/settings.ts`
- Create: `src/main/ipc/ledger.ts`
- Rewrite: `src/main/ipc/filing.ts`
- Rewrite test: `tests/unit/filing.test.ts`

- [ ] **Step 1: Rewrite `tests/unit/filing.test.ts`**

```ts
import { describe, expect, test, beforeEach } from 'vitest'
import {
  sanitizeFileName,
  preflight,
  runFiling,
  undoFiling,
  hashText,
  type FileOps,
  type FilingPlan
} from '../../src/main/ipc/filing'

/** An in-memory stand-in for the disk, with hooks to make specific paths misbehave. */
class FakeFs implements FileOps {
  files = new Map<string, string>()
  dirs = new Set<string>(['/sb', '/sb/raw', '/downloads'])
  trashed: string[] = []
  failWriteAt = new Set<string>()
  readOnlyDirs = new Set<string>()
  failTrashCount = 0

  async dirExists(p: string) {
    return this.dirs.has(p)
  }
  async canWrite(p: string) {
    return this.dirs.has(p) && !this.readOnlyDirs.has(p)
  }
  async exists(p: string) {
    return this.files.has(p)
  }
  async readText(p: string) {
    const v = this.files.get(p)
    if (v === undefined) throw new Error('ENOENT')
    return v
  }
  async writeAtomic(p: string, text: string) {
    if (this.failWriteAt.has(p)) throw new Error('EBUSY: file is locked')
    this.files.set(p, text)
  }
  async createExclusive(p: string, text: string) {
    if (this.files.has(p)) return false
    this.files.set(p, text)
    return true
  }
  async appendText(p: string, text: string) {
    this.files.set(p, (this.files.get(p) ?? '') + text)
  }
  async trash(p: string) {
    if (this.failTrashCount > 0) {
      this.failTrashCount -= 1
      throw new Error('EPERM: in use')
    }
    if (!this.files.has(p)) throw new Error('ENOENT')
    this.files.delete(p)
    this.trashed.push(p)
  }
  async mtime(p: string) {
    return this.files.has(p) ? 1000 : null
  }
}

let fs: FakeFs
beforeEach(() => {
  fs = new FakeFs()
  fs.files.set('/downloads/lecture-notes.md', 'ORIGINAL BODY')
})

const plan = (over: Partial<FilingPlan> = {}): FilingPlan => ({
  content: '---\nid: 01K3XYZ\n---\nSTAMPED CONTENT',
  fileName: 'lecture-notes.md',
  noteId: '01K3XYZ',
  currentPath: '/downloads/lecture-notes.md',
  raw: { name: 'study', path: '/sb/raw' },
  ...over
})

describe('sanitizeFileName', () => {
  test('always ends in .md and drops other note extensions', () => {
    expect(sanitizeFileName('notes.txt')).toBe('notes.md')
    expect(sanitizeFileName('notes.markdown')).toBe('notes.md')
    expect(sanitizeFileName('notes')).toBe('notes.md')
  })

  test('strips characters Windows refuses and path separators', () => {
    expect(sanitizeFileName('a<b>c:d"e|f?g*h')).toBe('abcdefgh.md')
    expect(sanitizeFileName('a/b' + String.fromCharCode(92) + 'c')).toBe('abc.md')
  })

  test('renames reserved device names and empties', () => {
    expect(sanitizeFileName('con')).toBe('con-note.md')
    expect(sanitizeFileName('')).toBe('note.md')
    expect(sanitizeFileName('...')).toBe('note.md')
  })

  test('a note called log keeps its name now that there is no folder log', () => {
    expect(sanitizeFileName('log')).toBe('log.md')
  })

  test('caps very long names', () => {
    expect(sanitizeFileName('x'.repeat(200)).length).toBe(123)
  })
})

describe('preflight', () => {
  test('passes when the raw folder is writable and the name is free', async () => {
    const check = await preflight(fs, plan())
    expect(check.ok).toBe(true)
    expect(check.conflict).toBeUndefined()
    expect(check.unavailable).toBeUndefined()
  })

  test('reports a missing raw folder by bunch name', async () => {
    const check = await preflight(fs, plan({ raw: { name: 'study', path: '/sb/nowhere' } }))
    expect(check.ok).toBe(false)
    expect(check.unavailable).toContain('study')
    expect(check.unavailable).toContain('could not be found')
  })

  test('reports a read-only raw folder', async () => {
    fs.readOnlyDirs.add('/sb/raw')
    const check = await preflight(fs, plan())
    expect(check.ok).toBe(false)
    expect(check.unavailable).toContain('cannot be written')
  })

  test('a different note with the same name is a conflict', async () => {
    fs.files.set('/sb/raw/lecture-notes.md', '---\nid: OTHER\n---\nsomeone else')
    const check = await preflight(fs, plan())
    expect(check.ok).toBe(false)
    expect(check.conflict).toEqual({ destPath: '/sb/raw/lecture-notes.md', sameId: false })
  })

  test('an older copy of the same note is not a conflict', async () => {
    fs.files.set('/sb/raw/lecture-notes.md', '---\nid: 01K3XYZ\n---\nolder')
    const check = await preflight(fs, plan())
    expect(check.ok).toBe(true)
    expect(check.conflict?.sameId).toBe(true)
  })

  test('a note already sitting at the destination is not a conflict with itself', async () => {
    fs.files.set('/sb/raw/lecture-notes.md', 'me')
    const check = await preflight(fs, plan({ currentPath: '/sb/raw/lecture-notes.md' }))
    expect(check.ok).toBe(true)
    expect(check.conflict).toBeUndefined()
  })
})

describe('runFiling', () => {
  test('writes the note into raw and moves the original to the trash', async () => {
    const out = await runFiling(fs, plan())
    expect(out.ok).toBe(true)
    expect(out.writtenPath).toBe('/sb/raw/lecture-notes.md')
    expect(fs.files.get('/sb/raw/lecture-notes.md')).toContain('STAMPED CONTENT')
    expect(fs.files.has('/downloads/lecture-notes.md')).toBe(false)
    expect(fs.trashed).toEqual(['/downloads/lecture-notes.md'])
    expect(out.undo.movedFrom).toEqual({ path: '/downloads/lecture-notes.md', text: 'ORIGINAL BODY' })
    expect(out.undo.written?.path).toBe('/sb/raw/lecture-notes.md')
    expect(out.hash).toBe(hashText(plan().content))
  })

  test('never writes a log file', async () => {
    await runFiling(fs, plan())
    expect([...fs.files.keys()].some((p) => p.endsWith('log.md'))).toBe(false)
  })

  test('a note with no home yet is simply written', async () => {
    const out = await runFiling(fs, plan({ currentPath: undefined }))
    expect(out.ok).toBe(true)
    expect(fs.trashed).toEqual([])
    expect(out.undo.movedFrom).toBeUndefined()
  })

  test('a note already in raw is rewritten in place and can be undone', async () => {
    fs.files.set('/sb/raw/lecture-notes.md', 'BEFORE')
    const out = await runFiling(fs, plan({ currentPath: '/sb/raw/lecture-notes.md' }))
    expect(out.ok).toBe(true)
    expect(fs.trashed).toEqual([])
    expect(fs.files.get('/sb/raw/lecture-notes.md')).toContain('STAMPED CONTENT')
    expect(out.undo.rewritten).toEqual({ path: '/sb/raw/lecture-notes.md', before: 'BEFORE', after: plan().content })
    expect(out.undo.written).toBeUndefined()
  })

  test('keepBoth writes beside the clash', async () => {
    fs.files.set('/sb/raw/lecture-notes.md', '---\nid: OTHER\n---\nsomeone else')
    const out = await runFiling(fs, plan({ conflictChoice: 'keepBoth' }))
    expect(out.ok).toBe(true)
    expect(out.writtenPath).toBe('/sb/raw/lecture-notes-2.md')
    expect(fs.files.get('/sb/raw/lecture-notes.md')).toContain('someone else')
  })

  test('replace trashes the displaced note and remembers it', async () => {
    fs.files.set('/sb/raw/lecture-notes.md', '---\nid: OTHER\n---\nsomeone else')
    const out = await runFiling(fs, plan({ conflictChoice: 'replace' }))
    expect(out.ok).toBe(true)
    expect(fs.files.get('/sb/raw/lecture-notes.md')).toContain('STAMPED CONTENT')
    expect(out.undo.replaced?.text).toContain('someone else')
    expect(fs.trashed).toContain('/sb/raw/lecture-notes.md')
  })

  test('cancel writes nothing', async () => {
    fs.files.set('/sb/raw/lecture-notes.md', '---\nid: OTHER\n---\nsomeone else')
    const out = await runFiling(fs, plan({ conflictChoice: 'cancel' }))
    expect(out.ok).toBe(false)
    expect(out.failure).toContain('already has a different note')
    expect(fs.files.get('/sb/raw/lecture-notes.md')).toContain('someone else')
    expect(fs.files.has('/downloads/lecture-notes.md')).toBe(true)
  })

  test('a failed write leaves the original untouched', async () => {
    fs.failWriteAt.add('/sb/raw/lecture-notes.md')
    const out = await runFiling(fs, plan())
    expect(out.ok).toBe(false)
    expect(out.failure).toContain('study')
    expect(fs.files.has('/downloads/lecture-notes.md')).toBe(true)
    expect(fs.trashed).toEqual([])
  })

  test('an original that cannot be trashed is reported, not treated as failure', async () => {
    fs.failTrashCount = 5
    const out = await runFiling(fs, plan())
    expect(out.ok).toBe(true)
    expect(out.originalKept).toBe(true)
    expect(out.notice).toContain('still where it was')
    expect(fs.files.has('/downloads/lecture-notes.md')).toBe(true)
  })

  test('an unavailable raw folder blocks everything', async () => {
    const out = await runFiling(fs, plan({ raw: { name: 'study', path: '/sb/nowhere' } }))
    expect(out.ok).toBe(false)
    expect(out.failure).toContain('could not be found')
    expect(fs.files.has('/downloads/lecture-notes.md')).toBe(true)
  })
})

describe('undoFiling', () => {
  test('puts the original back and removes the filed copy', async () => {
    const out = await runFiling(fs, plan())
    const undone = await undoFiling(fs, out.undo)
    expect(undone.ok).toBe(true)
    expect(fs.files.get('/downloads/lecture-notes.md')).toBe('ORIGINAL BODY')
    expect(fs.files.has('/sb/raw/lecture-notes.md')).toBe(false)
    expect(undone.keptChanged).toEqual([])
  })

  test('leaves the filed copy alone if it has changed since', async () => {
    const out = await runFiling(fs, plan())
    fs.files.set('/sb/raw/lecture-notes.md', 'edited afterwards')
    const undone = await undoFiling(fs, out.undo)
    expect(fs.files.get('/sb/raw/lecture-notes.md')).toBe('edited afterwards')
    expect(undone.keptChanged).toEqual(['/sb/raw/lecture-notes.md'])
    expect(undone.message).toContain('left alone')
  })

  test('restores a note that replace displaced', async () => {
    fs.files.set('/sb/raw/lecture-notes.md', '---\nid: OTHER\n---\nsomeone else')
    const out = await runFiling(fs, plan({ conflictChoice: 'replace' }))
    await undoFiling(fs, out.undo)
    expect(fs.files.get('/sb/raw/lecture-notes.md')).toContain('someone else')
  })

  test('restores the previous text after an in-place rewrite', async () => {
    fs.files.set('/sb/raw/lecture-notes.md', 'BEFORE')
    const out = await runFiling(fs, plan({ currentPath: '/sb/raw/lecture-notes.md' }))
    await undoFiling(fs, out.undo)
    expect(fs.files.get('/sb/raw/lecture-notes.md')).toBe('BEFORE')
  })

  test('does not overwrite something that reappeared at the original path', async () => {
    const out = await runFiling(fs, plan())
    fs.files.set('/downloads/lecture-notes.md', 'a new file with the old name')
    await undoFiling(fs, out.undo)
    expect(fs.files.get('/downloads/lecture-notes.md')).toBe('a new file with the old name')
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npm test -- tests/unit/filing.test.ts`
Expected: FAIL (old `FilingPlan` shape, `buildLogLine` still exported, and so on).

- [ ] **Step 3: Rewrite `src/main/ipc/filing.ts`**

```ts
/**
 * Filing a note into a bunch's raw folder.
 *
 * Two promises to the student:
 *  1. The destination is checked before a single byte is written, and the note's
 *     previous location is never removed until the new copy is safely on disk.
 *  2. Nothing is ever hard deleted. Removals go to the operating system's trash.
 *
 * Every disk operation goes through FileOps so the whole procedure - including the
 * ugly failure paths - can be exercised in tests without touching a real disk.
 */
import { samePath } from '../../shared/paths'

export interface FileOps {
  dirExists(path: string): Promise<boolean>
  canWrite(dir: string): Promise<boolean>
  exists(path: string): Promise<boolean>
  readText(path: string): Promise<string>
  /** Writes via a temp file inside the destination folder, then renames. */
  writeAtomic(path: string, text: string): Promise<void>
  /** Returns false when the path already existed. */
  createExclusive(path: string, text: string): Promise<boolean>
  appendText(path: string, text: string): Promise<void>
  trash(path: string): Promise<void>
  mtime(path: string): Promise<number | null>
}

export interface FolderRef {
  name: string
  path: string
}

export interface FilingPlan {
  /** Fully stamped file content. */
  content: string
  fileName: string
  noteId: string
  /** Where the note sits on disk right now, if it has been saved anywhere. */
  currentPath?: string
  /** The bunch's raw folder, named after the bunch for messages. */
  raw: FolderRef
  conflictChoice?: 'replace' | 'keepBoth' | 'cancel'
}

export interface UndoRecord {
  /** The note's previous location and bytes, when filing moved it. */
  movedFrom?: { path: string; text: string }
  /** The new copy filing wrote, when it wrote one. */
  written?: { path: string; text: string }
  /** The note was already in raw and was rewritten where it stood. */
  rewritten?: { path: string; before: string; after: string }
  /** A note that "replace" displaced. It is in the trash and can be put back. */
  replaced?: { path: string; text: string }
}

export interface FilingOutcome {
  ok: boolean
  writtenPath?: string
  hash?: string
  trashed: string[]
  failure?: string
  /** The previous copy could not be trashed, so it is still where it was. */
  originalKept: boolean
  notice: string
  undo: UndoRecord
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

export function sanitizeFileName(input: string): string {
  const withoutExt = input.replace(/\.(md|markdown|txt|text)$/i, '')
  let name = withoutExt.normalize('NFC')
  name = name.replace(/[<>:"|?*\u0000-\u001f]/g, '')
  name = name.split('/').join('').split(String.fromCharCode(92)).join('')
  name = name.replace(/[. ]+$/, '').replace(/^[. ]+/, '')
  if (WINDOWS_RESERVED.test(name)) name = `${name}-note`
  if (name.length === 0) name = 'note'
  if (name.length > 120) name = name.slice(0, 120).replace(/[. ]+$/, '')
  return `${name}.md`
}

/** A cheap content fingerprint - enough to notice that something else rewrote a copy. */
export function hashText(text: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 + c + i, 0x85ebca6b) >>> 0
  }
  return `${h1.toString(16)}${h2.toString(16)}-${text.length}`
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes(String.fromCharCode(92)) && !dir.includes('/') ? String.fromCharCode(92) : '/'
  return dir.endsWith('/') || dir.endsWith(String.fromCharCode(92)) ? `${dir}${name}` : `${dir}${sep}${name}`
}

function idOf(text: string): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)/.exec(text)
  if (!match) return null
  const line = /^id:\s*(.+)$/m.exec(match[1])
  return line ? line[1].trim().replace(/^["']|["']$/g, '') : null
}

export interface PreflightOutcome {
  ok: boolean
  /** The destination already holds a file with this name. */
  conflict?: { destPath: string; sameId: boolean }
  /** The raw folder cannot be written to at all. */
  unavailable?: string
}

export async function preflight(ops: FileOps, plan: FilingPlan): Promise<PreflightOutcome> {
  const fileName = sanitizeFileName(plan.fileName)
  const raw = plan.raw
  try {
    if (!(await ops.dirExists(raw.path))) {
      return {
        ok: false,
        unavailable: `${raw.name}'s raw folder could not be found. It may have been moved, renamed, or be on a drive that is not connected.`
      }
    }
    if (!(await ops.canWrite(raw.path))) {
      return { ok: false, unavailable: `${raw.name}'s raw folder cannot be written to. Check the folder's permissions.` }
    }
    const destPath = joinPath(raw.path, fileName)
    // A file at the destination that IS this note is not a clash with anyone else.
    if (plan.currentPath !== undefined && samePath(plan.currentPath, destPath)) return { ok: true }
    if (await ops.exists(destPath)) {
      let sameId = false
      try {
        sameId = idOf(await ops.readText(destPath)) === plan.noteId
      } catch {
        sameId = false
      }
      return { ok: sameId, conflict: { destPath, sameId } }
    }
    return { ok: true }
  } catch {
    return { ok: false, unavailable: `${raw.name}'s raw folder could not be reached right now.` }
  }
}

async function nextFreePath(ops: FileOps, destPath: string): Promise<string> {
  const dot = destPath.lastIndexOf('.')
  const stem = dot === -1 ? destPath : destPath.slice(0, dot)
  const ext = dot === -1 ? '' : destPath.slice(dot)
  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem}-${n}${ext}`
    if (!(await ops.exists(candidate))) return candidate
  }
  return `${stem}-${Date.now()}${ext}`
}

async function trashWithRetries(ops: FileOps, path: string, attempts = 3): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      await ops.trash(path)
      return true
    } catch {
      if (i === attempts - 1) return false
    }
  }
  return false
}

function friendlyWriteError(bunchName: string): string {
  return `${bunchName}'s raw folder could not be written to. It may be open in another program, or syncing.`
}

function failed(failure: string, undo: UndoRecord): FilingOutcome {
  return { ok: false, trashed: [], failure, originalKept: true, notice: '', undo }
}

export async function runFiling(ops: FileOps, plan: FilingPlan): Promise<FilingOutcome> {
  const fileName = sanitizeFileName(plan.fileName)
  const undo: UndoRecord = {}
  const trashed: string[] = []

  const check = await preflight(ops, plan)
  if (check.unavailable) return failed(check.unavailable, undo)

  const clash = check.conflict && !check.conflict.sameId ? check.conflict : undefined
  const choice = plan.conflictChoice ?? 'replace'
  if (clash && choice === 'cancel') {
    return failed(`${plan.raw.name} already has a different note called ${fileName}.`, undo)
  }

  let destPath = joinPath(plan.raw.path, fileName)
  const inPlace = plan.currentPath !== undefined && samePath(plan.currentPath, destPath)
  if (inPlace) destPath = plan.currentPath as string

  // 1. write the new copy
  try {
    if (inPlace) {
      let before = ''
      try {
        before = await ops.readText(destPath)
      } catch {
        /* nothing there after all */
      }
      await ops.writeAtomic(destPath, plan.content)
      undo.rewritten = { path: destPath, before, after: plan.content }
    } else {
      if (clash && choice === 'keepBoth') {
        destPath = await nextFreePath(ops, destPath)
      } else if (clash) {
        // Replacing must never destroy someone's work outright: put the note that
        // was there into the trash first, and remember it so Undo can restore it.
        try {
          const displaced = await ops.readText(destPath)
          if (await trashWithRetries(ops, destPath)) {
            undo.replaced = { path: destPath, text: displaced }
            trashed.push(destPath)
          }
        } catch {
          /* unreadable: fall through and overwrite */
        }
      }
      await ops.writeAtomic(destPath, plan.content)
      undo.written = { path: destPath, text: plan.content }
    }
  } catch {
    return { ok: false, trashed, failure: friendlyWriteError(plan.raw.name), originalKept: true, notice: '', undo }
  }

  // 2. only once the new copy is safely written, retire the old location
  let originalKept = false
  let notice = ''
  if (plan.currentPath !== undefined && !inPlace) {
    try {
      const text = await ops.readText(plan.currentPath)
      if (await trashWithRetries(ops, plan.currentPath)) {
        trashed.push(plan.currentPath)
        undo.movedFrom = { path: plan.currentPath, text }
      } else {
        originalKept = true
        notice = 'The note was filed, but the old copy is still where it was because another program is using it.'
      }
    } catch {
      /* already gone */
    }
  }

  return { ok: true, writtenPath: destPath, hash: hashText(plan.content), trashed, originalKept, notice, undo }
}

export interface UndoOutcome {
  ok: boolean
  /** Copies left in place because something else had already changed them. */
  keptChanged: string[]
  message: string
}

export async function undoFiling(ops: FileOps, undo: UndoRecord): Promise<UndoOutcome> {
  const keptChanged: string[] = []

  // put the original back, unless something already reappeared at that path
  if (undo.movedFrom) {
    try {
      await ops.createExclusive(undo.movedFrom.path, undo.movedFrom.text)
    } catch {
      /* leave whatever is there */
    }
  }

  // remove the copy this filing wrote, but only if it is untouched
  if (undo.written) {
    try {
      if (await ops.exists(undo.written.path)) {
        const current = await ops.readText(undo.written.path)
        if (hashText(current) !== hashText(undo.written.text)) keptChanged.push(undo.written.path)
        else await trashWithRetries(ops, undo.written.path)
      }
    } catch {
      keptChanged.push(undo.written.path)
    }
  }

  // restore the earlier text of an in-place rewrite, but only if it is untouched
  if (undo.rewritten) {
    try {
      const current = await ops.readText(undo.rewritten.path)
      if (hashText(current) !== hashText(undo.rewritten.after)) keptChanged.push(undo.rewritten.path)
      else await ops.writeAtomic(undo.rewritten.path, undo.rewritten.before)
    } catch {
      keptChanged.push(undo.rewritten.path)
    }
  }

  // bring back anything a replace displaced, once our copy is out of the way
  if (undo.replaced) {
    try {
      if (!(await ops.exists(undo.replaced.path))) {
        await ops.createExclusive(undo.replaced.path, undo.replaced.text)
      }
    } catch {
      /* leave whatever is there */
    }
  }

  return {
    ok: true,
    keptChanged,
    message:
      keptChanged.length === 0
        ? 'Put back.'
        : 'Put back. The filed copy was left alone because it had already changed.'
  }
}
```

- [ ] **Step 4: Run the filing tests**

Run: `npm test -- tests/unit/filing.test.ts`
Expected: PASS

- [ ] **Step 5: Migrate settings on read**

In `src/main/ipc/settings.ts`, change the import line and `readSettings`:

```ts
import { DEFAULT_SETTINGS, type Settings } from '../../shared/types'
import { migrateSettings } from '../../shared/migrate'
```

```ts
export function readSettings(): Settings {
  if (cache) return cache
  try {
    const raw = readFileSync(settingsPath(), 'utf8')
    cache = migrateSettings(JSON.parse(raw))
  } catch {
    cache = { ...DEFAULT_SETTINGS }
  }
  return cache
}
```

- [ ] **Step 6: Create `src/main/ipc/ledger.ts`**

```ts
import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import log from 'electron-log/main'
import type { LedgerEntry } from '../../shared/types'

function ledgerPath(): string {
  return join(app.getPath('userData'), 'ledger.json')
}

/** Every filing the app has done. Missing or unreadable means empty. */
export function readLedger(): LedgerEntry[] {
  try {
    const parsed = JSON.parse(readFileSync(ledgerPath(), 'utf8')) as unknown
    return Array.isArray(parsed) ? (parsed as LedgerEntry[]) : []
  } catch {
    return []
  }
}

/**
 * Appends one entry and returns the whole ledger. A ledger that cannot be written is
 * logged and returned unchanged: the note is safely filed, the count is merely stale.
 */
export function appendLedger(entry: LedgerEntry): LedgerEntry[] {
  const current = readLedger()
  const next = [...current, entry]
  try {
    const target = ledgerPath()
    mkdirSync(dirname(target), { recursive: true })
    const temp = `${target}.tmp`
    writeFileSync(temp, JSON.stringify(next, null, 2), 'utf8')
    renameSync(temp, target)
    return next
  } catch (error) {
    log.error('Could not write the filing ledger', error)
    return current
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc/filing.ts src/main/ipc/settings.ts src/main/ipc/ledger.ts tests/unit/filing.test.ts
git commit -m "File to a single raw folder, keep a ledger, migrate settings on read

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: IPC handlers and preload

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Update imports in `src/main/index.ts`**

Replace lines 5 to 7:

```ts
import { readSettings, writeSettings, saveApiKey, loadApiKey } from './ipc/settings'
import { diskOps, readFileForEditor, writeAtomic, translateFsError } from './ipc/files'
import { preflight, runFiling, undoFiling, type FilingPlan, type UndoRecord } from './ipc/filing'
import { readLedger, appendLedger } from './ipc/ledger'
import { proposeKind } from '../shared/memberKind'
import type { LedgerEntry } from '../shared/types'
```

- [ ] **Step 2: Change the default folder to `raw`**

In the `dialog:create-default-folder` handler replace `'Second Brain', 'Inbox'` with `'Second Brain', 'raw'`.

- [ ] **Step 3: Replace the siblings handler**

Replace the whole `ipcMain.handle('siblings:find', ...)` block with:

```ts
ipcMain.handle('ledger:read', () => ok({ entries: readLedger() }))

ipcMain.handle('ledger:append', (_e, entry: LedgerEntry) => ok({ entries: appendLedger(entry) }))

ipcMain.handle('members:propose-kind', async (_e, path: string) => {
  try {
    return ok({ kind: proposeKind(await fsp.readdir(path)) })
  } catch {
    return ok({ kind: 'artifact' as const })
  }
})

/** Which of these folders are not there right now. An empty path counts as missing. */
ipcMain.handle('members:missing-paths', async (_e, paths: string[]) => {
  const missing: string[] = []
  for (const path of paths) {
    if (path.length === 0) {
      missing.push(path)
      continue
    }
    try {
      if (!(await fsp.stat(path)).isDirectory()) missing.push(path)
    } catch {
      missing.push(path)
    }
  }
  return ok({ missing })
})
```

- [ ] **Step 4: Fix the filing error text and diagnostics**

In `filing:preflight` and `filing:run`, change `translateFsError(error, 'those folders')` to `translateFsError(error, 'that raw folder')`.

In `diagnostics:copy`, replace the two lines computing `folders` and `agents` and the `Folders:` report line with:

```ts
  const agents = settings.members.filter((m) => m.kind === 'agent').length
  const artifacts = settings.members.filter((m) => m.kind === 'artifact').length
```

and the report line:

```ts
    `Agents: ${agents}, Artifacts: ${artifacts}, Bunches: ${settings.bunches.length}`,
```

- [ ] **Step 5: Update `src/preload/index.ts`**

Change the types import to:

```ts
import type { AiProviderStatus, LedgerEntry, LoadedFile, MemberKind, Settings } from '../shared/types'
```

Replace the `filing` object with:

```ts
  filing: {
    preflight: (plan: FilingPlan): Promise<Result<{ result: PreflightOutcome }>> =>
      ipcRenderer.invoke('filing:preflight', plan),
    run: (plan: FilingPlan): Promise<Result<{ outcome: FilingOutcome }>> =>
      ipcRenderer.invoke('filing:run', plan),
    undo: (): Promise<Result<{ result: UndoOutcome }>> => ipcRenderer.invoke('filing:undo')
  },
  ledger: {
    read: (): Promise<Result<{ entries: LedgerEntry[] }>> => ipcRenderer.invoke('ledger:read'),
    append: (entry: LedgerEntry): Promise<Result<{ entries: LedgerEntry[] }>> =>
      ipcRenderer.invoke('ledger:append', entry)
  },
  members: {
    proposeKind: (path: string): Promise<Result<{ kind: MemberKind }>> =>
      ipcRenderer.invoke('members:propose-kind', path),
    missingPaths: (paths: string[]): Promise<Result<{ missing: string[] }>> =>
      ipcRenderer.invoke('members:missing-paths', paths)
  },
```

- [ ] **Step 6: Check the main side compiles**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: no errors. (The web project is still red; that is Task 12.)

- [ ] **Step 7: Commit**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "Expose ledger and member-kind IPC, drop sibling search

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Selection logic for bunch tiles

**Files:**
- Rewrite: `src/renderer/funkybunch/selection.ts`
- Rewrite: `tests/unit/selection.test.ts`

- [ ] **Step 1: Rewrite `tests/unit/selection.test.ts`**

```ts
import { describe, expect, test } from 'vitest'
import { planFiling, type SelectionInput } from '@renderer/funkybunch/selection'
import type { Bunch, Member } from '@shared/types'

const members: Member[] = [
  { id: 'a1', kind: 'agent', name: 'librarian', emoji: '📚', path: '/agents/librarian' },
  { id: 'x1', kind: 'artifact', name: 'thesis', emoji: '📕', path: '/artifacts/thesis' }
]

const study: Bunch = { id: 'b1', name: 'study', emoji: '👥', rawPath: '/sb/raw', agentIds: ['a1'], artifactIds: ['x1'] }
const empty: Bunch = { id: 'b2', name: 'lonely', emoji: '🫥', rawPath: '/sb/raw', agentIds: ['ghost'], artifactIds: [] }
const noRaw: Bunch = { id: 'b3', name: 'later', emoji: '⏳', rawPath: '', agentIds: ['a1'], artifactIds: [] }

function input(over: Partial<SelectionInput> = {}): SelectionInput {
  return { bunches: [study, empty, noRaw], members, selectedId: null, missingRawPaths: [], ...over }
}

const tile = (id: string, over: Partial<SelectionInput> = {}) => planFiling(input(over)).tiles.find((t) => t.id === id)!

describe('planFiling with nothing selected', () => {
  test('cannot file and shows one tile per bunch', () => {
    const plan = planFiling(input())
    expect(plan.bunch).toBeNull()
    expect(plan.canFile).toBe(false)
    expect(plan.fileLabel).toBe('File')
    expect(plan.tiles.map((t) => t.id)).toEqual(['b1', 'b2', 'b3'])
    expect(plan.tiles.every((t) => !t.picked)).toBe(true)
  })

  test('counts only members that really exist', () => {
    expect(tile('b1').memberCount).toBe(2)
    expect(tile('b2').memberCount).toBe(0)
    expect(tile('b2').empty).toBe(true)
  })

  test('dots the bunch the note was last filed to', () => {
    expect(tile('b1', { lastBunchId: 'b1' }).dotted).toBe(true)
    expect(tile('b2', { lastBunchId: 'b1' }).dotted).toBe(false)
  })
})

describe('planFiling with a bunch selected', () => {
  test('a healthy bunch can be filed to', () => {
    const plan = planFiling(input({ selectedId: 'b1' }))
    expect(plan.bunch?.id).toBe('b1')
    expect(plan.canFile).toBe(true)
    expect(plan.fileLabel).toBe('File to study')
    expect(plan.blockedReason).toBe('')
    expect(tile('b1', { selectedId: 'b1' }).picked).toBe(true)
  })

  test('a bunch with no members is blocked', () => {
    const plan = planFiling(input({ selectedId: 'b2' }))
    expect(plan.canFile).toBe(false)
    expect(plan.blockedReason).toContain('lonely')
    expect(plan.blockedReason).toContain('Add an agent or an artifact')
  })

  test('a bunch whose raw folder is missing is blocked and flagged', () => {
    const plan = planFiling(input({ selectedId: 'b1', missingRawPaths: ['/sb/raw/'] }))
    expect(plan.canFile).toBe(false)
    expect(plan.blockedReason).toContain('cannot be reached')
    expect(plan.tiles.find((t) => t.id === 'b1')?.unavailable).toBe(true)
  })

  test('a bunch with no raw folder yet is not blocked, the app asks at filing time', () => {
    const plan = planFiling(input({ selectedId: 'b3', missingRawPaths: [''] }))
    expect(plan.canFile).toBe(true)
    expect(plan.tiles.find((t) => t.id === 'b3')?.unavailable).toBe(false)
  })

  test('an unknown selection behaves like no selection', () => {
    expect(planFiling(input({ selectedId: 'nope' })).bunch).toBeNull()
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npm test -- tests/unit/selection.test.ts`
Expected: FAIL (old API).

- [ ] **Step 3: Rewrite `src/renderer/funkybunch/selection.ts`**

```ts
import type { Bunch, Member } from '@shared/types'
import { membersOf } from '@shared/bunch'
import { samePath } from '@shared/paths'

export interface SelectionInput {
  bunches: Bunch[]
  members: Member[]
  /** The tile the student clicked, if any. */
  selectedId: string | null
  /** The bunch this note was last filed to, from the ledger. */
  lastBunchId?: string
  /** Raw folders that cannot be reached right now. */
  missingRawPaths: string[]
}

export interface Tile {
  id: string
  name: string
  emoji: string
  /** Selected for the next filing. */
  picked: boolean
  /** This note was last filed to this bunch. */
  dotted: boolean
  /** The raw folder is set but missing. */
  unavailable: boolean
  /** No agents and no artifacts resolve. */
  empty: boolean
  memberCount: number
}

export interface Plan {
  tiles: Tile[]
  bunch: Bunch | null
  canFile: boolean
  fileLabel: string
  blockedReason: string
}

export function planFiling(input: SelectionInput): Plan {
  const tiles: Tile[] = input.bunches.map((b) => {
    const { agents, artifacts } = membersOf(b, input.members)
    const memberCount = agents.length + artifacts.length
    return {
      id: b.id,
      name: b.name,
      emoji: b.emoji,
      picked: b.id === input.selectedId,
      dotted: b.id === input.lastBunchId,
      unavailable: b.rawPath.length > 0 && input.missingRawPaths.some((p) => samePath(p, b.rawPath)),
      empty: memberCount === 0,
      memberCount
    }
  })

  const bunch = input.bunches.find((b) => b.id === input.selectedId) ?? null
  if (!bunch) return { tiles, bunch: null, canFile: false, fileLabel: 'File', blockedReason: '' }

  const tile = tiles.find((t) => t.id === bunch.id) as Tile
  let blockedReason = ''
  if (tile.empty) blockedReason = `Add an agent or an artifact to ${bunch.name} first.`
  else if (tile.unavailable) blockedReason = `${bunch.name}'s raw folder cannot be reached right now.`

  return {
    tiles,
    bunch,
    canFile: blockedReason.length === 0,
    fileLabel: `File to ${bunch.name}`,
    blockedReason
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- tests/unit/selection.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/funkybunch/selection.ts tests/unit/selection.test.ts
git commit -m "Plan filing around one selected bunch

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: The strip

**Files:**
- Rewrite: `src/renderer/funkybunch/Strip.tsx`
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: Rewrite `src/renderer/funkybunch/Strip.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import type { Plan, Tile } from './selection'

interface Props {
  plan: Plan
  onSelect: (id: string) => void
  onAddBunch: () => void
  onEditBunch: (id: string) => void
  onOpenBoard: () => void
  onSettings: () => void
  onDropNote: (id: string) => void
  showCoachmark: boolean
  onDismissCoachmark: () => void
}

function tileClass(tile: Tile): string {
  const parts = ['tile']
  if (tile.picked) parts.push('tile-picked')
  if (tile.unavailable) parts.push('tile-unavailable')
  if (tile.empty) parts.push('tile-empty')
  return parts.join(' ')
}

function tileTitle(tile: Tile): string {
  const bits = [`${tile.name} - ${tile.memberCount} member${tile.memberCount === 1 ? '' : 's'}`]
  if (tile.dotted) bits.push('this note was last filed here')
  if (tile.empty) bits.push('add an agent or an artifact first')
  if (tile.unavailable) bits.push('raw folder cannot be reached')
  return bits.join(' - ')
}

function BunchTile({
  tile,
  onSelect,
  onEdit,
  onDropNote
}: {
  tile: Tile
  onSelect: (id: string) => void
  onEdit: (id: string) => void
  onDropNote: (id: string) => void
}) {
  return (
    <button
      className={tileClass(tile)}
      title={tileTitle(tile)}
      aria-label={`${tile.name} bunch`}
      aria-pressed={tile.picked}
      onClick={() => onSelect(tile.id)}
      onContextMenu={(event) => {
        event.preventDefault()
        onEdit(tile.id)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        event.currentTarget.classList.add('tile-drop')
      }}
      onDragLeave={(event) => event.currentTarget.classList.remove('tile-drop')}
      onDrop={(event) => {
        event.preventDefault()
        event.currentTarget.classList.remove('tile-drop')
        onDropNote(tile.id)
      }}
    >
      <span className="tile-emoji" aria-hidden="true">
        {tile.emoji}
      </span>
      {tile.dotted && <span className="tile-dot" aria-hidden="true" />}
      {tile.unavailable && (
        <span className="tile-warn" aria-hidden="true">
          !
        </span>
      )}
    </button>
  )
}

export function Strip({
  plan,
  onSelect,
  onAddBunch,
  onEditBunch,
  onOpenBoard,
  onSettings,
  onDropNote,
  showCoachmark,
  onDismissCoachmark
}: Props) {
  // The strip scrolls, which would clip an absolutely positioned bubble, so the
  // coachmark is positioned against the viewport instead and follows the + button.
  const addWrap = useRef<HTMLDivElement>(null)
  const [coachTop, setCoachTop] = useState(96)

  useEffect(() => {
    if (!showCoachmark) return
    const place = () => {
      const rect = addWrap.current?.getBoundingClientRect()
      if (rect) setCoachTop(Math.max(52, Math.min(rect.top - 6, window.innerHeight - 190)))
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [showCoachmark, plan.tiles.length])

  return (
    <nav className="strip" aria-label="Funky Bunch">
      <div className="strip-section">
        <span className="strip-glyph" title="Bunches - who this note is for">
          👥
        </span>
        {plan.tiles.map((tile) => (
          <BunchTile key={tile.id} tile={tile} onSelect={onSelect} onEdit={onEditBunch} onDropNote={onDropNote} />
        ))}
        <div className="tile-wrap" ref={addWrap}>
          <button className="tile tile-add" onClick={onAddBunch} title="Make a bunch" aria-label="Make a bunch">
            +
          </button>
        </div>
      </div>

      <div className="strip-divider" />

      <button
        className="tile strip-board"
        onClick={onOpenBoard}
        title="Team board - your agents and artifacts"
        aria-label="Team board"
      >
        ⊞
      </button>

      <div className="strip-spacer" />
      <button className="strip-gear" onClick={onSettings} title="Settings" aria-label="Settings">
        ⚙
      </button>

      {showCoachmark && (
        <div className="coachmark" style={{ top: coachTop }}>
          <p>
            Your <strong>Funky Bunch</strong> lives here. Add an agent, add an artifact, then make a bunch.
          </p>
          <button className="btn btn-primary" onClick={onOpenBoard}>
            Open the team board
          </button>
          <button className="btn btn-quiet" onClick={onDismissCoachmark}>
            Later
          </button>
        </div>
      )}
    </nav>
  )
}
```

- [ ] **Step 2: Add strip and board styles**

In `src/renderer/styles.css`, directly after the `.tile-add:hover` rule, add:

```css
.tile-empty { opacity: 0.55; }
.strip-board { font-size: 17px; color: var(--muted); }
.strip-board:hover { color: var(--accent); }

/* ---------------- team board ---------------- */

.board-scroll { overflow-x: auto; padding-bottom: 4px; }
.board { border-collapse: separate; border-spacing: 4px; }
.board th, .board td { text-align: center; font-size: 12.5px; padding: 4px 6px; border-radius: 6px; font-weight: 500; }
.board-corner { width: 90px; }
.board-agent { background: var(--accent-soft); min-width: 64px; cursor: context-menu; }
.board-artifact { text-align: left; white-space: nowrap; cursor: context-menu; }
.board-name { display: block; font-size: 11px; color: var(--muted); max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.board-artifact .board-name { display: inline; margin-left: 4px; max-width: none; }
.board-cell {
  width: 100%; min-width: 48px; height: 30px;
  border: 1px solid var(--line); border-radius: 6px;
  color: var(--muted); font-variant-numeric: tabular-nums;
}
.board-cell:hover { border-color: var(--accent); color: var(--text); }
.board-cell-hot { color: var(--text); font-weight: 600; background: var(--accent-soft); }
.board-cell-bunch { border-color: color-mix(in srgb, var(--accent) 55%, transparent); }
.board-warn { color: var(--danger); font-weight: 700; margin-left: 3px; }
.board-empty { padding: 18px 8px; text-align: center; color: var(--muted); }
.board-empty p { margin: 0 0 12px; }
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/funkybunch/Strip.tsx src/renderer/styles.css
git commit -m "Strip shows bunch tiles and a team board button

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Member and bunch dialogs

**Files:**
- Create: `src/renderer/funkybunch/MemberDialog.tsx`
- Create: `src/renderer/funkybunch/BunchDialog.tsx`
- Delete: `src/renderer/funkybunch/MemberDialogs.tsx`

- [ ] **Step 1: Create `src/renderer/funkybunch/MemberDialog.tsx`**

```tsx
import { useState } from 'react'
import { Modal, Field } from '@renderer/ui/Modal'
import type { Member, MemberKind } from '@shared/types'
import { baseName, samePath } from '@shared/paths'

export const AGENT_EMOJI = ['🤖', '🎓', '🔬', '✍️', '📚', '🧑‍🏫', '✅', '🔍', '🧮', '🗣️']
export const ARTIFACT_EMOJI = ['📁', '📕', '🚀', '🎸', '🗄️', '💡', '📓', '🧠', '🗂️', '⭐']

export function EmojiPicker({
  options,
  value,
  onChange
}: {
  options: string[]
  value: string
  onChange: (emoji: string) => void
}) {
  return (
    <div className="emoji-picker">
      {options.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className={emoji === value ? 'emoji-option emoji-on' : 'emoji-option'}
          onClick={() => onChange(emoji)}
          aria-label={`Use ${emoji}`}
        >
          {emoji}
        </button>
      ))}
    </div>
  )
}

function defaultEmoji(kind: MemberKind): string {
  return kind === 'agent' ? AGENT_EMOJI[0] : ARTIFACT_EMOJI[0]
}

export function MemberDialog({
  existing,
  presetKind,
  siblings,
  onSave,
  onDelete,
  onClose
}: {
  existing?: Member
  /** The kind the student asked for, from an "Add an agent" or "Add an artifact" button. */
  presetKind?: MemberKind
  /** Everyone already in the roster, so we can spot a duplicate folder. */
  siblings: Member[]
  onSave: (member: Member) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const [kind, setKind] = useState<MemberKind>(existing?.kind ?? presetKind ?? 'artifact')
  const [name, setName] = useState(existing?.name ?? '')
  const [emoji, setEmoji] = useState(existing?.emoji ?? defaultEmoji(existing?.kind ?? presetKind ?? 'artifact'))
  const [path, setPath] = useState(existing?.path ?? '')
  const [error, setError] = useState('')

  const switchKind = (next: MemberKind) => {
    setKind(next)
    setEmoji((current) => {
      const list = next === 'agent' ? AGENT_EMOJI : ARTIFACT_EMOJI
      return list.includes(current) ? current : defaultEmoji(next)
    })
  }

  const pick = async () => {
    const result = await window.marki.dialogs.pickFolder()
    if (!result.ok) return
    setPath(result.path)
    setError('')
    if (!name) setName(baseName(result.path) || 'Folder')
    // Only guess when the student has not already said what this is.
    if (!existing && presetKind === undefined) {
      const proposed = await window.marki.members.proposeKind(result.path)
      if (proposed.ok) switchKind(proposed.kind)
    }
  }

  const save = () => {
    if (!path) {
      setError('Choose a folder first.')
      return
    }
    const clash = siblings.find((m) => m.id !== existing?.id && m.path.length > 0 && samePath(m.path, path))
    if (clash) {
      setError(`${clash.name} already points at that folder.`)
      return
    }
    onSave({
      id: existing?.id ?? `${kind === 'agent' ? 'a' : 'x'}${Date.now().toString(36)}`,
      kind,
      name: name.trim() || (kind === 'agent' ? 'agent' : 'Folder'),
      emoji,
      path
    })
  }

  const title = existing ? `Edit ${kind}` : kind === 'agent' ? 'Add an agent' : 'Add an artifact'

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          {onDelete && (
            <button className="btn btn-danger" onClick={onDelete}>
              Remove
            </button>
          )}
          <span className="spacer" />
          <button className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <p className="dialog-lead">
        An <strong>agent</strong> is a folder that does work: it holds skills and instructions. An{' '}
        <strong>artifact</strong> is a folder that holds what the work produces.
      </p>
      <Field label="Folder">
        <div className="row">
          <input readOnly value={path} placeholder="No folder chosen yet" />
          <button className="btn btn-quiet" onClick={pick}>
            Choose...
          </button>
        </div>
      </Field>
      <Field label="This folder is">
        <div className="segmented" role="group" aria-label="Kind">
          <button
            type="button"
            className={kind === 'agent' ? 'seg seg-on' : 'seg'}
            aria-pressed={kind === 'agent'}
            onClick={() => switchKind('agent')}
          >
            An agent
          </button>
          <button
            type="button"
            className={kind === 'artifact' ? 'seg seg-on' : 'seg'}
            aria-pressed={kind === 'artifact'}
            onClick={() => switchKind('artifact')}
          >
            An artifact
          </button>
        </div>
      </Field>
      <Field label="Name" hint={kind === 'agent' ? 'Lower case, no spaces, like study-coach.' : undefined}>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={kind === 'agent' ? 'study-coach' : 'thesis'}
        />
      </Field>
      <Field label="Icon">
        <EmojiPicker options={kind === 'agent' ? AGENT_EMOJI : ARTIFACT_EMOJI} value={emoji} onChange={setEmoji} />
      </Field>
      {error && <p className="error">{error}</p>}
    </Modal>
  )
}
```

- [ ] **Step 2: Create `src/renderer/funkybunch/BunchDialog.tsx`**

```tsx
import { useState } from 'react'
import { Modal, Field } from '@renderer/ui/Modal'
import type { Bunch, Member } from '@shared/types'
import { EmojiPicker } from './MemberDialog'

const BUNCH_EMOJI = ['👥', '🎓', '🚀', '🎸', '🧪', '📝', '🎯', '🌱', '🔥', '⭐']

export function BunchDialog({
  existing,
  preset,
  members,
  defaultRawPath,
  onSave,
  onDelete,
  onClose
}: {
  existing?: Bunch
  /** Members to tick when starting a bunch from a team board cell. */
  preset?: { agentIds: string[]; artifactIds: string[] }
  members: Member[]
  defaultRawPath?: string
  onSave: (bunch: Bunch) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(existing?.name ?? '')
  const [emoji, setEmoji] = useState(existing?.emoji ?? BUNCH_EMOJI[0])
  const [rawPath, setRawPath] = useState(existing?.rawPath || defaultRawPath || '')
  const [agentIds, setAgentIds] = useState<string[]>(existing?.agentIds ?? preset?.agentIds ?? [])
  const [artifactIds, setArtifactIds] = useState<string[]>(existing?.artifactIds ?? preset?.artifactIds ?? [])
  const [error, setError] = useState('')

  const agents = members.filter((m) => m.kind === 'agent')
  const artifacts = members.filter((m) => m.kind === 'artifact')
  const pickedAgents = agentIds.filter((id) => agents.some((a) => a.id === id))
  const pickedArtifacts = artifactIds.filter((id) => artifacts.some((a) => a.id === id))
  const valid = name.trim().length > 0 && rawPath.length > 0 && pickedAgents.length + pickedArtifacts.length > 0

  const flip = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  const pick = async () => {
    const result = await window.marki.dialogs.pickFolder()
    if (result.ok) setRawPath(result.path)
  }

  const createDefault = async () => {
    const result = await window.marki.dialogs.createDefaultFolder()
    if (result.ok) setRawPath(result.path)
    else setError(result.message)
  }

  const save = () => {
    if (!valid) return
    onSave({
      id: existing?.id ?? `b${Date.now().toString(36)}`,
      name: name.trim(),
      emoji,
      rawPath,
      agentIds: pickedAgents,
      artifactIds: pickedArtifacts
    })
  }

  return (
    <Modal
      title={existing ? 'Edit bunch' : 'Make a bunch'}
      onClose={onClose}
      footer={
        <>
          {onDelete && (
            <button className="btn btn-danger" onClick={onDelete}>
              Remove
            </button>
          )}
          <span className="spacer" />
          <button className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!valid}>
            Save
          </button>
        </>
      }
    >
      <p className="dialog-lead">
        A bunch is a group of agents and artifacts, like a group chat. Filing a note to a bunch drops it in the
        raw folder, stamped with everyone in the group.
      </p>
      <Field label="Name">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="thesis" />
      </Field>
      <Field label="Icon">
        <EmojiPicker options={BUNCH_EMOJI} value={emoji} onChange={setEmoji} />
      </Field>
      {!rawPath && (
        <button className="btn btn-primary btn-block" onClick={createDefault}>
          Create Documents / Second Brain / raw for me
        </button>
      )}
      <Field label="Raw folder" hint="Your second brain's inbox. Every note filed to this bunch lands here.">
        <div className="row">
          <input readOnly value={rawPath} placeholder="No folder chosen yet" />
          <button className="btn btn-quiet" onClick={pick}>
            Choose...
          </button>
        </div>
      </Field>
      <Field label="Agents">
        <div className="folder-checks">
          {agents.length === 0 && <p className="muted">No agents yet. Add one from the team board.</p>}
          {agents.map((agent) => (
            <label key={agent.id} className="check">
              <input
                type="checkbox"
                checked={agentIds.includes(agent.id)}
                onChange={() => setAgentIds((current) => flip(current, agent.id))}
              />
              <span>
                {agent.emoji} {agent.name}
              </span>
            </label>
          ))}
        </div>
      </Field>
      <Field label="Artifacts">
        <div className="folder-checks">
          {artifacts.length === 0 && <p className="muted">No artifacts yet. Add one from the team board.</p>}
          {artifacts.map((artifact) => (
            <label key={artifact.id} className="check">
              <input
                type="checkbox"
                checked={artifactIds.includes(artifact.id)}
                onChange={() => setArtifactIds((current) => flip(current, artifact.id))}
              />
              <span>
                {artifact.emoji} {artifact.name}
              </span>
            </label>
          ))}
        </div>
      </Field>
      {error && <p className="error">{error}</p>}
    </Modal>
  )
}
```

- [ ] **Step 3: Delete the old file**

```bash
git rm src/renderer/funkybunch/MemberDialogs.tsx
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/funkybunch/MemberDialog.tsx src/renderer/funkybunch/BunchDialog.tsx
git commit -m "Add member and bunch dialogs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: The team board and Settings

**Files:**
- Create: `src/renderer/funkybunch/TeamBoard.tsx`
- Modify: `src/renderer/ui/SettingsDialog.tsx`

- [ ] **Step 1: Create `src/renderer/funkybunch/TeamBoard.tsx`**

```tsx
import { useMemo } from 'react'
import { Modal } from '@renderer/ui/Modal'
import type { Bunch, LedgerEntry, Member, MemberKind } from '@shared/types'
import { pairCounts, pairKey } from '@shared/ledger'

interface Props {
  members: Member[]
  bunches: Bunch[]
  ledger: LedgerEntry[]
  /** Members whose folder is empty or cannot be found. */
  missingMemberIds: string[]
  onAddMember: (kind: MemberKind) => void
  onEditMember: (id: string) => void
  onCell: (agentId: string, artifactId: string) => void
  onClose: () => void
}

export function TeamBoard({ members, bunches, ledger, missingMemberIds, onAddMember, onEditMember, onCell, onClose }: Props) {
  const agents = members.filter((m) => m.kind === 'agent')
  const artifacts = members.filter((m) => m.kind === 'artifact')
  const counts = useMemo(() => pairCounts(ledger), [ledger])

  const inABunch = (agentId: string, artifactId: string) =>
    bunches.some((b) => b.agentIds.includes(agentId) && b.artifactIds.includes(artifactId))

  const warn = (id: string) =>
    missingMemberIds.includes(id) ? (
      <span className="board-warn" title="This folder cannot be found. Right-click to fix it.">
        !
      </span>
    ) : null

  return (
    <Modal
      title="Team board"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-quiet" onClick={() => onAddMember('agent')}>
            Add an agent
          </button>
          <button className="btn btn-quiet" onClick={() => onAddMember('artifact')}>
            Add an artifact
          </button>
          <span className="spacer" />
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <p className="dialog-lead">
        <strong>Agents</strong> across the top are folders that do work. <strong>Artifacts</strong> down the side
        are folders that hold what the work produces. A number is how many notes were filed to both. Click a
        square to make or open the bunch that pairs them. Right-click a name to edit it.
      </p>

      {members.length === 0 ? (
        <div className="board-empty">
          <p>Nothing here yet. Start with one folder of each kind.</p>
          <button className="btn btn-primary" onClick={() => onAddMember('agent')}>
            Add an agent
          </button>{' '}
          <button className="btn btn-primary" onClick={() => onAddMember('artifact')}>
            Add an artifact
          </button>
        </div>
      ) : (
        <div className="board-scroll">
          <table className="board" aria-label="Team board">
            <thead>
              <tr>
                <th className="board-corner" aria-hidden="true" />
                {agents.map((agent) => (
                  <th
                    key={agent.id}
                    scope="col"
                    className="board-agent"
                    title={agent.path || 'No folder chosen yet'}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      onEditMember(agent.id)
                    }}
                  >
                    <span aria-hidden="true">{agent.emoji}</span>
                    <span className="board-name">
                      {agent.name}
                      {warn(agent.id)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {artifacts.map((artifact) => (
                <tr key={artifact.id}>
                  <th
                    scope="row"
                    className="board-artifact"
                    title={artifact.path || 'No folder chosen yet'}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      onEditMember(artifact.id)
                    }}
                  >
                    <span aria-hidden="true">{artifact.emoji}</span>
                    <span className="board-name">
                      {artifact.name}
                      {warn(artifact.id)}
                    </span>
                  </th>
                  {agents.map((agent) => {
                    const n = counts.get(pairKey(agent.id, artifact.id)) ?? 0
                    const classes = ['board-cell']
                    if (n > 0) classes.push('board-cell-hot')
                    if (inABunch(agent.id, artifact.id)) classes.push('board-cell-bunch')
                    return (
                      <td key={agent.id}>
                        <button
                          className={classes.join(' ')}
                          aria-label={`${agent.name} and ${artifact.name}: ${n} note${n === 1 ? '' : 's'}`}
                          onClick={() => onCell(agent.id, artifact.id)}
                        >
                          {n > 0 ? n : '·'}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {agents.length === 0 && <p className="muted">Add an agent to fill in the columns.</p>}
          {artifacts.length === 0 && <p className="muted">Add an artifact to fill in the rows.</p>}
        </div>
      )}
    </Modal>
  )
}
```

- [ ] **Step 2: Update `src/renderer/ui/SettingsDialog.tsx`**

Replace the `Notes` section (the `<h3 className="section-head">Notes</h3>` heading and its checkbox label) with:

```tsx
      <h3 className="section-head">Filing</h3>
      <Field label="Default raw folder" hint="Pre-fills the raw folder when you make a bunch.">
        <div className="row">
          <input readOnly value={settings.defaultRawPath ?? ''} placeholder="No default yet" />
          <button
            className="btn btn-quiet"
            onClick={async () => {
              const result = await window.marki.dialogs.pickFolder()
              if (result.ok) void onSave({ defaultRawPath: result.path })
            }}
          >
            Choose...
          </button>
          {settings.defaultRawPath && (
            <button className="btn btn-quiet" onClick={() => void onSave({ defaultRawPath: '' })}>
              Clear
            </button>
          )}
        </div>
      </Field>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.mirrorMembersAsTags}
          onChange={(event) => void onSave({ mirrorMembersAsTags: event.target.checked })}
        />
        <span>Also add each agent and artifact as a tag, like agent/study-coach (handy in Obsidian)</span>
      </label>
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/funkybunch/TeamBoard.tsx src/renderer/ui/SettingsDialog.tsx
git commit -m "Add the team board and a default raw folder setting

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Rewire `App.tsx`

Typecheck goes green at the end of this task.

**Files:**
- Rewrite: `src/renderer/App.tsx`

- [ ] **Step 1: Replace `src/renderer/App.tsx` with the following**

Everything from `/* ---------------- opening files ---------------- */` through `cleanWithAi` and from `suggestTitle` to the end is unchanged from the current file; it is repeated here so the file can be written in one go.

```tsx
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ulid } from 'ulid'
import { DocumentStore } from './state/document'
import { CodePane, type CodeCommands } from './editors/CodePane'
import { RenderedPane, type RenderedCommands } from './editors/RenderedPane'
import { SyncController } from './editors/sync'
import { PropertiesPanel } from './frontmatter/PropertiesPanel'
import { Strip } from './funkybunch/Strip'
import { MemberDialog } from './funkybunch/MemberDialog'
import { BunchDialog } from './funkybunch/BunchDialog'
import { TeamBoard } from './funkybunch/TeamBoard'
import { SettingsDialog } from './ui/SettingsDialog'
import { HelpDialog } from './ui/HelpDialog'
import { PromptDialog } from './ui/PromptDialog'
import { TopBar, type ViewMode } from './ui/TopBar'
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
import type { Bunch, LedgerEntry, Member, MemberKind, Settings } from '@shared/types'

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

type DialogState =
  | { kind: 'member'; existing?: Member; presetKind?: MemberKind; from?: 'board' }
  | { kind: 'bunch'; existing?: Bunch; preset?: { agentIds: string[]; artifactIds: string[] }; from?: 'board' }
  | { kind: 'board' }
  | { kind: 'settings' }
  | { kind: 'help' }
  | null

export default function App() {
  const doc = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [selectedBunchId, setSelectedBunchId] = useState<string | null>(null)
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [view, setView] = useState<ViewMode>('split')
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
  const [fileWhenReady, setFileWhenReady] = useState(false)
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

  const saveSettings = useCallback(async (patch: Partial<Settings>) => {
    const result = await window.marki.settings.write(patch)
    if (result.ok) setSettings(result.settings)
    return result
  }, [])

  const members = settings?.members ?? []
  const bunches = settings?.bunches ?? []

  /* ---------------- note identity ---------------- */

  const frontMatter = useMemo(() => {
    if (doc.frontMatterRaw === null) return { ok: true as const, data: {} as Record<string, unknown> }
    return parseFrontMatter(doc.frontMatterRaw)
  }, [doc.frontMatterRaw])

  const noteId = frontMatter.ok && typeof frontMatter.data.id === 'string' ? frontMatter.data.id : ''

  const lastBunchId = useMemo(() => lastBunchFor(ledger, noteId), [ledger, noteId])

  const plan = useMemo(
    () => planFiling({ bunches, members, selectedId: selectedBunchId, lastBunchId, missingRawPaths: missingRaw }),
    [bunches, members, selectedBunchId, lastBunchId, missingRaw]
  )

  const selectBunch = useCallback((id: string) => {
    setSelectedBunchId((current) => (current === id ? null : id))
  }, [])

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

  const memberKey = members.map((m) => m.path).join('|')
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
      setSelectedBunchId(null)
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
    // agents. Say so instead of filing something wrong.
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
      await saveSettings({ bunches: bunches.map((b) => (b.id === bunch.id ? { ...b, rawPath } : b)) })
    }

    let fileName = doc.fileName
    if (doc.paths.length === 0 || doc.isPlainText) fileName = suggestName(doc.body, fileName)

    const id = noteId || ulid()
    const created =
      frontMatter.ok && typeof frontMatter.data.created === 'string' ? frontMatter.data.created : nowLocalIso()

    const who = buildStamp(bunch, members, settings.mirrorMembersAsTags)
    const content = stampNote(store.fullText(), {
      id,
      // the plain preset keeps front matter minimal; OKF wants a type on every concept
      type: settings.frontMatterPreset === 'basic' ? undefined : 'note',
      filed: nowLocalIso(),
      created,
      tags: who.tags,
      bunch: who.bunch,
      agents: who.agents,
      agentPaths: who.agentPaths,
      artifacts: who.artifacts,
      artifactPaths: who.artifactPaths
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
    setSelectedBunchId(null)

    const entry: LedgerEntry = {
      noteId: id,
      bunchId: bunch.id,
      agentIds: who.agentIds,
      artifactIds: who.artifactIds,
      filedAt: nowLocalIso()
    }
    const appended = await window.marki.ledger.append(entry)
    if (appended.ok) setLedger(appended.entries)

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
          pushToast({ text: undone.result.message })
          if (cameFrom) void openFile(cameFrom)
        } else {
          pushToast({ text: undone.message, tone: 'warn' })
        }
      }
    })
  }, [plan, doc, members, bunches, noteId, frontMatter, settings, pushToast, openFile, saveSettings])

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

  /* ---------------- roster and bunch editing ---------------- */

  // A dialog opened from the team board goes back to the board when it closes.
  const closeDialog = useCallback(() => {
    setDialog((current) =>
      current && (current.kind === 'member' || current.kind === 'bunch') && current.from === 'board'
        ? { kind: 'board' }
        : null
    )
  }, [])

  const upsertMember = useCallback(
    async (member: Member) => {
      const next = members.some((m) => m.id === member.id)
        ? members.map((m) => (m.id === member.id ? member : m))
        : [...members, member]
      await saveSettings({ members: next, seenCoachmark: true })
      closeDialog()
    },
    [members, saveSettings, closeDialog]
  )

  const removeMember = useCallback(
    async (id: string) => {
      await saveSettings({
        members: members.filter((m) => m.id !== id),
        bunches: bunches.map((b) => ({
          ...b,
          agentIds: b.agentIds.filter((x) => x !== id),
          artifactIds: b.artifactIds.filter((x) => x !== id)
        }))
      })
      closeDialog()
    },
    [members, bunches, saveSettings, closeDialog]
  )

  const upsertBunch = useCallback(
    async (bunch: Bunch) => {
      const next = bunches.some((b) => b.id === bunch.id)
        ? bunches.map((b) => (b.id === bunch.id ? bunch : b))
        : [...bunches, bunch]
      await saveSettings({ bunches: next, seenCoachmark: true })
      closeDialog()
    },
    [bunches, saveSettings, closeDialog]
  )

  const removeBunch = useCallback(
    async (id: string) => {
      await saveSettings({ bunches: bunches.filter((b) => b.id !== id) })
      setSelectedBunchId((current) => (current === id ? null : current))
      closeDialog()
    },
    [bunches, saveSettings, closeDialog]
  )

  const editBunch = useCallback(
    (id: string) => {
      const bunch = bunches.find((b) => b.id === id)
      if (bunch) setDialog({ kind: 'bunch', existing: bunch })
    },
    [bunches]
  )

  const editMemberFromBoard = useCallback(
    (id: string) => {
      const member = members.find((m) => m.id === id)
      if (member) setDialog({ kind: 'member', existing: member, from: 'board' })
    },
    [members]
  )

  const openCell = useCallback(
    (agentId: string, artifactId: string) => {
      const matches = bunches.filter((b) => b.agentIds.includes(agentId) && b.artifactIds.includes(artifactId))
      if (matches.length === 1) setDialog({ kind: 'bunch', existing: matches[0], from: 'board' })
      else setDialog({ kind: 'bunch', preset: { agentIds: [agentId], artifactIds: [artifactId] }, from: 'board' })
    },
    [bunches]
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
          selectBunch(tile.id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [plan.tiles, selectBunch])

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

  const showCoachmark = !settings.seenCoachmark && members.length === 0 && bunches.length === 0

  return (
    <div className="app">
      <Strip
        plan={plan}
        onSelect={selectBunch}
        onAddBunch={() => setDialog({ kind: 'bunch' })}
        onEditBunch={editBunch}
        onOpenBoard={() => setDialog({ kind: 'board' })}
        onSettings={() => setDialog({ kind: 'settings' })}
        onDropNote={(id) => {
          setSelectedBunchId(id)
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
          hasPending={plan.bunch !== null}
          view={view}
          busy={busy}
          onSetView={setView}
          onFile={() => void runFiling()}
          onClearSelection={() => setSelectedBunchId(null)}
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

      {dialog?.kind === 'board' && (
        <TeamBoard
          members={members}
          bunches={bunches}
          ledger={ledger}
          missingMemberIds={missingMemberIds}
          onAddMember={(kind) => setDialog({ kind: 'member', presetKind: kind, from: 'board' })}
          onEditMember={editMemberFromBoard}
          onCell={openCell}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'member' && (
        <MemberDialog
          existing={dialog.existing}
          presetKind={dialog.presetKind}
          siblings={members}
          onSave={upsertMember}
          onDelete={dialog.existing ? () => void removeMember(dialog.existing!.id) : undefined}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'bunch' && (
        <BunchDialog
          existing={dialog.existing}
          preset={dialog.preset}
          members={members}
          defaultRawPath={settings.defaultRawPath}
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
```

- [ ] **Step 2: Typecheck and unit tests**

Run: `npm run typecheck`
Expected: no errors. If `noUnusedLocals` complains about anything in App.tsx, remove that import or variable rather than suppressing.

Run: `npm test`
Expected: all unit tests pass.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "Rewire the app around bunches, the ledger and the team board

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Help, welcome note and README

**Files:**
- Modify: `src/renderer/ui/HelpDialog.tsx`, `src/main/welcome.ts`, `README.md`

- [ ] **Step 1: Help dialog**

Replace the three paragraphs under `The Funky Bunch` heading in `src/renderer/ui/HelpDialog.tsx` with:

```tsx
      <p>
        Down the left edge are your <strong>bunches</strong>. A bunch is a group of{' '}
        <strong>agents</strong> (folders that do work) and <strong>artifacts</strong> (folders that hold what
        the work produces), like a group chat. Click the bunch this note is for, then press File.
      </p>
      <p>
        Filing writes the note once, into that bunch&apos;s <strong>raw</strong> folder, with the agents and
        artifacts written into the note&apos;s properties so your second brain knows who it is for.
      </p>
      <p className="muted">
        The team board (the grid button on the strip) shows your agents across the top and your artifacts down the
        side, with how many notes have gone to each pair.
      </p>
```

- [ ] **Step 2: Welcome note**

In `src/main/welcome.ts` replace the two task lines and the closing two lines so the array ends:

```ts
  '- [ ] Open the team board on the left edge and add an agent and an artifact',
  '- [ ] Make a bunch, pick it, then press File',
  '',
  '---',
  '',
  'Filing writes one copy into the raw folder of the bunch you chose, stamped with',
  'the agents and artifacts in that bunch. Your second brain takes it from there.',
  ''
```

- [ ] **Step 3: README**

Replace the `## The Funky Bunch` section of `README.md` (up to but not including `## What it does`) with:

```markdown
## The Funky Bunch

The Funky Bunch is the strip down the left side of the window. It is built on one idea: the folders in your
coworking space come in two kinds.

- **Agents** are folders that do work. They hold skills, a `CLAUDE.md`, instructions.
- **Artifacts** are folders that hold what the work produces: a thesis chapter, a startup plan, a band site.

A **bunch** is a group of agents and artifacts, like a group chat on your phone. Each bunch has a **raw**
folder, the inbox of your second brain.

Here is how you use it:

1. Open the team board (the grid button on the strip) and add an agent and an artifact.
2. Make a bunch: give it a name, a raw folder, and tick the agents and artifacts in it.
3. Open or write a note, click the bunch it is for, and press **File**.

When you click File, MarkiMarkdown writes the note **once**, into that bunch's raw folder, and stamps its
front matter with who it is for:

```yaml
bunch: thesis
agents:
  - study-coach
agent_paths:
  - C:/Users/me/agents/study-coach
artifacts:
  - thesis-chapter-3
artifact_paths:
  - C:/Users/me/artifacts/thesis-chapter-3
```

Names and paths line up index for index, so a second-brain script can grep them. The agents and artifacts
are also mirrored as tags (`agent/study-coach`, `artifact/thesis-chapter-3`) for Obsidian users. Your
second brain reads the raw folder and does the routing. MarkiMarkdown never writes into agent or artifact
folders itself.

The team board shows agents across the top and artifacts down the side, with a count in each square of how
many notes have gone to that pair. Click a square to make or open the bunch that pairs them.

```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/ui/HelpDialog.tsx src/main/welcome.ts README.md
git commit -m "Teach agents, artifacts and bunches in help, welcome and README

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: End-to-end tests

**Files:**
- Modify: `tests/e2e/helpers.ts`
- Rewrite: `tests/e2e/filing.spec.ts`
- Modify: `tests/e2e/features.spec.ts`, `tests/e2e/fixes.spec.ts`, `tests/e2e/firstrun.spec.ts`, `tests/e2e/packaged.spec.ts`, `tests/e2e/shot.spec.ts`
- Create: `tests/e2e/board.spec.ts`

- [ ] **Step 1: Update `tests/e2e/helpers.ts`**

Replace the `Dirs` interface, `prepare`, the default settings line inside `launch`, and the two factory functions at the bottom:

```ts
export interface Dirs {
  root: string
  userData: string
  downloads: string
  raw: string
  agent: string
  artifact: string
}
```

```ts
/** Creates a throwaway home for one test run. */
export function prepare(): Dirs {
  const root = mkdtempSync(join(tmpdir(), 'marki-e2e-'))
  const dirs: Dirs = {
    root,
    userData: join(root, 'userData'),
    downloads: join(root, 'downloads'),
    raw: join(root, 'brain', 'raw'),
    agent: join(root, 'agents', 'librarian'),
    artifact: join(root, 'artifacts', 'thesis')
  }
  for (const dir of [dirs.userData, dirs.downloads, dirs.raw, dirs.agent, dirs.artifact]) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(join(dirs.agent, 'CLAUDE.md'), '# librarian\n', 'utf8')
  return dirs
}
```

Inside `launch`, change the settings line to:

```ts
  const settings = { seenCoachmark: true, autosave: true, members: [], bunches: [], ...options.settings }
```

Replace `folder` and `agent` at the bottom with:

```ts
export function agentMember(id: string, name: string, emoji: string, path: string) {
  return { id, kind: 'agent', name, emoji, path }
}

export function artifactMember(id: string, name: string, emoji: string, path: string) {
  return { id, kind: 'artifact', name, emoji, path }
}

export function bunch(id: string, name: string, emoji: string, rawPath: string, agentIds: string[], artifactIds: string[]) {
  return { id, name, emoji, rawPath, agentIds, artifactIds }
}

/** One agent, one artifact, one bunch called study that files into dirs.raw. */
export function team(dirs: Dirs) {
  return {
    members: [
      agentMember('a1', 'librarian', '\u{1F4DA}', dirs.agent),
      artifactMember('x1', 'thesis', '\u{1F4D5}', dirs.artifact)
    ],
    bunches: [bunch('b1', 'study', '\u{1F465}', dirs.raw, ['a1'], ['x1'])]
  }
}
```

- [ ] **Step 2: Rewrite `tests/e2e/filing.spec.ts`**

```ts
import { test, expect } from '@playwright/test'
import { readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs'
import { join, sep } from 'node:path'
import { launch, prepare, team, bunch, type Harness } from './helpers'

let h: Harness

test.afterEach(async () => {
  if (h) await h.close()
})

const NOTE = '# Lecture Notes\n\nSome content about memory.\n'

async function openWith(settings?: Record<string, unknown>) {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'lecture-notes.md')
  writeFileSync(notePath, NOTE, 'utf8')
  const harness = await launch(dirs, { openFile: notePath, settings: settings ?? team(dirs) })
  await expect(harness.page.locator('.pm-content')).toContainText('Lecture Notes')
  return { harness, notePath, dirs }
}

test('filing to a bunch writes one stamped copy into raw and moves the note there', async () => {
  const { harness, notePath, dirs } = await openWith()
  h = harness

  await h.page.getByRole('button', { name: 'study bunch' }).click()
  const fileButton = h.page.getByRole('button', { name: 'File to study' })
  await expect(fileButton).toBeVisible()
  await fileButton.click()
  await expect(h.page.locator('.toast')).toContainText('Filed to study', { timeout: 20000 })

  const filed = join(dirs.raw, 'lecture-notes.md')
  expect(existsSync(filed)).toBe(true)
  expect(existsSync(notePath)).toBe(false)
  expect(readdirSync(dirs.raw)).toEqual(['lecture-notes.md'])

  const text = readFileSync(filed, 'utf8')
  expect(text).toContain('bunch: study')
  expect(text).toContain('agents:\n  - librarian')
  expect(text).toContain('agent_paths:')
  expect(text).toContain(dirs.agent.split(sep).join('/'))
  expect(text).toContain('artifacts:\n  - thesis')
  expect(text).toContain('artifact_paths:')
  expect(text).toContain(dirs.artifact.split(sep).join('/'))
  expect(text).toContain('agent/librarian')
  expect(text).toContain('artifact/thesis')
  expect(text).toContain('type: note')
  expect(text).toMatch(/id:\s*\S+/)
  expect(text).toContain('# Lecture Notes')
  expect(text).toContain('Some content about memory.')

  await expect(h.page.locator('.chip-places')).toHaveText('study')
  expect(h.errors).toEqual([])
})

test('after filing, edits keep going to the same file in raw', async () => {
  const { harness, dirs } = await openWith()
  h = harness

  await h.page.getByRole('button', { name: 'study bunch' }).click()
  await h.page.getByRole('button', { name: 'File to study' }).click()
  await expect(h.page.locator('.toast')).toContainText('Filed to study', { timeout: 20000 })

  await h.page.locator('.cm-content').click()
  await h.page.keyboard.press('Control+End')
  await h.page.keyboard.type('\nA later thought.')
  await h.page.waitForTimeout(3000)

  const filed = join(dirs.raw, 'lecture-notes.md')
  expect(readFileSync(filed, 'utf8')).toContain('A later thought.')
  expect(readFileSync(filed, 'utf8')).toContain('bunch: study')
  expect(readdirSync(dirs.raw)).toEqual(['lecture-notes.md'])
  expect(h.errors).toEqual([])
})

test('a bunch with no raw folder uses the default and remembers it', async () => {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'lecture-notes.md')
  writeFileSync(notePath, NOTE, 'utf8')
  h = await launch(dirs, {
    openFile: notePath,
    settings: {
      ...team(dirs),
      bunches: [bunch('b1', 'study', '\u{1F465}', '', ['a1'], ['x1'])],
      defaultRawPath: dirs.raw
    }
  })
  await expect(h.page.locator('.pm-content')).toContainText('Lecture Notes')

  await h.page.getByRole('button', { name: 'study bunch' }).click()
  await h.page.getByRole('button', { name: 'File to study' }).click()
  await expect(h.page.locator('.toast')).toContainText('Filed to study', { timeout: 20000 })

  expect(existsSync(join(dirs.raw, 'lecture-notes.md'))).toBe(true)
  const saved = JSON.parse(readFileSync(join(dirs.userData, 'settings.json'), 'utf8'))
  expect(saved.bunches[0].rawPath).toBe(dirs.raw)
  expect(h.errors).toEqual([])
})

test('an empty bunch cannot be filed to and says why', async () => {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'lecture-notes.md')
  writeFileSync(notePath, NOTE, 'utf8')
  h = await launch(dirs, {
    openFile: notePath,
    settings: { ...team(dirs), bunches: [bunch('b1', 'lonely', '\u{1FAE5}', dirs.raw, [], [])] }
  })
  await h.page.getByRole('button', { name: 'lonely bunch' }).click()
  await expect(h.page.getByRole('button', { name: 'File to lonely' })).toBeDisabled()
  await expect(h.page.locator('.blocked')).toContainText('Add an agent or an artifact')
  expect(h.errors).toEqual([])
})
```

- [ ] **Step 3: Update `tests/e2e/features.spec.ts`**

- Change the import line to `import { launch, prepare, team, type Harness } from './helpers'`.
- Delete the `twoFolders` function.
- Replace every `settings: { members: twoFolders(dirs) }` with `settings: team(dirs)`.
- Delete these three tests entirely: `editing a note filed in two places updates both copies`, `un-selecting a folder the note lives in removes that copy`, `an agent with no folders only tags the note`.
- Replace the undo test with:

```ts
test('undo after filing puts the original back and removes the filed copy', async () => {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'undo-me.md')
  writeFileSync(notePath, '# Undo Me\n\nOriginal words.\n', 'utf8')
  h = await launch(dirs, { openFile: notePath, settings: team(dirs) })

  await expect(h.page.locator('.pm-content')).toContainText('Undo Me')
  await h.page.getByRole('button', { name: 'study bunch' }).click()
  await h.page.getByRole('button', { name: 'File to study' }).click()
  await expect(h.page.locator('.toast')).toContainText('Filed to study', { timeout: 20000 })
  expect(existsSync(join(dirs.raw, 'undo-me.md'))).toBe(true)
  expect(existsSync(notePath)).toBe(false)

  await h.page.getByRole('button', { name: 'Undo' }).click()
  await expect(h.page.locator('.toast')).toContainText('Put back', { timeout: 20000 })
  expect(existsSync(notePath)).toBe(true)
  expect(readFileSync(notePath, 'utf8')).toContain('Original words.')
  expect(existsSync(join(dirs.raw, 'undo-me.md'))).toBe(false)
  expect(h.errors).toEqual([])
})
```

- Keep `with nothing selected there is no File button` as it is.

- [ ] **Step 4: Update `tests/e2e/fixes.spec.ts`**

- Import line: `import { launch, prepare, team, type Harness } from './helpers'`.
- In `openWith`, replace the `settings: { members: [...] }` object with `settings: team(dirs)`.
- In `dragging the note onto a folder tile files it`, rename to `dragging the note onto a bunch tile files it`, drop it on `getByRole('button', { name: 'study bunch' })`, expect the toast `Filed to study`, and check `join(dirs.raw, 'drag.md')`.
- Delete the test `a note called log.md does not overwrite the folder log`.
- In `a note with unreadable properties is not filed with a made-up id`: click `study bunch`, then `File to study`, keep the `cannot be read` assertion, check `join(dirs.raw, 'broken.md')` does not exist, and delete the `log.md` assertion.
- In `the stamp written at filing survives the next save`: click `study bunch`, then `File to study`, `filed = join(dirs.raw, 'stamp.md')`, and replace both `agents: [librarian]` assertions with `bunch: study`.

- [ ] **Step 5: Update `tests/e2e/firstrun.spec.ts`**

Replace the three strip assertions with:

```ts
  // the strip is empty apart from the add button and the board button, and the coachmark points at the board
  await expect(page.locator('.tile-add')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Team board' })).toBeVisible()
  await expect(page.locator('.coachmark')).toContainText('Funky Bunch')
```

and the last button assertion with:

```ts
  await expect(page.getByRole('button', { name: 'Open the team board' })).toBeVisible()
  await page.getByRole('button', { name: 'Open the team board' }).click()
  await expect(page.getByRole('dialog', { name: 'Team board' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Team board' })).toContainText('Nothing here yet')
```

- [ ] **Step 6: Update `tests/e2e/packaged.spec.ts`**

Replace `const inbox = join(root, 'Inbox')` with `const raw = join(root, 'raw')` and use `raw` in the mkdir loop. Replace the settings JSON with:

```ts
    JSON.stringify({
      seenCoachmark: true,
      autosave: true,
      members: [
        { id: 'a1', kind: 'agent', name: 'librarian', emoji: '\u{1F4DA}', path: join(root, 'librarian') },
        { id: 'x1', kind: 'artifact', name: 'thesis', emoji: '\u{1F4D5}', path: join(root, 'thesis') }
      ],
      bunches: [{ id: 'b1', name: 'study', emoji: '\u{1F465}', rawPath: raw, agentIds: ['a1'], artifactIds: ['x1'] }]
    }),
```

Replace the filing steps with:

```ts
  // file it
  await page.getByRole('button', { name: 'study bunch' }).click()
  await page.getByRole('button', { name: 'File to study' }).click()
  await expect(page.locator('.toast')).toContainText('Filed to study', { timeout: 25000 })

  const filed = join(raw, 'packaged-note.md')
  expect(existsSync(filed)).toBe(true)
  const content = readFileSync(filed, 'utf8')
  expect(content).toContain('bunch: study')
  expect(content).toContain('Edited in the packaged app.')
  expect(content).toContain('| a | b |')
  expect(existsSync(join(raw, 'log.md'))).toBe(false)
```

- [ ] **Step 7: Update `tests/e2e/shot.spec.ts`**

Replace `const inbox = join(root, 'Inbox')` and `const research = join(root, 'Research')` with `const raw = join(root, 'raw')`, use `raw` in the mkdir loop, and replace the settings JSON with:

```ts
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({
    seenCoachmark: true,
    members: [
      { id: 'a1', kind: 'agent', name: 'librarian', emoji: '\u{1F4DA}', path: join(root, 'librarian') },
      { id: 'a2', kind: 'agent', name: 'tutor', emoji: '\u{1F9D1}', path: join(root, 'tutor') },
      { id: 'x1', kind: 'artifact', name: 'thesis', emoji: '\u{1F4D5}', path: join(root, 'thesis') },
      { id: 'x2', kind: 'artifact', name: 'startup', emoji: '\u{1F680}', path: join(root, 'startup') }
    ],
    bunches: [
      { id: 'b1', name: 'study', emoji: '\u{1F393}', rawPath: raw, agentIds: ['a1', 'a2'], artifactIds: ['x1'] },
      { id: 'b2', name: 'launch', emoji: '\u{1F680}', rawPath: raw, agentIds: ['a2'], artifactIds: ['x2'] }
    ]
  }), 'utf8')
```

If the rest of that file references `inbox` or `research`, replace them with `raw`.

- [ ] **Step 8: Create `tests/e2e/board.spec.ts`**

```ts
import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, prepare, team, agentMember, artifactMember, type Harness } from './helpers'

let h: Harness

test.afterEach(async () => {
  if (h) await h.close()
})

async function openWith(extra: Record<string, unknown> = {}) {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'board.md')
  writeFileSync(notePath, '# Board\n\nText.\n', 'utf8')
  const harness = await launch(dirs, { openFile: notePath, settings: { ...team(dirs), ...extra } })
  await expect(harness.page.locator('.pm-content')).toContainText('Board')
  return { harness, dirs }
}

test('the team board lists agents across the top, artifacts down the side, and counts filings', async () => {
  const { harness } = await openWith()
  h = harness

  await h.page.getByRole('button', { name: 'Team board' }).click()
  const board = h.page.getByRole('dialog', { name: 'Team board' })
  await expect(board.locator('th.board-agent')).toHaveText(/librarian/)
  await expect(board.locator('th.board-artifact')).toHaveText(/thesis/)
  await expect(board.getByRole('button', { name: 'librarian and thesis: 0 notes' })).toBeVisible()
  await board.getByRole('button', { name: 'Done' }).click()

  await h.page.getByRole('button', { name: 'study bunch' }).click()
  await h.page.getByRole('button', { name: 'File to study' }).click()
  await expect(h.page.locator('.toast')).toContainText('Filed to study', { timeout: 20000 })

  await h.page.getByRole('button', { name: 'Team board' }).click()
  await expect(h.page.getByRole('button', { name: 'librarian and thesis: 1 note' })).toBeVisible()
  expect(h.errors).toEqual([])
})

test('clicking a square with exactly one bunch opens that bunch', async () => {
  const { harness } = await openWith()
  h = harness

  await h.page.getByRole('button', { name: 'Team board' }).click()
  await h.page.getByRole('button', { name: 'librarian and thesis: 0 notes' }).click()
  const dialog = h.page.getByRole('dialog', { name: 'Edit bunch' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('input').first()).toHaveValue('study')
  expect(h.errors).toEqual([])
})

test('clicking a square with no bunch starts a new one with both members ticked', async () => {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'board.md')
  writeFileSync(notePath, '# Board\n\nText.\n', 'utf8')
  h = await launch(dirs, {
    openFile: notePath,
    settings: {
      ...team(dirs),
      members: [
        agentMember('a1', 'librarian', '\u{1F4DA}', dirs.agent),
        artifactMember('x1', 'thesis', '\u{1F4D5}', dirs.artifact),
        artifactMember('x2', 'notes', '\u{1F4D3}', dirs.downloads)
      ],
      defaultRawPath: dirs.raw
    }
  })
  await expect(h.page.locator('.pm-content')).toContainText('Board')

  await h.page.getByRole('button', { name: 'Team board' }).click()
  await h.page.getByRole('button', { name: 'librarian and notes: 0 notes' }).click()
  const dialog = h.page.getByRole('dialog', { name: 'Make a bunch' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('checkbox', { name: /librarian/ })).toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: /notes/ })).toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: /thesis/ })).not.toBeChecked()

  const save = dialog.getByRole('button', { name: 'Save' })
  await expect(save).toBeDisabled()
  await dialog.locator('input').first().fill('notes-team')
  await expect(save).toBeEnabled()
  await save.click()

  // back on the board, and the strip now has two bunches
  await expect(h.page.getByRole('dialog', { name: 'Team board' })).toBeVisible()
  await h.page.getByRole('button', { name: 'Done' }).click()
  await expect(h.page.getByRole('button', { name: 'notes-team bunch' })).toBeVisible()
  expect(h.errors).toEqual([])
})

test('adding a folder with a CLAUDE.md proposes agent', async () => {
  // The folder picker is a native dialog, so this checks the proposal through the IPC directly.
  const { harness, dirs } = await openWith()
  h = harness
  const kind = await h.page.evaluate(
    (path) => window.marki.members.proposeKind(path).then((r) => (r.ok ? r.kind : 'error')),
    dirs.agent
  )
  expect(kind).toBe('agent')
  const other = await h.page.evaluate(
    (path) => window.marki.members.proposeKind(path).then((r) => (r.ok ? r.kind : 'error')),
    dirs.artifact
  )
  expect(other).toBe('artifact')
})
```

- [ ] **Step 9: Run the whole suite**

Run: `npm run verify`
Expected: typecheck clean, all unit tests pass, build succeeds, every e2e spec passes. `packaged.spec.ts` skips unless `dist/win-unpacked` exists; that is fine.

If an e2e test fails on a selector, fix the selector in the test only when the UI is right and the test was wrong; otherwise fix the UI.

- [ ] **Step 10: Commit**

```bash
git add tests/e2e
git commit -m "End-to-end tests for bunches, the team board and single-copy filing

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: Final review

- [ ] **Step 1: Spec walk-through**

Open the spec and check each section against the code:

- Roster with kind proposal and flip: `MemberDialog.tsx`, `memberKind.ts`
- Bunch with raw folder, default raw path: `BunchDialog.tsx`, `SettingsDialog.tsx`
- Ledger, no `log.md`: `main/ipc/ledger.ts`, `filing.ts`
- File once, move, in-place, undo: `filing.ts`, `App.tsx`
- Stamp with five keys, block lists, forward slashes, mirrored tags replaced: `frontmatter.ts`, `bunch.ts`
- Strip, team board, dialogs, coachmark: `Strip.tsx`, `TeamBoard.tsx`, `App.tsx`
- Migration: `migrate.ts`
- Errors table: `selection.ts` (empty, unavailable), `App.tsx` (no raw folder prompt), `filing.ts` (preflight)

- [ ] **Step 2: Manual smoke run**

Run: `npm run dev`
Open a note, open the team board, add an agent and an artifact, make a bunch, file the note, open the raw folder and read the front matter. Then undo. Then right-click the bunch tile and remove it.

- [ ] **Step 3: Grep for leftovers**

Run: `git grep -n "FolderMember\|AgentMember\|folderIds\|mirrorAgentsAsTags\|log.md" -- src README.md`
Expected: no hits in `src`. (`README.md` may mention `log.md` only if you left a historical note; remove it.)

- [ ] **Step 4: Commit anything the review turned up, then report**

Report to the user: what changed, `npm run verify` output summary, and that migrated bunches will ask for a raw folder on first File.
