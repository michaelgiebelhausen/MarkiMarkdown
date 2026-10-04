import { useState, type ReactNode } from 'react'
import type { Bunch, LedgerEntry, Member, MemberKind } from '@shared/types'
import type { TickReading } from '@shared/ticks'
import { Modal } from '@renderer/ui/Modal'
import { BunchChips } from './BunchChips'
import { SkillDomainGrid } from './SkillDomainGrid'

interface Props {
  ticks: TickReading
  members: Member[]
  bunches: Bunch[]
  ledger: LedgerEntry[]
  missingMemberIds: string[]
  missingRawPaths: string[]
  activeBunchId: string | null
  /** Working folder, archive box and raw folder (Task 10). */
  locations?: ReactNode
  /** The Save button (Task 10). */
  footer?: ReactNode
  onToggleSkill: (id: string) => void
  onToggleDomain: (id: string) => void
  onToggleCell: (skillId: string, domainId: string) => void
  onApplyBunch: (id: string) => void
  onEditBunch: (id: string) => void
  onSaveAsBunch: () => void
  onEditMember: (id: string) => void
  onAddMember: (kind: MemberKind, name?: string) => void
  onOpenHelp: () => void
}

export function LocationsPane(props: Props) {
  const [explaining, setExplaining] = useState(false)
  const broken = !props.ticks.ok

  return (
    <div className="locations">
      <div className="locations-head">
        <h2 className="locations-title">Funky Bunch locations</h2>
        <button className="btn btn-quiet btn-tight" aria-label="What is this?" onClick={() => setExplaining(true)}>
          ?
        </button>
      </div>

      {props.locations}

      <BunchChips
        bunches={props.bunches}
        activeId={props.activeBunchId}
        missingRawPaths={props.missingRawPaths}
        disabled={broken}
        onApply={props.onApplyBunch}
        onEdit={props.onEditBunch}
        onSaveAsBunch={props.onSaveAsBunch}
      />

      {props.ticks.unknown.length > 0 && (
        <div className="unknown-chips">
          {props.ticks.unknown.map((u) => (
            <button key={`${u.kind}:${u.name}`} type="button" className="unknown-chip" onClick={() => props.onAddMember(u.kind, u.name)}>
              {u.name} isn&apos;t a {u.kind} yet. Add it?
            </button>
          ))}
        </div>
      )}

      <SkillDomainGrid
        members={props.members}
        ledger={props.ledger}
        skillIds={props.ticks.skillIds}
        domainIds={props.ticks.domainIds}
        missingMemberIds={props.missingMemberIds}
        disabled={broken}
        blockedReason={props.ticks.reason}
        onToggleSkill={props.onToggleSkill}
        onToggleDomain={props.onToggleDomain}
        onToggleCell={props.onToggleCell}
        onEditMember={props.onEditMember}
        onAddMember={(kind) => props.onAddMember(kind)}
      />

      {props.footer}

      {explaining && (
        <Modal
          title="Funky Bunch locations"
          onClose={() => setExplaining(false)}
          footer={
            <>
              <button
                className="btn btn-quiet"
                onClick={() => {
                  setExplaining(false)
                  props.onOpenHelp()
                }}
              >
                Open the full guide
              </button>
              <span className="spacer" />
              <button className="btn btn-primary" onClick={() => setExplaining(false)}>
                Got it
              </button>
            </>
          }
        >
          <p>
            <strong>Skill folders</strong> do a kind of work. They hold the skills and the CLAUDE.md for it, and they
            cut across many projects. <strong>Domain folders</strong> gather everything about one subject.
          </p>
          <p>
            Tick the skills and domains a note belongs to. The ticks are written into the note&apos;s YAML, which is
            what your second brain&apos;s agents search when they look for it later.
          </p>
          <p>
            A <strong>bunch</strong> is a saved set of ticks plus a raw folder, like a group chat. Click one to apply
            it. Tick <strong>Archive / distribute</strong> when this version is a milestone: Save then also drops a
            dated copy into the raw folder.
          </p>
        </Modal>
      )}
    </div>
  )
}
