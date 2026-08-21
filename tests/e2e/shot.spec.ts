import { test } from '@playwright/test'
import { _electron as electron } from '@playwright/test'
import { writeFileSync, mkdirSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const OUT = process.env.MARKI_SHOT_DIR

// A helper for looking at the app, not a check. Set MARKI_SHOT_DIR to run it.
test.skip(!OUT, 'set MARKI_SHOT_DIR to capture screenshots')

test('capture the interface', async () => {
  const root = mkdtempSync(join(tmpdir(), 'marki-shot-'))
  const userData = join(root, 'userData')
  const downloads = join(root, 'downloads')
  const inbox = join(root, 'Inbox')
  const research = join(root, 'Research')
  for (const d of [userData, downloads, inbox, research]) mkdirSync(d, { recursive: true })

  writeFileSync(join(userData, 'settings.json'), JSON.stringify({
    seenCoachmark: true,
    members: [
      { id: 'a1', kind: 'agent', name: 'librarian', emoji: '\u{1F4DA}', folderIds: ['f1', 'f2'] },
      { id: 'a2', kind: 'agent', name: 'tutor', emoji: '\u{1F9D1}', folderIds: ['f2'] },
      { id: 'f1', kind: 'folder', name: 'Inbox', emoji: '\u{1F4E5}', path: inbox, stamp: { tags: ['raw'] } },
      { id: 'f2', kind: 'folder', name: 'Research', emoji: '\u{1F52C}', path: research, stamp: { tags: [] } }
    ]
  }), 'utf8')

  const note = [
    '---',
    'type: note',
    'title: Cognitive Load Theory',
    'tags: [ai, class, week2]',
    '---',
    '',
    '# Cognitive Load Theory',
    '',
    'Working memory is **limited**. Good teaching keeps *extraneous* load low.',
    '',
    '## Key ideas',
    '',
    '- Intrinsic load is the material itself',
    '- Extraneous load comes from poor presentation',
    '- Germane load builds understanding',
    '',
    '## To do',
    '',
    '- [x] Watch the lecture',
    '- [ ] Read chapter 3',
    '- [ ] Summarise for [[Second Brain]]',
    '',
    '| Type | Can we change it? |',
    '| --- | --- |',
    '| Intrinsic | Only by sequencing |',
    '| Extraneous | Yes |',
    '',
    '---',
    '',
    'See `worked_example_effect` for more.',
    ''
  ].join('\n')
  const notePath = join(downloads, 'cognitive-load.md')
  writeFileSync(notePath, note, 'utf8')

  // launch from the current build so the shot always reflects the working tree
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`, notePath],
    cwd: process.cwd()
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.pm-content')
  await page.setViewportSize({ width: 1280, height: 820 })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: join(OUT as string, 'marki-01-main.png') })

  await page.locator('.props-summary').click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT as string, 'marki-02-properties.png') })
  await page.locator('.props-summary').click()

  // the formatting bubble over a selection
  await page.locator('.pm-content p').first().click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(OUT as string, 'marki-06-bubble.png') })

  await page.getByRole('button', { name: 'librarian agent' }).click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT as string, 'marki-03-selected.png') })
  await page.locator('.strip').screenshot({ path: join(OUT as string, 'marki-04-strip.png') })
  console.log('STRIP TILES:', JSON.stringify(await page.evaluate(() =>
    [...document.querySelectorAll('.strip .tile')].map((t) => ({
      label: t.getAttribute('aria-label'),
      cls: t.className,
      w: Math.round(t.getBoundingClientRect().width),
      h: Math.round(t.getBoundingClientRect().height)
    }))
  )))

  await app.close()
})
