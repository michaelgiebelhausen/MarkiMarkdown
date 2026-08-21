import { useEffect } from 'react'

export interface ToastMessage {
  id: number
  text: string
  actionLabel?: string
  onAction?: () => void
  tone?: 'normal' | 'warn'
  /** Milliseconds; 0 keeps it up until dismissed. */
  duration?: number
}

export function ToastStack({
  toasts,
  dismiss
}: {
  toasts: ToastMessage[]
  dismiss: (id: number) => void
}) {
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} dismiss={dismiss} />
      ))}
    </div>
  )
}

function Toast({ toast, dismiss }: { toast: ToastMessage; dismiss: (id: number) => void }) {
  useEffect(() => {
    const ms = toast.duration ?? 6000
    if (ms === 0) return
    const timer = window.setTimeout(() => dismiss(toast.id), ms)
    return () => window.clearTimeout(timer)
  }, [toast, dismiss])

  return (
    <div className={`toast ${toast.tone === 'warn' ? 'toast-warn' : ''}`}>
      <span className="toast-text">{toast.text}</span>
      {toast.actionLabel && (
        <button
          className="toast-action"
          onClick={() => {
            toast.onAction?.()
            dismiss(toast.id)
          }}
        >
          {toast.actionLabel}
        </button>
      )}
      <button className="toast-close" aria-label="Dismiss" onClick={() => dismiss(toast.id)}>
        ×
      </button>
    </div>
  )
}
