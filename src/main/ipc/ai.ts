/**
 * Bring-your-own-AI detection and prompting for the main process.
 *
 * Students never pay us and never see a stack trace, so:
 *  - every exported function catches everything and returns a plain-language result
 *  - stderr from a CLI is never shown to the student, only mapped to a friendly line
 *  - all process/network access goes through an injected `Runner`, so this file can be
 *    unit tested in plain Node with no Electron and no real child processes
 *
 * Detection order is fixed: the `claude` CLI, then a local Ollama, then an API key.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import type { AiProviderStatus } from '../../shared/types'

/** Everything this module needs from the outside world. Injected so tests can fake it. */
export interface Runner {
  /** Absolute path of a command on PATH, or null when it is not there. */
  which(command: string): Promise<string | null>
  /**
   * Runs a command to completion. Never rejects for a non-zero exit - that is reported
   * as `code`. `opts.input` is written to stdin and stdin is then closed, so a CLI that
   * waits for more input cannot hang the app.
   */
  exec(
    file: string,
    args: string[],
    opts: { input?: string; timeoutMs: number; cwd?: string }
  ): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }>
  /** GET a URL and parse JSON. Rejects on a network error or a non-2xx status. */
  fetchJson(url: string, timeoutMs: number): Promise<unknown>
  /** The PATH a login shell would have. GUI-launched apps on macOS do not inherit it. */
  loginShellPath(): Promise<string | null>
}

export const DEFAULT_TIMEOUT_MS = 120_000
const VERSION_TIMEOUT_MS = 8_000
const OLLAMA_TAGS_URL = 'http://127.0.0.1:11434/api/tags'
const OLLAMA_TIMEOUT_MS = 4_000
const DEFAULT_OLLAMA_MODEL = 'llama3.2'
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const DEFAULT_API_MODEL = 'claude-opus-5'
/** A very long PATH should not turn detection into a hundred spawns. */
const MAX_PATH_PROBES = 32

/** Every sentence a student can ever see from this module. */
const MSG = {
  none: 'No AI is set up yet. You can install Claude Code, run Ollama, or paste an API key in Settings.',
  noProvider: 'No AI is set up yet. Open Settings to connect one.',
  timeout: 'The AI took too long to answer. Try again, or try a shorter note.',
  signIn:
    'Claude Code is installed but not signed in. Open a terminal, run claude once, then try again.',
  unreachable: 'The AI could not be reached. Check Settings to see which provider is set up.',
  badKey: 'That API key was rejected. Check it in Settings.',
  busy: 'The AI service is busy right now. Try again in a moment.',
  needKey: 'No API key saved yet. Paste one in Settings and try again.',
  empty: 'The AI sent back an empty answer. Try again.'
} as const

/** Status plus the bits runPrompt needs. The extra keys are invisible to AiProviderStatus. */
type ResolvedStatus = AiProviderStatus & { path?: string; model?: string }

const NONE: AiProviderStatus = { available: false, kind: 'none', detail: MSG.none }

const fail = (message: string): { ok: false; message: string } => ({ ok: false, message })

/* ------------------------------------------------------------------ default runner */

type FetchLike = (
  url: string,
  init?: Record<string, unknown>
) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
}>

function getFetch(): FetchLike | null {
  const f = (globalThis as unknown as { fetch?: FetchLike }).fetch
  return typeof f === 'function' ? f : null
}

/** Spawns a command, feeds it stdin, closes stdin, and always resolves. */
async function spawnOnce(
  file: string,
  args: string[],
  opts: { input?: string; timeoutMs: number; cwd?: string }
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let done = false
    const finish = (code: number): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    }
    // .cmd/.bat shims on Windows are not executables, so they need a shell.
    const viaShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(file)
    let child: ChildProcess
    try {
      child = spawn(viaShell ? `"${file}"` : file, args, {
        cwd: opts.cwd,
        windowsHide: true,
        shell: viaShell
      })
    } catch {
      return resolve({ code: -1, stdout: '', stderr: '', timedOut: false })
    }
    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill()
      } catch {
        /* already gone */
      }
      finish(-1)
    }, Math.max(1, opts.timeoutMs))
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', () => finish(-1))
    child.on('close', (code) => finish(typeof code === 'number' ? code : -1))
    child.stdin?.on('error', () => {
      /* the CLI closed stdin first - nothing to do */
    })
    try {
      child.stdin?.end(opts.input ?? '')
    } catch {
      /* stdin already closed */
    }
  })
}

/** The real Runner. Never exercised by unit tests - every test injects a fake. */
export function createDefaultRunner(): Runner {
  return {
    async which(command) {
      const finder = process.platform === 'win32' ? 'where' : 'which'
      const r = await spawnOnce(finder, [command], { input: '', timeoutMs: VERSION_TIMEOUT_MS })
      if (r.code !== 0) return null
      const first = r.stdout.split(/\r?\n/).find((line) => line.trim().length > 0)
      return first ? first.trim() : null
    },

    exec(file, args, opts) {
      return spawnOnce(file, args, opts)
    },

    async fetchJson(url, timeoutMs) {
      const doFetch = getFetch()
      if (!doFetch) throw new Error('no fetch')
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs))
      try {
        const res = await doFetch(url, { method: 'GET', signal: controller.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return await res.json()
      } finally {
        clearTimeout(timer)
      }
    },

    async loginShellPath() {
      if (process.platform === 'win32') return process.env.PATH ?? null
      const shell = process.env.SHELL || '/bin/zsh'
      const r = await spawnOnce(shell, ['-lic', 'printf %s "$PATH"'], {
        input: '',
        timeoutMs: VERSION_TIMEOUT_MS
      })
      const out = r.stdout.trim()
      return r.code === 0 && out.length > 0 ? out : null
    }
  }
}

/* ------------------------------------------------------------------- detection */

/** Trailing slashes off, so we never build `/usr/bin//claude`. */
const trimSlash = (p: string): string => p.replace(/[\\/]+$/, '')

/**
 * Where a claude CLI can hide from a GUI-launched app: everything on the login
 * shell's PATH first, then the four places the installers actually use.
 */
export function claudeCandidates(loginShellPath: string | null): string[] {
  const out: string[] = []
  const push = (p: string): void => {
    if (p && !out.includes(p)) out.push(p)
  }
  if (loginShellPath && loginShellPath.trim().length > 0) {
    const sep = loginShellPath.includes(';') ? ';' : ':'
    for (const dir of loginShellPath.split(sep).slice(0, MAX_PATH_PROBES)) {
      const clean = trimSlash(dir.trim())
      if (clean.length > 0) push(`${clean}/claude`)
    }
  }
  const home = process.env.HOME || process.env.USERPROFILE
  if (home) push(`${trimSlash(home)}/.local/bin/claude`)
  push('/opt/homebrew/bin/claude')
  push('/usr/local/bin/claude')
  const appData = process.env.APPDATA
  if (appData) push(`${trimSlash(appData)}/npm/claude.cmd`)
  return out
}

/** True when `<file> --version` runs and exits 0. Swallows every failure. */
async function versionOk(runner: Runner, file: string): Promise<boolean> {
  try {
    const r = await runner.exec(file, ['--version'], { input: '', timeoutMs: VERSION_TIMEOUT_MS })
    return !!r && r.code === 0 && !r.timedOut
  } catch {
    return false
  }
}

async function findClaude(runner: Runner, explicit?: string): Promise<string | null> {
  const chosen = (explicit ?? '').trim()
  // A path the student typed in Settings always wins and is used exactly as written.
  if (chosen.length > 0) return (await versionOk(runner, chosen)) ? chosen : null

  let onPath: string | null = null
  try {
    onPath = await runner.which('claude')
  } catch {
    onPath = null
  }
  if (onPath && onPath.trim().length > 0 && (await versionOk(runner, onPath.trim()))) {
    return onPath.trim()
  }

  let loginPath: string | null = null
  try {
    loginPath = await runner.loginShellPath()
  } catch {
    loginPath = null
  }
  for (const candidate of claudeCandidates(loginPath)) {
    if (await versionOk(runner, candidate)) return candidate
  }
  return null
}

/** Name of the first installed Ollama model, or null when Ollama is absent or empty. */
async function findOllama(runner: Runner): Promise<string | null> {
  try {
    const data = await runner.fetchJson(OLLAMA_TAGS_URL, OLLAMA_TIMEOUT_MS)
    const models = (data as { models?: unknown } | null)?.models
    if (!Array.isArray(models) || models.length === 0) return null
    const first = models[0] as { name?: unknown; model?: unknown } | null
    if (first && typeof first.name === 'string' && first.name.length > 0) return first.name
    if (first && typeof first.model === 'string' && first.model.length > 0) return first.model
    return DEFAULT_OLLAMA_MODEL
  } catch {
    return null
  }
}

export async function detectProvider(
  runner: Runner,
  opts: { claudePath?: string; apiKey?: string } = {}
): Promise<AiProviderStatus> {
  try {
    const claude = await findClaude(runner, opts.claudePath)
    if (claude) {
      const status: ResolvedStatus = {
        available: true,
        kind: 'claude',
        detail: `Using Claude Code on this computer (${claude}).`,
        path: claude
      }
      return status
    }

    const model = await findOllama(runner)
    if (model) {
      const status: ResolvedStatus = {
        available: true,
        kind: 'ollama',
        detail: `Using Ollama on this computer (model ${model}).`,
        model
      }
      return status
    }

    if ((opts.apiKey ?? '').trim().length > 0) {
      return { available: true, kind: 'apiKey', detail: 'Using your Anthropic API key.' }
    }
    return NONE
  } catch {
    return NONE
  }
}

/* --------------------------------------------------------------------- prompting */

function buildPrompt(prompt: string, text: string): string {
  const p = typeof prompt === 'string' ? prompt.trim() : ''
  const t = typeof text === 'string' ? text : ''
  return `${p}\n\nReply with the finished Markdown only. No explanation, no code fence.\n\n---\n\n${t}\n`
}

/** The CLI is installed but the student never signed in. */
function looksUnauthenticated(output: string): boolean {
  const low = output.toLowerCase()
  return (
    low.includes('not logged in') ||
    low.includes('unauthorized') ||
    low.includes('authentication') ||
    low.includes('/login')
  )
}

function isAbort(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name
  return name === 'AbortError' || name === 'TimeoutError'
}

/** Pulls the plain text out of an Anthropic Messages API reply. */
function collectApiText(body: unknown): string {
  const content = (body as { content?: unknown } | null)?.content
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const block of content) {
    const b = block as { type?: unknown; text?: unknown } | null
    if (b && b.type === 'text' && typeof b.text === 'string') out += b.text
  }
  return out
}

async function runViaApiKey(
  full: string,
  apiKey: string,
  model: string,
  timeoutMs: number
): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  const doFetch = getFetch()
  if (!doFetch) return fail(MSG.unreachable)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs))
  try {
    const res = await doFetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        messages: [{ role: 'user', content: full }]
      }),
      signal: controller.signal
    })
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) return fail(MSG.badKey)
      if (res.status === 429 || res.status === 529) return fail(MSG.busy)
      return fail(MSG.unreachable)
    }
    const cleaned = cleanModelOutput(collectApiText(await res.json()))
    return cleaned.length > 0 ? { ok: true, text: cleaned } : fail(MSG.empty)
  } catch (err) {
    return fail(isAbort(err) ? MSG.timeout : MSG.unreachable)
  } finally {
    clearTimeout(timer)
  }
}

export async function runPrompt(
  runner: Runner,
  status: AiProviderStatus,
  prompt: string,
  text: string,
  opts: { apiKey?: string; model?: string; timeoutMs?: number } = {}
): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  try {
    if (!status || !status.available || status.kind === 'none') return fail(MSG.noProvider)
    const timeoutMs =
      typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS
    const full = buildPrompt(prompt, text)

    if (status.kind === 'apiKey') {
      const key = (opts.apiKey ?? '').trim()
      if (key.length === 0) return fail(MSG.needKey)
      return await runViaApiKey(full, key, opts.model ?? DEFAULT_API_MODEL, timeoutMs)
    }

    const hint = status as ResolvedStatus
    const isClaude = status.kind === 'claude'
    const file = isClaude ? (hint.path ?? 'claude') : 'ollama'
    // The whole prompt goes down stdin, which the runner then closes: a note can be
    // far longer than a command line is allowed to be on Windows.
    const args = isClaude ? ['-p'] : ['run', opts.model ?? hint.model ?? DEFAULT_OLLAMA_MODEL]
    const r = await runner.exec(file, args, { input: full, timeoutMs })

    if (!r) return fail(MSG.unreachable)
    if (r.timedOut) return fail(MSG.timeout)
    if (r.code !== 0) {
      const said = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
      if (isClaude && looksUnauthenticated(said)) return fail(MSG.signIn)
      return fail(MSG.unreachable)
    }
    const cleaned = cleanModelOutput(r.stdout ?? '')
    return cleaned.length > 0 ? { ok: true, text: cleaned } : fail(MSG.empty)
  } catch {
    return fail(MSG.unreachable)
  }
}

/* ---------------------------------------------------------------- output cleanup */

/** A whole line that is nothing but a fence, e.g. "```" or "~~~markdown". */
const FENCE_LINE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*([A-Za-z0-9_+#.-]*)[ \t]*$/
/** Openers of the "Sure! Here you go:" sentence models like to add. */
const CHATTY_OPENER =
  /^(sure|certainly|absolutely|of course|okay|ok|got it|no problem|here|here's|here is|here are|below|this is|i've|i have|i'll|i will)\b/i

function dropLeadingBlanks(lines: string[]): string[] {
  let i = 0
  while (i < lines.length && lines[i].trim().length === 0) i++
  return lines.slice(i)
}

function isChattyLine(line: string | undefined): boolean {
  if (typeof line !== 'string') return false
  const t = line.trim()
  // A real note line rarely ends in a colon AND opens with a conversational word.
  return t.length > 0 && t.length <= 160 && t.endsWith(':') && CHATTY_OPENER.test(t)
}

/**
 * Removes one fence that wraps the whole answer. Returns null - leaving the text
 * untouched - unless the very first line opens a fence whose matching close is the
 * very last line, so fences that are genuine content survive.
 */
function unwrapFence(lines: string[]): string[] | null {
  const open = FENCE_LINE.exec(lines[0] ?? '')
  if (!open) return null
  let last = lines.length - 1
  while (last > 0 && lines[last].trim().length === 0) last--
  if (last < 1) return null

  const marker = open[1]
  /** A fence line closes `opener` when it is the same character, no shorter, untagged. */
  const closes = (fence: string, tag: string, opener: string): boolean =>
    fence[0] === opener[0] && fence.length >= opener.length && tag.length === 0
  let inner: string | null = null
  let closeAt = -1
  for (let i = 1; i <= last; i++) {
    const m = FENCE_LINE.exec(lines[i])
    if (!m) continue
    if (inner) {
      if (closes(m[1], m[2], inner)) inner = null
      continue
    }
    if (closes(m[1], m[2], marker)) {
      closeAt = i
      break
    }
    inner = m[1]
  }
  return closeAt === last ? lines.slice(1, last) : null
}

/**
 * Undoes the two things models do to Markdown they were asked to return raw:
 * wrapping it in a code fence, and prefixing a chatty line. Trailing whitespace
 * collapses to exactly one newline. Never throws.
 */
export function cleanModelOutput(raw: string): string {
  try {
    if (typeof raw !== 'string' || raw.length === 0) return ''
    let lines = dropLeadingBlanks(raw.replace(/\r\n?/g, '\n').split('\n'))

    let droppedChatty = false
    if (isChattyLine(lines[0])) {
      lines = dropLeadingBlanks(lines.slice(1))
      droppedChatty = true
    }

    const unwrapped = unwrapFence(lines)
    if (unwrapped) {
      lines = dropLeadingBlanks(unwrapped)
      if (!droppedChatty && isChattyLine(lines[0])) lines = dropLeadingBlanks(lines.slice(1))
    }

    const body = lines.join('\n').replace(/\s+$/, '')
    return body.length === 0 ? '' : `${body}\n`
  } catch {
    return ''
  }
}
