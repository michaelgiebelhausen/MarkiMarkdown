import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeSanitize from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'

/**
 * Renders a verbatim block (a table, a quote, a code fence) as read-only HTML so the
 * clean side still looks like a document. Raw HTML in the note is escaped, then the
 * tree is sanitised, so nothing a note contains can execute.
 */
const pipeline = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeSanitize)
  .use(rehypeStringify)

export function renderVerbatim(markdown: string): string {
  try {
    return String(pipeline.processSync(markdown))
  } catch {
    return ''
  }
}
