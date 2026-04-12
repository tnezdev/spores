import { readFile } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import { fireHook } from "../../hooks/fire.js"
import { listPersonas } from "../../personas/filesystem.js"
import { resolveSituational } from "../../personas/situational.js"
import type { WakeOutput } from "../../types.js"
import { formatWake } from "../format.js"
import type { Command } from "../main.js"
import { output } from "../main.js"

interface NodeError extends Error {
  code?: string | undefined
}

function isNodeError(err: unknown): err is NodeError {
  return err instanceof Error
}

/**
 * Resolve the identity file path. If the configured path is relative, resolve
 * it against baseDir. Returns undefined if no identity is configured.
 */
function resolveIdentityPath(
  baseDir: string,
  configured?: string,
): string | undefined {
  if (configured === undefined) return undefined
  return isAbsolute(configured) ? configured : join(baseDir, configured)
}

async function readIdentity(
  path: string | undefined,
): Promise<string | undefined> {
  if (path === undefined) return undefined
  try {
    return await readFile(path, "utf-8")
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") return undefined
    throw err
  }
}

export const wakeCommand: Command = async (ctx, _args, _flags) => {
  const identityPath = resolveIdentityPath(
    ctx.baseDir,
    ctx.config.wake.identity,
  )
  const [identity, situational, personas] = await Promise.all([
    readIdentity(identityPath),
    resolveSituational(ctx.baseDir),
    listPersonas(ctx.baseDir),
  ])

  const hook = await fireHook(
    "wake.completed",
    {
      SPORES_WAKE_IDENTITY: identityPath ?? "",
      SPORES_WAKE_PERSONA_COUNT: String(personas.length),
    },
    ctx.baseDir,
  )

  const result: WakeOutput = {
    identity,
    identity_path: identityPath,
    situational,
    personas,
    hook: hook.ran ? hook : undefined,
  }
  output(ctx, result, formatWake)

  if (hook.ran) {
    if (hook.stderr.length > 0) {
      process.stderr.write(hook.stderr)
    }
    if (hook.error !== undefined) {
      process.stderr.write(`[hook warning] wake.completed: ${hook.error}\n`)
    } else if (hook.exit_code !== null && hook.exit_code !== 0) {
      process.stderr.write(
        `[hook warning] wake.completed exited ${hook.exit_code}\n`,
      )
    }
  }
}
