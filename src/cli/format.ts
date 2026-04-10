import type {
  Memory,
  RecallResult,
  DreamResult,
  GraphDef,
  Run,
  NodeState,
  Transition,
  Skill,
  SkillRef,
  Task,
  Persona,
  PersonaActivationOutput,
  TaskDoneOutput,
  WorkflowRunTerminatedOutput,
  PersonaFile,
  PersonaRef,
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

function trunc(s: string, max = 60): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s
}

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

// ---------------------------------------------------------------------------
// Skill formatters
// ---------------------------------------------------------------------------

export function formatSkillRefs(refs: SkillRef[], wide = false): string {
  if (refs.length === 0) return "No skills found."
  return table(
    ["NAME", "DESCRIPTION", "TAGS"],
    refs.map((r) => [r.name, wide ? r.description : trunc(r.description), r.tags.join(", ")]),
  )
}

export function formatSkill(skill: Skill): string {
  const tags = skill.tags.length > 0 ? `\ntags: ${skill.tags.join(", ")}` : ""
  return [`${skill.name}`, `  ${skill.description}${tags}`, "", skill.content].join(
    "\n",
  )
}

// ---------------------------------------------------------------------------
// Task formatters
// ---------------------------------------------------------------------------

export function formatTasks(tasks: Task[], wide = false): string {
  if (tasks.length === 0) return "No tasks."
  return table(
    ["ID", "STATUS", "TAGS", "DESCRIPTION"],
    tasks.map((t) => [
      t.id,
      t.status,
      t.tags.join(","),
      wide ? t.description : trunc(t.description),
    ]),
  )
}

export function formatTask(task: Task): string {
  const lines: string[] = []
  lines.push(`${task.id}  (${task.status})`)
  lines.push(`  ${task.description}`)
  if (task.tags.length > 0) lines.push(`  tags: ${task.tags.join(", ")}`)
  if (task.parent_id !== undefined) lines.push(`  parent: ${task.parent_id}`)
  if (task.workflow_run_id !== undefined)
    lines.push(`  workflow_run: ${task.workflow_run_id}`)
  if (task.wait_until !== undefined)
    lines.push(`  wait_until: ${task.wait_until}`)
  lines.push(`  created: ${task.created_at}`)
  lines.push(`  updated: ${task.updated_at}`)
  if (task.annotations.length > 0) {
    lines.push("  annotations:")
    for (const a of task.annotations) {
      lines.push(`    - [${a.timestamp}] ${a.text}`)
    }
  }
  return lines.join("\n")
}

export function formatNextTask(task: Task | null): string {
  if (task === null) return "No ready tasks."
  const tags = task.tags.length > 0 ? ` [${task.tags.join(", ")}]` : ""
  return `${task.id}  ${task.description}${tags}`
}

/**
 * Human formatter for `task done`: the task details followed by the stdout of
 * a `task.done` hook if one ran and produced output. JSON mode serializes the
 * whole wrapper structurally.
 */
export function formatTaskDone(result: TaskDoneOutput): string {
  const parts = [formatTask(result.task)]
  const hook = result.hook
  if (hook !== undefined && hook.ran && hook.stdout.trim().length > 0) {
    parts.push("\n---\n")
    parts.push(hook.stdout.trimEnd())
  }
  return parts.join("\n")
}

export function formatWorkflowRunTerminated(
  result: WorkflowRunTerminatedOutput,
): string {
  const parts = [
    `Run ${result.run_id} terminated (graph: ${result.graph_id}, outcome: ${result.outcome})`,
  ]
  const hook = result.hook
  if (hook !== undefined && hook.ran && hook.stdout.trim().length > 0) {
    parts.push("\n---\n")
    parts.push(hook.stdout.trimEnd())
  }
  return parts.join("\n")
}

// ---------------------------------------------------------------------------
// Persona formatters
// ---------------------------------------------------------------------------

export function formatPersonaRefs(refs: PersonaRef[], wide = false): string {
  if (refs.length === 0) return "No personas found."
  return table(
    ["NAME", "DESCRIPTION"],
    refs.map((r) => [r.name, wide ? r.description : trunc(r.description)]),
  )
}

function formatMeta(ref: PersonaRef): string {
  const lines: string[] = []
  if (ref.memory_tags.length > 0)
    lines.push(`memory_tags: ${ref.memory_tags.join(", ")}`)
  if (ref.skills.length > 0) lines.push(`skills: ${ref.skills.join(", ")}`)
  if (ref.task_filter !== undefined)
    lines.push(`task_filter: ${JSON.stringify(ref.task_filter)}`)
  if (ref.workflow !== undefined) lines.push(`workflow: ${ref.workflow}`)
  return lines.join("\n")
}

export function formatPersonaFile(file: PersonaFile): string {
  return [
    file.name,
    `  ${file.description}`,
    formatMeta(file),
    "",
    file.body,
  ]
    .filter((s) => s !== "")
    .join("\n")
}

export function formatPersona(persona: Persona): string {
  // Activated output is meant to be piped into an LLM — the body is the
  // payload. Emit the body only, not the metadata header.
  return persona.body
}

/**
 * Human formatter for `persona activate`: the rendered body followed by the
 * stdout of a `persona.activated` hook if one ran and produced output. JSON
 * mode serializes the whole wrapper structurally; this formatter only runs
 * in human mode (see `output()` in src/cli/output.ts).
 */
export function formatPersonaActivation(
  result: PersonaActivationOutput,
): string {
  const parts = [formatPersona(result.persona)]
  const hook = result.hook
  if (hook !== undefined && hook.ran && hook.stdout.trim().length > 0) {
    parts.push("\n---\n")
    parts.push(hook.stdout.trimEnd())
  }
  return parts.join("\n")
}
