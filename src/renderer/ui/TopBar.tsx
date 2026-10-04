import { useState } from 'react'
import type { PaneSet } from '@shared/types'
import type { PaneKey } from '@renderer/layout/paneMath'
import { PaneSelector } from './PaneSelector'

interface Props {
  fileName: string
  dirty: boolean
  archiveCount: number
  filePath: string
  panes: PaneSet
  hiddenPanes: PaneKey[]
  onTogglePane: (key: PaneKey) => void
  busy: string
  onMenu: (action: string) => void
  onCancelBusy: () => void
}

const MENU_ITEMS: { action: string; label: string }[] = [
  { action: 'add-properties', label: 'Add properties' },
  { action: 'tidy', label: 'Tidy formatting' },
  { action: 'ai-clean', label: 'Clean up with AI' },
  { action: 'convert', label: 'Convert to Markdown' },
  { action: 'show-in-folder', label: 'Show in folder' },
  { action: 'help', label: 'How to use MarkiMarkdown' },
  { action: 'settings', label: 'Settings' }
]

export function TopBar(props: Props) {
  const [open, setOpen] = useState(false)

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div
          className="chip"
          draggable
          title={props.filePath || 'This note has not been saved yet'}
          onDragStart={(event) => {
            event.dataTransfer.setData('text/marki-note', '1')
            event.dataTransfer.effectAllowed = 'copy'
          }}
        >
          <span className="chip-name">{props.fileName}</span>
          {props.dirty && <span className="chip-dot" title="Unsaved changes" />}
          <span className="chip-places">
            {props.archiveCount > 0 ? `archived ${props.archiveCount}×` : 'not archived'}
          </span>
        </div>
        {props.busy && (
          <span className="busy">
            <span className="spinner" aria-hidden="true" />
            {props.busy}
            <button className="btn btn-quiet btn-tight" onClick={props.onCancelBusy}>
              Cancel
            </button>
          </span>
        )}
      </div>

      <div className="topbar-right">
        <PaneSelector panes={props.panes} hidden={props.hiddenPanes} onToggle={props.onTogglePane} />

        <div className="menu-wrap">
          <button className="btn btn-quiet" aria-label="More actions" onClick={() => setOpen((v) => !v)}>
            ⋯
          </button>
          {open && (
            <>
              <div className="menu-scrim" onClick={() => setOpen(false)} />
              <div className="menu">
                {MENU_ITEMS.map((item) => (
                  <button
                    key={item.action}
                    className="menu-item"
                    onClick={() => {
                      setOpen(false)
                      props.onMenu(item.action)
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
