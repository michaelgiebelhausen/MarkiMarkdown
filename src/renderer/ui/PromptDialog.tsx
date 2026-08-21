import { useState } from 'react'
import { Modal, Field } from './Modal'

/**
 * Electron's renderer has no window.prompt, so anywhere the app needs a line of
 * text from the student it asks with this instead.
 */
export function PromptDialog({
  title,
  label,
  hint,
  initial,
  confirmLabel,
  allowEmpty,
  emptyLabel,
  onSubmit,
  onClose
}: {
  title: string
  label: string
  hint?: string
  initial?: string
  confirmLabel?: string
  allowEmpty?: boolean
  emptyLabel?: string
  onSubmit: (value: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(initial ?? '')

  const submit = () => {
    if (!allowEmpty && value.trim().length === 0) return
    onSubmit(value.trim())
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          {allowEmpty && (
            <button className="btn btn-quiet" onClick={() => onSubmit('')}>
              {emptyLabel ?? 'Remove'}
            </button>
          )}
          <span className="spacer" />
          <button className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit}>
            {confirmLabel ?? 'OK'}
          </button>
        </>
      }
    >
      <Field label={label} hint={hint}>
        <input
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
          placeholder="https://"
        />
      </Field>
    </Modal>
  )
}
