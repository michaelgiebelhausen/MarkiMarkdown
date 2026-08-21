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

The Funky Bunch is the strip down the left side of the window. It holds two things:

- **Your agents**, at the top. These are the AI helpers you work with, for example a study coach or a research
  assistant.
- **Your folders**, at the bottom. These are the real folders on your computer where notes live.

Here is how you use it:

1. Open or write a note.
2. Click the agents who should know about this note.
3. Click any extra folders it should live in.
4. Click **File**.

Picking an agent picks its folders for you. Each agent knows which folders it reads, so selecting the agent
automatically selects those folders. You can still add or remove folders by hand afterwards.

When you click File, three things happen:

- A copy of the note is placed in **every** selected folder.
- The agents you chose are written into the note's front matter (the small block of details at the top), so an
  agent reading the folder can see who the note is for.
- Each folder's `log.md` gets a line recording that the note was filed there, with the date.

One thing worth knowing: **each copy is its own separate file.** If you file a note into three folders you now
have three files. Editing one of them does not change the other two. That is deliberate, because it is what an
agent reading a single folder expects to find.

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
