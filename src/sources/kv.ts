import type { KVNamespace } from "@cloudflare/workers-types"
import type { Source, SourceRecord } from "./source.js"

/**
 * A `Source` backed by a Cloudflare KV namespace binding. Layout:
 * `<prefix><name>` — KV doesn't have file extensions, so naming is
 * caller's choice. The optional `ext` is only stripped on listing
 * (for consistency with file-style sources where `<name>.md` lists
 * as `<name>`); read-by-name uses the bare key as given.
 *
 * KV's eventual consistency means newly-written records may not be
 * immediately readable globally. That's a service-level concern, not
 * one this source can paper over.
 *
 * @example
 *   const source = new KvSource({
 *     kv: env.PERSONAS_KV,
 *     prefix: "personas:",
 *   })
 *   const persona = await loadPersonaFromSource("dottie", source)
 *   // Reads key `personas:dottie` from KV.
 */
export class KvSource implements Source {
  private readonly kv: KVNamespace
  private readonly prefix: string
  private readonly ext: string

  constructor(opts: { kv: KVNamespace; prefix?: string; ext?: string }) {
    this.kv = opts.kv
    this.prefix = opts.prefix ?? ""
    this.ext = opts.ext ?? ""
  }

  async read(name: string): Promise<SourceRecord | undefined> {
    const key = `${this.prefix}${name}${this.ext}`
    const text = await this.kv.get(key, "text")
    if (text === null) return undefined
    return { text, locator: `kv:${key}` }
  }

  async list(): Promise<string[]> {
    const names = new Set<string>()
    let cursor: string | undefined
    while (true) {
      const result = await this.kv.list(
        cursor === undefined
          ? { prefix: this.prefix }
          : { prefix: this.prefix, cursor },
      )
      for (const entry of result.keys) {
        if (this.ext.length > 0 && !entry.name.endsWith(this.ext)) continue
        const stripped = entry.name.slice(
          this.prefix.length,
          this.ext.length > 0 ? entry.name.length - this.ext.length : entry.name.length,
        )
        if (stripped.length > 0) names.add(stripped)
      }
      if (result.list_complete) break
      cursor = result.cursor ?? undefined
    }

    return Array.from(names).sort()
  }
}
