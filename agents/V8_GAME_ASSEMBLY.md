# V8 — GDD → Game Assembly Orchestrator

**Status**: production · Boki direktiva 2026-06-21 *"napravi da po gdd-u napravi savršena slot igra"*
**Wave**: UQ-MASTERY
**Lifecycle**: post-V7 liveness, pre-build

## Purpose

V8 is the **top-level orchestrator** that takes any GDD (PDF/MD/JSON/URL)
and produces a fully assembled, playable slot HTML with **zero missing
blocks and zero phantom blocks**. It glues the existing pipeline together
and adds the closure logic that was previously implicit in
`buildSlotHTML.mjs`.

```
┌────────────────────────────────────────────────────────────────────────────┐
│  GDD (any format)                                                          │
│        ↓                                                                    │
│  V1..V5 parser-pool agents (parallel)  ──>  V6 reconcile (canonical model) │
│        ↓                                                                    │
│  V7 block liveness audit  ──>  V8 ASSEMBLY (this agent)                    │
│        ↓                                                                    │
│  buildSlotHTML.mjs  ──>  dist/<slug>/slot.html                              │
│        ↓                                                                    │
│  V9 visual QA (next agent) ──> verdict                                     │
└────────────────────────────────────────────────────────────────────────────┘
```

## V8's job (the part NOT covered by V6 or buildSlotHTML)

V6 reconciles SEMANTIC data. `buildSlotHTML` IMPORTS every block in the
src/blocks/ directory unconditionally. The gap V8 closes:

| Concern                                | V6 | buildSlotHTML | V8 |
|:---------------------------------------|:--:|:-------------:|:--:|
| Parse symbols, paylines, RTP            | ✅ |               |    |
| Render every emit*CSS into one document |    | ✅            |    |
| Decide which blocks to mark `enabled`   |    |               | ✅ |
| Resolve block-vs-block conflicts        |    |               | ✅ |
| Validate jurisdiction × feature matrix  |    |               | ✅ |
| Emit assembly receipt                   |    |               | ✅ |

## Decision matrix V8 owns

```
┌────────────────────────────────────┬──────────────────────────────────────┐
│ GDD signal                           │ V8 decision                          │
├────────────────────────────────────┼──────────────────────────────────────┤
│ kind === 'plinko'                    │ enable plinkoSpinEngine, disable     │
│                                      │ reelEngine + hexReelEngine           │
│                                      │ hexReelEngine + wheelSpinEngine      │
│ kind === 'wheel'                     │ enable wheelSpinEngine + radial UI   │
│ kind === 'crash'                     │ enable crashSpinEngine               │
│ kind === 'slingo'                    │ enable slingoSpinEngine              │
│ kind === 'hex'                       │ enable hexReelEngine                 │
│ features includes 'holdAndWin'       │ enable holdAndWin + creditBucket +   │
│                                      │ bonusCelebrate + framework gate      │
│ features includes 'tumble'           │ enable tumble + winRollup +          │
│                                      │ scatterCelebration                   │
│ features includes 'megaways'         │ enable dynamicWaysEngine             │
│ features includes 'cluster'          │ enable clusterPaysEval, disable      │
│                                      │ paylines/payAnywhereEval             │
│ jurisdiction.includes('DE')          │ enable germanyComplianceGate +       │
│                                      │ minSpinPaceEnforcement               │
│ jurisdiction.includes('NL')          │ enable netherlandsComplianceGate +   │
│                                      │ cruksGate + coolOffPersistence       │
│ jurisdiction.includes('FR')          │ enable franceComplianceGate          │
│ jurisdiction.includes('IT')          │ enable italyComplianceGate           │
│ jurisdiction.includes('ES')          │ enable spainComplianceGate +         │
│                                      │ regulatorDisclosureModal             │
│ autoplay.allowed === false           │ disable autoplay (forces play loop)  │
│ bonusBuy.allowed === true            │ enable bonusBuy + bonusBuyDetermin.  │
│                                      │ + jurisdictionGate cross-check       │
│ rtp.minAuditMode === true            │ enable gddRealityCheck +             │
│                                      │ winCap + winCapTriggered chain       │
└────────────────────────────────────┴──────────────────────────────────────┘
```

(Full table — 80+ rules — lives in `tools/v8-assembly-rules.json`,
authored alongside this agent. The rule engine is pure JS, no LLM call.
LLM is used ONLY for the "make sense of weird wording" loop.)

## Output contract

```json
{
  "wave": "UQ-MASTERY",
  "agent": "V8_GAME_ASSEMBLY",
  "verdict": "PASS" | "FAIL",
  "assembly": {
    "enabledBlocks": ["paytable", "anticipation", ...],
    "disabledBlocks": ["plinkoSpinEngine", "wheelSpinEngine", ...],
    "reasonByBlock": {
      "plinkoSpinEngine": "kind=rect → engine off",
      "germanyComplianceGate": "jurisdiction=DE → on"
    }
  },
  "conflicts": [],
  "warnings": [],
  "__meta__": { "ts": "...", "elapsedMs": ... }
}
```

`verdict = FAIL` iff:
- A required block (e.g. `paytable` for a slot) is in `disabledBlocks`
- Two mutually exclusive blocks are both enabled (e.g. `clusterPaysEval`
  + `payAnywhereEval`)
- A jurisdiction is declared but its compliance gate block is missing

## Conflict resolution priority

```
1. Compliance (jurisdiction gate) wins over UX preference.
2. Topology-engine (single mandatory) wins over feature blocks.
3. Industry-vendor neutrality: any block that would expose a vendor name
   in rendered HTML is auto-disabled (rule_no_vendor_mentions).
4. Audit-trail blocks (winCap, gddRealityCheck) cannot be disabled by GDD.
```

## When V8 escalates to LLM

The pure rule engine handles 95% of GDD-s. The remaining 5%:

- GDD prose ambiguity (e.g. "scatter pays anywhere on screen" — does it
  mean payAnywhereEval or scatterCelebration both?)
- Custom features not in archetype catalog
- Jurisdiction wording that doesn't map cleanly to ISO codes

For these, V8 makes 1 LLM call (Opus default, Kimi fallback) with the
narrow question + the rule that's deadlocked. Reply must be JSON shape.
Stamped `__llm_consulted__: true` in receipt.

## Why a separate agent (not part of buildSlotHTML.mjs)

`buildSlotHTML` is a renderer — it shouldn't make decisions about WHICH
blocks to enable. Moving the decision matrix into V8 means:

- Receipts (`reasonByBlock`) are visible to operator + auditor
- Decision rules are unit-testable in isolation
- A future "edit block selection" UI can talk to V8, not to the renderer
- Jurisdiction rules can be added without recompiling the renderer

## Provenance

- Author: Corti (Claude Opus 4.8) — sole owner
- First push: 2026-06-21 — UQ-MASTERY wave
- Tool: `tools/v8-assembly-orchestrator.mjs`
- Gate: verify step 4.92 (added after V7)
- Mastery: Boki: *"po gddu napravi savršena slot igra, iskoristi i agente"*
