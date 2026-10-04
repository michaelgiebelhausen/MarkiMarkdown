import { useMemo, type MouseEvent } from 'react'
import type { LedgerEntry, Member, MemberKind } from '@shared/types'
import { pairCounts, pairKey } from '@shared/ledger'

interface Props {
  members: Member[]
  ledger: LedgerEntry[]
  skillIds: string[]
  domainIds: string[]
  missingMemberIds: string[]
  /** The YAML cannot be read, so nothing can be ticked. */
  disabled: boolean
  onToggleSkill: (id: string) => void
  onToggleDomain: (id: string) => void
  onToggleCell: (skillId: string, domainId: string) => void
  onEditMember: (id: string) => void
  onAddMember: (kind: MemberKind) => void
}

export function SkillDomainGrid(props: Props) {
  const skills = props.members.filter((m) => m.kind === 'skill')
  const domains = props.members.filter((m) => m.kind === 'domain')
  const counts = useMemo(() => pairCounts(props.ledger), [props.ledger])

  if (skills.length === 0 && domains.length === 0) {
    return (
      <div className="grid-empty">
        <p>
          <strong>Skill folders</strong> do a kind of work: they hold skills and instructions, like a CLAUDE.md.{' '}
          <strong>Domain folders</strong> gather everything about one subject. Add one of each to start ticking
          notes.
        </p>
        <button className="btn btn-primary" onClick={() => props.onAddMember('skill')}>
          Add a skill
        </button>{' '}
        <button className="btn btn-primary" onClick={() => props.onAddMember('domain')}>
          Add a domain
        </button>
      </div>
    )
  }

  const warn = (id: string) =>
    props.missingMemberIds.includes(id) ? (
      <span className="board-warn" title="This folder can't be found. Right-click to fix it.">
        !
      </span>
    ) : null

  const edit = (id: string) => (event: MouseEvent) => {
    event.preventDefault()
    props.onEditMember(id)
  }

  const head = (member: Member, on: boolean, toggle: () => void) => (
    <>
      <button
        type="button"
        className="board-head"
        disabled={props.disabled}
        aria-pressed={on}
        aria-label={`${member.name} ${member.kind}`}
        title={member.path || 'No folder chosen yet'}
        onClick={toggle}
        onContextMenu={edit(member.id)}
      >
        <span aria-hidden="true">{member.emoji}</span>
        <span className="board-name">{member.name}</span>
      </button>
      <button type="button" className="board-more" aria-label={`Edit ${member.name}`} onClick={() => props.onEditMember(member.id)}>
        …
      </button>
      {warn(member.id)}
    </>
  )

  return (
    <div className={props.disabled ? 'grid-wrap grid-disabled' : 'grid-wrap'}>
      {props.disabled && <p className="grid-blocked">Fix the YAML to tick skills and domains.</p>}
      <div className="board-scroll">
        <table className="board" aria-label="Skills and domains">
          <thead>
            <tr>
              <th className="board-corner" aria-hidden="true" />
              {skills.map((skill) => {
                const on = props.skillIds.includes(skill.id)
                return (
                  <th key={skill.id} scope="col" className={on ? 'board-skill board-on' : 'board-skill'}>
                    {head(skill, on, () => props.onToggleSkill(skill.id))}
                  </th>
                )
              })}
              <th className="board-add">
                <button type="button" className="btn btn-quiet btn-tight" onClick={() => props.onAddMember('skill')}>
                  + Add skill
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {domains.map((domain) => {
              const rowOn = props.domainIds.includes(domain.id)
              return (
                <tr key={domain.id}>
                  <th scope="row" className={rowOn ? 'board-domain board-on' : 'board-domain'}>
                    {head(domain, rowOn, () => props.onToggleDomain(domain.id))}
                  </th>
                  {skills.map((skill) => {
                    const n = counts.get(pairKey(skill.id, domain.id)) ?? 0
                    const both = rowOn && props.skillIds.includes(skill.id)
                    const classes = ['board-cell']
                    if (n > 0) classes.push('board-cell-hot')
                    if (both) classes.push('board-cell-on')
                    return (
                      <td key={skill.id}>
                        <button
                          type="button"
                          className={classes.join(' ')}
                          disabled={props.disabled}
                          aria-pressed={both}
                          aria-label={`${skill.name} and ${domain.name}: ${n} note${n === 1 ? '' : 's'}`}
                          onClick={() => props.onToggleCell(skill.id, domain.id)}
                        >
                          {both ? '●' : n > 0 ? n : '·'}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
            <tr>
              <th className="board-add" scope="row">
                <button type="button" className="btn btn-quiet btn-tight" onClick={() => props.onAddMember('domain')}>
                  + Add domain
                </button>
              </th>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
