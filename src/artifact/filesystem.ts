import {
  readdir,
  readFile,
  writeFile,
  mkdir,
  stat,
} from "node:fs/promises"
import { join } from "node:path"
import type {
  ArtifactId,
  ArtifactMetadata,
  ArtifactQuery,
  ArtifactRecord,
  ArtifactRef,
} from "../types.js"
import type {
  ArtifactAdapter,
  CreateArtifactInput,
  WriteArtifactInput,
} from "./adapter.js"

interface NodeError extends Error {
  code?: string | undefined
}

function isNodeError(err: unknown): err is NodeError {
  return err instanceof Error
}

// ---------------------------------------------------------------------------
// Minimal monotonic ULID generator (zero deps) — same as tasks/filesystem.ts
// ---------------------------------------------------------------------------

const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const TIME_LEN = 10
const RANDOM_LEN = 16

function encodeTime(now: number, len: number): string {
  let out = ""
  for (let i = len - 1; i >= 0; i--) {
    const mod = now % 32
    out = ULID_ALPHABET[mod]! + out
    now = (now - mod) / 32
  }
  return out
}

function randomChars(len: number): string {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  let out = ""
  for (let i = 0; i < len; i++) {
    out += ULID_ALPHABET[bytes[i]! % 32]
  }
  return out
}

function incrementBase32(s: string): string {
  const chars = s.split("")
  for (let i = chars.length - 1; i >= 0; i--) {
    const idx = ULID_ALPHABET.indexOf(chars[i]!)
    if (idx < 31) {
      chars[i] = ULID_ALPHABET[idx + 1]!
      return chars.join("")
    }
    chars[i] = "0"
  }
  return randomChars(chars.length)
}

function createUlidFactory(): () => string {
  let lastTime = 0
  let lastRandom = ""
  return function ulid(): string {
    const now = Date.now()
    if (now === lastTime) {
      lastRandom = incrementBase32(lastRandom)
    } else {
      lastTime = now
      lastRandom = randomChars(RANDOM_LEN)
    }
    return encodeTime(now, TIME_LEN) + lastRandom
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function bodyToString(body: string | ReadableStream): Promise<string> {
  if (typeof body === "string") return body
  return new Response(body).text()
}

// ---------------------------------------------------------------------------
// FilesystemArtifactAdapter
//
// On-disk layout (project-level):
//   .spores/artifacts/<id>/meta.json     — ArtifactRecord (minus pending_changes)
//   .spores/artifacts/<id>/v1.md         — body at version 1
//   .spores/artifacts/<id>/v2.md         — body at version 2 (after iterate write)
//   ...
//
// body_ref in ArtifactRecord is the relative path within the artifacts dir:
//   "<id>/v<n>.md"
//
// Global resolution: project-level wins over user-level (.spores in $HOME).
// The adapter is constructed with a single baseDir for now. Layered project/
// global resolution follows the same pattern as other primitives.
// ---------------------------------------------------------------------------

export class FilesystemArtifactAdapter implements ArtifactAdapter {
  private dir: string
  private ulid: () => string

  constructor(baseDir: string) {
    this.dir = join(baseDir, ".spores", "artifacts")
    this.ulid = createUlidFactory()
  }

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  async create(input: CreateArtifactInput): Promise<ArtifactRecord> {
    const id: ArtifactId = this.ulid()
    const now = new Date().toISOString()
    const bodyContent = await bodyToString(input.body)
    const bodyRef = `${id}/v1.md`

    const record: ArtifactRecord = {
      id,
      type: input.type,
      title: input.title,
      body_ref: bodyRef,
      version: 1,
      locked: false,
      tags: input.tags ?? [],
      created_at: now,
      updated_at: now,
      ...(input.derived_from !== undefined ? { derived_from: input.derived_from } : {}),
    }

    const artifactDir = join(this.dir, id)
    await mkdir(artifactDir, { recursive: true })
    await writeFile(join(this.dir, bodyRef), bodyContent, "utf-8")
    await this.writeMeta(record)

    return record
  }

  // -------------------------------------------------------------------------
  // read
  // -------------------------------------------------------------------------

  async read(
    id: ArtifactId,
    opts?: { version?: number | undefined },
  ): Promise<string> {
    const record = await this.loadMeta(id)

    const version = opts?.version ?? record.version
    const bodyPath = join(this.dir, `${id}/v${version}.md`)

    try {
      return await readFile(bodyPath, "utf-8")
    } catch (err) {
      if (isNodeError(err) && err.code === "ENOENT") {
        throw new Error(
          `Artifact ${id} version ${version} not found`,
        )
      }
      throw err
    }
  }

  // -------------------------------------------------------------------------
  // write
  // -------------------------------------------------------------------------

  async write(
    id: ArtifactId,
    input: WriteArtifactInput,
  ): Promise<ArtifactRecord> {
    const record = await this.loadMeta(id)
    const mode = input.mode ?? "iterate"

    if (record.locked && mode !== "create") {
      throw new Error(`Artifact ${id} is locked and cannot be written`)
    }

    if (mode === "create") {
      throw new Error(
        `Artifact ${id} already exists (mode "create" requires a new id)`,
      )
    }

    const bodyContent = await bodyToString(input.body)
    const now = new Date().toISOString()

    let newVersion: number
    if (mode === "iterate") {
      newVersion = record.version + 1
    } else {
      // replace — overwrite in place
      newVersion = record.version
    }

    const bodyRef = `${id}/v${newVersion}.md`
    await writeFile(join(this.dir, bodyRef), bodyContent, "utf-8")

    const updated: ArtifactRecord = {
      ...record,
      version: newVersion,
      body_ref: bodyRef,
      updated_at: now,
    }
    await this.writeMeta(updated)
    return updated
  }

  // -------------------------------------------------------------------------
  // edit
  // -------------------------------------------------------------------------

  async edit(
    id: ArtifactId,
    oldStr: string,
    newStr: string,
  ): Promise<ArtifactRecord> {
    const record = await this.loadMeta(id)

    if (record.locked) {
      throw new Error(`Artifact ${id} is locked and cannot be edited`)
    }

    const body = await this.read(id)

    if (!body.includes(oldStr)) {
      throw new Error(
        `edit: old string not found in artifact ${id}`,
      )
    }

    const newBody = body.replace(oldStr, newStr)
    return this.write(id, { body: newBody, mode: "iterate" })
  }

  // -------------------------------------------------------------------------
  // inspect
  // -------------------------------------------------------------------------

  async inspect(id: ArtifactId): Promise<ArtifactMetadata> {
    const record = await this.loadMeta(id)
    const bodyPath = join(this.dir, record.body_ref)

    let size_bytes: number | undefined
    try {
      const s = await stat(bodyPath)
      size_bytes = s.size
    } catch {
      // size is optional; don't fail inspect if body file is missing
    }

    return {
      ...record,
      pending_changes: false, // filesystem adapter: no draft/staging concept
      size_bytes,
    }
  }

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  async list(query?: ArtifactQuery): Promise<ArtifactRef[]> {
    let entries: string[]
    try {
      entries = await readdir(this.dir)
    } catch (err) {
      if (isNodeError(err) && err.code === "ENOENT") return []
      throw err
    }

    const refs: ArtifactRef[] = []
    for (const entry of entries) {
      const metaPath = join(this.dir, entry, "meta.json")
      try {
        const data = await readFile(metaPath, "utf-8")
        const record = JSON.parse(data) as ArtifactRecord

        if (!matchesQuery(record, query)) continue

        refs.push({
          id: record.id,
          type: record.type,
          title: record.title,
          version: record.version,
          locked: record.locked,
          tags: record.tags,
          updated_at: record.updated_at,
        })
      } catch (err) {
        if (isNodeError(err) && err.code === "ENOENT") continue
        const msg = err instanceof Error ? err.message : String(err)
        process.stderr.write(
          `warning: skipping malformed artifact directory ${entry}: ${msg}\n`,
        )
      }
    }

    // Sort by updated_at descending (newest first)
    refs.sort((a, b) =>
      a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0,
    )
    return refs
  }

  // -------------------------------------------------------------------------
  // lock
  // -------------------------------------------------------------------------

  async lock(id: ArtifactId): Promise<ArtifactRecord> {
    const record = await this.loadMeta(id)

    if (record.locked) {
      // Idempotent — already locked
      return record
    }

    const updated: ArtifactRecord = {
      ...record,
      locked: true,
      updated_at: new Date().toISOString(),
    }
    await this.writeMeta(updated)
    return updated
  }

  // -------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------

  private async loadMeta(id: ArtifactId): Promise<ArtifactRecord> {
    const metaPath = join(this.dir, id, "meta.json")
    try {
      const data = await readFile(metaPath, "utf-8")
      return JSON.parse(data) as ArtifactRecord
    } catch (err) {
      if (isNodeError(err) && err.code === "ENOENT") {
        throw new Error(`Artifact not found: ${id}`)
      }
      throw err
    }
  }

  private async writeMeta(record: ArtifactRecord): Promise<void> {
    const artifactDir = join(this.dir, record.id)
    await mkdir(artifactDir, { recursive: true })
    await writeFile(
      join(artifactDir, "meta.json"),
      JSON.stringify(record, null, 2),
      "utf-8",
    )
  }
}

// ---------------------------------------------------------------------------
// Query matching helper
// ---------------------------------------------------------------------------

function matchesQuery(
  record: ArtifactRecord,
  query: ArtifactQuery | undefined,
): boolean {
  if (query === undefined) return true
  if (query.type !== undefined && record.type !== query.type) return false
  if (query.locked !== undefined && record.locked !== query.locked) return false
  if (query.tags !== undefined && query.tags.length > 0) {
    const hasAny = query.tags.some((t) => record.tags.includes(t))
    if (!hasAny) return false
  }
  return true
}
