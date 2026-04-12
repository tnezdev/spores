import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile, chmod } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

const CLI = join(import.meta.dir, "..", "main.ts")

async function runWake(
  baseDir: string,
  ...extraArgs: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const fakeHome = await mkdtemp(join(tmpdir(), "spores-wake-home-"))
  const proc = Bun.spawn(
    ["bun", CLI, "--base-dir", baseDir, ...extraArgs, "wake"],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, HOME: fakeHome },
    },
  )
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited
  await rm(fakeHome, { recursive: true })
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
}

async function runWakeJson(
  baseDir: string,
  ...extraArgs: string[]
): Promise<unknown> {
  const { stdout } = await runWake(baseDir, "--json", ...extraArgs)
  return JSON.parse(stdout)
}

async function writeConfig(baseDir: string, toml: string): Promise<void> {
  const configDir = join(baseDir, ".spores")
  await mkdir(configDir, { recursive: true })
  await writeFile(join(configDir, "config.toml"), toml)
}

describe("wake", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "spores-wake-test-"))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true })
  })

  it("outputs default template when unconfigured", async () => {
    const { stdout, exitCode } = await runWake(tmpDir)
    expect(exitCode).toBe(0)
    expect(stdout).toContain("no wake template configured")
    expect(stdout).toContain("# Environment")
  })

  it("renders static tokens in template", async () => {
    await writeFile(
      join(tmpDir, "WAKE.md"),
      "host={{hostname}} cwd={{cwd}} branch={{git_branch}} time={{timestamp}}",
    )
    await writeConfig(tmpDir, '[wake]\ntemplate = "WAKE.md"\n')

    const result = (await runWakeJson(tmpDir)) as {
      rendered: string
      situational: { hostname: string; cwd: string }
    }
    expect(result.rendered).toContain(`host=${result.situational.hostname}`)
    expect(result.rendered).toContain(`cwd=${tmpDir}`)
    expect(result.rendered).not.toContain("{{hostname}}")
    expect(result.rendered).not.toContain("{{cwd}}")
  })

  it("executes {{sh:...}} expressions", async () => {
    await writeFile(
      join(tmpDir, "WAKE.md"),
      "name={{sh:echo hello-world}}",
    )
    await writeConfig(tmpDir, '[wake]\ntemplate = "WAKE.md"\n')

    const result = (await runWakeJson(tmpDir)) as { rendered: string }
    expect(result.rendered).toBe("name=hello-world")
  })

  it("{{sh:cat ...}} inlines file content", async () => {
    await writeFile(join(tmpDir, "identity.md"), "# I am the agent")
    await writeFile(
      join(tmpDir, "WAKE.md"),
      "{{sh:cat identity.md}}\n\nMore content.",
    )
    await writeConfig(tmpDir, '[wake]\ntemplate = "WAKE.md"\n')

    const result = (await runWakeJson(tmpDir)) as { rendered: string }
    expect(result.rendered).toContain("# I am the agent")
    expect(result.rendered).toContain("More content.")
  })

  it("shows error inline when shell command fails", async () => {
    await writeFile(
      join(tmpDir, "WAKE.md"),
      "result={{sh:cat nonexistent-file.txt}}",
    )
    await writeConfig(tmpDir, '[wake]\ntemplate = "WAKE.md"\n')

    const result = (await runWakeJson(tmpDir)) as { rendered: string }
    // Should contain error text, not crash
    expect(result.rendered).toContain("result=")
    expect(result.rendered).toContain("No such file")
  })

  it("shell commands run with cwd set to baseDir", async () => {
    await writeFile(join(tmpDir, "marker.txt"), "cwd-ok")
    await writeFile(join(tmpDir, "WAKE.md"), "{{sh:cat marker.txt}}")
    await writeConfig(tmpDir, '[wake]\ntemplate = "WAKE.md"\n')

    const result = (await runWakeJson(tmpDir)) as { rendered: string }
    expect(result.rendered).toBe("cwd-ok")
  })

  it("template_path is set in JSON output", async () => {
    await writeFile(join(tmpDir, "WAKE.md"), "hello")
    await writeConfig(tmpDir, '[wake]\ntemplate = "WAKE.md"\n')

    const result = (await runWakeJson(tmpDir)) as {
      template_path: string
    }
    expect(result.template_path).toBe(join(tmpDir, "WAKE.md"))
  })

  it("supports absolute template path", async () => {
    const elsewhere = join(tmpDir, "elsewhere")
    await mkdir(elsewhere, { recursive: true })
    await writeFile(join(elsewhere, "boot.md"), "booted from {{hostname}}")
    await writeConfig(
      tmpDir,
      `[wake]\ntemplate = "${join(elsewhere, "boot.md")}"\n`,
    )

    const result = (await runWakeJson(tmpDir)) as { rendered: string }
    expect(result.rendered).not.toContain("{{hostname}}")
    expect(result.rendered).toContain("booted from")
  })

  it("unknown tokens are left literal", async () => {
    await writeFile(join(tmpDir, "WAKE.md"), "keep={{unknown_token}}")
    await writeConfig(tmpDir, '[wake]\ntemplate = "WAKE.md"\n')

    const result = (await runWakeJson(tmpDir)) as { rendered: string }
    expect(result.rendered).toBe("keep={{unknown_token}}")
  })

  it("fires wake.completed hook", async () => {
    const hookDir = join(tmpDir, ".spores", "hooks")
    await mkdir(hookDir, { recursive: true })
    const hookPath = join(hookDir, "wake.completed")
    await writeFile(
      hookPath,
      '#!/usr/bin/env bash\necho "event=$SPORES_EVENT"\n',
    )
    await chmod(hookPath, 0o755)

    const result = (await runWakeJson(tmpDir)) as {
      hook: { ran: boolean; stdout: string; exit_code: number | null }
    }
    expect(result.hook.ran).toBe(true)
    expect(result.hook.exit_code).toBe(0)
    expect(result.hook.stdout).toContain("event=wake.completed")
  })
})
