import type { Source, SourceRecord } from "./source.js"

/**
 * A `Source` backed by an in-memory map. Intended for tests and for callers
 * (e.g. seed templates baked into a build) that want a source with no I/O.
 *
 * The `tag` is incorporated into each record's locator so test failures can
 * tell apart which in-memory source produced a given record when several are
 * layered.
 */
export class InMemorySource implements Source {
  constructor(
    private readonly entries: Record<string, string>,
    private readonly tag: string = "in-memory",
  ) {}

  async read(name: string): Promise<SourceRecord | undefined> {
    const text = this.entries[name]
    if (text === undefined) return undefined
    return { text, locator: `${this.tag}:${name}` }
  }

  async list(): Promise<string[]> {
    return Object.keys(this.entries).sort()
  }
}
