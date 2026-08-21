/**
 * Path helpers that work for both Windows and POSIX paths.
 *
 * These live here rather than inline because a regex character class containing a
 * backslash is easy to get wrong, and getting it wrong on Windows silently turns a
 * whole path into a file name.
 */

const BACKSLASH = String.fromCharCode(92)

function lastSeparator(path: string): number {
  return Math.max(path.lastIndexOf('/'), path.lastIndexOf(BACKSLASH))
}

/** The file name at the end of a path. */
export function baseName(path: string): string {
  const index = lastSeparator(path)
  return index === -1 ? path : path.slice(index + 1)
}

/** Everything before the file name, with no trailing separator. */
export function dirName(path: string): string {
  const index = lastSeparator(path)
  return index === -1 ? '' : path.slice(0, index)
}

/** Compares two folder paths the forgiving way a person would. */
export function samePath(a: string, b: string): boolean {
  return normalise(a) === normalise(b)
}

function normalise(path: string): string {
  let out = path.split(BACKSLASH).join('/')
  while (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1)
  return out.toLowerCase()
}
