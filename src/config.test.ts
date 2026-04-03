import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { loadConfig, parseToml, DEFAULTS } from "./config.js"

describe("parseToml", () => {
  it("parses top-level keys", () => {
    const doc = parseToml('adapter = "filesystem"')
    expect(doc["adapter"]).toBe("filesystem")
  })

  it("parses sections", () => {
    const doc = parseToml('[memory]\ndir = ".spores/memory"')
    expect((doc["memory"] as Record<string, string>)["dir"]).toBe(
      ".spores/memory",
    )
  })

  it("ignores comments and blank lines", () => {
    const doc = parseToml('# comment\n\nadapter = "test"')
    expect(doc["adapter"]).toBe("test")
  })
})

describe("loadConfig", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "spores-config-test-"))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true })
  })

  it("returns defaults when no config files exist", async () => {
    const config = await loadConfig(tmpDir)
    expect(config.adapter).toBe(DEFAULTS.adapter)
    expect(config.memory.defaultTier).toBe(DEFAULTS.memory.defaultTier)
    expect(config.memory.dreamDepth).toBe(DEFAULTS.memory.dreamDepth)
  })

  it("project config overrides defaults", async () => {
    await mkdir(join(tmpDir, ".spores"), { recursive: true })
    await writeFile(
      join(tmpDir, ".spores", "config.toml"),
      '[memory]\ndream_depth = "5"',
    )
    const config = await loadConfig(tmpDir)
    expect(config.memory.dreamDepth).toBe(5)
    expect(config.adapter).toBe(DEFAULTS.adapter)
  })
})
