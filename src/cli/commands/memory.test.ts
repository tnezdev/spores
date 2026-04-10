import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  rememberCommand,
  recallCommand,
  reinforceCommand,
  dreamCommand,
  forgetCommand,
} from "./memory.js"
import { FilesystemAdapter } from "../../memory/filesystem.js"
import type { Ctx } from "../context.js"
import type { SporesConfig } from "../../types.js"

function makeCtx(baseDir: string): Ctx {
  const config: SporesConfig = {
    adapter: "filesystem",
    memory: { dir: ".spores/memory", defaultTier: "L1", dreamDepth: 1 },
    workflow: {
      graphsDir: ".spores/workflow/graphs",
      runsDir: ".spores/workflow/runs",
    },
  }
  return {
    adapter: new FilesystemAdapter(baseDir),
    config,
    baseDir,
    json: true,
    wide: false,
  }
}

function captureStdout(fn: () => Promise<void>): Promise<string> {
  const origLog = console.log
  let captured = ""
  console.log = (...args: unknown[]) => {
    captured +=
      args.map((a) => (typeof a === "string" ? a : String(a))).join(" ") + "\n"
  }
  return fn()
    .then(() => captured)
    .finally(() => {
      console.log = origLog
    })
}

async function withHook(
  event: string,
  script: string,
  fn: () => Promise<void>,
): Promise<void> {
  const hooksDir = await mkdtemp(join(tmpdir(), "spores-mem-hooks-"))
  const hookPath = join(hooksDir, event)
  await writeFile(hookPath, script)
  await chmod(hookPath, 0o755)

  const origEnv = process.env["SPORES_HOOKS_DIR"]
  process.env["SPORES_HOOKS_DIR"] = hooksDir
  try {
    await fn()
  } finally {
    if (origEnv === undefined) delete process.env["SPORES_HOOKS_DIR"]
    else process.env["SPORES_HOOKS_DIR"] = origEnv
    await rm(hooksDir, { recursive: true, force: true })
  }
}

describe("memory commands — hook events", () => {
  let tmpDir: string
  let ctx: Ctx

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "spores-mem-cli-"))
    ctx = makeCtx(tmpDir)
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  // ---------------------------------------------------------------------------
  // memory.remembered
  // ---------------------------------------------------------------------------

  it("memory remember outputs MemoryRememberedOutput wrapper", async () => {
    const out = await captureStdout(() =>
      rememberCommand(ctx, ["hello world"], { key: "hw", tags: "a,b" }),
    )
    const result = JSON.parse(out)
    expect(result.memory).toBeDefined()
    expect(result.memory.key).toBe("hw")
    expect(result.memory.content).toBe("hello world")
    expect(result.memory.tags).toEqual(["a", "b"])
    expect(result.hook).toBeUndefined()
  })

  it("memory remember fires memory.remembered hook with env vars", async () => {
    await withHook(
      "memory.remembered",
      '#!/usr/bin/env bash\necho "key=$SPORES_MEMORY_KEY tier=$SPORES_MEMORY_TIER tags=$SPORES_MEMORY_TAGS"\n',
      async () => {
        const out = await captureStdout(() =>
          rememberCommand(ctx, ["content"], { key: "k1", tags: "x,y", tier: "L2" }),
        )
        const result = JSON.parse(out)
        expect(result.hook).toBeDefined()
        expect(result.hook.ran).toBe(true)
        expect(result.hook.stdout).toContain("key=k1")
        expect(result.hook.stdout).toContain("tier=L2")
        expect(result.hook.stdout).toContain("tags=x,y")
      },
    )
  })

  it("memory remember hook failure is non-fatal", async () => {
    await withHook(
      "memory.remembered",
      "#!/usr/bin/env bash\nexit 3\n",
      async () => {
        const out = await captureStdout(() =>
          rememberCommand(ctx, ["content"], { key: "k2" }),
        )
        const result = JSON.parse(out)
        expect(result.memory.key).toBe("k2")
        expect(result.hook.exit_code).toBe(3)
      },
    )
  })

  // ---------------------------------------------------------------------------
  // memory.recalled
  // ---------------------------------------------------------------------------

  it("memory recall outputs MemoryRecalledOutput wrapper", async () => {
    await rememberCommand(ctx, ["findable"], { key: "r1" })
    const out = await captureStdout(() => recallCommand(ctx, ["findable"], {}))
    const result = JSON.parse(out)
    expect(result.results).toBeDefined()
    expect(Array.isArray(result.results)).toBe(true)
    expect(result.hook).toBeUndefined()
  })

  it("memory recall fires memory.recalled hook with result count", async () => {
    await rememberCommand(ctx, ["findable content"], { key: "r2" })
    await withHook(
      "memory.recalled",
      '#!/usr/bin/env bash\necho "count=$SPORES_MEMORY_RESULT_COUNT query=$SPORES_MEMORY_QUERY"\n',
      async () => {
        const out = await captureStdout(() => recallCommand(ctx, ["findable"], {}))
        const result = JSON.parse(out)
        expect(result.hook.ran).toBe(true)
        expect(result.hook.stdout).toContain("query=findable")
        // count may be 0 or more depending on adapter scoring
        expect(result.hook.stdout).toMatch(/count=\d+/)
      },
    )
  })

  // ---------------------------------------------------------------------------
  // memory.reinforced
  // ---------------------------------------------------------------------------

  it("memory reinforce outputs MemoryReinforcedOutput wrapper", async () => {
    await rememberCommand(ctx, ["reinforce me"], { key: "rf1" })
    const out = await captureStdout(() => reinforceCommand(ctx, ["rf1"], {}))
    const result = JSON.parse(out)
    expect(result.memory).toBeDefined()
    expect(result.memory.key).toBe("rf1")
    expect(result.hook).toBeUndefined()
  })

  it("memory reinforce fires memory.reinforced hook with key and confidence", async () => {
    await rememberCommand(ctx, ["reinforce me"], { key: "rf2" })
    await withHook(
      "memory.reinforced",
      '#!/usr/bin/env bash\necho "key=$SPORES_MEMORY_KEY confidence=$SPORES_MEMORY_CONFIDENCE"\n',
      async () => {
        const out = await captureStdout(() => reinforceCommand(ctx, ["rf2"], {}))
        const result = JSON.parse(out)
        expect(result.hook.ran).toBe(true)
        expect(result.hook.stdout).toContain("key=rf2")
        expect(result.hook.stdout).toMatch(/confidence=\d/)
      },
    )
  })

  // ---------------------------------------------------------------------------
  // memory.forgotten
  // ---------------------------------------------------------------------------

  it("memory forget outputs MemoryForgottenOutput wrapper", async () => {
    await rememberCommand(ctx, ["forget me"], { key: "fg1" })
    const out = await captureStdout(() => forgetCommand(ctx, ["fg1"], {}))
    const result = JSON.parse(out)
    expect(result.key).toBe("fg1")
    expect(result.hook).toBeUndefined()
  })

  it("memory forget fires memory.forgotten hook with key", async () => {
    await rememberCommand(ctx, ["forget me"], { key: "fg2" })
    await withHook(
      "memory.forgotten",
      '#!/usr/bin/env bash\necho "forgotten=$SPORES_MEMORY_KEY"\n',
      async () => {
        const out = await captureStdout(() => forgetCommand(ctx, ["fg2"], {}))
        const result = JSON.parse(out)
        expect(result.hook.ran).toBe(true)
        expect(result.hook.stdout).toContain("forgotten=fg2")
      },
    )
  })

  // ---------------------------------------------------------------------------
  // memory.dreamed
  // ---------------------------------------------------------------------------

  it("memory dream outputs MemoryDreamedOutput wrapper", async () => {
    const out = await captureStdout(() => dreamCommand(ctx, [], {}))
    const result = JSON.parse(out)
    expect(result.result).toBeDefined()
    expect(Array.isArray(result.result.promoted)).toBe(true)
    expect(Array.isArray(result.result.pruned)).toBe(true)
    expect(result.hook).toBeUndefined()
  })

  it("memory dream fires memory.dreamed hook with counts", async () => {
    await rememberCommand(ctx, ["high confidence"], { key: "dr1", weight: "0.9" })
    await withHook(
      "memory.dreamed",
      '#!/usr/bin/env bash\necho "promoted=$SPORES_MEMORY_PROMOTED_COUNT pruned=$SPORES_MEMORY_PRUNED_COUNT dry=$SPORES_DRY_RUN"\n',
      async () => {
        const out = await captureStdout(() => dreamCommand(ctx, [], { "dry-run": true }))
        const result = JSON.parse(out)
        expect(result.hook.ran).toBe(true)
        expect(result.hook.stdout).toMatch(/promoted=\d+/)
        expect(result.hook.stdout).toContain("dry=1")
      },
    )
  })
})
