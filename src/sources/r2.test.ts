import { describe, expect, test } from "bun:test"
import type { R2Bucket } from "@cloudflare/workers-types"
import { R2BucketSource } from "./r2.js"

// Minimal in-memory R2 fake — just the bits R2BucketSource consumes.
function fakeR2(entries: Record<string, string>): R2Bucket {
  return {
    async get(key: string) {
      const body = entries[key]
      if (body === undefined) return null
      return {
        async text() {
          return body
        },
      }
    },
    async list(opts?: { prefix?: string; cursor?: string }) {
      const prefix = opts?.prefix ?? ""
      const matching = Object.keys(entries)
        .filter((k) => k.startsWith(prefix))
        .sort()
      return {
        objects: matching.map((key) => ({ key })),
        truncated: false,
        cursor: undefined,
      }
    },
  } as unknown as R2Bucket
}

describe("R2BucketSource", () => {
  test("read returns text + r2: locator on hit", async () => {
    const bucket = fakeR2({ "personas/dottie.md": "hello" })
    const source = new R2BucketSource({ bucket, prefix: "personas/", ext: ".md" })
    const record = await source.read("dottie")
    expect(record).toEqual({ text: "hello", locator: "r2:personas/dottie.md" })
  })

  test("read returns undefined when key is missing", async () => {
    const bucket = fakeR2({})
    const source = new R2BucketSource({ bucket })
    expect(await source.read("missing")).toBeUndefined()
  })

  test("list returns names with prefix and ext stripped, sorted", async () => {
    const bucket = fakeR2({
      "personas/zebra.md": "z",
      "personas/alpha.md": "a",
      "personas/mike.md": "m",
      "skills/elsewhere.md": "x",
    })
    const source = new R2BucketSource({ bucket, prefix: "personas/", ext: ".md" })
    expect(await source.list()).toEqual(["alpha", "mike", "zebra"])
  })

  test("list ignores non-matching extension", async () => {
    const bucket = fakeR2({
      "alpha.md": "ok",
      "alpha.json": "wrong",
      "README": "no ext",
    })
    const source = new R2BucketSource({ bucket, ext: ".md" })
    expect(await source.list()).toEqual(["alpha"])
  })

  test("default prefix is empty, default ext is .md", async () => {
    const bucket = fakeR2({ "dottie.md": "ok" })
    const source = new R2BucketSource({ bucket })
    const record = await source.read("dottie")
    expect(record).toEqual({ text: "ok", locator: "r2:dottie.md" })
  })

  test("list paginates via cursor", async () => {
    let calls = 0
    const bucket = {
      async get(_key: string) {
        return null
      },
      async list(opts?: { prefix?: string; cursor?: string }) {
        calls++
        if (opts?.cursor === undefined) {
          return {
            objects: [{ key: "alpha.md" }],
            truncated: true,
            cursor: "page-2",
          }
        }
        return {
          objects: [{ key: "zebra.md" }],
          truncated: false,
          cursor: undefined,
        }
      },
    } as unknown as R2Bucket

    const source = new R2BucketSource({ bucket, ext: ".md" })
    expect(await source.list()).toEqual(["alpha", "zebra"])
    expect(calls).toBe(2)
  })
})
