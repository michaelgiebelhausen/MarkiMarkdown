import { useState } from 'react'
import type { Bunch } from '@shared/types'
import { samePath } from '@shared/paths'

interface Props {
  bunches: Bunch[]
  activeId: string | null
  missingRawPaths: string[]
  disabled: boolean
  onApply: (id: string) => void
  onEdit: (id: string) => void
  onSaveAsBunch: () => void
}

function BunchChip({
  bunch,
  active,
  unavailable,
  disabled,
  onApply,
  onEdit
}: {
  bunch: Bunch
  active: boolean
  unavailable: boolean
  disabled: boolean
  onApply: (id: string) => void
  onEdit: (id: string) => void
}) {
  const [over, setOver] = useState(false)
  const classes = ['bunch-chip']
  if (active) classes.push('bunch-chip-on')
  if (unavailable) classes.push('bunch-chip-unavailable')
  if (over) classes.push('bunch-chip-drop')

  return (
    <span className="bunch-chip-wrap">
      <button
        type="button"
        className={classes.join(' ')}
        aria-label={`${bunch.name} bunch`}
        aria-pressed={active}
        disabled={disabled}
        title={unavailable ? `${bunch.name}'s raw folder can't be found` : undefined}
        onClick={() => onApply(bunch.id)}
        onContextMenu={(event) => {
          event.preventDefault()
          onEdit(bunch.id)
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('text/marki-note')) return
          event.preventDefault()
          setOver(true)
        }}
        onDragLeave={(event) => {
          // Moving onto the chip's own emoji or warning is not leaving the chip.
          const to = event.relatedTarget
          if (to instanceof Node && event.currentTarget.contains(to)) return
          setOver(false)
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.types.includes('text/marki-note')) return
          event.preventDefault()
          setOver(false)
          if (!active) onApply(bunch.id)
        }}
      >
        <span aria-hidden="true">{bunch.emoji}</span> {bunch.name}
        {unavailable && (
          <span className="board-warn" aria-hidden="true">
            !
          </span>
        )}
      </button>
      <button type="button" className="bunch-chip-more" aria-label={`Edit ${bunch.name} bunch`} onClick={() => onEdit(bunch.id)}>
        …
      </button>
    </span>
  )
}

export function BunchChips({ bunches, activeId, missingRawPaths, disabled, onApply, onEdit, onSaveAsBunch }: Props) {
  return (
    <div className="bunch-chips" role="group" aria-label="Bunches">
      <span className="locations-label">Bunch</span>
      {bunches.map((b) => (
        <BunchChip
          key={b.id}
          bunch={b}
          active={b.id === activeId}
          unavailable={b.rawPath.length > 0 && missingRawPaths.some((p) => samePath(p, b.rawPath))}
          disabled={disabled}
          onApply={onApply}
          onEdit={onEdit}
        />
      ))}
      <button type="button" className="btn btn-quiet btn-tight" disabled={disabled} onClick={onSaveAsBunch}>
        + Save as bunch
      </button>
    </div>
  )
}
