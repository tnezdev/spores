import { describe, expect, test } from "bun:test"
import type { KVNamespace } from "@cloudflare/workers-types"
import { KvSource } from "./kv.js"

function fakeKv(entries: Record<string, string>): KVNamespace {
  return {
    async get(key: string, _format?: "text") {
      return entries[key] ?? null
    },
    async list(opts?: { prefix?: string; cursor?: string }) {
      const prefix = opts?.prefix ?? ""
      const matching = Object.keys(entries)
        .filter((k) => k.startsWith(prefix))
        .sort()
      return {
        keys: matching.map((name) => ({ name })),
        list_complete: true,
        cursor: undefined,
      }
    },
  } as unknown as KVNamespace
}

describe("KvSource", () => {
  test("read returns text + kv: locator on hit", async () => {
    const kv = fakeKv({ "personas:dottie": "hello" })
    const source = new KvSource({ kv, prefix: "personas:" })
    const record = await source.read("dottie")
    expect(record).toEqual({ text: "hello", locator: "kv:personas:dottie" })
  })

  test("read returns undefined when key is missing", async () => {
    const kv = fakeKv({})
    const source = new KvSource({ kv })
    expect(await source.read("missing")).toBeUndefined()
  })

  test("list strips prefix from keys, returns sorted names", async () => {
    const kv = fakeKv({
      "personas:zebra": "z",
      "personas:alpha": "a",
      "personas:mike": "m",
      "skills:elsewhere": "x",
    })
    const source = new KvSource({ kv, prefix: "personas:" })
    expect(await source.list()).toEqual(["alpha", "mike", "zebra"])
  })

  test("list with ext filter excludes non-matching keys", async () => {
    const kv = fakeKv({
      "alpha.md": "ok",
      "alpha.json": "wrong",
      "README": "no ext",
    })
    const source = new KvSource({ kv, ext: ".md" })
    expect(await source.list()).toEqual(["alpha"])
  })

  test("default prefix empty, default ext empty — keys used as-is", async () => {
    const kv = fakeKv({ dottie: "ok" })
    const source = new KvSource({ kv })
    const record = await source.read("dottie")
    expect(record).toEqual({ text: "ok", locator: "kv:dottie" })
  })

  test("list paginates via cursor until list_complete", async () => {
    let calls = 0
    const kv = {
      async get(_key: string) {
        return null
      },
      async list(opts?: { prefix?: string; cursor?: string }) {
        calls++
        if (opts?.cursor === undefined) {
          return {
            keys: [{ name: "alpha" }],
            list_complete: false,
            cursor: "page-2",
          }
        }
        return {
          keys: [{ name: "zebra" }],
          list_complete: true,
          cursor: undefined,
        }
      },
    } as unknown as KVNamespace

    const source = new KvSource({ kv })
    expect(await source.list()).toEqual(["alpha", "zebra"])
    expect(calls).toBe(2)
  })
})
