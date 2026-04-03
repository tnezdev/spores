import type {
  Memory,
  RecallResult,
  DreamResult,
  GraphDef,
  Run,
  NodeState,
  Transition,
} from "../types.js"

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

// ---------------------------------------------------------------------------
// Workflow formatters
// ---------------------------------------------------------------------------

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  )
  const sep = widths.map((w) => "-".repeat(w)).join("  ")
  const fmt = (row: string[]) =>
    row.map((cell, i) => cell.padEnd(widths[i]!)).join("  ")
  return [fmt(headers), sep, ...rows.map(fmt)].join("\n")
}

export function formatGraphs(graphs: GraphDef[]): string {
  if (graphs.length === 0) return "No graphs registered."
  return table(
    ["ID", "NAME", "VERSION", "NODES"],
    graphs.map((g) => [g.id, g.name, g.version, String(g.nodes.length)]),
  )
}

export function formatRuns(runs: Run[]): string {
  if (runs.length === 0) return "No runs."
  return table(
    ["RUN", "GRAPH", "NAME", "CREATED"],
    runs.map((r) => [r.run_id, r.graph_id, r.name ?? "", r.created_at]),
  )
}

export function formatStatus(
  states: Record<string, NodeState>,
  graph: GraphDef,
): string {
  const rows: string[][] = []
  for (const node of graph.nodes) {
    const s = states[node.id]
    if (!s) continue
    rows.push([s.node_id, s.status, String(s.pass), s.artifact?.type ?? "-"])
  }
  return table(["NODE", "STATUS", "PASS", "ARTIFACT"], rows)
}

export function formatNext(nodeIds: string[]): string {
  if (nodeIds.length === 0) return "No available nodes."
  return nodeIds.join("\n")
}

export function formatTransition(t: Transition): string {
  const parts = [
    `${t.node_id}: ${t.from_status} → ${t.to_status}`,
    `pass=${t.pass}`,
    `by=${t.identity}`,
    `at=${t.timestamp}`,
  ]
  if (t.reason) parts.push(`reason=${t.reason}`)
  if (t.artifact) parts.push(`artifact=${t.artifact.type}`)
  return parts.join("  ")
}

export function formatHistory(transitions: Transition[]): string {
  if (transitions.length === 0) return "No history."
  return transitions.map(formatTransition).join("\n")
}
