import type { MemoryAdapter } from "../memory/adapter.js"
import type { SporesConfig } from "../types.js"

export type Ctx = {
  adapter: MemoryAdapter
  config: SporesConfig
  baseDir: string
  json: boolean
  wide: boolean
}

export type Command = (
  ctx: Ctx,
  args: string[],
  flags: Record<string, string | true>,
) => Promise<void>
