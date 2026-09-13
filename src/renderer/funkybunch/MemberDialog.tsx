import { useEffect, useRef, useState } from 'react'
import { Modal, Field } from '@renderer/ui/Modal'
import type { Member, MemberKind } from '@shared/types'
import { baseName, samePath } from '@shared/paths'

export const AGENT_EMOJI = ['🤖', '🎓', '🔬', '✍️', '📚', '🧑‍🏫', '✅', '🔍', '🧮', '🗣️']
export const ARTIFACT_EMOJI = ['📁', '📕', '🚀', '🎸', '🗄️', '💡', '📓', '🧠', '🗂️', '⭐']

export function EmojiPicker({
  options,
  value,
  onChange
}: {
  options: string[]
  value: string
  onChange: (emoji: string) => void
}) {
  return (
    <div className="emoji-picker">
      {options.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className={emoji === value ? 'emoji-option emoji-on' : 'emoji-option'}
          onClick={() => onChange(emoji)}
          aria-label={`Use ${emoji}`}
        >
          {emoji}
        </button>
      ))}
    </div>
  )
}

function defaultEmoji(kind: MemberKind): string {
  return kind === 'agent' ? AGENT_EMOJI[0] : ARTIFACT_EMOJI[0]
}

export function MemberDialog({
  existing,
  presetKind,
  siblings,
  onSave,
  onDelete,
  onClose
}: {
  existing?: Member
  /** The kind the student asked for, from an "Add an agent" or "Add an artifact" button. */
  presetKind?: MemberKind
  /** Everyone already in the roster, so we can spot a duplicate folder. */
  siblings: Member[]
  onSave: (member: Member) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const [kind, setKind] = useState<MemberKind>(existing?.kind ?? presetKind ?? 'artifact')
  const [name, setName] = useState(existing?.name ?? '')
  const [emoji, setEmoji] = useState(existing?.emoji ?? defaultEmoji(existing?.kind ?? presetKind ?? 'artifact'))
  const [path, setPath] = useState(existing?.path ?? '')
  const [error, setError] = useState('')
  const touchedKind = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    return () => {
      mounted.current = false
    }
  }, [])

  const switchKind = (next: MemberKind) => {
    setKind(next)
    setEmoji((current) => {
      const list = next === 'agent' ? AGENT_EMOJI : ARTIFACT_EMOJI
      return list.includes(current) ? current : defaultEmoji(next)
    })
  }

  const pick = async () => {
    const result = await window.marki.dialogs.pickFolder()
    if (!result.ok) return
    setPath(result.path)
    setError('')
    if (!name) setName(baseName(result.path) || 'Folder')
    // Only guess when the student has not already said what this is.
    if (!existing && presetKind === undefined) {
      const proposed = await window.marki.members.proposeKind(result.path)
      if (!mounted.current) return
      if (proposed.ok && !touchedKind.current) switchKind(proposed.kind)
    }
  }

  const save = () => {
    if (!path) {
      setError('Choose a folder first.')
      return
    }
    const clash = siblings.find((m) => m.id !== existing?.id && m.path.length > 0 && samePath(m.path, path))
    if (clash) {
      setError(`${clash.name} already points at that folder.`)
      return
    }
    const trimmed = name.trim()
    const finalName =
      kind === 'agent'
        ? trimmed.toLowerCase().replace(/\s+/g, '-') || 'agent'
        : trimmed || 'Folder'
    onSave({
      id: existing?.id ?? `${kind === 'agent' ? 'a' : 'x'}${Date.now().toString(36)}`,
      kind,
      name: finalName,
      emoji,
      path
    })
  }

  const title = existing ? `Edit ${kind}` : kind === 'agent' ? 'Add an agent' : 'Add an artifact'

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          {onDelete && (
            <button className="btn btn-danger" onClick={onDelete}>
              Remove
            </button>
          )}
          <span className="spacer" />
          <button className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <p className="dialog-lead">
        An <strong>agent</strong> is a folder that does work: it holds skills and instructions. An{' '}
        <strong>artifact</strong> is a folder that holds what the work produces.
      </p>
      <Field label="Folder">
        <div className="row">
          <input readOnly value={path} placeholder="No folder chosen yet" />
          <button className="btn btn-quiet" onClick={pick}>
            Choose...
          </button>
        </div>
      </Field>
      <Field label="This folder is" group>
        <div className="segmented" role="group" aria-label="Kind">
          <button
            type="button"
            className={kind === 'agent' ? 'seg seg-on' : 'seg'}
            aria-pressed={kind === 'agent'}
            onClick={() => {
              touchedKind.current = true
              switchKind('agent')
            }}
          >
            An agent
          </button>
          <button
            type="button"
            className={kind === 'artifact' ? 'seg seg-on' : 'seg'}
            aria-pressed={kind === 'artifact'}
            onClick={() => {
              touchedKind.current = true
              switchKind('artifact')
            }}
          >
            An artifact
          </button>
        </div>
      </Field>
      <Field label="Name" hint={kind === 'agent' ? 'Lower case, no spaces, like study-coach.' : undefined}>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={kind === 'agent' ? 'study-coach' : 'thesis'}
        />
      </Field>
      <Field label="Icon" group>
        <EmojiPicker options={kind === 'agent' ? AGENT_EMOJI : ARTIFACT_EMOJI} value={emoji} onChange={setEmoji} />
      </Field>
      {error && <p className="error">{error}</p>}
    </Modal>
  )
}
