import { readFile } from "node:fs/promises"
import { hostname } from "node:os"
import { join } from "node:path"
import type { SituationalContext } from "../types.js"

interface NodeError extends Error {
  code?: string | undefined
}

function isNodeError(err: unknown): err is NodeError {
  return err instanceof Error
}

/**
 * Read the current git branch from `.git/HEAD` in the given directory.
 * Returns undefined if the directory is not a git repo or is in a
 * detached-HEAD state.
 */
async function readGitBranch(baseDir: string): Promise<string | undefined> {
  try {
    const head = await readFile(join(baseDir, ".git", "HEAD"), "utf-8")
    const match = head.trim().match(/^ref:\s*refs\/heads\/(.+)$/)
    return match ? match[1] : undefined
  } catch (err) {
    if (isNodeError(err) && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
      return undefined
    }
    throw err
  }
}

/**
 * Resolve the situational context for persona activation from the current
 * process state. `baseDir` is the working directory — usually `process.cwd()`
 * but overridable for testing and for CLI `--base-dir`.
 */
export async function resolveSituational(
  baseDir: string,
): Promise<SituationalContext> {
  const git_branch = await readGitBranch(baseDir)
  return {
    cwd: baseDir,
    timestamp: new Date().toISOString(),
    hostname: hostname(),
    git_branch,
  }
}
