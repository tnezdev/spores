import { readFile } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import type { SituationalContext } from "../types.js"

interface NodeError extends Error {
  code?: string | undefined
}

function isNodeError(err: unknown): err is NodeError {
  return err instanceof Error
}

/**
 * Resolve the template file path. Relative paths resolve against baseDir.
 */
export function resolveTemplatePath(
  baseDir: string,
  configured?: string,
): string | undefined {
  if (configured === undefined) return undefined
  return isAbsolute(configured) ? configured : join(baseDir, configured)
}

/**
 * Read the template file. Returns undefined if not found.
 */
export async function readTemplate(
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

/**
 * Resolve a wake template by substituting static tokens and executing
 * shell expressions.
 *
 * Static tokens: {{cwd}}, {{hostname}}, {{timestamp}}, {{git_branch}}
 * Shell expressions: {{sh:command}} — executed with cwd set to baseDir
 *
 * Shell expressions run sequentially. A failed command (non-zero exit)
 * substitutes its stderr as the output so the agent sees the error.
 * Unknown {{word}} tokens are left literal (same as persona activation).
 */
export async function resolveTemplate(
  template: string,
  situational: SituationalContext,
  baseDir: string,
): Promise<string> {
  const staticTokens: Record<string, string> = {
    cwd: situational.cwd,
    timestamp: situational.timestamp,
    hostname: situational.hostname,
    git_branch: situational.git_branch ?? "",
  }

  // First pass: collect all {{sh:...}} expressions and their positions.
  // We process them sequentially to avoid spawning many processes at once.
  const shellPattern = /\{\{sh:(.+?)\}\}/g
  const shellMatches: Array<{ full: string; command: string }> = []
  let match: RegExpExecArray | null
  while ((match = shellPattern.exec(template)) !== null) {
    shellMatches.push({ full: match[0], command: match[1]! })
  }

  // Execute shell expressions and build a replacement map
  const shellResults = new Map<string, string>()
  for (const { full, command } of shellMatches) {
    if (shellResults.has(full)) continue // dedup identical expressions
    const result = await executeShell(command, baseDir)
    shellResults.set(full, result)
  }

  // Apply shell replacements
  let resolved = template
  for (const [token, value] of shellResults) {
    resolved = resolved.replaceAll(token, value)
  }

  // Apply static token replacements
  resolved = resolved.replace(/\{\{(\w+)\}\}/g, (m, key: string) => {
    if (key in staticTokens) return staticTokens[key]!
    return m // unknown token — leave literal
  })

  return resolved
}

/**
 * Resolve the spores binary invocation string. When running from source
 * (bun src/cli/main.ts), this returns "bun <path>". When running from
 * an installed binary, it returns the binary path directly.
 *
 * Injected as $SPORES_BIN into the shell environment so templates can
 * use `$SPORES_BIN persona list` even when `spores` isn't on PATH.
 */
function resolveSporesBin(): string {
  const entry = process.argv[1] ?? "spores"
  if (entry.endsWith(".ts")) return `bun ${entry}`
  return entry
}

async function executeShell(
  command: string,
  cwd: string,
): Promise<string> {
  try {
    const proc = Bun.spawn(["sh", "-c", command], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        SPORES_BIN: resolveSporesBin(),
      },
    })
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    if (exitCode !== 0) {
      return stderr.trim() || `(command failed with exit code ${exitCode})`
    }
    return stdout.trimEnd()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return `(shell error: ${message})`
  }
}
