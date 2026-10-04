import { test } from 'vitest'
import { applyTicks, readTicks, type ApplyOptions } from '@shared/ticks'
import { splitFrontMatter } from '@shared/markdown/frontmatter'
import type { Member } from '@shared/types'

const members: Member[] = [
  { id: 's1', kind: 'skill', name: 'writer', emoji: 'x', path: '/me/skills/writer' },
  { id: 'd1', kind: 'domain', name: 'Biology', emoji: 'x', path: '/me/domains/biology' }
]
const opts: ApplyOptions = { mirrorTags: true, preset: 'okf', newId: 'NEWID', now: 'NOW', title: '' }
const S1 = { skillIds: ['s1'], domainIds: [] }

test('probe2', () => {
  const crlf = '---\r\ntitle: x\r\ntags:\r\n  - a\r\n---\r\nbody\r\n'
  const { raw } = splitFrontMatter(crlf)
  const a = applyTicks(raw, S1, members, opts)
  console.log('CRLF out', JSON.stringify(a))
  console.log('null raw (CRLF body caller)', JSON.stringify(applyTicks(null, S1, members, opts)))
  try {
    console.log('agents anchor', JSON.stringify(applyTicks('---\nagents: &a [writer]\nnote: *a\n---\n', S1, members, opts)))
  } catch (e) { console.log('agents anchor THREW', String(e)) }
  try {
    console.log('skills anchor', JSON.stringify(applyTicks('---\nskills: &a [writer]\nsee: *a\n---\n', { skillIds: [], domainIds: [] }, members, opts)))
  } catch (e) { console.log('skills anchor THREW', String(e)) }
  // unchanged ticks on an already-app-written note: identical text?
  const w = applyTicks(null, { skillIds: ['s1'], domainIds: ['d1'] }, members, { ...opts, bunch: 'B' }) as string
  const again = applyTicks(w, readTicks(w, members), members, { ...opts, newId: 'OTHER', now: 'LATER' })
  console.log('no-churn', w === again)
  // tick toggle off then on: is it byte-identical to the start?
  const off = applyTicks(w, { skillIds: [], domainIds: ['d1'] }, members, opts) as string
  const on = applyTicks(off, { skillIds: ['s1'], domainIds: ['d1'] }, members, opts) as string
  console.log('toggle restores', w === on, JSON.stringify(on))
  // student comment between app keys
  console.log('comment in skills', JSON.stringify(applyTicks('---\nskills:\n  # pick one\n  - writer # main\n---\n', S1, members, opts)))
  // domains as comma string with a known + unknown
  console.log('domains comma', JSON.stringify(applyTicks('---\ndomains: Biology, Chem\n---\n', S1, members, opts)))
  // student wrote a tag which is a mirrored tag for an unknown name not in skills
  console.log('orphan mirrored', JSON.stringify(applyTicks('---\ntags: [skill/ghost]\n---\n', S1, members, opts)))
})
