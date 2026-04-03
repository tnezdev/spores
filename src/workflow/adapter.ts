import type { GraphDef, Run, Transition } from "../types.js"

export interface WorkflowAdapter {
  saveGraph(graph: GraphDef): Promise<void>
  loadGraph(graphId: string): Promise<GraphDef | undefined>
  listGraphs(): Promise<GraphDef[]>
  saveSourceGraph?(graph: GraphDef): Promise<void>
  loadSourceGraph?(graphId: string): Promise<GraphDef | undefined>

  createRun(graphId: string, name?: string): Promise<Run>
  loadRun(runId: string): Promise<Run | undefined>
  listRuns(graphId?: string): Promise<Run[]>
  appendTransition(runId: string, transition: Transition): Promise<void>
}
