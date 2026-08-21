import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './ui/ErrorBoundary'
import './styles.css'

// No StrictMode double-mount around the editors: ProseMirror and CodeMirror each own
// real DOM, and a second mount would leave an orphaned view behind.
const container = document.getElementById('root')

if (container) {
  createRoot(container).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  )
}

// Anything that escapes React still has to reach the student as words, not silence.
function report(message: string, detail: string): void {
  const host = document.getElementById('runtime-error')
  if (host) {
    host.textContent = message
    return
  }
  const bar = document.createElement('div')
  bar.id = 'runtime-error'
  bar.className = 'runtime-error'
  bar.textContent = message
  bar.title = detail.slice(0, 500)
  document.body.appendChild(bar)
  window.setTimeout(() => bar.remove(), 12000)
}

window.addEventListener('error', (event) => {
  report('Something went wrong. Your notes on disk are safe.', String(event.error?.stack ?? event.message))
})

window.addEventListener('unhandledrejection', (event) => {
  report('Something went wrong. Your notes on disk are safe.', String(event.reason))
})
