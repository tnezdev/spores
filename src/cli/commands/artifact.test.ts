import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile, chmod } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  artifactCreateCommand,
  artifactReadCommand,
  artifactWriteCommand,
  artifactEditCommand,
  artifactInspectCommand,
  artifactListCommand,
  artifactLockCommand,
} from "./artifact.js"
import { FilesystemArtifactAdapter } from "../../artifact/filesystem.js"
import { FilesystemAdapter } from "../../memory/filesystem.js"
import type { Ctx } from "../main.js"
import type { SporesConfig } from "../../types.js"

function makeCtx(baseDir: string, json = true): Ctx {
  const config: SporesConfig = {
    adapter: "filesystem",
    memory: { dir: ".spores/memory", defaultTier: "L1", dreamDepth: 1 },
    workflow: {
      graphsDir: ".spores/workflow/graphs",
      runsDir: ".spores/workflow/runs",
    },
    wake: {},
  }
  return {
    adapter: new FilesystemAdapter(baseDir),
    config,
    baseDir,
    json,
    wide: false,
  }
}

function captureStdout(fn: () => Promise<void>): Promise<string> {
  const origLog = console.log
  let captured = ""
  console.log = (...args: unknown[]) => {
    captured +=
      args.map((a) => (typeof a === "string" ? a : String(a))).join(" ") + "\n"
  }
  return fn()
    .then(() => captured)
    .finally(() => {
      console.log = origLog
    })
}

function captureStdoutWrite(fn: () => Promise<void>): Promise<string> {
  const orig = process.stdout.write.bind(process.stdout)
  let captured = ""
  process.stdout.write = (s: unknown) => {
    captured += String(s)
    return true
  }
  return fn()
    .then(() => captured)
    .finally(() => {
      process.stdout.write = orig
    })
}

describe("artifact CLI commands", () => {
  let tmpDir: string
  let ctx: Ctx

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "spores-artifact-cli-"))
    ctx = makeCtx(tmpDir)
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  // -------------------------------------------------------------------------
  // artifact create
  // -------------------------------------------------------------------------

  describe("artifact create", () => {
    it("creates an artifact and returns the record", async () => {
      const out = await captureStdout(() =>
        artifactCreateCommand(ctx, ["brief", "Q2 Launch summary"], {
          title: "Q2 Launch Brief",
          tags: "q2,launch",
        }),
      )
      const result = JSON.parse(out)
      const record = result.artifact
      expect(record.type).toBe("brief")
      expect(record.title).toBe("Q2 Launch Brief")
      expect(record.version).toBe(1)
      expect(record.locked).toBe(false)
      expect(record.tags).toEqual(["q2", "launch"])
      expect(record.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
      expect(result.hook).toBeUndefined()
    })

    it("uses type as title when --title is omitted", async () => {
      const out = await captureStdout(() =>
        artifactCreateCommand(ctx, ["memo", "body content"], {}),
      )
      const result = JSON.parse(out)
      expect(result.artifact.title).toBe("memo")
    })

    it("persists artifact to disk", async () => {
      const out = await captureStdout(() =>
        artifactCreateCommand(ctx, ["note", "hello world"], { title: "My Note" }),
      )
      const result = JSON.parse(out)
      const id = result.artifact.id

      const adapter = new FilesystemArtifactAdapter(tmpDir)
      const body = await adapter.read(id)
      expect(body).toBe("hello world")
    })

    it("throws on missing type argument", async () => {
      await expect(artifactCreateCommand(ctx, [], {})).rejects.toThrow(/usage/i)
    })

    it("fires artifact.created hook when script exists", async () => {
      const hooksDir = join(tmpDir, ".spores", "hooks")
      await mkdir(hooksDir, { recursive: true })
      const hookScript = join(hooksDir, "artifact.created")
      await writeFile(
        hookScript,
        `#!/usr/bin/env sh\necho "hook ran: $SPORES_ARTIFACT_ID"`,
      )
      await chmod(hookScript, 0o755)

      const out = await captureStdout(() =>
        artifactCreateCommand(ctx, ["brief", "body"], { title: "Hook Test" }),
      )
      const result = JSON.parse(out)
      expect(result.hook).toBeDefined()
      expect(result.hook.ran).toBe(true)
      expect(result.hook.stdout).toContain("hook ran:")
    })
  })

  // -------------------------------------------------------------------------
  // artifact read
  // -------------------------------------------------------------------------

  describe("artifact read", () => {
    it("outputs raw body to stdout (non-json mode)", async () => {
      const ctxHuman = makeCtx(tmpDir, false)
      const adapter = new FilesystemArtifactAdapter(tmpDir)
      const record = await adapter.create({ type: "doc", title: "T", body: "# Hello\n\nWorld." })

      const out = await captureStdoutWrite(() =>
        artifactReadCommand(ctxHuman, [record.id], {}),
      )
      expect(out).toContain("# Hello")
      expect(out).toContain("World.")
    })

    it("returns JSON body in --json mode", async () => {
      const adapter = new FilesystemArtifactAdapter(tmpDir)
      const record = await adapter.create({ type: "doc", title: "T", body: "content" })

      const out = await captureStdout(() =>
        artifactReadCommand(ctx, [record.id], {}),
      )
      const result = JSON.parse(out)
      expect(result.id).toBe(record.id)
      expect(result.body).toBe("content")
    })

    it("reads a specific version", async () => {
      const adapter = new FilesystemArtifactAdapter(tmpDir)
      const record = await adapter.create({ type: "doc", title: "T", body: "v1" })
      await adapter.write(record.id, { body: "v2", mode: "iterate" })

      const out = await captureStdout(() =>
        artifactReadCommand(ctx, [record.id], { version: "1" }),
      )
      const result = JSON.parse(out)
      expect(result.body).toBe("v1")
    })

    it("throws on missing id argument", async () => {
      await expect(artifactReadCommand(ctx, [], {})).rejects.toThrow(/usage/i)
    })
  })

  // -------------------------------------------------------------------------
  // artifact write
  // -------------------------------------------------------------------------

  describe("artifact write", () => {
    it("writes new content and bumps version (iterate)", async () => {
      const adapter = new FilesystemArtifactAdapter(tmpDir)
      const record = await adapter.create({ type: "doc", title: "T", body: "v1" })

      const out = await captureStdout(() =>
        artifactWriteCommand(ctx, [record.id, "v2 content"], { mode: "iterate" }),
      )
      const result = JSON.parse(out)
      expect(result.artifact.version).toBe(2)
    })

    it("replaces content in place (replace mode)", async () => {
      const adapter = new FilesystemArtifactAdapter(tmpDir)
      const record = await adapter.create({ type: "doc", title: "T", body: "original" })

      const out = await captureStdout(() =>
        artifactWriteCommand(ctx, [record.id, "replaced"], { mode: "replace" }),
      )
      const result = JSON.parse(out)
      expect(result.artifact.version).toBe(1)
      const body = await adapter.read(record.id)
      expect(body).toBe("replaced")
    })

    it("throws on missing id", async () => {
      await expect(artifactWriteCommand(ctx, [], {})).rejects.toThrow(/usage/i)
    })

    it("throws on invalid mode", async () => {
      const adapter = new FilesystemArtifactAdapter(tmpDir)
      const record = await adapter.create({ type: "doc", title: "T", body: "x" })
      await expect(
        artifactWriteCommand(ctx, [record.id, "body"], { mode: "badmode" }),
      ).rejects.toThrow(/invalid mode/i)
    })
  })

  // -------------------------------------------------------------------------
  // artifact edit
  // -------------------------------------------------------------------------

  describe("artifact edit", () => {
    it("replaces old string with new and bumps version", async () => {
      const adapter = new FilesystemArtifactAdapter(tmpDir)
      const record = await adapter.create({
        type: "doc",
        title: "T",
        body: "Hello world.",
      })

      const out = await captureStdout(() =>
        artifactEditCommand(ctx, [record.id], { old: "world", new: "SPORES" }),
      )
      const result = JSON.parse(out)
      expect(result.artifact.version).toBe(2)

      const body = await adapter.read(record.id)
      expect(body).toBe("Hello SPORES.")
    })

    it("throws on missing --old or --new flags", async () => {
      const adapter = new FilesystemArtifactAdapter(tmpDir)
      const record = await adapter.create({ type: "doc", title: "T", body: "x" })
      await expect(
        artifactEditCommand(ctx, [record.id], { old: "x" }),
      ).rejects.toThrow(/usage/i)
    })
  })

  // -------------------------------------------------------------------------
  // artifact inspect
  // -------------------------------------------------------------------------

  describe("artifact inspect", () => {
    it("returns metadata with pending_changes and size_bytes", async () => {
      const adapter = new FilesystemArtifactAdapter(tmpDir)
      const record = await adapter.create({ type: "note", title: "My Note", body: "content" })

      const out = await captureStdout(() =>
        artifactInspectCommand(ctx, [record.id], {}),
      )
      const result = JSON.parse(out)
      const meta = result.artifact
      expect(meta.id).toBe(record.id)
      expect(meta.type).toBe("note")
      expect(meta.pending_changes).toBe(false)
      expect(typeof meta.size_bytes).toBe("number")
    })

    it("throws on missing id", async () => {
      await expect(artifactInspectCommand(ctx, [], {})).rejects.toThrow(/usage/i)
    })
  })

  // -------------------------------------------------------------------------
  // artifact list
  // -------------------------------------------------------------------------

  describe("artifact list", () => {
    it("returns empty array when no artifacts", async () => {
      const out = await captureStdout(() => artifactListCommand(ctx, [], {}))
      const result = JSON.parse(out)
      expect(result).toEqual([])
    })

    it("returns all artifacts", async () => {
      const adapter = new FilesystemArtifactAdapter(tmpDir)
      await adapter.create({ type: "brief", title: "A", body: "a" })
      await adapter.create({ type: "memo", title: "B", body: "b" })

      const out = await captureStdout(() => artifactListCommand(ctx, [], {}))
      const refs = JSON.parse(out)
      expect(refs.length).toBe(2)
    })

    it("filters by type", async () => {
      const adapter = new FilesystemArtifactAdapter(tmpDir)
      await adapter.create({ type: "brief", title: "A", body: "a" })
      await adapter.create({ type: "memo", title: "B", body: "b" })

      const out = await captureStdout(() =>
        artifactListCommand(ctx, [], { type: "brief" }),
      )
      const refs = JSON.parse(out)
      expect(refs.length).toBe(1)
      expect(refs[0].type).toBe("brief")
    })
  })

  // -------------------------------------------------------------------------
  // artifact lock
  // -------------------------------------------------------------------------

  describe("artifact lock", () => {
    it("locks the artifact", async () => {
      const adapter = new FilesystemArtifactAdapter(tmpDir)
      const record = await adapter.create({ type: "doc", title: "T", body: "body" })

      const out = await captureStdout(() =>
        artifactLockCommand(ctx, [record.id], {}),
      )
      const result = JSON.parse(out)
      expect(result.artifact.locked).toBe(true)
    })

    it("persists locked state", async () => {
      const adapter = new FilesystemArtifactAdapter(tmpDir)
      const record = await adapter.create({ type: "doc", title: "T", body: "body" })
      await artifactLockCommand(ctx, [record.id], {})

      const meta = await adapter.inspect(record.id)
      expect(meta.locked).toBe(true)
    })

    it("throws on missing id", async () => {
      await expect(artifactLockCommand(ctx, [], {})).rejects.toThrow(/usage/i)
    })

    it("fires artifact.locked hook when script exists", async () => {
      const adapter = new FilesystemArtifactAdapter(tmpDir)
      const record = await adapter.create({ type: "doc", title: "T", body: "body" })

      const hooksDir = join(tmpDir, ".spores", "hooks")
      await mkdir(hooksDir, { recursive: true })
      const hookScript = join(hooksDir, "artifact.locked")
      await writeFile(
        hookScript,
        `#!/usr/bin/env sh\necho "locked: $SPORES_ARTIFACT_ID v$SPORES_ARTIFACT_FINAL_VERSION"`,
      )
      await chmod(hookScript, 0o755)

      const out = await captureStdout(() =>
        artifactLockCommand(ctx, [record.id], {}),
      )
      const result = JSON.parse(out)
      expect(result.hook).toBeDefined()
      expect(result.hook.ran).toBe(true)
      expect(result.hook.stdout).toContain("locked:")
    })
  })
})
