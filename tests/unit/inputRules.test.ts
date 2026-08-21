import { describe, expect, test } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import type { Transaction } from 'prosemirror-state'
import { schema } from '@renderer/editors/pm/schema'
import { markiInputRules } from '@renderer/editors/pm/inputRules'
import { serializeDoc } from '@renderer/editors/pm/bridge'

const plugin = markiInputRules(schema)

type TextInput = (view: unknown, from: number, to: number, text: string) => boolean | undefined
const handleTextInput = plugin.props.handleTextInput as unknown as TextInput

interface Applied {
  handled: boolean
  state: EditorState
}

/** Feeds one character to the input rules, the way typing does. */
function typeCharacter(start: EditorState, character: string): Applied {
  let state = start
  const pos = state.selection.head
  const view = {
    state,
    dispatch: (tr: Transaction) => {
      state = state.apply(tr)
    }
  }
  const handled = Boolean(handleTextInput(view, pos, pos, character))
  return { handled, state }
}

function paragraph(...inline: ReturnType<typeof schema.text>[]): EditorState {
  const doc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create(null, inline)])
  const state = EditorState.create({ doc, plugins: [plugin] })
  return state.apply(state.tr.setSelection(TextSelection.atEnd(doc)))
}

describe('the bold and italic input rules', () => {
  test('turn plain text into a mark', () => {
    const result = typeCharacter(paragraph(schema.text('say **hello*')), '*')
    expect(result.handled).toBe(true)
    expect(serializeDoc(result.state.doc)).toContain('**hello**')
  })

  test('leave a wikilink alone rather than swallowing it', () => {
    const wiki = schema.nodes.raw_inline.create({ value: '[[Working memory]]' })
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [schema.text('See **'), wiki, schema.text('*')])
    ])
    let state = EditorState.create({ doc, plugins: [plugin] })
    state = state.apply(state.tr.setSelection(TextSelection.atEnd(doc)))

    const result = typeCharacter(state, '*')
    expect(result.handled).toBe(false)
    const out = serializeDoc(result.state.doc)
    expect(out).toContain('[[Working memory]]')
    expect(out).not.toContain(String.fromCharCode(0xfffc))
  })

  test('never write the object replacement character into a note', () => {
    const wiki = schema.nodes.raw_inline.create({ value: '[[Note]]' })
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [schema.text('a *'), wiki])
    ])
    const state = EditorState.create({ doc, plugins: [plugin] })
    expect(serializeDoc(state.doc)).not.toContain(String.fromCharCode(0xfffc))
  })
})

describe('the heading and list rules still work', () => {
  test('hash space makes a heading', () => {
    const result = typeCharacter(paragraph(schema.text('#')), ' ')
    expect(result.state.doc.child(0).type.name).toBe('heading')
  })

  test('dash space makes a bullet', () => {
    const result = typeCharacter(paragraph(schema.text('-')), ' ')
    expect(result.state.doc.child(0).type.name).toBe('bullet_list')
  })

  test('a number and a dot make a numbered list', () => {
    const result = typeCharacter(paragraph(schema.text('1.')), ' ')
    expect(result.state.doc.child(0).type.name).toBe('ordered_list')
  })
})
