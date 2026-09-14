# Installing MarkiMarkdown

This page walks you through installing MarkiMarkdown on Windows or on a Mac. It should take about five minutes.

If a step does not look like what you see on screen, that is fine. Nothing here can break your computer, and
you can stop at any point.

## Which file do I download?

Go to the project's **Releases** page and look at the list of files at the bottom of the newest release.

| You are on | Download this | What it is |
| --- | --- | --- |
| Windows | `MarkiMarkdown-1.1.0-Windows-Setup.exe` | The normal installer. Pick this one. |
| Windows, no permission to install | `MarkiMarkdown-1.1.0-Windows-Portable.exe` | Runs straight from the file. No install. |
| Mac | `MarkiMarkdown-1.1.0-Mac.dmg` | The normal Mac download. |

The numbers in those names are the version, so they go up over time. Take the newest.

You will also see files ending in `.blockmap`, a file called `latest.yml`, and two "Source code" downloads.
**Ignore all of those.** They are for the app's own update checks and for programmers. You do not need them.

## Windows

1. Download **`MarkiMarkdown-1.1.0-Windows-Setup.exe`**.
2. Open your **Downloads** folder and double-click the file.
3. Windows will probably show a blue box saying **"Windows protected your PC"**. This is expected. Keep reading.
   If instead you see a plain message saying **"An Application Control policy has blocked this file"**, with no
   blue box and no button to run it anyway, skip to [Smart App Control](#if-windows-says-an-application-control-policy-has-blocked-this-file) below.
4. Click the small **More info** link in that blue box.
5. Click **Run anyway**.
6. Follow the installer. It takes a few seconds. MarkiMarkdown then opens by itself.

### Why does Windows warn me?

Because MarkiMarkdown is not code-signed yet, and that is honestly the whole reason.

Code signing means buying a certificate that tells Windows who made the program. Those certificates cost real
money every year. MarkiMarkdown is free software, so it does not have one. Windows cannot tell "made by someone
who did not pay for a certificate" apart from "possibly nasty", so it shows the same warning for both.

The warning is not about anything wrong with your computer, and it is not something you did.

### If Windows says "An Application Control policy has blocked this file"

This is **not** the same as the blue "Windows protected your PC" screen, and there is no "Run anyway" button.
It comes from a Windows 11 feature called **Smart App Control**, which refuses to run any program it does not
recognise. MarkiMarkdown is new and not yet code-signed, so it does not recognise it.

Nothing you click in MarkiMarkdown can change this. Your choices are:

1. **Ask your instructor for a signed copy.** This is the real fix, and it is being worked on. A signed build
   runs everywhere with no warnings at all.
2. **Use a computer that does not have Smart App Control turned on.** It is on by default only on Windows 11
   PCs that shipped with it, and it is off on most machines that were upgraded from Windows 10.

You *can* turn Smart App Control off in Windows Security, under **App & browser control**. Think carefully
before you do: **once it is off, Windows will not let you turn it back on** without resetting or reinstalling
Windows. It is a one-way door, and it is not worth it for one app. Ask your instructor first.

To check whether it is on: open **Windows Security**, choose **App & browser control**, and look for
**Smart App Control settings**. If you do not see that section at all, it is not enabled on your PC and this
whole problem does not apply to you.

### The Portable version

`MarkiMarkdown-1.1.0-Windows-Portable.exe` is the whole app in a single file. Double-click it and it just runs. There is no
installer and nothing is added to your Start menu. It is a good choice if you are not allowed to install
software, or if you want to keep the app on a USB stick.

You will still see the same "Windows protected your PC" screen the first time. **More info**, then **Run
anyway**, same as above.

### If your laptop is managed by your school

Some school-managed laptops are set up to block any program that is not code-signed. If that is yours, you may
see a message about your administrator blocking the app, or the app may simply refuse to start, and there will
be no **Run anyway** link at all.

**This is not something you can fix, and it is not your fault.** The block is set by whoever manages the
laptop. Ask your instructor. They can either get the app approved or give you another way to run it. Please do
not spend an evening fighting with it.

## Mac

1. Download **`MarkiMarkdown-1.1.0-Mac.dmg`**.
2. Double-click the downloaded file. A small window opens showing the MarkiMarkdown icon and an
   **Applications** folder.
3. Drag the MarkiMarkdown icon onto the **Applications** folder. Wait for the copying to finish.
4. Close that little window. In Finder, click **Applications** in the sidebar, find MarkiMarkdown, and
   double-click it there.
5. If macOS asks whether you are sure you want to open it, click **Open**.

Step 4 matters more than it looks. That little window is a "disk image", a temporary thing, not a real folder.
If you open the app from there it may behave oddly and it will disappear when you restart. Always open
MarkiMarkdown from your **Applications** folder.

Once it is open, you can right-click its icon in the Dock and choose **Options > Keep in Dock** to make it easy
to find next time.

## Your first run

The first time MarkiMarkdown opens you will see a **Welcome** note already loaded, with the raw Markdown on the
left and the tidy version on the right. Type in either side and watch the other one change. Nothing you do to
this note can hurt anything.

Down the left is the **Funky Bunch**. It starts empty, so let's set it up. The idea is that the folders you
work with come in two kinds: **agents** are folders that do work (they hold skills and instructions for an AI),
and **artifacts** are folders that hold what the work produces. A **bunch** is a group of agents and artifacts,
like a group chat, with a **raw** folder where filed notes land.

1. Click the grid button on the strip to open the **team board**, then click **Add an artifact**.
2. Pick a folder on your computer. If you already keep notes somewhere, pick that. If not, make a new folder
   called `Notes` first, in Documents.
3. Give it a short name and pick an emoji for it. The emoji is just so you can spot it quickly. Click **Save**.
4. If you have a folder that an AI agent works from, click **Add an agent** and pick that too. You can skip this
   for now.
5. Close the board, click the **+** on the strip to **make a bunch**, give it a name, choose a raw folder (the
   **Create Documents / Second Brain / raw for me** button makes one), tick your artifact, and click **Save**.

That bunch now appears in the strip. To try filing, click the bunch so it lights up, then click **File**. Your
Welcome note is moved into the bunch's raw folder, with the agents and artifacts written into its properties.

## If something goes wrong

MarkiMarkdown should always tell you what happened in plain words instead of showing a wall of code. If it ever
does something confusing, here is how to get help.

1. Open the **Help** menu.
2. Click **Copy diagnostics**.
3. Paste that into an email to your instructor, along with what you were doing at the time.

The diagnostics are a short summary of your app version, your system, and the last few log lines. Have a read
before you send it if you like.

If you would rather look at the full log file yourself, or send it on:

- **Windows:** `%APPDATA%/MarkiMarkdown/logs`
  (paste that into the address bar of any Explorer window and press Enter)
- **Mac:** `~/Library/Logs/MarkiMarkdown`
  (in Finder, press Shift+Command+G, paste that in, press Enter)

## Questions people ask

### Where did my file go after I clicked File?

It went into the raw folder of the bunch you chose. That is what the File button does: it writes the note once
into that folder, stamps it with the agents and artifacts in the bunch, and tidies the original away from
wherever it was sitting, usually Downloads.

To find it, open that raw folder. The note is a normal file, sitting right there. The strip also shows a dot on
the bunch a note was last filed to.

If that is not what you wanted, click **Undo** in the little message that pops up at the bottom of the window
straight after filing. That puts everything back the way it was.

### Why is the AI button asking me to set something up?

Because MarkiMarkdown does not have an AI of its own. It borrows yours.

The AI clean-up feature works by talking to something you already have on your computer or in your account:
Claude Code, Ollama, or an API key you supply. If none of those are set up, the button asks you to choose one
first. Go to **Settings > AI** to point it at yours.

Two things worth saying plainly:

- Nobody is ever charged by MarkiMarkdown. It has no account, no subscription, and no payment of any kind. If
  you use your own API key, that is between you and whoever gave you the key.
- You never have to use the AI. Every other part of the app works without it.

### Can I use this with Obsidian?

Yes, and it works nicely.

Point a bunch's raw folder at a folder inside your Obsidian vault. Every note MarkiMarkdown files is an
ordinary Markdown file with ordinary front matter, so Obsidian picks it up as soon as it appears. Nothing is in
a special format and nothing is locked away.

The agents and artifacts also show up as Obsidian tags, as `agent/name` and `artifact/name`, which Obsidian can
search and filter on. That is on by default; you can turn it off in Settings.

The same is true for any other tool that reads Markdown files, including your own AI agents. They are just
files in folders.
