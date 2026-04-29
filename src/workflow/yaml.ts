/**
 * Minimal YAML block-style parser for GraphDef definitions.
 *
 * Supports:
 *   - Block mappings: `key: value`
 *   - Block sequences: `- item`
 *   - Nested objects and arrays (indentation-based)
 *   - Double-quoted and single-quoted strings
 *   - Bare scalar strings
 *   - Integer and float numbers
 *   - null / ~ / true / false literals
 *   - Inline comments (# outside of quoted strings)
 *
 * Does NOT support:
 *   - Anchors (&) and aliases (*)
 *   - Tags (!)
 *   - Flow style ({ } and [ ])
 *   - Multi-line block scalars (| and >)
 *   - Tabs as indentation (spaces only)
 *
 * This is intentionally scoped to the subset used by GraphDef files.
 * For documents outside this subset, use JSON.
 */

export type YamlValue =
  | string
  | number
  | boolean
  | null
  | YamlValue[]
  | { [key: string]: YamlValue }

// A preprocessed YAML line with its indentation stripped to a number.
type Line = {
  indent: number
  text: string // full line content (not trimmed)
  lineNo: number // 1-based for error messages
}

function getIndent(line: string): number {
  let i = 0
  while (i < line.length && line[i] === " ") i++
  return i
}

/**
 * Strip an inline comment (# not inside quoted strings).
 * Returns the line content up to (but not including) the comment marker,
 * right-trimmed.
 */
function stripComment(line: string): string {
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (c === "'" && !inDouble) {
      inSingle = !inSingle
      continue
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble
      continue
    }
    if (c === "#" && !inSingle && !inDouble) {
      return line.slice(0, i).trimEnd()
    }
  }
  return line
}

function preprocess(text: string): Line[] {
  const result: Line[] = []
  const rawLines = text.split("\n")
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i]!
    const withoutComment = stripComment(raw).trimEnd()
    if (withoutComment.trim() === "") continue // blank or comment-only
    result.push({
      indent: getIndent(withoutComment),
      text: withoutComment,
      lineNo: i + 1,
    })
  }
  return result
}

function parseScalar(raw: string): YamlValue {
  const v = raw.trim()
  if (v === "null" || v === "~" || v === "") return null
  if (v === "true") return true
  if (v === "false") return false
  // Flow-style empty sequence / mapping
  if (v === "[]") return []
  if (v === "{}") return {}
  // Double-quoted string
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    return v
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\")
  }
  // Single-quoted string — only '' escape inside single quotes
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) {
    return v.slice(1, -1).replace(/''/g, "'")
  }
  // Integer
  if (/^-?\d+$/.test(v)) return parseInt(v, 10)
  // Float
  if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v)
  return v
}

/**
 * Parse a block value starting at lines[idx].
 * All lines in this block have indent >= baseIndent.
 * Returns [value, nextIdx].
 */
function parseBlock(
  lines: Line[],
  idx: number,
  baseIndent: number,
): [YamlValue, number] {
  if (idx >= lines.length) return [null, idx]
  const firstLine = lines[idx]!
  const trimmed = firstLine.text.trimStart()
  if (trimmed === "-" || trimmed.startsWith("- ")) {
    return parseSequence(lines, idx, baseIndent)
  }
  return parseMapping(lines, idx, baseIndent)
}

/**
 * Parse a YAML block mapping starting at lines[idx], where every entry
 * is at exactly `indent` spaces of indentation.
 * Stops when a line is found with indent < `indent` or a non-mapping line.
 */
function parseMapping(
  lines: Line[],
  idx: number,
  indent: number,
): [{ [key: string]: YamlValue }, number] {
  const result: { [key: string]: YamlValue } = {}

  while (idx < lines.length) {
    const line = lines[idx]!
    if (line.indent < indent) break
    if (line.indent > indent) break // unexpected deeper line — stop

    const trimmed = line.text.trimStart()

    // Must be a key: (with optional value) — keys are identifier-like
    const kvMatch = trimmed.match(/^([\w][\w_.-]*):\s*(.*)$/)
    if (!kvMatch) break // not a mapping entry

    const key = kvMatch[1]!
    const rawValue = kvMatch[2]!.trim()
    idx++

    if (rawValue !== "") {
      result[key] = parseScalar(rawValue)
    } else {
      // Block value on following lines
      if (idx >= lines.length || lines[idx]!.indent <= indent) {
        result[key] = null
      } else {
        const childIndent = lines[idx]!.indent
        const [childValue, newIdx] = parseBlock(lines, idx, childIndent)
        result[key] = childValue
        idx = newIdx
      }
    }
  }

  return [result, idx]
}

/**
 * Parse a YAML block sequence starting at lines[idx], where every `- item`
 * entry has the `-` at exactly `indent` spaces of indentation.
 * Stops when a line is found with indent < `indent` or a non-sequence line.
 */
function parseSequence(
  lines: Line[],
  idx: number,
  indent: number,
): [YamlValue[], number] {
  const result: YamlValue[] = []

  while (idx < lines.length) {
    const line = lines[idx]!
    if (line.indent < indent) break
    if (line.indent > indent) break

    const trimmed = line.text.trimStart()
    if (trimmed !== "-" && !trimmed.startsWith("- ")) break

    const itemContent = trimmed.startsWith("- ") ? trimmed.slice(2).trim() : ""
    idx++

    if (itemContent === "") {
      // Block item — value is on the following lines
      if (idx < lines.length && lines[idx]!.indent > indent) {
        const childIndent = lines[idx]!.indent
        const [childValue, newIdx] = parseBlock(lines, idx, childIndent)
        result.push(childValue)
        idx = newIdx
      } else {
        result.push(null)
      }
    } else {
      // Check if this inline content starts a mapping entry
      const kvMatch = itemContent.match(/^([\w][\w_.-]*):\s*(.*)$/)
      if (kvMatch) {
        const key = kvMatch[1]!
        const rawValue = kvMatch[2]!.trim()
        const obj: { [key: string]: YamlValue } = {}

        if (rawValue !== "") {
          obj[key] = parseScalar(rawValue)
        } else {
          // Inline key has a block value on the following lines
          if (idx < lines.length && lines[idx]!.indent > indent) {
            const childIndent = lines[idx]!.indent
            const [blockVal, newIdx] = parseBlock(lines, idx, childIndent)
            obj[key] = blockVal
            idx = newIdx
          } else {
            obj[key] = null
          }
        }

        // Parse remaining sibling keys of this mapping item.
        // The content indent of items in this sequence is indent + 2 (the
        // column after the '- ' prefix). Stop if we hit something that isn't
        // a mapping key at that indent — e.g. a new '- ' at the parent indent.
        const itemMappingIndent = indent + 2
        if (
          idx < lines.length &&
          lines[idx]!.indent === itemMappingIndent &&
          !lines[idx]!.text.trimStart().startsWith("- ")
        ) {
          const [rest, newIdx] = parseMapping(lines, idx, itemMappingIndent)
          Object.assign(obj, rest)
          idx = newIdx
        }

        result.push(obj)
      } else {
        // Scalar sequence item
        result.push(parseScalar(itemContent))
      }
    }
  }

  return [result, idx]
}

/**
 * Parse a YAML document string into a JavaScript value.
 *
 * Supports the block-style subset described in the module docstring.
 * Throws with a descriptive message if the top-level structure cannot be parsed.
 */
export function parseYaml(text: string): YamlValue {
  const lines = preprocess(text)
  if (lines.length === 0) return null

  const firstLine = lines[0]!
  const trimmed = firstLine.text.trimStart()

  // Top-level sequence
  if (trimmed === "-" || trimmed.startsWith("- ")) {
    const [result] = parseSequence(lines, 0, 0)
    return result
  }

  // Top-level mapping: first line must be a key: entry
  if (/^[\w][\w_.-]*\s*:/.test(trimmed)) {
    const [result] = parseMapping(lines, 0, 0)
    return result
  }

  // Top-level scalar (bare value, quoted string, etc.)
  return parseScalar(trimmed)
}
