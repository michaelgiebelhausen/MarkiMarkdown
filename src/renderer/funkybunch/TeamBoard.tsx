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
  onCell: (skillId: string, domainId: string) => void
  onClose: () => void
}

export function TeamBoard({ members, bunches, ledger, missingMemberIds, onAddMember, onEditMember, onCell, onClose }: Props) {
  const skills = members.filter((m) => m.kind === 'skill')
  const domains = members.filter((m) => m.kind === 'domain')
  const counts = useMemo(() => pairCounts(ledger), [ledger])

  const inABunch = (skillId: string, domainId: string) =>
    bunches.some((b) => b.skillIds.includes(skillId) && b.domainIds.includes(domainId))

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
          <button className="btn btn-quiet" onClick={() => onAddMember('skill')}>
            Add a skill
          </button>
          <button className="btn btn-quiet" onClick={() => onAddMember('domain')}>
            Add a domain
          </button>
          <span className="spacer" />
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <p className="dialog-lead">
        <strong>Skills</strong> across the top are folders that do a kind of work. <strong>Domains</strong> down the
        side are folders that gather everything about one subject. A number is how many notes were filed to both.
        Click a square to make or open the bunch that pairs them. Click a name to edit it.
      </p>

      {members.length === 0 ? (
        <div className="board-empty">
          <p>Nothing here yet. Start with one folder of each kind.</p>
          <button className="btn btn-primary" onClick={() => onAddMember('skill')}>
            Add a skill
          </button>{' '}
          <button className="btn btn-primary" onClick={() => onAddMember('domain')}>
            Add a domain
          </button>
        </div>
      ) : (
        <div className="board-scroll">
          <table className="board" aria-label="Team board">
            <thead>
              <tr>
                <th className="board-corner" aria-hidden="true" />
                {skills.map((skill) => (
                  <th
                    key={skill.id}
                    scope="col"
                    className="board-agent"
                    title={skill.path || 'No folder chosen yet'}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      onEditMember(skill.id)
                    }}
                  >
                    <button
                      type="button"
                      className="board-head"
                      onClick={() => onEditMember(skill.id)}
                      title="Edit or remove"
                    >
                      <span aria-hidden="true">{skill.emoji}</span>
                      <span className="board-name">{skill.name}</span>
                    </button>
                    {warn(skill.id)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {domains.map((domain) => (
                <tr key={domain.id}>
                  <th
                    scope="row"
                    className="board-artifact"
                    title={domain.path || 'No folder chosen yet'}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      onEditMember(domain.id)
                    }}
                  >
                    <button
                      type="button"
                      className="board-head"
                      onClick={() => onEditMember(domain.id)}
                      title="Edit or remove"
                    >
                      <span aria-hidden="true">{domain.emoji}</span>
                      <span className="board-name">{domain.name}</span>
                    </button>
                    {warn(domain.id)}
                  </th>
                  {skills.map((skill) => {
                    const n = counts.get(pairKey(skill.id, domain.id)) ?? 0
                    const classes = ['board-cell']
                    if (n > 0) classes.push('board-cell-hot')
                    if (inABunch(skill.id, domain.id)) classes.push('board-cell-bunch')
                    return (
                      <td key={skill.id}>
                        <button
                          className={classes.join(' ')}
                          aria-label={`${skill.name} and ${domain.name}: ${n} note${n === 1 ? '' : 's'}`}
                          onClick={() => onCell(skill.id, domain.id)}
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
          {skills.length === 0 && <p className="muted">Add a skill to fill in the columns.</p>}
          {domains.length === 0 && <p className="muted">Add a domain to fill in the rows.</p>}
        </div>
      )}
    </Modal>
  )
}
