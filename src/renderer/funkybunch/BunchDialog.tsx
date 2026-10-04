import { useState } from 'react'
import { Modal, Field } from '@renderer/ui/Modal'
import type { Bunch, Member } from '@shared/types'
import { EmojiPicker } from './MemberDialog'

const BUNCH_EMOJI = ['👥', '🎓', '🚀', '🎸', '🧪', '📝', '🎯', '🌱', '🔥', '⭐']

export function BunchDialog({
  existing,
  preset,
  members,
  bunches,
  defaultRawPath,
  missingMemberIds,
  onSave,
  onDelete,
  onClose
}: {
  existing?: Bunch
  /** Ticks (and a raw folder) to start a new bunch from, such as the note's current ticks. */
  preset?: { skillIds: string[]; domainIds: string[]; rawPath?: string }
  members: Member[]
  /** Every bunch there is, so a second one cannot take a name already in use. */
  bunches: Bunch[]
  defaultRawPath?: string
  missingMemberIds: string[]
  onSave: (bunch: Bunch) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(existing?.name ?? '')
  const [emoji, setEmoji] = useState(existing?.emoji ?? BUNCH_EMOJI[0])
  const [rawPath, setRawPath] = useState(existing?.rawPath || preset?.rawPath || defaultRawPath || '')
  const [skillIds, setSkillIds] = useState<string[]>(existing?.skillIds ?? preset?.skillIds ?? [])
  const [domainIds, setDomainIds] = useState<string[]>(existing?.domainIds ?? preset?.domainIds ?? [])
  const [error, setError] = useState('')

  const skills = members.filter((m) => m.kind === 'skill')
  const domains = members.filter((m) => m.kind === 'domain')
  const pickedSkills = skillIds.filter((id) => skills.some((s) => s.id === id))
  const pickedDomains = domainIds.filter((id) => domains.some((d) => d.id === id))
  const valid = name.trim().length > 0 && rawPath.length > 0 && pickedSkills.length + pickedDomains.length > 0

  const flip = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  const pick = async () => {
    const result = await window.marki.dialogs.pickFolder()
    if (result.ok) setRawPath(result.path)
  }

  const createDefault = async () => {
    const result = await window.marki.dialogs.createDefaultFolder()
    if (result.ok) setRawPath(result.path)
    else setError(result.message)
  }

  const save = () => {
    if (!valid) return
    const trimmed = name.trim()
    // Notes name their bunch, so two bunches must never answer to the same name.
    const twin = bunches.find((b) => b.id !== existing?.id && b.name.trim().toLowerCase() === trimmed.toLowerCase())
    if (twin) {
      setError(`Another bunch is already called ${trimmed}.`)
      return
    }
    onSave({
      id: existing?.id ?? `b${Date.now().toString(36)}`,
      name: trimmed,
      emoji,
      rawPath,
      skillIds: pickedSkills,
      domainIds: pickedDomains
    })
  }

  return (
    <Modal
      title={existing ? 'Edit bunch' : 'Make a bunch'}
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
          <button className="btn btn-primary" onClick={save} disabled={!valid}>
            Save
          </button>
        </>
      }
    >
      <p className="dialog-lead">
        A bunch is a saved group of skills and domains, like a group chat, plus the raw folder its archive copies
        go to.
      </p>
      <Field label="Name">
        <input
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            setError('')
          }}
          placeholder="thesis"
        />
      </Field>
      <Field label="Icon" group>
        <EmojiPicker options={BUNCH_EMOJI} value={emoji} onChange={setEmoji} />
      </Field>
      {!rawPath && (
        <button className="btn btn-primary btn-block" onClick={createDefault}>
          Create Documents / Second Brain / raw for me
        </button>
      )}
      <Field label="Raw folder" hint="Your second brain's inbox. Every note filed to this bunch lands here.">
        <div className="row">
          <input readOnly value={rawPath} placeholder="No folder chosen yet" />
          <button className="btn btn-quiet" onClick={pick}>
            Choose...
          </button>
        </div>
      </Field>
      <Field label="Skills" group>
        <div className="folder-checks">
          {skills.length === 0 && <p className="muted">No skills yet. Add one in the Funky Bunch pane.</p>}
          {skills.map((skill) => (
            <label key={skill.id} className="check">
              <input
                type="checkbox"
                checked={skillIds.includes(skill.id)}
                onChange={() => setSkillIds((current) => flip(current, skill.id))}
              />
              <span>
                {skill.emoji} {skill.name}
                {missingMemberIds.includes(skill.id) && (
                  <span className="board-warn" title="This folder cannot be found">
                    !
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      </Field>
      <Field label="Domains" group>
        <div className="folder-checks">
          {domains.length === 0 && <p className="muted">No domains yet. Add one in the Funky Bunch pane.</p>}
          {domains.map((domain) => (
            <label key={domain.id} className="check">
              <input
                type="checkbox"
                checked={domainIds.includes(domain.id)}
                onChange={() => setDomainIds((current) => flip(current, domain.id))}
              />
              <span>
                {domain.emoji} {domain.name}
                {missingMemberIds.includes(domain.id) && (
                  <span className="board-warn" title="This folder cannot be found">
                    !
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      </Field>
      {error && <p className="error">{error}</p>}
    </Modal>
  )
}
