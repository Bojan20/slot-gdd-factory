# V7 — Block Liveness Verifier

**Status**: production · default provider Claude Opus 4.8 (via Fable wrapper) · Kimi fallback
**Wave**: UQ-MASTERY (2026-06-21)
**Lifecycle**: post-V6 reconcile, pre-render

## Purpose

V7 verifies that **every block the GDD demands is actually mountable in
the build output**. It closes the gap left by V1..V6 — those lanes only
parse semantic data; they don't prove that the rendered HTML actually
contains the code path that lights up the requested feature.

Without V7, a future regression could (a) silently drop a block from the
build pipeline, (b) rename an exported `emitXxx` function and break the
`buildSlotHTML.mjs` import, (c) introduce a typo in the manifest that
makes the block appear "absent" to the orchestrator. V7 catches all three.

## Inputs

```
┌─────────────────────────────────────┬────────────────────────────────────┐
│ Path                                  │ Role                                │
├─────────────────────────────────────┼────────────────────────────────────┤
│ tools/_eyes/block-liveness/_liveness.json │ Latest classifier output (live cache) │
│ blocks/_manifest.json                 │ Source of truth — 184 block records │
│ dist/*_playable.html                  │ 20 synthetic grid fixtures           │
│ dist/real-games/<five-main>/slot.html │ 5 ground-truth slot HTMLs            │
└─────────────────────────────────────┴────────────────────────────────────┘
```

## Output contract (mandatory shape)

```json
{
  "wave": "UQ-MASTERY",
  "agent": "V7_BLOCK_LIVENESS",
  "verdict": "PASS" | "FAIL",
  "totalBlocks": 184,
  "live": 156,
  "dormant": 28,
  "dead": 0,
  "deadList": [],
  "evidence": {
    "scannedHtmls": 25,
    "samplePolicy": "20 synthetic + 5 main",
    "fingerprintsPerBlock": 3
  },
  "__meta__": {
    "ts": "2026-06-21T...",
    "tool": "tools/_block-liveness-walker.mjs",
    "elapsedMs": 2900
  }
}
```

`verdict = FAIL` iff `dead > 0`. Any DEAD block blocks commit via the
verify gate (step 4.91).

## Why a separate agent (not part of V6 reconcile)

V6 stops at semantic data — it merges V1..V5 into a canonical model.json
WITHOUT touching the build artifact. Adding HTML scanning to V6 would
couple the LLM provider call to the file system in a way that breaks
cache replay (V6 must be deterministic; HTML can change between V6 and
V7). Keeping V7 separate means:

- V6 can be cached, re-played, A/B'd between providers
- V7 runs locally, no LLM call needed, always-fresh
- V7 can run in the pre-commit hook even when offline

## Algorithm

```
1. Read blocks/_manifest.json (184 blocks)
2. Build per-block fingerprint set:
     a) literal block name (e.g. "paytable")
     b) every exported `emitXxx*` function name (e.g. "emitPaytableCSS")
     c) hand-aliased kind ids (e.g. plinkoSpinEngine → "plinko-ball")
3. Sample 25 rendered HTML files (20 synthetic + 5 main).
4. For each block, count fingerprint occurrences across all samples.
5. Cross-reference with _block-coverage-walker.mjs HookBus signal (if present).
6. Classify:
     LIVE     — ≥1 mount OR ≥1 emit OR ≥1 listener
     DORMANT  — 0 traces + defaultOn=false (expected reserve)
     DEAD     — 0 traces + defaultOn=true (genuine hole)
7. Write _liveness.json + _liveness.md, exit 1 if dead > 0.
```

## Failure modes (and how to fix)

| Symptom                                   | Root cause                       | Fix                                       |
|:------------------------------------------|:---------------------------------|:------------------------------------------|
| `DEAD: paytable` after manifest rename     | Block name moved, fingerprint stale | Add legacy name to fingerprint list      |
| `DEAD: <newEngine>SpinEngine`              | Engine IIFE bakes only kind id   | Add `KIND_ALIASES[blockName] = [...]` row |
| `DEAD: <feature>` only in real-games scan  | buildSlotHTML.mjs lost import    | Restore `import { emit... } from './blocks/...'` |
| Walker exits 2 (`No dist HTML found`)      | Build artifacts missing          | Run `npm run sandbox:build` or `npm run test:parse:real-pdfs` |

## Self-correction loop (re-runs V7 until PASS)

When invoked with `--auto-fix` flag, V7:
1. Runs once, collects DEAD list.
2. For each DEAD block, inspects manifest + source to derive plausible
   fingerprint aliases (e.g. extracts CSS class names from emit*CSS body).
3. Patches `KIND_ALIASES` in the walker and re-runs.
4. If still DEAD after 3 attempts → escalates (reports to operator).

Currently `--auto-fix` is disabled; aliases are curated by hand to stay
auditable. Activate only after manual review.

## Provenance

- Author: Corti (Claude Opus 4.8) — sole owner
- First push: 2026-06-21 — UQ-MASTERY wave
- Tool: `tools/_block-liveness-walker.mjs`
- Gate: verify step 4.91
- Mastery: Boki: *"da ovaj slot gdd projekat bude izuzetno ultimativan i bez ijedne jedine rupe"*
