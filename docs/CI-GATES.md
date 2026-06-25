# CI gates reference

> **Audience:** maintainers extending CI, anyone asking "what does CI
> actually run?" Created by UQ-U-8 P1 after U-8-D #9 flagged that the
> CI gate had grown to 13 steps with no top-level doc.

## Overview

```
┌─────────────────────────┬───────────────────────────────────────────────┐
│ Workflow                 │ Trigger                                        │
├─────────────────────────┼───────────────────────────────────────────────┤
│ ci.yml                   │ push:main + PR:main — 13 steps, ~25s wallclock│
│ pdf-baseline.yml         │ PR with path-filter — soft-skip mode currently│
│ nightly.yml              │ cron 03:00 UTC + workflow_dispatch — heavy    │
└─────────────────────────┴───────────────────────────────────────────────┘
```

## ci.yml — the always-on gate

Every push to main + every PR runs this. 13 steps, ~25s wallclock.

| # | Step | Why | Source |
|:-:|:--|:--|:--|
| 1 | Checkout | fetch-depth scoped (push=0/PR=1) for fork-PR safety | UQ-U-3 #10 |
| 2 | Setup Node 22 | LTS, unified with pdf-baseline + nightly | UQ-U-2 #12 |
| 3 | npm ci | Lockfile-honest install on Linux | N+2-H |
| 4 | actionlint | YAML / shellcheck on workflows | UQ-U-2 #14 (SHA-pinned UQ-U-3 #9) |
| 5 | test:runtime | 8 orchestrator probes (gridRenderer + force + globals) | N+2-H |
| 6 | test:model-schema | 18 cases on semver + planner + migrate idempotency | UQ-U-1 P0 #1 |
| 7 | test:vision-guard | 20 cases on BigInt micro-cents + clamp | UQ-U-1 P0 #1 |
| 8 | test:deep-freeze | 21 cases (post UQ-U-4 hardening) | P3-P1 |
| 9 | test:ixf-coverage | 7 smoke anchors | P3-P2 |
| 10 | audit:ixf | Deep walker drift gate | UQ-U-6 P2 #3 |
| 11 | test:rust-executor | Rust binary adapter contract | P3-P3 |
| 12 | test:kernel-init | Boot blob contract | P3-P4 |
| 13 | test:rect-transform | Layout primitive contract | P3-P6 |
| ⤷ | Emit failure summary | On failure only — writes $GITHUB_STEP_SUMMARY | UQ-U-8 P1 |
| ⤷ | Upload reports artifact | On failure only — 14-day retention | UQ-U-8 P1 |

### Intentionally NOT in ci.yml

| Suite | Why |
|:--|:--|
| `verify:quick` | Needs ~/Desktop/GDD + sister repo + chromium baseline; not CI-safe |
| `test:blocks` | Contains audio tests locked under HARD RULE #4 |
| `test:lego` | Pre-existing 7/8 HOOK_EVENTS regression on main; would land CI red day-one |
| `test:cross-browser` | Slow + needs Playwright install; runs in nightly.yml |

## pdf-baseline.yml — PR gate (currently AWAITING-FIXTURES)

Path-filtered: triggered when src/**, tests/parse-real-pdfs.mjs,
tests/fixtures/**, tools/_full-corpus-render-parity.mjs,
tools/uq16-baseline.mjs, tools/lego-gate.mjs, package.json, or
package-lock.json changes.

When `tests/fixtures/*.pdf` is empty (current state), the workflow
writes a loud `AWAITING-FIXTURES` warning to $GITHUB_STEP_SUMMARY
and exits 0. The green check **does NOT mean the parser was
validated** — committing a fixture set under `tests/fixtures/` turns
the gate on automatically without code change.

## nightly.yml — cron gate (heavy probes)

Runs at 03:00 UTC + `workflow_dispatch`. Two jobs:

### heavy-probes (matrix)

11 `npm run test:*` probes in parallel (fail-fast: false):
- test:bundle, test:bundle:compress, test:i18n:sweep
- test:load, test:long-run
- test:rng:validator, test:touch:validator, test:tti:validator
- test:wp:cross:validator, test:overflow, test:sharpness

Probe name passed via env (UQ-U-2 #13) — never directly interpolated
into `run:`.

### cross-browser

Single job: `npx playwright install --with-deps` + `npm run test:cross-browser`.
Runs chromium + firefox + webkit through `tools/_ultimate-cross-browser-probe.mjs`.

## Local mirror — `verify:quick`

Every contract suite in ci.yml is ALSO wired into `tools/verify.mjs`
(UQ-U-6 P0 #1) so a maintainer running `npm run verify:quick`
locally gets the same surface as CI plus the heavier local-only
gates (UQ-7, UQ-11, UQ-MASTERY, etc).

Total `verify:quick` wallclock ≈ 110s (vs CI ≈ 25s).

## Adding a new gate step

1. Pick a name: `test:your-feature` (or `audit:your-feature`).
2. Add the npm script in `package.json`.
3. Add the step in `.github/workflows/ci.yml` AFTER existing contract
   suites + BEFORE the failure summary block.
4. Add the SAME step in `tools/verify.mjs` so local stays in lockstep.
5. Update this doc with a new row in the table above.
6. Run `actionlint .github/workflows/*.yml` locally.
7. Commit.

## See also

- `docs/OPERATIONS.md` — how to debug a red CI run
- `docs/MIGRATION-GUIDE.md` — schema bump procedure
- `docs/IXF-15-STAGES.md` — regulator integration contract
- `tools/verify.mjs` — local pre-commit gate (sister of ci.yml)
