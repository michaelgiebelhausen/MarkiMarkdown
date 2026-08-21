import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  message: string
  detail: string
}

/**
 * A blank white window with no explanation is the worst thing that can happen to a
 * student. Whatever breaks, they get a sentence, a way to copy the details for their
 * instructor, and a way back.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { message: '', detail: '' }

  static getDerivedStateFromError(error: Error): State {
    return { message: 'MarkiMarkdown ran into a problem.', detail: String(error?.stack ?? error) }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('Renderer error', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.message) return this.props.children
    return (
      <div className="crash">
        <div className="crash-box">
          <h1>{this.state.message}</h1>
          <p>Your notes on disk are safe. Reopening usually clears it.</p>
          <div className="row">
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              Reload
            </button>
            <button
              className="btn btn-quiet"
              onClick={() => void navigator.clipboard.writeText(this.state.detail)}
            >
              Copy details
            </button>
            <button className="btn btn-quiet" onClick={() => void window.marki.support.openLogs()}>
              Open log folder
            </button>
          </div>
          <pre className="crash-detail">{this.state.detail.slice(0, 900)}</pre>
        </div>
      </div>
    )
  }
}
