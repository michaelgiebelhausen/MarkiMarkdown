import { useMemo } from 'react'
import { Modal } from '@renderer/ui/Modal'
import type { Bunch, LedgerEntry, Member, MemberKind } from '@shared/types'
import { pairCounts, pairKey } from '@shared/ledger'

interface Props {
  members: Member[]
  bunches: Bunch[]
  ledger: LedgerEntry[]
  /** Members whose folder is empty or cannot be found. */
  missingMemberIds: string[]
  onAddMember: (kind: MemberKind) => void
  onEditMember: (id: string) => void
  onCell: (agentId: string, artifactId: string) => void
  onClose: () => void
}

export function TeamBoard({ members, bunches, ledger, missingMemberIds, onAddMember, onEditMember, onCell, onClose }: Props) {
  const agents = members.filter((m) => m.kind === 'agent')
  const artifacts = members.filter((m) => m.kind === 'artifact')
  const counts = useMemo(() => pairCounts(ledger), [ledger])

  const inABunch = (agentId: string, artifactId: string) =>
    bunches.some((b) => b.agentIds.includes(agentId) && b.artifactIds.includes(artifactId))

  const warn = (id: string) =>
    missingMemberIds.includes(id) ? (
      <span className="board-warn" title="This folder cannot be found. Right-click to fix it.">
        !
      </span>
    ) : null

  return (
    <Modal
      title="Team board"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-quiet" onClick={() => onAddMember('agent')}>
            Add an agent
          </button>
          <button className="btn btn-quiet" onClick={() => onAddMember('artifact')}>
            Add an artifact
          </button>
          <span className="spacer" />
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <p className="dialog-lead">
        <strong>Agents</strong> across the top are folders that do work. <strong>Artifacts</strong> down the side
        are folders that hold what the work produces. A number is how many notes were filed to both. Click a
        square to make or open the bunch that pairs them. Right-click a name to edit it.
      </p>

      {members.length === 0 ? (
        <div className="board-empty">
          <p>Nothing here yet. Start with one folder of each kind.</p>
          <button className="btn btn-primary" onClick={() => onAddMember('agent')}>
            Add an agent
          </button>{' '}
          <button className="btn btn-primary" onClick={() => onAddMember('artifact')}>
            Add an artifact
          </button>
        </div>
      ) : (
        <div className="board-scroll">
          <table className="board" aria-label="Team board">
            <thead>
              <tr>
                <th className="board-corner" aria-hidden="true" />
                {agents.map((agent) => (
                  <th
                    key={agent.id}
                    scope="col"
                    className="board-agent"
                    title={agent.path || 'No folder chosen yet'}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      onEditMember(agent.id)
                    }}
                  >
                    <span aria-hidden="true">{agent.emoji}</span>
                    <span className="board-name">
                      {agent.name}
                      {warn(agent.id)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {artifacts.map((artifact) => (
                <tr key={artifact.id}>
                  <th
                    scope="row"
                    className="board-artifact"
                    title={artifact.path || 'No folder chosen yet'}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      onEditMember(artifact.id)
                    }}
                  >
                    <span aria-hidden="true">{artifact.emoji}</span>
                    <span className="board-name">
                      {artifact.name}
                      {warn(artifact.id)}
                    </span>
                  </th>
                  {agents.map((agent) => {
                    const n = counts.get(pairKey(agent.id, artifact.id)) ?? 0
                    const classes = ['board-cell']
                    if (n > 0) classes.push('board-cell-hot')
                    if (inABunch(agent.id, artifact.id)) classes.push('board-cell-bunch')
                    return (
                      <td key={agent.id}>
                        <button
                          className={classes.join(' ')}
                          aria-label={`${agent.name} and ${artifact.name}: ${n} note${n === 1 ? '' : 's'}`}
                          onClick={() => onCell(agent.id, artifact.id)}
                        >
                          {n > 0 ? n : '·'}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {agents.length === 0 && <p className="muted">Add an agent to fill in the columns.</p>}
          {artifacts.length === 0 && <p className="muted">Add an artifact to fill in the rows.</p>}
        </div>
      )}
    </Modal>
  )
}
