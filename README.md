# MarkiMarkdown

A free Markdown editor that shows the raw code on the left and the clean, readable text on the right, both
editable, so you can learn Markdown while you write.

Type in either side. The other side keeps up as you go. Nothing to memorise on day one.

## Why this exists

More and more students keep a "second brain": a set of folders full of plain notes that an AI agent can read
later. You save a chat from NotebookLM or ChatGPT, tidy it up, and file it where it belongs.

Those notes come out as Markdown, and Markdown is just text with a few small symbols in it. Most editors either
hide the symbols completely or show nothing but symbols. MarkiMarkdown shows you both at once, so the symbols
stop being a mystery. After a week or two you will read Markdown without thinking about it.

MarkiMarkdown is free, it is yours, and your notes stay on your own computer as ordinary files.

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

## What it does

- **Side-by-side editing with live sync.** Raw Markdown on the left, the finished-looking text on the right.
  Type in either one. Whichever side you are working in, the block you are in is tinted on **both** sides, and
  scrolling one pane brings the other along, so it is always obvious which code makes which words.
- **A formatting bubble.** Select some text on the right and a small bar appears: bold, italic, code, link, and
  buttons to turn the block into a heading, a list or a checklist. Watch what each one does to the Markdown.
- **Nothing gets rewritten behind your back.** Tables, quotes, code blocks, footnotes and Obsidian `[[links]]`
  are shown but held exactly as you wrote them. Editing one paragraph never reformats the rest of the file.
- **Spell check.** Ordinary red squiggles, right-click for suggestions.
- **Properties panel for front matter.** Front matter is the small block of details at the very top of a note:
  its title, the date, who it is for. You fill in boxes; MarkiMarkdown writes the code. It uses the OKF format
  by default, and there is a simpler "basic" option in Settings if you prefer.
- **Tags.** Add tags to a note and reuse them across your notes.
- **Opens plain `.txt` files** and turns them into Markdown, headings and lists and all, so an old text file
  does not have to stay an old text file.
- **Optional AI clean-up**, using *your* AI. If you already have Claude Code, Ollama, or an API key of your own,
  MarkiMarkdown can use it to tidy up messy text you pasted in. If you do not have one, everything else in the
  app still works. MarkiMarkdown has no AI of its own and never bills anyone, ever.

## Markdown in 60 seconds

| You type | You get |
| --- | --- |
| `# Big heading` | A heading. Two hashes `##` make a smaller one, three `###` smaller again. |
| `**bold**` | **bold** |
| `*italic*` | *italic* |
| `- milk` | A bullet point. |
| `1. First` | A numbered list. The numbers sort themselves out. |
| `- [ ] Buy milk` | A checkbox you can tick. |
| `---` | A horizontal line across the page. |

That is genuinely most of it. Everything else you can pick up later.

## A note on Windows and code signing

MarkiMarkdown is not yet code-signed. On most Windows PCs that means one blue "Windows protected your PC"
screen, which you click past once (see the install guide). On Windows 11 PCs with **Smart App Control** turned
on, it means the app is blocked outright with no way past it. Signing the app fixes both, and is the next
thing on the list. Until then, check the install guide before handing this to a class.

## Install

See **[docs/INSTALL.md](docs/INSTALL.md)** for step-by-step instructions for Windows and Mac, including what to
do about the Windows security warning.

If you are an instructor handing this out, send your students that page and nothing else. It assumes no
technical knowledge and it explains the Windows warning honestly, so nobody panics and nobody gives up.

## Build from source

Only needed if you want to change the app or build the installer yourself. You will need
[Node.js](https://nodejs.org) 20 or newer.

```bash
npm install       # fetch the pieces the app is built from
npm run dev       # run the app on your machine, with live reload
npm run pack:win  # build the Windows installer into dist/
npm test          # run the test suite
```

`npm run pack:mac` does the same as `pack:win`, for macOS. Building a Mac app has to be done on a Mac.

## Licence

MIT. Free to use, free to copy, free to change, free to hand to your students. See [LICENSE](LICENSE).
