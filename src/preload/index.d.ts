import type { MarkiApi } from './index'

declare global {
  interface Window {
    marki: MarkiApi
  }
}

export {}
