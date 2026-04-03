import { expandGraph } from "./expand.js"
import type {
  GraphDef,
  NodeState,
  NodeStatus,
  Run,
  Transition,
} from "../types.js"
import type { WorkflowAdapter } from "./adapter.js"

/**
 * Workflow runtime. Validates transitions against graph rules, delegates
 * persistence to a WorkflowAdapter. The agent drives; the runtime enforces.
 */
export class Runtime {
  constructor(private store: WorkflowAdapter) {}

  // ---- Graph management ---------------------------------------------------

  async registerGraph(graph: GraphDef): Promise<void> {
    await this.store.saveSourceGraph?.(graph)
    await this.store.saveGraph(expandGraph(graph))
  }

  async getGraph(graphId: string): Promise<GraphDef | undefined> {
    return this.store.loadGraph(graphId)
  }

  async listGraphs(): Promise<GraphDef[]> {
    return this.store.listGraphs()
  }

  // ---- Run lifecycle ------------------------------------------------------

  async createRun(graphId: string, name?: string): Promise<Run> {
    const graph = await this.store.loadGraph(graphId)
    if (!graph) throw new Error(`Unknown graph: ${graphId}`)
    return this.store.createRun(graphId, name)
  }

  async getRun(runId: string): Promise<Run | undefined> {
    return this.store.loadRun(runId)
  }

  async listRuns(graphId?: string): Promise<Run[]> {
    return this.store.listRuns(graphId)
  }

  // ---- Derived state ------------------------------------------------------

  deriveNodeStates(graph: GraphDef, run: Run): Record<string, NodeState> {
    const states: Record<string, NodeState> = {}

    for (const node of graph.nodes) {
      states[node.id] = { node_id: node.id, status: "pending", pass: 0 }
    }

    for (const t of run.history) {
      const state = states[t.node_id]
      if (!state) continue
      state.status = t.to_status
      state.pass = t.pass
      if (t.artifact) state.artifact = t.artifact
    }

    return states
  }

  async next(graphId: string, runId: string): Promise<string[]> {
    const graph = await this.store.loadGraph(graphId)
    if (!graph) throw new Error(`Unknown graph: ${graphId}`)
    const run = await this.store.loadRun(runId)
    if (!run) throw new Error(`Unknown run: ${runId}`)

    const states = this.deriveNodeStates(graph, run)
    const available: string[] = []

    for (const node of graph.nodes) {
      const state = states[node.id]
      if (!state || state.status === "in_progress") continue
      if (state.status === "completed") continue

      const incoming = graph.edges.filter((e) => e.to === node.id)

      if (incoming.length === 0 && state.status === "pending") {
        available.push(node.id)
        continue
      }

      const allMet = incoming.every((edge) => {
        const source = states[edge.from]
        return source && source.status === "completed"
      })

      if (allMet) available.push(node.id)
    }

    return available
  }

  // ---- Transitions --------------------------------------------------------

  async transition(
    graphId: string,
    runId: string,
    nodeId: string,
    toStatus: NodeStatus,
    identity: string,
    options?: {
      artifact?: { type: string; content: unknown }
      reason?: string
      metadata?: Record<string, unknown>
    },
  ): Promise<Transition> {
    const graph = await this.store.loadGraph(graphId)
    if (!graph) throw new Error(`Unknown graph: ${graphId}`)
    const run = await this.store.loadRun(runId)
    if (!run) throw new Error(`Unknown run: ${runId}`)

    const nodeDef = graph.nodes.find((n) => n.id === nodeId)
    if (!nodeDef) throw new Error(`Unknown node: ${nodeId}`)

    const states = this.deriveNodeStates(graph, run)
    const current = states[nodeId]!
    const fromStatus = current.status

    this.validateTransition(fromStatus, toStatus, nodeId)

    const isRevisit =
      fromStatus === "completed" ||
      fromStatus === "failed" ||
      fromStatus === "invalidated"
    const pass = isRevisit ? current.pass + 1 : Math.max(current.pass, 1)

    const now = new Date().toISOString()
    const t: Transition = {
      node_id: nodeId,
      pass,
      from_status: fromStatus,
      to_status: toStatus,
      identity,
      timestamp: now,
    }

    if (options?.artifact) {
      t.artifact = { ...options.artifact, produced_at: now }
    }
    if (options?.reason !== undefined) {
      t.reason = options.reason
    }
    if (options?.metadata !== undefined) {
      t.metadata = options.metadata
    }

    await this.store.appendTransition(runId, t)

    if (isRevisit && toStatus === "in_progress") {
      const freshRun = await this.store.loadRun(runId)
      if (freshRun) {
        await this.invalidateDownstream(graph, freshRun, nodeId, identity)
      }
    }

    return t
  }

  // ---- Internal -----------------------------------------------------------

  private validateTransition(
    from: NodeStatus,
    to: NodeStatus,
    nodeId: string,
  ): void {
    const legal: Record<NodeStatus, NodeStatus[]> = {
      pending: ["in_progress"],
      in_progress: ["completed", "failed"],
      completed: ["in_progress"],
      failed: ["in_progress"],
      invalidated: ["in_progress"],
    }

    const allowed = legal[from]
    if (!allowed || !allowed.includes(to)) {
      throw new Error(
        `Illegal transition for node '${nodeId}': ${from} → ${to}`,
      )
    }
  }

  private async invalidateDownstream(
    graph: GraphDef,
    run: Run,
    nodeId: string,
    identity: string,
  ): Promise<void> {
    const states = this.deriveNodeStates(graph, run)

    const visited = new Set<string>()
    const queue = graph.edges.filter((e) => e.from === nodeId).map((e) => e.to)

    while (queue.length > 0) {
      const id = queue.shift()!
      if (visited.has(id)) continue
      visited.add(id)

      const state = states[id]
      if (state && state.status === "completed") {
        const t: Transition = {
          node_id: id,
          pass: state.pass,
          from_status: "completed",
          to_status: "invalidated",
          identity,
          timestamp: new Date().toISOString(),
          reason: `Upstream node '${nodeId}' revisited`,
        }
        await this.store.appendTransition(run.run_id, t)
      }

      for (const edge of graph.edges) {
        if (edge.from === id) queue.push(edge.to)
      }
    }
  }
}
