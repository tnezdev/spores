import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import type { MemoryTier, SporesConfig } from "./types.js"

const DEFAULTS: SporesConfig = {
  adapter: "filesystem",
  memory: {
    dir: ".spores/memory",
    defaultTier: "L1",
    dreamDepth: 3,
  },
  workflow: {
    graphsDir: ".spores/workflows",
    runsDir: ".spores/runs",
  },
  wake: {},
}

type TomlSection = Record<string, string>
type TomlDoc = Record<string, string | TomlSection>

function parseToml(text: string): TomlDoc {
  const result: TomlDoc = {}
  let currentSection: string | undefined

  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (line === "" || line.startsWith("#")) continue

    const sectionMatch = line.match(/^\[(\w+)]$/)
    if (sectionMatch) {
      currentSection = sectionMatch[1]!
      if (result[currentSection] === undefined) {
        result[currentSection] = {}
      }
      continue
    }

    const kvMatch = line.match(/^(\w+)\s*=\s*"?([^"]*)"?$/)
    if (!kvMatch) continue

    const [, key, value] = kvMatch
    if (currentSection !== undefined) {
      const section = result[currentSection]
      if (typeof section === "object") {
        section[key!] = value!
      }
    } else {
      result[key!] = value!
    }
  }

  return result
}

function applyToml(config: SporesConfig, doc: TomlDoc): SporesConfig {
  const result = {
    ...config,
    memory: { ...config.memory },
    workflow: { ...config.workflow },
    wake: { ...config.wake },
  }

  if (typeof doc["adapter"] === "string") {
    result.adapter = doc["adapter"]
  }

  const mem = doc["memory"]
  if (typeof mem === "object") {
    if (mem["dir"] !== undefined) result.memory.dir = mem["dir"]
    if (mem["default_tier"] !== undefined)
      result.memory.defaultTier = mem["default_tier"] as MemoryTier
    if (mem["dream_depth"] !== undefined)
      result.memory.dreamDepth = parseInt(mem["dream_depth"], 10)
  }

  const wf = doc["workflow"]
  if (typeof wf === "object") {
    if (wf["graphs_dir"] !== undefined) result.workflow.graphsDir = wf["graphs_dir"]
    if (wf["runs_dir"] !== undefined) result.workflow.runsDir = wf["runs_dir"]
  }

  const wake = doc["wake"]
  if (typeof wake === "object") {
    if (wake["template"] !== undefined) result.wake.template = wake["template"]
  }

  return result
}

async function tryReadToml(path: string): Promise<TomlDoc | undefined> {
  try {
    const text = await readFile(path, "utf-8")
    return parseToml(text)
  } catch {
    return undefined
  }
}

export async function loadConfig(baseDir: string): Promise<SporesConfig> {
  let config = { ...DEFAULTS, memory: { ...DEFAULTS.memory }, workflow: { ...DEFAULTS.workflow }, wake: { ...DEFAULTS.wake } }

  const globalToml = await tryReadToml(
    join(homedir(), ".spores", "config.toml"),
  )
  if (globalToml !== undefined) {
    config = applyToml(config, globalToml)
  }

  const projectToml = await tryReadToml(
    join(baseDir, ".spores", "config.toml"),
  )
  if (projectToml !== undefined) {
    config = applyToml(config, projectToml)
  }

  return config
}

export { DEFAULTS, parseToml }
