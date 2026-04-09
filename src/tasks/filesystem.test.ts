import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, writeFile, mkdir, readdir } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { FilesystemTaskAdapter } from "./filesystem.js"
import type { Task } from "../types.js"

type CreateInput = Omit<Task, "id" | "created_at" | "updated_at" | "annotations">

function taskInput(overrides: Partial<CreateInput> = {}): CreateInput {
  return {
    description: "do a thing",
    status: "ready",
    tags: [],
    ...overrides,
  }
}

describe("FilesystemTaskAdapter", () => {
  let tmpDir: string
  let adapter: FilesystemTaskAdapter

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "spores-tasks-test-"))
    adapter = new FilesystemTaskAdapter(tmpDir)
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  describe("createTask", () => {
    it("creates a task with id, timestamps, empty annotations", async () => {
      const task = await adapter.createTask(taskInput({ description: "x" }))
      expect(task.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
      expect(task.description).toBe("x")
      expect(task.status).toBe("ready")
      expect(task.annotations).toEqual([])
      expect(task.created_at).toBe(task.updated_at)
      expect(typeof task.created_at).toBe("string")
    })

    it("generates monotonic ULIDs under rapid succession", async () => {
      const ids: string[] = []
      for (let i = 0; i < 50; i++) {
        const t = await adapter.createTask(taskInput())
        ids.push(t.id)
      }
      const sorted = [...ids].sort()
      expect(ids).toEqual(sorted)
      // and all unique
      expect(new Set(ids).size).toBe(ids.length)
    })

    it("creates .spores/tasks dir on first write", async () => {
      await adapter.createTask(taskInput())
      const files = await readdir(join(tmpDir, ".spores", "tasks"))
      expect(files.length).toBe(1)
    })
  })

  describe("getTask", () => {
    it("returns a task by id", async () => {
      const created = await adapter.createTask(taskInput({ description: "g" }))
      const loaded = await adapter.getTask(created.id)
      expect(loaded).toEqual(created)
    })

    it("returns null when missing", async () => {
      const loaded = await adapter.getTask("NOPE")
      expect(loaded).toBeNull()
    })
  })

  describe("listTasks", () => {
    it("returns empty when dir is missing", async () => {
      const list = await adapter.listTasks({})
      expect(list).toEqual([])
    })

    it("returns all tasks with empty query", async () => {
      await adapter.createTask(taskInput())
      await adapter.createTask(taskInput())
      const list = await adapter.listTasks({})
      expect(list.length).toBe(2)
    })

    it("filters by status", async () => {
      const a = await adapter.createTask(taskInput({ description: "a" }))
      await adapter.createTask(taskInput({ description: "b" }))
      await adapter.updateTaskStatus(a.id, "done")

      const ready = await adapter.listTasks({ status: "ready" })
      expect(ready.length).toBe(1)
      expect(ready[0]!.description).toBe("b")

      const done = await adapter.listTasks({ status: "done" })
      expect(done.length).toBe(1)
      expect(done[0]!.id).toBe(a.id)
    })

    it("filters by tags (any match)", async () => {
      await adapter.createTask(taskInput({ tags: ["foo", "x"] }))
      await adapter.createTask(taskInput({ tags: ["bar"] }))
      await adapter.createTask(taskInput({ tags: [] }))

      const foo = await adapter.listTasks({ tags: ["foo"] })
      expect(foo.length).toBe(1)

      const fooOrBar = await adapter.listTasks({ tags: ["foo", "bar"] })
      expect(fooOrBar.length).toBe(2)
    })

    it("filters by parent_id", async () => {
      const parent = await adapter.createTask(taskInput({ description: "p" }))
      await adapter.createTask(
        taskInput({ description: "child", parent_id: parent.id }),
      )
      await adapter.createTask(taskInput({ description: "orphan" }))

      const children = await adapter.listTasks({ parent_id: parent.id })
      expect(children.length).toBe(1)
      expect(children[0]!.description).toBe("child")
    })

    it("skips malformed json files with a warning", async () => {
      await adapter.createTask(taskInput({ description: "ok" }))
      await writeFile(join(tmpDir, ".spores", "tasks", "BOGUS.json"), "{not json")
      const list = await adapter.listTasks({})
      expect(list.length).toBe(1)
      expect(list[0]!.description).toBe("ok")
    })
  })

  describe("updateTaskStatus", () => {
    it("updates status and appends a status-change annotation", async () => {
      const created = await adapter.createTask(taskInput())
      const updated = await adapter.updateTaskStatus(created.id, "in_progress")
      expect(updated.status).toBe("in_progress")
      expect(updated.annotations.length).toBe(1)
      expect(updated.annotations[0]!.text).toContain("ready")
      expect(updated.annotations[0]!.text).toContain("in_progress")
      expect(updated.updated_at).toBeDefined()
    })

    it("persists the change", async () => {
      const created = await adapter.createTask(taskInput())
      await adapter.updateTaskStatus(created.id, "done")
      const reloaded = await adapter.getTask(created.id)
      expect(reloaded?.status).toBe("done")
      expect(reloaded?.annotations.length).toBe(1)
    })

    it("throws when task missing", async () => {
      await expect(
        adapter.updateTaskStatus("MISSING", "done"),
      ).rejects.toThrow(/not found/i)
    })
  })

  describe("annotateTask", () => {
    it("appends an annotation with current timestamp", async () => {
      const created = await adapter.createTask(taskInput())
      const before = new Date().toISOString()
      const updated = await adapter.annotateTask(created.id, "hello")
      expect(updated.annotations.length).toBe(1)
      expect(updated.annotations[0]!.text).toBe("hello")
      expect(updated.annotations[0]!.timestamp >= before).toBe(true)
      expect(updated.updated_at).toBe(updated.annotations[0]!.timestamp)
    })

    it("throws when task missing", async () => {
      await expect(adapter.annotateTask("MISSING", "x")).rejects.toThrow(
        /not found/i,
      )
    })
  })

  describe("nextReadyTask", () => {
    it("returns null when no tasks", async () => {
      const next = await adapter.nextReadyTask()
      expect(next).toBeNull()
    })

    it("returns the highest-ULID ready task", async () => {
      const t1 = await adapter.createTask(taskInput({ description: "1" }))
      const t2 = await adapter.createTask(taskInput({ description: "2" }))
      const t3 = await adapter.createTask(taskInput({ description: "3" }))
      expect(t1.id < t2.id && t2.id < t3.id).toBe(true)

      const next = await adapter.nextReadyTask()
      expect(next?.id).toBe(t3.id)
    })

    it("skips non-ready tasks", async () => {
      const t1 = await adapter.createTask(taskInput({ description: "1" }))
      const t2 = await adapter.createTask(taskInput({ description: "2" }))
      await adapter.updateTaskStatus(t2.id, "blocked")

      const next = await adapter.nextReadyTask()
      expect(next?.id).toBe(t1.id)
    })

    it("honors wait_until (skips future)", async () => {
      const future = new Date(Date.now() + 60_000).toISOString()
      const past = new Date(Date.now() - 60_000).toISOString()

      const t1 = await adapter.createTask(
        taskInput({ description: "past", wait_until: past }),
      )
      await adapter.createTask(
        taskInput({ description: "future", wait_until: future }),
      )

      const next = await adapter.nextReadyTask()
      expect(next?.id).toBe(t1.id)
    })

    it("respects tag filter", async () => {
      await adapter.createTask(taskInput({ tags: ["a"] }))
      const b = await adapter.createTask(taskInput({ tags: ["b"] }))

      const next = await adapter.nextReadyTask({ tags: ["b"] })
      expect(next?.id).toBe(b.id)
    })

    it("respects parent_id filter", async () => {
      const parent = await adapter.createTask(taskInput())
      const child = await adapter.createTask(
        taskInput({ parent_id: parent.id }),
      )
      await adapter.createTask(taskInput())

      const next = await adapter.nextReadyTask({ parent_id: parent.id })
      expect(next?.id).toBe(child.id)
    })

    it("returns null when all ready tasks are wait_until future", async () => {
      const future = new Date(Date.now() + 60_000).toISOString()
      await adapter.createTask(
        taskInput({ wait_until: future }),
      )
      const next = await adapter.nextReadyTask()
      expect(next).toBeNull()
    })
  })

  describe("deleteTask", () => {
    it("removes the task file", async () => {
      const t = await adapter.createTask(taskInput())
      await adapter.deleteTask(t.id)
      expect(await adapter.getTask(t.id)).toBeNull()
    })

    it("is a no-op on missing id", async () => {
      await mkdir(join(tmpDir, ".spores", "tasks"), { recursive: true })
      await adapter.deleteTask("MISSING") // should not throw
    })
  })
})
