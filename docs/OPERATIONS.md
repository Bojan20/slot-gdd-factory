# Operations runbook

> **Audience:** maintainers debugging CI failures, integrators wiring
> the V9 vision or migration pipelines, anyone who needs to know
> "where do I look when X is red?"
>
> Created by UQ-U-8 P1 (Boki 2026-06-25) after the U-8-C audit flagged
> that 7 audit waves + 70+ atoms had landed with no top-level runbook —
> all institutional memory lived in commit messages and the auto-gen
> CLAUDE.md.

## How to debug a red `ci.yml` run

The CI gate has 13+ steps. They run in order; the first failure
short-circuits the rest. To localise:

1. Open the failing run in GitHub Actions.
2. The "Emit failure summary" step writes a step-summary block with
   commit hash + event + ref. Read it first.
3. Scroll to the FIRST step with the red ✗. Its stderr/stdout tail is
   inline. The earlier steps that succeeded are reliable; the failure
   is in this step or upstream of it.
4. Download the `ci-reports-<sha>` artifact (uploaded on failure) for
   the full `reports/` directory: verify --json output, baseline
   diffs, V9 vision telemetry.
5. Reproduce locally with the SAME command listed in `.github/workflows/ci.yml`:
   `npm ci && npm run <failed-step>`.

## How to reproduce CI failures locally

```
# fast: same as CI gate, ~10s
npm ci
npm run test:runtime
npm run test:model-schema
npm run test:vision-guard
npm run test:deep-freeze
npm run test:ixf-coverage
npm run audit:ixf
npm run test:rust-executor
npm run test:kernel-init
npm run test:rect-transform

# full: same as Boki's pre-commit hook, ~110s
npm run verify:quick
```

If a contract test fails but `verify:quick` passes, the divergence is
a bug — both gates SHOULD be in lockstep (per UQ-U-6 P0 #1).

## Where reports live

```
reports/
  v9-vision-<ts>.json           V9 vision call summary (verdicts + costs + skips)
  v9-visual-qa-<ts>.json        V9 deterministic check receipts (338 games)
  parse-real-pdfs-<ts>.json     PDF parser corpus baseline
  uq16-baseline.json            Render baseline (gold reference)
  dashboard/index.html          Operator-facing static portfolio
  gdd-one-pagers/<slug>.md      Per-game compliance briefings
  compare-games/<a>__vs__<b>.md Side-by-side diffs
  honesty-calibration.json      Auto-corrected agent self-attestation
  …
```

## Reset / recovery procedures

### Cost guard accumulator wedged

The V9 vision cost guard is in-memory only — each CLI invocation
starts fresh. There's no "reset" to do; just restart the orchestrator.

### `migrate-model.mjs` leaves `.migrate-tmp.<pid>` litter

UQ-U-1 P0-5 added unlink-on-error, so this shouldn't happen on a
clean abort. If it does (SIGKILL):

```
find tools/_wave-v-cache dist/real-games -name '*.migrate-tmp.*' -delete
```

### Schema drift detected across 338 cache files

Run the audit walker with `--migrate`:

```
node tools/_audit-model-schema.mjs --migrate --quiet
node tools/_audit-model-schema.mjs --strict
```

The first command in-place stamps every `model.json` to the current
`MODEL_SCHEMA_VERSION`. The second verifies. Both are idempotent.

## Cost guard reset

The V9 vision guard caps an overnight sweep at $2.50 by default. If
operator needs to bypass for a one-off run:

```
V9_MAX_VISION_USD=10.00 V9_MAX_VISION_CALLS=200 node tools/v9-vision-orchestrator.mjs --vision
```

The guard **does NOT persist across runs**. Each CLI invocation
starts fresh. Set the env vars per command.

## Common failure modes

### `verify:quick` red, CI green
The local pre-commit needs `~/Desktop/GDD/` + sister `slot-math-engine-template`
+ chromium + the baked block-coverage walker baseline (see
`ci.yml` header). If any of those is missing, the FULL gate red is
expected — work around with `npm run test:<contract-suite>` for the
focused gate that matters to your PR.

### CI red on a step that's green locally
Check Node version (`node --version` should be 22.x to match CI).
The 7 contract suites are CI-safe by design; if you see a divergence,
flag it in MASTER_TODO as a new audit wave.

### V9 vision SKIP with `wrapper missing`
The Opus wrapper lives at `~/Projects/cortex/scripts/cortex-fable-ask`
by default. Override with `V9_VISION_WRAPPER=/path/to/wrapper` env.
The orchestrator validates the path (file + executable + allowed root)
before calling — see UQ-U-3 #2.

## When something looks wrong but I can't repro

1. Check MASTER_TODO for the most recent audit wave (UQ-U-1..8).
2. Check CLAUDE.md auto-gen state.
3. Check `gh run list --limit 10` for the last green commit.
4. `git diff <last-green>..HEAD` — what changed?
5. Bisect: `git bisect start HEAD <last-green> && git bisect run npm run verify:quick`.

## Adding a new contract suite

1. Create `tests/_yourFeature.test.mjs` mirroring the layout of
   `tests/_modelSchema.test.mjs` (header docstring + `t(name, fn)`
   helper + result counter + exit code).
2. Add `npm run test:your-feature` to `package.json`.
3. Add the step to `.github/workflows/ci.yml` AND `tools/verify.mjs`
   so local and CI stay in lockstep (UQ-U-6 P0 #1).
4. Document the contract in the test file header `Covers:` list.

## See also

- `docs/IXF-15-STAGES.md` — regulator integration contract
- `docs/MIGRATION-GUIDE.md` — how to bump `MODEL_SCHEMA_VERSION`
- `docs/CI-GATES.md` — per-step explanation of every gate
- `MASTER_TODO.md` — what's in flight + waves landed
- `CLAUDE.md` — full project rules + memory snapshot
