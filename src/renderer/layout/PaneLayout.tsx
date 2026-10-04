import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { PaneSet } from '@shared/types'
import { dragDivider, layoutPanes, PANE_ORDER, type PaneKey } from './paneMath'

interface Props {
  panes: PaneSet
  widths: [number, number, number]
  /** Called once when a divider drag ends. */
  onWidths: (widths: [number, number, number]) => void
  onHiddenChange: (hidden: PaneKey[]) => void
  /** Renders one pane, including its own <section>. */
  render: (key: PaneKey) => ReactNode
}

/** Before the first measurement there is no width yet; assume a typical window so nothing hides. */
const FALLBACK_WIDTH = 1200

/** Matches the 6px divider columns in the grid template below. */
const DIVIDER_WIDTH = 6

/** The width left for panes once the dividers between `count` panes are taken out. */
function paneRoom(width: number, count: number): number {
  return Math.max(0, width - DIVIDER_WIDTH * Math.max(0, count - 1))
}

export function PaneLayout({ panes, widths, onWidths, onHiddenChange, render }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const [total, setTotal] = useState(0)
  const [draft, setDraft] = useState<[number, number, number] | null>(null)
  /** Ends the drag in progress, if any. */
  const dragCleanup = useRef<(() => void) | null>(null)

  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    const measure = () => setTotal(el.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const width = total || FALLBACK_WIDTH
  const ticked = PANE_ORDER.filter((k) => panes[k]).length
  let room = paneRoom(width, ticked)
  let layout = layoutPanes(panes, draft ?? widths, room)
  if (layout.shown.length < ticked) {
    room = paneRoom(width, layout.shown.length)
    layout = layoutPanes(panes, draft ?? widths, room)
  }

  /** The live pane room, so a window resize during a drag is measured against the new width. */
  const roomRef = useRef(room)
  roomRef.current = room

  const hiddenKey = layout.hidden.join(',')
  useEffect(() => {
    onHiddenChange(layout.hidden)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenKey])

  // A pane appearing or disappearing mid-drag (Ctrl+1/2/3) changes what the divider means: stop.
  const shownKey = layout.shown.join(',')
  useEffect(() => {
    dragCleanup.current?.()
  }, [shownKey])

  useEffect(() => () => dragCleanup.current?.(), [])

  const startDrag = (index: number) => (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragCleanup.current?.()
    const startX = event.clientX
    const startLayout = layout
    const base = draft ?? widths
    let latest = base
    let done = false
    // Capture keeps events flowing over iframes and editors; captured events still bubble to window.
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // The pointer may already be gone; the window listeners still end the drag.
    }
    // Listen on the window: the divider itself can unmount mid-drag when a pane is toggled.
    const move = (e: PointerEvent) => {
      latest = dragDivider(base, startLayout, index, e.clientX - startX, roomRef.current)
      setDraft(latest)
    }
    const end = () => {
      if (done) return
      done = true
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      if (dragCleanup.current === end) dragCleanup.current = null
      setDraft(null)
      if (latest !== base) onWidths(latest)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    dragCleanup.current = end
  }

  const columns = layout.fractions.map((f) => `minmax(0, ${f}fr)`).join(` ${DIVIDER_WIDTH}px `)

  return (
    <div className="panes" ref={host} style={{ gridTemplateColumns: columns }}>
      {layout.shown.map((key, i) => (
        <Fragment key={key}>
          {i > 0 && (
            <div
              className="pane-divider"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize panes"
              onPointerDown={startDrag(i - 1)}
            />
          )}
          {render(key)}
        </Fragment>
      ))}
    </div>
  )
}
