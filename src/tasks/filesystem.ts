import { readdir, readFile, writeFile, unlink, mkdir } from "node:fs/promises"
import { join } from "node:path"
import type {
  Task,
  TaskStatus,
  TaskQuery,
  TaskAnnotation,
} from "../types.js"
import type { TaskAdapter } from "./adapter.js"

interface NodeError extends Error {
  code?: string | undefined
}

function isNodeError(err: unknown): err is NodeError {
  return err instanceof Error
}

// ---------------------------------------------------------------------------
// Minimal monotonic ULID generator (zero deps)
//
// 26-char Crockford base32: 10 char timestamp (ms since epoch) + 16 char
// randomness. Monotonic behavior: if called within the same ms, increments
// the randomness portion instead of re-randomizing — guarantees strict
// lexical ordering for rapid-succession IDs.
// ---------------------------------------------------------------------------

const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const TIME_LEN = 10
const RANDOM_LEN = 16

function encodeTime(now: number, len: number): string {
  let out = ""
  for (let i = len - 1; i >= 0; i--) {
    const mod = now % 32
    out = ULID_ALPHABET[mod]! + out
    now = (now - mod) / 32
  }
  return out
}

function randomChars(len: number): string {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  let out = ""
  for (let i = 0; i < len; i++) {
    out += ULID_ALPHABET[bytes[i]! % 32]
  }
  return out
}

// Increment a base32 string in place (used for monotonic collisions).
function incrementBase32(s: string): string {
  const chars = s.split("")
  for (let i = chars.length - 1; i >= 0; i--) {
    const idx = ULID_ALPHABET.indexOf(chars[i]!)
    if (idx < 31) {
      chars[i] = ULID_ALPHABET[idx + 1]!
      return chars.join("")
    }
    chars[i] = "0"
  }
  // Overflow — extraordinarily unlikely; fall back to fresh randomness.
  return randomChars(chars.length)
}

function createUlidFactory(): () => string {
  let lastTime = 0
  let lastRandom = ""
  return function ulid(): string {
    const now = Date.now()
    if (now === lastTime) {
      lastRandom = incrementBase32(lastRandom)
    } else {
      lastTime = now
      lastRandom = randomChars(RANDOM_LEN)
    }
    return encodeTime(now, TIME_LEN) + lastRandom
  }
}

// ---------------------------------------------------------------------------
// FilesystemTaskAdapter
// ---------------------------------------------------------------------------

export class FilesystemTaskAdapter implements TaskAdapter {
  private dir: string
  private ulid: () => string

  constructor(baseDir: string) {
    this.dir = join(baseDir, ".spores", "tasks")
    this.ulid = createUlidFactory()
  }

  async createTask(
    input: Omit<Task, "id" | "created_at" | "updated_at" | "annotations">,
  ): Promise<Task> {
    const now = new Date().toISOString()
    const task: Task = {
      ...input,
      id: this.ulid(),
      annotations: [],
      created_at: now,
      updated_at: now,
    }
    await this.writeTask(task)
    return task
  }

  async getTask(id: string): Promise<Task | null> {
    try {
      const data = await readFile(join(this.dir, `${id}.json`), "utf-8")
      return JSON.parse(data) as Task
    } catch (err) {
      if (isNodeError(err) && err.code === "ENOENT") return null
      throw err
    }
  }

  async listTasks(query: TaskQuery): Promise<Task[]> {
    const all = await this.readAll()
    return all.filter((t) => matchesQuery(t, query))
  }

  async updateTaskStatus(id: string, status: TaskStatus): Promise<Task> {
    const task = await this.getTask(id)
    if (task === null) throw new Error(`Task not found: ${id}`)

    const previous = task.status
    const now = new Date().toISOString()
    const annotation: TaskAnnotation = {
      text: `status: ${previous} → ${status}`,
      timestamp: now,
    }
    const updated: Task = {
      ...task,
      status,
      annotations: [...task.annotations, annotation],
      updated_at: now,
    }
    await this.writeTask(updated)
    return updated
  }

  async annotateTask(id: string, text: string): Promise<Task> {
    const task = await this.getTask(id)
    if (task === null) throw new Error(`Task not found: ${id}`)

    const now = new Date().toISOString()
    const updated: Task = {
      ...task,
      annotations: [...task.annotations, { text, timestamp: now }],
      updated_at: now,
    }
    await this.writeTask(updated)
    return updated
  }

  async nextReadyTask(
    query?: Omit<TaskQuery, "status">,
  ): Promise<Task | null> {
    const now = new Date().toISOString()
    const all = await this.readAll()
    const candidates = all.filter((t) => {
      if (t.status !== "ready") return false
      if (t.wait_until !== undefined && t.wait_until > now) return false
      if (!matchesQuery(t, { ...query, status: "ready" })) return false
      return true
    })
    if (candidates.length === 0) return null
    // Highest ULID = most recent
    candidates.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    return candidates[0]!
  }

  async deleteTask(id: string): Promise<void> {
    try {
      await unlink(join(this.dir, `${id}.json`))
    } catch (err) {
      if (isNodeError(err) && err.code === "ENOENT") return
      throw err
    }
  }

  // -------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------

  private async writeTask(task: Task): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const path = join(this.dir, `${task.id}.json`)
    await writeFile(path, JSON.stringify(task, null, 2))
  }

  private async readAll(): Promise<Task[]> {
    let files: string[]
    try {
      files = await readdir(this.dir)
    } catch (err) {
      if (isNodeError(err) && err.code === "ENOENT") return []
      throw err
    }

    const tasks: Task[] = []
    for (const file of files) {
      if (!file.endsWith(".json")) continue
      try {
        const data = await readFile(join(this.dir, file), "utf-8")
        tasks.push(JSON.parse(data) as Task)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // Library code: warn via stderr, not stdout (no console.log).
        process.stderr.write(
          `warning: skipping malformed task file ${file}: ${msg}\n`,
        )
      }
    }
    return tasks
  }
}

function matchesQuery(task: Task, query: TaskQuery): boolean {
  if (query.status !== undefined && task.status !== query.status) return false
  if (query.parent_id !== undefined && task.parent_id !== query.parent_id)
    return false
  if (query.tags !== undefined && query.tags.length > 0) {
    const hasAny = query.tags.some((t) => task.tags.includes(t))
    if (!hasAny) return false
  }
  return true
}
