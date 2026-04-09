import { activatePersona } from "../../personas/activate.js"
import {
  listPersonas,
  loadPersona,
} from "../../personas/filesystem.js"
import { resolveSituational } from "../../personas/situational.js"
import { formatPersona, formatPersonaFile, formatPersonaRefs } from "../format.js"
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
  output(ctx, persona, formatPersona)
}
