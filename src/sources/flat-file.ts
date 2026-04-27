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
 * A `Source` backed by a flat directory of `<name><ext>` files. Suits
 * personas (`<dir>/<name>.md`) and workflows (`<dir>/<name>.json`). Skills
 * use a different layout (`<dir>/<name>/skill.md`) and need their own source.
 *
 * Missing directory is treated as empty — `read` returns `undefined`,
 * `list` returns `[]`. Other I/O errors throw.
 */
export class FlatFileSource implements Source {
  constructor(
    private readonly dir: string,
    private readonly ext: string = ".md",
  ) {}

  async read(name: string): Promise<SourceRecord | undefined> {
    const file = join(this.dir, `${name}${this.ext}`)
    try {
      const text = await readFile(file, "utf-8")
      return { text, locator: file }
    } catch (err) {
      if (isNodeError(err) && err.code === "ENOENT") return undefined
      throw err
    }
  }

  async list(): Promise<string[]> {
    let entries: string[]
    try {
      entries = await readdir(this.dir)
    } catch (err) {
      if (isNodeError(err) && err.code === "ENOENT") return []
      throw err
    }

    return entries
      .filter((e) => e.endsWith(this.ext))
      .map((e) => e.slice(0, -this.ext.length))
      .sort()
  }
}
