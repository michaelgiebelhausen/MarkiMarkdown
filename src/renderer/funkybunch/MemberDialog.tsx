import { useEffect, useRef, useState } from 'react'
import { Modal, Field } from '@renderer/ui/Modal'
import type { Member, MemberKind } from '@shared/types'
import { baseName, samePath } from '@shared/paths'
import { nameKey } from '@shared/ticks'

export const SKILL_EMOJI = ['🤖', '🎓', '🔬', '✍️', '📚', '🧑‍🏫', '✅', '🔍', '🧮', '🗣️']
export const DOMAIN_EMOJI = ['📁', '📕', '🚀', '🎸', '🗄️', '💡', '📓', '🧠', '🗂️', '⭐']

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
  return kind === 'skill' ? SKILL_EMOJI[0] : DOMAIN_EMOJI[0]
}

export function MemberDialog({
  existing,
  presetKind,
  presetName,
  siblings,
  onSave,
  onDelete,
  onClose
}: {
  existing?: Member
  /** The kind the student asked for, from an "Add a skill" or "Add a domain" button. */
  presetKind?: MemberKind
  /** A name to start with, from an unknown name in the note's YAML. */
  presetName?: string
  /** Everyone already in the roster, so we can spot a duplicate folder. */
  siblings: Member[]
  onSave: (member: Member) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const [kind, setKind] = useState<MemberKind>(existing?.kind ?? presetKind ?? 'domain')
  const [name, setName] = useState(existing?.name ?? presetName ?? '')
  const [emoji, setEmoji] = useState(existing?.emoji ?? defaultEmoji(existing?.kind ?? presetKind ?? 'domain'))
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
      const list = next === 'skill' ? SKILL_EMOJI : DOMAIN_EMOJI
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
      kind === 'skill'
        ? trimmed.toLowerCase().replace(/\s+/g, '-') || 'skill'
        : trimmed || 'Folder'
    // Notes list members by name, so two of a kind must never share one. Names are
    // compared the way notes are read, so "Cell Biology" and cell-biology are one name.
    const twin = siblings.find((m) => m.id !== existing?.id && m.kind === kind && nameKey(m.name) === nameKey(finalName))
    if (twin) {
      setError(`Another ${kind} is already called ${finalName}.`)
      return
    }
    onSave({
      id: existing?.id ?? `${kind === 'skill' ? 's' : 'd'}${Date.now().toString(36)}`,
      kind,
      name: finalName,
      emoji,
      path
    })
  }

  const title = existing ? `Edit ${kind}` : kind === 'skill' ? 'Add a skill' : 'Add a domain'

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
        A <strong>skill</strong> folder does a kind of work: it holds skills and instructions, like a CLAUDE.md. A{' '}
        <strong>domain</strong> folder gathers everything about one subject.
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
            className={kind === 'skill' ? 'seg seg-on' : 'seg'}
            aria-pressed={kind === 'skill'}
            onClick={() => {
              touchedKind.current = true
              switchKind('skill')
            }}
          >
            A skill
          </button>
          <button
            type="button"
            className={kind === 'domain' ? 'seg seg-on' : 'seg'}
            aria-pressed={kind === 'domain'}
            onClick={() => {
              touchedKind.current = true
              switchKind('domain')
            }}
          >
            A domain
          </button>
        </div>
      </Field>
      <Field label="Name" hint={kind === 'skill' ? 'Lower case, no spaces, like study-coach.' : undefined}>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={kind === 'skill' ? 'study-coach' : 'thesis'}
        />
      </Field>
      <Field label="Icon" group>
        <EmojiPicker options={kind === 'skill' ? SKILL_EMOJI : DOMAIN_EMOJI} value={emoji} onChange={setEmoji} />
      </Field>
      {error && <p className="error">{error}</p>}
    </Modal>
  )
}
