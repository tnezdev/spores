import { describe, expect, test } from "bun:test"
import { InMemorySource } from "./in-memory.js"

describe("InMemorySource", () => {
  test("read returns text + tagged locator for known names", async () => {
    const source = new InMemorySource({ alpha: "alpha-body" }, "test")
    const record = await source.read("alpha")
    expect(record).toEqual({ text: "alpha-body", locator: "test:alpha" })
  })

  test("read returns undefined for unknown names", async () => {
    const source = new InMemorySource({ alpha: "a" })
    const record = await source.read("missing")
    expect(record).toBeUndefined()
  })

  test("list returns sorted names", async () => {
    const source = new InMemorySource({ zebra: "z", alpha: "a", mike: "m" })
    const names = await source.list()
    expect(names).toEqual(["alpha", "mike", "zebra"])
  })

  test("list returns empty array for empty source", async () => {
    const source = new InMemorySource({})
    const names = await source.list()
    expect(names).toEqual([])
  })

  test("default tag is 'in-memory' when no tag is supplied", async () => {
    const source = new InMemorySource({ alpha: "a" })
    const record = await source.read("alpha")
    expect(record!.locator).toBe("in-memory:alpha")
  })
})
