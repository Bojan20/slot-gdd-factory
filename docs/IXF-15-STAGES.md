# IXF 15-Stage Lifecycle Mapping

> **Audience:** slot platform integrators, regulator compliance teams,
> third-party math-engine vendors, and project maintainers extending the
> HookBus.
>
> **Purpose:** map the 15 canonical industry-standard slot lifecycle
> stages to the concrete `HOOK_EVENTS` registered in this project's
> `src/blocks/hookBus.mjs`. Industry-neutral language only — no vendor
> names. The 15-stage model is the de-facto integration contract used
> across regulated jurisdictions for spec, audit, and certification.
>
> P3-P2 (Boki 2026-06-25) — N+2 doc-only orthogonal.

## Why this document exists

A regulator-grade slot engine has a well-defined lifecycle: every spin
walks through the same sequence of phases, and every observable
side-effect (audit log, telemetry, real-money settlement, RG
intervention) hooks into one of those phases. Integrators reading this
project's `HookBus` need a single map that answers:

> "I'm certifying for jurisdiction X. Their stage table calls this
> phase `RNG_DRAW_COMPLETE`. Which `HOOK_EVENTS` does our engine emit
> for that?"

Without this doc, the answer requires reading every block source file.
With it, the answer is one table lookup.

## The 15 stages

The industry-standard 15-stage lifecycle (vendor-neutral encoding):

```
S01  INIT_REQUESTED          host hands control to client
S02  ASSETS_LOADED           reel strips / paytables / shape data ready
S03  SESSION_OPEN            balance + jurisdiction + RG limits resolved
S04  SPIN_REQUESTED          player-initiated spin (or autoplay tick)
S05  RNG_DRAW_STARTED        seed advanced, draw window opens
S06  REELS_LANDING           anticipation + reel-stop sequence
S07  EVAL_WIN                line / way / cluster / pay-anywhere evaluator
S08  PRESENT_WIN             rollup + per-line cycle + LDW handling
S09  EVAL_FEATURE_TRIGGER    scatter count / cluster gate / Hold&Win
S10  FEATURE_ENTER           free-spin / pick / wheel / Hold&Win banner
S11  FEATURE_PROGRESS        in-feature spins, multipliers, retriggers
S12  FEATURE_EXIT            tally + bigwin-tier + return-to-base
S13  SETTLEMENT              award booked to balance, history written
S14  COMPLIANCE_CHECKPOINT   reality check / session timeout / net-loss
S15  IDLE                    awaiting next spin
```

## Stage → HookBus mapping

```
┌─────┬──────────────────────────┬────────────────────────────────────────┐
│ Stg │ Stage (industry name)     │ HookBus event(s)                        │
├─────┼──────────────────────────┼────────────────────────────────────────┤
│ S01 │ INIT_REQUESTED            │ preSpin                                 │
│     │                           │ (no dedicated init hook — preSpin       │
│     │                           │  fires once before the first spin and   │
│     │                           │  consumers treat that as the init       │
│     │                           │  edge)                                  │
│ S02 │ ASSETS_LOADED             │ preSpin                                 │
│     │                           │ (asset readiness is gated synchronously │
│     │                           │  by the orchestrator before preSpin     │
│     │                           │  fires — no separate event needed)      │
│ S03 │ SESSION_OPEN              │ onSessionResumed, onBalanceChanged      │
│ S04 │ SPIN_REQUESTED            │ preSpin, onBetChanged,                  │
│     │                           │ onAutoplayTick (when autoplay-driven)   │
│ S05 │ RNG_DRAW_STARTED          │ onSpinResult                            │
│     │                           │ (carries the draw outcome — the engine  │
│     │                           │  is single-tick so DRAW_STARTED ≡       │
│     │                           │  result emission)                       │
│ S06 │ REELS_LANDING             │ onSlamRequested, onSlamComplete         │
│ S07 │ EVAL_WIN                  │ onSpinResult (payload contains evtl),   │
│     │                           │ onTumbleStep (per cascade step),        │
│     │                           │ onPathMultiplierAssigned,               │
│     │                           │ onPathMultiplierAggregate               │
│ S08 │ PRESENT_WIN               │ onWinPresentationStart,                 │
│     │                           │ onWinPresentationEnd,                   │
│     │                           │ onBigWinTierEntered,                    │
│     │                           │ onBigWinTierExited,                     │
│     │                           │ onBigWinTierEnd,                        │
│     │                           │ onSkipRequested, onSkipComplete         │
│ S09 │ EVAL_FEATURE_TRIGGER      │ onFsTriggerArmed                        │
│ S10 │ FEATURE_ENTER             │ onFsTrigger, onFsEnter, onFsStart,      │
│     │                           │ onCreditBucketRespinStart,              │
│     │                           │ onWheelSegmentChosen,                   │
│     │                           │ onBonusBuyTierSelected                  │
│ S11 │ FEATURE_PROGRESS          │ onFsSpinResult, onCreditBucketLocked,   │
│     │                           │ onWheelJackpotHit                       │
│ S12 │ FEATURE_EXIT              │ onFsEnd, onCreditBucketEnd,             │
│     │                           │ onWheelAwardCollected                   │
│ S13 │ SETTLEMENT                │ postSpin, onBalanceChanged,             │
│     │                           │ onGambleEnd, onNetThresholdCrossed      │
│ S14 │ COMPLIANCE_CHECKPOINT     │ onRealityCheckShown,                    │
│     │                           │ onRealityCheckDismissed,                │
│     │                           │ onRealityCheckPaused,                   │
│     │                           │ onRealityCheckResumed,                  │
│     │                           │ onRealityCheckQuit,                     │
│     │                           │ onSessionWarningShown,                  │
│     │                           │ onSessionTimeoutFired,                  │
│     │                           │ onSessionExtended,                      │
│     │                           │ onSessionLogoutRequested                │
│ S15 │ IDLE                      │ onAutoplayStop, onTurboToggle           │
│     │                           │ (state changes during idle)             │
└─────┴──────────────────────────┴────────────────────────────────────────┘
```

> Hooks listed above are guaranteed to exist in `HOOK_EVENTS` at the
> moment this doc was last refreshed. The `tools/_ixf-coverage-audit.mjs`
> walker fails CI if any hook in this table drifts out of the registry.
>
> **Roadmap hooks (NOT in HOOK_EVENTS today):**
> Several blocks would benefit from dedicated emissions — `onGddMetaReady`
> (S01 init edge), `onReelStripsApplied`, `onSymbolModifiersApplied`,
> `onPaytableReady` (S02 asset-pipeline observability),
> `onJurisdictionGateApplied` (S03 regulator entry),
> `onRngDrawStarted` (S05 dedicated start edge),
> `onAnticipationStart`, `onAnticipationEnd` (S06 anticipation cycle),
> `onPersistentMultiplierBumped`, `onRetriggerHit` (S11 feature
> progress), `onCascadeHalted` (S12 cascade-mode feature exit). These
> are tracked in the LEGO-gate backlog (UQ-U-1 #11 deferred); the
> overall stage is currently covered by adjacent hooks, but a future
> sweep will register the dedicated events and update this doc.

## Stage coverage rules

Every stage MUST be covered by at least one HookBus event. The
`tools/_ixf-coverage-audit.mjs` walker enforces this:

```
$ npm run audit:ixf
```

The audit:

1. Imports `HOOK_EVENTS` from `src/blocks/hookBus.mjs`.
2. Reads the table above from this file (parsed as the source of truth).
3. Asserts every S01..S15 row has ≥ 1 hook that exists in `HOOK_EVENTS`.
4. Reports orphan hooks (in `HOOK_EVENTS` but mentioned in no row) as
   informational — these are blocks that emit but don't yet have a
   regulator-aligned stage mapping. Not a failure, but a candidate for
   the next coverage sweep.

## When to add a stage

The 15-stage model is fixed. NEW kinds of game mechanics (skill-based
bonus, social tournament, peer-to-peer wager) are NOT new stages —
they're feature-specific extensions inside S10/S11. If a regulator
introduces a true 16th stage (e.g. mandatory pre-spin biometric
attestation), that's a project-wide architectural change, not a doc
update.

## When to add a hook

When a block needs to publish an event that maps to one of the 15
stages, the block:

1. Registers the event name in `HOOK_EVENTS` (Owner: `<block>.mjs`).
2. Emits the event with the payload contract defined in the block's
   JSDoc.
3. Adds the event name to the row in this doc.

The IXF audit walker will flag the row as covered.

## Audit smoke test

`tests/_ixfCoverage.test.mjs` is a 5-case smoke test that imports
HOOK_EVENTS and asserts:

1. `preSpin` exists (S04 anchor).
2. `postSpin` exists (S13 anchor).
3. `onSpinResult` exists (S05 + S07 dual-stage anchor).
4. `onFsTrigger` + `onFsEnd` exist (S10 + S12 anchors).
5. The total `HOOK_EVENTS.length` is at least 15 (enough room to cover
   every stage with at least one event).

The full coverage walker (`audit:ixf`) is a separate tool that parses
this doc and runs the stage-by-stage check.

## Cross-references

- `src/blocks/hookBus.mjs` — canonical HOOK_EVENTS registry
- `docs/BLOCK_MANIFEST.md` — block ↔ feature mapping
- `agents/V9_VISUAL_QA.md` — V9 deterministic check uses S08
  (PRESENT_WIN) + S10 (FEATURE_ENTER) hooks to detect missing visual
  states
