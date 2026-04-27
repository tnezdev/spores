#!/usr/bin/env node
/**
 * Plain-JS smoke consumer — validates `@tnezdev/spores` is importable and
 * its public-API value exports are real functions/constructors. Same checks
 * as smoke-consumer.ts, but compiled-free so it runs identically under
 * Bun and Node.
 *
 * Usage: node scripts/smoke-consumer.mjs <consumer-dir>
 */

import { createRequire } from "node:module"

const consumerDir = process.argv[2]
if (!consumerDir) {
  console.error("Usage: smoke-consumer.mjs <consumer-dir>")
  process.exit(1)
}

const require = createRequire(`${consumerDir}/`)
const pkgName = "@tnezdev/spores"
const mod = await import(require.resolve(pkgName))

const errors = []
function check(name, condition) {
  if (!condition) errors.push(`  FAIL: ${name}`)
  else console.log(`  OK: ${name}`)
}

check("FilesystemAdapter is a constructor", typeof mod.FilesystemAdapter === "function")
check("FilesystemWorkflowAdapter is a constructor", typeof mod.FilesystemWorkflowAdapter === "function")
check("FilesystemTaskAdapter is a constructor", typeof mod.FilesystemTaskAdapter === "function")
check("FilesystemPersonaAdapter is a constructor", typeof mod.FilesystemPersonaAdapter === "function")
check("Runtime is a constructor", typeof mod.Runtime === "function")
check("expandGraph is a function", typeof mod.expandGraph === "function")
check("findEntryNodes is a function", typeof mod.findEntryNodes === "function")
check("findTerminalNodes is a function", typeof mod.findTerminalNodes === "function")
check("loadConfig is a function", typeof mod.loadConfig === "function")
check("listSkills is a function", typeof mod.listSkills === "function")
check("loadSkill is a function", typeof mod.loadSkill === "function")
check("listPersonas is a function", typeof mod.listPersonas === "function")
check("loadPersona is a function", typeof mod.loadPersona === "function")
check("activatePersona is a function", typeof mod.activatePersona === "function")
check("resolveSituational is a function", typeof mod.resolveSituational === "function")
check("fireHook is a function", typeof mod.fireHook === "function")

// New in 0.4.0+
check("InMemorySource is a constructor", typeof mod.InMemorySource === "function")
check("FlatFileSource is a constructor", typeof mod.FlatFileSource === "function")
check("NestedFileSource is a constructor", typeof mod.NestedFileSource === "function")
check("LayeredSource is a constructor", typeof mod.LayeredSource === "function")
check("loadPersonaFromSource is a function", typeof mod.loadPersonaFromSource === "function")
check("loadSkillFromSource is a function", typeof mod.loadSkillFromSource === "function")
check("loadGraphFromSource is a function", typeof mod.loadGraphFromSource === "function")
check("matchDispatch is a function", typeof mod.matchDispatch === "function")

if (errors.length > 0) {
  console.error("\nSmoke test failed:")
  for (const e of errors) console.error(e)
  process.exit(1)
}
