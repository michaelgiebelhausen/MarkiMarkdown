# Funky Bunch v2: agents, artifacts and bunches

Date: 2026-09-13
Status: approved design, awaiting implementation plan

## Summary

The Funky Bunch changes from "copy a note into every selected folder" to "file a note once into a
second brain's raw folder, stamped with who it is for". The core idea the app teaches is that a
coworking space holds two kinds of folder:

- **Agents**: folders that do work. They carry skills, a `CLAUDE.md`, an `AGENTS.md` or similar.
- **Artifacts**: folders that hold what the work produces.

A **bunch** is a named group of agents and artifacts, like a group chat on a phone. Filing a note
means picking one bunch and clicking File. The note is written once to that bunch's raw folder with
front matter naming the agents and artifacts involved. A Karpathy-style second brain then reads the
raw folder and distributes the note to the right wikis. MarkiMarkdown never routes to agent or
artifact folders itself.

## Model

### Roster

Members are app-wide and shared by every bunch.

```ts
interface Member {
  id: string
  kind: 'agent' | 'artifact'
  name: string
  emoji: string
  /** Absolute folder path. Empty only for agents migrated from 1.0 settings. */
  path: string
}
```

When a student adds a folder, the app proposes a kind: `agent` if the folder contains any of
`CLAUDE.md`, `AGENTS.md`, `.claude/` or `skills/`, otherwise `artifact`. The student can flip the
kind in the same dialog. Name defaults to the folder name.

A member can sit in any number of bunches. Removing a member from the roster removes it from every
bunch. A bunch left with no members stays but cannot be filed to until a member is added.

### Bunch

```ts
interface Bunch {
  id: string
  name: string
  emoji: string
  /** Absolute path of the raw folder this bunch files into. */
  rawPath: string
  agentIds: string[]
  artifactIds: string[]
}
```

A bunch needs a name, a raw folder and at least one member of either kind before it can be saved.

### Settings

`Settings` replaces `members: Member[]` with:

- `members: Member[]` (new shape above)
- `bunches: Bunch[]`
- `defaultRawPath?: string`, used to pre-fill the raw folder when a bunch is created
- `mirrorAgentsAsTags` renamed to `mirrorMembersAsTags`, default **on**

### Ledger

An app-side file, `ledger.json` in the user data directory, listing every filing:

```ts
interface LedgerEntry {
  noteId: string
  bunchId: string
  agentIds: string[]
  artifactIds: string[]
  filedAt: string // ISO 8601
}
```

The ledger feeds the team board counts. It is append-only; refiling the same note adds a new entry.
Nothing on disk in the student's folders records filings. No `log.md` is written anywhere.

## Filing

The student selects exactly one bunch and clicks File, or drags the open note onto a bunch tile.

1. **Preflight** (existing): the raw folder must exist and be writable. A file with the same name in
   raw that carries a different note id offers replace, keep both or cancel. A bunch with no raw
   folder prompts for one first, pre-filled from `defaultRawPath`.
2. **Stamp**: rewrite the front matter block only. The body keeps its bytes.
3. **Write once** to `<rawPath>/<fileName>`. If the note already lives in that raw folder it is saved
   in place. If it lives anywhere else it is moved there. Undo (existing) restores the previous
   location and content.
4. **Ledger**: append an entry. A ledger write failure is logged and does not fail the filing.

A member whose folder no longer exists does not block filing; its path is only data in the stamp.

### Stamp

Added to the existing OKF or basic front matter as flat YAML. Names and paths are parallel lists so a
one-line grep or awk can pair them by index. Paths use forward slashes on every platform.

```yaml
bunch: thesis
agents:
  - study-coach
  - research-assistant
agent_paths:
  - C:/Users/me/agents/study-coach
  - C:/Users/me/agents/research-assistant
artifacts:
  - thesis-chapter-3
artifact_paths:
  - C:/Users/me/artifacts/thesis-chapter-3
```

Rules:

- Refiling into another bunch replaces all six keys wholesale.
- Names are plain strings, never wikilinks. A later `related:` key may carry `[[links]]` without
  disturbing these.
- An agent with an empty path still appears in `agents` with an empty string in `agent_paths` at the
  same index.
- With `mirrorMembersAsTags` on, `tags` also receives `agent/<name>` and `artifact/<name>` entries,
  which Obsidian renders as nested tags. Mirrored entries from a previous filing are removed before
  the new ones are added; hand-written tags are untouched.

## UI

The editor itself does not change. Raw Markdown on the left and the rendered view on the right,
scroll sync, the block tint on both panes, the bubble menu and GFM task lists all stay exactly as
shipped in 1.0. This design only touches the strip, its dialogs and Settings.

### Strip

Top to bottom: one tile per bunch, a plus tile that opens the bunch dialog, a board button, a
spacer, the gear. The former agent and folder sections are gone.

- Clicking a bunch tile selects it. Only one can be selected.
- A dot on a tile means the open note was last filed to that bunch (from the ledger, by note id).
- Dropping a note on a tile files it there immediately.
- Right-click opens the bunch dialog for editing.
- Tile hover shows the bunch name and its member count.

### Team board

A dialog opened from the strip button. Agents across the top with emoji and name, artifacts down
the side, a count in each cell of ledger entries containing both.

- Clicking a cell: if exactly one bunch contains both members, open it for editing; otherwise open
  the bunch dialog with that agent and artifact pre-ticked.
- Buttons add an agent or an artifact to the roster.
- Right-clicking a row or column header edits or removes that member.
- A member whose path is empty or no longer exists shows a warning mark in its header.
- An empty roster shows a short explanation of agents and artifacts with the two add buttons.

### Bunch dialog

Name, emoji, raw folder (pre-filled from `defaultRawPath`), then two checklists drawn from the
roster, agents and artifacts. Save is disabled until there is a name, a raw folder and at least one
ticked member. Includes a delete button for existing bunches.

### Member dialog

Choose a folder, then edit the proposed name, emoji and kind. Kind is a two-way toggle.

### Settings

One new field, default raw folder, with a folder picker. `mirrorMembersAsTags` toggle keeps its
place, relabelled to mention agents and artifacts.

### Coachmark

First-run text: "Your Funky Bunch lives here. Add an agent, add an artifact, then make a bunch."
Its button opens the team board.

## Migration from 1.0 settings

Runs once when settings load without a `bunches` key.

- Each old folder member becomes an artifact with the same id, name, emoji and path.
- Each old agent member becomes an agent with the same id, name and emoji and an empty path. The
  board and bunch dialog flag it until the student picks a folder.
- Each old agent that had `folderIds` produces one bunch named after the agent, with that agent and
  those folders as artifacts, and an empty `rawPath`.
- The ledger starts empty.
- Nothing on disk changes.

## Errors

| Situation | Behaviour |
| --- | --- |
| Raw folder missing or read-only | File blocked, folder named in the message (existing preflight) |
| Bunch has no raw folder and no default | Prompt for one before filing |
| Name clash in raw, different note id | Replace, keep both or cancel (existing) |
| Member path missing | Warning mark on board and in bunch dialog; filing proceeds |
| Ledger write fails | Filing succeeds; error logged; counts may be stale |
| Bunch with no members | Tile shown, File disabled with a tooltip |

## Testing

Unit (vitest):

- Stamp: parallel lists, forward slashes, empty agent path, wholesale replacement on refile, tag
  mirroring adds and removes only its own entries.
- Migration: old settings shape produces the expected members and bunches; idempotent on rerun.
- Ledger: append, read, board counts for a pair.
- Kind proposal from folder contents.

E2E (Playwright, real Electron):

- Strip shows bunches; selecting one and filing writes the note to raw with the stamp.
- Team board renders counts and creates a bunch from a cell.
- Drag a note onto a tile.
- Undo restores the note to its original location.
- First-run coachmark opens the board.

Existing filing tests are rewritten for a single destination.

## Out of scope

- Filing to several bunches at once
- Wikilink conventions and a `related:` key
- On-disk logs of any kind
- Triggering the second brain (webhooks, watchers)
- Reading a second brain's config to discover agents or artifacts automatically
