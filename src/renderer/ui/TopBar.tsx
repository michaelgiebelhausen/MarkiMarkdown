import { useState } from 'react'

export type ViewMode = 'code' | 'split' | 'text'

interface Props {
  fileName: string
  dirty: boolean
  placeCount: number
  placeNames: string[]
  fileLabel: string
  canFile: boolean
  blockedReason: string
  hasPending: boolean
  view: ViewMode
  busy: string
  onSetView: (view: ViewMode) => void
  onFile: () => void
  onClearSelection: () => void
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

  const placeSummary =
    props.placeCount > 1
      ? `${props.placeCount} places`
      : props.placeCount === 1
        ? props.placeNames[0]
        : 'Not filed yet'

  return (
    <header className="topbar">
      <div className="topbar-left">
        {props.hasPending ? (
          <div className="file-action">
            <button
              className="btn btn-primary"
              disabled={!props.canFile}
              title={props.blockedReason || undefined}
              onClick={props.onFile}
            >
              {props.fileLabel}
            </button>
            <button className="btn btn-quiet btn-tight" onClick={props.onClearSelection} aria-label="Clear selection">
              ×
            </button>
            {!props.canFile && props.blockedReason && <span className="blocked">{props.blockedReason}</span>}
          </div>
        ) : (
          <div
            className="chip"
            draggable
            title={props.placeNames.join(', ') || 'This note has not been filed yet'}
            onDragStart={(event) => {
              event.dataTransfer.setData('text/marki-note', '1')
              event.dataTransfer.effectAllowed = 'copy'
            }}
          >
            <span className="chip-name">{props.fileName}</span>
            {props.dirty && <span className="chip-dot" title="Unsaved changes" />}
            <span className="chip-places">{placeSummary}</span>
          </div>
        )}
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
        <div className="segmented" role="group" aria-label="View">
          {(['code', 'split', 'text'] as const).map((mode) => (
            <button
              key={mode}
              className={props.view === mode ? 'seg seg-on' : 'seg'}
              onClick={() => props.onSetView(mode)}
              aria-pressed={props.view === mode}
            >
              {mode === 'code' ? 'Code' : mode === 'split' ? 'Split' : 'Text'}
            </button>
          ))}
        </div>

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
