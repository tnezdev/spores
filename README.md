# @tnezdev/spores

Executable toolbelt for agent self-improvement. Five in-loop primitives — memory, skills, workflow, tasks, and persona — with zero production dependencies, built for Bun.

## Install

```bash
npm install @tnezdev/spores
# or: bun add @tnezdev/spores
```

## Quick start

```bash
# Scaffold .spores/ directory in your project
spores init

# Store a memory
spores memory remember "always emit types from the public API" --tags style,api

# Load a skill
spores skill list
spores skill run release-check | llm

# Track a task
spores task add "update CHANGELOG before tagging"
spores task next

# Activate a persona (pipe into your LLM as system prompt)
spores persona list
spores persona activate spores-maintainer | llm --system -
```

## Primitives

| Primitive | What it does |
|-----------|-------------|
| **Memory** | Tiered store (L1/L2/L3) with recall, reinforce, and dream consolidation |
| **Skills** | Load `.md` skill files and pipe their content into an LLM |
| **Workflow** | Directed-graph runtime — register a graph, create runs, advance node state |
| **Tasks** | ULID-keyed task queue with status transitions and annotations |
| **Persona** | Activate a "hat" at the start of a turn: memory tags, skills, task filter, workflow, and a rendered body with live situational facts |

All five primitives read from `.spores/` in your project root, with optional global overrides from `~/.spores/`.

## Flags

```
--json          Output as JSON (machine-readable, no truncation)
--wide          Disable column truncation in list output
--base-dir      Override working directory
```

## Working example

The `.spores/` directory in this repo is the v0.1 dogfood — a persona, a skill, a workflow, tasks, and memories that are used to build spores itself. Read [`.spores/README.md`](.spores/README.md) for a tour.

## Architecture

See [AGENTS.md](AGENTS.md) for the full architecture, on-disk layout, and conventions for agent sessions.
