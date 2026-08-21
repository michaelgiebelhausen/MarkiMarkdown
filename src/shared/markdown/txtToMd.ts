/**
 * Turning a plain .txt note into Markdown.
 *
 * Students drop in text that came out of a chat assistant or a Word export and
 * ask us to "make it Markdown". The only thing worse than under-converting is
 * mangling their notes, so every rule here is deliberately timid:
 *
 *  - a rule only fires on a PATTERN (a run of sibling lines), never on a single
 *    stray character that happened to start a line
 *  - a rule that is not certain does nothing at all
 *  - nothing ever throws: a surprise returns the student's text unchanged
 *
 * The converter may DELETE markers (a bullet character, a citation marker) and
 * it may INTRODUCE the Markdown markers '-', '#' and the '.' of an ordered list.
 * It must never invent any other visible character, and it never rewrites the
 * words the student actually wrote.
 */

export interface ConversionChange {
  /** Rule name: 'bullets' | 'numbering' | 'headings' | 'unwrap' | 'citations'. */
  rule: string
  /** How many times the rule fired. Never reported when zero. */
  count: number
}

export interface ConversionResult {
  markdown: string
  /** Only the rules that actually changed something, in a stable order. */
  changes: ConversionChange[]
}

type RuleName = 'bullets' | 'numbering' | 'headings' | 'unwrap' | 'citations'

/** Report order, so the "what changed" list a student sees is predictable. */
const RULE_ORDER: RuleName[] = ['bullets', 'numbering', 'headings', 'unwrap', 'citations']

type Counts = Record<RuleName, number>

/** Bullet characters a word processor or chat assistant emits, plus the asterisk. */
const BULLET_LINE = /^(\s*)([\u2022\u25E6\u25AA\u00B7\u2013\u2014*]) (.*)$/

/** '1.' or '1)' followed by a space. */
const NUMBER_LINE = /^(\s*)(\d+)([.)]) (.*)$/

/** Anything that already reads as a list item; such lines are never prose. */
const LIST_LIKE = /^\s*(?:[-*+\u2022\u25E6\u25AA\u00B7\u2013\u2014]|\d+[.)]|>)[ \t]/

/** A line that already carries an ATX heading marker. */
const ATX_LIKE = /^\s*#/

/** A thematic break or a setext underline: never part of a wrapped paragraph. */
const RULE_LINE = /^\s*[-=_*~]{3,}\s*$/

/** Dates and addresses ("January 5, 2024") are not hard-wrapped prose. */
const DIGIT_COMMA = /\d,/

/** Two trailing spaces are a deliberate Markdown hard break: never swallow one. */
const TRAILING_HARD_BREAK = / {2,}$/

/** Shortest line we will accept as evidence of hard wrapping. */
const MIN_WRAPPED_LENGTH = 40

/** A wrapped line must be at least this fraction of the run's longest line. */
const MIN_WRAPPED_RATIO = 0.6

/** How far a setext underline may differ in length from its heading. */
const SETEXT_SLACK = 3

/** Signs the document is already Markdown, so we must not offer to convert it. */
const MARKDOWN_SIGNS: RegExp[] = [
  /^ {0,3}#{1,6}(?:\s|$)/m,
  /^ {0,3}[-*+][ \t]/m,
  /^ {0,3}(?:```|~~~)/m,
  /\[[^\]\n]*\]\([^)\n]*\)/,
  /\*\*[^*\n]+\*\*/
]

function normaliseEol(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/**
 * True when the text carries essentially no Markdown syntax yet.
 * Anything already Markdown returns false, so we never offer to convert it twice.
 */
export function looksLikePlainText(text: string): boolean {
  try {
    if (typeof text !== 'string') return false
    const normalised = normaliseEol(text)
    for (const sign of MARKDOWN_SIGNS) {
      if (sign.test(normalised)) return false
    }
    return true
  } catch {
    return false
  }
}

function isBlank(line: string | undefined): boolean {
  return line === undefined || line.trim() === ''
}

/** True when the string contains at least one character that has a case. */
function hasCasedLetter(s: string): boolean {
  for (const ch of s) {
    if (ch.toLowerCase() !== ch.toUpperCase()) return true
  }
  return false
}

/**
 * Removes '[1]' style citation markers, but only when the document has two or
 * more of them: a single '[1]' is far more likely to be something the student
 * meant to keep. A Markdown link label such as '[1](https://...)' is never touched,
 * and a single space in front of the marker goes with it so sentences do not end
 * up with a double space.
 */
function stripCitations(text: string): { text: string; count: number } {
  const marker = / ?\[\d+\](?!\()/g
  const found = text.match(marker)
  if (!found || found.length < 2) return { text, count: 0 }
  return { text: text.replace(/ ?\[\d+\](?!\()/g, ''), count: found.length }
}

/**
 * Rewrites bullet characters to '- ', but only inside a run of two or more
 * CONSECUTIVE lines sharing the same marker. A lone '* shopping' line in the
 * middle of prose keeps its asterisk.
 */
function applyBullets(lines: string[]): number {
  const markers = lines.map((line) => {
    const m = BULLET_LINE.exec(line)
    return m ? m[2] : null
  })

  let changed = 0
  let i = 0
  while (i < lines.length) {
    const marker = markers[i]
    if (marker === null) {
      i += 1
      continue
    }
    let j = i + 1
    while (j < lines.length && markers[j] === marker) j += 1
    if (j - i >= 2) {
      for (let k = i; k < j; k += 1) {
        const m = BULLET_LINE.exec(lines[k])
        if (!m) continue
        lines[k] = `${m[1]}- ${m[3]}`
        changed += 1
      }
    }
    i = j
  }
  return changed
}

/**
 * Normalises '1)' to '1. ', again only inside a run of two or more consecutive
 * numbered lines. Lines that are already '1. ' are left alone and not counted.
 */
function applyNumbering(lines: string[]): number {
  const matches = lines.map((line) => NUMBER_LINE.exec(line))

  let changed = 0
  let i = 0
  while (i < lines.length) {
    if (matches[i] === null) {
      i += 1
      continue
    }
    let j = i + 1
    while (j < lines.length && matches[j] !== null) j += 1
    if (j - i >= 2) {
      for (let k = i; k < j; k += 1) {
        const m = matches[k]
        if (!m) continue
        const rewritten = `${m[1]}${m[2]}. ${m[4]}`
        if (rewritten !== lines[k]) {
          lines[k] = rewritten
          changed += 1
        }
      }
    }
    i = j
  }
  return changed
}

/**
 * A line that SHOUTS: entirely upper case, two to eight words, and not ending in
 * sentence punctuation. Being shouted is necessary but nowhere near sufficient -
 * see applyHeadings for the corroboration a line still needs.
 */
function isShoutedLine(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed === '') return false
  if (ATX_LIKE.test(line) || LIST_LIKE.test(line)) return false
  if (!hasCasedLetter(trimmed)) return false
  if (trimmed !== trimmed.toUpperCase()) return false

  const words = trimmed.split(/\s+/)
  if (words.length < 2 || words.length > 8) return false

  return !'.!?:;,'.includes(trimmed[trimmed.length - 1])
}

/**
 * True when line i+1 is a setext underline for line i: a run of '=' or '-' whose
 * length is within SETEXT_SLACK of the heading, with a blank line (or the end of
 * the document) after it. Requiring the blank line keeps "heading plus underline"
 * a self-contained block, which is what "a blank line before and after" means for
 * a setext heading.
 */
function hasSetextUnderline(lines: string[], i: number): boolean {
  const underline = lines[i + 1]
  if (underline === undefined) return false

  const u = underline.trim()
  if (!/^=+$/.test(u) && !/^-+$/.test(u)) return false
  if (Math.abs(u.length - lines[i].trim().length) > SETEXT_SLACK) return false

  return isBlank(lines[i + 2])
}

/**
 * Promotes shouted lines to '## '. A shouted line needs a blank line before it and
 * then corroboration: either the document has three or more such lines (so all-caps
 * is clearly this document's heading style), or the line carries a setext underline,
 * which is removed.
 */
function applyHeadings(lines: string[], counts: Counts): string[] {
  const candidates: number[] = []
  for (let i = 0; i < lines.length; i += 1) {
    if (!isShoutedLine(lines[i])) continue
    if (!isBlank(lines[i - 1])) continue
    if (!isBlank(lines[i + 1]) && !hasSetextUnderline(lines, i)) continue
    candidates.push(i)
  }

  const allCapsIsTheHouseStyle = candidates.length >= 3
  const promoted = new Set<number>()
  const underlines = new Set<number>()
  for (const i of candidates) {
    const setext = hasSetextUnderline(lines, i)
    if (!setext && !allCapsIsTheHouseStyle) continue
    promoted.add(i)
    if (setext) underlines.add(i + 1)
  }

  const out: string[] = []
  for (let i = 0; i < lines.length; i += 1) {
    if (underlines.has(i)) continue
    if (promoted.has(i)) {
      out.push(`## ${lines[i]}`)
      counts.headings += 1
    } else {
      out.push(lines[i])
    }
  }
  return out
}

/**
 * True when a run of non-blank lines has the tell-tale shape of a hard-wrapped
 * paragraph: every line but the last runs close to the full width, and nothing in
 * the run looks like a list, a heading, a rule, an address or a deliberate break.
 * A poem, an address block or a table of short lines fails on width alone.
 */
function isHardWrapped(run: string[]): boolean {
  let longest = 0
  for (const line of run) {
    const width = line.trim().length
    if (width > longest) longest = width
  }
  const minWidth = longest * MIN_WRAPPED_RATIO

  for (let k = 0; k < run.length; k += 1) {
    const line = run[k]
    if (LIST_LIKE.test(line)) return false
    if (ATX_LIKE.test(line)) return false
    if (RULE_LINE.test(line)) return false
    if (DIGIT_COMMA.test(line)) return false
    if (TRAILING_HARD_BREAK.test(line)) return false

    if (k === run.length - 1) continue
    const width = line.trim().length
    if (width < MIN_WRAPPED_LENGTH) return false
    if (width < minWidth) return false
  }
  return true
}

/** Joins a run into one line, keeping the first line's indent and every word. */
function joinRun(run: string[]): string {
  const parts = run.map((line, k) => {
    const withoutIndent = k === 0 ? line : line.replace(/^\s+/, '')
    return k === run.length - 1 ? withoutIndent : withoutIndent.replace(/\s+$/, '')
  })
  return parts.join(' ')
}

function applyUnwrap(lines: string[], counts: Counts): string[] {
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    if (isBlank(lines[i])) {
      out.push(lines[i])
      i += 1
      continue
    }

    let j = i
    while (j < lines.length && !isBlank(lines[j])) j += 1
    const run = lines.slice(i, j)

    if (run.length >= 2 && isHardWrapped(run)) {
      out.push(joinRun(run))
      counts.unwrap += 1
    } else {
      for (const line of run) out.push(line)
    }
    i = j
  }
  return out
}

function convert(normalised: string): ConversionResult {
  const counts: Counts = { bullets: 0, numbering: 0, headings: 0, unwrap: 0, citations: 0 }

  // Citations first: removing them before the width heuristics means the unwrap
  // rule measures the prose the student actually wrote.
  const cleaned = stripCitations(normalised)
  counts.citations = cleaned.count

  const lines = cleaned.text.split('\n')
  counts.bullets = applyBullets(lines)
  counts.numbering = applyNumbering(lines)

  // Headings before unwrap so a promoted heading is never folded into its paragraph.
  const withHeadings = applyHeadings(lines, counts)
  const unwrapped = applyUnwrap(withHeadings, counts)

  const changes: ConversionChange[] = []
  for (const rule of RULE_ORDER) {
    if (counts[rule] > 0) changes.push({ rule, count: counts[rule] })
  }

  return { markdown: unwrapped.join('\n'), changes }
}

/**
 * Converts plain text to Markdown, conservatively. Never throws: if anything at all
 * goes wrong the student gets their own text back, unchanged apart from line endings.
 */
export function convertTextToMarkdown(text: string): ConversionResult {
  if (typeof text !== 'string') return { markdown: '', changes: [] }

  let normalised = text
  try {
    normalised = normaliseEol(text)
    return convert(normalised)
  } catch {
    return { markdown: normalised, changes: [] }
  }
}
