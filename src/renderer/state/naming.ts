/** The first heading's text, or empty. */
export function suggestTitle(body: string): string {
  const heading = /^#{1,6}\s+(.+)$/m.exec(body)
  return heading ? heading[1].trim() : ''
}

/** A file name from the first heading, like cell-walls.md, or the fallback. */
export function suggestName(body: string, fallback: string): string {
  const title = suggestTitle(body)
  if (!title) return fallback
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return slug ? `${slug}.md` : fallback
}
