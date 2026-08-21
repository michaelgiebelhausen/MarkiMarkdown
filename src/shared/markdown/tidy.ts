import { splitFrontMatter } from './frontmatter'

export interface TidyResult {
  markdown: string
  changes: number
}

/**
 * Small, safe tidy-ups only. Anything inside a fenced code block, and the front
 * matter, are left exactly as the student wrote them.
 */
export function tidyMarkdown(text: string): TidyResult {
  try {
    const split = splitFrontMatter(text)
    const front = split.raw ?? ''
    const body = split.body
    let changes = 0

    const lines = body.split(/\r?\n/)
    const out: string[] = []
    let inFence = false
    let lastHeadingLevel = 0

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i]

      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence
        out.push(line)
        continue
      }
      if (inFence) {
        out.push(line)
        continue
      }

      // trailing spaces, but two spaces are a deliberate line break
      const trimmed = line.replace(/[ \t]+$/, '')
      if (trimmed !== line) {
        const isBreak = /\S {2}$/.test(line) && !/ {3}$/.test(line)
        if (isBreak) {
          line = trimmed + '  '
        } else {
          line = trimmed
          changes += 1
        }
      }

      // bullet markers
      const bullet = /^(\s*)([*+])(\s+)/.exec(line)
      if (bullet) {
        line = line.replace(/^(\s*)([*+])(\s+)/, '$1-$3')
        changes += 1
      }

      // heading levels that skip a step
      const heading = /^(#{1,6})(\s+)(.*)$/.exec(line)
      if (heading) {
        let level = heading[1].length
        if (lastHeadingLevel > 0 && level > lastHeadingLevel + 1) {
          level = lastHeadingLevel + 1
          line = '#'.repeat(level) + ' ' + heading[3]
          changes += 1
        }
        lastHeadingLevel = level

        if (out.length > 0 && out[out.length - 1].trim() !== '') {
          out.push('')
          changes += 1
        }
        out.push(line)
        const next = lines[i + 1]
        if (next !== undefined && next.trim() !== '') {
          out.push('')
          changes += 1
        }
        continue
      }

      out.push(line)
    }

    // collapse blank runs
    const collapsed: string[] = []
    let blanks = 0
    let fence = false
    for (const line of out) {
      if (/^\s*(```|~~~)/.test(line)) fence = !fence
      if (!fence && line.trim() === '') {
        blanks += 1
        if (blanks > 1) {
          changes += 1
          continue
        }
      } else {
        blanks = 0
      }
      collapsed.push(line)
    }

    while (collapsed.length > 0 && collapsed[collapsed.length - 1].trim() === '') collapsed.pop()
    const tidied = collapsed.length === 0 ? '' : collapsed.join('\n') + '\n'
    if (tidied !== body) changes = Math.max(changes, 1)

    return { markdown: front + tidied, changes: tidied === body ? 0 : changes }
  } catch {
    return { markdown: text, changes: 0 }
  }
}
