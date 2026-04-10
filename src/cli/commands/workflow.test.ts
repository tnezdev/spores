import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile, chmod } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  workflowCreateCommand,
  workflowRunCommand,
  workflowDoneCommand,
  workflowFailCommand,
  workflowStartCommand,
} from "./workflow.js"
import type { Ctx } from "../main.js"
import type { SporesConfig } from "../../types.js"
import { FilesystemAdapter } from "../../memory/filesystem.js"

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

/** Capture each console.log call as a separate string in an array. */
function captureOutputCalls(fn: () => Promise<void>): Promise<string[]> {
  const origLog = console.log
  const calls: string[] = []
  console.log = (...args: unknown[]) => {
    calls.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "))
  }
  return fn()
    .then(() => calls)
    .finally(() => {
      console.log = origLog
    })
}

/** A minimal linear graph: A → B */
const LINEAR_GRAPH = {
  id: "linear",
  name: "Linear",
  version: "1.0",
  nodes: [
    { id: "A", label: "Step A", artifact_type: "doc" },
    { id: "B", label: "Step B", artifact_type: "doc" },
  ],
  edges: [{ from: "A", to: "B" }],
}

describe("workflow CLI commands — workflow.run.started hook", () => {
  let tmpDir: string
  let graphFile: string
  let ctx: Ctx

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "spores-wf-started-"))
    await mkdir(join(tmpDir, ".spores", "workflow", "graphs"), { recursive: true })
    await mkdir(join(tmpDir, ".spores", "workflow", "runs"), { recursive: true })
    await mkdir(join(tmpDir, ".spores", "memory"), { recursive: true })

    graphFile = join(tmpDir, "linear.json")
    await writeFile(graphFile, JSON.stringify(LINEAR_GRAPH))

    ctx = makeCtx(tmpDir)
    await workflowCreateCommand(ctx, [graphFile], {})
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("fires workflow.run.started when a run is created (no hook installed)", async () => {
    const calls = await captureOutputCalls(() => workflowRunCommand(ctx, ["linear"], {}))

    // One output call — the WorkflowRunStartedOutput
    expect(calls.length).toBe(1)
    const started = JSON.parse(calls[0]!)
    expect(started.run_id).toBeDefined()
    expect(started.graph_id).toBe("linear")
    expect(started.hook).toBeUndefined() // no hook installed
  })

  it("fires workflow.run.started hook and captures output", async () => {
    const hooksDir = await mkdtemp(join(tmpdir(), "spores-hooks-started-"))
    const hookPath = join(hooksDir, "workflow.run.started")
    await writeFile(
      hookPath,
      '#!/usr/bin/env bash\necho "run $SPORES_RUN_ID started for graph $SPORES_GRAPH_ID"\n',
    )
    await chmod(hookPath, 0o755)

    const origEnv = process.env["SPORES_HOOKS_DIR"]
    process.env["SPORES_HOOKS_DIR"] = hooksDir
    try {
      const calls = await captureOutputCalls(() => workflowRunCommand(ctx, ["linear"], {}))
      expect(calls.length).toBe(1)

      const started = JSON.parse(calls[0]!)
      expect(started.run_id).toBeDefined()
      expect(started.graph_id).toBe("linear")
      expect(started.hook).toBeDefined()
      expect(started.hook.ran).toBe(true)
      expect(started.hook.stdout).toContain(started.run_id)
      expect(started.hook.stdout).toContain("linear")
    } finally {
      if (origEnv === undefined) {
        delete process.env["SPORES_HOOKS_DIR"]
      } else {
        process.env["SPORES_HOOKS_DIR"] = origEnv
      }
      await rm(hooksDir, { recursive: true, force: true })
    }
  })

  it("workflow.run.started hook failure is non-fatal", async () => {
    const hooksDir = await mkdtemp(join(tmpdir(), "spores-hooks-started-"))
    const hookPath = join(hooksDir, "workflow.run.started")
    await writeFile(hookPath, "#!/usr/bin/env bash\nexit 3\n")
    await chmod(hookPath, 0o755)

    const origEnv = process.env["SPORES_HOOKS_DIR"]
    process.env["SPORES_HOOKS_DIR"] = hooksDir
    try {
      const calls = await captureOutputCalls(() => workflowRunCommand(ctx, ["linear"], {}))
      expect(calls.length).toBe(1)

      const started = JSON.parse(calls[0]!)
      expect(started.run_id).toBeDefined()
      expect(started.hook.ran).toBe(true)
      expect(started.hook.exit_code).toBe(3)
    } finally {
      if (origEnv === undefined) {
        delete process.env["SPORES_HOOKS_DIR"]
      } else {
        process.env["SPORES_HOOKS_DIR"] = origEnv
      }
      await rm(hooksDir, { recursive: true, force: true })
    }
  })
})

describe("workflow CLI commands — workflow.run.terminated hook", () => {
  let tmpDir: string
  let graphFile: string
  let ctx: Ctx

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "spores-wf-"))
    await mkdir(join(tmpDir, ".spores", "workflow", "graphs"), { recursive: true })
    await mkdir(join(tmpDir, ".spores", "workflow", "runs"), { recursive: true })
    await mkdir(join(tmpDir, ".spores", "memory"), { recursive: true })

    graphFile = join(tmpDir, "linear.json")
    await writeFile(graphFile, JSON.stringify(LINEAR_GRAPH))

    ctx = makeCtx(tmpDir)
    await workflowCreateCommand(ctx, [graphFile], {})
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("does not fire when run is not yet terminal (mid-run)", async () => {
    // Create run, start A, complete A → B still pending, not terminal
    const [runBlob] = await captureOutputCalls(() => workflowRunCommand(ctx, ["linear"], {}))
    const runId = JSON.parse(runBlob!).run_id

    await captureOutputCalls(() => workflowStartCommand(ctx, [runId, "A"], {}))

    // Complete A — B is still pending so run is NOT terminal
    const calls = await captureOutputCalls(() => workflowDoneCommand(ctx, [runId, "A"], {}))

    // Only one output call — just the transition, no terminated block
    expect(calls.length).toBe(1)
    const transition = JSON.parse(calls[0]!)
    expect(transition.node_id).toBe("A")
    expect(transition.to_status).toBe("completed")
  })

  it("fires workflow.run.terminated when last node completes (no hook installed)", async () => {
    const [runBlob] = await captureOutputCalls(() => workflowRunCommand(ctx, ["linear"], {}))
    const runId = JSON.parse(runBlob!).run_id

    await captureOutputCalls(() => workflowStartCommand(ctx, [runId, "A"], {}))
    await captureOutputCalls(() => workflowDoneCommand(ctx, [runId, "A"], {}))
    await captureOutputCalls(() => workflowStartCommand(ctx, [runId, "B"], {}))

    // Completing B makes the run terminal — expect two output calls
    const calls = await captureOutputCalls(() => workflowDoneCommand(ctx, [runId, "B"], {}))
    expect(calls.length).toBe(2)

    const transition = JSON.parse(calls[0]!)
    expect(transition.node_id).toBe("B")
    expect(transition.to_status).toBe("completed")

    const terminated = JSON.parse(calls[1]!)
    expect(terminated.run_id).toBe(runId)
    expect(terminated.graph_id).toBe("linear")
    expect(terminated.outcome).toBe("completed")
    expect(terminated.hook).toBeUndefined() // no hook installed
  })

  it("fires workflow.run.terminated with outcome=failed when last node fails", async () => {
    const [runBlob] = await captureOutputCalls(() => workflowRunCommand(ctx, ["linear"], {}))
    const runId = JSON.parse(runBlob!).run_id

    await captureOutputCalls(() => workflowStartCommand(ctx, [runId, "A"], {}))
    await captureOutputCalls(() => workflowDoneCommand(ctx, [runId, "A"], {}))
    await captureOutputCalls(() => workflowStartCommand(ctx, [runId, "B"], {}))

    const calls = await captureOutputCalls(() => workflowFailCommand(ctx, [runId, "B"], {}))
    expect(calls.length).toBe(2)

    const terminated = JSON.parse(calls[1]!)
    expect(terminated.outcome).toBe("failed")
    expect(terminated.run_id).toBe(runId)
  })

  it("fires workflow.run.terminated hook and captures output", async () => {
    const hooksDir = await mkdtemp(join(tmpdir(), "spores-hooks-"))
    const hookPath = join(hooksDir, "workflow.run.terminated")
    await writeFile(
      hookPath,
      '#!/usr/bin/env bash\necho "run $SPORES_RUN_ID finished: $SPORES_RUN_OUTCOME"\n',
    )
    await chmod(hookPath, 0o755)

    const origEnv = process.env["SPORES_HOOKS_DIR"]
    process.env["SPORES_HOOKS_DIR"] = hooksDir
    try {
      const [runBlob] = await captureOutputCalls(() => workflowRunCommand(ctx, ["linear"], {}))
      const runId = JSON.parse(runBlob!).run_id

      await captureOutputCalls(() => workflowStartCommand(ctx, [runId, "A"], {}))
      await captureOutputCalls(() => workflowDoneCommand(ctx, [runId, "A"], {}))
      await captureOutputCalls(() => workflowStartCommand(ctx, [runId, "B"], {}))

      const calls = await captureOutputCalls(() => workflowDoneCommand(ctx, [runId, "B"], {}))
      expect(calls.length).toBe(2)

      const terminated = JSON.parse(calls[1]!)
      expect(terminated.hook).toBeDefined()
      expect(terminated.hook.ran).toBe(true)
      expect(terminated.hook.stdout).toContain(runId)
      expect(terminated.hook.stdout).toContain("completed")
    } finally {
      if (origEnv === undefined) {
        delete process.env["SPORES_HOOKS_DIR"]
      } else {
        process.env["SPORES_HOOKS_DIR"] = origEnv
      }
      await rm(hooksDir, { recursive: true, force: true })
    }
  })

  it("workflow.run.terminated hook failure is non-fatal", async () => {
    const hooksDir = await mkdtemp(join(tmpdir(), "spores-hooks-"))
    const hookPath = join(hooksDir, "workflow.run.terminated")
    await writeFile(hookPath, "#!/usr/bin/env bash\nexit 2\n")
    await chmod(hookPath, 0o755)

    const origEnv = process.env["SPORES_HOOKS_DIR"]
    process.env["SPORES_HOOKS_DIR"] = hooksDir
    try {
      const [runBlob] = await captureOutputCalls(() => workflowRunCommand(ctx, ["linear"], {}))
      const runId = JSON.parse(runBlob!).run_id

      await captureOutputCalls(() => workflowStartCommand(ctx, [runId, "A"], {}))
      await captureOutputCalls(() => workflowDoneCommand(ctx, [runId, "A"], {}))
      await captureOutputCalls(() => workflowStartCommand(ctx, [runId, "B"], {}))

      const calls = await captureOutputCalls(() => workflowDoneCommand(ctx, [runId, "B"], {}))
      expect(calls.length).toBe(2)

      const terminated = JSON.parse(calls[1]!)
      // Hook ran but failed — still returns terminated output
      expect(terminated.run_id).toBe(runId)
      expect(terminated.hook.ran).toBe(true)
      expect(terminated.hook.exit_code).toBe(2)
    } finally {
      if (origEnv === undefined) {
        delete process.env["SPORES_HOOKS_DIR"]
      } else {
        process.env["SPORES_HOOKS_DIR"] = origEnv
      }
      await rm(hooksDir, { recursive: true, force: true })
    }
  })
})
