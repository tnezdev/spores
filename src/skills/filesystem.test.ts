import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { InMemorySource } from "../sources/in-memory.js"
import { LayeredSource } from "../sources/layered.js"
import {
  listSkills,
  listSkillsFromSource,
  loadSkill,
  loadSkillFromSource,
} from "./filesystem.js"

async function writeSkill(
  dir: string,
  name: string,
  content: string,
): Promise<void> {
  const skillDir = join(dir, ".spores", "skills", name)
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, "skill.md"), content)
}

const VALID_SKILL = `---
name: my-skill
description: Does something useful
tags: [ai, memory]
---

Body content here.
`.trimStart()

const MINIMAL_SKILL = `---
name: minimal
description: No tags
---

Minimal body.
`.trimStart()

describe("skills/filesystem", () => {
  let tmpDir: string
  let fakeHome: string
  const originalHome = process.env["HOME"]

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "spores-skills-test-"))
    fakeHome = await mkdtemp(join(tmpdir(), "spores-skills-home-"))
    process.env["HOME"] = fakeHome
  })

  afterEach(async () => {
    if (originalHome !== undefined) process.env["HOME"] = originalHome
    else delete process.env["HOME"]
    await rm(tmpDir, { recursive: true })
    await rm(fakeHome, { recursive: true })
  })

  describe("listSkills", () => {
    it("returns empty array when no skills exist", async () => {
      const skills = await listSkills(tmpDir)
      expect(skills).toEqual([])
    })

    it("returns skills from project dir", async () => {
      await writeSkill(tmpDir, "my-skill", VALID_SKILL)
      const skills = await listSkills(tmpDir)
      expect(skills).toHaveLength(1)
      expect(skills[0]!.name).toBe("my-skill")
      expect(skills[0]!.description).toBe("Does something useful")
      expect(skills[0]!.tags).toEqual(["ai", "memory"])
    })

    it("parses skills with no tags", async () => {
      await writeSkill(tmpDir, "minimal", MINIMAL_SKILL)
      const skills = await listSkills(tmpDir)
      expect(skills[0]!.tags).toEqual([])
    })

    it("skips skill.md files missing required frontmatter", async () => {
      await writeSkill(tmpDir, "invalid", "no frontmatter at all")
      const skills = await listSkills(tmpDir)
      expect(skills).toHaveLength(0)
    })

    it("returns skills sorted by name", async () => {
      await writeSkill(tmpDir, "zeta", VALID_SKILL.replace("my-skill", "zeta"))
      await writeSkill(tmpDir, "alpha", VALID_SKILL.replace("my-skill", "alpha"))
      const skills = await listSkills(tmpDir)
      expect(skills.map((s) => s.name)).toEqual(["alpha", "zeta"])
    })

    it("includes path to skill.md", async () => {
      await writeSkill(tmpDir, "my-skill", VALID_SKILL)
      const skills = await listSkills(tmpDir)
      expect(skills[0]!.path).toMatch(/skill\.md$/)
    })
  })

  describe("loadSkill", () => {
    it("returns undefined for missing skill", async () => {
      const skill = await loadSkill("nonexistent", tmpDir)
      expect(skill).toBeUndefined()
    })

    it("returns skill with content", async () => {
      await writeSkill(tmpDir, "my-skill", VALID_SKILL)
      const skill = await loadSkill("my-skill", tmpDir)
      expect(skill).not.toBeUndefined()
      expect(skill!.name).toBe("my-skill")
      expect(skill!.description).toBe("Does something useful")
      expect(skill!.tags).toEqual(["ai", "memory"])
      expect(skill!.content).toBe("Body content here.\n")
    })

    it("content does not include frontmatter", async () => {
      await writeSkill(tmpDir, "my-skill", VALID_SKILL)
      const skill = await loadSkill("my-skill", tmpDir)
      expect(skill!.content).not.toContain("---")
      expect(skill!.content).not.toContain("name:")
    })

    it("returns undefined for skill with missing required fields", async () => {
      const noDesc = `---
name: broken
---

Body.
`
      await writeSkill(tmpDir, "broken", noDesc)
      const skill = await loadSkill("broken", tmpDir)
      expect(skill).toBeUndefined()
    })

    it("project skill wins over global on name conflict", async () => {
      // Write to the fake-home global skills dir
      const globalDir = join(fakeHome, ".spores", "skills", "dup")
      await mkdir(globalDir, { recursive: true })
      await writeFile(
        join(globalDir, "skill.md"),
        `---\nname: dup\ndescription: Global\n---\nglobal body\n`,
      )
      await writeSkill(
        tmpDir,
        "dup",
        `---\nname: dup\ndescription: Project\n---\nproject body\n`,
      )
      const skill = await loadSkill("dup", tmpDir)
      expect(skill!.description).toBe("Project")
      expect(skill!.content.trim()).toBe("project body")
    })

    it("falls back to global skill when project version is absent", async () => {
      const globalDir = join(fakeHome, ".spores", "skills", "global-only")
      await mkdir(globalDir, { recursive: true })
      await writeFile(
        join(globalDir, "skill.md"),
        `---\nname: global-only\ndescription: Global\n---\nglobal body\n`,
      )
      const skill = await loadSkill("global-only", tmpDir)
      expect(skill!.description).toBe("Global")
    })
  })

  describe("loadSkillFromSource", () => {
    it("loads a skill from any source — no filesystem coupling", async () => {
      const source = new InMemorySource(
        { "my-skill": VALID_SKILL },
        "test",
      )
      const skill = await loadSkillFromSource("my-skill", source)
      expect(skill!.name).toBe("my-skill")
      expect(skill!.description).toBe("Does something useful")
      expect(skill!.tags).toEqual(["ai", "memory"])
      expect(skill!.content.trim()).toBe("Body content here.")
      expect(skill!.path).toBe("test:my-skill")
    })

    it("returns undefined when source has no record by that name", async () => {
      const source = new InMemorySource({})
      const skill = await loadSkillFromSource("missing", source)
      expect(skill).toBeUndefined()
    })

    it("layered source: live state shadows seed", async () => {
      const seed = new InMemorySource(
        {
          "my-skill": `---\nname: my-skill\ndescription: Seed version\n---\nseed body\n`,
        },
        "seed",
      )
      const live = new InMemorySource(
        {
          "my-skill": `---\nname: my-skill\ndescription: Live version\n---\nlive body\n`,
        },
        "live",
      )
      const layered = new LayeredSource([live, seed])
      const skill = await loadSkillFromSource("my-skill", layered)
      expect(skill!.description).toBe("Live version")
      expect(skill!.content.trim()).toBe("live body")
    })
  })

  describe("listSkillsFromSource", () => {
    it("lists skills from any source", async () => {
      const source = new InMemorySource({
        alpha: `---\nname: alpha\ndescription: A\n---\n`,
        zebra: `---\nname: zebra\ndescription: Z\n---\n`,
      })
      const refs = await listSkillsFromSource(source)
      expect(refs.map((r) => r.name)).toEqual(["alpha", "zebra"])
    })

    it("skips records with missing required fields", async () => {
      const source = new InMemorySource({
        ok: `---\nname: ok\ndescription: ok\n---\n`,
        broken: `---\nname: broken\n---\n`,
      })
      const refs = await listSkillsFromSource(source)
      expect(refs.map((r) => r.name)).toEqual(["ok"])
    })
  })
})
