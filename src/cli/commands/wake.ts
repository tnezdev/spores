import { fireHook } from "../../hooks/fire.js"
import { resolveSituational } from "../../personas/situational.js"
import type { WakeOutput } from "../../types.js"
import {
  resolveTemplatePath,
  readTemplate,
  resolveTemplate,
} from "../../wake/resolve.js"
import { formatWake } from "../format.js"
import type { Command } from "../main.js"
import { output } from "../main.js"

const DEFAULT_TEMPLATE = `(no wake template configured — set [wake] template in .spores/config.toml)

---

# Environment

hostname: {{hostname}}
cwd: {{cwd}}
branch: {{git_branch}}
time: {{timestamp}}`

export const wakeCommand: Command = async (ctx, _args, _flags) => {
  const templatePath = resolveTemplatePath(
    ctx.baseDir,
    ctx.config.wake.template,
  )
  const situational = await resolveSituational(ctx.baseDir)

  const rawTemplate = await readTemplate(templatePath)
  const template = rawTemplate ?? DEFAULT_TEMPLATE

  const rendered = await resolveTemplate(template, situational, ctx.baseDir)

  const hook = await fireHook(
    "wake.completed",
    {
      SPORES_WAKE_TEMPLATE: templatePath ?? "",
    },
    ctx.baseDir,
  )

  const result: WakeOutput = {
    rendered,
    template_path: templatePath,
    situational,
    hook: hook.ran ? hook : undefined,
  }
  output(ctx, result, formatWake)

  if (hook.ran) {
    if (hook.stderr.length > 0) {
      process.stderr.write(hook.stderr)
    }
    if (hook.error !== undefined) {
      process.stderr.write(`[hook warning] wake.completed: ${hook.error}\n`)
    } else if (hook.exit_code !== null && hook.exit_code !== 0) {
      process.stderr.write(
        `[hook warning] wake.completed exited ${hook.exit_code}\n`,
      )
    }
  }
}
