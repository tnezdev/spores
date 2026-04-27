import { homedir } from "node:os"
import { join } from "node:path"
import type { Skill, SkillRef } from "../types.js"
import type { Source } from "../sources/source.js"
import { LayeredSource } from "../sources/layered.js"
import { NestedFileSource } from "../sources/nested-file.js"

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

function metaToRef(meta: Frontmatter, locator: string): SkillRef | undefined {
  if (meta.name === undefined || meta.description === undefined) return undefined
  return {
    name: meta.name,
    description: meta.description,
    tags: meta.tags ?? [],
    path: locator,
  }
}

// ---------------------------------------------------------------------------
// Source-based API — works with any pluggable Source
// ---------------------------------------------------------------------------

/**
 * List all skills exposed by the given source. Skips records whose
 * frontmatter is missing required fields (`name`, `description`) or
 * whose entries don't resolve to a readable body — those are surfaced
 * quietly rather than throwing, matching `loadSkill`'s "return undefined
 * for malformed" semantics.
 */
export async function listSkillsFromSource(
  source: Source,
): Promise<SkillRef[]> {
  const names = await source.list()
  const refs: SkillRef[] = []

  for (const name of names) {
    const record = await source.read(name)
    if (record === undefined) continue

    const { meta } = parseFrontmatter(record.text)
    const ref = metaToRef(meta, record.locator)
    if (ref !== undefined) refs.push(ref)
  }

  return refs.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Load a single skill by name from a source. Returns undefined if the
 * name is not found or the frontmatter is missing required fields.
 */
export async function loadSkillFromSource(
  name: string,
  source: Source,
): Promise<Skill | undefined> {
  const record = await source.read(name)
  if (record === undefined) return undefined

  const { meta, body } = parseFrontmatter(record.text)
  const ref = metaToRef(meta, record.locator)
  if (ref === undefined) return undefined

  return { ...ref, content: body }
}

// ---------------------------------------------------------------------------
// Convenience API — filesystem layering of project + global skills
// ---------------------------------------------------------------------------

function userHome(): string {
  // Prefer HOME env var so tests can override it. Falls back to os.homedir()
  // which reads the system password database on Unix.
  return process.env["HOME"] ?? homedir()
}

function globalSkillsDir(): string {
  return join(userHome(), ".spores", "skills")
}

function projectSkillsDir(baseDir: string): string {
  return join(baseDir, ".spores", "skills")
}

function defaultFilesystemSource(baseDir: string): Source {
  return new LayeredSource([
    new NestedFileSource(projectSkillsDir(baseDir), "skill.md"),
    new NestedFileSource(globalSkillsDir(), "skill.md"),
  ])
}

/**
 * List all available skills. Project skills (`.spores/skills/`) override
 * global skills (`~/.spores/skills/`) when names conflict.
 */
export async function listSkills(baseDir: string): Promise<SkillRef[]> {
  return listSkillsFromSource(defaultFilesystemSource(baseDir))
}

/**
 * Load a skill by name. Returns undefined if not found.
 * Project skills take precedence over global skills.
 */
export async function loadSkill(
  name: string,
  baseDir: string,
): Promise<Skill | undefined> {
  return loadSkillFromSource(name, defaultFilesystemSource(baseDir))
}
