import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { PaneSet } from '@shared/types'
import { dragDivider, layoutPanes, type PaneKey } from './paneMath'

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

export function PaneLayout({ panes, widths, onWidths, onHiddenChange, render }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const [total, setTotal] = useState(0)
  const [draft, setDraft] = useState<[number, number, number] | null>(null)

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
  const layout = layoutPanes(panes, draft ?? widths, width)

  const hiddenKey = layout.hidden.join(',')
  useEffect(() => {
    onHiddenChange(layout.hidden)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenKey])

  const startDrag = (index: number) => (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const target = event.currentTarget
    const startX = event.clientX
    const startLayout = layout
    const base = draft ?? widths
    let latest = base
    target.setPointerCapture(event.pointerId)
    const move = (e: PointerEvent) => {
      latest = dragDivider(base, startLayout, index, e.clientX - startX, width)
      setDraft(latest)
    }
    const end = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', end)
      target.removeEventListener('pointercancel', end)
      setDraft(null)
      if (latest !== base) onWidths(latest)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', end)
    target.addEventListener('pointercancel', end)
  }

  const columns = layout.fractions.map((f) => `minmax(0, ${f}fr)`).join(' 6px ')

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
