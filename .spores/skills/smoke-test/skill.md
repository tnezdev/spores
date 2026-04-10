---
name: smoke-test
description: Activate when you need to validate the package is consumable before a release — runs npm pack, installs the tarball, and verifies exports under Bun
tags: [spores, release, npm, testing]
---

# Pre-publish smoke test

Validates that `@tnezdev/spores` is consumable from an `npm pack` tarball under Bun. This catches packaging issues (missing files, broken imports, wrong entry point) before a release tag is pushed.

## Run it

```bash
bash scripts/smoke-test.sh
```

## What it does

1. `npm pack` in the repo root — produces the exact tarball that `npm publish` would upload
2. Creates a temp consumer project and installs the tarball via `bun add`
3. Runs `scripts/smoke-consumer.ts` which imports the public API and checks that all value exports are present and constructable

## When to run

- Before pushing a release tag (`vX.Y.Z`)
- After changing `package.json` fields (`files`, `main`, `exports`)
- After adding or removing public exports from `src/index.ts`

CI runs this automatically in `.github/workflows/publish.yml` between the test step and the publish step.

## Current scope

- **Bun only.** Node.js consumption is not validated (see tnezdev/spores#32).
- Checks value exports exist with the right type (`function` for classes and functions). Does not exercise runtime behavior beyond import resolution.
