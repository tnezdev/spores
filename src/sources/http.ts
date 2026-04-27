import type { Source, SourceRecord } from "./source.js"

/**
 * Resolves a record name to the URL its body lives at. Pure function;
 * the source calls it once per `read`. Use this seam to encode whatever
 * URL convention the upstream service prefers (path style, query
 * parameters, prefix layouts, content-addressed digests, etc.).
 */
export type UrlForName = (name: string) => string

/**
 * A `Source` over HTTP — fetches each record's body from a URL derived
 * from its name. Universal: works on Bun, Node 18+, Workers, browsers,
 * anywhere `fetch` exists.
 *
 * The source is auth-agnostic. Callers wanting signed requests (S3, R2
 * via S3 API, private CDN, etc.) inject a custom `fetcher` that wraps
 * `globalThis.fetch` with whatever signing logic they need. Spores
 * stays out of credential management.
 *
 * `list` is intentionally minimal — over plain HTTP there's no portable
 * way to enumerate names. If the upstream service exposes a listing
 * endpoint (S3 ListObjectsV2, KV list keys, etc.), wrap that in
 * `listFromIndex` and pass it in. Otherwise `list` is unsupported and
 * throws — which is the right failure mode for a discovery operation
 * that fundamentally cannot be performed.
 *
 * @example
 *   // GitHub raw — public, no auth, name-as-filename
 *   new HttpSource({
 *     urlForName: (name) => `https://raw.githubusercontent.com/org/repo/main/personas/${name}.md`,
 *   })
 *
 * @example
 *   // R2 via S3 API — caller provides SigV4-signing fetcher
 *   new HttpSource({
 *     urlForName: (name) => `${endpoint}/${bucket}/personas/${name}.md`,
 *     fetcher: signedFetch,
 *     listFromIndex: async () => listKeys(endpoint, bucket, "personas/"),
 *   })
 */
export class HttpSource implements Source {
  private readonly urlForName: UrlForName
  private readonly fetcher: typeof fetch
  private readonly listFromIndex?: () => Promise<string[]>

  constructor(opts: {
    urlForName: UrlForName
    fetcher?: typeof fetch
    listFromIndex?: () => Promise<string[]>
  }) {
    this.urlForName = opts.urlForName
    this.fetcher = opts.fetcher ?? globalThis.fetch
    if (opts.listFromIndex !== undefined) {
      this.listFromIndex = opts.listFromIndex
    }
  }

  async read(name: string): Promise<SourceRecord | undefined> {
    const url = this.urlForName(name)
    const response = await this.fetcher(url)
    if (response.status === 404) return undefined
    if (!response.ok) {
      throw new Error(
        `HttpSource.read(${name}): ${response.status} ${response.statusText} (${url})`,
      )
    }
    const text = await response.text()
    return { text, locator: url }
  }

  async list(): Promise<string[]> {
    if (this.listFromIndex === undefined) {
      throw new Error(
        "HttpSource.list() is not supported — pass `listFromIndex` to the constructor if your upstream service can enumerate names.",
      )
    }
    const names = await this.listFromIndex()
    return [...names].sort()
  }
}
