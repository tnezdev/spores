import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FlatFileSource } from "./flat-file.js"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "spores-flat-file-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("FlatFileSource", () => {
  test("read returns text + absolute path locator", async () => {
    const file = join(dir, "alpha.md")
    await writeFile(file, "alpha-body")
    const source = new FlatFileSource(dir)
    const record = await source.read("alpha")
    expect(record).toEqual({ text: "alpha-body", locator: file })
  })

  test("read returns undefined for missing file", async () => {
    const source = new FlatFileSource(dir)
    const record = await source.read("missing")
    expect(record).toBeUndefined()
  })

  test("read returns undefined when directory does not exist", async () => {
    const source = new FlatFileSource(join(dir, "nonexistent"))
    const record = await source.read("alpha")
    expect(record).toBeUndefined()
  })

  test("list returns names without extension, sorted", async () => {
    await writeFile(join(dir, "zebra.md"), "z")
    await writeFile(join(dir, "alpha.md"), "a")
    await writeFile(join(dir, "mike.md"), "m")
    const source = new FlatFileSource(dir)
    expect(await source.list()).toEqual(["alpha", "mike", "zebra"])
  })

  test("list filters by extension", async () => {
    await writeFile(join(dir, "alpha.md"), "a")
    await writeFile(join(dir, "README.txt"), "x")
    await writeFile(join(dir, "config.json"), "{}")
    const source = new FlatFileSource(dir, ".md")
    expect(await source.list()).toEqual(["alpha"])
  })

  test("list returns empty array when directory does not exist", async () => {
    const source = new FlatFileSource(join(dir, "nonexistent"))
    expect(await source.list()).toEqual([])
  })

  test("custom extension reads matching files", async () => {
    await writeFile(join(dir, "graph.json"), '{"id":"x"}')
    const source = new FlatFileSource(dir, ".json")
    const record = await source.read("graph")
    expect(record!.text).toBe('{"id":"x"}')
  })

  test("nested subdirectories are not surfaced", async () => {
    await mkdir(join(dir, "subdir"))
    await writeFile(join(dir, "subdir", "alpha.md"), "a")
    await writeFile(join(dir, "top.md"), "t")
    const source = new FlatFileSource(dir)
    expect(await source.list()).toEqual(["top"])
  })
})
