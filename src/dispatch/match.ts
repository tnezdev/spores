import type { Dispatch, DispatchFilter } from "../types.js"

/**
 * Test whether a dispatch satisfies a declarative filter.
 *
 * A field constraint passes when:
 *   - the filter omits it (no constraint), OR
 *   - the filter is a string and equals the dispatch field, OR
 *   - the filter is an array and includes the dispatch field.
 *
 * The empty filter `{}` matches every dispatch — useful as a catch-all
 * (e.g. a debug logger handler).
 *
 * Pure: no runtime state, no side effects. Compose with predicate
 * functions outside this module if you need richer matching.
 */
export function match(dispatch: Dispatch, filter: DispatchFilter): boolean {
  if (!matchValue(dispatch.from, filter.from)) return false
  if (!matchValue(dispatch.to, filter.to)) return false
  return true
}

function matchValue(
  value: string,
  pattern: string | readonly string[] | undefined,
): boolean {
  if (pattern === undefined) return true
  if (typeof pattern === "string") return value === pattern
  return pattern.includes(value)
}
