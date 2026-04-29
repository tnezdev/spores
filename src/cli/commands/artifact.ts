import type {
  ArtifactCreatedOutput,
  ArtifactWrittenOutput,
  ArtifactEditedOutput,
  ArtifactLockedOutput,
  ArtifactInspectedOutput,
  ArtifactRef,
  HookInvocation,
} from "../../types.js"
import { FilesystemArtifactAdapter } from "../../artifact/filesystem.js"
import { fireHook } from "../../hooks/fire.js"
import type { Command } from "../context.js"
import { output } from "../output.js"
import {
  formatArtifactCreated,
  formatArtifactWritten,
  formatArtifactEdited,
  formatArtifactLocked,
  formatArtifactInspected,
  formatArtifactList,
} from "../format.js"

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function emitHookWarning(event: string, hook: HookInvocation): void {
  if (!hook.ran) return
  if (hook.stderr.length > 0) process.stderr.write(hook.stderr)
  if (hook.error !== undefined) {
    process.stderr.write(`[hook warning] ${event}: ${hook.error}\n`)
  } else if (hook.exit_code !== null && hook.exit_code !== 0) {
    process.stderr.write(`[hook warning] ${event} exited ${hook.exit_code}\n`)
  }
}

function parseTags(flags: Record<string, string | true>): string[] {
  if (typeof flags["tags"] === "string") {
    return flags["tags"]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }
  return []
}

async function readBodyFromFlags(
  args: string[],
  flags: Record<string, string | true>,
): Promise<string> {
  // Body priority: --from file, then positional arg, then stdin
  if (typeof flags["from"] === "string") {
    const { readFile } = await import("node:fs/promises")
    return readFile(flags["from"], "utf-8")
  }
  const positional = args[0]
  if (positional !== undefined) return positional
  // Read from stdin
  return new Response(Bun.stdin.stream()).text()
}

// ---------------------------------------------------------------------------
// artifact create
// ---------------------------------------------------------------------------

export const artifactCreateCommand: Command = async (ctx, args, flags) => {
  const type = args[0]
  if (type === undefined) {
    throw new Error(
      "Usage: spores artifact create <type> [--title T] [--from FILE | body]",
    )
  }

  const title =
    typeof flags["title"] === "string" ? flags["title"] : type
  const tags = parseTags(flags)
  const derivedFrom =
    typeof flags["derived-from"] === "string"
      ? flags["derived-from"]
      : undefined

  const bodyArgs = args.slice(1)
  const body = await readBodyFromFlags(bodyArgs, flags)

  const adapter = new FilesystemArtifactAdapter(ctx.baseDir)
  const record = await adapter.create({ type, title, body, tags, derived_from: derivedFrom })

  const hook = await fireHook(
    "artifact.created",
    {
      SPORES_ARTIFACT_ID: record.id,
      SPORES_ARTIFACT_TYPE: record.type,
      SPORES_ARTIFACT_TITLE: record.title,
      SPORES_ARTIFACT_TAGS: record.tags.join(","),
    },
    ctx.baseDir,
  )

  const result: ArtifactCreatedOutput = {
    artifact: record,
    hook: hook.ran ? hook : undefined,
  }
  output(ctx, result, formatArtifactCreated)
  emitHookWarning("artifact.created", hook)
}

// ---------------------------------------------------------------------------
// artifact read
// ---------------------------------------------------------------------------

export const artifactReadCommand: Command = async (ctx, args, flags) => {
  const id = args[0]
  if (id === undefined) {
    throw new Error("Usage: spores artifact read <id> [--version N]")
  }

  const version =
    typeof flags["version"] === "string"
      ? parseInt(flags["version"], 10)
      : undefined

  const adapter = new FilesystemArtifactAdapter(ctx.baseDir)
  const body = await adapter.read(id, { version })

  // artifact read is pipe-friendly: always outputs raw body (no JSON wrapper)
  // --json flag is silently honored by printing JSON if explicitly set
  if (ctx.json) {
    console.log(JSON.stringify({ id, version: version ?? "current", body }, null, 2))
  } else {
    process.stdout.write(body)
    // Add trailing newline if content doesn't end with one
    if (!body.endsWith("\n")) process.stdout.write("\n")
  }
}

// ---------------------------------------------------------------------------
// artifact write
// ---------------------------------------------------------------------------

export const artifactWriteCommand: Command = async (ctx, args, flags) => {
  const id = args[0]
  if (id === undefined) {
    throw new Error(
      "Usage: spores artifact write <id> [--from FILE | body] [--mode iterate|replace]",
    )
  }

  const rawMode = typeof flags["mode"] === "string" ? flags["mode"] : "iterate"
  if (rawMode !== "iterate" && rawMode !== "replace") {
    throw new Error(`Invalid mode "${rawMode}". Must be iterate or replace.`)
  }
  const mode = rawMode as "iterate" | "replace"

  const bodyArgs = args.slice(1)
  const body = await readBodyFromFlags(bodyArgs, flags)

  const adapter = new FilesystemArtifactAdapter(ctx.baseDir)
  const record = await adapter.write(id, { body, mode })

  const hook = await fireHook(
    "artifact.written",
    {
      SPORES_ARTIFACT_ID: record.id,
      SPORES_ARTIFACT_VERSION: String(record.version),
      SPORES_ARTIFACT_MODE: mode,
    },
    ctx.baseDir,
  )

  const result: ArtifactWrittenOutput = {
    artifact: record,
    hook: hook.ran ? hook : undefined,
  }
  output(ctx, result, formatArtifactWritten)
  emitHookWarning("artifact.written", hook)
}

// ---------------------------------------------------------------------------
// artifact edit
// ---------------------------------------------------------------------------

export const artifactEditCommand: Command = async (ctx, args, flags) => {
  const id = args[0]
  const oldStr = typeof flags["old"] === "string" ? flags["old"] : undefined
  const newStr = typeof flags["new"] === "string" ? flags["new"] : undefined

  if (id === undefined || oldStr === undefined || newStr === undefined) {
    throw new Error(
      'Usage: spores artifact edit <id> --old "..." --new "..."',
    )
  }

  const adapter = new FilesystemArtifactAdapter(ctx.baseDir)
  const record = await adapter.edit(id, oldStr, newStr)

  const hook = await fireHook(
    "artifact.edited",
    {
      SPORES_ARTIFACT_ID: record.id,
      SPORES_ARTIFACT_VERSION: String(record.version),
    },
    ctx.baseDir,
  )

  const result: ArtifactEditedOutput = {
    artifact: record,
    hook: hook.ran ? hook : undefined,
  }
  output(ctx, result, formatArtifactEdited)
  emitHookWarning("artifact.edited", hook)
}

// ---------------------------------------------------------------------------
// artifact inspect
// ---------------------------------------------------------------------------

export const artifactInspectCommand: Command = async (ctx, args, _flags) => {
  const id = args[0]
  if (id === undefined) {
    throw new Error("Usage: spores artifact inspect <id>")
  }

  const adapter = new FilesystemArtifactAdapter(ctx.baseDir)
  const meta = await adapter.inspect(id)

  const result: ArtifactInspectedOutput = { artifact: meta }
  output(ctx, result, formatArtifactInspected)
}

// ---------------------------------------------------------------------------
// artifact list
// ---------------------------------------------------------------------------

export const artifactListCommand: Command = async (ctx, _args, flags) => {
  const type =
    typeof flags["type"] === "string" ? flags["type"] : undefined
  const tags =
    typeof flags["tags"] === "string"
      ? flags["tags"].split(",").map((s) => s.trim())
      : undefined
  const lockedFlag = flags["locked"]
  const locked =
    lockedFlag === true ? true : lockedFlag === "false" ? false : undefined

  const adapter = new FilesystemArtifactAdapter(ctx.baseDir)
  const refs: ArtifactRef[] = await adapter.list({ type, tags, locked })

  output(ctx, refs, formatArtifactList)
}

// ---------------------------------------------------------------------------
// artifact lock
// ---------------------------------------------------------------------------

export const artifactLockCommand: Command = async (ctx, args, _flags) => {
  const id = args[0]
  if (id === undefined) {
    throw new Error("Usage: spores artifact lock <id>")
  }

  const adapter = new FilesystemArtifactAdapter(ctx.baseDir)
  const record = await adapter.lock(id)

  const hook = await fireHook(
    "artifact.locked",
    {
      SPORES_ARTIFACT_ID: record.id,
      SPORES_ARTIFACT_FINAL_VERSION: String(record.version),
    },
    ctx.baseDir,
  )

  const result: ArtifactLockedOutput = {
    artifact: record,
    hook: hook.ran ? hook : undefined,
  }
  output(ctx, result, formatArtifactLocked)
  emitHookWarning("artifact.locked", hook)
}
