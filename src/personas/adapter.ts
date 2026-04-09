import type { PersonaFile, PersonaRef } from "../types.js"

/**
 * Adapter interface for persona storage. IO-only — rendering happens in
 * `activatePersona()` (src/personas/activate.ts), a pure function that
 * takes a `PersonaFile` and a `SituationalContext`.
 *
 * Keeping IO and rendering separate means:
 * - the pure function is trivially testable (no filesystem, no process state)
 * - `view` and `activate` CLI verbs dispatch through the same adapter call
 *   and differ only in whether they run `activatePersona`
 * - future adapters (database, HTTP, etc.) only need to produce a
 *   `PersonaFile`, not a rendered `Persona`
 */
export interface PersonaAdapter {
  /**
   * List all available personas as metadata-only refs. Cheap — does not
   * read persona bodies. Implementations should skip any persona missing
   * required fields (`name`, `description`) rather than throwing.
   */
  listPersonas(): Promise<PersonaRef[]>

  /**
   * Load a single persona by name, returning its raw (unsubstituted) body
   * alongside metadata. Returns undefined if not found. Pair with
   * `activatePersona()` to substitute situational tokens.
   */
  loadPersona(name: string): Promise<PersonaFile | undefined>
}
