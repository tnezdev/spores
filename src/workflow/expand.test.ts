import { describe, it, expect } from "bun:test"
import type { GraphDef } from "../types.js"
import { expandGraph, findEntryNodes, findTerminalNodes } from "./expand.js"

function linearGraph(): GraphDef {
  return {
    id: "linear",
    name: "Linear",
    version: "1.0",
    nodes: [
      { id: "A", label: "A", artifact_type: "doc" },
      { id: "B", label: "B", artifact_type: "doc" },
      { id: "C", label: "C", artifact_type: "doc" },
    ],
    edges: [
      { from: "A", to: "B" },
      { from: "B", to: "C" },
    ],
  }
}

function singleSubgraphGraph(): GraphDef {
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

function conditionGraph(): GraphDef {
  return {
    id: "cond",
    name: "Condition",
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
          nodes: [{ id: "X", label: "X", artifact_type: "doc" }],
          edges: [],
        },
      },
      { id: "C", label: "C", artifact_type: "doc" },
    ],
    edges: [
      {
        from: "A",
        to: "B",
        condition: { type: "evaluator", criteria: "A passes" },
      },
      {
        from: "B",
        to: "C",
        condition: { type: "evaluator", criteria: "B passes" },
      },
    ],
  }
}

function nestedGraph(): GraphDef {
  return {
    id: "nested",
    name: "Nested",
    version: "1.0",
    nodes: [
      {
        id: "A",
        label: "A",
        artifact_type: "doc",
        subgraph: {
          id: "mid",
          name: "Mid",
          version: "1.0",
          nodes: [
            {
              id: "M",
              label: "M",
              artifact_type: "doc",
              subgraph: {
                id: "deep",
                name: "Deep",
                version: "1.0",
                nodes: [{ id: "P", label: "P", artifact_type: "doc" }],
                edges: [],
              },
            },
          ],
          edges: [],
        },
      },
      { id: "B", label: "B", artifact_type: "doc" },
    ],
    edges: [{ from: "A", to: "B" }],
  }
}

describe("findEntryNodes", () => {
  it("returns nodes with no incoming edges", () => {
    const g = singleSubgraphGraph()
    const entries = findEntryNodes(g.nodes[1]!.subgraph!)
    expect(entries.sort()).toEqual(["X", "Y"])
  })

  it("returns all nodes for a graph with no edges", () => {
    const g: GraphDef = {
      id: "t",
      name: "t",
      version: "1.0",
      nodes: [
        { id: "A", label: "A", artifact_type: "doc" },
        { id: "B", label: "B", artifact_type: "doc" },
      ],
      edges: [],
    }
    expect(findEntryNodes(g).sort()).toEqual(["A", "B"])
  })
})

describe("findTerminalNodes", () => {
  it("returns nodes with no outgoing edges", () => {
    const g = singleSubgraphGraph()
    const terminals = findTerminalNodes(g.nodes[1]!.subgraph!)
    expect(terminals).toEqual(["Z"])
  })
})

describe("expandGraph", () => {
  it("returns graph unchanged when no subgraphs exist", () => {
    const g = linearGraph()
    const result = expandGraph(g)
    expect(result).toBe(g)
  })

  it("expands a single subgraph into namespaced nodes", () => {
    const result = expandGraph(singleSubgraphGraph())
    const ids = result.nodes.map((n) => n.id)
    expect(ids).toEqual(["A", "B.X", "B.Y", "B.Z", "C"])
  })

  it("removes the parent node", () => {
    const result = expandGraph(singleSubgraphGraph())
    expect(result.nodes.find((n) => n.id === "B")).toBeUndefined()
  })

  it("rewires incoming edges to entry nodes", () => {
    const result = expandGraph(singleSubgraphGraph())
    const fromA = result.edges.filter((e) => e.from === "A")
    expect(fromA.map((e) => e.to).sort()).toEqual(["B.X", "B.Y"])
  })

  it("rewires outgoing edges from terminal nodes", () => {
    const result = expandGraph(singleSubgraphGraph())
    const toC = result.edges.filter((e) => e.to === "C")
    expect(toC.map((e) => e.from)).toEqual(["B.Z"])
  })

  it("adds namespaced internal edges", () => {
    const result = expandGraph(singleSubgraphGraph())
    const internal = result.edges.filter(
      (e) => e.from.startsWith("B.") && e.to.startsWith("B."),
    )
    expect(internal).toEqual([
      { from: "B.X", to: "B.Z" },
      { from: "B.Y", to: "B.Z" },
    ])
  })

  it("preserves edge conditions on rewired incoming edges", () => {
    const result = expandGraph(conditionGraph())
    const toEntry = result.edges.filter((e) => e.from === "A")
    expect(toEntry).toHaveLength(1)
    expect(toEntry[0]!.condition).toEqual({
      type: "evaluator",
      criteria: "A passes",
    })
  })

  it("preserves edge conditions on rewired outgoing edges", () => {
    const result = expandGraph(conditionGraph())
    const toC = result.edges.filter((e) => e.to === "C")
    expect(toC).toHaveLength(1)
    expect(toC[0]!.condition).toEqual({
      type: "evaluator",
      criteria: "B passes",
    })
  })

  it("handles nested subgraphs with double-dot IDs", () => {
    const result = expandGraph(nestedGraph())
    const ids = result.nodes.map((n) => n.id)
    expect(ids).toEqual(["A.M.P", "B"])
  })

  it("rewires edges through nested expansion", () => {
    const result = expandGraph(nestedGraph())
    const toB = result.edges.filter((e) => e.to === "B")
    expect(toB.map((e) => e.from)).toEqual(["A.M.P"])
  })

  it("handles degenerate single-node subgraph", () => {
    const g: GraphDef = {
      id: "degen",
      name: "Degen",
      version: "1.0",
      nodes: [
        { id: "A", label: "A", artifact_type: "doc" },
        {
          id: "B",
          label: "B",
          artifact_type: "doc",
          subgraph: {
            id: "solo",
            name: "Solo",
            version: "1.0",
            nodes: [{ id: "only", label: "Only", artifact_type: "doc" }],
            edges: [],
          },
        },
        { id: "C", label: "C", artifact_type: "doc" },
      ],
      edges: [
        { from: "A", to: "B" },
        { from: "B", to: "C" },
      ],
    }

    const result = expandGraph(g)
    expect(result.nodes.map((n) => n.id)).toEqual(["A", "B.only", "C"])
    expect(result.edges).toEqual([
      { from: "A", to: "B.only" },
      { from: "B.only", to: "C" },
    ])
  })

  it("expands multiple subgraph nodes in the same graph", () => {
    const sub: GraphDef = {
      id: "s",
      name: "s",
      version: "1.0",
      nodes: [{ id: "inner", label: "I", artifact_type: "doc" }],
      edges: [],
    }
    const g: GraphDef = {
      id: "multi",
      name: "Multi",
      version: "1.0",
      nodes: [
        {
          id: "A",
          label: "A",
          artifact_type: "doc",
          subgraph: { ...sub, id: "s1" },
        },
        {
          id: "B",
          label: "B",
          artifact_type: "doc",
          subgraph: { ...sub, id: "s2" },
        },
      ],
      edges: [{ from: "A", to: "B" }],
    }

    const result = expandGraph(g)
    expect(result.nodes.map((n) => n.id).sort()).toEqual([
      "A.inner",
      "B.inner",
    ])
    const edge = result.edges.find(
      (e) => e.from === "A.inner" && e.to === "B.inner",
    )
    expect(edge).toBeDefined()
  })

  it("throws on ID collision", () => {
    const g: GraphDef = {
      id: "collision",
      name: "Collision",
      version: "1.0",
      nodes: [
        { id: "A.inner", label: "Existing", artifact_type: "doc" },
        {
          id: "A",
          label: "A",
          artifact_type: "doc",
          subgraph: {
            id: "s",
            name: "s",
            version: "1.0",
            nodes: [{ id: "inner", label: "I", artifact_type: "doc" }],
            edges: [],
          },
        },
      ],
      edges: [],
    }
    expect(() => expandGraph(g)).toThrow(/duplicate node ID.*A\.inner/i)
  })

  it("preserves node properties through expansion", () => {
    const g: GraphDef = {
      id: "props",
      name: "Props",
      version: "1.0",
      nodes: [
        {
          id: "parent",
          label: "Parent",
          artifact_type: "doc",
          subgraph: {
            id: "s",
            name: "s",
            version: "1.0",
            nodes: [
              {
                id: "child",
                label: "Child",
                description: "A child node",
                artifact_type: "report",
                type: "manual",
                claims: ["reviewer"],
              },
            ],
            edges: [],
          },
        },
      ],
      edges: [],
    }

    const result = expandGraph(g)
    const child = result.nodes.find((n) => n.id === "parent.child")!
    expect(child.label).toBe("Child")
    expect(child.description).toBe("A child node")
    expect(child.artifact_type).toBe("report")
    expect(child.type).toBe("manual")
    expect(child.claims).toEqual(["reviewer"])
  })

  it("strips subgraph field from expanded nodes", () => {
    const result = expandGraph(singleSubgraphGraph())
    for (const node of result.nodes) {
      expect(node.subgraph).toBeUndefined()
    }
  })

  it("preserves graph-level properties", () => {
    const g = singleSubgraphGraph()
    const result = expandGraph(g)
    expect(result.id).toBe(g.id)
    expect(result.name).toBe(g.name)
    expect(result.version).toBe(g.version)
  })

  it("handles subgraph node as entry node of outer graph", () => {
    const g: GraphDef = {
      id: "entry-sub",
      name: "Entry Sub",
      version: "1.0",
      nodes: [
        {
          id: "first",
          label: "First",
          artifact_type: "doc",
          subgraph: {
            id: "s",
            name: "s",
            version: "1.0",
            nodes: [{ id: "inner", label: "I", artifact_type: "doc" }],
            edges: [],
          },
        },
        { id: "second", label: "Second", artifact_type: "doc" },
      ],
      edges: [{ from: "first", to: "second" }],
    }

    const result = expandGraph(g)
    expect(result.nodes.map((n) => n.id)).toEqual(["first.inner", "second"])
    const incoming = result.edges.filter((e) => e.to === "first.inner")
    expect(incoming).toHaveLength(0)
  })

  it("handles subgraph node as terminal node of outer graph", () => {
    const g: GraphDef = {
      id: "terminal-sub",
      name: "Terminal Sub",
      version: "1.0",
      nodes: [
        { id: "first", label: "First", artifact_type: "doc" },
        {
          id: "last",
          label: "Last",
          artifact_type: "doc",
          subgraph: {
            id: "s",
            name: "s",
            version: "1.0",
            nodes: [{ id: "inner", label: "I", artifact_type: "doc" }],
            edges: [],
          },
        },
      ],
      edges: [{ from: "first", to: "last" }],
    }

    const result = expandGraph(g)
    expect(result.nodes.map((n) => n.id)).toEqual(["first", "last.inner"])
    const outgoing = result.edges.filter((e) => e.from === "last.inner")
    expect(outgoing).toHaveLength(0)
  })
})
