import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveSituational } from "./situational.js"

async function makeTmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "spores-situational-"))
}

describe("resolveSituational", () => {
  test("resolves cwd, timestamp, hostname", async () => {
    const dir = await makeTmp()
    const s = await resolveSituational(dir)
    expect(s.cwd).toBe(dir)
    expect(s.hostname).toBeDefined()
    expect(s.hostname.length).toBeGreaterThan(0)
    // ISO 8601 sanity check
    expect(s.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  test("returns undefined git_branch for non-git directory", async () => {
    const dir = await makeTmp()
    const s = await resolveSituational(dir)
    expect(s.git_branch).toBeUndefined()
  })

  test("reads branch name from .git/HEAD", async () => {
    const dir = await makeTmp()
    await mkdir(join(dir, ".git"), { recursive: true })
    await writeFile(join(dir, ".git", "HEAD"), "ref: refs/heads/feat/persona\n")
    const s = await resolveSituational(dir)
    expect(s.git_branch).toBe("feat/persona")
  })

  test("returns undefined for detached HEAD", async () => {
    const dir = await makeTmp()
    await mkdir(join(dir, ".git"), { recursive: true })
    await writeFile(
      join(dir, ".git", "HEAD"),
      "abc123def456abc123def456abc123def456abc1\n",
    )
    const s = await resolveSituational(dir)
    expect(s.git_branch).toBeUndefined()
  })
})
