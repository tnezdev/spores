import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import type { Source, SourceRecord } from "./source.js"

interface NodeError extends Error {
  code?: string | undefined
}

function isNodeError(err: unknown): err is NodeError {
  return err instanceof Error
}

/**
 * A `Source` backed by `<dir>/<name>/<filename>` — one subdirectory per
 * record, with the body in a fixed file inside. Suits skills
 * (`<dir>/<name>/skill.md`) and any future primitive that wants
 * a directory per record (e.g. for co-located assets).
 *
 * `list()` returns subdirectory names without verifying the inner file
 * exists — the caller's `read` handles the missing case via `undefined`.
 * This keeps `list` cheap (one `readdir`, no extra stats).
 *
 * Missing parent directory is treated as empty.
 */
export class NestedFileSource implements Source {
  constructor(
    private readonly dir: string,
    private readonly filename: string,
  ) {}

  async read(name: string): Promise<SourceRecord | undefined> {
    const file = join(this.dir, name, this.filename)
    try {
      const text = await readFile(file, "utf-8")
      return { text, locator: file }
    } catch (err) {
      if (isNodeError(err) && err.code === "ENOENT") return undefined
      throw err
    }
  }

  async list(): Promise<string[]> {
    let entries: Array<{ name: string; isDirectory: () => boolean }>
    try {
      entries = await readdir(this.dir, { withFileTypes: true })
    } catch (err) {
      if (isNodeError(err) && err.code === "ENOENT") return []
      throw err
    }

    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
  }
}
