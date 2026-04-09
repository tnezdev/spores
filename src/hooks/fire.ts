import { existsSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { HookInvocation } from "../types.js"

/**
 * Fire a spores primitive event. Events are named `<primitive>.<verb>`
 * (e.g. `persona.activated`, `task.done`). Event firing is synchronous,
 * in-process, and happens *after* the primary verb's effect has been
 * written — the hook cannot prevent or alter the verb's outcome.
 *
 * Hook lookup (first match wins):
 *   1. `$SPORES_HOOKS_DIR/<event>` — test override; if set, nothing else is consulted
 *   2. `<baseDir>/.spores/hooks/<event>` — project-level
 *   3. `~/.spores/hooks/<event>` — user-level
 *
 * A hook is considered present only if the file exists AND has at least
 * one executable bit set (owner/group/other). Presence without the exec
 * bit is treated as "not a hook" — avoids accidentally running editor
 * scratch files or templates.
 *
 * Design rationale + event catalog: tnezdev/spores#26
 * Minimum experiment (this verb only): tnezdev/spores#27
 */

const TIMEOUT_MS = 5000

function userHome(): string {
  return process.env["HOME"] ?? homedir()
}

function hookDirs(baseDir: string): string[] {
  const override = process.env["SPORES_HOOKS_DIR"]
  if (override !== undefined && override !== "") return [override]
  return [
    join(baseDir, ".spores", "hooks"),
    join(userHome(), ".spores", "hooks"),
  ]
}

function isExecutableFile(path: string): boolean {
  try {
    const s = statSync(path)
    if (!s.isFile()) return false
    return (s.mode & 0o111) !== 0
  } catch {
    return false
  }
}

function resolveHook(event: string, baseDir: string): string | undefined {
  for (const dir of hookDirs(baseDir)) {
    const candidate = join(dir, event)
    if (existsSync(candidate) && isExecutableFile(candidate)) return candidate
  }
  return undefined
}

/**
 * Fire the named event. If no hook is present, returns a quiet no-op result
 * (`ran: false`). If a hook is present, it is executed with the provided env
 * vars merged into the current process env, plus an injected `SPORES_EVENT`
 * and (if not already set) a `SPORES_BIN` pointing at the current CLI entry.
 *
 * Hooks run with a 5-second timeout. Timeouts and non-zero exits are surfaced
 * via the `error` / `exit_code` fields on the result — they are not thrown.
 * Callers decide how to present warnings to the user.
 */
export async function fireHook(
  event: string,
  env: Record<string, string>,
  baseDir: string,
): Promise<HookInvocation> {
  const script = resolveHook(event, baseDir)
  if (script === undefined) {
    return {
      event,
      ran: false,
      stdout: "",
      stderr: "",
      exit_code: null,
    }
  }

  const fullEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...env,
    SPORES_EVENT: event,
  }

  if (fullEnv["SPORES_BIN"] === undefined || fullEnv["SPORES_BIN"] === "") {
    fullEnv["SPORES_BIN"] = process.argv[1] ?? "spores"
  }

  try {
    const proc = Bun.spawn([script], {
      env: fullEnv,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    })

    // Race the hook's exit against a timer. On timeout we kill the process
    // but do NOT await further cleanup — children (e.g. a `sleep` inside a
    // shell script) may outlive the parent's signal handling and keep the
    // pipes open, which would hang `proc.exited` and `Response.text()`.
    // The contract is: hooks either finish in time or they lose the result
    // window. The OS can clean up stragglers.
    //
    // CRITICAL: capture the timer handle and clearTimeout on the winning
    // path. An un-cleared pending timer keeps Bun's event loop alive and
    // prevents the caller's process from exiting — manifests as "spores
    // command hangs" when spores is itself spawned as a subprocess
    // (terminals mask it via tty/exec semantics; Bun.spawn exposes it).
    const TIMEOUT_SENTINEL: unique symbol = Symbol("hook-timeout") as never
    type Winner = number | typeof TIMEOUT_SENTINEL
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise: Promise<Winner> = new Promise((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT_SENTINEL), TIMEOUT_MS)
    })

    const winner = await Promise.race<Winner>([proc.exited, timeoutPromise])
    if (timer !== undefined) clearTimeout(timer)

    if (winner === TIMEOUT_SENTINEL) {
      try {
        proc.kill()
      } catch {
        // Process may have already exited.
      }
      return {
        event,
        ran: true,
        stdout: "",
        stderr: "",
        exit_code: null,
        error: `hook timed out after ${TIMEOUT_MS}ms`,
      }
    }

    const exitCode = winner
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])

    return {
      event,
      ran: true,
      stdout,
      stderr,
      exit_code: exitCode,
    }
  } catch (err) {
    return {
      event,
      ran: true,
      stdout: "",
      stderr: "",
      exit_code: null,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
