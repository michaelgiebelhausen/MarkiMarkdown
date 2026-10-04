# MarkiMarkdown 1.2.0

## Three panes

The window now has three panes: **Funky Bunch**, **Raw Markdown** and **Rendered Marki**. Checkboxes at the top
show or hide each one (Ctrl+1, Ctrl+2, Ctrl+3), and the dividers between them drag.

## Skills and domains

Agents are now called **skills** and artifacts are now called **domains**. Skill folders do a kind of work;
domain folders gather everything about one subject. Your settings and counts are converted automatically, and a
backup of your old settings and counts is kept (`settings.v2.bak.json` and `ledger.v2.bak.json`) next to them.

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

File used to **move** the note into the raw folder (with Undo). Save with Archive now leaves the note where it
is and adds a dated copy named `<name>-YYYY-MM-DD[-n].md`. So the same note (same `id`) can appear in the raw
folder more than once: dedupe on `id` or `archived:`. Lists in the YAML are block lists, one item per line. The
first tick adds `id`, `type` and `created` if they are missing, and archiving adds an `id`.
