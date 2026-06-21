# V10 — Industry Reviewer Agent

**Status**: production · deterministic rule engine, zero LLM cost
**Wave**: UQ-MASTERY-3 (2026-06-21)
**Lifecycle**: post-V8 assembly, blocks commit when HARD violations exist

## Purpose

V10 encapsulates **slot-industry ground truth** as a deterministic
walker over every `model.json` produced by the pipeline. Where V1..V6
parse the GDD into a canonical model and V7..V9 verify the rendered
artifact matches it, V10 asks the **other** question:

> *"Is what we produced even a real industry slot — or did we ship
> something that violates baseline slot-design conventions?"*

Catches any future regression that produces non-industry-standard slots
(weird payline counts, impossible ways counts, cluster floor too low,
declared jurisdiction missing its compliance gate, dual-colossal reels
outside [3..8], etc.).

## Inputs

```
┌──────────────────────────────────────┬────────────────────────────────────┐
│ Path                                   │ Role                                │
├──────────────────────────────────────┼────────────────────────────────────┤
│ dist/real-games/<slug>/model.json      │ Canonical model — 338 GDDs scanned  │
│ tools/v10-industry-compliance-spec.mjs │ Rule engine (no LLM call)           │
│ reports/v10-industry-compliance-*.json │ Per-run audit receipt               │
└──────────────────────────────────────┴────────────────────────────────────┘
```

## Industry rules encoded (vendor-neutral constants)

```
┌──────┬──────────────────────────────────────────────┬─────────────────────┐
│ Rule │ Constraint                                     │ Severity            │
├──────┼──────────────────────────────────────────────┼─────────────────────┤
│ T1.1 │ topology.reels ∈ [3, 8]; rows ∈ [1, 8]         │ HARD                │
│ T1.2 │ evaluation ∈ {lines, pay_anywhere, ways,       │ HARD                │
│      │ cluster_pays, cluster, scatter_pay, plinko,    │                     │
│      │ wheel, crash, slingo}                          │                     │
│ T1.3 │ 5×3 rectangular lines slot → paylines ∈        │ HARD if paylines≥2  │
│      │ {10, 20, 25, 30, 40, 50, 100}                  │ SOFT if 0/1 (parser)│
│ T1.4 │ ways slot → ways_count ∈ {243, 576, 720,       │ HARD                │
│      │ 1024, 4096, 7776, 15625, 117649}               │                     │
│ T1.5 │ cluster_pays → cluster_min_size ≥ 5             │ HARD                │
│ T1.6 │ plinko slot → plinko_rows ∈ [5, 16]            │ HARD                │
│ T1.7 │ wheel slot → wheel_segments ∈ [6, 24]          │ HARD                │
│ T1.8 │ hex slot → hex_ring ∈ [1, 4]                   │ HARD                │
│ T3.1 │ cluster_pays evaluation → paylines = 0/null    │ HARD                │
│ T3.2 │ ways evaluation with paylines>0                │ SOFT (chrome OK)    │
│ T3.4 │ cluster_pays requires cluster_min_size set     │ HARD                │
│ T3.5 │ specialty engine kind → matching evaluation    │ SOFT (parser route) │
│ T4.1 │ each declared jurisdiction → matching          │ HARD                │
│      │ <country>ComplianceGate.enabled === true       │                     │
│ T2.1 │ bonusBuy.costX ∈ [30, 200] × bet               │ SOFT                │
│ T2.2 │ freeSpins max award ≥ 5                        │ SOFT                │
│ T2.3 │ payback.hitFrequency ∈ [5%, 50%]               │ SOFT                │
└──────┴──────────────────────────────────────────────┴─────────────────────┘
```

## Output contract

```json
{
  "wave": "UQ-MASTERY-3",
  "agent": "V10_INDUSTRY_REVIEWER",
  "verdict": "PASS" | "FAIL",
  "gamesAudited": 338,
  "hardCount": 0,
  "softCount": 144,
  "hardByRule": {},
  "softByRule": { "T1.3.fallback": 129, "T3.2": 11, "T2.2": 1, "T3.5": 3 },
  "hardSample": [],
  "softSample": [ { "slug": "...", "rule": "T2.2", "msg": "..." } ],
  "__meta__": { "ts": "...", "tool": "tools/v10-industry-compliance-spec.mjs" }
}
```

`verdict = FAIL` iff `hardCount > 0`. Pre-commit gate (verify step 4.92)
runs V10 unconditionally; commit blocked on any HARD.

## SOFT warnings: advisory layer

SOFT warnings surface parser/smartDefaults heuristic edges but never
block commit. Operators can grep the report for repeat offenders and
schedule upstream fixes. Examples:

- `T1.3.fallback` — paylines=0/1 typically means parser couldn't parse
  topology kind from prose (cluster/varreel GDDs that defaulted to
  rectangular). Real fix lives in `src/parser.mjs` topology classifier.
- `T2.2` — FS max award < 5. Could be intentional ("3 spins" novelty)
  or under-tuned generator. Investigate GDD source.

## Why a separate agent (not part of V6 reconcile)

V6 reconciles SEMANTIC data from the GDD. V10 enforces INDUSTRY
INVARIANTS that apply regardless of GDD source. Keeping V10 separate
means:

- V10 runs in seconds (no LLM call, no Playwright)
- Industry rules are pure JSON / Set / Map literals — auditable diff
- Rule changes don't invalidate V6 cache
- V10 can run in the pre-commit hook with zero token cost

## Why NOT a whitelist approach

Earlier draft made V10 whitelist (grandfather rule for each
non-conforming model). Rejected: whitelist hides the violation, the
problem grows silently, and a year later we ship a slot with paylines=7
because nobody noticed the whitelist entry. V10 either ENFORCES the
industry rule OR documents the exception as SOFT with a one-line
follow-up. No third option.

## Self-correction loop (planned)

When `verdict = FAIL` with a known rule pattern, V10 can:
1. Inspect the violating slug's gdd.md.
2. Suggest an upstream patch (e.g. `T1.4: ways_count=7000 → 7776 (industry-nearest)`).
3. Optionally auto-patch the model.json + re-run V10.

Currently auto-fix is OFF (industry rules should not be auto-relaxed
without human sign-off). Run `--soft` to escalate SOFT to HARD when
preparing a release.

## Provenance

- Author: Corti (Claude Opus 4.8) — sole owner
- First push: 2026-06-21 — UQ-MASTERY-3 wave
- Tool: `tools/v10-industry-compliance-spec.mjs`
- Gate: verify step 4.92 (added after V7 step 4.91)
- Mastery: Boki: *"koji test još možeš da napišeš na osnovu agenata,
  koji poznaju komplet GT i slot industriju, da znamo da će sve biti
  uvek po pravilu i savršeno"*
