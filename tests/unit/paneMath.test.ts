import { describe, expect, test } from 'vitest'
import { MIN_WIDTH, dragDivider, layoutPanes, togglePane } from '@renderer/layout/paneMath'

const all = { bunch: true, raw: true, rendered: true }
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

describe('togglePane', () => {
  test('turns a pane off and back on', () => {
    const off = togglePane(all, 'raw')
    expect(off).toEqual({ bunch: true, raw: false, rendered: true })
    expect(togglePane(off, 'raw')).toEqual(all)
  })

  test('the last ticked pane stays on', () => {
    const only = { bunch: false, raw: true, rendered: false }
    expect(togglePane(only, 'raw')).toBe(only)
  })
})

describe('layoutPanes', () => {
  test('shows ticked panes in order with their share of the width', () => {
    const l = layoutPanes({ bunch: false, raw: true, rendered: true }, [1, 1, 2], 1200)
    expect(l.shown).toEqual(['raw', 'rendered'])
    expect(l.hidden).toEqual([])
    expect(l.fractions[0]).toBeCloseTo(1 / 3)
    expect(l.fractions[1]).toBeCloseTo(2 / 3)
  })

  test('hides the rightmost ticked pane when the window is too narrow', () => {
    const l = layoutPanes(all, [1, 1, 1], 700)
    expect(l.shown).toEqual(['bunch', 'raw'])
    expect(l.hidden).toEqual(['rendered'])
  })

  test('never hides the last pane', () => {
    const l = layoutPanes(all, [1, 1, 1], 100)
    expect(l.shown).toEqual(['bunch'])
    expect(l.hidden).toEqual(['raw', 'rendered'])
    expect(l.fractions).toEqual([1])
  })

  test('gives every shown pane at least its minimum and still adds up', () => {
    const total = 900
    const l = layoutPanes(all, [10, 1, 1], total)
    l.shown.forEach((key, i) => expect(l.fractions[i] * total).toBeGreaterThanOrEqual(MIN_WIDTH[key] - 0.01))
    expect(sum(l.fractions)).toBeCloseTo(1)
  })
})

describe('dragDivider', () => {
  test('moves width from one pane to its neighbour', () => {
    const l = layoutPanes(all, [1, 1, 1], 1200)
    const w = dragDivider([1, 1, 1], l, 0, 120, 1200)
    expect(w[0]).toBeCloseTo(1 / 3 + 0.1)
    expect(w[1]).toBeCloseTo(1 / 3 - 0.1)
    expect(w[2]).toBeCloseTo(1 / 3)
  })

  test('stops at the neighbour minimum', () => {
    const l = layoutPanes(all, [1, 1, 1], 1200)
    const w = dragDivider([1, 1, 1], l, 0, 5000, 1200)
    expect(w[1] * 1200).toBeCloseTo(MIN_WIDTH.raw)
  })

  test('a hidden pane keeps its stored width', () => {
    const l = layoutPanes({ bunch: true, raw: false, rendered: true }, [1, 7, 1], 1200)
    const w = dragDivider([1, 7, 1], l, 0, 0, 1200)
    expect(w[1]).toBe(7)
  })
})
