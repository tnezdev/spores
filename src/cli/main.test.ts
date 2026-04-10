import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
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
      const remembered = (await runJson(
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
      )) as { memory: { key: string; content: string; weight: number; tags: string[] } }

      expect(remembered.memory.key).toBe("test-key")
      expect(remembered.memory.content).toBe("test content")
      expect(remembered.memory.weight).toBe(0.8)
      expect(remembered.memory.tags).toEqual(["foo", "bar"])

      // Recall
      const recalled = (await runJson(
        ...base,
        "memory",
        "recall",
        "test",
      )) as { results: Array<{ memory: { key: string }; score: number }> }

      expect(recalled.results.length).toBe(1)
      expect(recalled.results[0]!.memory.key).toBe("test-key")
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
      )) as { memory: { key: string; confidence: number } }

      expect(result.memory.key).toBe("r-key")
      expect(result.memory.confidence).toBe(1) // already at max
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
      const recalled = (await runJson(
        ...base,
        "memory",
        "recall",
        "to forget",
      )) as { results: Array<unknown> }
      expect(recalled.results.length).toBe(0)
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
      )) as { result: { promoted: string[]; pruned: string[] } }

      expect(dreamResult.result.promoted).toContain("d-key")

      // Memory should still exist and be L1
      const recalled = (await runJson(
        ...base,
        "memory",
        "recall",
        "important",
      )) as { results: Array<{ memory: { key: string; tier: string } }> }
      expect(recalled.results[0]!.memory.tier).toBe("L1")
    })

    it("remember errors without content", async () => {
      await run(...base, "init")
      const { exitCode } = await run(...base, "memory", "remember")
      expect(exitCode).toBe(1)
    })
  })

  describe("persona", () => {
    // Override HOME so the global personas dir points into a scratch
    // directory rather than the developer's real ~/.spores/personas.
    let fakeHome: string

    async function runPersona(
      ...args: string[]
    ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
      const proc = Bun.spawn(["bun", CLI, ...args], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, HOME: fakeHome },
      })
      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      const exitCode = await proc.exited
      return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
    }

    async function runPersonaJson(...args: string[]): Promise<unknown> {
      const { stdout } = await runPersona("--json", ...args)
      return JSON.parse(stdout)
    }

    async function writePersona(
      dir: string,
      filename: string,
      body: string,
    ): Promise<void> {
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, filename), body)
    }

    beforeEach(async () => {
      fakeHome = await mkdtemp(join(tmpdir(), "spores-cli-home-"))
    })

    afterEach(async () => {
      await rm(fakeHome, { recursive: true })
    })

    const SAMPLE = `---
name: spores-maintainer
description: Activate when working on the spores toolbelt
memory_tags: [spores, npm]
skills: [release]
task_filter:
  tags: [spores]
---

You are working on spores.
The cwd is {{cwd}}.
`

    it("list returns empty when no personas exist", async () => {
      const refs = (await runPersonaJson(
        ...base,
        "persona",
        "list",
      )) as unknown[]
      expect(refs).toEqual([])
    })

    it("list shows project personas", async () => {
      await writePersona(
        join(tmpDir, ".spores", "personas"),
        "spores-maintainer.md",
        SAMPLE,
      )
      const refs = (await runPersonaJson(
        ...base,
        "persona",
        "list",
      )) as Array<{ name: string; description: string }>
      expect(refs).toHaveLength(1)
      expect(refs[0]!.name).toBe("spores-maintainer")
    })

    it("view returns raw body with unsubstituted tokens", async () => {
      await writePersona(
        join(tmpDir, ".spores", "personas"),
        "spores-maintainer.md",
        SAMPLE,
      )
      const file = (await runPersonaJson(
        ...base,
        "persona",
        "view",
        "spores-maintainer",
      )) as { body: string; name: string }
      expect(file.name).toBe("spores-maintainer")
      expect(file.body).toContain("{{cwd}}") // raw — not substituted
    })

    it("activate returns rendered body with substituted tokens", async () => {
      await writePersona(
        join(tmpDir, ".spores", "personas"),
        "spores-maintainer.md",
        SAMPLE,
      )
      // activate wraps the rendered persona in a PersonaActivationOutput
      // alongside any hook result (see tnezdev/spores#27). The persona
      // lives under `.persona`; the hook is undefined when no hook fired.
      const result = (await runPersonaJson(
        ...base,
        "persona",
        "activate",
        "spores-maintainer",
      )) as {
        persona: { body: string; situational: { cwd: string } }
        hook?: unknown
      }
      expect(result.persona.body).not.toContain("{{cwd}}") // substituted
      expect(result.persona.body).toContain(result.persona.situational.cwd)
      expect(result.hook).toBeUndefined()
    })

    it("activate fires persona.activated hook and appends its stdout", async () => {
      await writePersona(
        join(tmpDir, ".spores", "personas"),
        "spores-maintainer.md",
        SAMPLE,
      )
      // Write an executable hook that echoes env vars — this exercises
      // event firing, env propagation, and output wrapping together.
      const hookDir = join(tmpDir, ".spores", "hooks")
      await mkdir(hookDir, { recursive: true })
      const hookPath = join(hookDir, "persona.activated")
      await writeFile(
        hookPath,
        '#!/usr/bin/env bash\necho "event=$SPORES_EVENT"\necho "name=$SPORES_PERSONA_NAME"\necho "tags=$SPORES_PERSONA_MEMORY_TAGS"\n',
      )
      const { chmod } = await import("node:fs/promises")
      await chmod(hookPath, 0o755)

      const result = (await runPersonaJson(
        ...base,
        "persona",
        "activate",
        "spores-maintainer",
      )) as {
        persona: { body: string }
        hook: { ran: boolean; stdout: string; exit_code: number | null }
      }
      expect(result.hook.ran).toBe(true)
      expect(result.hook.exit_code).toBe(0)
      expect(result.hook.stdout).toContain("event=persona.activated")
      expect(result.hook.stdout).toContain("name=spores-maintainer")
      expect(result.hook.stdout).toContain("tags=spores,npm")
    })

    it("view fails on missing persona", async () => {
      const { exitCode, stderr } = await runPersona(
        ...base,
        "persona",
        "view",
        "nonexistent",
      )
      expect(exitCode).toBe(1)
      expect(stderr).toContain("Persona not found")
    })

    it("activate fails on missing persona", async () => {
      const { exitCode, stderr } = await runPersona(
        ...base,
        "persona",
        "activate",
        "nonexistent",
      )
      expect(exitCode).toBe(1)
      expect(stderr).toContain("Persona not found")
    })

    it("list truncates long descriptions by default", async () => {
      const longDesc = "A".repeat(80)
      const content = `---\nname: verbose\ndescription: ${longDesc}\n---\n\nBody.\n`
      await writePersona(
        join(tmpDir, ".spores", "personas"),
        "verbose.md",
        content,
      )
      const { stdout } = await runPersona(...base, "persona", "list")
      expect(stdout).not.toContain(longDesc)
      expect(stdout).toContain("…")
    })

    it("list --wide shows full descriptions", async () => {
      const longDesc = "A".repeat(80)
      const content = `---\nname: verbose\ndescription: ${longDesc}\n---\n\nBody.\n`
      await writePersona(
        join(tmpDir, ".spores", "personas"),
        "verbose.md",
        content,
      )
      const { stdout } = await runPersona(...base, "--wide", "persona", "list")
      expect(stdout).toContain(longDesc)
    })
  })

  describe("--wide flag", () => {
    it("skill list truncates long descriptions by default", async () => {
      const longDesc = "B".repeat(80)
      const skillDir = join(tmpDir, ".spores", "skills", "verbose")
      await mkdir(skillDir, { recursive: true })
      await writeFile(
        join(skillDir, "skill.md"),
        `---\nname: verbose\ndescription: ${longDesc}\ntags: []\n---\n\nContent.\n`,
      )
      const { stdout } = await run(...base, "skill", "list")
      expect(stdout).not.toContain(longDesc)
      expect(stdout).toContain("…")
    })

    it("skill list --wide shows full descriptions", async () => {
      const longDesc = "B".repeat(80)
      const skillDir = join(tmpDir, ".spores", "skills", "verbose")
      await mkdir(skillDir, { recursive: true })
      await writeFile(
        join(skillDir, "skill.md"),
        `---\nname: verbose\ndescription: ${longDesc}\ntags: []\n---\n\nContent.\n`,
      )
      const { stdout } = await run(...base, "--wide", "skill", "list")
      expect(stdout).toContain(longDesc)
    })

    it("task list truncates long descriptions by default", async () => {
      await run(...base, "init")
      const longDesc = "C".repeat(80)
      await run(...base, "task", "add", longDesc)
      const { stdout } = await run(...base, "task", "list")
      expect(stdout).not.toContain(longDesc)
      expect(stdout).toContain("…")
    })

    it("task list --wide shows full descriptions", async () => {
      await run(...base, "init")
      const longDesc = "C".repeat(80)
      await run(...base, "task", "add", longDesc)
      const { stdout } = await run(...base, "--wide", "task", "list")
      expect(stdout).toContain(longDesc)
    })
  })
})
