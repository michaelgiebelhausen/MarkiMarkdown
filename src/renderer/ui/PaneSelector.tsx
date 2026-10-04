import type { PaneSet } from '@shared/types'
import { PANE_ORDER, type PaneKey } from '@renderer/layout/paneMath'

const LABELS: Record<PaneKey, string> = {
  bunch: 'Funky Bunch',
  raw: 'Raw Markdown',
  rendered: 'Rendered Marki'
}

interface Props {
  panes: PaneSet
  /** Ticked panes the window is currently too narrow for. */
  hidden: PaneKey[]
  onToggle: (key: PaneKey) => void
}

export function PaneSelector({ panes, hidden, onToggle }: Props) {
  const tickedCount = PANE_ORDER.filter((k) => panes[k]).length
  return (
    <div className="pane-selector" role="group" aria-label="Panes">
      {PANE_ORDER.map((key) => {
        const title = hidden.includes(key)
          ? 'Widen the window to show this pane'
          : panes[key] && tickedCount === 1
            ? 'At least one pane stays open'
            : undefined
        return (
          <label key={key} className={hidden.includes(key) ? 'pane-check pane-check-hidden' : 'pane-check'} title={title}>
            <input type="checkbox" checked={panes[key]} onChange={() => onToggle(key)} />
            <span>{LABELS[key]}</span>
          </label>
        )
      })}
    </div>
  )
}
