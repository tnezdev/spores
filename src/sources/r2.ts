import type { R2Bucket } from "@cloudflare/workers-types"
import type { Source, SourceRecord } from "./source.js"

/**
 * A `Source` backed by a Cloudflare R2 bucket binding. Inside Workers,
 * use the binding directly — it's an in-process call, no edge round-trip.
 * For external-to-Workers consumers, prefer `HttpSource` with an
 * S3-compatible signed fetcher.
 *
 * Layout: `<prefix><name><ext>`. Defaults match the persona/skill/workflow
 * conventions but apply to any flat-keyed object store.
 *
 * @example
 *   // In a Worker handler
 *   const source = new R2BucketSource({
 *     bucket: env.PERSONAS_BUCKET,
 *     prefix: "personas/",
 *     ext: ".md",
 *   })
 *   const persona = await loadPersonaFromSource("dottie", source)
 */
export class R2BucketSource implements Source {
  private readonly bucket: R2Bucket
  private readonly prefix: string
  private readonly ext: string

  constructor(opts: { bucket: R2Bucket; prefix?: string; ext?: string }) {
    this.bucket = opts.bucket
    this.prefix = opts.prefix ?? ""
    this.ext = opts.ext ?? ".md"
  }

  async read(name: string): Promise<SourceRecord | undefined> {
    const key = `${this.prefix}${name}${this.ext}`
    const obj = await this.bucket.get(key)
    if (obj === null) return undefined
    const text = await obj.text()
    return { text, locator: `r2:${key}` }
  }

  async list(): Promise<string[]> {
    const names = new Set<string>()
    let cursor: string | undefined
    do {
      const result = await this.bucket.list(
        cursor === undefined
          ? { prefix: this.prefix }
          : { prefix: this.prefix, cursor },
      )
      for (const obj of result.objects) {
        if (!obj.key.endsWith(this.ext)) continue
        const stripped = obj.key
          .slice(this.prefix.length, obj.key.length - this.ext.length)
        if (stripped.length > 0) names.add(stripped)
      }
      cursor = result.truncated ? result.cursor : undefined
    } while (cursor !== undefined)

    return Array.from(names).sort()
  }
}
