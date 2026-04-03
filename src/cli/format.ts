import type { Memory, RecallResult, DreamResult } from "../types.js"

export function formatMemory(m: Memory): string {
  const tags = m.tags.length > 0 ? ` [${m.tags.join(", ")}]` : ""
  const source = m.source !== undefined ? `\n  source: ${m.source}` : ""
  return [
    `${m.key} (${m.tier})${tags}`,
    `  ${m.content}`,
    `  weight=${m.weight} confidence=${m.confidence.toFixed(2)}${source}`,
    `  ${m.timestamp}`,
  ].join("\n")
}

export function formatRecallResults(results: RecallResult[]): string {
  if (results.length === 0) return "No memories found."
  return results
    .map(
      (r, i) =>
        `${i + 1}. [${r.score.toFixed(3)}] ${r.memory.key} (${r.memory.tier})\n   ${r.memory.content}`,
    )
    .join("\n\n")
}

export function formatDreamResult(r: DreamResult): string {
  const lines: string[] = []
  if (r.promoted.length > 0)
    lines.push(`Promoted: ${r.promoted.join(", ")}`)
  if (r.pruned.length > 0)
    lines.push(`Pruned: ${r.pruned.join(", ")}`)
  if (lines.length === 0) lines.push("No changes.")
  return lines.join("\n")
}
