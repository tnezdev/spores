import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  taskAddCommand,
  taskListCommand,
  taskNextCommand,
  taskShowCommand,
  taskDoneCommand,
  taskAnnotateCommand,
} from "./task.js"
import { FilesystemTaskAdapter } from "../../tasks/filesystem.js"
import { FilesystemAdapter } from "../../memory/filesystem.js"
import type { Ctx } from "../main.js"
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
    json: true, // JSON mode keeps stdout structured & silent for humans
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

describe("task CLI commands", () => {
  let tmpDir: string
  let ctx: Ctx

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "spores-task-cli-"))
    ctx = makeCtx(tmpDir)
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("task add creates a ready task with tags", async () => {
    const out = await captureStdout(() =>
      taskAddCommand(ctx, ["write docs"], { tags: "docs,writing" }),
    )
    const task = JSON.parse(out)
    expect(task.description).toBe("write docs")
    expect(task.status).toBe("ready")
    expect(task.tags).toEqual(["docs", "writing"])
    expect(task.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)

    // Persisted to disk
    const adapter = new FilesystemTaskAdapter(tmpDir)
    const loaded = await adapter.getTask(task.id)
    expect(loaded?.description).toBe("write docs")
  })

  it("task add supports --parent and --wait", async () => {
    const out = await captureStdout(() =>
      taskAddCommand(ctx, ["sub"], {
        parent: "ABC",
        wait: "2099-01-01T00:00:00.000Z",
      }),
    )
    const task = JSON.parse(out)
    expect(task.parent_id).toBe("ABC")
    expect(task.wait_until).toBe("2099-01-01T00:00:00.000Z")
  })

  it("task add requires description", async () => {
    await expect(taskAddCommand(ctx, [], {})).rejects.toThrow(/Usage/)
  })

  it("task list outputs all tasks", async () => {
    const adapter = new FilesystemTaskAdapter(tmpDir)
    await adapter.createTask({
      description: "a",
      status: "ready",
      tags: ["x"],
    })
    await adapter.createTask({
      description: "b",
      status: "ready",
      tags: ["y"],
    })

    const out = await captureStdout(() => taskListCommand(ctx, [], {}))
    const list = JSON.parse(out)
    expect(list.length).toBe(2)
  })

  it("task list filters by status and tags", async () => {
    const adapter = new FilesystemTaskAdapter(tmpDir)
    const a = await adapter.createTask({
      description: "a",
      status: "ready",
      tags: ["x"],
    })
    await adapter.createTask({
      description: "b",
      status: "ready",
      tags: ["y"],
    })
    await adapter.updateTaskStatus(a.id, "done")

    const outStatus = await captureStdout(() =>
      taskListCommand(ctx, [], { status: "done" }),
    )
    expect(JSON.parse(outStatus).length).toBe(1)

    const outTags = await captureStdout(() =>
      taskListCommand(ctx, [], { tags: "y" }),
    )
    const list = JSON.parse(outTags)
    expect(list.length).toBe(1)
    expect(list[0].description).toBe("b")
  })

  it("task list rejects invalid status", async () => {
    await expect(
      taskListCommand(ctx, [], { status: "nope" }),
    ).rejects.toThrow(/Invalid status/)
  })

  it("task next returns most recent ready task", async () => {
    const adapter = new FilesystemTaskAdapter(tmpDir)
    await adapter.createTask({ description: "first", status: "ready", tags: [] })
    const last = await adapter.createTask({
      description: "latest",
      status: "ready",
      tags: [],
    })

    const out = await captureStdout(() => taskNextCommand(ctx, [], {}))
    const task = JSON.parse(out)
    expect(task.id).toBe(last.id)
  })

  it("task next returns null when none ready", async () => {
    const out = await captureStdout(() => taskNextCommand(ctx, [], {}))
    expect(JSON.parse(out)).toBeNull()
  })

  it("task show outputs a task", async () => {
    const adapter = new FilesystemTaskAdapter(tmpDir)
    const t = await adapter.createTask({
      description: "x",
      status: "ready",
      tags: [],
    })

    const out = await captureStdout(() => taskShowCommand(ctx, [t.id], {}))
    expect(JSON.parse(out).id).toBe(t.id)
  })

  it("task show throws on missing id", async () => {
    await expect(taskShowCommand(ctx, ["MISSING"], {})).rejects.toThrow(
      /not found/i,
    )
  })

  it("task done marks a task done", async () => {
    const adapter = new FilesystemTaskAdapter(tmpDir)
    const t = await adapter.createTask({
      description: "x",
      status: "ready",
      tags: [],
    })

    const out = await captureStdout(() => taskDoneCommand(ctx, [t.id], {}))
    const updated = JSON.parse(out)
    expect(updated.status).toBe("done")
    expect(updated.annotations.length).toBe(1)
  })

  it("task annotate appends an annotation", async () => {
    const adapter = new FilesystemTaskAdapter(tmpDir)
    const t = await adapter.createTask({
      description: "x",
      status: "ready",
      tags: [],
    })

    const out = await captureStdout(() =>
      taskAnnotateCommand(ctx, [t.id, "note me"], {}),
    )
    const updated = JSON.parse(out)
    expect(updated.annotations.length).toBe(1)
    expect(updated.annotations[0].text).toBe("note me")
  })

  it("task annotate requires id and text", async () => {
    await expect(taskAnnotateCommand(ctx, ["id-only"], {})).rejects.toThrow(
      /Usage/,
    )
  })
})
