import { join } from "node:path"
import { homedir } from "node:os"
import type {
  PersonaFile,
  PersonaRef,
  RoutingHint,
  TaskQuery,
  TaskStatus,
} from "../types.js"
import type { Source } from "../sources/source.js"
import { FlatFileSource } from "../sources/flat-file.js"
import { LayeredSource } from "../sources/layered.js"
import type { PersonaAdapter } from "./adapter.js"

function userHome(): string {
  // Prefer HOME env var so tests can override it. Falls back to os.homedir()
  // which reads the system password database on Unix.
  return process.env["HOME"] ?? homedir()
}

// ---------------------------------------------------------------------------
// Frontmatter parser
//
// Supports a limited YAML-ish grammar — enough for personas:
//   key: value
//   key: [a, b, c]
//   key:
//     subkey: value
//     subkey: [a, b, c]
//
// One level of nesting is enough to express `task_filter`. We intentionally
// duplicate this parser from src/skills/filesystem.ts rather than extracting
// a shared helper — shared abstractions extracted from two call sites are
// often wrong. Wait for a third caller before consolidating.
// ---------------------------------------------------------------------------

type ParsedMeta = {
  name?: string
  description?: string
  memory_tags?: string[]
  skills?: string[]
  task_filter?: TaskQuery
  workflow?: string
  effort?: RoutingHint
  reasoning?: RoutingHint
}

const TASK_STATUSES: readonly TaskStatus[] = [
  "ready",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
]

function isTaskStatus(s: string): s is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(s)
}

const ROUTING_HINTS: readonly RoutingHint[] = ["low", "medium", "high"]

function isRoutingHint(s: string): s is RoutingHint {
  return (ROUTING_HINTS as readonly string[]).includes(s)
}

function parseArray(rest: string): string[] {
  const inner = rest.slice(1, rest.lastIndexOf("]"))
  return inner
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter((s) => s.length > 0)
}

function parseScalar(rest: string): string {
  return rest.replace(/^["']|["']$/g, "")
}

function parseFrontmatter(text: string): { meta: ParsedMeta; body: string } {
  if (!text.startsWith("---")) {
    return { meta: {}, body: text }
  }

  const end = text.indexOf("\n---", 3)
  if (end === -1) {
    return { meta: {}, body: text }
  }

  const fmLines = text.slice(3, end).split("\n")
  const body = text.slice(end + 4).trimStart()
  const meta: ParsedMeta = {}
  const taskFilter: TaskQuery = {}
  let inTaskFilter = false

  for (const raw of fmLines) {
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue

    const indented = raw.startsWith("  ") || raw.startsWith("\t")
    const line = raw.trim()

    const colonIdx = line.indexOf(":")
    if (colonIdx === -1) continue

    const key = line.slice(0, colonIdx).trim()
    const rest = line.slice(colonIdx + 1).trim()

    if (indented && inTaskFilter) {
      if (key === "tags" && rest.startsWith("[")) {
        taskFilter.tags = parseArray(rest)
      } else if (key === "status") {
        const value = parseScalar(rest)
        if (isTaskStatus(value)) taskFilter.status = value
      } else if (key === "parent_id") {
        taskFilter.parent_id = parseScalar(rest)
      }
      continue
    }

    // Top-level key — close any open nested block
    inTaskFilter = false

    if (rest === "" && key === "task_filter") {
      inTaskFilter = true
      continue
    }

    if (rest.startsWith("[")) {
      const items = parseArray(rest)
      if (key === "memory_tags") meta.memory_tags = items
      else if (key === "skills") meta.skills = items
      continue
    }

    const value = parseScalar(rest)
    if (key === "name") meta.name = value
    else if (key === "description") meta.description = value
    else if (key === "workflow") meta.workflow = value
    else if (key === "effort" && isRoutingHint(value)) meta.effort = value
    else if (key === "reasoning" && isRoutingHint(value)) meta.reasoning = value
  }

  if (Object.keys(taskFilter).length > 0) {
    meta.task_filter = taskFilter
  }

  return { meta, body }
}

function metaToRef(meta: ParsedMeta): PersonaRef | undefined {
  if (meta.name === undefined || meta.description === undefined) return undefined
  return {
    name: meta.name,
    description: meta.description,
    memory_tags: meta.memory_tags ?? [],
    skills: meta.skills ?? [],
    task_filter: meta.task_filter,
    workflow: meta.workflow,
    effort: meta.effort,
    reasoning: meta.reasoning,
  }
}

// ---------------------------------------------------------------------------
// Source-based API — works with any pluggable Source
// ---------------------------------------------------------------------------

/**
 * List all personas exposed by the given source. Skips records whose
 * frontmatter is missing required fields (`name`, `description`) — those
 * are surfaced quietly rather than throwing, matching `loadPersona`'s
 * "return undefined for malformed" semantics.
 */
export async function listPersonasFromSource(
  source: Source,
): Promise<PersonaRef[]> {
  const names = await source.list()
  const refs: PersonaRef[] = []

  for (const name of names) {
    const record = await source.read(name)
    if (record === undefined) continue

    const { meta } = parseFrontmatter(record.text)
    const ref = metaToRef(meta)
    if (ref !== undefined) refs.push(ref)
  }

  return refs.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Load a single persona by name from a source. Returns undefined if the
 * name is not found or the frontmatter is missing required fields.
 */
export async function loadPersonaFromSource(
  name: string,
  source: Source,
): Promise<PersonaFile | undefined> {
  const record = await source.read(name)
  if (record === undefined) return undefined

  const { meta, body } = parseFrontmatter(record.text)
  const ref = metaToRef(meta)
  if (ref === undefined) return undefined

  return { ...ref, body, path: record.locator }
}

// ---------------------------------------------------------------------------
// Convenience API — filesystem layering of project + global personas
// ---------------------------------------------------------------------------

function globalPersonasDir(): string {
  return join(userHome(), ".spores", "personas")
}

function projectPersonasDir(baseDir: string): string {
  return join(baseDir, ".spores", "personas")
}

function defaultFilesystemSource(baseDir: string): Source {
  return new LayeredSource([
    new FlatFileSource(projectPersonasDir(baseDir), ".md"),
    new FlatFileSource(globalPersonasDir(), ".md"),
  ])
}

/**
 * List all available personas. Project personas (`.spores/personas/`) override
 * global personas (`~/.spores/personas/`) when names conflict.
 */
export async function listPersonas(baseDir: string): Promise<PersonaRef[]> {
  return listPersonasFromSource(defaultFilesystemSource(baseDir))
}

/**
 * Load a persona by name. Returns the raw (unsubstituted) body + metadata.
 * Project personas take precedence over global personas.
 */
export async function loadPersona(
  name: string,
  baseDir: string,
): Promise<PersonaFile | undefined> {
  return loadPersonaFromSource(name, defaultFilesystemSource(baseDir))
}

/**
 * Adapter-shaped wrapper around the functional API. Use when a `PersonaAdapter`
 * interface is required (e.g. dependency injection, alternate adapters).
 */
export class FilesystemPersonaAdapter implements PersonaAdapter {
  constructor(private readonly baseDir: string) {}

  listPersonas(): Promise<PersonaRef[]> {
    return listPersonas(this.baseDir)
  }

  loadPersona(name: string): Promise<PersonaFile | undefined> {
    return loadPersona(name, this.baseDir)
  }
}
