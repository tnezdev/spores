import type { Memory, MemoryTier, DreamResult } from "../../types.js"
import type { Command } from "../main.js"
import { output } from "../main.js"
import {
  formatMemory,
  formatRecallResults,
  formatDreamResult,
} from "../format.js"

const VALID_TIERS = new Set<string>(["L1", "L2", "L3"])

const NEXT_TIER: Record<MemoryTier, MemoryTier | undefined> = {
  L1: "L2",
  L2: "L3",
  L3: undefined,
}

function parseTier(value: string): MemoryTier {
  if (!VALID_TIERS.has(value)) {
    throw new Error(`Invalid tier "${value}". Must be L1, L2, or L3.`)
  }
  return value as MemoryTier
}

function parseWeight(value: string): number {
  const n = parseFloat(value)
  if (isNaN(n) || n < 0 || n > 1) {
    throw new Error(`Invalid weight "${value}". Must be a number between 0 and 1.`)
  }
  return n
}

export const rememberCommand: Command = async (ctx, args, flags) => {
  const content = args[0]
  if (content === undefined) {
    throw new Error("Usage: spores memory remember <content>")
  }

  const key =
    typeof flags["key"] === "string" ? flags["key"] : crypto.randomUUID()
  const weight =
    typeof flags["weight"] === "string" ? parseWeight(flags["weight"]) : 0.5
  const tier =
    typeof flags["tier"] === "string"
      ? parseTier(flags["tier"])
      : ctx.config.memory.defaultTier
  const tags =
    typeof flags["tags"] === "string"
      ? flags["tags"].split(",").map((t) => t.trim())
      : []
  const source =
    typeof flags["source"] === "string" ? flags["source"] : undefined

  const memory: Memory = {
    key,
    content,
    weight,
    confidence: 1.0,
    tier,
    tags,
    timestamp: new Date().toISOString(),
    ...(source !== undefined ? { source } : {}),
  }

  await ctx.adapter.save(memory)
  output(ctx, memory, formatMemory)
}

export const recallCommand: Command = async (ctx, args, flags) => {
  const text = args[0]
  const limit =
    typeof flags["limit"] === "string" ? parseInt(flags["limit"], 10) : 10
  const tier =
    typeof flags["tier"] === "string"
      ? parseTier(flags["tier"])
      : undefined
  const tags =
    typeof flags["tags"] === "string"
      ? flags["tags"].split(",").map((t) => t.trim())
      : undefined

  const results = await ctx.adapter.query({ text, tags, tier, limit })
  output(ctx, results, formatRecallResults)
}

export const reinforceCommand: Command = async (ctx, args, _flags) => {
  const key = args[0]
  if (key === undefined) {
    throw new Error("Usage: spores memory reinforce <key>")
  }

  const memory = await ctx.adapter.load(key)
  if (memory === undefined) {
    throw new Error(`Unknown memory: ${key}`)
  }

  memory.confidence = Math.min(1, memory.confidence + 0.1)
  memory.timestamp = new Date().toISOString()
  await ctx.adapter.save(memory)
  output(ctx, memory, formatMemory)
}

export const dreamCommand: Command = async (ctx, _args, flags) => {
  const depth =
    typeof flags["depth"] === "string"
      ? parseInt(flags["depth"], 10)
      : ctx.config.memory.dreamDepth
  const dryRun = flags["dry-run"] === true
  const scope =
    typeof flags["scope"] === "string" ? flags["scope"] : undefined

  let memories = await ctx.adapter.list()

  if (scope !== undefined) {
    memories = memories.filter(
      (m) => m.tier === scope || m.tags.includes(scope),
    )
  }

  const result: DreamResult = {
    promoted: [],
    pruned: [],
  }

  for (let pass = 0; pass < depth; pass++) {
    for (const m of memories) {
      if (m.confidence < 0.2) {
        result.pruned.push(m.key)
      } else if (m.confidence >= 0.8) {
        const next = NEXT_TIER[m.tier]
        if (next !== undefined) {
          result.promoted.push(m.key)
          if (!dryRun) {
            m.tier = next
            await ctx.adapter.save(m)
          }
        }
      }
    }

    // Remove pruned from working set
    if (!dryRun) {
      for (const key of result.pruned) {
        await ctx.adapter.delete(key)
      }
    }
    memories = memories.filter((m) => !result.pruned.includes(m.key))
  }

  // Deduplicate
  result.promoted = [...new Set(result.promoted)]
  result.pruned = [...new Set(result.pruned)]

  const prefix = dryRun ? "[dry-run] " : ""
  output(ctx, result, (r) => prefix + formatDreamResult(r))
}

export const forgetCommand: Command = async (ctx, args, _flags) => {
  const key = args[0]
  if (key === undefined) {
    throw new Error("Usage: spores memory forget <key>")
  }

  const deleted = await ctx.adapter.delete(key)
  if (!deleted) {
    throw new Error(`Unknown memory: ${key}`)
  }

  output(ctx, { forgotten: key }, (d) => `Forgotten: ${d.forgotten}`)
}
