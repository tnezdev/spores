# .spores/ — dogfood example

This directory is the **v0.1 release-gate smoke test** (#10). If we can't use spores to build spores, v0.1 isn't ready to ship.

Every file here is exercised by the spores CLI itself. Think of it as both the self-use and the working example that ships with the repo.

## Contents

| Path | Primitive | What's in it |
|---|---|---|
| `config.toml` | (all) | Spores config — `adapter = "filesystem"`, dirs for each primitive |
| `personas/spores-maintainer.md` | persona | The hat to wear when working on this codebase. Real principles, real activation triggers, real situational tokens |
| `skills/release-check/skill.md` | skill | The pre-release checklist. Piped into the agent before cutting a new version |
| `workflows/spores-release.json` | workflow | 9-node release graph: verify-clean → run-tests → typecheck → dep-audit → pack-dry-run → version-bump → tag-push → publish → verify-published |
| `memory/*.json` | memory | Durable facts about this repo (npm package name, zero-deps rule, v0.1 runtime-scoping decision) |
| `tasks/*.json` | task | Real v0.1 tasks — dogfood verification, release cut, v0.2 composition design |
| `runs/` | workflow | Ephemeral per-run state. **gitignored.** |

## How to use

From the repo root:

```bash
# List what's available
bun src/cli/main.ts persona list
bun src/cli/main.ts skill list
bun src/cli/main.ts workflow list
bun src/cli/main.ts task list

# Activate the maintainer hat — pipe into your LLM of choice
bun src/cli/main.ts persona activate spores-maintainer

# Run the release check skill
bun src/cli/main.ts skill run release-check

# Pick up the next ready task
bun src/cli/main.ts task next

# Kick off a release run
bun src/cli/main.ts workflow run spores-release --name "0.1.0-cut"

# Query memories when you need the "why"
bun src/cli/main.ts memory recall "runtime scope"
```

(After `npm install -g @tnezdev/spores`, replace `bun src/cli/main.ts` with `spores`.)

## Why this shape

- **The persona reads like something a human would actually write for themselves.** Not a label, not a role — a set of non-negotiables and a "before you start" checklist. If it feels forced, the primitive isn't pulling its weight.
- **Skills are agent-facing work product.** `release-check` is not documentation *about* releasing — it's the actual pipeline an agent follows, with verification commands inline.
- **Memories are non-obvious durable facts**, not restatements of what `git log` already tells you. "Zero production dependencies is a hard rule" is worth remembering because the code alone doesn't say why.
- **Tasks are the real backlog**, not fake examples. The three seeded here are the literal next moves on the v0.1 milestone.
- **The workflow is a real process**, not a toy DAG. Every node corresponds to a command someone actually runs at release time.

## What this dogfood validated

- All four primitives (memory/workflow/skills/tasks) + persona compose cleanly in one directory layout
- `persona activate` template substitution works against live situational facts
- Adapter-layered project/global resolution is transparent (nothing in `~/.spores/` interferes)
- `task next` returns the highest-ULID (most recent) ready task — caller is responsible for narrowing with `task_filter` if they want a different ordering (descoped per #8 addendum, caller wires persona bindings manually)
- Zero production dependencies held throughout

## Runs are ephemeral

`.spores/runs/` is gitignored because each `workflow run` produces a new run record and committing those would add churn without meaning. If you want to reproduce a run, re-run the workflow — the graph is the durable artifact, the run is the execution.
