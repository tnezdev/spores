import { describe, it, expect, beforeEach } from "bun:test"
import type { GraphDef, Run, Transition } from "../types.js"
import type { WorkflowAdapter } from "./adapter.js"
import { Runtime } from "./runtime.js"

// ---------------------------------------------------------------------------
// In-memory adapter for testing
// ---------------------------------------------------------------------------

class MemoryAdapter implements WorkflowAdapter {
  private graphs = new Map<string, GraphDef>()
  private runs = new Map<string, Run>()

  async saveGraph(graph: GraphDef): Promise<void> {
    this.graphs.set(graph.id, graph)
  }

  async loadGraph(graphId: string): Promise<GraphDef | undefined> {
    return this.graphs.get(graphId)
  }

  async listGraphs(): Promise<GraphDef[]> {
    return [...this.graphs.values()]
  }

  async createRun(graphId: string, name?: string): Promise<Run> {
    const run: Run = {
      run_id: `run-${this.runs.size + 1}`,
      graph_id: graphId,
      ...(name !== undefined ? { name } : {}),
      created_at: new Date().toISOString(),
      history: [],
    }
    this.runs.set(run.run_id, run)
    return run
  }

  async loadRun(runId: string): Promise<Run | undefined> {
    return this.runs.get(runId)
  }

  async listRuns(graphId?: string): Promise<Run[]> {
    const all = [...this.runs.values()]
    return graphId ? all.filter((r) => r.graph_id === graphId) : all
  }

  async appendTransition(runId: string, transition: Transition): Promise<void> {
    const run = this.runs.get(runId)
    if (!run) throw new Error(`Unknown run: ${runId}`)
    run.history.push(transition)
  }
}

// ---------------------------------------------------------------------------
// Test graph helpers
// ---------------------------------------------------------------------------

function subgraphGraph(): GraphDef {
  return {
    id: "with-sub",
    name: "With Subgraph",
    version: "1.0",
    nodes: [
      { id: "A", label: "A", artifact_type: "doc" },
      {
        id: "B",
        label: "B",
        artifact_type: "report",
        subgraph: {
          id: "inner",
          name: "Inner",
          version: "1.0",
          nodes: [
            { id: "X", label: "X", artifact_type: "finding" },
            { id: "Y", label: "Y", artifact_type: "finding" },
            { id: "Z", label: "Z", artifact_type: "report" },
          ],
          edges: [
            { from: "X", to: "Z" },
            { from: "Y", to: "Z" },
          ],
        },
      },
      { id: "C", label: "C", artifact_type: "doc" },
    ],
    edges: [
      { from: "A", to: "B" },
      { from: "B", to: "C" },
    ],
  }
}

function linearGraph(): GraphDef {
  return {
    id: "linear",
    name: "Linear",
    version: "1.0",
    nodes: [
      { id: "A", label: "Step A", artifact_type: "doc" },
      { id: "B", label: "Step B", artifact_type: "doc" },
      { id: "C", label: "Step C", artifact_type: "doc" },
    ],
    edges: [
      { from: "A", to: "B" },
      { from: "B", to: "C" },
    ],
  }
}

function diamondGraph(): GraphDef {
  return {
    id: "diamond",
    name: "Diamond",
    version: "1.0",
    nodes: [
      { id: "A", label: "Start", artifact_type: "doc" },
      { id: "B", label: "Left", artifact_type: "doc" },
      { id: "C", label: "Right", artifact_type: "doc" },
      { id: "D", label: "Join", artifact_type: "doc" },
    ],
    edges: [
      { from: "A", to: "B" },
      { from: "A", to: "C" },
      { from: "B", to: "D" },
      { from: "C", to: "D" },
    ],
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let store: MemoryAdapter
let rt: Runtime

beforeEach(() => {
  store = new MemoryAdapter()
  rt = new Runtime(store)
})

describe("transition validation", () => {
  it("allows pending -> in_progress", async () => {
    const g = linearGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)
    const t = await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    expect(t.from_status).toBe("pending")
    expect(t.to_status).toBe("in_progress")
  })

  it("allows in_progress -> completed", async () => {
    const g = linearGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)
    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    const t = await rt.transition(g.id, run.run_id, "A", "completed", "agent")
    expect(t.from_status).toBe("in_progress")
    expect(t.to_status).toBe("completed")
  })

  it("allows in_progress -> failed", async () => {
    const g = linearGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)
    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    const t = await rt.transition(g.id, run.run_id, "A", "failed", "agent", {
      reason: "oops",
    })
    expect(t.from_status).toBe("in_progress")
    expect(t.to_status).toBe("failed")
    expect(t.reason).toBe("oops")
  })

  it("allows completed -> in_progress (revisit)", async () => {
    const g = linearGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)
    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "A", "completed", "agent")
    const t = await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    expect(t.from_status).toBe("completed")
    expect(t.to_status).toBe("in_progress")
  })

  it("allows failed -> in_progress (retry)", async () => {
    const g = linearGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)
    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "A", "failed", "agent")
    const t = await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    expect(t.from_status).toBe("failed")
    expect(t.to_status).toBe("in_progress")
  })

  it("allows invalidated -> in_progress (rework)", async () => {
    const g = linearGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)
    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "A", "completed", "agent")
    await rt.transition(g.id, run.run_id, "B", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "B", "completed", "agent")
    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    const t = await rt.transition(g.id, run.run_id, "B", "in_progress", "agent")
    expect(t.from_status).toBe("invalidated")
    expect(t.to_status).toBe("in_progress")
  })

  it("rejects pending -> completed", async () => {
    const g = linearGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)
    await expect(
      rt.transition(g.id, run.run_id, "A", "completed", "agent"),
    ).rejects.toThrow(/Illegal transition/)
  })

  it("rejects pending -> failed", async () => {
    const g = linearGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)
    await expect(
      rt.transition(g.id, run.run_id, "A", "failed", "agent"),
    ).rejects.toThrow(/Illegal transition/)
  })

  it("rejects completed -> failed", async () => {
    const g = linearGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)
    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "A", "completed", "agent")
    await expect(
      rt.transition(g.id, run.run_id, "A", "failed", "agent"),
    ).rejects.toThrow(/Illegal transition/)
  })

  it("rejects in_progress -> pending", async () => {
    const g = linearGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)
    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    await expect(
      rt.transition(g.id, run.run_id, "A", "pending", "agent"),
    ).rejects.toThrow(/Illegal transition/)
  })

  it("throws on unknown graph", async () => {
    const g = linearGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)
    await expect(
      rt.transition("nope", run.run_id, "A", "in_progress", "agent"),
    ).rejects.toThrow(/Unknown graph/)
  })

  it("throws on unknown node", async () => {
    const g = linearGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)
    await expect(
      rt.transition(g.id, run.run_id, "Z", "in_progress", "agent"),
    ).rejects.toThrow(/Unknown node/)
  })
})

describe("deriveNodeStates", () => {
  it("returns all nodes as pending for a fresh run", async () => {
    const g = linearGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)
    const states = rt.deriveNodeStates(g, run)
    for (const node of g.nodes) {
      expect(states[node.id]!.status).toBe("pending")
      expect(states[node.id]!.pass).toBe(0)
    }
  })

  it("replays history to reflect current state", async () => {
    const g = linearGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)
    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "A", "completed", "agent")
    await rt.transition(g.id, run.run_id, "B", "in_progress", "agent")

    const freshRun = await rt.getRun(run.run_id)
    const states = rt.deriveNodeStates(g, freshRun!)
    expect(states["A"]!.status).toBe("completed")
    expect(states["B"]!.status).toBe("in_progress")
    expect(states["C"]!.status).toBe("pending")
  })
})

describe("artifact tracking", () => {
  it("attaches artifact on completion", async () => {
    const g = linearGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)
    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "A", "completed", "agent", {
      artifact: { type: "doc", content: "hello world" },
    })

    const freshRun = await rt.getRun(run.run_id)
    const states = rt.deriveNodeStates(g, freshRun!)
    expect(states["A"]!.artifact).toBeDefined()
    expect(states["A"]!.artifact!.content).toBe("hello world")
    expect(states["A"]!.artifact!.type).toBe("doc")
    expect(states["A"]!.artifact!.produced_at).toBeDefined()
  })

  it("preserves artifact across passes when revisited and completed again", async () => {
    const g = linearGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)

    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "A", "completed", "agent", {
      artifact: { type: "doc", content: "v1" },
    })

    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "A", "completed", "agent", {
      artifact: { type: "doc", content: "v2" },
    })

    const freshRun = await rt.getRun(run.run_id)
    const states = rt.deriveNodeStates(g, freshRun!)
    expect(states["A"]!.artifact!.content).toBe("v2")
  })

  it("retains artifact from first pass while in_progress on revisit", async () => {
    const g = linearGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)

    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "A", "completed", "agent", {
      artifact: { type: "doc", content: "v1" },
    })

    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")

    const freshRun = await rt.getRun(run.run_id)
    const states = rt.deriveNodeStates(g, freshRun!)
    expect(states["A"]!.artifact!.content).toBe("v1")
  })
})

describe("downstream invalidation", () => {
  it("invalidates downstream completed nodes when a node is revisited", async () => {
    const g = linearGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)

    for (const id of ["A", "B", "C"]) {
      await rt.transition(g.id, run.run_id, id, "in_progress", "agent")
      await rt.transition(g.id, run.run_id, id, "completed", "agent", {
        artifact: { type: "doc", content: `${id}-artifact` },
      })
    }

    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")

    const freshRun = await rt.getRun(run.run_id)
    const states = rt.deriveNodeStates(g, freshRun!)
    expect(states["A"]!.status).toBe("in_progress")
    expect(states["B"]!.status).toBe("invalidated")
    expect(states["C"]!.status).toBe("invalidated")
  })

  it("does not invalidate nodes that are not downstream", async () => {
    const g = diamondGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)

    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "A", "completed", "agent")
    await rt.transition(g.id, run.run_id, "B", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "B", "completed", "agent")
    await rt.transition(g.id, run.run_id, "C", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "C", "completed", "agent")

    await rt.transition(g.id, run.run_id, "B", "in_progress", "agent")

    const freshRun = await rt.getRun(run.run_id)
    const states = rt.deriveNodeStates(g, freshRun!)
    expect(states["B"]!.status).toBe("in_progress")
    expect(states["C"]!.status).toBe("completed")
  })

  it("cascades invalidation through multiple levels", async () => {
    const g = linearGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)

    for (const id of ["A", "B", "C"]) {
      await rt.transition(g.id, run.run_id, id, "in_progress", "agent")
      await rt.transition(g.id, run.run_id, id, "completed", "agent")
    }

    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")

    const freshRun = await rt.getRun(run.run_id)
    const states = rt.deriveNodeStates(g, freshRun!)
    expect(states["B"]!.status).toBe("invalidated")
    expect(states["C"]!.status).toBe("invalidated")
  })
})

describe("fan-out", () => {
  it("next() returns multiple nodes when a node fans out", async () => {
    const g = diamondGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)

    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "A", "completed", "agent")

    const available = await rt.next(g.id, run.run_id)
    expect(available).toContain("B")
    expect(available).toContain("C")
    expect(available).toHaveLength(2)
  })
})

describe("fan-in", () => {
  it("next() does not return fan-in node until all incoming edges are satisfied", async () => {
    const g = diamondGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)

    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "A", "completed", "agent")
    await rt.transition(g.id, run.run_id, "B", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "B", "completed", "agent")

    const available = await rt.next(g.id, run.run_id)
    expect(available).not.toContain("D")
    expect(available).toContain("C")
  })

  it("next() returns fan-in node once all incoming edges are met", async () => {
    const g = diamondGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)

    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "A", "completed", "agent")
    await rt.transition(g.id, run.run_id, "B", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "B", "completed", "agent")
    await rt.transition(g.id, run.run_id, "C", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "C", "completed", "agent")

    const available = await rt.next(g.id, run.run_id)
    expect(available).toContain("D")
  })
})

describe("next()", () => {
  it("returns root nodes for a fresh run", async () => {
    const g = linearGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)
    const available = await rt.next(g.id, run.run_id)
    expect(available).toEqual(["A"])
  })

  it("does not return in_progress nodes", async () => {
    const g = linearGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)
    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    const available = await rt.next(g.id, run.run_id)
    expect(available).not.toContain("A")
  })

  it("returns empty array when all nodes are completed", async () => {
    const g = linearGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)
    for (const id of ["A", "B", "C"]) {
      await rt.transition(g.id, run.run_id, id, "in_progress", "agent")
      await rt.transition(g.id, run.run_id, id, "completed", "agent")
    }
    const available = await rt.next(g.id, run.run_id)
    expect(available).toEqual([])
  })

  it("returns invalidated nodes whose incoming edges are satisfied", async () => {
    const g = linearGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)

    for (const id of ["A", "B", "C"]) {
      await rt.transition(g.id, run.run_id, id, "in_progress", "agent")
      await rt.transition(g.id, run.run_id, id, "completed", "agent")
    }
    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "A", "completed", "agent")

    const available = await rt.next(g.id, run.run_id)
    expect(available).toContain("B")
    expect(available).not.toContain("C")
  })
})

describe("pass counting", () => {
  it("first pass is numbered 1", async () => {
    const g = linearGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)
    const t = await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    expect(t.pass).toBe(1)
  })

  it("revisit increments the pass number", async () => {
    const g = linearGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)

    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "A", "completed", "agent")
    const t = await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    expect(t.pass).toBe(2)
  })

  it("multiple revisits keep incrementing", async () => {
    const g = linearGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)

    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "A", "completed", "agent")
    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "A", "completed", "agent")
    const t = await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    expect(t.pass).toBe(3)
  })

  it("deriveNodeStates reflects the current pass number", async () => {
    const g = linearGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)

    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "A", "completed", "agent")
    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "A", "completed", "agent")

    const freshRun = await rt.getRun(run.run_id)
    const states = rt.deriveNodeStates(g, freshRun!)
    expect(states["A"]!.pass).toBe(2)
  })
})

describe("failure flow", () => {
  it("fail then retry cycle works", async () => {
    const g = linearGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)

    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "A", "failed", "agent", {
      reason: "timed out",
      artifact: { type: "log", content: "partial output" },
    })

    let freshRun = await rt.getRun(run.run_id)
    let states = rt.deriveNodeStates(g, freshRun!)
    expect(states["A"]!.status).toBe("failed")
    expect(states["A"]!.artifact!.content).toBe("partial output")

    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "A", "completed", "agent", {
      artifact: { type: "doc", content: "success" },
    })

    freshRun = await rt.getRun(run.run_id)
    states = rt.deriveNodeStates(g, freshRun!)
    expect(states["A"]!.status).toBe("completed")
    expect(states["A"]!.artifact!.content).toBe("success")
    expect(states["A"]!.pass).toBe(2)
  })

  it("failed node shows up in next() when incoming edges are satisfied", async () => {
    const g = linearGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)

    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "A", "failed", "agent")

    const available = await rt.next(g.id, run.run_id)
    expect(available).toContain("A")
  })
})

describe("run lifecycle", () => {
  it("createRun throws for unknown graph", async () => {
    await expect(rt.createRun("nope")).rejects.toThrow(/Unknown graph/)
  })

  it("next() throws for unknown graph or run", async () => {
    const g = linearGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)
    await expect(rt.next("nope", run.run_id)).rejects.toThrow(/Unknown graph/)
    await expect(rt.next(g.id, "nope")).rejects.toThrow(/Unknown run/)
  })
})

describe("subgraph integration", () => {
  it("next() returns subgraph entry nodes after upstream completes", async () => {
    const g = subgraphGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)

    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "A", "completed", "agent")

    const available = await rt.next(g.id, run.run_id)
    expect(available.sort()).toEqual(["B.X", "B.Y"])
  })

  it("fan-in at subgraph terminal blocks until all entries complete", async () => {
    const g = subgraphGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)

    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "A", "completed", "agent")
    await rt.transition(g.id, run.run_id, "B.X", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "B.X", "completed", "agent")

    let available = await rt.next(g.id, run.run_id)
    expect(available).not.toContain("B.Z")
    expect(available).toContain("B.Y")

    await rt.transition(g.id, run.run_id, "B.Y", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "B.Y", "completed", "agent")

    available = await rt.next(g.id, run.run_id)
    expect(available).toContain("B.Z")
  })

  it("downstream of subgraph becomes available when terminal completes", async () => {
    const g = subgraphGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)

    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "A", "completed", "agent")
    await rt.transition(g.id, run.run_id, "B.X", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "B.X", "completed", "agent")
    await rt.transition(g.id, run.run_id, "B.Y", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "B.Y", "completed", "agent")
    await rt.transition(g.id, run.run_id, "B.Z", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "B.Z", "completed", "agent")

    const available = await rt.next(g.id, run.run_id)
    expect(available).toEqual(["C"])
  })

  it("full lifecycle completes through subgraph", async () => {
    const g = subgraphGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)

    for (const id of ["A", "B.X", "B.Y", "B.Z", "C"]) {
      await rt.transition(g.id, run.run_id, id, "in_progress", "agent")
      await rt.transition(g.id, run.run_id, id, "completed", "agent", {
        artifact: { type: "doc", content: `${id}-output` },
      })
    }

    const available = await rt.next(g.id, run.run_id)
    expect(available).toEqual([])

    const freshRun = await rt.getRun(run.run_id)
    const states = rt.deriveNodeStates((await rt.getGraph(g.id))!, freshRun!)
    for (const id of ["A", "B.X", "B.Y", "B.Z", "C"]) {
      expect(states[id]!.status).toBe("completed")
    }
  })

  it("invalidation cascades through subgraph boundary", async () => {
    const g = subgraphGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)

    for (const id of ["A", "B.X", "B.Y", "B.Z", "C"]) {
      await rt.transition(g.id, run.run_id, id, "in_progress", "agent")
      await rt.transition(g.id, run.run_id, id, "completed", "agent")
    }

    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")

    const freshRun = await rt.getRun(run.run_id)
    const graph = (await rt.getGraph(g.id))!
    const states = rt.deriveNodeStates(graph, freshRun!)
    expect(states["A"]!.status).toBe("in_progress")
    expect(states["B.X"]!.status).toBe("invalidated")
    expect(states["B.Y"]!.status).toBe("invalidated")
    expect(states["B.Z"]!.status).toBe("invalidated")
    expect(states["C"]!.status).toBe("invalidated")
  })

  it("artifacts flow through subgraph nodes", async () => {
    const g = subgraphGraph()
    await rt.registerGraph(g)
    const run = await rt.createRun(g.id)

    await rt.transition(g.id, run.run_id, "A", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "A", "completed", "agent")
    await rt.transition(g.id, run.run_id, "B.X", "in_progress", "agent")
    await rt.transition(g.id, run.run_id, "B.X", "completed", "agent", {
      artifact: { type: "finding", content: "diff looks good" },
    })

    const freshRun = await rt.getRun(run.run_id)
    const graph = (await rt.getGraph(g.id))!
    const states = rt.deriveNodeStates(graph, freshRun!)
    expect(states["B.X"]!.artifact!.content).toBe("diff looks good")
  })
})
