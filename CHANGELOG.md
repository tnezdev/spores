# Changelog

All notable changes to `@tnezdev/spores`. Format follows [Keep a Changelog](https://keepachangelog.com/). Versioning follows [semver](https://semver.org/).

## 0.1.0 — 2026-04-09

First published release. **Coherent primitives MVP** — five in-loop primitives that an agent reaches for during a single turn, composable via a persona but with no enforced composition layer yet.

### Added

- **Memory** — `FilesystemAdapter` with three-tier (L1/L2/L3) recall, `remember` / `recall` / `reinforce` / `dream` / `forget` CLI surface.
- **Workflow** — digraph runtime. `GraphDef` → `Run` → `Transition` state machine where current state is *derived* from `Run.history`. Nested subgraphs expand at register time. `Runtime` is state-only — callers own scheduling and evaluator evaluation. CLI: `workflow create / list / show / run / status / next / start / done / fail / history`.
- **Skills** — `listSkills` / `loadSkill` over `~/.spores/skills/<name>/skill.md` and `.spores/skills/<name>/skill.md`, project-wins layered resolution. CLI: `skill list / show / run`. Skill bodies are pipe-to-LLM content.
- **Tasks** — `TaskAdapter` interface + `FilesystemTaskAdapter`. Seven verbs: `createTask`, `listTasks`, `nextReadyTask`, `getTask`, `updateTaskStatus`, `annotateTask`. ULID IDs via monotonic factory. Status transitions auto-annotate. `wait_until` is passive skip only (no active waking). CLI: `task add / list / next / show / done / annotate`.
- **Persona** — `PersonaAdapter` + `FilesystemPersonaAdapter` with layered project/global resolution at `.spores/personas/<name>.md`. `activatePersona()` is a pure function that substitutes `{{cwd}}` / `{{timestamp}}` / `{{hostname}}` / `{{git_branch}}` tokens against a live `SituationalContext`. CLI: `persona list / view / activate`. `view` shows the raw file; `activate` renders with situational substitution — the distinction is load-bearing.
- **Dogfood** — `.spores/` directory in the repo itself (not shipped in the npm package) exercises every primitive end-to-end with real content: a `spores-maintainer` persona, a release-check skill, a release workflow graph, seeded memories about the repo, and real v0.1 backlog tasks.

### Design principles (stable across v0.x)

- **Zero production dependencies.** `package.json` ships with an empty-by-convention `dependencies` field. Hand-rolled TOML parser, custom arg parser, no CLI framework.
- **Types first.** All shared types live in `src/types.ts`.
- **Adapter pattern.** Every primitive has a typed interface; filesystem implementations are the default. Future storage backends implement the same shape.
- **No `console.log` in library code.** CLI output routes through `output(ctx, data, formatter)` for JSON/human switching.
- **Identity lives outside spores.** No `observed_by`, no `created_by`, no `--identity` flag, no `SPORES_IDENTITY` env. Attribution is the outer run-orchestration layer's concern.

### Intentionally descoped (deferred to 0.2+)

- **Runtime composition object.** `Runtime` is workflow-only in 0.1. Applying persona bindings (`memory_tags` as default recall filter, `task_filter` as default task query, `skills` as foregrounded toolbelt, `workflow` as default graph) is the **caller's responsibility**. A top-level composition object (whether a grown `Runtime`, a new `Scope`, or a `Spores` class) is deferred until we have more signal from real usage.
- **Recurrence scheduler.** `Task.recurrence` field exists but has no runtime. Field is stable; semantics pending.
- **Active `wait_until` waking.** `nextReadyTask` skips tasks whose `wait_until` hasn't elapsed. No timers, no cron.
- **SQLite / remote adapters.** Filesystem only for 0.1.
- **Dynamic persona context.** Only four static situational tokens in 0.1 — no command execution, no API calls, no plugins.
- **Persona composition / stacking / inheritance.** One hat at a time.
