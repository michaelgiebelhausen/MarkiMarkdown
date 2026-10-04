import type { SaveFlow } from '@renderer/state/useSaveFlow'
import { toForwardSlashes } from '@shared/paths'

/** The last three folders of a path, so long Windows paths fit the pane. */
function shortPath(path: string): string {
  const parts = toForwardSlashes(path).split('/').filter((p) => p.length > 0)
  return parts.length <= 3 ? parts.join('/') : `…/${parts.slice(-3).join('/')}`
}

export function SaveLocations({ flow }: { flow: SaveFlow }) {
  return (
    <div className="save-locations">
      <span className="locations-label">Working version saves to</span>
      <button
        type="button"
        className="folder-field"
        disabled={flow.busy}
        aria-label="Working folder"
        title={flow.workingDir || undefined}
        onClick={() => void flow.chooseWorkingFolder()}
      >
        <span className="folder-path">{flow.workingDir ? shortPath(flow.workingDir) : 'Choose a folder'}</span>
        <span aria-hidden="true">📁</span>
      </button>

      <label className="check archive-check">
        <input type="checkbox" checked={flow.archive} onChange={(event) => flow.setArchive(event.target.checked)} />
        <span>
          <span className="archive-title">Archive / distribute this version</span>
          <span className="field-hint">A milestone worth filing in your second brain.</span>
        </span>
      </label>

      <span className="locations-label">Archive copy goes to raw folder</span>
      <button
        type="button"
        className="folder-field"
        disabled={flow.busy}
        aria-label="Raw folder"
        title={flow.rawPath || undefined}
        onClick={() => void flow.chooseRawFolder()}
      >
        <span className="folder-path">{flow.rawPath ? shortPath(flow.rawPath) : 'Choose a raw folder'}</span>
        <span aria-hidden="true">📁</span>
      </button>
      {flow.archive && !flow.plan.canArchive && (
        <p className="save-reason" role="note">
          {flow.plan.reason}
        </p>
      )}
    </div>
  )
}

export function SaveButton({ flow }: { flow: SaveFlow }) {
  return (
    <div className="save-row">
      <button className="btn btn-primary" disabled={flow.busy} onClick={() => void flow.save()}>
        {flow.willArchive ? 'Save and archive' : 'Save'}
      </button>
    </div>
  )
}
