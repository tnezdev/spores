import type { EdgeDef, GraphDef, NodeDef } from "../types.js"

/**
 * Expand all subgraphs in a graph definition into a flat graph.
 *
 * For each node with a `subgraph`, the parent node is replaced by its
 * namespaced children (e.g. `review.diff-review`). Incoming/outgoing edges
 * are rewired to the subgraph's entry/terminal nodes. Nested subgraphs are
 * expanded recursively (innermost first).
 */
export function expandGraph(graph: GraphDef): GraphDef {
  const hasSubgraph = graph.nodes.some((n) => n.subgraph)
  if (!hasSubgraph) return graph

  let nodes: NodeDef[] = []
  let edges: EdgeDef[] = [...graph.edges]

  for (const node of graph.nodes) {
    if (!node.subgraph) {
      nodes.push(node)
      continue
    }

    // Recursively expand the subgraph first
    const expanded = expandGraph(node.subgraph)

    const entries = findEntryNodes(expanded)
    const terminals = findTerminalNodes(expanded)

    // Add namespaced subgraph nodes (strip subgraph field — already expanded)
    for (const child of expanded.nodes) {
      const { subgraph: _, ...rest } = child
      nodes.push({ ...rest, id: nsId(node.id, child.id) })
    }

    // Add namespaced internal edges
    for (const edge of expanded.edges) {
      edges.push({
        ...edge,
        from: nsId(node.id, edge.from),
        to: nsId(node.id, edge.to),
      })
    }

    // Rewire incoming edges: X -> parent becomes X -> each entry node
    const incoming = edges.filter((e) => e.to === node.id)
    for (const edge of incoming) {
      for (const entry of entries) {
        edges.push({ ...edge, to: nsId(node.id, entry) })
      }
    }

    // Rewire outgoing edges: parent -> Y becomes each terminal -> Y
    const outgoing = edges.filter((e) => e.from === node.id)
    for (const edge of outgoing) {
      for (const terminal of terminals) {
        edges.push({ ...edge, from: nsId(node.id, terminal) })
      }
    }

    // Remove original edges to/from parent
    edges = edges.filter((e) => e.from !== node.id && e.to !== node.id)
  }

  // Check for ID collisions
  const ids = new Set<string>()
  for (const n of nodes) {
    if (ids.has(n.id)) {
      throw new Error(
        `Subgraph expansion produced duplicate node ID: '${n.id}'`,
      )
    }
    ids.add(n.id)
  }

  return { ...graph, nodes, edges }
}

function nsId(parent: string, child: string): string {
  return `${parent}.${child}`
}

/** Nodes with no incoming edges within the graph. */
export function findEntryNodes(graph: GraphDef): string[] {
  const targets = new Set(graph.edges.map((e) => e.to))
  return graph.nodes.filter((n) => !targets.has(n.id)).map((n) => n.id)
}

/** Nodes with no outgoing edges within the graph. */
export function findTerminalNodes(graph: GraphDef): string[] {
  const sources = new Set(graph.edges.map((e) => e.from))
  return graph.nodes.filter((n) => !sources.has(n.id)).map((n) => n.id)
}
