import { readdir, readFile, writeFile, unlink, mkdir } from "node:fs/promises"
import { join } from "node:path"
import type { Memory, RecallQuery, RecallResult } from "../types.js"
import type { AdapterCapabilities, MemoryAdapter } from "./adapter.js"

interface NodeError extends Error {
  code?: string | undefined
}

function isNodeError(err: unknown): err is NodeError {
  return err instanceof Error
}

export class FilesystemAdapter implements MemoryAdapter {
  private dir: string

  constructor(baseDir: string) {
    this.dir = join(baseDir, ".spores", "memory")
  }

  capabilities(): AdapterCapabilities {
    return { semanticSearch: false }
  }

  async save(memory: Memory): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const path = join(this.dir, `${memory.key}.json`)
    await writeFile(path, JSON.stringify(memory, null, 2))
  }

  async load(key: string): Promise<Memory | undefined> {
    try {
      const data = await readFile(join(this.dir, `${key}.json`), "utf-8")
      return JSON.parse(data) as Memory
    } catch (err) {
      if (isNodeError(err) && err.code === "ENOENT") return undefined
      throw err
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      await unlink(join(this.dir, `${key}.json`))
      return true
    } catch (err) {
      if (isNodeError(err) && err.code === "ENOENT") return false
      throw err
    }
  }

  async list(): Promise<Memory[]> {
    try {
      const files = await readdir(this.dir)
      const memories: Memory[] = []
      for (const file of files) {
        if (!file.endsWith(".json")) continue
        const data = await readFile(join(this.dir, file), "utf-8")
        memories.push(JSON.parse(data) as Memory)
      }
      return memories
    } catch (err) {
      if (isNodeError(err) && err.code === "ENOENT") return []
      throw err
    }
  }

  async query(q: RecallQuery): Promise<RecallResult[]> {
    const all = await this.list()

    let filtered = all

    if (q.tags !== undefined && q.tags.length > 0) {
      filtered = filtered.filter((m) =>
        q.tags!.some((t) => m.tags.includes(t)),
      )
    }

    if (q.tier !== undefined) {
      filtered = filtered.filter((m) => m.tier === q.tier)
    }

    const scored: RecallResult[] = filtered.map((memory) => {
      let score = 1.0
      if (q.text !== undefined && q.text.length > 0) {
        const lower = memory.content.toLowerCase()
        const terms = q.text.toLowerCase().split(/\s+/)
        const hits = terms.filter((t) => lower.includes(t)).length
        score = terms.length > 0 ? hits / terms.length : 0
      }
      return { memory, score: score * memory.weight * memory.confidence }
    })

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, q.limit)
  }
}
