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

describe("wake", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "spores-wake-test-"))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true })
  })

  it("outputs environment even with no config", async () => {
    const result = (await runWakeJson(tmpDir)) as {
      situational: { hostname: string; cwd: string; timestamp: string }
      personas: unknown[]
    }
    expect(result.situational.hostname).toBeDefined()
    expect(result.situational.cwd).toBe(tmpDir)
    expect(result.situational.timestamp).toBeDefined()
    expect(result.personas).toEqual([])
  })

  it("human mode shows no-identity hint when unconfigured", async () => {
    const { stdout, exitCode } = await runWake(tmpDir)
    expect(exitCode).toBe(0)
    expect(stdout).toContain("no identity configured")
  })

  it("reads identity file when configured", async () => {
    const identityContent = "# Test Agent\n\nI am a test agent."
    await writeFile(join(tmpDir, "identity.md"), identityContent)

    const configDir = join(tmpDir, ".spores")
    await mkdir(configDir, { recursive: true })
    await writeFile(
      join(configDir, "config.toml"),
      '[wake]\nidentity = "identity.md"\n',
    )

    const result = (await runWakeJson(tmpDir)) as {
      identity: string
      identity_path: string
    }
    expect(result.identity).toBe(identityContent)
    expect(result.identity_path).toBe(join(tmpDir, "identity.md"))
  })

  it("identity is undefined when file does not exist", async () => {
    const configDir = join(tmpDir, ".spores")
    await mkdir(configDir, { recursive: true })
    await writeFile(
      join(configDir, "config.toml"),
      '[wake]\nidentity = "missing.md"\n',
    )

    const result = (await runWakeJson(tmpDir)) as {
      identity?: string
      identity_path: string
    }
    expect(result.identity).toBeUndefined()
    expect(result.identity_path).toBe(join(tmpDir, "missing.md"))
  })

  it("supports absolute identity path", async () => {
    const identityFile = join(tmpDir, "elsewhere", "me.md")
    await mkdir(join(tmpDir, "elsewhere"), { recursive: true })
    await writeFile(identityFile, "I exist elsewhere.")

    const configDir = join(tmpDir, ".spores")
    await mkdir(configDir, { recursive: true })
    await writeFile(
      join(configDir, "config.toml"),
      `[wake]\nidentity = "${identityFile}"\n`,
    )

    const result = (await runWakeJson(tmpDir)) as {
      identity: string
      identity_path: string
    }
    expect(result.identity).toBe("I exist elsewhere.")
    expect(result.identity_path).toBe(identityFile)
  })

  it("lists project personas", async () => {
    const personaDir = join(tmpDir, ".spores", "personas")
    await mkdir(personaDir, { recursive: true })
    await writeFile(
      join(personaDir, "developer.md"),
      "---\nname: developer\ndescription: Write code\n---\n\nYou write code.\n",
    )

    const result = (await runWakeJson(tmpDir)) as {
      personas: Array<{ name: string; description: string }>
    }
    expect(result.personas).toHaveLength(1)
    expect(result.personas[0]!.name).toBe("developer")
    expect(result.personas[0]!.description).toBe("Write code")
  })

  it("human mode shows identity content first", async () => {
    await writeFile(join(tmpDir, "me.md"), "# I am the agent")
    const configDir = join(tmpDir, ".spores")
    await mkdir(configDir, { recursive: true })
    await writeFile(
      join(configDir, "config.toml"),
      '[wake]\nidentity = "me.md"\n',
    )

    const { stdout, exitCode } = await runWake(tmpDir)
    expect(exitCode).toBe(0)
    // Identity should appear before environment
    const identityPos = stdout.indexOf("I am the agent")
    const envPos = stdout.indexOf("# Environment")
    expect(identityPos).toBeLessThan(envPos)
  })

  it("fires wake.completed hook", async () => {
    const hookDir = join(tmpDir, ".spores", "hooks")
    await mkdir(hookDir, { recursive: true })
    const hookPath = join(hookDir, "wake.completed")
    await writeFile(
      hookPath,
      '#!/usr/bin/env bash\necho "event=$SPORES_EVENT"\necho "personas=$SPORES_WAKE_PERSONA_COUNT"\n',
    )
    await chmod(hookPath, 0o755)

    const result = (await runWakeJson(tmpDir)) as {
      hook: { ran: boolean; stdout: string; exit_code: number | null }
    }
    expect(result.hook.ran).toBe(true)
    expect(result.hook.exit_code).toBe(0)
    expect(result.hook.stdout).toContain("event=wake.completed")
    expect(result.hook.stdout).toContain("personas=0")
  })
})
