import { fireHook } from "../../hooks/fire.js"
import { activatePersona } from "../../personas/activate.js"
import {
  listPersonas,
  loadPersona,
} from "../../personas/filesystem.js"
import { resolveSituational } from "../../personas/situational.js"
import type { PersonaActivationOutput } from "../../types.js"
import {
  formatPersonaActivation,
  formatPersonaFile,
  formatPersonaRefs,
} from "../format.js"
import type { Command } from "../main.js"
import { output } from "../main.js"

export const personaListCommand: Command = async (ctx, _args, _flags) => {
  const refs = await listPersonas(ctx.baseDir)
  output(ctx, refs, (data) => formatPersonaRefs(data, ctx.wide))
}

export const personaViewCommand: Command = async (ctx, args, _flags) => {
  const name = args[0]
  if (name === undefined) throw new Error("Usage: persona view <name>")

  const file = await loadPersona(name, ctx.baseDir)
  if (file === undefined) throw new Error(`Persona not found: ${name}`)

  output(ctx, file, formatPersonaFile)
}

export const personaActivateCommand: Command = async (ctx, args, _flags) => {
  const name = args[0]
  if (name === undefined) throw new Error("Usage: persona activate <name>")

  const file = await loadPersona(name, ctx.baseDir)
  if (file === undefined) throw new Error(`Persona not found: ${name}`)

  const situational = await resolveSituational(ctx.baseDir)
  const persona = activatePersona(file, situational)

  // Fire the persona.activated event. Hook stdout is appended to the
  // rendered body in human mode, and to the wrapper object in JSON mode.
  // Design + catalog: tnezdev/spores#26.
  const hook = await fireHook(
    "persona.activated",
    {
      SPORES_PERSONA_NAME: persona.name,
      SPORES_PERSONA_MEMORY_TAGS: persona.memory_tags.join(","),
      SPORES_PERSONA_SKILLS: persona.skills.join(","),
      SPORES_PERSONA_WORKFLOW: persona.workflow ?? "",
    },
    ctx.baseDir,
  )

  const result: PersonaActivationOutput = {
    persona,
    hook: hook.ran ? hook : undefined,
  }
  output(ctx, result, formatPersonaActivation)

  // Hook diagnostics go to stderr regardless of output mode — they're side
  // channels, not payload. Non-zero exit or timeout is a warning, not a
  // failure: the persona activation itself succeeded.
  if (hook.ran) {
    if (hook.stderr.length > 0) {
      process.stderr.write(hook.stderr)
    }
    if (hook.error !== undefined) {
      process.stderr.write(
        `[hook warning] persona.activated: ${hook.error}\n`,
      )
    } else if (hook.exit_code !== null && hook.exit_code !== 0) {
      process.stderr.write(
        `[hook warning] persona.activated exited ${hook.exit_code}\n`,
      )
    }
  }
}
