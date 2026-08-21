import type { Block } from './pm/bridge'

export type Pane = 'code' | 'rendered'

interface PaneHooks {
  /** Bring the given top-level block to the top of this pane. */
  scrollToBlock: (index: number) => void
  /** Tint the given block, or clear the tint with -1. */
  highlight: (index: number) => void
}

/**
 * Keeps the two panes pointing at the same place in the note.
 *
 * The whole idea of the app is that the code on the left and the words on the right
 * are the same thing. Scrolling one moves the other, and the block your cursor is in
 * is tinted on both sides, so the connection is visible rather than explained.
 */
/** Runs the callback after the browser has painted, or on the next tick outside one. */
function afterPaint(callback: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(callback)
  else setTimeout(callback, 0)
}

export class SyncController {
  /** Offsets of each top-level block, relative to the body. */
  blocks: Block[] = []
  /** How many characters of front matter sit above the body in the code pane. */
  bodyStart = 0

  private hooks: Partial<Record<Pane, PaneHooks>> = {}
  private echoGuard: Pane | null = null
  private active = -1

  constructor(private readonly schedule: (callback: () => void) => void = afterPaint) {}

  register(pane: Pane, hooks: PaneHooks): () => void {
    this.hooks[pane] = hooks
    return () => {
      if (this.hooks[pane] === hooks) delete this.hooks[pane]
    }
  }

  setBlocks(blocks: Block[], bodyStart: number): void {
    this.blocks = blocks
    this.bodyStart = bodyStart
  }

  /** Body offset -> block index. */
  blockAtOffset(offset: number): number {
    const blocks = this.blocks
    if (blocks.length === 0) return -1
    let best = 0
    for (let i = 0; i < blocks.length; i++) {
      if (offset >= blocks[i].start) best = i
      else break
    }
    return best
  }

  /** The character offset in the code pane where a block begins. */
  offsetOfBlock(index: number): number {
    const block = this.blocks[index]
    return block ? this.bodyStart + block.start : this.bodyStart
  }

  /** One pane scrolled; move the other to match, without bouncing back. */
  reportScroll(from: Pane, blockIndex: number): void {
    if (this.echoGuard !== null && this.echoGuard !== from) return
    if (blockIndex < 0) return
    const target: Pane = from === 'code' ? 'rendered' : 'code'
    const hooks = this.hooks[target]
    if (!hooks) return

    this.echoGuard = from
    hooks.scrollToBlock(blockIndex)
    // the pane we just moved will fire its own scroll event; ignore that one
    this.schedule(() => {
      this.echoGuard = null
    })
  }

  /** The cursor moved; tint the same block on both sides. */
  setActive(blockIndex: number): void {
    if (blockIndex === this.active) return
    this.active = blockIndex
    this.hooks.code?.highlight(blockIndex)
    this.hooks.rendered?.highlight(blockIndex)
  }

  get activeBlock(): number {
    return this.active
  }
}
