import { mkdir, writeFile, access } from "node:fs/promises"
import { join } from "node:path"
import type { Command } from "../main.js"
import { output } from "../main.js"

const DEFAULT_CONFIG = `# SPORES configuration
# See: https://github.com/tnezdev/spores

adapter = "filesystem"

[memory]
dir = ".spores/memory"
default_tier = "L1"
dream_depth = "3"
`

export const initCommand: Command = async (ctx, _args, _flags) => {
  const sporesDir = join(ctx.baseDir, ".spores")
  const memoryDir = join(sporesDir, "memory")
  const configPath = join(sporesDir, "config.toml")

  let alreadyExists = false
  try {
    await access(sporesDir)
    alreadyExists = true
  } catch {
    // doesn't exist, we'll create it
  }

  await mkdir(memoryDir, { recursive: true })

  if (!alreadyExists) {
    await writeFile(configPath, DEFAULT_CONFIG)
  }

  output(
    ctx,
    { initialized: true, path: sporesDir, alreadyExists },
    (d) =>
      d.alreadyExists
        ? `Already initialized at ${d.path}`
        : `Initialized SPORES at ${d.path}`,
  )
}
