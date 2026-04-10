import { readFile } from "node:fs/promises"
import type { Command, Ctx } from "../context.js"
import { output } from "../output.js"
import { FilesystemWorkflowAdapter } from "../../workflow/filesystem.js"
import { Runtime } from "../../workflow/runtime.js"
import { fireHook } from "../../hooks/fire.js"
import type {
  GraphDef,
  WorkflowRunStartedOutput,
  WorkflowRunTerminatedOutput,
} from "../../types.js"
import {
  formatGraphs,
  formatRuns,
  formatStatus,
  formatNext,
  formatHistory,
  formatWorkflowRunStarted,
  formatWorkflowRunTerminated,
} from "../format.js"

function makeRuntime(ctx: Ctx): Runtime {
  const adapter = new FilesystemWorkflowAdapter(ctx.baseDir)
  return new Runtime(adapter)
}

function identity(flags: Record<string, string | true>): string {
  if (typeof flags["identity"] === "string") return flags["identity"]
  return process.env["USER"] ?? "anonymous"
}

/**
 * After a node transition, check whether the run has reached a terminal state.
 * If so, fire the `workflow.run.terminated` hook and return the output;
 * otherwise return null.
 *
 * A run is terminal when every node is in a "done" state: completed, failed,
 * or invalidated. Nodes that are still pending or in_progress mean there is
 * work left to do. Failed nodes ARE terminal — they may be retried, but the
 * run has stopped progressing on its own.
 * Design + catalog: tnezdev/spores#26.
 */
async function maybeFireTerminated(
  rt: Runtime,
  runId: string,
  ctx: Ctx,
): Promise<WorkflowRunTerminatedOutput | null> {
  const run = await rt.getRun(runId)
  if (!run) return null
  const graph = await rt.getGraph(run.graph_id)
  if (!graph) return null

  const states = rt.deriveNodeStates(graph, run)

  const anyActive = Object.values(states).some(
    (s) => s.status === "pending" || s.status === "in_progress",
  )
  if (anyActive) return null

  // Determine outcome: failed if any terminal node failed, else completed.
  const outcome = Object.values(states).some((s) => s.status === "failed")
    ? "failed"
    : "completed"

  const hook = await fireHook(
    "workflow.run.terminated",
    {
      SPORES_RUN_ID: run.run_id,
      SPORES_GRAPH_ID: run.graph_id,
      SPORES_RUN_OUTCOME: outcome,
    },
    ctx.baseDir,
  )

  return {
    run_id: run.run_id,
    graph_id: run.graph_id,
    outcome,
    hook: hook.ran ? hook : undefined,
  }
}

// ---- Graph management -----------------------------------------------------

export const workflowCreateCommand: Command = async (ctx, args) => {
  const file = args[0]
  if (!file) throw new Error("Usage: spores workflow create <file.json>")

  const data = await readFile(file, "utf-8")
  const graph = JSON.parse(data) as GraphDef

  if (!graph.id || !graph.name || !graph.version || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error("Invalid graph: must have id, name, version, nodes[], and edges[]")
  }

  const rt = makeRuntime(ctx)
  await rt.registerGraph(graph)

  output(ctx, { registered: graph.id, name: graph.name }, (d) =>
    `Registered graph: ${d.registered} (${d.name})`,
  )
}

export const workflowListCommand: Command = async (ctx) => {
  const rt = makeRuntime(ctx)
  const graphs = await rt.listGraphs()
  output(ctx, graphs, formatGraphs)
}

export const workflowShowCommand: Command = async (ctx, args) => {
  const graphId = args[0]
  if (!graphId) throw new Error("Usage: spores workflow show <graph-id>")

  const rt = makeRuntime(ctx)
  const graph = await rt.getGraph(graphId)
  if (!graph) throw new Error(`Unknown graph: ${graphId}`)

  output(ctx, graph, (g) => {
    const lines = [`${g.name} (${g.id}) v${g.version}`]
    if (g.description) lines.push(`  ${g.description}`)
    lines.push("")
    lines.push("Nodes:")
    for (const n of g.nodes) {
      const tags = [n.artifact_type]
      if (n.type === "manual") tags.push("manual")
      lines.push(`  ${n.id} — ${n.label} [${tags.join(", ")}]`)
    }
    lines.push("")
    lines.push("Edges:")
    for (const e of g.edges) {
      const cond =
        e.condition && e.condition !== "always"
          ? ` (${e.condition.criteria})`
          : ""
      lines.push(`  ${e.from} → ${e.to}${cond}`)
    }
    return lines.join("\n")
  })
}

// ---- Run lifecycle --------------------------------------------------------

export const workflowRunCommand: Command = async (ctx, args, flags) => {
  const graphId = args[0]
  if (!graphId) throw new Error("Usage: spores workflow run <graph-id>")

  const name = typeof flags["name"] === "string" ? flags["name"] : undefined
  const rt = makeRuntime(ctx)
  const run = await rt.createRun(graphId, name)

  const hook = await fireHook(
    "workflow.run.started",
    {
      SPORES_RUN_ID: run.run_id,
      SPORES_GRAPH_ID: run.graph_id,
    },
    ctx.baseDir,
  )

  const started: WorkflowRunStartedOutput = {
    run_id: run.run_id,
    graph_id: run.graph_id,
    hook: hook.ran ? hook : undefined,
  }

  output(ctx, started, formatWorkflowRunStarted)

  if (hook.ran) {
    if (hook.stderr.length > 0) process.stderr.write(hook.stderr)
    if (hook.error !== undefined) {
      process.stderr.write(`[hook warning] workflow.run.started: ${hook.error}\n`)
    } else if (hook.exit_code !== null && hook.exit_code !== 0) {
      process.stderr.write(`[hook warning] workflow.run.started exited ${hook.exit_code}\n`)
    }
  }
}

// ---- Workflow execution ---------------------------------------------------

export const workflowStatusCommand: Command = async (ctx, args) => {
  const runId = args[0]
  if (!runId) throw new Error("Usage: spores workflow status <run-id>")

  const rt = makeRuntime(ctx)
  const run = await rt.getRun(runId)
  if (!run) throw new Error(`Unknown run: ${runId}`)
  const graph = await rt.getGraph(run.graph_id)
  if (!graph) throw new Error(`Unknown graph: ${run.graph_id}`)

  const states = rt.deriveNodeStates(graph, run)
  output(ctx, states, (s) => formatStatus(s, graph))
}

export const workflowNextCommand: Command = async (ctx, args) => {
  const runId = args[0]
  if (!runId) throw new Error("Usage: spores workflow next <run-id>")

  const rt = makeRuntime(ctx)
  const run = await rt.getRun(runId)
  if (!run) throw new Error(`Unknown run: ${runId}`)

  const available = await rt.next(run.graph_id, runId)
  output(ctx, available, formatNext)
}

export const workflowStartCommand: Command = async (ctx, args, flags) => {
  const runId = args[0]
  const nodeId = args[1]
  if (!runId || !nodeId)
    throw new Error("Usage: spores workflow start <run-id> <node-id>")

  const rt = makeRuntime(ctx)
  const run = await rt.getRun(runId)
  if (!run) throw new Error(`Unknown run: ${runId}`)

  const t = await rt.transition(
    run.graph_id,
    runId,
    nodeId,
    "in_progress",
    identity(flags),
  )
  output(ctx, t, (t) => `Started: ${t.node_id} (pass ${t.pass})`)
}

export const workflowDoneCommand: Command = async (ctx, args, flags) => {
  const runId = args[0]
  const nodeId = args[1]
  if (!runId || !nodeId)
    throw new Error("Usage: spores workflow done <run-id> <node-id>")

  const rt = makeRuntime(ctx)
  const run = await rt.getRun(runId)
  if (!run) throw new Error(`Unknown run: ${runId}`)

  const reason =
    typeof flags["reason"] === "string" ? flags["reason"] : undefined

  const t = await rt.transition(
    run.graph_id,
    runId,
    nodeId,
    "completed",
    identity(flags),
    reason ? { reason } : undefined,
  )
  output(ctx, t, (t) => `Completed: ${t.node_id} (pass ${t.pass})`)

  const terminated = await maybeFireTerminated(rt, runId, ctx)
  if (terminated !== null) {
    output(ctx, terminated, formatWorkflowRunTerminated)
    const hook = terminated.hook
    if (hook !== undefined && hook.ran) {
      if (hook.stderr.length > 0) process.stderr.write(hook.stderr)
      if (hook.error !== undefined) {
        process.stderr.write(`[hook warning] workflow.run.terminated: ${hook.error}\n`)
      } else if (hook.exit_code !== null && hook.exit_code !== 0) {
        process.stderr.write(`[hook warning] workflow.run.terminated exited ${hook.exit_code}\n`)
      }
    }
  }
}

export const workflowFailCommand: Command = async (ctx, args, flags) => {
  const runId = args[0]
  const nodeId = args[1]
  if (!runId || !nodeId)
    throw new Error("Usage: spores workflow fail <run-id> <node-id>")

  const rt = makeRuntime(ctx)
  const run = await rt.getRun(runId)
  if (!run) throw new Error(`Unknown run: ${runId}`)

  const reason =
    typeof flags["reason"] === "string" ? flags["reason"] : undefined

  const t = await rt.transition(
    run.graph_id,
    runId,
    nodeId,
    "failed",
    identity(flags),
    reason ? { reason } : undefined,
  )
  output(ctx, t, (t) => `Failed: ${t.node_id} (pass ${t.pass})`)

  const terminated = await maybeFireTerminated(rt, runId, ctx)
  if (terminated !== null) {
    output(ctx, terminated, formatWorkflowRunTerminated)
    const hook = terminated.hook
    if (hook !== undefined && hook.ran) {
      if (hook.stderr.length > 0) process.stderr.write(hook.stderr)
      if (hook.error !== undefined) {
        process.stderr.write(`[hook warning] workflow.run.terminated: ${hook.error}\n`)
      } else if (hook.exit_code !== null && hook.exit_code !== 0) {
        process.stderr.write(`[hook warning] workflow.run.terminated exited ${hook.exit_code}\n`)
      }
    }
  }
}

export const workflowHistoryCommand: Command = async (ctx, args) => {
  const runId = args[0]
  if (!runId) throw new Error("Usage: spores workflow history <run-id>")

  const rt = makeRuntime(ctx)
  const run = await rt.getRun(runId)
  if (!run) throw new Error(`Unknown run: ${runId}`)

  output(ctx, run.history, formatHistory)
}
