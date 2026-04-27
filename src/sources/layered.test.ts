import { describe, expect, test } from "bun:test"
import { InMemorySource } from "./in-memory.js"
import { LayeredSource } from "./layered.js"

describe("LayeredSource", () => {
  test("read: first source wins on name conflict", async () => {
    const top = new InMemorySource({ shared: "from-top" }, "top")
    const bottom = new InMemorySource({ shared: "from-bottom" }, "bottom")
    const layered = new LayeredSource([top, bottom])
    const record = await layered.read("shared")
    expect(record).toEqual({ text: "from-top", locator: "top:shared" })
  })

  test("read: falls through to lower layers when top is missing", async () => {
    const top = new InMemorySource({}, "top")
    const bottom = new InMemorySource({ alpha: "bottom-body" }, "bottom")
    const layered = new LayeredSource([top, bottom])
    const record = await layered.read("alpha")
    expect(record).toEqual({ text: "bottom-body", locator: "bottom:alpha" })
  })

  test("read: returns undefined when no layer has the name", async () => {
    const layered = new LayeredSource([
      new InMemorySource({ a: "1" }),
      new InMemorySource({ b: "2" }),
    ])
    const record = await layered.read("nope")
    expect(record).toBeUndefined()
  })

  test("list: unions all layers, dedupes, sorts", async () => {
    const top = new InMemorySource({ alpha: "1", shared: "top-shared" })
    const bottom = new InMemorySource({ shared: "bottom-shared", zebra: "9" })
    const layered = new LayeredSource([top, bottom])
    expect(await layered.list()).toEqual(["alpha", "shared", "zebra"])
  })

  test("list: returns empty array when no layers have names", async () => {
    const layered = new LayeredSource([
      new InMemorySource({}),
      new InMemorySource({}),
    ])
    expect(await layered.list()).toEqual([])
  })

  test("read: works with a single layer", async () => {
    const layered = new LayeredSource([
      new InMemorySource({ alpha: "a" }, "only"),
    ])
    const record = await layered.read("alpha")
    expect(record).toEqual({ text: "a", locator: "only:alpha" })
  })

  test("read: works with zero layers (returns undefined)", async () => {
    const layered = new LayeredSource([])
    const record = await layered.read("anything")
    expect(record).toBeUndefined()
  })
})
