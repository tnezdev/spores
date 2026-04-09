import { listSkills, loadSkill } from "../../skills/filesystem.js"
import { formatSkillRefs, formatSkill } from "../format.js"
import type { Command } from "../main.js"
import { output } from "../main.js"

export const skillListCommand: Command = async (ctx, _args, _flags) => {
  const skills = await listSkills(ctx.baseDir)
  output(ctx, skills, (data) => formatSkillRefs(data, ctx.wide))
}

export const skillShowCommand: Command = async (ctx, args, _flags) => {
  const name = args[0]
  if (name === undefined) throw new Error("Usage: skill show <name>")

  const skill = await loadSkill(name, ctx.baseDir)
  if (skill === undefined) throw new Error(`Skill not found: ${name}`)

  output(ctx, skill, formatSkill)
}

export const skillRunCommand: Command = async (ctx, args, _flags) => {
  const name = args[0]
  if (name === undefined) throw new Error("Usage: skill run <name>")

  const skill = await loadSkill(name, ctx.baseDir)
  if (skill === undefined) throw new Error(`Skill not found: ${name}`)

  // Output the assembled prompt body — suitable for piping into an LLM
  if (ctx.json) {
    console.log(JSON.stringify({ name: skill.name, content: skill.content }))
  } else {
    process.stdout.write(skill.content)
  }
}
