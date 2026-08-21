import { Schema } from 'prosemirror-model'

/**
 * A deliberately small schema: the constructs students actually write.
 * Anything else is carried as a read-only `raw_block` / `raw_inline` holding the
 * original source text, so it renders but can never be rewritten by this pane.
 */
export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },

    paragraph: {
      group: 'block',
      content: 'inline*',
      parseDOM: [{ tag: 'p' }],
      toDOM: () => ['p', 0]
    },

    heading: {
      group: 'block',
      content: 'inline*',
      defining: true,
      attrs: { level: { default: 1 } },
      parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
      toDOM: (node) => [`h${node.attrs.level}`, 0]
    },

    bullet_list: {
      group: 'block',
      content: 'list_item+',
      attrs: { spread: { default: false } },
      parseDOM: [{ tag: 'ul' }],
      toDOM: () => ['ul', 0]
    },

    ordered_list: {
      group: 'block',
      content: 'list_item+',
      attrs: { start: { default: 1 }, spread: { default: false } },
      parseDOM: [
        {
          tag: 'ol',
          getAttrs: (dom) => ({ start: Number((dom as HTMLElement).getAttribute('start')) || 1 })
        }
      ],
      toDOM: (node) =>
        node.attrs.start === 1 ? ['ol', 0] : ['ol', { start: node.attrs.start }, 0]
    },

    list_item: {
      content: 'block+',
      defining: true,
      attrs: { checked: { default: null }, spread: { default: false } },
      parseDOM: [{ tag: 'li' }],
      toDOM: (node) => {
        const checked = node.attrs.checked
        if (checked === null) return ['li', 0]
        return ['li', { class: checked ? 'task task-done' : 'task', 'data-checked': String(checked) }, 0]
      }
    },

    horizontal_rule: {
      group: 'block',
      atom: true,
      parseDOM: [{ tag: 'hr' }],
      toDOM: () => ['hr']
    },

    raw_block: {
      group: 'block',
      atom: true,
      selectable: true,
      isolating: true,
      attrs: { value: { default: '' } },
      parseDOM: [
        {
          tag: 'div[data-raw-block]',
          getAttrs: (dom) => ({ value: (dom as HTMLElement).getAttribute('data-raw-block') || '' })
        }
      ],
      toDOM: (node) => ['div', { 'data-raw-block': node.attrs.value, class: 'raw-block' }]
    },

    text: { group: 'inline' },

    raw_inline: {
      group: 'inline',
      inline: true,
      atom: true,
      selectable: true,
      attrs: { value: { default: '' } },
      parseDOM: [
        {
          tag: 'span[data-raw-inline]',
          getAttrs: (dom) => ({ value: (dom as HTMLElement).getAttribute('data-raw-inline') || '' })
        }
      ],
      toDOM: (node) => [
        'span',
        { 'data-raw-inline': node.attrs.value, class: 'raw-inline' },
        node.attrs.value
      ]
    }
  },

  // Order matters: the first mark becomes the outermost wrapper when serialising.
  marks: {
    link: {
      attrs: { href: { default: '' }, title: { default: null } },
      inclusive: false,
      parseDOM: [
        {
          tag: 'a[href]',
          getAttrs: (dom) => ({
            href: (dom as HTMLElement).getAttribute('href') || '',
            title: (dom as HTMLElement).getAttribute('title')
          })
        }
      ],
      toDOM: (mark) => ['a', { href: mark.attrs.href, title: mark.attrs.title }, 0]
    },
    strong: {
      parseDOM: [
        { tag: 'strong' },
        { tag: 'b' },
        { style: 'font-weight', getAttrs: (v) => (/^(bold(er)?|[5-9]\d{2,})$/.test(v as string) ? null : false) }
      ],
      toDOM: () => ['strong', 0]
    },
    em: {
      parseDOM: [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }],
      toDOM: () => ['em', 0]
    },
    code: {
      code: true,
      parseDOM: [{ tag: 'code' }],
      toDOM: () => ['code', 0]
    }
  }
})
