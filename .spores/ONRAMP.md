# .spores/ ONRAMP — start a session on this repo

**Read this first. Then do the three things.**

This repo dogfoods its own toolbelt. When you work on `@tnezdev/spores`, you use spores. Not because it's clever — because if the tool isn't good enough for us to use on its own source, it isn't good enough to ship.

## The three-command on-ramp

```bash
# 1. Orient — load the maintainer hat with live situational tokens
bun src/cli/main.ts persona activate spores-maintainer

# 2. Pick up work — top ready task from the local queue
bun src/cli/main.ts task next

# 3. When cutting a release — run the checklist
bun src/cli/main.ts skill run release-check
```

Read the persona output. Do what step 3 of its "Before picking up work" section tells you. Start the work.

## What each command gives you

### `persona activate spores-maintainer`

Principles, anti-patterns, and a "before picking up work" checklist. Situational tokens (`{{cwd}}`, `{{git_branch}}`, `{{timestamp}}`, `{{hostname}}`) get substituted at activation time. Below the body, the `persona.activated` hook at `.spores/hooks/persona.activated` auto-recalls memories tagged with the persona's `memory_tags` and appends them — that's where current durable facts (runtime scope, publish path, etc.) come from. If you're piping into an LLM, this whole block is the context injection. If you're a human, read it and internalize the non-negotiables before you start typing.

### `task next`

Returns the highest-ULID `ready` task from `.spores/tasks/`. **Important:** the task list here is a manual mirror of the GitHub `ready`-labeled issues. It is not yet synced automatically. If you've just opened a new ready issue on GitHub, also seed a matching task file via `spores task add`. See "Known drift" below.

### `skill run release-check`

The pre-release checklist. Currently written for a manual publish flow — **known stale**, pending first successful CI publish. See "Known drift" below.

## Source of truth — what lives where

| Thing | Source of truth | Why |
|---|---|---|
| Code state, current commit, who changed what | `git log` / `git blame` | Authoritative, never stale |
| Ready work on this repo | GitHub issues with `ready` label | Cross-agent async pickup via HEARTBEAT poll |
| Current task you're working | `.spores/tasks/*.json` (manually mirrored from GH) | Exercised by `spores task next` as part of the dogfood |
| Durable non-obvious facts | `.spores/memory/*.json` | "Why" that isn't in the code |
| Values and in-turn orientation | `.spores/personas/spores-maintainer.md` | What you prioritize while wearing the hat |
| Release procedure | `.spores/skills/release-check/skill.md` + `.spores/workflows/spores-release.json` | Both currently stale — see below |

When two sources disagree, trust git and GitHub. Update the dogfood to match — that's the "dogfood as operational workspace, not curated fixture" stance.

## Known drift (refresh as you use it)

This section is a living punch list. If you fix something, delete the bullet.

- **`skills/release-check/skill.md`** is a manual-publish checklist. The real flow is now CI-driven: merge to main → tag `v*.*.*` → publish.yml runs. Update this skill to a ~4-step CI-gate checklist *after* the first successful CI publish lands (v0.1.1, expected soon). Don't theorize — update from lived experience.

- **`workflows/spores-release.json`** is a 9-node manual-publish DAG. Same story: update after first CI publish. Likely shrinks to 3-4 nodes or gets replaced with a "verify-ci-green" gate.

- **`tasks/` sync with GitHub issues is manual.** When you add a ready issue, seed a matching task file. When you close a GH issue, mark the task done. This is a bandaid — the real fix is a TaskAdapter that reads from GitHub issues directly (filed as a v0.2+ issue). Until then, keep them in hand-sync.

- **The persona's task filter is not applied by any CLI verb.** This is the known v0.2 composition-object seam from tnezdev/spores#16. `task next` returns the highest-ULID ready task regardless of the maintainer persona's `task_filter: { tags: [spores] }`. It's the exact design signal #16 was filed to track. Don't work around it in CLI code.

## How to treat this doc

**Living, not curated.** If something here is wrong the next time you use it, fix it in the same session. If the three-command on-ramp grows to four, add the fourth. If one of them becomes obsolete, delete it. The test of this doc's health is whether you actually reach for it at session start. If you don't — figure out why and fix that reason.
