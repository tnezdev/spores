# Changelog

All notable changes to `@tnezdev/spores`. Format follows [Keep a Changelog](https://keepachangelog.com/). Versioning follows [semver](https://semver.org/).

## 0.4.1 — 2026-04-27

The Workers/Node release. Lifts the Bun-only constraint and ships three new `Source` implementations covering the storage backends Cloudflare Workers consumers need.

### Added

- **Node + V8-isolate consumption.** `tsc` build pipeline emits compiled `.js` + `.d.ts` to `dist/` on every pack. Node, Cloudflare Workers, Vercel Edge, and any other non-Bun runtime can now consume `@tnezdev/spores` from npm directly. Bun consumers are unaffected — the package entry resolves to the same compiled output. (closes #32)
- **`HttpSource`** — universal `fetch`-based source. Auth-agnostic (callers inject custom fetcher for SigV4 / bearer tokens / etc.). Optional `listFromIndex` callback for upstreams that expose enumeration.
- **`R2BucketSource`** — Cloudflare R2 binding wrapper. In-process reads inside Workers, automatic cursor pagination on `list()`. For external-to-Workers consumers, prefer `HttpSource` with an S3-compatible signed fetcher.
- **`KvSource`** — Cloudflare KV namespace binding wrapper. Cursor pagination via `list_complete`. Default empty `ext` (KV doesn't have file extensions natively).

### Changed

- Bun + Node smoke tests now run in CI on every PR (previously only on publish).
- `prepack` script auto-builds before `npm pack` — packing always ships fresh `dist/`.
- `scripts/smoke-consumer.mjs` replaces `smoke-consumer.ts` — plain JS runs identically under both Bun and Node.

### Notes

- The CLI bin entry (`bin: ./src/cli/main.ts`) remains Bun-only. CLI changes are out of scope; library consumption is the priority.
- `fireHook` and `wake/resolve` internally use `Bun.spawn`. The modules import cleanly on Node, but invoking these specific functions on Node fails at runtime. Migration to `node:child_process` is deferred — Workers can't run child processes regardless of API choice.
- Compass on Workers: `FlatFileSource` and `NestedFileSource` (which use `node:fs`) won't work; use `R2BucketSource` / `KvSource` / `HttpSource` instead. Pure pieces (`InMemorySource`, `LayeredSource`, `matchDispatch`, `activatePersona`, parsers, all types) port cleanly.

## 0.4.0 — 2026-04-27

The boundary-work release. Compass and other remote runtimes can now load every config-style primitive from any storage backend, and Dispatch foundation types pin the universal inbound message shape. All additions are backward-compatible.

### Added

- **`Source` abstraction** for pluggable, read-only loading of config primitives. Interface: `read(name) → SourceRecord | undefined` + `list() → string[]`. Reference implementations:
  - `FlatFileSource(dir, ext)` — `<dir>/<name><ext>` layouts (personas, workflow graphs)
  - `NestedFileSource(dir, filename)` — `<dir>/<name>/<filename>` layouts (skills)
  - `InMemorySource(records, tag)` — for tests and bake-in seed templates
  - `LayeredSource([liveSource, seedSource])` — first-wins read, union-dedupe list (the seed-then-emerge primitive)
- **Source-based loaders** for every file-style primitive:
  - `loadPersonaFromSource` / `listPersonasFromSource`
  - `loadSkillFromSource` / `listSkillsFromSource`
  - `loadGraphFromSource` / `listGraphsFromSource`
  - Existing convenience APIs (`loadPersona(name, baseDir)`, `loadSkill`, `FilesystemWorkflowAdapter`) unchanged — they delegate through the new abstraction.
- **Routing-hint frontmatter on personas.** Two optional fields, each `"low" | "medium" | "high"`:
  - `effort` — hint for compute/cost tier
  - `reasoning` — hint for thinking-depth tier
  - Personas express what they want; the routing layer (caller) decides which model. Personas never name models directly — capability-shaping fields belong outside the editable surface.
  - Surfaced as `SPORES_PERSONA_EFFORT` / `SPORES_PERSONA_REASONING` env vars on the `persona.activated` hook.
- **Dispatch foundation** — types and pure match logic for the universal inbound message primitive:
  - `Dispatch`, `DispatchFilter`, `DispatchHandlerHooks`, `DispatchId` types
  - `matchDispatch(dispatch, filter)` — pure predicate function over `from` / `to`
  - Filter semantics: undefined = no constraint; string = exact match; array = one-of; empty filter `{}` matches all.
  - Spores ships the message shape and pure match logic; runtimes ship transport, scheduling, and handler execution.

### Changed

- `activatePersona()` now spreads `...file` to render the rendered persona — forward-compatible for any future `PersonaRef` field. (Fixes a gap in 0.3.x where new optional fields didn't reach the rendered `Persona`.)
- Skills filesystem loader gains HOME-aware global dir resolution to match personas. Unblocks project-vs-global override tests that were previously untestable.

### Notes

- Dispatch foundation is intentionally minimal. The full primitive (send/handle/cancel verbs, ID generation, registry helpers, file-config loader for declared recurring sends) lands when concrete consumer friction informs the shape.
- Data-store primitives (Memory, Tasks, future Artifacts) remain on their own adapter shapes — `Source` is for config, not data.
- Design context for the loader and Dispatch shapes lives in `PROJECTS/spores/DESIGN-runtime-description.md` (W18 + W18-later overlays).

## 0.2.0 — 2026-04-10

### Added

- **Hook system** — fire-and-observe events from every spores primitive. Hooks are executable scripts at `.spores/hooks/<event>` (project) or `~/.spores/hooks/<event>` (user), resolved first-match-wins with exec-bit gating. 5-second timeout with race-and-kill semantics. Eight event categories shipped:
  - `persona.activated` — fires after persona activation
  - `skill.invoked` — fires after skill run
  - `memory.remembered`, `memory.recalled`, `memory.reinforced`, `memory.dreamed`, `memory.forgotten` — fires after each memory verb
  - `task.added`, `task.started`, `task.annotated`, `task.done` — fires after each task verb
  - `workflow.run.started`, `workflow.run.transitioned`, `workflow.run.terminated` — fires after workflow state changes
- **`fireHook` public API** — exported from `src/index.ts` alongside the `HookInvocation` type, so consumers (e.g. Beacon) can fire hooks from their own runtimes.
- **Pre-publish smoke test** — `scripts/smoke-test.sh` packs the tarball, installs it in a temp directory, and verifies all public API exports are importable under Bun. Runs in CI between tests and publish.
- **`smoke-test` skill** — documents and surfaces the smoke test for manual use.

### Fixed

- Cleaned stale `hooks-system-v0-bookmark` memory that was misleading auto-recall after #26 closed.

### Notes

- **Bun-only.** Node.js cannot consume the published package (raw `.ts` in `node_modules`). This is an intentional constraint for v0.2; Node support is tracked in #32.
- The release workflow (`spores-release`) and release-check skill were rewritten for CI-gated flow in this cycle.

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
