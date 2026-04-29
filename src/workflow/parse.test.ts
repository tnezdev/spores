import { describe, expect, it } from "bun:test"
import { parseGraph } from "./parse.js"

const MINIMAL_JSON = JSON.stringify({
  id: "g",
  name: "G",
  version: "1.0.0",
  nodes: [],
  edges: [],
})

const MINIMAL_YAML = `
id: g
name: G
version: "1.0.0"
nodes: []
edges: []
`.trim()

describe("parseGraph", () => {
  it("parses a JSON string", () => {
    const g = parseGraph(MINIMAL_JSON)
    expect(g.id).toBe("g")
    expect(g.name).toBe("G")
  })

  it("parses a YAML string by content sniffing", () => {
    const g = parseGraph(MINIMAL_YAML)
    expect(g.id).toBe("g")
    expect(g.name).toBe("G")
  })

  it("parses a YAML string when locator ends with .yaml", () => {
    const g = parseGraph(MINIMAL_YAML, "graphs/g.yaml")
    expect(g.id).toBe("g")
  })

  it("parses a YAML string when locator ends with .yml", () => {
    const g = parseGraph(MINIMAL_YAML, "graphs/g.yml")
    expect(g.id).toBe("g")
  })

  it("parses a JSON string when locator ends with .json", () => {
    const g = parseGraph(MINIMAL_JSON, "graphs/g.json")
    expect(g.id).toBe("g")
  })

  it("includes the locator in JSON parse error messages", () => {
    expect(() => parseGraph("not json", "my-graph.json")).toThrow(
      "my-graph.json",
    )
  })

  it("includes the locator in YAML parse error messages for non-object result", () => {
    // A bare scalar parses fine as YAML but is not a valid GraphDef object
    expect(() => parseGraph("just a string", "my-graph.yaml")).toThrow(
      "my-graph.yaml",
    )
  })

  it("throws when the parsed result is null", () => {
    expect(() => parseGraph("null", "g.yaml")).toThrow("non-null object")
  })

  it("throws when the parsed result is an array", () => {
    expect(() => parseGraph("- a\n- b", "g.yaml")).toThrow("array")
  })
})
