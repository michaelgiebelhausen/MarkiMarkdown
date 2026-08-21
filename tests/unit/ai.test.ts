import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  createDefaultRunner,
  detectProvider,
  runPrompt,
  cleanModelOutput,
  type Runner
} from '../../src/main/ipc/ai'
import type { AiProviderStatus } from '../../src/shared/types'

type ExecResult = { code: number; stdout: string; stderr: string; timedOut: boolean }
type ExecOpts = { input?: string; timeoutMs: number; cwd?: string }
type ExecCall = { file: string; args: string[]; opts: ExecOpts }

const FAIL: ExecResult = { code: 1, stdout: '', stderr: 'not found', timedOut: false }
const OK = (stdout: string): ExecResult => ({ code: 0, stdout, stderr: '', timedOut: false })

interface FakeConfig {
  which?: (cmd: string) => Promise<string | null>
  exec?: (file: string, args: string[]) => ExecResult | Promise<ExecResult>
  fetchJson?: (url: string) => unknown
  loginShellPath?: () => Promise<string | null>
}

function makeRunner(cfg: FakeConfig = {}) {
  const execCalls: ExecCall[] = []
  const whichCalls: string[] = []
  const fetchCalls: string[] = []
  const runner: Runner = {
    async which(command) {
      whichCalls.push(command)
      return cfg.which ? cfg.which(command) : null
    },
    async exec(file, args, opts) {
      execCalls.push({ file, args, opts })
      return cfg.exec ? cfg.exec(file, args) : FAIL
    },
    async fetchJson(url) {
      fetchCalls.push(url)
      if (!cfg.fetchJson) throw new Error('ECONNREFUSED 127.0.0.1:11434')
      return cfg.fetchJson(url)
    },
    async loginShellPath() {
      return cfg.loginShellPath ? cfg.loginShellPath() : null
    }
  }
  return { runner, execCalls, whichCalls, fetchCalls }
}

/** Only this exact path answers `--version`; everything else looks missing. */
const onlyAt =
  (wanted: string) =>
  (file: string): ExecResult =>
    file === wanted ? OK('1.0.0 (Claude Code)') : FAIL

const claudeStatus = (extra: Record<string, unknown> = {}): AiProviderStatus =>
  ({ available: true, kind: 'claude', detail: 'ready', ...extra }) as AiProviderStatus

describe('detectProvider', () => {
  const savedHome = process.env.HOME
  const savedAppData = process.env.APPDATA

  beforeEach(() => {
    process.env.HOME = '/home/stu'
    process.env.APPDATA = 'C:/Roam'
  })

  afterEach(() => {
    if (savedHome === undefined) delete process.env.HOME
    else process.env.HOME = savedHome
    if (savedAppData === undefined) delete process.env.APPDATA
    else process.env.APPDATA = savedAppData
  })

  test('finds claude when which resolves a path and --version exits 0', async () => {
    const { runner, execCalls, whichCalls } = makeRunner({
      which: async () => '/usr/bin/claude',
      exec: onlyAt('/usr/bin/claude')
    })
    const status = await detectProvider(runner)
    expect(status.available).toBe(true)
    expect(status.kind).toBe('claude')
    expect(status.detail.length).toBeGreaterThan(0)
    expect(whichCalls).toContain('claude')
    expect(execCalls[0].file).toBe('/usr/bin/claude')
    expect(execCalls[0].args).toEqual(['--version'])
  })

  test('an explicit claudePath wins and is used verbatim', async () => {
    const custom = 'C:/Program Files/claude/claude.cmd'
    const { runner, execCalls, whichCalls } = makeRunner({
      which: async () => '/usr/bin/claude',
      exec: onlyAt(custom)
    })
    const status = await detectProvider(runner, { claudePath: custom })
    expect(status.kind).toBe('claude')
    expect(status.available).toBe(true)
    expect(execCalls[0].file).toBe(custom)
    expect(whichCalls).toEqual([])
  })

  test('finds a claude that only the login shell PATH knows about', async () => {
    const { runner, execCalls } = makeRunner({
      which: async () => null,
      loginShellPath: async () => '/opt/homebrew/bin:/usr/bin',
      exec: onlyAt('/opt/homebrew/bin/claude')
    })
    const status = await detectProvider(runner)
    expect(status.kind).toBe('claude')
    expect(status.available).toBe(true)
    expect(execCalls.some((c) => c.file === '/opt/homebrew/bin/claude')).toBe(true)
  })

  test('tries $HOME/.local/bin/claude when which and the login shell find nothing', async () => {
    const { runner, execCalls } = makeRunner({
      which: async () => null,
      loginShellPath: async () => null,
      exec: onlyAt('/home/stu/.local/bin/claude')
    })
    const status = await detectProvider(runner)
    expect(status.kind).toBe('claude')
    expect(execCalls.some((c) => c.file === '/home/stu/.local/bin/claude')).toBe(true)
  })

  test('tries the Windows npm shim %APPDATA%/npm/claude.cmd', async () => {
    const { runner, execCalls } = makeRunner({
      which: async () => null,
      exec: onlyAt('C:/Roam/npm/claude.cmd')
    })
    const status = await detectProvider(runner)
    expect(status.kind).toBe('claude')
    expect(execCalls.some((c) => c.file === 'C:/Roam/npm/claude.cmd')).toBe(true)
  })

  test('a claude on PATH that cannot run is not reported as available', async () => {
    const { runner } = makeRunner({ which: async () => '/usr/bin/claude', exec: () => FAIL })
    const status = await detectProvider(runner)
    expect(status.kind).toBe('none')
    expect(status.available).toBe(false)
  })
})

describe('detectProvider fallbacks', () => {
  test('falls back to a local Ollama that has at least one model', async () => {
    const { runner, fetchCalls } = makeRunner({
      exec: () => FAIL,
      fetchJson: () => ({ models: [{ name: 'llama3.2:3b' }, { name: 'qwen2.5' }] })
    })
    const status = await detectProvider(runner)
    expect(status.available).toBe(true)
    expect(status.kind).toBe('ollama')
    expect(fetchCalls).toContain('http://127.0.0.1:11434/api/tags')
    expect(status.detail).toContain('llama3.2:3b')
  })

  test('an Ollama with zero models is not available', async () => {
    const { runner } = makeRunner({ exec: () => FAIL, fetchJson: () => ({ models: [] }) })
    const status = await detectProvider(runner)
    expect(status.kind).toBe('none')
    expect(status.available).toBe(false)
  })

  test('falls back to an API key when nothing else is installed', async () => {
    const { runner } = makeRunner({ exec: () => FAIL })
    const status = await detectProvider(runner, { apiKey: 'sk-ant-test' })
    expect(status.available).toBe(true)
    expect(status.kind).toBe('apiKey')
  })

  test('a blank API key does not count as a provider', async () => {
    const { runner } = makeRunner({ exec: () => FAIL })
    const status = await detectProvider(runner, { apiKey: '   ' })
    expect(status.kind).toBe('none')
  })

  test('claude is preferred over Ollama and over an API key', async () => {
    const { runner } = makeRunner({
      which: async () => '/usr/bin/claude',
      exec: onlyAt('/usr/bin/claude'),
      fetchJson: () => ({ models: [{ name: 'llama3.2' }] })
    })
    const status = await detectProvider(runner, { apiKey: 'sk-ant-test' })
    expect(status.kind).toBe('claude')
  })

  test('Ollama is preferred over an API key', async () => {
    const { runner } = makeRunner({
      exec: () => FAIL,
      fetchJson: () => ({ models: [{ name: 'llama3.2' }] })
    })
    const status = await detectProvider(runner, { apiKey: 'sk-ant-test' })
    expect(status.kind).toBe('ollama')
  })

  test('reports a friendly none when nothing is set up', async () => {
    const { runner } = makeRunner({ exec: () => FAIL })
    const status = await detectProvider(runner)
    expect(status).toMatchObject({ available: false, kind: 'none' })
    expect(status.detail.length).toBeGreaterThan(10)
    expect(status.detail).not.toMatch(/error|stack|ENOENT|undefined/i)
  })

  test('never throws even when every runner method rejects', async () => {
    const runner: Runner = {
      which: async () => {
        throw new Error('which exploded')
      },
      exec: async () => {
        throw new Error('spawn EACCES')
      },
      fetchJson: async () => {
        throw new Error('ECONNREFUSED')
      },
      loginShellPath: async () => {
        throw new Error('no shell')
      }
    }
    const status = await detectProvider(runner, { claudePath: 'C:/nope/claude.cmd' })
    expect(status).toMatchObject({ available: false, kind: 'none' })
    expect(status.detail).not.toContain('EACCES')
  })
})

describe('runPrompt with the claude CLI', () => {
  test('returns the cleaned answer when claude succeeds', async () => {
    const { runner, execCalls } = makeRunner({ exec: () => OK('```md\n# Tidy note\n```\n\n\n') })
    const r = await runPrompt(runner, claudeStatus(), 'Tidy this up', '# messy')
    expect(r).toEqual({ ok: true, text: '# Tidy note\n' })
    expect(execCalls).toHaveLength(1)
  })

  test('closes stdin and passes the default 120000 ms timeout', async () => {
    const { runner, execCalls } = makeRunner({ exec: () => OK('done') })
    await runPrompt(runner, claudeStatus(), 'Tidy this up', 'the note body')
    expect(typeof execCalls[0].opts.input).toBe('string')
    expect(execCalls[0].opts.input).toContain('the note body')
    expect(execCalls[0].opts.timeoutMs).toBe(120000)
  })

  test('honours an explicit timeout', async () => {
    const { runner, execCalls } = makeRunner({ exec: () => OK('done') })
    await runPrompt(runner, claudeStatus(), 'p', 't', { timeoutMs: 5000 })
    expect(execCalls[0].opts.timeoutMs).toBe(5000)
  })

  test('uses the claude path that detection resolved', async () => {
    const detectRunner = makeRunner({
      which: async () => null,
      loginShellPath: async () => '/opt/homebrew/bin',
      exec: onlyAt('/opt/homebrew/bin/claude')
    })
    const status = await detectProvider(detectRunner.runner)
    const { runner, execCalls } = makeRunner({ exec: () => OK('hi') })
    await runPrompt(runner, status, 'p', 't')
    expect(execCalls[0].file).toBe('/opt/homebrew/bin/claude')
  })

  test('maps a timeout to plain language', async () => {
    const { runner } = makeRunner({
      exec: () => ({ code: 1, stdout: '', stderr: 'killed', timedOut: true })
    })
    const r = await runPrompt(runner, claudeStatus(), 'p', 't')
    expect(r).toEqual({
      ok: false,
      message: 'The AI took too long to answer. Try again, or try a shorter note.'
    })
  })

  test('maps "not logged in" to sign-in advice without leaking stderr', async () => {
    const { runner } = makeRunner({
      exec: () => ({
        code: 1,
        stdout: '',
        stderr: 'Error: not logged in\n    at Object.<anonymous> (/opt/claude/cli.js:12:9)',
        timedOut: false
      })
    })
    const r = await runPrompt(runner, claudeStatus(), 'p', 't')
    expect(r).toEqual({
      ok: false,
      message:
        'Claude Code is installed but not signed in. Open a terminal, run claude once, then try again.'
    })
    expect(r.ok === false && r.message).not.toContain('cli.js')
  })

  test('maps "unauthorized" to sign-in advice', async () => {
    const { runner } = makeRunner({
      exec: () => ({ code: 1, stdout: '', stderr: 'UNAUTHORIZED', timedOut: false })
    })
    const r = await runPrompt(runner, claudeStatus(), 'p', 't')
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.message).toContain('not signed in')
  })

  test('maps "authentication" seen on stdout to sign-in advice', async () => {
    const { runner } = makeRunner({
      exec: () => ({ code: 2, stdout: 'Authentication required', stderr: '', timedOut: false })
    })
    const r = await runPrompt(runner, claudeStatus(), 'p', 't')
    expect(r.ok === false && r.message).toContain('not signed in')
  })

  test('maps any other non-zero exit to a check-Settings message', async () => {
    const { runner } = makeRunner({
      exec: () => ({ code: 127, stdout: '', stderr: 'EPIPE at socket.js:88', timedOut: false })
    })
    const r = await runPrompt(runner, claudeStatus(), 'p', 't')
    expect(r).toEqual({
      ok: false,
      message: 'The AI could not be reached. Check Settings to see which provider is set up.'
    })
  })

  test('never throws when the runner itself rejects', async () => {
    const { runner } = makeRunner({
      exec: () => {
        throw new Error('spawn ENOENT C:/claude.cmd')
      }
    })
    const r = await runPrompt(runner, claudeStatus(), 'p', 't')
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.message).not.toContain('ENOENT')
  })

  test('refuses politely when no provider is set up', async () => {
    const { runner, execCalls } = makeRunner({})
    const r = await runPrompt(
      runner,
      { available: false, kind: 'none', detail: 'nothing found' },
      'p',
      't'
    )
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.message.length).toBeGreaterThan(10)
    expect(execCalls).toEqual([])
  })

  test('treats an empty answer as a failure rather than wiping the note', async () => {
    const { runner } = makeRunner({ exec: () => OK('   \n\n') })
    const r = await runPrompt(runner, claudeStatus(), 'p', 't')
    expect(r.ok).toBe(false)
  })
})

describe('runPrompt with Ollama', () => {
  test('runs the ollama CLI with the chosen model and the note on stdin', async () => {
    const { runner, execCalls } = makeRunner({ exec: () => OK('tidy') })
    const status: AiProviderStatus = { available: true, kind: 'ollama', detail: 'ready' }
    const r = await runPrompt(runner, status, 'Tidy this', 'my note', { model: 'llama3.2:3b' })
    expect(r).toEqual({ ok: true, text: 'tidy\n' })
    expect(execCalls[0].file).toBe('ollama')
    expect(execCalls[0].args).toEqual(['run', 'llama3.2:3b'])
    expect(execCalls[0].opts.input).toContain('my note')
  })

  test('maps an ollama failure to plain language', async () => {
    const { runner } = makeRunner({
      exec: () => ({ code: 1, stdout: '', stderr: 'model not found', timedOut: false })
    })
    const status: AiProviderStatus = { available: true, kind: 'ollama', detail: 'ready' }
    const r = await runPrompt(runner, status, 'p', 't')
    expect(r).toEqual({
      ok: false,
      message: 'The AI could not be reached. Check Settings to see which provider is set up.'
    })
  })
})

describe('runPrompt with an API key', () => {
  const realFetch = globalThis.fetch
  const apiStatus: AiProviderStatus = { available: true, kind: 'apiKey', detail: 'ready' }
  let seen: { url: string; init: Record<string, unknown> }[] = []

  function stubFetch(reply: { ok: boolean; status: number; body?: unknown }) {
    seen = []
    ;(globalThis as unknown as { fetch: unknown }).fetch = async (
      url: string,
      init: Record<string, unknown>
    ) => {
      seen.push({ url, init })
      return {
        ok: reply.ok,
        status: reply.status,
        async json() {
          return reply.body ?? {}
        },
        async text() {
          return JSON.stringify(reply.body ?? {})
        }
      }
    }
  }

  afterEach(() => {
    ;(globalThis as unknown as { fetch: unknown }).fetch = realFetch
  })

  test('returns the cleaned answer on success', async () => {
    stubFetch({
      ok: true,
      status: 200,
      body: { content: [{ type: 'text', text: 'Sure! Here you go:\n\n# Tidy\n\n\n' }] }
    })
    const r = await runPrompt(makeRunner().runner, apiStatus, 'p', 't', { apiKey: 'sk-ant-test' })
    expect(r).toEqual({ ok: true, text: '# Tidy\n' })
    expect(seen).toHaveLength(1)
  })

  test('maps 401 to a rejected-key message', async () => {
    stubFetch({ ok: false, status: 401, body: { error: { message: 'invalid x-api-key' } } })
    const r = await runPrompt(makeRunner().runner, apiStatus, 'p', 't', { apiKey: 'bad' })
    expect(r).toEqual({ ok: false, message: 'That API key was rejected. Check it in Settings.' })
  })

  test('maps 403 to a rejected-key message', async () => {
    stubFetch({ ok: false, status: 403, body: {} })
    const r = await runPrompt(makeRunner().runner, apiStatus, 'p', 't', { apiKey: 'bad' })
    expect(r).toEqual({ ok: false, message: 'That API key was rejected. Check it in Settings.' })
  })

  test('maps 429 to a busy message', async () => {
    stubFetch({ ok: false, status: 429, body: {} })
    const r = await runPrompt(makeRunner().runner, apiStatus, 'p', 't', { apiKey: 'sk-ant-test' })
    expect(r).toEqual({ ok: false, message: 'The AI service is busy right now. Try again in a moment.' })
  })

  test('maps 529 to a busy message', async () => {
    stubFetch({ ok: false, status: 529, body: {} })
    const r = await runPrompt(makeRunner().runner, apiStatus, 'p', 't', { apiKey: 'sk-ant-test' })
    expect(r).toEqual({ ok: false, message: 'The AI service is busy right now. Try again in a moment.' })
  })

  test('maps any other HTTP failure to a check-Settings message and leaks nothing', async () => {
    stubFetch({ ok: false, status: 500, body: { error: { message: 'internal trace at foo.js:1' } } })
    const r = await runPrompt(makeRunner().runner, apiStatus, 'p', 't', { apiKey: 'sk-ant-test' })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.message).not.toContain('foo.js')
  })

  test('asks for the key when the provider is apiKey but no key was passed', async () => {
    stubFetch({ ok: true, status: 200, body: { content: [{ type: 'text', text: 'hi' }] } })
    const r = await runPrompt(makeRunner().runner, apiStatus, 'p', 't')
    expect(r.ok).toBe(false)
    expect(seen).toEqual([])
  })
})

describe('cleanModelOutput', () => {
  test('strips one wrapping fence that carries a language tag', () => {
    expect(cleanModelOutput('```markdown\n# Hi\n\nBody.\n```')).toBe('# Hi\n\nBody.\n')
  })

  test('strips one wrapping fence with no language tag', () => {
    expect(cleanModelOutput('```\n# Hi\n```\n')).toBe('# Hi\n')
  })

  test('leaves fences that are genuine content in the middle alone', () => {
    const src = 'Run this:\n\n```js\nconsole.log(1)\n```\n\nThen stop.\n'
    expect(cleanModelOutput(src)).toBe(src)
  })

  test('leaves the note alone when only the opening fence is present', () => {
    expect(cleanModelOutput('```md\n# Hi\n')).toBe('```md\n# Hi\n')
  })

  test('leaves the note alone when only the closing fence is present', () => {
    expect(cleanModelOutput('# Hi\n```\n')).toBe('# Hi\n```\n')
  })

  test('does not merge two separate code blocks that top and tail the note', () => {
    const src = '```sh\nnpm i\n```\n\nmiddle\n\n```sh\nnpm test\n```\n'
    expect(cleanModelOutput(src)).toBe(src)
  })

  test('strips a leading "Here is..." line', () => {
    expect(cleanModelOutput('Here is the cleaned up version:\n\n# Notes\n')).toBe('# Notes\n')
  })

  test('strips a leading "Sure! Here you go:" line', () => {
    expect(cleanModelOutput('Sure! Here you go:\n# Notes\n')).toBe('# Notes\n')
  })

  test('strips a conversational line and the fence under it', () => {
    const src = 'Here is the cleaned up version:\n\n```markdown\n# Notes\n\n- one\n```\n'
    expect(cleanModelOutput(src)).toBe('# Notes\n\n- one\n')
  })

  test('strips only one conversational line', () => {
    const src = 'Here you go:\nHere is another line:\n# Notes\n'
    expect(cleanModelOutput(src)).toBe('Here is another line:\n# Notes\n')
  })

  test('keeps a real first line that merely ends in a colon', () => {
    expect(cleanModelOutput('Ingredients:\n\n- salt\n')).toBe('Ingredients:\n\n- salt\n')
  })

  test('keeps a heading as the first line', () => {
    expect(cleanModelOutput('# Week 3: photosynthesis\n\nBody.\n')).toBe(
      '# Week 3: photosynthesis\n\nBody.\n'
    )
  })

  test('trims trailing whitespace down to exactly one newline', () => {
    expect(cleanModelOutput('# Hi\n\n   \n\n')).toBe('# Hi\n')
    expect(cleanModelOutput('# Hi')).toBe('# Hi\n')
  })

  test('returns an empty string for empty or whitespace-only output', () => {
    expect(cleanModelOutput('')).toBe('')
    expect(cleanModelOutput('   \n \n')).toBe('')
  })

  test('never throws on odd input', () => {
    expect(cleanModelOutput(undefined as unknown as string)).toBe('')
    expect(cleanModelOutput(42 as unknown as string)).toBe('')
  })

  test('normalises Windows line endings inside the answer', () => {
    expect(cleanModelOutput('```md\r\n# Hi\r\n```\r\n')).toBe('# Hi\n')
  })
})

describe('createDefaultRunner', () => {
  test('exposes the four runner methods without being called', () => {
    const runner = createDefaultRunner()
    expect(typeof runner.which).toBe('function')
    expect(typeof runner.exec).toBe('function')
    expect(typeof runner.fetchJson).toBe('function')
    expect(typeof runner.loginShellPath).toBe('function')
  })
})
