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
      <h3 className="section-head">The two sides</h3>
      <p>
        The left side is the real Markdown, the code your note is made of. The right side is the same note,
        tidied up. Type on either side and the other keeps up.
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
        Down the left edge are your <strong>bunches</strong>. A bunch is a group of{' '}
        <strong>agents</strong> (folders that do work) and <strong>artifacts</strong> (folders that hold what
        the work produces), like a group chat. Click the bunch this note is for, then press File.
      </p>
      <p>
        Filing writes the note once, into that bunch&apos;s <strong>raw</strong> folder, with the agents and
        artifacts written into the note&apos;s properties so your second brain knows who it is for.
      </p>
      <p className="muted">
        The team board (the grid button on the strip) shows your agents across the top and your artifacts down the
        side, with how many notes have gone to each pair.
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
            <td>code, split or text view</td>
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
