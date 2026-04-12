#!/usr/bin/env bun

import { loadConfig } from "../config.js"
import { FilesystemAdapter } from "../memory/filesystem.js"
import type { Ctx, Command } from "./context.js"
export type { Ctx, Command } from "./context.js"
export { output } from "./output.js"
import { initCommand } from "./commands/init.js"
import {
  rememberCommand,
  recallCommand,
  reinforceCommand,
  dreamCommand,
  forgetCommand,
} from "./commands/memory.js"
import {
  workflowCreateCommand,
  workflowListCommand,
  workflowShowCommand,
  workflowRunCommand,
  workflowStatusCommand,
  workflowNextCommand,
  workflowStartCommand,
  workflowDoneCommand,
  workflowFailCommand,
  workflowHistoryCommand,
} from "./commands/workflow.js"
import {
  skillListCommand,
  skillShowCommand,
  skillRunCommand,
} from "./commands/skill.js"
import {
  taskAddCommand,
  taskListCommand,
  taskNextCommand,
  taskStartCommand,
  taskShowCommand,
  taskDoneCommand,
  taskAnnotateCommand,
} from "./commands/task.js"
import {
  personaListCommand,
  personaViewCommand,
  personaActivateCommand,
} from "./commands/persona.js"
import { wakeCommand } from "./commands/wake.js"

type Parsed = {
  positional: string[]
  flags: Record<string, string | true>
}

const BOOLEAN_FLAGS = new Set(["json", "dry-run", "help", "wide"])

function parseArgs(argv: string[]): Parsed {
  const positional: string[] = []
  const flags: Record<string, string | true> = {}

  let i = 0
  while (i < argv.length) {
    const arg = argv[i]!
    if (arg.startsWith("--")) {
      const name = arg.slice(2)
      if (BOOLEAN_FLAGS.has(name)) {
        flags[name] = true
      } else {
        const next = argv[i + 1]
        if (next !== undefined && !next.startsWith("--")) {
          flags[name] = next
          i++
        } else {
          flags[name] = true
        }
      }
    } else {
      positional.push(arg)
    }
    i++
  }

  return { positional, flags }
}

const commands: Record<string, Command> = {
  init: initCommand,
  "memory remember": rememberCommand,
  "memory recall": recallCommand,
  "memory reinforce": reinforceCommand,
  "memory dream": dreamCommand,
  "memory forget": forgetCommand,
  "workflow create": workflowCreateCommand,
  "workflow list": workflowListCommand,
  "workflow show": workflowShowCommand,
  "workflow run": workflowRunCommand,
  "workflow status": workflowStatusCommand,
  "workflow next": workflowNextCommand,
  "workflow start": workflowStartCommand,
  "workflow done": workflowDoneCommand,
  "workflow fail": workflowFailCommand,
  "workflow history": workflowHistoryCommand,
  "skill list": skillListCommand,
  "skill show": skillShowCommand,
  "skill run": skillRunCommand,
  "task add": taskAddCommand,
  "task list": taskListCommand,
  "task next": taskNextCommand,
  "task start": taskStartCommand,
  "task show": taskShowCommand,
  "task done": taskDoneCommand,
  "task annotate": taskAnnotateCommand,
  "persona list": personaListCommand,
  "persona view": personaViewCommand,
  "persona activate": personaActivateCommand,
  wake: wakeCommand,
}

const USAGE = `Usage: spores <command> [args] [flags]

Commands:
  init                                Scaffold .spores/ directory

  memory remember <content>           Store a new memory
  memory recall [query]               Query memories
  memory reinforce <key>              Strengthen a memory
  memory dream                        Run consolidation cycle
  memory forget <key>                 Remove a memory

  workflow create <file.json>         Register a graph from JSON
  workflow list                       List registered graphs
  workflow show <graph-id>            Show graph details
  workflow run <graph-id>             Create a new run
  workflow status <run-id>            Show node states for a run
  workflow next <run-id>              Show available nodes
  workflow start <run-id> <node>      Start a node (-> in_progress)
  workflow done <run-id> <node>       Complete a node
  workflow fail <run-id> <node>       Fail a node
  workflow history <run-id>           Show transition history

  skill list                          List available skills
  skill show <name>                   Show skill details and content
  skill run <name>                    Output skill prompt (pipe to LLM)

  task add <description>              Create a new ready task
  task list                           List tasks (filter with flags)
  task next                           Show the next ready task
  task start <id>                     Start a task (-> in_progress)
  task show <id>                      Show task details + annotations
  task done <id>                      Mark a task done
  task annotate <id> <text>           Append an annotation to a task

  persona list                        List available personas
  persona view <name>                 Show raw persona (no substitution)
  persona activate <name>             Render persona with live facts (pipe to LLM)

  wake                                Session bootstrap — identity, environment, personas

Flags:
  --json                              Output as JSON
  --wide                              Disable column truncation in list output
  --base-dir <path>                   Override working directory
  --identity <name>                   Override identity for transitions
  --reason <text>                     Reason for done/fail transitions
  --name <text>                       Name for a new run`

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2))

  if (flags["help"] === true || positional.length === 0) {
    console.log(USAGE)
    process.exit(0)
  }

  const baseDir =
    typeof flags["base-dir"] === "string" ? flags["base-dir"] : process.cwd()
  const json = flags["json"] === true
  const wide = flags["wide"] === true
  const config = await loadConfig(baseDir)
  const adapter = new FilesystemAdapter(baseDir)
  const ctx: Ctx = { adapter, config, baseDir, json, wide }

  const twoWord = `${positional[0]} ${positional[1]}`
  const oneWord = positional[0]!

  let cmd: Command | undefined
  let cmdArgs: string[]

  if (commands[twoWord] !== undefined) {
    cmd = commands[twoWord]
    cmdArgs = positional.slice(2)
  } else if (commands[oneWord] !== undefined) {
    cmd = commands[oneWord]
    cmdArgs = positional.slice(1)
  } else {
    console.error(`Unknown command: ${positional.join(" ")}`)
    console.error(USAGE)
    process.exit(1)
  }

  try {
    await cmd!(ctx, cmdArgs, flags)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    if (json) {
      console.log(JSON.stringify({ error: message }))
    } else {
      console.error(`Error: ${message}`)
    }
    process.exit(1)
  }
}

main()
