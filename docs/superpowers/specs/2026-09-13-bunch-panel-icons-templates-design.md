# Bunch panel, member pictures and templates

Date: 2026-09-13
Status: section 1 (bunch panel) superseded by 2026-10-04-three-pane-funky-bunch-locations-design.md;
sections 2 and 3 (member pictures, templates) still proposed, for a later build

## Why

The Funky Bunch is the one new idea in MarkiMarkdown, and in 1.1 it is the least visible thing on
screen: a 36px column of three unlabeled icons. A new user sees a people glyph, a plus and a grid
and has no way to learn what any of it means without hovering. The v2 spec already says a bunch is
"like a group chat on a phone". The panel should look like that, and it should say so.

Three changes, in priority order:

1. The strip becomes a **bunch panel**, roughly 200px wide, that names things.
2. Agents and artifacts can carry an **uploaded picture** as well as an emoji.
3. **Templates** pre-populate YAML front matter and a markdown body for a new note.

## 1. Bunch panel

### Layout

The panel replaces the strip on the left. Default width 200px, resizable by dragging its right edge
between 160px and 320px. A chevron at the bottom collapses it to the current 52px strip, which keeps
the same rows as circles-only so nothing is lost. Width and collapsed state persist in settings.

Top to bottom:

```
FUNKY BUNCH                     (?)      <- section title, help opens the explainer
┌──────────────────────────────────┐
│ ◯◯◯  Upland Website             │      <- one row per bunch
│ ◯◯   3 agents · 2 artifacts   • │
├──────────────────────────────────┤
│ ◯◯◯  Class Prep                 │
│      1 agent · 1 artifact       │
└──────────────────────────────────┘
+ New bunch
──────────────
⊞ Team board
                                         <- spacer
⚙ Settings                       ‹       <- collapse chevron
```

### Bunch row

- Left: a **facepile** of member circles, 28px each, overlapping by 10px, at most four shown. A
  fifth and beyond collapse into a `+N` circle. Order: agents first, then artifacts. Each circle
  shows the member's picture if it has one, otherwise its emoji on a soft tinted disc. Artifact
  circles get a thin dashed ring so the two kinds read differently at a glance.
- Right: the bunch name in one line, ellipsised, and a muted second line counting members by kind.
- The picked bunch has an accent background and a left bar, the same treatment the picked tile has
  now. The "last filed here" dot moves to the right end of the second line as text: `filed here`.
- Unavailable raw folder shows a small `!` after the name with the existing tooltip.
- Empty bunch shows `add an agent or artifact` in the second line in place of counts.
- Click picks. Right-click or the `…` that appears on hover opens the bunch dialog. Dropping a note
  on a row files it, exactly as dropping on a tile does today.

### Teaching the idea

Three places, none of them a tour:

- **Section title** reads `FUNKY BUNCH` with a `(?)` that opens a one-screen explainer: "A bunch is
  a group chat for your notes. Put the agents that do the work and the artifacts that hold the
  results in one bunch, then file a note to it. The note lands once, in the bunch's raw folder,
  tagged with who it is for." The explainer ends with `Open the team board`.
- **Empty state.** When there are no bunches the list area shows the same explanation inline with a
  `Make your first bunch` button, instead of a lone `+`. The current coachmark goes away because the
  panel now says this itself.
- **Row anatomy.** Names and counts do the rest. A user who can read "3 agents · 2 artifacts" next
  to five faces does not need a definition of a bunch.

### What moves

- `Strip.tsx` is replaced by `BunchPanel.tsx`. `Plan` and `Tile` from `selection.ts` grow
  `members: MemberFace[]` per tile so the facepile needs no extra lookup.
- The coachmark and `showCoachmark` plumbing are removed.
- The team board and settings buttons keep their handlers and gain labels.

## 2. Member pictures

`Member` gains an optional `image?: string`, an absolute path inside the app's user data folder,
under `avatars/<memberId>.png`. Emoji stays required and is the fallback everywhere.

- On the team board, the agent and artifact editors get a `Picture…` button next to the emoji
  picker, and a `Remove` once one is set. The button opens a file dialog filtered to png, jpg, webp
  and gif.
- Main copies the chosen file, resizes it to 128px square with `nativeImage` (cover crop, centered),
  writes it as PNG under `avatars/`, and returns the path. Nothing larger is kept.
- Renderer loads pictures through the existing safe file protocol. If the file is missing at load,
  the circle falls back to the emoji and the field is left as is, so a restored settings file on a
  new machine still works.
- Removing a member deletes its avatar file.
- Pictures show in the facepile, in the team board headers and in the bunch dialog member list.

## 3. Templates

A template is a plain markdown file with optional front matter. That is the whole format.

- Templates live in `<userData>/templates/`. On first run the app writes the three built-ins there
  if the folder is empty, so users can edit or delete them and add their own.
- `File > New from Template` opens a picker listing every `.md` in that folder by its first
  heading or filename, plus `Open templates folder…`. Picking one creates a new note with the
  template body. The existing New Window behaviour is unchanged.
- Front matter in the template is merged under the app's preset: the preset supplies `id`,
  `created` and the bunch stamp at filing time, and the template supplies everything else. Template
  keys win over preset defaults when both set the same key, because the template is the more
  specific choice.
- Three placeholders are substituted when the note is created: `{{date}}` as `YYYY-MM-DD`,
  `{{datetime}}` as ISO 8601 with offset, and `{{title}}` as an empty string the cursor lands on.

Built-ins:

**todo-card.md**
```markdown
---
type: todo
status: open
due:
tags: []
---
# {{title}}

- [ ]
```

**mind-dump.md**
```markdown
---
type: mind-dump
tags: []
---
# {{date}} mind dump

```

**knowledge-file.md**
```markdown
---
type: knowledge
source:
verified: {{date}}
scope:
tags: []
---
# {{title}}

## What this covers

## Facts

## Open questions
```

## Out of scope

- No drag-reorder of bunches in the panel. Order stays creation order.
- No per-bunch picture. The facepile is the bunch's face.
- No template variables beyond the three above.
- The team board grid is unchanged apart from pictures in headers.

## Open questions for review

1. Is 200px the right default, or should the panel be wider so the second line never truncates?
2. Should `New from Template` also appear in the tab bar's `…` menu, or is the File menu enough
   given the no-toolbar decision?
3. Knowledge file: are `source`, `verified` and `scope` the right keys, or do you want it to match
   a specific second-brain convention?
