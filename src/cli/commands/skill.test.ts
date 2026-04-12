import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile, chmod } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { skillRunCommand, skillListCommand, skillShowCommand } from "./skill.js"
import type { Ctx } from "../context.js"
import type { SporesConfig } from "../../types.js"
import { FilesystemAdapter } from "../../memory/filesystem.js"

function makeCtx(baseDir: string): Ctx {
  const config: SporesConfig = {
    adapter: "filesystem",
    memory: { dir: ".spores/memory", defaultTier: "L1", dreamDepth: 1 },
    workflow: {
      graphsDir: ".spores/workflow/graphs",
      runsDir: ".spores/workflow/runs",
    },
    wake: {},
  }
  return {
    adapter: new FilesystemAdapter(baseDir),
    config,
    baseDir,
    json: true,
    wide: false,
  }
}

function captureStdout(fn: () => Promise<void>): Promise<string> {
  const origLog = console.log
  let captured = ""
  console.log = (...args: unknown[]) => {
    captured +=
      args.map((a) => (typeof a === "string" ? a : String(a))).join(" ") + "\n"
  }
  return fn()
    .then(() => captured)
    .finally(() => {
      console.log = origLog
    })
}

async function writeSkill(
  baseDir: string,
  name: string,
  content: string,
  description = "A test skill",
  tags: string[] = [],
): Promise<void> {
  const skillDir = join(baseDir, ".spores", "skills", name)
  await mkdir(skillDir, { recursive: true })
  const tagsLine = tags.length > 0 ? `\ntags: [${tags.join(", ")}]` : ""
  await writeFile(
    join(skillDir, "skill.md"),
    `---\nname: ${name}\ndescription: ${description}${tagsLine}\n---\n\n${content}`,
  )
}

describe("skill CLI commands", () => {
  let tmpDir: string
  let ctx: Ctx

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "spores-skill-cli-"))
    ctx = makeCtx(tmpDir)
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("skill list returns empty when no skills exist", async () => {
    const out = await captureStdout(() => skillListCommand(ctx, [], {}))
    const skills = JSON.parse(out)
    expect(Array.isArray(skills)).toBe(true)
    expect(skills.length).toBe(0)
  })

  it("skill show loads skill content", async () => {
    await writeSkill(tmpDir, "my-skill", "Do the thing.", "Test skill")
    const out = await captureStdout(() => skillShowCommand(ctx, ["my-skill"], {}))
    const skill = JSON.parse(out)
    expect(skill.name).toBe("my-skill")
    expect(skill.content).toContain("Do the thing.")
  })

  it("skill show throws on unknown skill", async () => {
    await expect(skillShowCommand(ctx, ["nope"], {})).rejects.toThrow(/Skill not found/)
  })

  it("skill run requires name", async () => {
    await expect(skillRunCommand(ctx, [], {})).rejects.toThrow(/Usage/)
  })

  it("skill run outputs SkillInvokedOutput wrapper in JSON mode", async () => {
    await writeSkill(tmpDir, "my-skill", "Skill body here.", "Test skill", ["test"])
    const out = await captureStdout(() => skillRunCommand(ctx, ["my-skill"], {}))
    const result = JSON.parse(out)
    expect(result.skill).toBeDefined()
    expect(result.skill.name).toBe("my-skill")
    expect(result.skill.content).toContain("Skill body here.")
    expect(result.hook).toBeUndefined() // no hook present
  })

  // ---------------------------------------------------------------------------
  // skill.invoked hook
  // ---------------------------------------------------------------------------

  it("skill run fires skill.invoked hook when present", async () => {
    await writeSkill(tmpDir, "hook-skill", "Skill prompt.", "Hookable skill", ["hook-test"])

    const hooksDir = await mkdtemp(join(tmpdir(), "spores-hooks-"))
    const hookPath = join(hooksDir, "skill.invoked")
    await writeFile(
      hookPath,
      '#!/usr/bin/env bash\necho "invoked: $SPORES_SKILL_NAME tags=$SPORES_SKILL_TAGS"\n',
    )
    await chmod(hookPath, 0o755)

    const origEnv = process.env["SPORES_HOOKS_DIR"]
    process.env["SPORES_HOOKS_DIR"] = hooksDir
    try {
      const out = await captureStdout(() => skillRunCommand(ctx, ["hook-skill"], {}))
      const result = JSON.parse(out)
      expect(result.skill.name).toBe("hook-skill")
      expect(result.hook).toBeDefined()
      expect(result.hook.ran).toBe(true)
      expect(result.hook.stdout).toContain("hook-skill")
      expect(result.hook.stdout).toContain("hook-test")
    } finally {
      if (origEnv === undefined) delete process.env["SPORES_HOOKS_DIR"]
      else process.env["SPORES_HOOKS_DIR"] = origEnv
      await rm(hooksDir, { recursive: true, force: true })
    }
  })

  it("skill run hook failure is non-fatal", async () => {
    await writeSkill(tmpDir, "fail-skill", "Still works.", "Failing hook skill")

    const hooksDir = await mkdtemp(join(tmpdir(), "spores-hooks-"))
    const hookPath = join(hooksDir, "skill.invoked")
    await writeFile(hookPath, "#!/usr/bin/env bash\nexit 2\n")
    await chmod(hookPath, 0o755)

    const origEnv = process.env["SPORES_HOOKS_DIR"]
    process.env["SPORES_HOOKS_DIR"] = hooksDir
    try {
      const out = await captureStdout(() => skillRunCommand(ctx, ["fail-skill"], {}))
      const result = JSON.parse(out)
      expect(result.skill.name).toBe("fail-skill")
      expect(result.hook.ran).toBe(true)
      expect(result.hook.exit_code).toBe(2)
    } finally {
      if (origEnv === undefined) delete process.env["SPORES_HOOKS_DIR"]
      else process.env["SPORES_HOOKS_DIR"] = origEnv
      await rm(hooksDir, { recursive: true, force: true })
    }
  })
})
