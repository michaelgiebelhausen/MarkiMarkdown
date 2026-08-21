import { useEffect, useRef, useState } from 'react'
import type { Plan, Tile } from './selection'

interface Props {
  plan: Plan
  onToggle: (id: string) => void
  onAddFolder: () => void
  onAddAgent: () => void
  onEdit: (id: string) => void
  onSettings: () => void
  onDropNote: (id: string) => void
  showCoachmark: boolean
  onDismissCoachmark: () => void
}

function tileClass(tile: Tile): string {
  const parts = ['tile']
  if (tile.picked) parts.push('tile-picked')
  if (tile.implied) parts.push('tile-implied')
  if (tile.unavailable) parts.push('tile-unavailable')
  return parts.join(' ')
}

function tileTitle(tile: Tile, plan: Plan): string {
  if (tile.kind === 'agent') {
    const reads = plan.tiles.filter((t) => t.kind === 'folder')
    void reads
    return `${tile.name}${tile.dotted ? ' - already on this note' : ''}`
  }
  const bits = [tile.name]
  if (tile.dotted) bits.push('this note lives here')
  else if (tile.sibling) bits.push('another copy lives here')
  if (tile.unavailable) bits.push('cannot be reached')
  return bits.join(' - ')
}

function TileButton({
  tile,
  plan,
  onToggle,
  onEdit,
  onDropNote
}: {
  tile: Tile
  plan: Plan
  onToggle: (id: string) => void
  onEdit: (id: string) => void
  onDropNote: (id: string) => void
}) {
  return (
    <button
      className={tileClass(tile)}
      title={tileTitle(tile, plan)}
      aria-label={`${tile.name}${tile.kind === 'folder' ? ' folder' : ' agent'}`}
      aria-pressed={tile.picked}
      onClick={() => onToggle(tile.id)}
      onContextMenu={(event) => {
        event.preventDefault()
        onEdit(tile.id)
      }}
      onDragOver={(event) => {
        if (tile.kind === 'folder') {
          event.preventDefault()
          event.currentTarget.classList.add('tile-drop')
        }
      }}
      onDragLeave={(event) => event.currentTarget.classList.remove('tile-drop')}
      onDrop={(event) => {
        event.preventDefault()
        event.currentTarget.classList.remove('tile-drop')
        onDropNote(tile.id)
      }}
    >
      <span className="tile-emoji" aria-hidden="true">
        {tile.emoji}
      </span>
      {tile.dotted && <span className="tile-dot" aria-hidden="true" />}
      {!tile.dotted && tile.sibling && <span className="tile-dot tile-dot-faint" aria-hidden="true" />}
      {tile.unavailable && (
        <span className="tile-warn" aria-hidden="true">
          !
        </span>
      )}
    </button>
  )
}

export function Strip({
  plan,
  onToggle,
  onAddFolder,
  onAddAgent,
  onEdit,
  onSettings,
  onDropNote,
  showCoachmark,
  onDismissCoachmark
}: Props) {
  const agents = plan.tiles.filter((t) => t.kind === 'agent')
  const folders = plan.tiles.filter((t) => t.kind === 'folder')

  // The strip scrolls, which would clip an absolutely positioned bubble, so the
  // coachmark is positioned against the viewport instead and follows the + button.
  const addFolderWrap = useRef<HTMLDivElement>(null)
  const [coachTop, setCoachTop] = useState(96)

  useEffect(() => {
    if (!showCoachmark) return
    const place = () => {
      const rect = addFolderWrap.current?.getBoundingClientRect()
      if (rect) setCoachTop(Math.max(52, Math.min(rect.top - 6, window.innerHeight - 190)))
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [showCoachmark, folders.length, agents.length])

  return (
    <nav className="strip" aria-label="Funky Bunch">
      <div className="strip-section">
        <span className="strip-glyph" title="Agents - who should know about this note">
          🤖
        </span>
        {agents.map((tile) => (
          <TileButton
            key={tile.id}
            tile={tile}
            plan={plan}
            onToggle={onToggle}
            onEdit={onEdit}
            onDropNote={onDropNote}
          />
        ))}
        <button className="tile tile-add" onClick={onAddAgent} title="Add an agent" aria-label="Add an agent">
          +
        </button>
      </div>

      <div className="strip-divider" />

      <div className="strip-section">
        <span className="strip-glyph" title="Folders - where this note should live">
          📁
        </span>
        {folders.map((tile) => (
          <TileButton
            key={tile.id}
            tile={tile}
            plan={plan}
            onToggle={onToggle}
            onEdit={onEdit}
            onDropNote={onDropNote}
          />
        ))}
        <div className="tile-wrap" ref={addFolderWrap}>
          <button className="tile tile-add" onClick={onAddFolder} title="Add a folder" aria-label="Add a folder">
            +
          </button>
        </div>
      </div>

      <div className="strip-spacer" />
      <button className="strip-gear" onClick={onSettings} title="Settings" aria-label="Settings">
        ⚙
      </button>

      {showCoachmark && (
        <div className="coachmark" style={{ top: coachTop }}>
          <p>
            Your <strong>Funky Bunch</strong> lives here. Add a folder to file notes into, then add the agents
            that read it.
          </p>
          <button className="btn btn-primary" onClick={onAddFolder}>
            Choose a folder
          </button>
          <button className="btn btn-quiet" onClick={onDismissCoachmark}>
            Later
          </button>
        </div>
      )}
    </nav>
  )
}
