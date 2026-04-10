import type {
  Memory,
  MemoryTier,
  MemoryRememberedOutput,
  MemoryRecalledOutput,
  MemoryReinforcedOutput,
  MemoryForgottenOutput,
  MemoryDreamedOutput,
  HookInvocation,
} from "../../types.js"
import { fireHook } from "../../hooks/fire.js"
import type { Command } from "../context.js"
import { output } from "../output.js"
import {
  formatMemoryRemembered,
  formatMemoryRecalled,
  formatMemoryReinforced,
  formatMemoryForgotten,
  formatMemoryDreamed,
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

function emitHookWarning(event: string, hook: HookInvocation): void {
  if (!hook.ran) return
  if (hook.stderr.length > 0) process.stderr.write(hook.stderr)
  if (hook.error !== undefined) {
    process.stderr.write(`[hook warning] ${event}: ${hook.error}\n`)
  } else if (hook.exit_code !== null && hook.exit_code !== 0) {
    process.stderr.write(`[hook warning] ${event} exited ${hook.exit_code}\n`)
  }
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

  // Fire the memory.remembered event. Design + catalog: tnezdev/spores#26.
  const hook = await fireHook(
    "memory.remembered",
    {
      SPORES_MEMORY_KEY: memory.key,
      SPORES_MEMORY_TIER: memory.tier,
      SPORES_MEMORY_TAGS: memory.tags.join(","),
      SPORES_MEMORY_WEIGHT: String(memory.weight),
    },
    ctx.baseDir,
  )

  const result: MemoryRememberedOutput = { memory, hook: hook.ran ? hook : undefined }
  output(ctx, result, formatMemoryRemembered)
  emitHookWarning("memory.remembered", hook)
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

  // Fire the memory.recalled event. Design + catalog: tnezdev/spores#26.
  const hook = await fireHook(
    "memory.recalled",
    {
      SPORES_MEMORY_QUERY: text ?? "",
      SPORES_MEMORY_RESULT_COUNT: String(results.length),
    },
    ctx.baseDir,
  )

  const recalled: MemoryRecalledOutput = { results, hook: hook.ran ? hook : undefined }
  output(ctx, recalled, formatMemoryRecalled)
  emitHookWarning("memory.recalled", hook)
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

  // Fire the memory.reinforced event. Design + catalog: tnezdev/spores#26.
  const hook = await fireHook(
    "memory.reinforced",
    {
      SPORES_MEMORY_KEY: memory.key,
      SPORES_MEMORY_TIER: memory.tier,
      SPORES_MEMORY_CONFIDENCE: String(memory.confidence),
    },
    ctx.baseDir,
  )

  const result: MemoryReinforcedOutput = { memory, hook: hook.ran ? hook : undefined }
  output(ctx, result, formatMemoryReinforced)
  emitHookWarning("memory.reinforced", hook)
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

  const dreamResult = {
    promoted: [] as string[],
    pruned: [] as string[],
  }

  for (let pass = 0; pass < depth; pass++) {
    for (const m of memories) {
      if (m.confidence < 0.2) {
        dreamResult.pruned.push(m.key)
      } else if (m.confidence >= 0.8) {
        const next = NEXT_TIER[m.tier]
        if (next !== undefined) {
          dreamResult.promoted.push(m.key)
          if (!dryRun) {
            m.tier = next
            await ctx.adapter.save(m)
          }
        }
      }
    }

    // Remove pruned from working set
    if (!dryRun) {
      for (const key of dreamResult.pruned) {
        await ctx.adapter.delete(key)
      }
    }
    memories = memories.filter((m) => !dreamResult.pruned.includes(m.key))
  }

  // Deduplicate
  dreamResult.promoted = [...new Set(dreamResult.promoted)]
  dreamResult.pruned = [...new Set(dreamResult.pruned)]

  // Fire the memory.dreamed event. Design + catalog: tnezdev/spores#26.
  const hook = await fireHook(
    "memory.dreamed",
    {
      SPORES_MEMORY_PROMOTED_COUNT: String(dreamResult.promoted.length),
      SPORES_MEMORY_PRUNED_COUNT: String(dreamResult.pruned.length),
      SPORES_DRY_RUN: dryRun ? "1" : "0",
    },
    ctx.baseDir,
  )

  const result: MemoryDreamedOutput = { result: dreamResult, hook: hook.ran ? hook : undefined }
  const prefix = dryRun ? "[dry-run] " : ""
  output(ctx, result, (r) => prefix + formatMemoryDreamed(r))
  emitHookWarning("memory.dreamed", hook)
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

  // Fire the memory.forgotten event. Design + catalog: tnezdev/spores#26.
  const hook = await fireHook(
    "memory.forgotten",
    { SPORES_MEMORY_KEY: key },
    ctx.baseDir,
  )

  const result: MemoryForgottenOutput = { key, hook: hook.ran ? hook : undefined }
  output(ctx, result, formatMemoryForgotten)
  emitHookWarning("memory.forgotten", hook)
}
