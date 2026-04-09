import { describe, expect, test } from "bun:test"
import { activatePersona } from "./activate.js"
import type { PersonaFile, SituationalContext } from "../types.js"

function makeFile(body: string): PersonaFile {
  return {
    name: "test",
    description: "Activate when testing",
    memory_tags: ["test"],
    skills: [],
    body,
    path: "/tmp/test.md",
  }
}

const situational: SituationalContext = {
  cwd: "/Users/dottie/Code/spores",
  timestamp: "2026-04-09T12:00:00.000Z",
  hostname: "heimdall",
  git_branch: "main",
}

describe("activatePersona", () => {
  test("substitutes all four known tokens", () => {
    const file = makeFile(
      "cwd={{cwd}} time={{timestamp}} host={{hostname}} branch={{git_branch}}",
    )
    const persona = activatePersona(file, situational)
    expect(persona.body).toBe(
      "cwd=/Users/dottie/Code/spores time=2026-04-09T12:00:00.000Z host=heimdall branch=main",
    )
  })

  test("substitutes tokens that appear multiple times", () => {
    const file = makeFile("{{cwd}} then {{cwd}} again")
    const persona = activatePersona(file, situational)
    expect(persona.body).toBe(
      "/Users/dottie/Code/spores then /Users/dottie/Code/spores again",
    )
  })

  test("leaves unknown tokens literal", () => {
    const file = makeFile("known={{cwd}} unknown={{open_prs}}")
    const persona = activatePersona(file, situational)
    expect(persona.body).toBe(
      "known=/Users/dottie/Code/spores unknown={{open_prs}}",
    )
  })

  test("substitutes missing git_branch with empty string", () => {
    const file = makeFile("branch=[{{git_branch}}]")
    const persona = activatePersona(file, {
      ...situational,
      git_branch: undefined,
    })
    expect(persona.body).toBe("branch=[]")
  })

  test("preserves all PersonaRef metadata on the activated persona", () => {
    const file: PersonaFile = {
      name: "spores-maintainer",
      description: "Activate when working on spores",
      memory_tags: ["spores", "npm"],
      skills: ["release", "changelog"],
      task_filter: { tags: ["spores"] },
      workflow: "spores-triage",
      body: "hello {{cwd}}",
      path: "/tmp/spores-maintainer.md",
    }
    const persona = activatePersona(file, situational)
    expect(persona.name).toBe("spores-maintainer")
    expect(persona.description).toBe("Activate when working on spores")
    expect(persona.memory_tags).toEqual(["spores", "npm"])
    expect(persona.skills).toEqual(["release", "changelog"])
    expect(persona.task_filter).toEqual({ tags: ["spores"] })
    expect(persona.workflow).toBe("spores-triage")
    expect(persona.path).toBe("/tmp/spores-maintainer.md")
    expect(persona.situational).toEqual(situational)
    expect(persona.body).toBe("hello /Users/dottie/Code/spores")
  })

  test("returns body unchanged when no tokens present", () => {
    const file = makeFile("no tokens at all, just prose")
    const persona = activatePersona(file, situational)
    expect(persona.body).toBe("no tokens at all, just prose")
  })

  test("does not match partial or malformed token syntax", () => {
    const file = makeFile("{cwd} {{ cwd }} {{cwd")
    const persona = activatePersona(file, situational)
    // `{cwd}` and `{{cwd` shouldn't match; `{{ cwd }}` has spaces so \w+ won't match
    expect(persona.body).toBe("{cwd} {{ cwd }} {{cwd")
  })
})
