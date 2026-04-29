import { describe, expect, it } from "bun:test"
import { parseYaml } from "./yaml.js"
import type { GraphDef } from "../types.js"

describe("parseYaml — scalars", () => {
  it("parses a bare string value", () => {
    expect(parseYaml("key: hello")).toEqual({ key: "hello" })
  })

  it("parses a double-quoted string", () => {
    expect(parseYaml('key: "hello world"')).toEqual({ key: "hello world" })
  })

  it("parses a single-quoted string", () => {
    expect(parseYaml("key: 'hello world'")).toEqual({ key: "hello world" })
  })

  it("parses double-quoted string with escape sequences", () => {
    expect(parseYaml('key: "hello \\"world\\""')).toEqual({
      key: 'hello "world"',
    })
  })

  it("parses single-quoted string with '' escape", () => {
    expect(parseYaml("key: 'it''s a test'")).toEqual({ key: "it's a test" })
  })

  it("parses true and false booleans", () => {
    expect(parseYaml("a: true\nb: false")).toEqual({ a: true, b: false })
  })

  it("parses null literal", () => {
    expect(parseYaml("key: null")).toEqual({ key: null })
  })

  it("parses ~ as null", () => {
    expect(parseYaml("key: ~")).toEqual({ key: null })
  })

  it("parses an integer", () => {
    expect(parseYaml("key: 42")).toEqual({ key: 42 })
  })

  it("parses a float", () => {
    expect(parseYaml("key: 3.14")).toEqual({ key: 3.14 })
  })

  it("parses a quoted version string as a string", () => {
    expect(parseYaml('version: "1.0.0"')).toEqual({ version: "1.0.0" })
  })

  it("parses a bare version string as a string", () => {
    expect(parseYaml("version: 1.0.0")).toEqual({ version: "1.0.0" })
  })
})

describe("parseYaml — mappings", () => {
  it("parses a flat mapping", () => {
    expect(parseYaml("id: test\nname: Test\nversion: 1.0.0")).toEqual({
      id: "test",
      name: "Test",
      version: "1.0.0",
    })
  })

  it("parses a nested mapping", () => {
    const input = `
outer:
  inner: value
  other: 42
`.trim()
    expect(parseYaml(input)).toEqual({
      outer: { inner: "value", other: 42 },
    })
  })

  it("parses a key with an empty block value as null", () => {
    const input = `key:\nnext: value`
    expect(parseYaml(input)).toEqual({ key: null, next: "value" })
  })
})

describe("parseYaml — sequences", () => {
  it("parses a sequence of scalars", () => {
    const input = `
claims:
  - read
  - write
  - admin
`.trim()
    expect(parseYaml(input)).toEqual({
      claims: ["read", "write", "admin"],
    })
  })

  it("parses a sequence of mappings", () => {
    const input = `
nodes:
  - id: a
    label: Node A
  - id: b
    label: Node B
`.trim()
    expect(parseYaml(input)).toEqual({
      nodes: [
        { id: "a", label: "Node A" },
        { id: "b", label: "Node B" },
      ],
    })
  })

  it("parses a top-level sequence", () => {
    const input = `
- id: a
  label: A
- id: b
  label: B
`.trim()
    expect(parseYaml(input)).toEqual([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ])
  })
})

describe("parseYaml — comments", () => {
  it("strips inline comments", () => {
    expect(parseYaml("key: value # this is a comment")).toEqual({
      key: "value",
    })
  })

  it("skips comment-only lines", () => {
    const input = `# top comment\nkey: value\n# another comment\nother: 2`
    expect(parseYaml(input)).toEqual({ key: "value", other: 2 })
  })

  it("does not strip # inside a double-quoted string", () => {
    expect(parseYaml('key: "value # not a comment"')).toEqual({
      key: "value # not a comment",
    })
  })
})

describe("parseYaml — GraphDef shape", () => {
  it("parses a minimal graph definition", () => {
    const yaml = `
id: identify-user
name: Identify User
version: "1.0.0"
nodes:
  - id: extract
    label: Extract Identity
    artifact_type: user-profile
    type: automated
  - id: confirm
    label: Confirm Identity
    artifact_type: confirmation
    type: manual
edges:
  - from: extract
    to: confirm
    condition: always
`.trim()

    const result = parseYaml(yaml) as GraphDef
    expect(result.id).toBe("identify-user")
    expect(result.name).toBe("Identify User")
    expect(result.version).toBe("1.0.0")
    expect(result.nodes).toHaveLength(2)
    expect(result.nodes[0]).toEqual({
      id: "extract",
      label: "Extract Identity",
      artifact_type: "user-profile",
      type: "automated",
    })
    expect(result.nodes[1]).toEqual({
      id: "confirm",
      label: "Confirm Identity",
      artifact_type: "confirmation",
      type: "manual",
    })
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0]).toEqual({ from: "extract", to: "confirm", condition: "always" })
  })

  it("parses an edge with an evaluator condition object", () => {
    const yaml = `
id: g
name: G
version: "1.0.0"
nodes:
  - id: a
    label: A
    artifact_type: doc
edges:
  - from: a
    to: b
    condition:
      type: evaluator
      criteria: "output meets quality bar"
`.trim()

    const result = parseYaml(yaml) as GraphDef
    expect(result.edges[0]).toEqual({
      from: "a",
      to: "b",
      condition: { type: "evaluator", criteria: "output meets quality bar" },
    })
  })

  it("parses a node with claims array", () => {
    const yaml = `
id: g
name: G
version: "1.0.0"
nodes:
  - id: a
    label: A
    artifact_type: doc
    claims:
      - can.write
      - can.review
edges: []
`.trim()

    const result = parseYaml(yaml) as unknown as {
      nodes: { claims: string[] }[]
      edges: unknown[]
    }
    expect(result.nodes[0]!.claims).toEqual(["can.write", "can.review"])
    expect(result.edges).toEqual([])
  })

  it("parses a description with special characters", () => {
    const yaml = `
id: g
name: G
version: "1.0.0"
description: "Handles user: sign-in & sign-out"
nodes: []
edges: []
`.trim()

    const result = parseYaml(yaml) as { description: string }
    expect(result.description).toBe("Handles user: sign-in & sign-out")
  })

  it("parses a node with a nested subgraph", () => {
    const yaml = `
id: outer
name: Outer
version: "1.0.0"
nodes:
  - id: step
    label: Step
    artifact_type: doc
    subgraph:
      id: inner
      name: Inner
      version: "1.0.0"
      nodes:
        - id: x
          label: X
          artifact_type: doc
      edges: []
edges: []
`.trim()

    const result = parseYaml(yaml) as GraphDef
    const step = result.nodes[0] as { subgraph: GraphDef }
    expect(step.subgraph).toBeDefined()
    expect(step.subgraph.id).toBe("inner")
    expect(step.subgraph.nodes).toHaveLength(1)
    expect(step.subgraph.nodes[0]!.id).toBe("x")
  })
})

describe("parseYaml — edge cases", () => {
  it("returns null for empty input", () => {
    expect(parseYaml("")).toBeNull()
  })

  it("returns null for comment-only input", () => {
    expect(parseYaml("# just a comment\n# another")).toBeNull()
  })

  it("handles CRLF line endings", () => {
    expect(parseYaml("key: value\r\nother: 2")).toEqual({
      key: "value",
      other: 2,
    })
  })
})
