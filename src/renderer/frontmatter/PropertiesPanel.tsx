import { useState } from 'react'
import { parseFrontMatter, mergeFrontMatter } from '@shared/markdown/frontmatter'

interface Props {
  raw: string | null
  onChange: (raw: string | null) => void
  knownTags: string[]
}

const OKF_TYPES = ['note', 'source', 'concept', 'meeting', 'person', 'project', 'reference']
const SHOWN_FIRST = ['type', 'title', 'description', 'tags', 'agents', 'resource']
const HIDDEN = new Set(['id', 'created', 'filed'])

export function PropertiesPanel({ raw, onChange, knownTags }: Props) {
  const [open, setOpen] = useState(false)
  const [tagDraft, setTagDraft] = useState('')

  if (raw === null) return null

  const parsed = parseFrontMatter(raw)

  if (!parsed.ok) {
    return (
      <div className="props props-broken">
        <span>
          Properties could not be read (line {parsed.line}). Fix the lines at the top of the note on the
          left, or
        </span>
        <button className="btn btn-quiet" onClick={() => onChange(repair(raw))}>
          repair them
        </button>
      </div>
    )
  }

  const data = parsed.data
  const tags = normaliseList(data.tags)
  const agents = normaliseList(data.agents)
  const type = typeof data.type === 'string' ? data.type : ''
  const title = typeof data.title === 'string' ? data.title : ''

  const set = (patch: Record<string, unknown>) => onChange(mergeFrontMatter(raw, patch))

  const extraKeys = Object.keys(data).filter((k) => !SHOWN_FIRST.includes(k) && !HIDDEN.has(k))

  return (
    <div className={`props ${open ? 'props-open' : ''}`}>
      <button className="props-summary" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="props-chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        {type && <span className="badge">{type}</span>}
        {title && <span className="props-title">{title}</span>}
        {tags.map((tag) => (
          <span className="pill" key={tag}>
            {tag}
          </span>
        ))}
        {agents.length > 0 && <span className="props-agents">for {agents.join(', ')}</span>}
        {!type && !title && tags.length === 0 && <span className="props-empty">Properties</span>}
      </button>

      {open && (
        <div className="props-grid">
          <label className="props-row">
            <span>Type</span>
            <input
              list="okf-types"
              value={type}
              onChange={(event) => set({ type: event.target.value || null })}
            />
            <datalist id="okf-types">
              {OKF_TYPES.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </label>

          <label className="props-row">
            <span>Title</span>
            <input value={title} onChange={(event) => set({ title: event.target.value || null })} />
          </label>

          <label className="props-row">
            <span>Description</span>
            <input
              value={typeof data.description === 'string' ? data.description : ''}
              onChange={(event) => set({ description: event.target.value || null })}
            />
          </label>

          <div className="props-row">
            <span>Tags</span>
            <div className="chips">
              {tags.map((tag) => (
                <button
                  key={tag}
                  className="pill pill-removable"
                  onClick={() => set({ tags: tags.filter((t) => t !== tag) })}
                  title={`Remove ${tag}`}
                >
                  {tag}
                  <span aria-hidden="true"> ×</span>
                </button>
              ))}
              <input
                className="chip-input"
                list="known-tags"
                value={tagDraft}
                placeholder="add a tag"
                onChange={(event) => setTagDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ',') {
                    event.preventDefault()
                    const value = tagDraft.trim().replace(/^#/, '')
                    if (value && !tags.includes(value)) set({ tags: [...tags, value] })
                    setTagDraft('')
                  } else if (event.key === 'Backspace' && tagDraft === '' && tags.length > 0) {
                    set({ tags: tags.slice(0, -1) })
                  }
                }}
              />
              <datalist id="known-tags">
                {knownTags.map((tag) => (
                  <option key={tag} value={tag} />
                ))}
              </datalist>
            </div>
          </div>

          {extraKeys.length > 0 && (
            <div className="props-row props-extra">
              <span>Also here</span>
              <span className="props-extra-list">{extraKeys.join(', ')} (edit on the left)</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function normaliseList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).replace(/^#/, '')).filter(Boolean)
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((v) => v.trim().replace(/^#/, ''))
      .filter(Boolean)
  }
  return []
}

/** Quotes values YAML cannot read, and puts back a missing closing fence. */
function repair(raw: string): string {
  const lines = raw.split(/\r?\n/)
  const out: string[] = []
  let closed = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (i === 0) {
      out.push(line)
      continue
    }
    if (/^(---|\.\.\.)\s*$/.test(line)) {
      out.push(line)
      closed = true
      continue
    }
    const match = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line)
    if (match && match[2].length > 0 && !/^["'[{]/.test(match[2])) {
      const value = match[2]
      const risky = value.includes(': ') || /^[#*&@!%]/.test(value) || value.endsWith(':')
      out.push(risky ? `${match[1]}: "${value.split('"').join("'")}"` : line)
    } else {
      out.push(line)
    }
  }
  if (!closed) out.push('---')
  return out.join('\n') + '\n'
}
