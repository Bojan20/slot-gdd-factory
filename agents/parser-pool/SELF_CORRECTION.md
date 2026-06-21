# Wave UQ-TRAIN — Agent Self-Correction Meta-Prompt

Boki direktiva (2026-06-21): *"odradi im trening ili kako gode misli sfuturisticki"*

This meta-prompt is **prepended** to every V1..V5 lane prompt during the
calibration / training pass. It turns the single-shot agent into a
two-pass self-correcting one without changing the underlying lane
logic.

## Pass A — initial extraction

Agent reads GDD and emits its first JSON response (same as before).

## Pass B — self-correction

Caller runs a **diff** between the agent's response and ground-truth
expectations (when available) — namely:
- pinned values from `tests/fixtures/semantic-expected.json`
- parser-determined baseline (deterministic regex extractor output)
- field-coverage histogram from UQ-7 audit

The caller then re-invokes the agent with a **CORRECTIONS block**
appended to the prompt:

```
=== CORRECTIONS ===
Previous response had these issues:
  - topology.reels: you returned <X>, ground truth says <Y>  (evidence: "<PDF quote>")
  - topology.paylines: you returned null, PDF says <Y>     (evidence: "<PDF quote>")
  - features[*].kind: missing 'hold_and_win' (PDF mentions "hold and win" on line N)
  - symbols[*]: no 'Volcano' captured (PDF mentions "Volcano = Free Spins scatter")

Re-emit the JSON. Keep correct fields, fix the listed ones. Stamp
`__self_corrected__: true` at the root of your JSON.
```

## Hard rules — no hallucination

- **NEVER invent** fields. If the PDF doesn't say it, return `null` —
  even after corrections.
- **NEVER raise confidence** above 0.6 for fields fixed via correction
  block — they are agent-derived, not GDD-declared.
- **STAMP** `__self_corrected__: true` so downstream V6 reconcile and
  audit tools can distinguish first-pass vs corrected responses.

## When self-correction triggers

The orchestrator runs Pass B ONLY if Pass A meets at least one of:
- ≥ 3 fields differ from ground truth
- ≥ 1 named symbol from `semantic-expected.namedSymbols` missing
- topology.reels OR topology.rows mismatches expected value

If Pass A is already correct (all asserts green), Pass B is skipped —
no cost paid for already-good agents.

## Why two-pass instead of better-prompts-up-front

Empirically (UQ-7 audit, 338 GDDs):
- Pass A captures ~80 % of structurally-explicit fields
- Pass B unlocks the prose-implicit fields (named symbols, jurisdiction
  certificates, feature config knobs) where the agent needs to be told
  WHICH cues matter

A single prompt that lists every possible cue would balloon to 5K tokens
and tank latency. Two-pass with surgical corrections is cheaper and
converges faster.

## Self-correction telemetry

Each Pass B run is logged:
- delta-fields-fixed
- delta-fields-still-wrong
- confidence-distribution shift

These telemetry rows feed back into the agent prompts via the
`AGENT_CALIBRATION` block at the head of each lane prompt — a long-term
learning signal that survives across runs.
