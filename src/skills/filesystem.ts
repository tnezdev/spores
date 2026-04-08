import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import type { Skill, SkillRef } from "../types.js"

interface NodeError extends Error {
  code?: string | undefined
}

function isNodeError(err: unknown): err is NodeError {
  return err instanceof Error
}

// ---------------------------------------------------------------------------
// Frontmatter parser
// Simple `---` fences, key: value / key: [a, b, c] grammar.
// ---------------------------------------------------------------------------

type Frontmatter = {
  name?: string | undefined
  description?: string | undefined
  tags?: string[] | undefined
}

function parseFrontmatter(text: string): { meta: Frontmatter; body: string } {
  if (!text.startsWith("---")) {
    return { meta: {}, body: text }
  }

  const end = text.indexOf("\n---", 3)
  if (end === -1) {
    return { meta: {}, body: text }
  }

  const fmLines = text.slice(3, end).split("\n")
  const body = text.slice(end + 4).trimStart()
  const meta: Frontmatter = {}

  for (const raw of fmLines) {
    const line = raw.trim()
    if (line === "" || line.startsWith("#")) continue

    const colonIdx = line.indexOf(":")
    if (colonIdx === -1) continue

    const key = line.slice(0, colonIdx).trim()
    const rest = line.slice(colonIdx + 1).trim()

    if (rest.startsWith("[")) {
      // Array syntax: [a, b, c]
      const inner = rest.slice(1, rest.lastIndexOf("]"))
      const items = inner
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter((s) => s.length > 0)

      if (key === "tags") {
        meta.tags = items
      }
    } else {
      const value = rest.replace(/^["']|["']$/g, "")
      if (key === "name") meta.name = value
      if (key === "description") meta.description = value
    }
  }

  return { meta, body }
}

// ---------------------------------------------------------------------------
// Directory scanning
// ---------------------------------------------------------------------------

async function scanSkillsDir(dir: string): Promise<SkillRef[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") return []
    throw err
  }

  const refs: SkillRef[] = []

  for (const entry of entries) {
    const skillFile = join(dir, entry, "skill.md")
    let text: string
    try {
      text = await readFile(skillFile, "utf-8")
    } catch (err) {
      if (isNodeError(err) && err.code === "ENOENT") continue
      throw err
    }

    const { meta } = parseFrontmatter(text)
    if (meta.name === undefined || meta.description === undefined) continue

    refs.push({
      name: meta.name,
      description: meta.description,
      tags: meta.tags ?? [],
      path: skillFile,
    })
  }

  return refs
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function globalSkillsDir(): string {
  return join(homedir(), ".spores", "skills")
}

function projectSkillsDir(baseDir: string): string {
  return join(baseDir, ".spores", "skills")
}

/**
 * List all available skills. Project skills (`.spores/skills/`) override
 * global skills (`~/.spores/skills/`) when names conflict.
 */
export async function listSkills(baseDir: string): Promise<SkillRef[]> {
  const [global, project] = await Promise.all([
    scanSkillsDir(globalSkillsDir()),
    scanSkillsDir(projectSkillsDir(baseDir)),
  ])

  // Merge: project wins on name conflict
  const byName = new Map<string, SkillRef>()
  for (const ref of global) byName.set(ref.name, ref)
  for (const ref of project) byName.set(ref.name, ref)

  return Array.from(byName.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  )
}

/**
 * Load a skill by name. Returns undefined if not found.
 * Project skills take precedence over global skills.
 */
export async function loadSkill(
  name: string,
  baseDir: string,
): Promise<Skill | undefined> {
  // Check project first, then global
  const dirs = [projectSkillsDir(baseDir), globalSkillsDir()]

  for (const dir of dirs) {
    const skillFile = join(dir, name, "skill.md")
    let text: string
    try {
      text = await readFile(skillFile, "utf-8")
    } catch (err) {
      if (isNodeError(err) && err.code === "ENOENT") continue
      throw err
    }

    const { meta, body } = parseFrontmatter(text)
    if (meta.name === undefined || meta.description === undefined) continue

    return {
      name: meta.name,
      description: meta.description,
      tags: meta.tags ?? [],
      path: skillFile,
      content: body,
    }
  }

  return undefined
}
