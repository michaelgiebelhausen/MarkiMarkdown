import type { PaneSet } from '@shared/types'

export type PaneKey = 'bunch' | 'raw' | 'rendered'

/** Left to right, always. */
export const PANE_ORDER: PaneKey[] = ['bunch', 'raw', 'rendered']

export const MIN_WIDTH: Record<PaneKey, number> = { bunch: 280, raw: 240, rendered: 240 }

/** Flips one pane, unless that would leave no pane at all. */
export function togglePane(panes: PaneSet, key: PaneKey): PaneSet {
  const next = { ...panes, [key]: !panes[key] }
  return PANE_ORDER.some((k) => next[k]) ? next : panes
}

export interface PaneLayout {
  shown: PaneKey[]
  /** Ticked, but the window is too narrow for them right now. */
  hidden: PaneKey[]
  /** Share of the width for each shown pane, adding up to 1. */
  fractions: number[]
}

/** Raises every pane to its minimum share, taking the difference from panes that have room. */
function clampToMinimums(keys: PaneKey[], fractions: number[], total: number): number[] {
  if (keys.length === 1) return [1]
  const mins = keys.map((k) => MIN_WIDTH[k] / total)
  const raised = fractions.map((f, i) => Math.max(f, mins[i]))
  const over = raised.reduce((a, b) => a + b, 0) - 1
  if (over <= 0) return raised
  const slack = raised.map((f, i) => f - mins[i])
  const slackSum = slack.reduce((a, b) => a + b, 0)
  if (slackSum <= 0) return raised.map(() => 1 / raised.length)
  return raised.map((f, i) => f - over * (slack[i] / slackSum))
}

/** A stored width that is not a usable number (NaN, Infinity, negative) counts as 0. */
function usable(width: number): number {
  return Number.isFinite(width) && width > 0 ? width : 0
}

/** Which ticked panes fit in `total` pixels, and their shares. The rightmost ticked pane drops first. */
export function layoutPanes(panes: PaneSet, widths: [number, number, number], total: number): PaneLayout {
  // A window not measured yet (or measured as nonsense) is treated as no room at all.
  const room = Number.isFinite(total) && total > 0 ? total : 0
  const shown = PANE_ORDER.filter((k) => panes[k])
  const hidden: PaneKey[] = []
  while (shown.length > 1 && shown.reduce((s, k) => s + MIN_WIDTH[k], 0) > room) {
    hidden.unshift(shown.pop() as PaneKey)
  }
  if (room === 0) return { shown, hidden, fractions: shown.map(() => 1) }
  const raw = shown.map((k) => usable(widths[PANE_ORDER.indexOf(k)]))
  const sum = raw.reduce((a, b) => a + b, 0)
  const fractions = sum > 0 ? raw.map((w) => w / sum) : raw.map(() => 1 / raw.length)
  return { shown, hidden, fractions: clampToMinimums(shown, fractions, room) }
}

/** Matches the divider columns PaneLayout puts between panes. */
export const DIVIDER_WIDTH = 6

/** The width left for panes once the dividers between `count` panes are taken out. */
export function paneRoom(width: number, count: number): number {
  return Math.max(0, width - DIVIDER_WIDTH * Math.max(0, count - 1))
}

/**
 * Lays out the ticked panes in a window `width` pixels wide, dividers included. The first
 * pass assumes every ticked pane shows; when some drop, the dividers they no longer need
 * are given back and the panes laid out again. That extra room can make a dropped pane
 * fit again, which would need its divider back, so the second pass may never show more
 * panes than the first: the first pass's panes are kept, with the room they really have.
 */
export function fitPanes(
  panes: PaneSet,
  widths: [number, number, number],
  width: number
): { layout: PaneLayout; room: number } {
  const ticked = PANE_ORDER.filter((k) => panes[k]).length
  const first = layoutPanes(panes, widths, paneRoom(width, ticked))
  if (first.shown.length >= ticked) return { layout: first, room: paneRoom(width, ticked) }
  const room = paneRoom(width, first.shown.length)
  const second = layoutPanes(panes, widths, room)
  if (second.shown.length > first.shown.length) return { layout: first, room }
  return { layout: second, room }
}

/**
 * Moves the divider between shown pane `index` and the next one by `dx` pixels, never
 * squeezing either below its minimum. Returns widths for all three panes: shown panes
 * get their new shares (adding up to 1), and each hidden pane is rescaled by the same
 * factor, so when it comes back it takes the same share of the window it had before.
 */
export function dragDivider(
  widths: [number, number, number],
  layout: PaneLayout,
  index: number,
  dx: number,
  total: number
): [number, number, number] {
  const stored = widths.map(usable)
  const shownSum = layout.shown.reduce((s, key) => s + stored[PANE_ORDER.indexOf(key)], 0)
  const scale = shownSum > 0 ? 1 / shownSum : 1
  const next = stored.map((w) => w * scale) as [number, number, number]
  layout.shown.forEach((key, i) => {
    next[PANE_ORDER.indexOf(key)] = layout.fractions[i]
  })
  const badDivider = !Number.isInteger(index) || index < 0 || index >= layout.shown.length - 1
  if (!(total > 0) || !Number.isFinite(dx) || badDivider) return next
  const left = layout.shown[index]
  const right = layout.shown[index + 1]
  const a = layout.fractions[index]
  const b = layout.fractions[index + 1]
  const delta = Math.max(MIN_WIDTH[left] / total - a, Math.min(b - MIN_WIDTH[right] / total, dx / total))
  next[PANE_ORDER.indexOf(left)] = a + delta
  next[PANE_ORDER.indexOf(right)] = b - delta
  return next
}
