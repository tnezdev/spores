/**
 * Smoke-test consumer script.
 *
 * Runs inside a temp directory where @tnezdev/spores has been installed
 * from the npm-pack tarball. Validates that value exports are importable
 * and constructable under Bun.
 *
 * Usage: bun run scripts/smoke-consumer.ts <consumer-dir>
 */

const consumerDir = process.argv[2]
if (!consumerDir) {
  console.error("Usage: bun run smoke-consumer.ts <consumer-dir>")
  process.exit(1)
}

// Resolve the installed package from the consumer's node_modules
const pkgPath = `${consumerDir}/node_modules/@tnezdev/spores/src/index.ts`

const mod = await import(pkgPath)

const errors: string[] = []

function check(name: string, condition: boolean) {
  if (!condition) {
    errors.push(`  FAIL: ${name}`)
  } else {
    console.log(`  OK: ${name}`)
  }
}

// --- Value exports (these must be real, not just types) ---

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

if (errors.length > 0) {
  console.error("\nSmoke test failed:")
  for (const e of errors) console.error(e)
  process.exit(1)
}
