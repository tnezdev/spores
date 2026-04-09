# AGENTS.md — SPORES

Orientation for agent sessions. Concise. Read before touching code.

## Start here

This repo dogfoods its own toolbelt. Before touching code, run the three-command on-ramp in [`.spores/ONRAMP.md`](.spores/ONRAMP.md) — it activates the `spores-maintainer` persona, pulls the top ready task, and points you at the release skill. The rest of this file is reference; ONRAMP.md is the path.

## What is SPORES?

A TypeScript library + CLI for agent in-loop primitives. Four things, focused by a fifth:

1. **Memory** — remember/recall/dream with L1/L2/L3 tiers
2. **Skills** — load and run skill.md files from `.spores/skills/`
3. **Workflow** — digraph runtime (GraphDef → Run → Transitions, state derived from history)
4. **Tasks** — typed adapter interface (ULID IDs, Taskwarrior-shaped)
5. **Persona** — activate a hat at the start of a turn: metadata (memory_tags, skills, task_filter, workflow) + a rendered body with live situational facts. Declarative attention, not enforced scope.

MVP scope = what an agent reaches for *inside a single turn*. No hosting, no webhooks, no session layer — those are daemon-level concerns. **Identity lives outside spores** — in the run orchestration layer. Spores provides the hat; the caller provides who's wearing it.

## Tech stack

- TypeScript on Bun. No build step. `bun run <file>` directly.
- Zero production dependencies (`"dependencies": {}` in package.json)
- Hand-rolled TOML parser in `config.ts`
- Custom arg parser in `src/cli/main.ts` — no CLI framework

## Commands

```bash
bun test          # run all tests
bun run typecheck # tsc --noEmit
```

## Architecture

### Types first

All shared types live in `src/types.ts`. Add types there before writing implementations.

### Adapter pattern

Every primitive has an interface in `src/<module>/adapter.ts`. Filesystem implementations are the default (and currently only) adapters. Future storage backends implement the same interface.

| Module | Interface | Implementation |
|--------|-----------|----------------|
| memory | implicit in filesystem.ts | `src/memory/filesystem.ts` |
| workflow | `WorkflowAdapter` | `src/workflow/filesystem.ts` |
| tasks | `TaskAdapter` | `src/tasks/adapter.ts` (stub only) |
| personas | `PersonaAdapter` | `src/personas/filesystem.ts` |

### CLI: two-word dispatch

```
spores <noun> <verb> [args]
```

Commands in `src/cli/commands/<noun>.ts`. Each command is a `Command` function exported as `<noun><Verb>Command`. The dispatch table is in `src/cli/main.ts`.

Current command surface:
- `spores init` — scaffold `.spores/` config
- `spores memory remember/recall/forget/dream/reinforce`
- `spores skill list/show/run`
- `spores workflow list/show/run/status`
- `spores persona list/view/activate`

### Skills on disk

```
~/.spores/skills/<name>/skill.md     # global (user-level)
.spores/skills/<name>/skill.md       # project-level (wins on name conflict)
```

Frontmatter: `name`, `description`, `tags: [a, b, c]`
Body: the skill content returned by `skill run` (pipe to an LLM).

### Personas on disk

```
~/.spores/personas/<name>.md         # global (user-level)
.spores/personas/<name>.md           # project-level (wins on name conflict)
```

Flat-file layout (unlike skills which use a directory per skill). Frontmatter: `name`, `description`, `memory_tags: [...]`, `skills: [...]`, optional `task_filter: { tags: [...], status: ready }` (nested, one level deep), optional `workflow: <graph-id>`. Body is markdown with `{{cwd}}`, `{{timestamp}}`, `{{hostname}}`, `{{git_branch}}` tokens that get substituted at `persona activate` time.

**`view` vs `activate`** is load-bearing: `view` prints the raw file with literal tokens (for humans editing or reviewing); `activate` substitutes live situational facts (for piping into an LLM). Don't let them produce identical output.

**One hat at a time.** Personas don't compose, stack, or inherit. To pivot, deactivate one and activate another. Runtime integration for applying persona bindings (using `memory_tags` as a recall filter, etc.) is **the caller's responsibility** — spores ships the metadata, the caller wires it. Descoped from v0.1 intentionally; expected to land after we have more signal from actual use.

### Config resolution (three-tier)

1. Hardcoded defaults in `config.ts`
2. `~/.spores/config.toml` — user-level overrides
3. `.spores/config.toml` — project-level overrides (wins)

### Workflow runtime

- `GraphDef` defines a digraph (nodes + edges with conditions)
- `expandGraph` flattens nested subgraphs at register time — nesting is free
- `Runtime` is a **state machine only** — it derives current state from `Run.history` (no `current_node` field). It does NOT schedule or evaluate `EvaluatorRef` conditions — that's the caller's job.
- State is immutable: each transition appends to `history`

### SporesUri

`spores://` is a reserved URI scheme for SPORES-owned compute. Branded type `SporesUri = \`spores://\${string}\`` in `types.ts`. Referenced from skill bodies, dispatched by the host runtime (e.g. Beacon).

## Conventions

- Test files colocated: `src/memory/filesystem.test.ts` next to `src/memory/filesystem.ts`
- Test fixtures: inline (no separate fixtures dir)
- IDs: ULIDs via monotonic factory (see tasks types)
- Error handling: functions throw on unexpected errors; return `undefined` for "not found" cases (e.g. `loadSkill` returns `undefined` when skill doesn't exist)
- No `console.log` in library code — CLI output goes through `output(ctx, data, formatter)` in `src/cli/main.ts`
- **Descriptions are agent-facing activation triggers, not labels.** For both skills and personas, phrase `description` as "Activate when..." rather than "The X maintainer". `list` output is meant to function as a lookup table an agent scans to decide what to reach for — good triggers make the scan useful.

## What NOT to add

- Sessions, webhooks, hosting — daemon-layer, not SPORES
- Any adapter implementation for tasks until the interface is settled
- Dependencies — keep `"dependencies": {}` clean
- Per-module adapter interfaces for memory (memory follows the filesystem.ts shape directly, no separate adapter.ts)
