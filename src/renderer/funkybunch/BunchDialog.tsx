import { useState } from 'react'
import { Modal, Field } from '@renderer/ui/Modal'
import type { Bunch, Member } from '@shared/types'
import { EmojiPicker } from './MemberDialog'

const BUNCH_EMOJI = ['👥', '🎓', '🚀', '🎸', '🧪', '📝', '🎯', '🌱', '🔥', '⭐']

export function BunchDialog({
  existing,
  preset,
  members,
  defaultRawPath,
  missingMemberIds,
  onSave,
  onDelete,
  onClose
}: {
  existing?: Bunch
  /** Members to tick when starting a bunch from a team board cell. */
  preset?: { agentIds: string[]; artifactIds: string[] }
  members: Member[]
  defaultRawPath?: string
  missingMemberIds: string[]
  onSave: (bunch: Bunch) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(existing?.name ?? '')
  const [emoji, setEmoji] = useState(existing?.emoji ?? BUNCH_EMOJI[0])
  const [rawPath, setRawPath] = useState(existing?.rawPath || defaultRawPath || '')
  const [agentIds, setAgentIds] = useState<string[]>(existing?.agentIds ?? preset?.agentIds ?? [])
  const [artifactIds, setArtifactIds] = useState<string[]>(existing?.artifactIds ?? preset?.artifactIds ?? [])
  const [error, setError] = useState('')

  const agents = members.filter((m) => m.kind === 'agent')
  const artifacts = members.filter((m) => m.kind === 'artifact')
  const pickedAgents = agentIds.filter((id) => agents.some((a) => a.id === id))
  const pickedArtifacts = artifactIds.filter((id) => artifacts.some((a) => a.id === id))
  const valid = name.trim().length > 0 && rawPath.length > 0 && pickedAgents.length + pickedArtifacts.length > 0

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
    onSave({
      id: existing?.id ?? `b${Date.now().toString(36)}`,
      name: name.trim(),
      emoji,
      rawPath,
      agentIds: pickedAgents,
      artifactIds: pickedArtifacts
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
        A bunch is a group of agents and artifacts, like a group chat. Filing a note to a bunch drops it in the
        raw folder, stamped with everyone in the group.
      </p>
      <Field label="Name">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="thesis" />
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
      <Field label="Agents" group>
        <div className="folder-checks">
          {agents.length === 0 && <p className="muted">No agents yet. Add one from the team board.</p>}
          {agents.map((agent) => (
            <label key={agent.id} className="check">
              <input
                type="checkbox"
                checked={agentIds.includes(agent.id)}
                onChange={() => setAgentIds((current) => flip(current, agent.id))}
              />
              <span>
                {agent.emoji} {agent.name}
                {missingMemberIds.includes(agent.id) && (
                  <span className="board-warn" title="This folder cannot be found">
                    !
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      </Field>
      <Field label="Artifacts" group>
        <div className="folder-checks">
          {artifacts.length === 0 && <p className="muted">No artifacts yet. Add one from the team board.</p>}
          {artifacts.map((artifact) => (
            <label key={artifact.id} className="check">
              <input
                type="checkbox"
                checked={artifactIds.includes(artifact.id)}
                onChange={() => setArtifactIds((current) => flip(current, artifact.id))}
              />
              <span>
                {artifact.emoji} {artifact.name}
                {missingMemberIds.includes(artifact.id) && (
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
