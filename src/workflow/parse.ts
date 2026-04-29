import type { GraphDef } from "../types.js"
import { parseYaml } from "./yaml.js"

/**
 * Parse a graph definition from a JSON or YAML string.
 *
 * Detection is by file extension hint (`locator`), falling back to
 * content sniffing: a string starting with `{` is treated as JSON,
 * everything else is treated as YAML.
 *
 * The `locator` parameter is included in error messages to identify
 * the source when parsing fails (e.g. a filename, R2 key, or URL).
 *
 * @throws {Error} if the text cannot be parsed or the result is not
 * a non-null object.
 */
export function parseGraph(text: string, locator?: string): GraphDef {
  const label = locator ? ` (${locator})` : ""

  let raw: unknown
  if (
    locator?.endsWith(".yaml") ||
    locator?.endsWith(".yml") ||
    (!locator && !text.trimStart().startsWith("{"))
  ) {
    try {
      raw = parseYaml(text)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Failed to parse YAML graph definition${label}: ${msg}`)
    }
  } else {
    try {
      raw = JSON.parse(text) as unknown
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Failed to parse JSON graph definition${label}: ${msg}`)
    }
  }

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(
      `Graph definition${label} must be a non-null object, got ${raw === null ? "null" : Array.isArray(raw) ? "array" : typeof raw}`,
    )
  }

  return raw as GraphDef
}
