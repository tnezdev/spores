import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NestedFileSource } from "./nested-file.js"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "spores-nested-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("NestedFileSource", () => {
  test("read returns text + absolute path locator", async () => {
    await mkdir(join(dir, "alpha"), { recursive: true })
    const file = join(dir, "alpha", "skill.md")
    await writeFile(file, "alpha-body")
    const source = new NestedFileSource(dir, "skill.md")
    const record = await source.read("alpha")
    expect(record).toEqual({ text: "alpha-body", locator: file })
  })

  test("read returns undefined when subdir lacks the inner file", async () => {
    await mkdir(join(dir, "empty"), { recursive: true })
    const source = new NestedFileSource(dir, "skill.md")
    const record = await source.read("empty")
    expect(record).toBeUndefined()
  })

  test("read returns undefined when subdir does not exist", async () => {
    const source = new NestedFileSource(dir, "skill.md")
    const record = await source.read("missing")
    expect(record).toBeUndefined()
  })

  test("read returns undefined when parent directory does not exist", async () => {
    const source = new NestedFileSource(join(dir, "nonexistent"), "skill.md")
    const record = await source.read("anything")
    expect(record).toBeUndefined()
  })

  test("list returns subdirectory names, sorted", async () => {
    await mkdir(join(dir, "zebra"), { recursive: true })
    await mkdir(join(dir, "alpha"), { recursive: true })
    await mkdir(join(dir, "mike"), { recursive: true })
    const source = new NestedFileSource(dir, "skill.md")
    expect(await source.list()).toEqual(["alpha", "mike", "zebra"])
  })

  test("list ignores top-level files (only subdirectories surface)", async () => {
    await mkdir(join(dir, "alpha"), { recursive: true })
    await writeFile(join(dir, "README.md"), "not a skill")
    const source = new NestedFileSource(dir, "skill.md")
    expect(await source.list()).toEqual(["alpha"])
  })

  test("list returns empty array when parent directory does not exist", async () => {
    const source = new NestedFileSource(join(dir, "nonexistent"), "skill.md")
    expect(await source.list()).toEqual([])
  })

  test("list does not verify the inner file exists (caller's read handles it)", async () => {
    // A subdir without the expected inner file still appears in `list`;
    // `read` returns undefined for it. This matches the "list is cheap,
    // read is authoritative" contract.
    await mkdir(join(dir, "valid"), { recursive: true })
    await writeFile(join(dir, "valid", "skill.md"), "ok")
    await mkdir(join(dir, "no-skill"), { recursive: true })
    const source = new NestedFileSource(dir, "skill.md")
    expect(await source.list()).toEqual(["no-skill", "valid"])
    expect(await source.read("no-skill")).toBeUndefined()
    expect(await source.read("valid")).toBeDefined()
  })

  test("custom inner filename works", async () => {
    await mkdir(join(dir, "alpha"), { recursive: true })
    await writeFile(join(dir, "alpha", "spec.json"), '{"id":"x"}')
    const source = new NestedFileSource(dir, "spec.json")
    const record = await source.read("alpha")
    expect(record!.text).toBe('{"id":"x"}')
  })
})
