import { useEffect, useRef, useState } from 'react'
import type { Plan, Tile } from './selection'

interface Props {
  plan: Plan
  onSelect: (id: string) => void
  onAddBunch: () => void
  onEditBunch: (id: string) => void
  onOpenBoard: () => void
  onSettings: () => void
  onDropNote: (id: string) => void
  showCoachmark: boolean
  onDismissCoachmark: () => void
}

function tileClass(tile: Tile): string {
  const parts = ['tile']
  if (tile.picked) parts.push('tile-picked')
  if (tile.unavailable) parts.push('tile-unavailable')
  if (tile.empty) parts.push('tile-empty')
  return parts.join(' ')
}

function tileTitle(tile: Tile): string {
  const bits = [`${tile.name} - ${tile.memberCount} member${tile.memberCount === 1 ? '' : 's'}`]
  if (tile.dotted) bits.push('this note was last filed here')
  if (tile.empty) bits.push('add an agent or an artifact first')
  if (tile.unavailable) bits.push('raw folder cannot be reached')
  return bits.join(' - ')
}

function BunchTile({
  tile,
  onSelect,
  onEdit,
  onDropNote
}: {
  tile: Tile
  onSelect: (id: string) => void
  onEdit: (id: string) => void
  onDropNote: (id: string) => void
}) {
  return (
    <button
      className={tileClass(tile)}
      title={tileTitle(tile)}
      aria-label={`${tile.name} bunch`}
      aria-pressed={tile.picked}
      onClick={() => onSelect(tile.id)}
      onContextMenu={(event) => {
        event.preventDefault()
        onEdit(tile.id)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        event.currentTarget.classList.add('tile-drop')
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
  onSelect,
  onAddBunch,
  onEditBunch,
  onOpenBoard,
  onSettings,
  onDropNote,
  showCoachmark,
  onDismissCoachmark
}: Props) {
  // The strip scrolls, which would clip an absolutely positioned bubble, so the
  // coachmark is positioned against the viewport instead and follows the + button.
  const addWrap = useRef<HTMLDivElement>(null)
  const [coachTop, setCoachTop] = useState(96)

  useEffect(() => {
    if (!showCoachmark) return
    const place = () => {
      const rect = addWrap.current?.getBoundingClientRect()
      if (rect) setCoachTop(Math.max(52, Math.min(rect.top - 6, window.innerHeight - 190)))
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [showCoachmark, plan.tiles.length])

  return (
    <nav className="strip" aria-label="Funky Bunch">
      <div className="strip-section">
        <span className="strip-glyph" title="Bunches - who this note is for">
          👥
        </span>
        {plan.tiles.map((tile) => (
          <BunchTile key={tile.id} tile={tile} onSelect={onSelect} onEdit={onEditBunch} onDropNote={onDropNote} />
        ))}
        <div className="tile-wrap" ref={addWrap}>
          <button className="tile tile-add" onClick={onAddBunch} title="Make a bunch" aria-label="Make a bunch">
            +
          </button>
        </div>
      </div>

      <div className="strip-divider" />

      <button
        className="tile strip-board"
        onClick={onOpenBoard}
        title="Team board - your agents and artifacts"
        aria-label="Team board"
      >
        ⊞
      </button>

      <div className="strip-spacer" />
      <button className="strip-gear" onClick={onSettings} title="Settings" aria-label="Settings">
        ⚙
      </button>

      {showCoachmark && (
        <div className="coachmark" style={{ top: coachTop }}>
          <p>
            Your <strong>Funky Bunch</strong> lives here. Add an agent, add an artifact, then make a bunch.
          </p>
          <button className="btn btn-primary" onClick={onOpenBoard}>
            Open the team board
          </button>
          <button className="btn btn-quiet" onClick={onDismissCoachmark}>
            Later
          </button>
        </div>
      )}
    </nav>
  )
}
