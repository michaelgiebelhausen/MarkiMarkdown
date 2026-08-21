import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, prepare, type Harness } from './helpers'

let h: Harness

test.afterEach(async () => {
  if (h) await h.close()
})

function bigNote(paragraphs: number): string {
  const out: string[] = ['# A long set of notes', '']
  for (let i = 0; i < paragraphs; i++) {
    out.push(`## Section ${i + 1}`, '')
    out.push(
      `This is paragraph ${i + 1}. It carries a reasonable amount of prose so the document grows to a realistic size for a long lecture transcript.`,
      ''
    )
    out.push('- one point', '- another point', '')
  }
  return out.join('\n')
}

test('a long note opens and stays responsive while typing', async () => {
  const dirs = prepare()
  const notePath = join(dirs.downloads, 'long.md')
  const text = bigNote(900)
  writeFileSync(notePath, text, 'utf8')
  console.log('note size (KB):', Math.round(text.length / 1024))

  h = await launch(dirs, { openFile: notePath })
  await expect(h.page.locator('.pm-content')).toContainText('A long set of notes', { timeout: 30000 })

  await h.page.locator('.cm-content').click()
  const started = Date.now()
  await h.page.keyboard.type('Hello there', { delay: 0 })
  await expect(h.page.locator('.cm-content')).toContainText('Hello there', { timeout: 20000 })
  const elapsed = Date.now() - started
  console.log('typing 11 characters took (ms):', elapsed)

  expect(elapsed).toBeLessThan(6000)
  expect(h.errors).toEqual([])
})
