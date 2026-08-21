import { describe, expect, test, vi } from 'vitest'
import { SyncController } from '@renderer/editors/sync'

const blocks = [
  { start: 0, end: 7 },
  { start: 9, end: 20 },
  { start: 22, end: 30 }
]

function make() {
  const pending: (() => void)[] = []
  const controller = new SyncController((fn) => pending.push(fn))
  controller.setBlocks(blocks, 40)
  const code = { scrollToBlock: vi.fn(), highlight: vi.fn() }
  const rendered = { scrollToBlock: vi.fn(), highlight: vi.fn() }
  controller.register('code', code)
  controller.register('rendered', rendered)
  return { controller, code, rendered, flush: () => pending.splice(0).forEach((fn) => fn()) }
}

describe('blockAtOffset', () => {
  test('finds the block a position falls inside', () => {
    const { controller } = make()
    expect(controller.blockAtOffset(0)).toBe(0)
    expect(controller.blockAtOffset(5)).toBe(0)
    expect(controller.blockAtOffset(9)).toBe(1)
    expect(controller.blockAtOffset(25)).toBe(2)
  })

  test('a position in the gap belongs to the block above it', () => {
    const { controller } = make()
    expect(controller.blockAtOffset(8)).toBe(0)
    expect(controller.blockAtOffset(21)).toBe(1)
  })

  test('a position past the end belongs to the last block', () => {
    const { controller } = make()
    expect(controller.blockAtOffset(9999)).toBe(2)
  })

  test('an empty document has no blocks', () => {
    const controller = new SyncController()
    expect(controller.blockAtOffset(0)).toBe(-1)
  })
})

describe('offsetOfBlock', () => {
  test('adds the front matter that sits above the body', () => {
    const { controller } = make()
    expect(controller.offsetOfBlock(0)).toBe(40)
    expect(controller.offsetOfBlock(1)).toBe(49)
  })

  test('falls back to the start of the body for an unknown block', () => {
    const { controller } = make()
    expect(controller.offsetOfBlock(99)).toBe(40)
  })
})

describe('scroll following', () => {
  test('scrolling the code pane moves the rendered pane', () => {
    const { controller, code, rendered } = make()
    controller.reportScroll('code', 2)
    expect(rendered.scrollToBlock).toHaveBeenCalledWith(2)
    expect(code.scrollToBlock).not.toHaveBeenCalled()
  })

  test('scrolling the rendered pane moves the code pane', () => {
    const { controller, code, rendered } = make()
    controller.reportScroll('rendered', 1)
    expect(code.scrollToBlock).toHaveBeenCalledWith(1)
    expect(rendered.scrollToBlock).not.toHaveBeenCalled()
  })

  test('the pane being moved does not bounce the scroll back', () => {
    const { controller, code, rendered } = make()
    controller.reportScroll('code', 2)
    rendered.scrollToBlock.mockClear()
    // the rendered pane now fires its own scroll event as a result
    controller.reportScroll('rendered', 2)
    expect(code.scrollToBlock).not.toHaveBeenCalled()
  })

  test('once the paint has settled the other pane can lead again', () => {
    const { controller, code, flush } = make()
    controller.reportScroll('code', 2)
    flush()
    controller.reportScroll('rendered', 1)
    expect(code.scrollToBlock).toHaveBeenCalledWith(1)
  })

  test('ignores a negative index', () => {
    const { controller, rendered } = make()
    controller.reportScroll('code', -1)
    expect(rendered.scrollToBlock).not.toHaveBeenCalled()
  })

  test('does nothing when the other pane is not on screen', () => {
    const controller = new SyncController()
    controller.setBlocks(blocks, 0)
    const code = { scrollToBlock: vi.fn(), highlight: vi.fn() }
    controller.register('code', code)
    expect(() => controller.reportScroll('code', 1)).not.toThrow()
  })
})

describe('the active block tint', () => {
  test('tints the same block on both sides', () => {
    const { controller, code, rendered } = make()
    controller.setActive(1)
    expect(code.highlight).toHaveBeenCalledWith(1)
    expect(rendered.highlight).toHaveBeenCalledWith(1)
  })

  test('does not repeat itself while the cursor stays put', () => {
    const { controller, code } = make()
    controller.setActive(1)
    controller.setActive(1)
    expect(code.highlight).toHaveBeenCalledTimes(1)
  })

  test('clears the tint with minus one', () => {
    const { controller, code } = make()
    controller.setActive(1)
    controller.setActive(-1)
    expect(code.highlight).toHaveBeenLastCalledWith(-1)
  })

  test('unregistering stops the calls', () => {
    const { controller, code } = make()
    const off = controller.register('code', code)
    off()
    controller.setActive(2)
    expect(code.highlight).not.toHaveBeenCalled()
  })
})
