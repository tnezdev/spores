import type { Persona, PersonaFile, SituationalContext } from "../types.js"

/**
 * Activate a persona by substituting `{{key}}` tokens in the body with
 * live situational facts.
 *
 * Design picks (documented for consistency):
 * - Unknown tokens (e.g. `{{open_prs}}`) are left as literal text. Persona
 *   bodies may intentionally contain template-looking strings that aren't
 *   meant for substitution.
 * - Missing `git_branch` is substituted as an empty string. The output
 *   never contains a literal `{{git_branch}}` even when the cwd is not a
 *   git repo.
 * - No escape syntax. `\{{cwd}}` is not supported. YAGNI.
 *
 * This is a pure function — no filesystem, no process state. All inputs
 * come from the caller. Easy to test, easy to reason about.
 */
export function activatePersona(
  file: PersonaFile,
  situational: SituationalContext,
): Persona {
  const substitutions: Record<string, string> = {
    cwd: situational.cwd,
    timestamp: situational.timestamp,
    hostname: situational.hostname,
    git_branch: situational.git_branch ?? "",
  }

  const body = file.body.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    if (key in substitutions) return substitutions[key]!
    return match // unknown token — leave literal
  })

  // Spread carries every PersonaRef field through; override `body` with the
  // substituted version. Forward-compatible: new optional fields added to
  // PersonaRef automatically propagate to the rendered Persona.
  return {
    ...file,
    body,
    situational,
  }
}
