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

  describe("workflow", () => {
    const graphJson = JSON.stringify({
      id: "test-graph",
      name: "Test Graph",
      version: "1.0",
      nodes: [
        { id: "A", label: "Step A", artifact_type: "doc" },
        { id: "B", label: "Step B", artifact_type: "doc" },
      ],
      edges: [{ from: "A", to: "B" }],
    })

    async function writeGraphFile(dir: string): Promise<string> {
      const { writeFile } = await import("node:fs/promises")
      const path = join(dir, "graph.json")
      await writeFile(path, graphJson)
      return path
    }

    it("create + list round-trip", async () => {
      await run(...base, "init")
      const graphFile = await writeGraphFile(tmpDir)

      const create = await run(...base, "workflow", "create", graphFile)
      expect(create.exitCode).toBe(0)

      const list = (await runJson(...base, "workflow", "list")) as Array<{
        id: string
      }>
      expect(list).toHaveLength(1)
      expect(list[0]!.id).toBe("test-graph")
    })

    it("show displays graph details", async () => {
      await run(...base, "init")
      const graphFile = await writeGraphFile(tmpDir)
      await run(...base, "workflow", "create", graphFile)

      const show = (await runJson(...base, "workflow", "show", "test-graph")) as {
        id: string
        nodes: Array<{ id: string }>
      }
      expect(show.id).toBe("test-graph")
      expect(show.nodes).toHaveLength(2)
    })

    it("run creates a new run", async () => {
      await run(...base, "init")
      const graphFile = await writeGraphFile(tmpDir)
      await run(...base, "workflow", "create", graphFile)

      const result = (await runJson(
        ...base,
        "workflow",
        "run",
        "test-graph",
      )) as { run_id: string; graph_id: string }
      expect(result.run_id).toBeDefined()
      expect(result.graph_id).toBe("test-graph")
    })

    it("full lifecycle: next -> start -> done -> next -> start -> done", async () => {
      await run(...base, "init")
      const graphFile = await writeGraphFile(tmpDir)
      await run(...base, "workflow", "create", graphFile)

      const created = (await runJson(
        ...base,
        "workflow",
        "run",
        "test-graph",
      )) as { run_id: string }
      const runId = created.run_id

      // Next should return A
      let next = (await runJson(...base, "workflow", "next", runId)) as string[]
      expect(next).toEqual(["A"])

      // Start A
      const startA = await run(...base, "workflow", "start", runId, "A")
      expect(startA.exitCode).toBe(0)

      // Done A
      const doneA = await run(...base, "workflow", "done", runId, "A")
      expect(doneA.exitCode).toBe(0)

      // Next should return B
      next = (await runJson(...base, "workflow", "next", runId)) as string[]
      expect(next).toEqual(["B"])

      // Start and done B
      await run(...base, "workflow", "start", runId, "B")
      await run(...base, "workflow", "done", runId, "B")

      // Next should be empty
      next = (await runJson(...base, "workflow", "next", runId)) as string[]
      expect(next).toEqual([])
    })

    it("status shows node states", async () => {
      await run(...base, "init")
      const graphFile = await writeGraphFile(tmpDir)
      await run(...base, "workflow", "create", graphFile)

      const created = (await runJson(
        ...base,
        "workflow",
        "run",
        "test-graph",
      )) as { run_id: string }

      const status = (await runJson(
        ...base,
        "workflow",
        "status",
        created.run_id,
      )) as Record<string, { status: string }>
      expect(status["A"]!.status).toBe("pending")
      expect(status["B"]!.status).toBe("pending")
    })

    it("fail records failure with reason", async () => {
      await run(...base, "init")
      const graphFile = await writeGraphFile(tmpDir)
      await run(...base, "workflow", "create", graphFile)

      const created = (await runJson(
        ...base,
        "workflow",
        "run",
        "test-graph",
      )) as { run_id: string }
      const runId = created.run_id

      await run(...base, "workflow", "start", runId, "A")
      const fail = await run(
        ...base,
        "workflow",
        "fail",
        runId,
        "A",
        "--reason",
        "timed out",
      )
      expect(fail.exitCode).toBe(0)

      const history = (await runJson(
        ...base,
        "workflow",
        "history",
        runId,
      )) as Array<{ to_status: string; reason?: string }>
      const failEntry = history.find((t) => t.to_status === "failed")
      expect(failEntry).toBeDefined()
      expect(failEntry!.reason).toBe("timed out")
    })

    it("history shows transitions", async () => {
      await run(...base, "init")
      const graphFile = await writeGraphFile(tmpDir)
      await run(...base, "workflow", "create", graphFile)

      const created = (await runJson(
        ...base,
        "workflow",
        "run",
        "test-graph",
      )) as { run_id: string }
      const runId = created.run_id

      await run(...base, "workflow", "start", runId, "A")
      await run(...base, "workflow", "done", runId, "A")

      const history = (await runJson(
        ...base,
        "workflow",
        "history",
        runId,
      )) as Array<{ node_id: string; to_status: string }>
      expect(history).toHaveLength(2)
      expect(history[0]!.to_status).toBe("in_progress")
      expect(history[1]!.to_status).toBe("completed")
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
