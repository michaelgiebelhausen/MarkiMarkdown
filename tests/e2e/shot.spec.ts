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
  const raw = join(root, 'raw')
  for (const d of [userData, downloads, raw]) mkdirSync(d, { recursive: true })

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

  await page.getByRole('button', { name: 'study bunch' }).click()
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
