import { inputRules, textblockTypeInputRule, wrappingInputRule, InputRule } from 'prosemirror-inputrules'
import type { Schema } from 'prosemirror-model'

/**
 * Typing the Markdown is the lesson, so the shortcuts mirror the syntax exactly:
 * "# " makes a heading, "- " a bullet, "- [ ] " a checkbox.
 */
export function markiInputRules(schema: Schema) {
  const rules: InputRule[] = [
    textblockTypeInputRule(/^(#{1,6})\s$/, schema.nodes.heading, (match) => ({
      level: match[1].length
    })),

    wrappingInputRule(/^\s*([-+*])\s$/, schema.nodes.bullet_list),

    wrappingInputRule(
      /^(\d+)\.\s$/,
      schema.nodes.ordered_list,
      (match) => ({ start: Number(match[1]) }),
      (match, node) => node.childCount + node.attrs.start === Number(match[1])
    ),

    // "---" on its own line becomes a rule
    new InputRule(/^(?:---|\*\*\*|___)$/, (state, _match, start, end) => {
      const tr = state.tr.replaceRangeWith(start, end, schema.nodes.horizontal_rule.create())
      return tr
    }),

    // "**bold**" and "*italic*" as you close them
    markInputRule(/(?:\*\*)([^*]+)(?:\*\*)$/, schema.marks.strong),
    markInputRule(/(?<![*])\*([^*]+)\*$/, schema.marks.em),
    markInputRule(/(?:`)([^`]+)(?:`)$/, schema.marks.code)
  ]
  return inputRules({ rules })
}

/**
 * True only when the range is made purely of text. Wikilinks, images and anything
 * else the clean pane holds verbatim are single atoms: replacing a range containing
 * one would swap the student's link for an invisible placeholder character.
 */
function isPlainText(doc: import('prosemirror-model').Node, from: number, to: number): boolean {
  let plain = true
  doc.nodesBetween(from, to, (node) => {
    if (!plain) return false
    if (node.isText || node.isTextblock) return true
    if (node.isInline || node.isAtom) {
      plain = false
      return false
    }
    return true
  })
  return plain
}

function markInputRule(pattern: RegExp, markType: import('prosemirror-model').MarkType): InputRule {
  return new InputRule(pattern, (state, match, start, end) => {
    const text = match[1]
    if (!text) return null
    if (!isPlainText(state.doc, start, end)) return null
    const tr = state.tr
    tr.replaceWith(start, end, state.schema.text(text, [markType.create()]))
    tr.removeStoredMark(markType)
    return tr
  })
}
