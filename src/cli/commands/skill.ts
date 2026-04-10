import { listSkills, loadSkill } from "../../skills/filesystem.js"
import { fireHook } from "../../hooks/fire.js"
import { formatSkillRefs, formatSkill, formatSkillInvoked } from "../format.js"
import type { SkillInvokedOutput } from "../../types.js"
import type { Command } from "../context.js"
import { output } from "../output.js"

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

  // Fire the skill.invoked event. Design + catalog: tnezdev/spores#26.
  // Note: hook fires after loading the skill but before writing output so that
  // the hook result can be included in the JSON wrapper. In human mode the
  // hook's stdout is omitted to keep the output pipe-friendly (skill content
  // is meant to be piped to an LLM).
  const hook = await fireHook(
    "skill.invoked",
    {
      SPORES_SKILL_NAME: skill.name,
      SPORES_SKILL_DESCRIPTION: skill.description,
      SPORES_SKILL_TAGS: skill.tags.join(","),
    },
    ctx.baseDir,
  )

  const result: SkillInvokedOutput = {
    skill,
    hook: hook.ran ? hook : undefined,
  }
  output(ctx, result, formatSkillInvoked)

  if (hook.ran) {
    if (hook.stderr.length > 0) process.stderr.write(hook.stderr)
    if (hook.error !== undefined) {
      process.stderr.write(`[hook warning] skill.invoked: ${hook.error}\n`)
    } else if (hook.exit_code !== null && hook.exit_code !== 0) {
      process.stderr.write(`[hook warning] skill.invoked exited ${hook.exit_code}\n`)
    }
  }
}
