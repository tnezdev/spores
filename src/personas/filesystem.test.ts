import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { InMemorySource } from "../sources/in-memory.js"
import { LayeredSource } from "../sources/layered.js"
import {
  FilesystemPersonaAdapter,
  listPersonas,
  listPersonasFromSource,
  loadPersona,
  loadPersonaFromSource,
} from "./filesystem.js"

// We override HOME so the "global" personas dir points into a scratch tmp
// directory rather than the real user's ~/.spores/personas.
const originalHome = process.env["HOME"]
let fakeHome: string
let project: string

async function writePersona(
  dir: string,
  filename: string,
  body: string,
): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, filename), body)
}

beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), "spores-persona-home-"))
  project = await mkdtemp(join(tmpdir(), "spores-persona-proj-"))
  process.env["HOME"] = fakeHome
})

afterEach(() => {
  if (originalHome !== undefined) process.env["HOME"] = originalHome
  else delete process.env["HOME"]
})

const MAINTAINER = `---
name: spores-maintainer
description: Activate when working on the spores toolbelt
memory_tags: [spores, npm-publishing]
skills: [release, changelog]
task_filter:
  tags: [spores]
  status: ready
workflow: spores-triage
---

You are working on the spores project.
Current directory: {{cwd}}
`

const MINIMAL = `---
name: minimal
description: Activate for minimal test coverage
---

Body text.
`

describe("listPersonas", () => {
  test("returns empty array when no personas directory exists", async () => {
    const refs = await listPersonas(project)
    expect(refs).toEqual([])
  })

  test("lists personas from the project directory", async () => {
    await writePersona(
      join(project, ".spores", "personas"),
      "minimal.md",
      MINIMAL,
    )
    const refs = await listPersonas(project)
    expect(refs).toHaveLength(1)
    expect(refs[0]!.name).toBe("minimal")
    expect(refs[0]!.description).toBe("Activate for minimal test coverage")
    expect(refs[0]!.memory_tags).toEqual([])
    expect(refs[0]!.skills).toEqual([])
  })

  test("parses full frontmatter including nested task_filter", async () => {
    await writePersona(
      join(project, ".spores", "personas"),
      "spores-maintainer.md",
      MAINTAINER,
    )
    const refs = await listPersonas(project)
    const ref = refs[0]!
    expect(ref.memory_tags).toEqual(["spores", "npm-publishing"])
    expect(ref.skills).toEqual(["release", "changelog"])
    expect(ref.task_filter).toEqual({ tags: ["spores"], status: "ready" })
    expect(ref.workflow).toBe("spores-triage")
  })

  test("project personas override global personas on name conflict", async () => {
    await writePersona(
      join(fakeHome, ".spores", "personas"),
      "dup.md",
      `---
name: dup
description: Global version
---
global body
`,
    )
    await writePersona(
      join(project, ".spores", "personas"),
      "dup.md",
      `---
name: dup
description: Project version
---
project body
`,
    )
    const refs = await listPersonas(project)
    expect(refs).toHaveLength(1)
    expect(refs[0]!.description).toBe("Project version")
  })

  test("merges global and project personas when names differ", async () => {
    await writePersona(
      join(fakeHome, ".spores", "personas"),
      "global-only.md",
      `---
name: global-only
description: Global persona
---
body
`,
    )
    await writePersona(
      join(project, ".spores", "personas"),
      "project-only.md",
      `---
name: project-only
description: Project persona
---
body
`,
    )
    const refs = await listPersonas(project)
    expect(refs.map((r) => r.name)).toEqual(["global-only", "project-only"])
  })

  test("skips personas missing required fields (name, description)", async () => {
    await writePersona(
      join(project, ".spores", "personas"),
      "broken.md",
      `---
description: Missing name
---
body
`,
    )
    await writePersona(
      join(project, ".spores", "personas"),
      "ok.md",
      MINIMAL,
    )
    const refs = await listPersonas(project)
    expect(refs.map((r) => r.name)).toEqual(["minimal"])
  })

  test("ignores non-.md files in the personas directory", async () => {
    const dir = join(project, ".spores", "personas")
    await writePersona(dir, "README.txt", "not a persona")
    await writePersona(dir, "minimal.md", MINIMAL)
    const refs = await listPersonas(project)
    expect(refs).toHaveLength(1)
  })

  test("returns sorted by name", async () => {
    const dir = join(project, ".spores", "personas")
    await writePersona(
      dir,
      "zebra.md",
      `---
name: zebra
description: z
---
`,
    )
    await writePersona(
      dir,
      "alpha.md",
      `---
name: alpha
description: a
---
`,
    )
    const refs = await listPersonas(project)
    expect(refs.map((r) => r.name)).toEqual(["alpha", "zebra"])
  })
})

describe("loadPersona", () => {
  test("returns undefined when persona does not exist", async () => {
    const file = await loadPersona("missing", project)
    expect(file).toBeUndefined()
  })

  test("loads a persona with raw body (unsubstituted tokens)", async () => {
    await writePersona(
      join(project, ".spores", "personas"),
      "spores-maintainer.md",
      MAINTAINER,
    )
    const file = await loadPersona("spores-maintainer", project)
    expect(file).toBeDefined()
    expect(file!.name).toBe("spores-maintainer")
    expect(file!.body).toContain("{{cwd}}") // raw, unsubstituted
    expect(file!.body).toContain("You are working on the spores project.")
    expect(file!.path).toContain("spores-maintainer.md")
  })

  test("project persona wins over global when both exist", async () => {
    await writePersona(
      join(fakeHome, ".spores", "personas"),
      "dup.md",
      `---
name: dup
description: Global
---
global body
`,
    )
    await writePersona(
      join(project, ".spores", "personas"),
      "dup.md",
      `---
name: dup
description: Project
---
project body
`,
    )
    const file = await loadPersona("dup", project)
    expect(file!.description).toBe("Project")
    expect(file!.body.trim()).toBe("project body")
  })

  test("falls back to global persona when project version is absent", async () => {
    await writePersona(
      join(fakeHome, ".spores", "personas"),
      "global-only.md",
      `---
name: global-only
description: Global
---
global body
`,
    )
    const file = await loadPersona("global-only", project)
    expect(file!.description).toBe("Global")
  })

  test("skips personas with missing required fields", async () => {
    await writePersona(
      join(project, ".spores", "personas"),
      "broken.md",
      `---
description: No name here
---
body
`,
    )
    const file = await loadPersona("broken", project)
    expect(file).toBeUndefined()
  })
})

describe("FilesystemPersonaAdapter", () => {
  test("implements PersonaAdapter via functional API", async () => {
    await writePersona(
      join(project, ".spores", "personas"),
      "minimal.md",
      MINIMAL,
    )
    const adapter = new FilesystemPersonaAdapter(project)
    const refs = await adapter.listPersonas()
    expect(refs).toHaveLength(1)
    const file = await adapter.loadPersona("minimal")
    expect(file!.name).toBe("minimal")
  })
})

describe("loadPersonaFromSource", () => {
  test("loads a persona from any source — no filesystem coupling", async () => {
    const source = new InMemorySource({ minimal: MINIMAL }, "test")
    const file = await loadPersonaFromSource("minimal", source)
    expect(file!.name).toBe("minimal")
    expect(file!.description).toBe("Activate for minimal test coverage")
    expect(file!.body.trim()).toBe("Body text.")
    expect(file!.path).toBe("test:minimal")
  })

  test("returns undefined when the source has no record by that name", async () => {
    const source = new InMemorySource({ alpha: MINIMAL })
    const file = await loadPersonaFromSource("missing", source)
    expect(file).toBeUndefined()
  })

  test("returns undefined when frontmatter is missing required fields", async () => {
    const source = new InMemorySource({
      broken: `---\ndescription: No name here\n---\nbody\n`,
    })
    const file = await loadPersonaFromSource("broken", source)
    expect(file).toBeUndefined()
  })

  test("layered source: live state shadows seed", async () => {
    const seed = new InMemorySource(
      {
        dup: `---\nname: dup\ndescription: Seed version\n---\nseed body\n`,
      },
      "seed",
    )
    const live = new InMemorySource(
      {
        dup: `---\nname: dup\ndescription: Live version\n---\nlive body\n`,
      },
      "live",
    )
    const layered = new LayeredSource([live, seed])
    const file = await loadPersonaFromSource("dup", layered)
    expect(file!.description).toBe("Live version")
    expect(file!.body.trim()).toBe("live body")
    expect(file!.path).toBe("live:dup")
  })

  test("layered source: falls through to seed when live lacks the name", async () => {
    const seed = new InMemorySource(
      {
        seeded: `---\nname: seeded\ndescription: From seed\n---\nbody\n`,
      },
      "seed",
    )
    const live = new InMemorySource({}, "live")
    const layered = new LayeredSource([live, seed])
    const file = await loadPersonaFromSource("seeded", layered)
    expect(file!.description).toBe("From seed")
    expect(file!.path).toBe("seed:seeded")
  })
})

describe("routing hints", () => {
  test("parses effort and reasoning when both present and valid", async () => {
    const source = new InMemorySource({
      hinted: `---\nname: hinted\ndescription: with hints\neffort: high\nreasoning: medium\n---\nbody\n`,
    })
    const file = await loadPersonaFromSource("hinted", source)
    expect(file!.effort).toBe("high")
    expect(file!.reasoning).toBe("medium")
  })

  test("hints default to undefined when frontmatter omits them", async () => {
    const source = new InMemorySource({ minimal: MINIMAL })
    const file = await loadPersonaFromSource("minimal", source)
    expect(file!.effort).toBeUndefined()
    expect(file!.reasoning).toBeUndefined()
  })

  test("invalid hint values are dropped, persona still loads", async () => {
    const source = new InMemorySource({
      bad: `---\nname: bad\ndescription: bad hints\neffort: insane\nreasoning: galaxy-brain\n---\nbody\n`,
    })
    const file = await loadPersonaFromSource("bad", source)
    expect(file).toBeDefined()
    expect(file!.effort).toBeUndefined()
    expect(file!.reasoning).toBeUndefined()
  })

  test("accepts each valid hint level", async () => {
    for (const level of ["low", "medium", "high"]) {
      const source = new InMemorySource({
        p: `---\nname: p\ndescription: d\neffort: ${level}\nreasoning: ${level}\n---\n`,
      })
      const file = await loadPersonaFromSource("p", source)
      expect(file!.effort).toBe(level as "low" | "medium" | "high")
      expect(file!.reasoning).toBe(level as "low" | "medium" | "high")
    }
  })

  test("listPersonasFromSource surfaces hints in refs", async () => {
    const source = new InMemorySource({
      hinted: `---\nname: hinted\ndescription: d\neffort: low\nreasoning: high\n---\n`,
    })
    const refs = await listPersonasFromSource(source)
    expect(refs[0]!.effort).toBe("low")
    expect(refs[0]!.reasoning).toBe("high")
  })
})

describe("listPersonasFromSource", () => {
  test("lists personas from any source", async () => {
    const source = new InMemorySource({
      alpha: `---\nname: alpha\ndescription: A\n---\n`,
      zebra: `---\nname: zebra\ndescription: Z\n---\n`,
    })
    const refs = await listPersonasFromSource(source)
    expect(refs.map((r) => r.name)).toEqual(["alpha", "zebra"])
  })

  test("skips records with missing required fields", async () => {
    const source = new InMemorySource({
      ok: `---\nname: ok\ndescription: ok\n---\n`,
      broken: `---\ndescription: no name\n---\n`,
    })
    const refs = await listPersonasFromSource(source)
    expect(refs.map((r) => r.name)).toEqual(["ok"])
  })

  test("layered source: unions and dedupes by name (live wins on read)", async () => {
    const seed = new InMemorySource({
      shared: `---\nname: shared\ndescription: Seed shared\n---\n`,
      seedOnly: `---\nname: seedOnly\ndescription: Seed only\n---\n`,
    })
    const live = new InMemorySource({
      shared: `---\nname: shared\ndescription: Live shared\n---\n`,
      liveOnly: `---\nname: liveOnly\ndescription: Live only\n---\n`,
    })
    const layered = new LayeredSource([live, seed])
    const refs = await listPersonasFromSource(layered)
    expect(refs.map((r) => r.name)).toEqual(["liveOnly", "seedOnly", "shared"])
    const sharedRef = refs.find((r) => r.name === "shared")!
    expect(sharedRef.description).toBe("Live shared")
  })
})
