import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { SituationalContext } from "../types.js"
import { resolveTemplate, resolveTemplatePath } from "./resolve.js"

const SITUATIONAL: SituationalContext = {
  cwd: "/test/dir",
  timestamp: "2026-04-12T00:00:00.000Z",
  hostname: "test-host",
  git_branch: "main",
}

describe("resolveTemplatePath", () => {
  it("returns undefined when no path configured", () => {
    expect(resolveTemplatePath("/base")).toBeUndefined()
  })

  it("resolves relative path against baseDir", () => {
    expect(resolveTemplatePath("/base", "WAKE.md")).toBe("/base/WAKE.md")
  })

  it("keeps absolute path as-is", () => {
    expect(resolveTemplatePath("/base", "/other/WAKE.md")).toBe(
      "/other/WAKE.md",
    )
  })
})

describe("resolveTemplate", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "spores-resolve-test-"))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true })
  })

  it("substitutes static tokens", async () => {
    const result = await resolveTemplate(
      "host={{hostname}} cwd={{cwd}}",
      SITUATIONAL,
      tmpDir,
    )
    expect(result).toBe("host=test-host cwd=/test/dir")
  })

  it("substitutes git_branch as empty string when undefined", async () => {
    const noGit = { ...SITUATIONAL, git_branch: undefined }
    const result = await resolveTemplate(
      "branch={{git_branch}}",
      noGit,
      tmpDir,
    )
    expect(result).toBe("branch=")
  })

  it("leaves unknown tokens literal", async () => {
    const result = await resolveTemplate(
      "{{unknown}}",
      SITUATIONAL,
      tmpDir,
    )
    expect(result).toBe("{{unknown}}")
  })

  it("executes shell expressions", async () => {
    const result = await resolveTemplate(
      "{{sh:echo hello}}",
      SITUATIONAL,
      tmpDir,
    )
    expect(result).toBe("hello")
  })

  it("shell runs in baseDir", async () => {
    // Use cat on a known file rather than pwd, which resolves symlinks
    // on macOS (/var → /private/var)
    await writeFile(join(tmpDir, "marker.txt"), "found-it")
    const result = await resolveTemplate(
      "{{sh:cat marker.txt}}",
      SITUATIONAL,
      tmpDir,
    )
    expect(result).toBe("found-it")
  })

  it("inlines file content via cat", async () => {
    await writeFile(join(tmpDir, "id.md"), "# Agent")
    const result = await resolveTemplate(
      "{{sh:cat id.md}}",
      SITUATIONAL,
      tmpDir,
    )
    expect(result).toBe("# Agent")
  })

  it("shows error for failed commands", async () => {
    const result = await resolveTemplate(
      "{{sh:cat no-such-file}}",
      SITUATIONAL,
      tmpDir,
    )
    expect(result).toContain("No such file")
  })

  it("deduplicates identical shell expressions", async () => {
    const result = await resolveTemplate(
      "{{sh:echo dup}} and {{sh:echo dup}}",
      SITUATIONAL,
      tmpDir,
    )
    expect(result).toBe("dup and dup")
  })

  it("handles mixed static and shell tokens", async () => {
    const result = await resolveTemplate(
      "host={{hostname}} echo={{sh:echo ok}}",
      SITUATIONAL,
      tmpDir,
    )
    expect(result).toBe("host=test-host echo=ok")
  })
})
