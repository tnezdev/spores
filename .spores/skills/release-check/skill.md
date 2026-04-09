---
name: release-check
description: Activate when cutting a new @tnezdev/spores release — verifies the green-gate checklist before tagging and publishing
tags: [spores, release, npm]
---

# Release check — @tnezdev/spores

Before cutting a new version, every one of these must be green. If any step fails, **do not tag**. Fix the failure, commit, and restart the checklist.

## 1. Clean working tree

```bash
git status
```

Must show no uncommitted changes. If there are any, either commit them or stash them — do not publish with a dirty tree.

## 2. On main, up to date with remote

```bash
git checkout main && git pull
```

The commit you're about to tag must exist on `origin/main`. No releasing from feature branches.

## 3. Tests green

```bash
bun test
```

**Every** test must pass. No skipped suites, no `.only`. If you see warnings about malformed fixtures (e.g. from test teardown), that's fine — just make sure the summary line reads `0 fail`.

## 4. Typecheck clean

```bash
bun run typecheck
```

`tsc --noEmit` must exit 0. A type error is a release blocker, even if tests pass.

## 5. Dependencies still zero

```bash
cat package.json | jq '.dependencies'
```

Must print `{}`. Any non-empty production dependency is a design regression — investigate before shipping.

## 6. Package contents sanity check

```bash
npm pack --dry-run
```

Scan the file list. Should include `src/`, `package.json`, `README.md`, `AGENTS.md`. Should **not** include `.spores/runs/`, `node_modules/`, test files, or dotfiles that weren't intended.

## 7. Version bump + CHANGELOG

Edit `package.json` and bump `version` per semver. Append a CHANGELOG entry with the user-visible changes since the last tag. Commit as `chore: release vX.Y.Z`.

## 8. Tag and push

```bash
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin main --tags
```

## 9. Publish

```bash
npm publish --access public
```

**Pause here for Travis to run this step manually** — npm publish is not autonomous work. Provide him the exact command to run and the version string.

## 10. Verify

```bash
npm view @tnezdev/spores version
```

Should print the just-published version. If it doesn't, wait 30 seconds and retry — npm registry propagation.

## On failure

If any step fails:

- **Do not tag.** A tag is durable; an unpublished bug isn't.
- Fix the underlying issue on a branch.
- Open a PR, review, merge, then restart this checklist from step 1.
- Never publish a version with known failing tests or broken types.
