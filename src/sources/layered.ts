import type { Source, SourceRecord } from "./source.js"

/**
 * Composes multiple sources into one. The first source in the list wins on
 * `read` (live state shadows seed templates); `list` unions and dedupes
 * names across all layers.
 *
 * This is the seed-then-emerge primitive: stack a live mutable source over
 * an immutable seed source, and consumers see the union with live overrides.
 *
 * @example
 *   new LayeredSource([liveDbSource, seedFsSource])
 */
export class LayeredSource implements Source {
  constructor(private readonly sources: readonly Source[]) {}

  async read(name: string): Promise<SourceRecord | undefined> {
    for (const source of this.sources) {
      const record = await source.read(name)
      if (record !== undefined) return record
    }
    return undefined
  }

  async list(): Promise<string[]> {
    const all = new Set<string>()
    for (const source of this.sources) {
      const names = await source.list()
      for (const name of names) all.add(name)
    }
    return Array.from(all).sort()
  }
}
