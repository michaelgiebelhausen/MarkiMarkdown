import { useState } from 'react'
import { Modal, Field } from '@renderer/ui/Modal'
import type { AgentMember, FolderMember, Member } from '@shared/types'
import { baseName, samePath } from '@shared/paths'

const FOLDER_EMOJI = ['📥', '🔬', '🗄️', '📚', '🧠', '💡', '📓', '🎓', '🗂️', '⭐']
const AGENT_EMOJI = ['🤖', '📚', '🧑‍🏫', '✅', '🔍', '✍️', '🧮', '🗣️']

function EmojiPicker({
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

export function FolderDialog({
  existing,
  siblings,
  onSave,
  onDelete,
  onClose
}: {
  existing?: FolderMember
  /** The folders already in the Funky Bunch, so we can spot a duplicate. */
  siblings: FolderMember[]
  onSave: (member: FolderMember) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(existing?.name ?? '')
  const [emoji, setEmoji] = useState(existing?.emoji ?? '📥')
  const [path, setPath] = useState(existing?.path ?? '')
  const [tags, setTags] = useState((existing?.stamp?.tags ?? []).join(', '))
  const [error, setError] = useState('')

  const pick = async () => {
    const result = await window.marki.dialogs.pickFolder()
    if (result.ok) {
      setPath(result.path)
      if (!name) setName(baseName(result.path) || 'Folder')
    }
  }

  const createDefault = async () => {
    const result = await window.marki.dialogs.createDefaultFolder()
    if (result.ok) {
      setPath(result.path)
      if (!name) setName('Inbox')
    } else {
      setError(result.message)
    }
  }

  const save = () => {
    if (!path) {
      setError('Choose a folder first.')
      return
    }
    const clash = siblings.find((f) => f.id !== existing?.id && samePath(f.path, path))
    if (clash) {
      setError(`${clash.name} already points at that folder. Two tiles for one folder would fight over the same file.`)
      return
    }
    onSave({
      id: existing?.id ?? `f${Date.now().toString(36)}`,
      kind: 'folder',
      name: name.trim() || 'Folder',
      emoji,
      path,
      stamp: {
        tags: tags
          .split(',')
          .map((t) => t.trim().replace(/^#/, ''))
          .filter(Boolean)
      }
    })
  }

  return (
    <Modal
      title={existing ? 'Edit folder' : 'Add a folder'}
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
      <p className="dialog-lead">A folder is a place your notes can live. Agents read these folders.</p>
      {!path && !existing && (
        <button className="btn btn-primary btn-block" onClick={createDefault}>
          Create Documents / Second Brain / Inbox for me
        </button>
      )}
      <Field label="Folder">
        <div className="row">
          <input readOnly value={path} placeholder="No folder chosen yet" />
          <button className="btn btn-quiet" onClick={pick}>
            Choose...
          </button>
        </div>
      </Field>
      <Field label="Name">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Inbox" />
      </Field>
      <Field label="Icon">
        <EmojiPicker options={FOLDER_EMOJI} value={emoji} onChange={setEmoji} />
      </Field>
      <Field label="Tags to add when filing here" hint="Optional. Separate with commas.">
        <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="raw, inbox" />
      </Field>
      {error && <p className="error">{error}</p>}
    </Modal>
  )
}

export function AgentDialog({
  existing,
  folders,
  onSave,
  onDelete,
  onClose
}: {
  existing?: AgentMember
  folders: FolderMember[]
  onSave: (member: AgentMember) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(existing?.name ?? '')
  const [emoji, setEmoji] = useState(existing?.emoji ?? '🤖')
  const [folderIds, setFolderIds] = useState<string[]>(existing?.folderIds ?? [])
  const [error, setError] = useState('')

  const toggleFolder = (id: string) =>
    setFolderIds((current) => (current.includes(id) ? current.filter((f) => f !== id) : [...current, id]))

  const save = () => {
    const clean = name.trim().replace(/^@/, '')
    if (!clean) {
      setError('Give the agent a name, such as librarian.')
      return
    }
    onSave({
      id: existing?.id ?? `a${Date.now().toString(36)}`,
      kind: 'agent',
      name: clean,
      emoji,
      folderIds
    })
  }

  return (
    <Modal
      title={existing ? 'Edit agent' : 'Add an agent'}
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
        Agents are the AI helpers that read your folders. Filing a note <em>for</em> an agent writes its name
        into the note, so the agent knows the note is meant for it.
      </p>
      <Field label="Name" hint="Lower case, no spaces, like librarian or study-buddy.">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="librarian" />
      </Field>
      <Field label="Icon">
        <EmojiPicker options={AGENT_EMOJI} value={emoji} onChange={setEmoji} />
      </Field>
      <Field label="Which folders does this agent read?" hint="Picking the agent will pick these folders too.">
        <div className="folder-checks">
          {folders.length === 0 && <p className="muted">Add a folder first, then come back.</p>}
          {folders.map((folder) => (
            <label key={folder.id} className="check">
              <input
                type="checkbox"
                checked={folderIds.includes(folder.id)}
                onChange={() => toggleFolder(folder.id)}
              />
              <span>
                {folder.emoji} {folder.name}
              </span>
            </label>
          ))}
        </div>
      </Field>
      {error && <p className="error">{error}</p>}
    </Modal>
  )
}

export function isFolder(member: Member): member is FolderMember {
  return member.kind === 'folder'
}

export function isAgent(member: Member): member is AgentMember {
  return member.kind === 'agent'
}
