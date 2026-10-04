# Three panes, Funky Bunch locations, and live YAML

Date: 2026-10-04
Status: approved in brainstorming, awaiting written-spec review
Target release: 1.2.0

## Why

The goal of MarkiMarkdown is to make it easy to file Markdown away so the right agents can find it
later, and to teach one idea while doing it: **skill folders** cut across many deliverables, and
**domain folders** gather everything about one subject. In 1.1 that idea lives in a pop-up team board
and a 36px strip of unlabelled icons, and the note's YAML only learns who it is for at the moment of
filing. A student never sees the connection between "I picked these folders" and "these lines appeared
in my file".

This release puts the Funky Bunch on screen as a full pane beside the editors, makes ticking the grid
edit the note's YAML live, and splits saving into a working version plus an optional archive copy for
milestones.

## Summary of decisions

- Three panes in one window: **Funky Bunch** (left), **Raw Markdown** (middle), **Rendered Marki**
  (right). A three-checkbox selector replaces Code / Split / Text.
- **Agents are renamed skills, artifacts are renamed domains**, everywhere: UI, settings, ledger and
  YAML keys. Same concept, new words. Migration covers settings; notes on disk are never rewritten
  silently.
- The Funky Bunch pane is a **locations form**: where the working version is saved, whether this
  version is archived, which raw folder receives the archive copy, and the skills × domains grid.
- **Archive / distribute** saves the working file and also writes a dated copy into the chosen raw
  folder. Copies are never overwritten.
- **Bunches become saved presets**: clicking one loads its skills, domains and raw folder into the form.
- **The note's YAML is the source of truth** for ticks. The grid reads it and writes it.
- The raw pane **folds the YAML** to one summary line; **View YAML** unfolds it.

## 1. Layout

### Pane selector

The top bar's Code / Split / Text segmented control is replaced by three checkboxes:

```
[x] Funky Bunch   [x] Raw Markdown   [x] Rendered Marki
```

- Any combination may be shown. The last ticked box cannot be unticked.
- Panes always appear in the fixed order Funky Bunch, Raw, Rendered, left to right.
- The dividers between visible panes drag to resize. Widths are stored as fractions and persist.
- The selection persists in settings. On upgrade the old `view` setting maps as follows: `code` to Raw
  only, `split` to Raw + Rendered, `text` to Rendered only. Funky Bunch is ticked in every case, so
  upgraders see the new pane once.
- Minimum widths: Funky Bunch 280px, Raw and Rendered 240px each. If the window is too narrow for every
  ticked pane at its minimum, the rightmost ticked pane is hidden until the window widens, and its
  checkbox shows a tooltip saying so. The ticks themselves are not changed.

### Top bar

- The top bar keeps the file chip, the busy indicator and the `⋯` menu.
- The **File** button and its clear-selection `×` are removed. Saving happens from the pane.
- The chip's places summary changes from "Not filed yet" / "N places" to "not archived" /
  "archived N×". The count is the number of ledger entries with this note's `id`.
- The chip stays draggable. Dropping it on a bunch chip in the pane applies that bunch, the same as
  clicking it.

## 2. Funky Bunch pane

The pane replaces `Strip.tsx` and the `TeamBoard` modal. Top to bottom:

```
FUNKY BUNCH LOCATIONS                                   (?)

Working version saves to
[ Documents/Class/drafts                         📁 ]

[x] Archive / distribute this version
    A milestone worth filing in your second brain.
Archive copy goes to raw folder
[ SecondBrain/raw                                📁 ]
    <one-line block reason, when there is one>

Bunch  (Class prep) (Upland site) (+ Save as bunch)
    <unknown-name chips, when there are any>

            Writer   Coder   Editor   + Add skill
Biology       ●        ·       ●
History       ·        3       ·
Website       1        ·       ·
+ Add domain

                                        [ Save and archive ]
```

### Help

The `(?)` opens a one-screen explainer: skill folders do a kind of work and hold the skills and
`CLAUDE.md` for it; domain folders hold everything about one subject; tick the ones a note belongs to;
the ticks become YAML your second brain's agents can search; tick Archive when this version is a
milestone. It ends with a link to the help dialog. The 1.1 coachmark and `seenCoachmark` are removed.

### Working location

- Shows the folder of the open file. For an untitled note it is empty and reads "Choose a folder".
- The folder button opens a folder picker.
  - Untitled note: the choice is remembered for the first Save.
  - Saved note: the file is moved to the new folder. The first time, a confirmation explains that
    the working file moves (it is not copied). This reuses the existing `confirmedFileMoves` setting.
    If a file with that name already exists in the target, the move is refused with a toast and
    nothing changes.

### Archive checkbox and raw folder

- **Archive / distribute this version** is unticked by default and unticks itself after each
  successful archive.
- The raw folder field is filled from the active bunch's raw folder, or failing that from the app's
  default raw folder. Changing it here changes it for this window only. A bunch's own raw folder is
  edited in the bunch dialog.

### Bunch chips

- One chip per bunch, in creation order. Clicking a chip **applies** it: the note's ticks become exactly
  that bunch's skills and domains, `bunch:` is written, and the raw folder field takes the bunch's raw
  folder. This is one undoable edit.
- After applying, the user may tick or untick extra cells. The chip stays highlighted while the note's
  `bunch:` value matches it. Unticking every member of the bunch does not clear `bunch:`. Clicking the
  highlighted chip again clears `bunch:` but keeps the ticks.
- Right-click or the hover `…` on a chip opens the existing bunch dialog, renamed to skills and domains.
- **Save as bunch** opens the bunch dialog pre-filled with the current ticks and raw folder.
- If there are no bunches the chip row shows only **Save as bunch**.

### Unknown-name chips

When the YAML names a skill or domain that is not in the roster (matched by name, case-insensitive),
a warning chip appears above the grid: "History isn't a domain yet. Add it?" Clicking it opens the
member dialog with the name and kind pre-filled. Unknown names are left in the YAML untouched.

### Grid

- Skills across the top, domains down the side, built from the 1.1 `TeamBoard` table.
- Clicking a skill or domain name toggles that tick. Clicking a cell ticks both its skill and its domain
  if either is unticked, and unticks both if both are ticked.
- Ticked names get the accent background. A cell whose skill and domain are both ticked shows a filled
  dot in place of its count.
- Cell numbers are ledger counts: how many archives included both that skill and that domain.
- Editing a member moves to right-click or the hover `…` on its name, because a plain click now
  ticks. Missing-folder `!` markers stay.
- **+ Add skill** and **+ Add domain** sit at the ends of the header row and the header column.
- Empty roster: the grid area shows the explainer text with **Add a skill** and **Add a domain** buttons.
- While the YAML cannot be parsed, the grid is greyed out and reads "Fix the YAML to tick skills and
  domains". Bunch chips are disabled for the same reason.

### Save button

- Reads **Save and archive** when the box is ticked and archiving is possible, otherwise **Save**.
- Ctrl+S / Cmd+S behaves exactly like this button.

## 3. Save and archive flow

### Saving the working version

1. If the note is untitled and no working folder is chosen, open the folder picker. Cancel stops here.
2. Untitled notes are named from the first heading, slugified, falling back to `untitled.md`. On a
   name clash the existing `-2`, `-3` rule applies.
3. Write the working file in place, as today. Autosave continues to do this on its own.

### Archiving

Runs only after the working save succeeds, and only if the box is ticked and `planSave` allows it.

1. Build the copy: the working text with one key added or replaced, `archived: <ISO 8601 with offset>`.
   Everything else, including `id` and the ticks, is identical. The working file does not get
   `archived:`.
2. Name it `<working base name>-YYYY-MM-DD.md` using the local date. If that name exists, use `-2`,
   `-3`, and so on (`essay-2026-10-04-2.md`).
3. Write it with an exclusive create (`wx`). If the write loses a race to an existing file, take the
   next suffix and retry up to 20 times.
4. Append a ledger entry `{ noteId, bunchId, skillIds, domainIds, archivedAt }`.
5. Untick the box and show a toast: "Saved and archived to SecondBrain/raw".

### When archiving is blocked

`planSave` returns the first reason that applies, in this order, shown under the raw folder field. The
button then reads **Save**:

- "Fix the YAML first." The YAML does not parse.
- "Choose a raw folder to archive into." No raw folder is set.
- "The raw folder can't be found." The folder is missing; it is rechecked when the window regains focus.
- "Tick at least one skill or domain." A note nobody is tagged for cannot be routed.
- "This note already lives in the raw folder." Working folder equals raw folder.

### Failures

- Working save fails: error toast, no copy is attempted, the box stays ticked.
- Working save succeeds, copy fails: toast "Saved, but not archived: <reason>", the box stays ticked,
  no ledger entry is written.
- Ledger write fails after the copy: the copy stands, and a toast says the count could not be updated.
  This matches 1.1 behaviour.

## 4. YAML

### Shape (OKF preset)

```yaml
---
id: 01JA8Q3K5M
type: note
title: Cell membranes
created: 2026-10-04T15:02:00-04:00
bunch: Class prep
skills:
  - Writer
  - Editor
skill_paths:
  - C:/Users/you/Agents/writer
  - C:/Users/you/Agents/editor
domains:
  - Biology
domain_paths:
  - C:/Users/you/Domains/biology
tags:
  - skill/writer
  - skill/editor
  - domain/biology
  - exam-prep
---
```

- **App-owned keys:** `bunch`, `skills`, `skill_paths`, `domains`, `domain_paths`, mirrored tags
  (`skill/*`, `domain/*`), and on first tick `id`, `type` (OKF preset only) and `created`. Every other
  key, and every other tag, is never touched.
- Paths use forward slashes. Names are plain strings, not wikilinks. Lists are block style, as in 1.1.
- Mirrored tags are lower-cased names with spaces replaced by `-`. They are controlled by the existing
  mirror setting, renamed `mirrorTicksAsTags`. When it is off, ticks write no tags and existing
  `skill/*`, `domain/*` tags are left alone.
- An empty list removes its key rather than writing `skills: []`.
- `archived:` exists only on archive copies. `filed:` is no longer written. Existing `filed:` values
  in old notes are left alone.
- The `basic` preset writes the same keys except `type`.

### Live ticking

- The YAML is the only store of a note's ticks. The grid is computed with `readTicks` on every
  document change.
- A tick, a bunch chip or an unknown-name fix calls `applyTicks` and replaces the front matter through
  the document store as one undo group. Ctrl+Z reverses it.
- Hand-editing `skills:` or `domains:` in the raw pane updates the grid on the next change.
- `skill_paths` and `domain_paths` are always regenerated from the roster on write. Paths in the file
  are never used to identify members; names are.

### Fold and View YAML

- In the raw pane the front matter folds to one line:
  `▸ YAML · 2 skills · 1 domain · 4 tags`. Counts come from `readTicks` and the tag list.
- A **View YAML** button in the raw pane's corner unfolds it and becomes **Hide YAML**. Clicking the
  summary line also unfolds. The folded or open state persists in settings.
- Moving the cursor into a folded range (find, go to line) unfolds it.
- Unparseable YAML is never folded and gets a red gutter marker.
- Live edits from the grid do not change the fold state.
- The properties panel in the rendered pane is unchanged.

## 5. Rename and migration

### Settings, bunches and ledger

A one-time settings migration (schema version 3) runs on startup:

- `Member.kind`: `agent` becomes `skill`, `artifact` becomes `domain`.
- `Bunch.agentIds` becomes `skillIds`, `Bunch.artifactIds` becomes `domainIds`.
- `LedgerEntry.agentIds`, `artifactIds` and `filedAt` become `skillIds`, `domainIds` and `archivedAt`.
- `mirrorMembersAsTags` becomes `mirrorTicksAsTags`, keeping its value.
- New settings: `panes: { bunch, raw, rendered }`, `paneWidths`, `yamlFolded: true`.
- Removed: `seenCoachmark`, `view` (after mapping).
- Before migrating, the old settings and ledger files are copied to `settings.v2.bak.json` and
  `ledger.v2.bak.json` alongside them.

### Notes on disk

- No note is rewritten on open or on upgrade.
- `readTicks` treats `agents` / `artifacts` as aliases of `skills` / `domains` when the new keys are
  absent, so a 1.1 note opens with the right ticks lit.
- The first `applyTicks` on such a note writes the new keys, removes `agents`, `agent_paths`,
  `artifacts` and `artifact_paths`, and replaces `agent/*` and `artifact/*` tags with `skill/*` and
  `domain/*`. This is a user-initiated edit and is undoable.
- Archive copies already in raw folders are never touched. Release notes flag the key change for
  anyone whose scripts grep `agents:`.

## 6. Code structure

New units:

| Unit | Responsibility |
|---|---|
| `src/shared/ticks.ts` | Pure. `readTicks(yaml, roster)` returns ticked skill ids, ticked domain ids, unknown names, bunch name and whether aliases were used. `applyTicks(yaml, ticks, roster, opts)` returns new YAML. The only writer of app-owned keys. |
| `src/shared/archive.ts` | Pure. `archiveName(base, localDate, existingNames)` and `planSave(state)` returning `{ canArchive, reason }`. |
| `src/main/ipc/archive.ts` | Writes the copy with `wx` and suffix retry. Moves the working file for a location change. |
| `src/renderer/layout/PaneLayout.tsx` | Visible panes, resizable dividers, persisted widths, narrow-window hiding. |
| `src/renderer/ui/PaneSelector.tsx` | The three checkboxes and the last-one-stays-on rule. |
| `src/renderer/funkybunch/LocationsPane.tsx` | Composes the form. |
| `src/renderer/funkybunch/BunchChips.tsx` | Chips, apply, save-as-bunch. |
| `src/renderer/funkybunch/SkillDomainGrid.tsx` | The grid, from the 1.1 TeamBoard table. |
| `src/renderer/state/useSaveFlow.ts` | Save, then archive, then ledger, then toasts. Takes filing logic out of `App.tsx`. |
| `src/renderer/editors/yamlFold.ts` | CodeMirror fold extension, summary widget and gutter marker for the raw pane. |
| `src/shared/migrate.ts` | Adds the v2 to v3 step. |

Changed: `types.ts` (renamed kinds and fields, new settings), `frontmatter.ts` (`stampNote` retired in
favour of `applyTicks` plus a small `addArchived`), `TopBar.tsx`, `CodePane.tsx`, `MemberDialog.tsx`
and `BunchDialog.tsx` (wording), `HelpDialog.tsx`, `menu.ts` (View menu gets the three pane toggles),
`App.tsx`.

Removed: `Strip.tsx`, `TeamBoard.tsx`, `selection.ts` (its `Plan` is replaced by `planSave`), the
coachmark, `runFiling` and `performFiling`.

## 7. Testing

Unit (vitest):

- `readTicks`: new keys, alias keys, both present (new wins), unknown names, case-insensitive matching,
  broken YAML.
- `applyTicks`: user keys and tags preserved, mirrored tags added and removed, mirroring off, empty
  lists remove keys, alias keys and tags converted, `id`/`type`/`created` added only when missing,
  basic preset has no `type`, body bytes untouched.
- `archiveName`: no clash, same-day clashes, base names that already end in a date.
- `planSave`: each block reason and its precedence order (the list order in section 3).
- Migration v2 to v3: members, bunches, ledger, settings mapping, backup files written, idempotent on
  a second run.

E2E (Playwright, real Electron):

- Ticking a cell updates the raw pane's YAML. Ctrl+Z reverts it.
- Hand-editing `domains:` in the raw pane lights the row.
- Applying a bunch chip loads ticks and raw folder.
- Save and archive produces the working file plus `name-YYYY-MM-DD.md` in raw, unticks the box and
  bumps the grid count and chip.
- A second archive the same day produces `-2`.
- Missing raw folder gives the block reason. A copy failure gives "Saved, but not archived".
- A 1.1 note with `agents:` opens with ticks lit, and the first tick rewrites its keys.
- Pane selector combinations persist across restart, and the last box cannot be unticked.
- Fold, View YAML, Hide YAML, and broken YAML never folding.

The 1.1 team board and bunch filing E2E tests are rewritten against the pane. `npm run verify` stays
the gate.

## 8. Build order

Each phase ends green on `npm run verify`.

1. Rename, v3 migration and `ticks.ts`. The UI changes words only, and filing still works through the
   old path using the new keys.
2. `PaneLayout`, `PaneSelector` and `LocationsPane` with the grid, chips and live YAML. The Team board
   and strip are removed.
3. `useSaveFlow`, archive IPC and the top bar changes. The File button and the filing path are removed.
4. The YAML fold and View YAML.
5. Help text, INSTALL guide and release notes, then version 1.2.0.

## Relationship to the 2026-09-13 bunch panel spec

Section 1 of `2026-09-13-bunch-panel-icons-templates-design.md` (the 200px bunch sidebar) is superseded
by this spec. Its member pictures and templates sections stand as a later, separate build. When built,
pictures appear in the grid headers and bunch chips, not in a facepile.

## Out of scope

- A separate OS window for the Funky Bunch pane.
- Browsing the files already inside skill, domain or raw folders.
- Overwriting or pruning older archive copies.
- Wikilink-style values in `skills:` / `domains:`.
- Drag-reordering bunches, skills or domains.
