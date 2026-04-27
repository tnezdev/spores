import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import type { GraphDef, Run, Transition } from "../types.js"
import type { Source } from "../sources/source.js"
import type { WorkflowAdapter } from "./adapter.js"

interface NodeError extends Error {
  code?: string | undefined
}

function isNodeError(err: unknown): err is NodeError {
  return err instanceof Error
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") return []
    throw err
  }
}

export class FilesystemWorkflowAdapter implements WorkflowAdapter {
  private graphsDir: string
  private runsDir: string

  constructor(baseDir: string) {
    this.graphsDir = join(baseDir, ".spores", "workflows")
    this.runsDir = join(baseDir, ".spores", "runs")
  }

  // ---- Graphs --------------------------------------------------------------

  async saveGraph(graph: GraphDef): Promise<void> {
    await mkdir(this.graphsDir, { recursive: true })
    await writeFile(
      join(this.graphsDir, `${graph.id}.json`),
      JSON.stringify(graph, null, 2),
    )
  }

  async saveSourceGraph(graph: GraphDef): Promise<void> {
    await mkdir(this.graphsDir, { recursive: true })
    await writeFile(
      join(this.graphsDir, `${graph.id}.source.json`),
      JSON.stringify(graph, null, 2),
    )
  }

  async loadSourceGraph(graphId: string): Promise<GraphDef | undefined> {
    try {
      const data = await readFile(
        join(this.graphsDir, `${graphId}.source.json`),
        "utf-8",
      )
      return JSON.parse(data) as GraphDef
    } catch (err) {
      if (isNodeError(err) && err.code === "ENOENT") return undefined
      throw err
    }
  }

  async loadGraph(graphId: string): Promise<GraphDef | undefined> {
    try {
      const data = await readFile(
        join(this.graphsDir, `${graphId}.json`),
        "utf-8",
      )
      return JSON.parse(data) as GraphDef
    } catch (err) {
      if (isNodeError(err) && err.code === "ENOENT") return undefined
      throw err
    }
  }

  async listGraphs(): Promise<GraphDef[]> {
    const files = await safeReaddir(this.graphsDir)
    const graphs: GraphDef[] = []
    for (const file of files) {
      if (!file.endsWith(".json") || file.endsWith(".source.json")) continue
      const data = await readFile(join(this.graphsDir, file), "utf-8")
      graphs.push(JSON.parse(data) as GraphDef)
    }
    return graphs
  }

  // ---- Runs ----------------------------------------------------------------

  async createRun(graphId: string, name?: string): Promise<Run> {
    await mkdir(this.runsDir, { recursive: true })
    const run: Run = {
      run_id: randomUUID(),
      graph_id: graphId,
      ...(name !== undefined ? { name } : {}),
      created_at: new Date().toISOString(),
      history: [],
    }
    await writeFile(
      join(this.runsDir, `${run.run_id}.json`),
      JSON.stringify(run, null, 2),
    )
    return run
  }

  async loadRun(runId: string): Promise<Run | undefined> {
    try {
      const data = await readFile(
        join(this.runsDir, `${runId}.json`),
        "utf-8",
      )
      return JSON.parse(data) as Run
    } catch (err) {
      if (isNodeError(err) && err.code === "ENOENT") return undefined
      throw err
    }
  }

  async listRuns(graphId?: string): Promise<Run[]> {
    const files = await safeReaddir(this.runsDir)
    const runs: Run[] = []
    for (const file of files) {
      if (!file.endsWith(".json")) continue
      const data = await readFile(join(this.runsDir, file), "utf-8")
      const run = JSON.parse(data) as Run
      if (graphId === undefined || run.graph_id === graphId) {
        runs.push(run)
      }
    }
    return runs
  }

  async appendTransition(runId: string, transition: Transition): Promise<void> {
    const filePath = join(this.runsDir, `${runId}.json`)
    const data = await readFile(filePath, "utf-8")
    const run = JSON.parse(data) as Run
    run.history.push(transition)
    await writeFile(filePath, JSON.stringify(run, null, 2))
  }
}

// ---------------------------------------------------------------------------
// Source-based graph loading
//
// Compass + remote runtimes load `GraphDef`s from non-filesystem sources
// (DB, layered seed-then-emerge). The Source abstraction handles the read
// path; run state stays on the adapter (it's runtime data, not config).
//
// Source records carrying names ending in `.source` are skipped — those
// are the un-expanded source graphs the adapter writes alongside compiled
// graphs. Same exclusion the filesystem `listGraphs` enforces.
// ---------------------------------------------------------------------------

const SOURCE_GRAPH_SUFFIX = ".source"

/**
 * Load a graph definition by ID from any source. Source records are raw
 * JSON text; this parses them into `GraphDef`. Returns undefined when the
 * source has no record by that ID.
 *
 * Throws on JSON parse error — a malformed graph is a real bug, not a
 * "not found" case.
 */
export async function loadGraphFromSource(
  graphId: string,
  source: Source,
): Promise<GraphDef | undefined> {
  const record = await source.read(graphId)
  if (record === undefined) return undefined
  return JSON.parse(record.text) as GraphDef
}

/**
 * List all compiled graph definitions exposed by a source. Skips records
 * whose names end in `.source` (those are un-expanded source graphs that
 * pair with compiled graphs in the adapter's filesystem layout). Throws
 * on JSON parse error.
 */
export async function listGraphsFromSource(
  source: Source,
): Promise<GraphDef[]> {
  const names = await source.list()
  const graphs: GraphDef[] = []

  for (const name of names) {
    if (name.endsWith(SOURCE_GRAPH_SUFFIX)) continue
    const record = await source.read(name)
    if (record === undefined) continue
    graphs.push(JSON.parse(record.text) as GraphDef)
  }

  return graphs
}
