import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile, chmod } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { fireHook } from "./fire.js"

async function writeHook(
  hookDir: string,
  event: string,
  script: string,
  mode = 0o755,
): Promise<string> {
  await mkdir(hookDir, { recursive: true })
  const path = join(hookDir, event)
  await writeFile(path, script)
  await chmod(path, mode)
  return path
}

describe("hooks/fireHook", () => {
  let tmpDir: string
  let hookDir: string
  const prevHooksDir = process.env["SPORES_HOOKS_DIR"]

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "spores-hooks-test-"))
    hookDir = join(tmpDir, "hooks")
    process.env["SPORES_HOOKS_DIR"] = hookDir
  })

  afterEach(async () => {
    if (prevHooksDir === undefined) delete process.env["SPORES_HOOKS_DIR"]
    else process.env["SPORES_HOOKS_DIR"] = prevHooksDir
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("returns ran:false when no hook exists", async () => {
    const result = await fireHook("persona.activated", {}, tmpDir)

    expect(result.ran).toBe(false)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe("")
    expect(result.exit_code).toBe(null)
    expect(result.error).toBeUndefined()
  })

  it("returns ran:false when hook file exists but is not executable", async () => {
    await writeHook(
      hookDir,
      "persona.activated",
      "#!/usr/bin/env bash\necho should-not-run\n",
      0o644,
    )

    const result = await fireHook("persona.activated", {}, tmpDir)

    expect(result.ran).toBe(false)
    expect(result.stdout).toBe("")
  })

  it("executes an executable hook and captures stdout", async () => {
    await writeHook(
      hookDir,
      "persona.activated",
      "#!/usr/bin/env bash\necho recalled-memory-1\necho recalled-memory-2\n",
    )

    const result = await fireHook("persona.activated", {}, tmpDir)

    expect(result.ran).toBe(true)
    expect(result.exit_code).toBe(0)
    expect(result.stdout).toContain("recalled-memory-1")
    expect(result.stdout).toContain("recalled-memory-2")
    expect(result.error).toBeUndefined()
  })

  it("passes caller env vars into the hook process", async () => {
    await writeHook(
      hookDir,
      "persona.activated",
      '#!/usr/bin/env bash\necho "name=$SPORES_PERSONA_NAME"\necho "tags=$SPORES_PERSONA_MEMORY_TAGS"\necho "event=$SPORES_EVENT"\n',
    )

    const result = await fireHook(
      "persona.activated",
      {
        SPORES_PERSONA_NAME: "spores-maintainer",
        SPORES_PERSONA_MEMORY_TAGS: "spores,release",
      },
      tmpDir,
    )

    expect(result.ran).toBe(true)
    expect(result.stdout).toContain("name=spores-maintainer")
    expect(result.stdout).toContain("tags=spores,release")
    expect(result.stdout).toContain("event=persona.activated")
  })

  it("injects SPORES_BIN when the caller does not set it", async () => {
    await writeHook(
      hookDir,
      "persona.activated",
      '#!/usr/bin/env bash\necho "bin=${SPORES_BIN:-unset}"\n',
    )

    const result = await fireHook("persona.activated", {}, tmpDir)

    expect(result.ran).toBe(true)
    // SPORES_BIN should be populated from process.argv[1] (the test runner).
    expect(result.stdout).toMatch(/bin=.+/)
    expect(result.stdout).not.toContain("bin=unset")
  })

  it("surfaces non-zero exit codes without throwing", async () => {
    await writeHook(
      hookDir,
      "persona.activated",
      "#!/usr/bin/env bash\necho partial-output\nexit 3\n",
    )

    const result = await fireHook("persona.activated", {}, tmpDir)

    expect(result.ran).toBe(true)
    expect(result.exit_code).toBe(3)
    expect(result.stdout).toContain("partial-output")
    expect(result.error).toBeUndefined()
  })

  it("kills hooks that exceed the timeout and returns an error", async () => {
    await writeHook(
      hookDir,
      "persona.activated",
      "#!/usr/bin/env bash\nsleep 30\n",
    )

    const result = await fireHook("persona.activated", {}, tmpDir)

    expect(result.ran).toBe(true)
    expect(result.error).toMatch(/timed out/)
  }, 15000)

  it("project hook wins over user hook when both exist", async () => {
    // Override the test-env pointer and use the real project/user dirs
    // rooted under tmpDir.
    delete process.env["SPORES_HOOKS_DIR"]

    const projectHookDir = join(tmpDir, "project", ".spores", "hooks")
    const userHome = join(tmpDir, "home")
    const userHookDir = join(userHome, ".spores", "hooks")
    const prevHome = process.env["HOME"]
    process.env["HOME"] = userHome

    try {
      await writeHook(
        projectHookDir,
        "persona.activated",
        "#!/usr/bin/env bash\necho from-project\n",
      )
      await writeHook(
        userHookDir,
        "persona.activated",
        "#!/usr/bin/env bash\necho from-user\n",
      )

      const result = await fireHook(
        "persona.activated",
        {},
        join(tmpDir, "project"),
      )

      expect(result.ran).toBe(true)
      expect(result.stdout).toContain("from-project")
      expect(result.stdout).not.toContain("from-user")
    } finally {
      if (prevHome === undefined) delete process.env["HOME"]
      else process.env["HOME"] = prevHome
      process.env["SPORES_HOOKS_DIR"] = hookDir
    }
  })

  it("uses user hook when project hook is absent", async () => {
    delete process.env["SPORES_HOOKS_DIR"]

    const userHome = join(tmpDir, "home")
    const userHookDir = join(userHome, ".spores", "hooks")
    const prevHome = process.env["HOME"]
    process.env["HOME"] = userHome

    try {
      await writeHook(
        userHookDir,
        "persona.activated",
        "#!/usr/bin/env bash\necho from-user-fallback\n",
      )

      const result = await fireHook(
        "persona.activated",
        {},
        join(tmpDir, "project"),
      )

      expect(result.ran).toBe(true)
      expect(result.stdout).toContain("from-user-fallback")
    } finally {
      if (prevHome === undefined) delete process.env["HOME"]
      else process.env["HOME"] = prevHome
      process.env["SPORES_HOOKS_DIR"] = hookDir
    }
  })
})
