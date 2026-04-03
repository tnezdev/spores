import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import type { GraphDef, Run, Transition } from "../types.js"
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
