import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { FilesystemAdapter } from "./filesystem.js"
import type { Memory } from "../types.js"

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    key: crypto.randomUUID(),
    content: "test memory content",
    weight: 0.5,
    confidence: 1.0,
    tier: "L1",
    tags: [],
    timestamp: new Date().toISOString(),
    ...overrides,
  }
}

describe("FilesystemAdapter", () => {
  let tmpDir: string
  let adapter: FilesystemAdapter

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "spores-test-"))
    adapter = new FilesystemAdapter(tmpDir)
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true })
  })

  it("reports no semantic search capability", () => {
    expect(adapter.capabilities().semanticSearch).toBe(false)
  })

  describe("save / load", () => {
    it("round-trips a memory", async () => {
      const mem = makeMemory({ key: "test-1", content: "hello world" })
      await adapter.save(mem)
      const loaded = await adapter.load("test-1")
      expect(loaded).toEqual(mem)
    })

    it("returns undefined for missing key", async () => {
      const loaded = await adapter.load("nonexistent")
      expect(loaded).toBeUndefined()
    })

    it("overwrites on save with same key", async () => {
      const mem = makeMemory({ key: "test-1", content: "v1" })
      await adapter.save(mem)
      const updated = { ...mem, content: "v2" }
      await adapter.save(updated)
      const loaded = await adapter.load("test-1")
      expect(loaded?.content).toBe("v2")
    })
  })

  describe("delete", () => {
    it("deletes an existing memory", async () => {
      const mem = makeMemory({ key: "del-1" })
      await adapter.save(mem)
      const result = await adapter.delete("del-1")
      expect(result).toBe(true)
      expect(await adapter.load("del-1")).toBeUndefined()
    })

    it("returns false for missing key", async () => {
      const result = await adapter.delete("nonexistent")
      expect(result).toBe(false)
    })
  })

  describe("list", () => {
    it("returns empty array when no memories exist", async () => {
      const all = await adapter.list()
      expect(all).toEqual([])
    })

    it("returns all saved memories", async () => {
      const a = makeMemory({ key: "a" })
      const b = makeMemory({ key: "b" })
      await adapter.save(a)
      await adapter.save(b)
      const all = await adapter.list()
      expect(all).toHaveLength(2)
      const keys = all.map((m) => m.key).sort()
      expect(keys).toEqual(["a", "b"])
    })
  })

  describe("query", () => {
    it("returns all memories when no filters", async () => {
      await adapter.save(makeMemory({ key: "a" }))
      await adapter.save(makeMemory({ key: "b" }))
      const results = await adapter.query({ limit: 10 })
      expect(results).toHaveLength(2)
    })

    it("filters by tag", async () => {
      await adapter.save(makeMemory({ key: "a", tags: ["foo"] }))
      await adapter.save(makeMemory({ key: "b", tags: ["bar"] }))
      const results = await adapter.query({ tags: ["foo"], limit: 10 })
      expect(results).toHaveLength(1)
      expect(results[0]!.memory.key).toBe("a")
    })

    it("filters by tier", async () => {
      await adapter.save(makeMemory({ key: "a", tier: "L1" }))
      await adapter.save(makeMemory({ key: "b", tier: "L2" }))
      const results = await adapter.query({ tier: "L2", limit: 10 })
      expect(results).toHaveLength(1)
      expect(results[0]!.memory.key).toBe("b")
    })

    it("scores by text match", async () => {
      await adapter.save(
        makeMemory({ key: "a", content: "the quick brown fox" }),
      )
      await adapter.save(makeMemory({ key: "b", content: "lazy dog" }))
      const results = await adapter.query({ text: "quick fox", limit: 10 })
      expect(results[0]!.memory.key).toBe("a")
      expect(results[0]!.score).toBeGreaterThan(results[1]!.score)
    })

    it("respects limit", async () => {
      await adapter.save(makeMemory({ key: "a" }))
      await adapter.save(makeMemory({ key: "b" }))
      await adapter.save(makeMemory({ key: "c" }))
      const results = await adapter.query({ limit: 2 })
      expect(results).toHaveLength(2)
    })

    it("ranks higher weight memories first", async () => {
      await adapter.save(
        makeMemory({ key: "low", content: "match", weight: 0.1 }),
      )
      await adapter.save(
        makeMemory({ key: "high", content: "match", weight: 0.9 }),
      )
      const results = await adapter.query({ text: "match", limit: 10 })
      expect(results[0]!.memory.key).toBe("high")
    })
  })
})
