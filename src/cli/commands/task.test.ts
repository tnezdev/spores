import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile, chmod } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  taskAddCommand,
  taskListCommand,
  taskNextCommand,
  taskStartCommand,
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
    wake: {},
  }
  return {
    adapter: new FilesystemAdapter(baseDir),
    config,
    baseDir,
    json: true, // JSON mode keeps stdout structured & silent for humans
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
    const result = JSON.parse(out)
    const task = result.task
    expect(task.description).toBe("write docs")
    expect(task.status).toBe("ready")
    expect(task.tags).toEqual(["docs", "writing"])
    expect(task.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(result.hook).toBeUndefined()

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
    const result = JSON.parse(out)
    expect(result.task.parent_id).toBe("ABC")
    expect(result.task.wait_until).toBe("2099-01-01T00:00:00.000Z")
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
    const result = JSON.parse(out)
    expect(result.task.status).toBe("done")
    expect(result.task.annotations.length).toBe(1)
    expect(result.hook).toBeUndefined()
  })

  it("task done fires task.done hook when present", async () => {
    const adapter = new FilesystemTaskAdapter(tmpDir)
    const t = await adapter.createTask({
      description: "ship it",
      status: "ready",
      tags: ["deploy"],
    })

    // Create a hook in a temp dir and point SPORES_HOOKS_DIR at it
    const hooksDir = await mkdtemp(join(tmpdir(), "spores-hooks-"))
    const hookPath = join(hooksDir, "task.done")
    await writeFile(
      hookPath,
      "#!/usr/bin/env bash\necho \"done: $SPORES_TASK_DESCRIPTION\"\n",
    )
    await chmod(hookPath, 0o755)

    const origEnv = process.env["SPORES_HOOKS_DIR"]
    process.env["SPORES_HOOKS_DIR"] = hooksDir
    try {
      const out = await captureStdout(() => taskDoneCommand(ctx, [t.id], {}))
      const result = JSON.parse(out)
      expect(result.task.status).toBe("done")
      expect(result.hook).toBeDefined()
      expect(result.hook.ran).toBe(true)
      expect(result.hook.stdout).toContain("ship it")
    } finally {
      if (origEnv === undefined) {
        delete process.env["SPORES_HOOKS_DIR"]
      } else {
        process.env["SPORES_HOOKS_DIR"] = origEnv
      }
      await rm(hooksDir, { recursive: true, force: true })
    }
  })

  it("task done hook failure is non-fatal", async () => {
    const adapter = new FilesystemTaskAdapter(tmpDir)
    const t = await adapter.createTask({
      description: "y",
      status: "ready",
      tags: [],
    })

    const hooksDir = await mkdtemp(join(tmpdir(), "spores-hooks-"))
    const hookPath = join(hooksDir, "task.done")
    await writeFile(hookPath, "#!/usr/bin/env bash\nexit 1\n")
    await chmod(hookPath, 0o755)

    const origEnv = process.env["SPORES_HOOKS_DIR"]
    process.env["SPORES_HOOKS_DIR"] = hooksDir
    try {
      const out = await captureStdout(() => taskDoneCommand(ctx, [t.id], {}))
      const result = JSON.parse(out)
      // Task is still marked done despite hook failure
      expect(result.task.status).toBe("done")
      expect(result.hook.ran).toBe(true)
      expect(result.hook.exit_code).toBe(1)
    } finally {
      if (origEnv === undefined) {
        delete process.env["SPORES_HOOKS_DIR"]
      } else {
        process.env["SPORES_HOOKS_DIR"] = origEnv
      }
      await rm(hooksDir, { recursive: true, force: true })
    }
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
    const result = JSON.parse(out)
    expect(result.task.annotations.length).toBe(1)
    expect(result.task.annotations[0].text).toBe("note me")
    expect(result.hook).toBeUndefined()
  })

  it("task annotate requires id and text", async () => {
    await expect(taskAnnotateCommand(ctx, ["id-only"], {})).rejects.toThrow(
      /Usage/,
    )
  })

  // ---------------------------------------------------------------------------
  // task.added hook
  // ---------------------------------------------------------------------------

  it("task add fires task.added hook when present", async () => {
    const hooksDir = await mkdtemp(join(tmpdir(), "spores-hooks-"))
    const hookPath = join(hooksDir, "task.added")
    await writeFile(
      hookPath,
      "#!/usr/bin/env bash\necho \"added: $SPORES_TASK_DESCRIPTION\"\n",
    )
    await chmod(hookPath, 0o755)

    const origEnv = process.env["SPORES_HOOKS_DIR"]
    process.env["SPORES_HOOKS_DIR"] = hooksDir
    try {
      const out = await captureStdout(() =>
        taskAddCommand(ctx, ["hook test task"], {}),
      )
      const result = JSON.parse(out)
      expect(result.task.description).toBe("hook test task")
      expect(result.hook).toBeDefined()
      expect(result.hook.ran).toBe(true)
      expect(result.hook.stdout).toContain("hook test task")
    } finally {
      if (origEnv === undefined) delete process.env["SPORES_HOOKS_DIR"]
      else process.env["SPORES_HOOKS_DIR"] = origEnv
      await rm(hooksDir, { recursive: true, force: true })
    }
  })

  it("task add hook failure is non-fatal", async () => {
    const hooksDir = await mkdtemp(join(tmpdir(), "spores-hooks-"))
    const hookPath = join(hooksDir, "task.added")
    await writeFile(hookPath, "#!/usr/bin/env bash\nexit 1\n")
    await chmod(hookPath, 0o755)

    const origEnv = process.env["SPORES_HOOKS_DIR"]
    process.env["SPORES_HOOKS_DIR"] = hooksDir
    try {
      const out = await captureStdout(() =>
        taskAddCommand(ctx, ["will fail"], {}),
      )
      const result = JSON.parse(out)
      expect(result.task.status).toBe("ready")
      expect(result.hook.ran).toBe(true)
      expect(result.hook.exit_code).toBe(1)
    } finally {
      if (origEnv === undefined) delete process.env["SPORES_HOOKS_DIR"]
      else process.env["SPORES_HOOKS_DIR"] = origEnv
      await rm(hooksDir, { recursive: true, force: true })
    }
  })

  // ---------------------------------------------------------------------------
  // task.started hook
  // ---------------------------------------------------------------------------

  it("task start transitions to in_progress and fires task.started hook", async () => {
    const adapter = new FilesystemTaskAdapter(tmpDir)
    const t = await adapter.createTask({
      description: "start me",
      status: "ready",
      tags: ["work"],
    })

    const hooksDir = await mkdtemp(join(tmpdir(), "spores-hooks-"))
    const hookPath = join(hooksDir, "task.started")
    await writeFile(
      hookPath,
      "#!/usr/bin/env bash\necho \"started: $SPORES_TASK_DESCRIPTION\"\n",
    )
    await chmod(hookPath, 0o755)

    const origEnv = process.env["SPORES_HOOKS_DIR"]
    process.env["SPORES_HOOKS_DIR"] = hooksDir
    try {
      const out = await captureStdout(() =>
        taskStartCommand(ctx, [t.id], {}),
      )
      const result = JSON.parse(out)
      expect(result.task.status).toBe("in_progress")
      expect(result.hook).toBeDefined()
      expect(result.hook.ran).toBe(true)
      expect(result.hook.stdout).toContain("start me")
    } finally {
      if (origEnv === undefined) delete process.env["SPORES_HOOKS_DIR"]
      else process.env["SPORES_HOOKS_DIR"] = origEnv
      await rm(hooksDir, { recursive: true, force: true })
    }
  })

  it("task start without hook sets in_progress cleanly", async () => {
    const adapter = new FilesystemTaskAdapter(tmpDir)
    const t = await adapter.createTask({
      description: "no hook",
      status: "ready",
      tags: [],
    })
    const out = await captureStdout(() => taskStartCommand(ctx, [t.id], {}))
    const result = JSON.parse(out)
    expect(result.task.status).toBe("in_progress")
    expect(result.hook).toBeUndefined()
  })

  it("task start requires id", async () => {
    await expect(taskStartCommand(ctx, [], {})).rejects.toThrow(/Usage/)
  })

  // ---------------------------------------------------------------------------
  // task.annotated hook
  // ---------------------------------------------------------------------------

  it("task annotate fires task.annotated hook when present", async () => {
    const adapter = new FilesystemTaskAdapter(tmpDir)
    const t = await adapter.createTask({
      description: "annotate me",
      status: "ready",
      tags: [],
    })

    const hooksDir = await mkdtemp(join(tmpdir(), "spores-hooks-"))
    const hookPath = join(hooksDir, "task.annotated")
    await writeFile(
      hookPath,
      "#!/usr/bin/env bash\necho \"annotated: $SPORES_TASK_ANNOTATION\"\n",
    )
    await chmod(hookPath, 0o755)

    const origEnv = process.env["SPORES_HOOKS_DIR"]
    process.env["SPORES_HOOKS_DIR"] = hooksDir
    try {
      const out = await captureStdout(() =>
        taskAnnotateCommand(ctx, [t.id, "my note"], {}),
      )
      const result = JSON.parse(out)
      expect(result.task.annotations.length).toBe(1)
      expect(result.task.annotations[0].text).toBe("my note")
      expect(result.hook).toBeDefined()
      expect(result.hook.ran).toBe(true)
      expect(result.hook.stdout).toContain("my note")
    } finally {
      if (origEnv === undefined) delete process.env["SPORES_HOOKS_DIR"]
      else process.env["SPORES_HOOKS_DIR"] = origEnv
      await rm(hooksDir, { recursive: true, force: true })
    }
  })

  it("task annotate hook failure is non-fatal", async () => {
    const adapter = new FilesystemTaskAdapter(tmpDir)
    const t = await adapter.createTask({
      description: "z",
      status: "ready",
      tags: [],
    })

    const hooksDir = await mkdtemp(join(tmpdir(), "spores-hooks-"))
    const hookPath = join(hooksDir, "task.annotated")
    await writeFile(hookPath, "#!/usr/bin/env bash\nexit 1\n")
    await chmod(hookPath, 0o755)

    const origEnv = process.env["SPORES_HOOKS_DIR"]
    process.env["SPORES_HOOKS_DIR"] = hooksDir
    try {
      const out = await captureStdout(() =>
        taskAnnotateCommand(ctx, [t.id, "fail note"], {}),
      )
      const result = JSON.parse(out)
      expect(result.task.annotations.length).toBe(1)
      expect(result.hook.ran).toBe(true)
      expect(result.hook.exit_code).toBe(1)
    } finally {
      if (origEnv === undefined) delete process.env["SPORES_HOOKS_DIR"]
      else process.env["SPORES_HOOKS_DIR"] = origEnv
      await rm(hooksDir, { recursive: true, force: true })
    }
  })
})
