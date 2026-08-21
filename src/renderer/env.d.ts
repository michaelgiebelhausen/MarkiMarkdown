/// <reference types="vite/client" />
import type { MarkiApi } from '../preload/index'

declare global {
  interface Window {
    marki: MarkiApi
  }
}

export {}
