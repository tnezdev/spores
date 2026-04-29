import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, readdir } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { FilesystemArtifactAdapter } from "./filesystem.js"

describe("FilesystemArtifactAdapter", () => {
  let tmpDir: string
  let adapter: FilesystemArtifactAdapter

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "spores-artifact-test-"))
    adapter = new FilesystemArtifactAdapter(tmpDir)
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  describe("create", () => {
    it("returns a record with ULID id, version=1, locked=false", async () => {
      const record = await adapter.create({
        type: "brief",
        title: "Q2 Launch Brief",
        body: "# Q2 Launch\n\nContent here.",
      })
      expect(record.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
      expect(record.type).toBe("brief")
      expect(record.title).toBe("Q2 Launch Brief")
      expect(record.version).toBe(1)
      expect(record.locked).toBe(false)
      expect(record.tags).toEqual([])
      expect(record.created_at).toBe(record.updated_at)
    })

    it("stores tags and derived_from", async () => {
      const source = await adapter.create({
        type: "brief",
        title: "Source",
        body: "src",
      })
      const derived = await adapter.create({
        type: "memo",
        title: "Derived",
        body: "derived content",
        tags: ["important", "q2"],
        derived_from: source.id,
      })
      expect(derived.tags).toEqual(["important", "q2"])
      expect(derived.derived_from).toBe(source.id)
    })

    it("creates .spores/artifacts/<id>/meta.json and v1.md on disk", async () => {
      const record = await adapter.create({
        type: "note",
        title: "Test",
        body: "hello",
      })
      const entries = await readdir(join(tmpDir, ".spores", "artifacts", record.id))
      expect(entries).toContain("meta.json")
      expect(entries).toContain("v1.md")
    })

    it("generates monotonic ULIDs under rapid succession", async () => {
      const ids: string[] = []
      for (let i = 0; i < 30; i++) {
        const r = await adapter.create({ type: "note", title: `n${i}`, body: `body ${i}` })
        ids.push(r.id)
      }
      const sorted = [...ids].sort()
      expect(ids).toEqual(sorted)
      expect(new Set(ids).size).toBe(ids.length)
    })
  })

  // -------------------------------------------------------------------------
  // read
  // -------------------------------------------------------------------------

  describe("read", () => {
    it("returns the body content", async () => {
      const body = "# Hello\n\nThis is the artifact body."
      const record = await adapter.create({ type: "doc", title: "T", body })
      const content = await adapter.read(record.id)
      expect(content).toBe(body)
    })

    it("reads a specific version", async () => {
      const record = await adapter.create({ type: "doc", title: "T", body: "v1 content" })
      await adapter.write(record.id, { body: "v2 content", mode: "iterate" })
      const v1 = await adapter.read(record.id, { version: 1 })
      const v2 = await adapter.read(record.id, { version: 2 })
      expect(v1).toBe("v1 content")
      expect(v2).toBe("v2 content")
    })

    it("reads current version when version omitted", async () => {
      const record = await adapter.create({ type: "doc", title: "T", body: "first" })
      await adapter.write(record.id, { body: "second", mode: "iterate" })
      const content = await adapter.read(record.id)
      expect(content).toBe("second")
    })

    it("throws on missing id", async () => {
      await expect(adapter.read("MISSING_ID")).rejects.toThrow(/not found/i)
    })

    it("throws on missing version", async () => {
      const record = await adapter.create({ type: "doc", title: "T", body: "body" })
      await expect(adapter.read(record.id, { version: 99 })).rejects.toThrow(
        /not found/i,
      )
    })
  })

  // -------------------------------------------------------------------------
  // write
  // -------------------------------------------------------------------------

  describe("write", () => {
    describe("mode: iterate (default)", () => {
      it("bumps version number", async () => {
        const record = await adapter.create({ type: "doc", title: "T", body: "v1" })
        const updated = await adapter.write(record.id, { body: "v2", mode: "iterate" })
        expect(updated.version).toBe(2)
        expect(updated.body_ref).toContain("v2.md")
      })

      it("prior version body is still accessible after iterate", async () => {
        const record = await adapter.create({ type: "doc", title: "T", body: "first" })
        await adapter.write(record.id, { body: "second", mode: "iterate" })
        const v1 = await adapter.read(record.id, { version: 1 })
        expect(v1).toBe("first")
      })

      it("defaults to iterate when mode omitted", async () => {
        const record = await adapter.create({ type: "doc", title: "T", body: "v1" })
        const updated = await adapter.write(record.id, { body: "v2" })
        expect(updated.version).toBe(2)
      })
    })

    describe("mode: replace", () => {
      it("overwrites current version, version number unchanged", async () => {
        const record = await adapter.create({ type: "doc", title: "T", body: "original" })
        const updated = await adapter.write(record.id, { body: "replaced", mode: "replace" })
        expect(updated.version).toBe(1)
        const content = await adapter.read(record.id)
        expect(content).toBe("replaced")
      })
    })

    describe("mode: create", () => {
      it("throws because artifact already exists", async () => {
        const record = await adapter.create({ type: "doc", title: "T", body: "body" })
        await expect(
          adapter.write(record.id, { body: "body", mode: "create" }),
        ).rejects.toThrow(/already exists/i)
      })
    })

    it("throws on locked artifact", async () => {
      const record = await adapter.create({ type: "doc", title: "T", body: "body" })
      await adapter.lock(record.id)
      await expect(
        adapter.write(record.id, { body: "update" }),
      ).rejects.toThrow(/locked/i)
    })

    it("throws on missing id", async () => {
      await expect(
        adapter.write("MISSING", { body: "x" }),
      ).rejects.toThrow(/not found/i)
    })
  })

  // -------------------------------------------------------------------------
  // edit
  // -------------------------------------------------------------------------

  describe("edit", () => {
    it("replaces old string with new string and bumps version", async () => {
      const record = await adapter.create({
        type: "doc",
        title: "T",
        body: "Hello world, this is a test.",
      })
      const updated = await adapter.edit(record.id, "world", "SPORES")
      expect(updated.version).toBe(2)
      const content = await adapter.read(updated.id)
      expect(content).toBe("Hello SPORES, this is a test.")
    })

    it("throws if old string not found", async () => {
      const record = await adapter.create({ type: "doc", title: "T", body: "hello" })
      await expect(
        adapter.edit(record.id, "NOT_IN_BODY", "replacement"),
      ).rejects.toThrow(/not found/i)
    })

    it("throws on locked artifact", async () => {
      const record = await adapter.create({ type: "doc", title: "T", body: "content" })
      await adapter.lock(record.id)
      await expect(
        adapter.edit(record.id, "content", "updated"),
      ).rejects.toThrow(/locked/i)
    })
  })

  // -------------------------------------------------------------------------
  // inspect
  // -------------------------------------------------------------------------

  describe("inspect", () => {
    it("returns metadata with pending_changes=false and size_bytes", async () => {
      const record = await adapter.create({
        type: "note",
        title: "Test Note",
        body: "content here",
      })
      const meta = await adapter.inspect(record.id)
      expect(meta.id).toBe(record.id)
      expect(meta.type).toBe("note")
      expect(meta.pending_changes).toBe(false)
      expect(typeof meta.size_bytes).toBe("number")
      expect((meta.size_bytes ?? 0) > 0).toBe(true)
    })

    it("throws on missing id", async () => {
      await expect(adapter.inspect("MISSING")).rejects.toThrow(/not found/i)
    })
  })

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  describe("list", () => {
    it("returns empty when no artifacts exist", async () => {
      const refs = await adapter.list()
      expect(refs).toEqual([])
    })

    it("returns all artifacts with empty query", async () => {
      await adapter.create({ type: "brief", title: "A", body: "a" })
      await adapter.create({ type: "memo", title: "B", body: "b" })
      const refs = await adapter.list()
      expect(refs.length).toBe(2)
    })

    it("filters by type", async () => {
      await adapter.create({ type: "brief", title: "A", body: "a" })
      await adapter.create({ type: "memo", title: "B", body: "b" })
      const briefs = await adapter.list({ type: "brief" })
      expect(briefs.length).toBe(1)
      expect(briefs[0]!.type).toBe("brief")
    })

    it("filters by tags (any match)", async () => {
      await adapter.create({ type: "note", title: "Tagged", body: "x", tags: ["q2", "launch"] })
      await adapter.create({ type: "note", title: "Other", body: "y", tags: ["q1"] })
      await adapter.create({ type: "note", title: "None", body: "z", tags: [] })

      const q2 = await adapter.list({ tags: ["q2"] })
      expect(q2.length).toBe(1)
      expect(q2[0]!.title).toBe("Tagged")

      const q2orQ1 = await adapter.list({ tags: ["q2", "q1"] })
      expect(q2orQ1.length).toBe(2)
    })

    it("filters by locked=true", async () => {
      const a = await adapter.create({ type: "doc", title: "A", body: "a" })
      await adapter.create({ type: "doc", title: "B", body: "b" })
      await adapter.lock(a.id)

      const locked = await adapter.list({ locked: true })
      expect(locked.length).toBe(1)
      expect(locked[0]!.id).toBe(a.id)

      const unlocked = await adapter.list({ locked: false })
      expect(unlocked.length).toBe(1)
      expect(unlocked[0]!.title).toBe("B")
    })

    it("returns lightweight refs (no body_ref)", async () => {
      await adapter.create({ type: "note", title: "T", body: "body" })
      const refs = await adapter.list()
      expect(refs.length).toBe(1)
      expect("body_ref" in refs[0]!).toBe(false)
      expect(refs[0]!.id).toBeDefined()
      expect(refs[0]!.type).toBeDefined()
      expect(refs[0]!.title).toBeDefined()
      expect(refs[0]!.version).toBeDefined()
      expect(refs[0]!.locked).toBeDefined()
    })
  })

  // -------------------------------------------------------------------------
  // lock
  // -------------------------------------------------------------------------

  describe("lock", () => {
    it("sets locked=true", async () => {
      const record = await adapter.create({ type: "doc", title: "T", body: "body" })
      const locked = await adapter.lock(record.id)
      expect(locked.locked).toBe(true)
    })

    it("persists the locked state", async () => {
      const record = await adapter.create({ type: "doc", title: "T", body: "body" })
      await adapter.lock(record.id)
      const meta = await adapter.inspect(record.id)
      expect(meta.locked).toBe(true)
    })

    it("is idempotent — locking an already-locked artifact returns current record", async () => {
      const record = await adapter.create({ type: "doc", title: "T", body: "body" })
      const first = await adapter.lock(record.id)
      const second = await adapter.lock(record.id)
      expect(second.locked).toBe(true)
      expect(second.version).toBe(first.version)
    })

    it("throws on missing id", async () => {
      await expect(adapter.lock("MISSING")).rejects.toThrow(/not found/i)
    })
  })
})
