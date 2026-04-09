import type { Task, TaskQuery, TaskStatus } from "../../types.js"
import { FilesystemTaskAdapter } from "../../tasks/filesystem.js"
import type { Command } from "../context.js"
import { output } from "../output.js"
import { formatTask, formatTasks, formatNextTask } from "../format.js"

const VALID_STATUSES = new Set<TaskStatus>([
  "ready",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
])

function parseStatus(value: string): TaskStatus {
  if (!VALID_STATUSES.has(value as TaskStatus)) {
    throw new Error(
      `Invalid status "${value}". Must be one of: ${[...VALID_STATUSES].join(", ")}`,
    )
  }
  return value as TaskStatus
}

function collectFlag(flags: Record<string, string | true>, name: string): string[] {
  // Our arg parser doesn't support repeated flags directly. We support either:
  //   --tag foo --tag bar   (last one wins in flags map — so degrades to one)
  //   --tags foo,bar        (comma-separated; preferred for CLI multi-value)
  // Use --tags for multi.
  const single = flags[name]
  if (typeof single === "string") return [single]
  return []
}

function parseTags(flags: Record<string, string | true>): string[] {
  if (typeof flags["tags"] === "string") {
    return flags["tags"]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }
  return collectFlag(flags, "tag")
}

export const taskAddCommand: Command = async (ctx, args, flags) => {
  const description = args[0]
  if (description === undefined) {
    throw new Error(
      "Usage: spores task add <description> [--tags a,b] [--parent <id>] [--wait <iso>]",
    )
  }

  const adapter = new FilesystemTaskAdapter(ctx.baseDir)
  const tags = parseTags(flags)
  const parent_id =
    typeof flags["parent"] === "string" ? flags["parent"] : undefined
  const wait_until =
    typeof flags["wait"] === "string" ? flags["wait"] : undefined

  const task = await adapter.createTask({
    description,
    status: "ready",
    tags,
    ...(parent_id !== undefined ? { parent_id } : {}),
    ...(wait_until !== undefined ? { wait_until } : {}),
  })

  output(ctx, task, formatTask)
}

export const taskListCommand: Command = async (ctx, _args, flags) => {
  const adapter = new FilesystemTaskAdapter(ctx.baseDir)
  const query: TaskQuery = {}
  if (typeof flags["status"] === "string") {
    query.status = parseStatus(flags["status"])
  }
  const tags = parseTags(flags)
  if (tags.length > 0) query.tags = tags
  if (typeof flags["parent"] === "string") query.parent_id = flags["parent"]

  const tasks = await adapter.listTasks(query)
  // Stable display order: ascending ULID (creation order)
  tasks.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  output(ctx, tasks, (data) => formatTasks(data, ctx.wide))
}

export const taskNextCommand: Command = async (ctx, _args, flags) => {
  const adapter = new FilesystemTaskAdapter(ctx.baseDir)
  const query: Omit<TaskQuery, "status"> = {}
  const tags = parseTags(flags)
  if (tags.length > 0) query.tags = tags
  if (typeof flags["parent"] === "string") query.parent_id = flags["parent"]

  const task = await adapter.nextReadyTask(query)
  output(ctx, task, formatNextTask)
}

export const taskShowCommand: Command = async (ctx, args, _flags) => {
  const id = args[0]
  if (id === undefined) throw new Error("Usage: spores task show <id>")

  const adapter = new FilesystemTaskAdapter(ctx.baseDir)
  const task = await adapter.getTask(id)
  if (task === null) throw new Error(`Task not found: ${id}`)

  output(ctx, task, formatTask)
}

export const taskDoneCommand: Command = async (ctx, args, _flags) => {
  const id = args[0]
  if (id === undefined) throw new Error("Usage: spores task done <id>")

  const adapter = new FilesystemTaskAdapter(ctx.baseDir)
  const task: Task = await adapter.updateTaskStatus(id, "done")
  output(ctx, task, formatTask)
}

export const taskAnnotateCommand: Command = async (ctx, args, _flags) => {
  const id = args[0]
  const text = args[1]
  if (id === undefined || text === undefined) {
    throw new Error("Usage: spores task annotate <id> <text>")
  }

  const adapter = new FilesystemTaskAdapter(ctx.baseDir)
  const task = await adapter.annotateTask(id, text)
  output(ctx, task, formatTask)
}
