import type {
  ArtifactId,
  ArtifactMetadata,
  ArtifactQuery,
  ArtifactRecord,
  ArtifactRef,
  ArtifactWriteMode,
} from "../types.js"

export interface CreateArtifactInput {
  type: string
  title: string
  body: string | ReadableStream
  tags?: string[] | undefined
  derived_from?: ArtifactId | undefined
}

export interface WriteArtifactInput {
  body: string | ReadableStream
  mode?: ArtifactWriteMode | undefined // defaults to "iterate"
}

/**
 * Adapter interface for durable artifact storage.
 *
 * An artifact is a named, versioned piece of content — addressable by ULID,
 * persistable across turns, lockable for append-only history.
 *
 * Storage implementations (filesystem, blob) are separate from this interface.
 * The filesystem adapter (`FilesystemArtifactAdapter`) is the default.
 */
export interface ArtifactAdapter {
  /**
   * Create a new artifact. `id`, `version`, `locked`, `created_at`, and
   * `updated_at` are set by the adapter.
   */
  create(input: CreateArtifactInput): Promise<ArtifactRecord>

  /**
   * Read the body of an artifact. Returns the content as a string.
   * Pass `version` to read a specific version; omit for the current version.
   */
  read(id: ArtifactId, opts?: { version?: number | undefined }): Promise<string>

  /**
   * Write new content to an artifact.
   * - `iterate` (default) — bump version, prior version remains accessible
   * - `replace` — overwrite current version in place
   * - `create` — fail if the artifact already exists
   *
   * Fails if the artifact is locked.
   */
  write(id: ArtifactId, input: WriteArtifactInput): Promise<ArtifactRecord>

  /**
   * Edit artifact body by replacing `oldStr` with `newStr`.
   * Semantically equivalent to a `write` with mode `iterate`.
   * Throws if `oldStr` is not found in the current body.
   * Fails if the artifact is locked.
   */
  edit(id: ArtifactId, oldStr: string, newStr: string): Promise<ArtifactRecord>

  /**
   * Return full metadata for an artifact, including computed fields
   * (`pending_changes`, `size_bytes`).
   */
  inspect(id: ArtifactId): Promise<ArtifactMetadata>

  /**
   * List artifacts matching the query. Returns lightweight refs.
   * Returns all artifacts if query is empty.
   */
  list(query?: ArtifactQuery): Promise<ArtifactRef[]>

  /**
   * Lock an artifact — transitions it to append-only.
   * `write` and `edit` will fail on locked artifacts.
   * Idempotent: locking an already-locked artifact is a no-op.
   */
  lock(id: ArtifactId): Promise<ArtifactRecord>
}
