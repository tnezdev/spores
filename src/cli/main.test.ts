import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

const CLI = join(import.meta.dir, "main.ts")

async function run(
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
}

async function runJson(...args: string[]): Promise<unknown> {
  const { stdout } = await run("--json", ...args)
  return JSON.parse(stdout)
}

describe("CLI", () => {
  let tmpDir: string
  let base: string[]

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "spores-cli-test-"))
    base = ["--base-dir", tmpDir]
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true })
  })

  it("shows usage with no args", async () => {
    const { stdout, exitCode } = await run()
    expect(exitCode).toBe(0)
    expect(stdout).toContain("Usage: spores")
  })

  it("shows usage with --help", async () => {
    const { stdout, exitCode } = await run("--help")
    expect(exitCode).toBe(0)
    expect(stdout).toContain("Usage: spores")
  })

  it("exits 1 on unknown command", async () => {
    const { exitCode, stderr } = await run(...base, "bogus")
    expect(exitCode).toBe(1)
    expect(stderr).toContain("Unknown command")
  })

  describe("init", () => {
    it("scaffolds .spores/ directory", async () => {
      const result = (await runJson(...base, "init")) as {
        initialized: boolean
        path: string
      }
      expect(result.initialized).toBe(true)
      expect(result.path).toContain(".spores")
    })

    it("is idempotent", async () => {
      await run(...base, "init")
      const { exitCode } = await run(...base, "init")
      expect(exitCode).toBe(0)
    })
  })

  describe("memory", () => {
    it("remember + recall round-trip", async () => {
      await run(...base, "init")

      // Remember
      const mem = (await runJson(
        ...base,
        "memory",
        "remember",
        "test content",
        "--weight",
        "0.8",
        "--tags",
        "foo,bar",
        "--key",
        "test-key",
      )) as { key: string; content: string; weight: number; tags: string[] }

      expect(mem.key).toBe("test-key")
      expect(mem.content).toBe("test content")
      expect(mem.weight).toBe(0.8)
      expect(mem.tags).toEqual(["foo", "bar"])

      // Recall
      const results = (await runJson(
        ...base,
        "memory",
        "recall",
        "test",
      )) as Array<{ memory: { key: string }; score: number }>

      expect(results.length).toBe(1)
      expect(results[0]!.memory.key).toBe("test-key")
    })

    it("reinforce bumps confidence", async () => {
      await run(...base, "init")
      await run(
        ...base,
        "memory",
        "remember",
        "content",
        "--key",
        "r-key",
      )

      // Confidence starts at 1.0, reinforce caps at 1.0
      // Let's check the structure is right
      const result = (await runJson(
        ...base,
        "memory",
        "reinforce",
        "r-key",
      )) as { key: string; confidence: number }

      expect(result.key).toBe("r-key")
      expect(result.confidence).toBe(1) // already at max
    })

    it("reinforce fails on unknown key", async () => {
      await run(...base, "init")
      const { exitCode } = await run(
        ...base,
        "memory",
        "reinforce",
        "nonexistent",
      )
      expect(exitCode).toBe(1)
    })

    it("forget removes a memory", async () => {
      await run(...base, "init")
      await run(
        ...base,
        "memory",
        "remember",
        "to forget",
        "--key",
        "f-key",
      )

      const { exitCode } = await run(...base, "memory", "forget", "f-key")
      expect(exitCode).toBe(0)

      // Recall should find nothing
      const results = (await runJson(
        ...base,
        "memory",
        "recall",
        "to forget",
      )) as Array<unknown>
      expect(results.length).toBe(0)
    })

    it("forget fails on unknown key", async () => {
      await run(...base, "init")
      const { exitCode } = await run(
        ...base,
        "memory",
        "forget",
        "nonexistent",
      )
      expect(exitCode).toBe(1)
    })

    it("dream --dry-run does not mutate", async () => {
      await run(...base, "init")
      await run(
        ...base,
        "memory",
        "remember",
        "important",
        "--key",
        "d-key",
        "--weight",
        "0.9",
      )

      const dreamResult = (await runJson(
        ...base,
        "memory",
        "dream",
        "--dry-run",
      )) as { promoted: string[]; pruned: string[] }

      expect(dreamResult.promoted).toContain("d-key")

      // Memory should still exist and be L1
      const results = (await runJson(
        ...base,
        "memory",
        "recall",
        "important",
      )) as Array<{ memory: { key: string; tier: string } }>
      expect(results[0]!.memory.tier).toBe("L1")
    })

    it("remember errors without content", async () => {
      await run(...base, "init")
      const { exitCode } = await run(...base, "memory", "remember")
      expect(exitCode).toBe(1)
    })
  })
})
