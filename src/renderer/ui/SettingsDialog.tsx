import { useEffect, useState } from 'react'
import { Modal, Field } from './Modal'
import type { AiProviderStatus, Settings } from '@shared/types'

export function SettingsDialog({
  settings,
  onSave,
  onClose,
  notify
}: {
  settings: Settings
  onSave: (patch: Partial<Settings>) => Promise<unknown>
  onClose: () => void
  notify: (text: string) => void
}) {
  const [status, setStatus] = useState<AiProviderStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [apiKey, setApiKey] = useState('')

  const check = async () => {
    setChecking(true)
    const result = await window.marki.ai.detect()
    setChecking(false)
    setStatus(result.ok ? result.status : { available: false, kind: 'none', detail: 'Could not check.' })
  }

  useEffect(() => {
    void check()
  }, [])

  return (
    <Modal
      title="Settings"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="spacer" />
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <h3 className="section-head">Saving</h3>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.autosave}
          onChange={(event) => void onSave({ autosave: event.target.checked })}
        />
        <span>Save my notes automatically</span>
      </label>

      <h3 className="section-head">Filing</h3>
      <Field label="Default raw folder" hint="Pre-fills the raw folder when you make a bunch.">
        <div className="row">
          <input readOnly value={settings.defaultRawPath ?? ''} placeholder="No default yet" />
          <button
            className="btn btn-quiet"
            onClick={async () => {
              const result = await window.marki.dialogs.pickFolder()
              if (result.ok) void onSave({ defaultRawPath: result.path })
            }}
          >
            Choose...
          </button>
          {settings.defaultRawPath && (
            <button className="btn btn-quiet" onClick={() => void onSave({ defaultRawPath: '' })}>
              Clear
            </button>
          )}
        </div>
      </Field>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.mirrorMembersAsTags}
          onChange={(event) => void onSave({ mirrorMembersAsTags: event.target.checked })}
        />
        <span>Also add each agent and artifact as a tag, like agent/study-coach (handy in Obsidian)</span>
      </label>

      <h3 className="section-head">AI clean-up</h3>
      <p className="muted">
        MarkiMarkdown has no AI of its own. It uses yours, so nobody is ever billed for using this app. Any
        one of these works:
      </p>
      <ol className="provider-list">
        <li>
          <strong>Claude Code</strong> - if it is installed and signed in, it is found automatically.
        </li>
        <li>
          <strong>Ollama</strong> - a free model running on your own computer.
        </li>
        <li>
          <strong>An API key</strong> - paste one below if you have your own.
        </li>
      </ol>

      <div className={status?.available ? 'provider-status good' : 'provider-status bad'}>
        <span>{checking ? 'Checking...' : (status?.detail ?? 'Not checked yet.')}</span>
        <button className="btn btn-quiet" onClick={() => void check()}>
          Check again
        </button>
      </div>

      <Field label="Path to the claude program" hint="Only needed if it was not found automatically.">
        <input
          value={settings.aiClaudePath ?? ''}
          placeholder="leave empty to search automatically"
          onChange={(event) => void onSave({ aiClaudePath: event.target.value || undefined })}
        />
      </Field>

      <Field label="API key" hint="Stored securely on this computer and never shared.">
        <div className="row">
          <input
            type="password"
            value={apiKey}
            placeholder="leave empty to keep the current key"
            onChange={(event) => setApiKey(event.target.value)}
          />
          <button
            className="btn btn-quiet"
            onClick={async () => {
              const result = await window.marki.settings.saveApiKey(apiKey)
              setApiKey('')
              notify(
                result.ok && result.saved
                  ? 'API key saved.'
                  : 'The key could not be stored on this computer.'
              )
              void check()
            }}
          >
            Save key
          </button>
        </div>
      </Field>

      <h3 className="section-head">If something goes wrong</h3>
      <div className="row">
        <button
          className="btn btn-quiet"
          onClick={async () => {
            await window.marki.support.diagnostics()
            notify('Diagnostics copied. Paste them into an email to your instructor.')
          }}
        >
          Copy diagnostics
        </button>
        <button className="btn btn-quiet" onClick={() => void window.marki.support.openLogs()}>
          Open log folder
        </button>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.disableHardwareAcceleration}
          onChange={(event) => {
            void onSave({ disableHardwareAcceleration: event.target.checked })
            notify('That takes effect next time you open MarkiMarkdown.')
          }}
        />
        <span>Turn off hardware acceleration (try this if the window is blank or flickers)</span>
      </label>
    </Modal>
  )
}
