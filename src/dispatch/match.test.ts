import { describe, expect, test } from "bun:test"
import type { Dispatch, DispatchFilter } from "../types.js"
import { match } from "./match.js"

function makeDispatch(overrides: Partial<Dispatch> = {}): Dispatch {
  return {
    id: "01KNRZBRK1S3WAB2DTYG1TNTB5",
    from: "pa:user-x",
    to: "org:channel-y",
    payload: { kind: "test" },
    timestamp: "2026-04-27T12:00:00.000Z",
    ...overrides,
  }
}

describe("match", () => {
  test("empty filter matches every dispatch", () => {
    expect(match(makeDispatch(), {})).toBe(true)
  })

  test("from: exact string matches when equal", () => {
    expect(match(makeDispatch({ from: "scheduler" }), { from: "scheduler" })).toBe(true)
  })

  test("from: exact string fails when unequal", () => {
    expect(match(makeDispatch({ from: "pa:alice" }), { from: "scheduler" })).toBe(false)
  })

  test("from: array matches when value is in the list", () => {
    const d = makeDispatch({ from: "surface:slack" })
    expect(match(d, { from: ["surface:slack", "surface:email"] })).toBe(true)
  })

  test("from: array fails when value is not in the list", () => {
    const d = makeDispatch({ from: "scheduler" })
    expect(match(d, { from: ["surface:slack", "surface:email"] })).toBe(false)
  })

  test("to: exact string matches when equal", () => {
    expect(match(makeDispatch({ to: "self" }), { to: "self" })).toBe(true)
  })

  test("to: array matches by inclusion", () => {
    expect(
      match(makeDispatch({ to: "pa:bob" }), { to: ["pa:alice", "pa:bob"] }),
    ).toBe(true)
  })

  test("from + to: both must match (AND semantics)", () => {
    const d = makeDispatch({ from: "scheduler", to: "self" })
    expect(match(d, { from: "scheduler", to: "self" })).toBe(true)
    expect(match(d, { from: "scheduler", to: "other" })).toBe(false)
    expect(match(d, { from: "other", to: "self" })).toBe(false)
  })

  test("payload is not consulted by the foundation match function", () => {
    // Any payload satisfies a filter that only constrains from/to.
    const d = makeDispatch({ payload: { whatever: 42 } })
    expect(match(d, { from: d.from })).toBe(true)
  })

  test("array filter with single element behaves like exact match", () => {
    const filter: DispatchFilter = { from: ["only-this"] }
    expect(match(makeDispatch({ from: "only-this" }), filter)).toBe(true)
    expect(match(makeDispatch({ from: "anything-else" }), filter)).toBe(false)
  })

  test("empty array filter matches nothing", () => {
    // An empty allowlist is "no values are acceptable" — different from
    // the undefined case (no constraint).
    const filter: DispatchFilter = { from: [] }
    expect(match(makeDispatch(), filter)).toBe(false)
  })
})
