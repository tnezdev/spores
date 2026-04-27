/**
 * A pluggable source of named, text-shaped config records — personas, skills,
 * workflows, dispatch configs. The source yields raw text by name; per-primitive
 * loaders parse what comes back into the right shape.
 *
 * Sources are read-only. Mutation (creating, editing, deleting records) is
 * out of scope — live evolution happens through memory-side writes or
 * direct source-implementation methods, never through this interface.
 *
 * Sources are config primitives only. Data primitives (memory, artifacts,
 * tasks) have query semantics and live behind their own adapter shapes.
 */
export interface Source {
  /**
   * Read a record by name. Returns `undefined` for not-found; throws on
   * unexpected errors. The `locator` is a source-specific diagnostic
   * identifier (filesystem path, URL, in-memory tag) — useful for error
   * messages and for callers that want to surface where a record came from.
   */
  read(name: string): Promise<SourceRecord | undefined>

  /**
   * List all known names. Used for discovery (CLI `list` verbs, layered
   * source union semantics). Should be cheap relative to `read` — name
   * enumeration only, no body fetches.
   */
  list(): Promise<string[]>
}

export type SourceRecord = {
  text: string
  locator: string
}
