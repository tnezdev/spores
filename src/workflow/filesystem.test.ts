import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import type { GraphDef, Transition } from "../types.js"
import { InMemorySource } from "../sources/in-memory.js"
import { LayeredSource } from "../sources/layered.js"
import {
  FilesystemWorkflowAdapter,
  listGraphsFromSource,
  loadGraphFromSource,
} from "./filesystem.js"

function makeGraph(id = "g1"): GraphDef {
  return {
    id,
    name: "Test Graph",
    version: "1.0.0",
    nodes: [
      { id: "a", label: "Node A", artifact_type: "doc" },
      { id: "b", label: "Node B", artifact_type: "code" },
    ],
    edges: [{ from: "a", to: "b" }],
  }
}

function makeTransition(overrides: Partial<Transition> = {}): Transition {
  return {
    node_id: "a",
    pass: 1,
    from_status: "pending",
    to_status: "in_progress",
    identity: "test-agent",
    timestamp: new Date().toISOString(),
    ...overrides,
  }
}

describe("FilesystemWorkflowAdapter", () => {
  let tmpDir: string
  let store: FilesystemWorkflowAdapter

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "spores-wf-test-"))
    store = new FilesystemWorkflowAdapter(tmpDir)
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  describe("saveGraph / loadGraph", () => {
    it("round-trips a graph definition", async () => {
      const graph = makeGraph()
      await store.saveGraph(graph)
      const loaded = await store.loadGraph("g1")
      expect(loaded).toEqual(graph)
    })

    it("overwrites an existing graph with the same id", async () => {
      const graph = makeGraph()
      await store.saveGraph(graph)
      const updated = { ...graph, name: "Updated" }
      await store.saveGraph(updated)
      const loaded = await store.loadGraph("g1")
      expect(loaded?.name).toBe("Updated")
    })
  })

  describe("loadGraph — missing", () => {
    it("returns undefined for a non-existent graph", async () => {
      const result = await store.loadGraph("does-not-exist")
      expect(result).toBeUndefined()
    })
  })

  describe("listGraphs", () => {
    it("returns all saved graphs", async () => {
      await store.saveGraph(makeGraph("g1"))
      await store.saveGraph(makeGraph("g2"))
      const graphs = await store.listGraphs()
      expect(graphs).toHaveLength(2)
      const ids = graphs.map((g) => g.id).sort()
      expect(ids).toEqual(["g1", "g2"])
    })

    it("returns an empty array when no graphs exist", async () => {
      const graphs = await store.listGraphs()
      expect(graphs).toEqual([])
    })
  })

  describe("createRun / loadRun", () => {
    it("creates a run with a generated id and empty history", async () => {
      const run = await store.createRun("g1")
      expect(run.run_id).toBeDefined()
      expect(run.graph_id).toBe("g1")
      expect(run.history).toEqual([])
      expect(run.created_at).toBeDefined()
    })

    it("persists the run so loadRun retrieves it", async () => {
      const run = await store.createRun("g1")
      const loaded = await store.loadRun(run.run_id)
      expect(loaded).toEqual(run)
    })

    it("accepts an optional name", async () => {
      const run = await store.createRun("g1", "my run")
      expect(run.name).toBe("my run")
    })
  })

  describe("loadRun — missing", () => {
    it("returns undefined for a non-existent run", async () => {
      const result = await store.loadRun("does-not-exist")
      expect(result).toBeUndefined()
    })
  })

  describe("listRuns", () => {
    it("returns all runs", async () => {
      await store.createRun("g1")
      await store.createRun("g2")
      const runs = await store.listRuns()
      expect(runs).toHaveLength(2)
    })

    it("filters by graphId when provided", async () => {
      await store.createRun("g1")
      await store.createRun("g2")
      const runs = await store.listRuns("g1")
      expect(runs).toHaveLength(1)
      expect(runs[0]!.graph_id).toBe("g1")
    })

    it("returns an empty array when no runs exist", async () => {
      const runs = await store.listRuns()
      expect(runs).toEqual([])
    })
  })

  describe("appendTransition", () => {
    it("appends a transition to the run history", async () => {
      const run = await store.createRun("g1")
      const t = makeTransition()
      await store.appendTransition(run.run_id, t)

      const loaded = await store.loadRun(run.run_id)
      expect(loaded!.history).toHaveLength(1)
      expect(loaded!.history[0]).toEqual(t)
    })

    it("preserves previous transitions (append-only)", async () => {
      const run = await store.createRun("g1")
      const t1 = makeTransition({ node_id: "a", to_status: "in_progress" })
      const t2 = makeTransition({
        node_id: "a",
        from_status: "in_progress",
        to_status: "completed",
      })

      await store.appendTransition(run.run_id, t1)
      await store.appendTransition(run.run_id, t2)

      const loaded = await store.loadRun(run.run_id)
      expect(loaded!.history).toHaveLength(2)
      expect(loaded!.history[0]).toEqual(t1)
      expect(loaded!.history[1]).toEqual(t2)
    })

    it("persists transitions across fresh loads", async () => {
      const run = await store.createRun("g1")
      const t = makeTransition()
      await store.appendTransition(run.run_id, t)

      const store2 = new FilesystemWorkflowAdapter(tmpDir)
      const loaded = await store2.loadRun(run.run_id)
      expect(loaded!.history).toHaveLength(1)
      expect(loaded!.history[0]).toEqual(t)
    })
  })
})

describe("loadGraphFromSource", () => {
  it("loads a graph from any source — no filesystem coupling", async () => {
    const graph = makeGraph()
    const source = new InMemorySource({ g1: JSON.stringify(graph) }, "test")
    const loaded = await loadGraphFromSource("g1", source)
    expect(loaded).toEqual(graph)
  })

  it("returns undefined when source has no record by that id", async () => {
    const source = new InMemorySource({})
    const loaded = await loadGraphFromSource("missing", source)
    expect(loaded).toBeUndefined()
  })

  it("layered source: live state shadows seed", async () => {
    const seedGraph = { ...makeGraph(), name: "Seed" }
    const liveGraph = { ...makeGraph(), name: "Live" }
    const seed = new InMemorySource(
      { g1: JSON.stringify(seedGraph) },
      "seed",
    )
    const live = new InMemorySource(
      { g1: JSON.stringify(liveGraph) },
      "live",
    )
    const layered = new LayeredSource([live, seed])
    const loaded = await loadGraphFromSource("g1", layered)
    expect(loaded!.name).toBe("Live")
  })

  it("throws on malformed JSON", async () => {
    const source = new InMemorySource({ g1: "not valid json" })
    expect(loadGraphFromSource("g1", source)).rejects.toThrow()
  })
})

describe("listGraphsFromSource", () => {
  it("lists all compiled graphs from a source", async () => {
    const a = { ...makeGraph("a"), name: "Alpha" }
    const b = { ...makeGraph("b"), name: "Beta" }
    const source = new InMemorySource({
      a: JSON.stringify(a),
      b: JSON.stringify(b),
    })
    const graphs = await listGraphsFromSource(source)
    const names = graphs.map((g) => g.name).sort()
    expect(names).toEqual(["Alpha", "Beta"])
  })

  it("skips records whose names end in .source", async () => {
    const compiled = makeGraph("g1")
    const sourceForm = { ...makeGraph("g1"), name: "un-expanded" }
    const source = new InMemorySource({
      g1: JSON.stringify(compiled),
      "g1.source": JSON.stringify(sourceForm),
    })
    const graphs = await listGraphsFromSource(source)
    expect(graphs).toHaveLength(1)
    expect(graphs[0]!.id).toBe("g1")
    expect(graphs[0]!.name).toBe("Test Graph")
  })

  it("returns empty array from empty source", async () => {
    const graphs = await listGraphsFromSource(new InMemorySource({}))
    expect(graphs).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// YAML graph support
// ---------------------------------------------------------------------------

const YAML_GRAPH = `
id: yaml-graph
name: YAML Graph
version: "1.0.0"
nodes:
  - id: a
    label: Node A
    artifact_type: doc
  - id: b
    label: Node B
    artifact_type: code
edges:
  - from: a
    to: b
    condition: always
`.trim()

describe("FilesystemWorkflowAdapter — YAML graphs", () => {
  let tmpDir: string
  let store: FilesystemWorkflowAdapter

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "spores-wf-yaml-test-"))
    store = new FilesystemWorkflowAdapter(tmpDir)
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("loadGraph reads a .yaml file placed directly in the graphs dir", async () => {
    const graphsDir = join(tmpDir, ".spores", "workflows")
    await mkdir(graphsDir, { recursive: true })
    await writeFile(join(graphsDir, "yaml-graph.yaml"), YAML_GRAPH, "utf-8")

    const loaded = await store.loadGraph("yaml-graph")
    expect(loaded).toBeDefined()
    expect(loaded!.id).toBe("yaml-graph")
    expect(loaded!.name).toBe("YAML Graph")
    expect(loaded!.nodes).toHaveLength(2)
    expect(loaded!.edges).toHaveLength(1)
    expect(loaded!.edges[0]!.condition).toBe("always")
  })

  it("loadGraph reads a .yml file", async () => {
    const graphsDir = join(tmpDir, ".spores", "workflows")
    await mkdir(graphsDir, { recursive: true })
    await writeFile(join(graphsDir, "yaml-graph.yml"), YAML_GRAPH, "utf-8")

    const loaded = await store.loadGraph("yaml-graph")
    expect(loaded).toBeDefined()
    expect(loaded!.id).toBe("yaml-graph")
  })

  it("loadGraph prefers .json over .yaml when both exist", async () => {
    const graphsDir = join(tmpDir, ".spores", "workflows")
    await mkdir(graphsDir, { recursive: true })
    const jsonGraph = makeGraph("yaml-graph")
    jsonGraph.name = "JSON version"
    await writeFile(
      join(graphsDir, "yaml-graph.json"),
      JSON.stringify(jsonGraph),
      "utf-8",
    )
    await writeFile(join(graphsDir, "yaml-graph.yaml"), YAML_GRAPH, "utf-8")

    const loaded = await store.loadGraph("yaml-graph")
    expect(loaded!.name).toBe("JSON version")
  })

  it("listGraphs includes YAML graphs", async () => {
    const graph = makeGraph("json-graph")
    await store.saveGraph(graph)

    const graphsDir = join(tmpDir, ".spores", "workflows")
    await writeFile(join(graphsDir, "yaml-graph.yaml"), YAML_GRAPH, "utf-8")

    const graphs = await store.listGraphs()
    expect(graphs).toHaveLength(2)
    const ids = graphs.map((g) => g.id).sort()
    expect(ids).toEqual(["json-graph", "yaml-graph"])
  })

  it("listGraphs excludes .source.yaml files", async () => {
    const graphsDir = join(tmpDir, ".spores", "workflows")
    await mkdir(graphsDir, { recursive: true })
    await writeFile(join(graphsDir, "yaml-graph.yaml"), YAML_GRAPH, "utf-8")
    await writeFile(
      join(graphsDir, "yaml-graph.source.yaml"),
      YAML_GRAPH,
      "utf-8",
    )

    const graphs = await store.listGraphs()
    expect(graphs).toHaveLength(1)
    expect(graphs[0]!.id).toBe("yaml-graph")
  })
})
