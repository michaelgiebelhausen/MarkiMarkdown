import { Modal } from './Modal'

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="How to use MarkiMarkdown"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="spacer" />
          <button className="btn btn-primary" onClick={onClose}>
            Got it
          </button>
        </>
      }
    >
      <h3 className="section-head">The panes</h3>
      <p>
        The middle pane is the real Markdown, the code your note is made of. The right pane is the same note,
        tidied up. Type in either one and the other keeps up. The checkboxes at the top show or hide each pane.
      </p>

      <h3 className="section-head">Markdown in 60 seconds</h3>
      <table className="cheatsheet">
        <tbody>
          <tr>
            <td><code># Heading</code></td>
            <td>a big heading (## and ### are smaller)</td>
          </tr>
          <tr>
            <td><code>**bold**</code></td>
            <td><strong>bold</strong></td>
          </tr>
          <tr>
            <td><code>*italic*</code></td>
            <td><em>italic</em></td>
          </tr>
          <tr>
            <td><code>- item</code></td>
            <td>a bullet</td>
          </tr>
          <tr>
            <td><code>1. item</code></td>
            <td>a numbered list</td>
          </tr>
          <tr>
            <td><code>- [ ] task</code></td>
            <td>a checkbox</td>
          </tr>
          <tr>
            <td><code>---</code></td>
            <td>a dividing line</td>
          </tr>
        </tbody>
      </table>

      <h3 className="section-head">The Funky Bunch</h3>
      <p>
        The left pane is the <strong>Funky Bunch</strong>. Its grid has your <strong>skill folders</strong> across the
        top (folders that do a kind of work, like a CLAUDE.md and its skills) and your <strong>domain folders</strong>{' '}
        down the side (folders that gather everything about one subject). Tick the ones this note belongs to. The
        ticks are written straight into the note&apos;s YAML. Press <strong>View YAML</strong> in the raw pane to watch them appear.
      </p>
      <p>
        <strong>Save</strong> saves the working version where it lives. Tick <strong>Archive / distribute</strong>{' '}
        when this version is a milestone, and Save also drops a dated copy into your second brain&apos;s{' '}
        <strong>raw</strong> folder. Earlier copies are never overwritten.
      </p>
      <p className="muted">
        A bunch is a saved set of ticks plus a raw folder. Click one to apply it; right-click to edit it. The numbers
        in the grid count how many archive copies went to each pair.
      </p>

      <h3 className="section-head">Handy keys</h3>
      <table className="cheatsheet">
        <tbody>
          <tr>
            <td><code>Ctrl/Cmd + S</code></td>
            <td>save</td>
          </tr>
          <tr>
            <td><code>Ctrl/Cmd + O</code></td>
            <td>open a note</td>
          </tr>
          <tr>
            <td><code>Ctrl/Cmd + 1 / 2 / 3</code></td>
            <td>show or hide the Funky Bunch, Raw and Rendered panes</td>
          </tr>
          <tr>
            <td><code>Ctrl/Cmd + B / I</code></td>
            <td>bold, italic</td>
          </tr>
          <tr>
            <td><code>Ctrl/Cmd + Z</code></td>
            <td>undo</td>
          </tr>
        </tbody>
      </table>
    </Modal>
  )
}
