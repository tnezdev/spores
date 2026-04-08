import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { listSkills, loadSkill } from "./filesystem.js"

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

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "spores-skills-test-"))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true })
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
  })
})
