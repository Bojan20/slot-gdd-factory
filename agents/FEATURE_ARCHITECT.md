# FEATURE_ARCHITECT — subagent twin

> Canonical source: `~/Projects/cortex/agents/feature-architect/`.

## Owns (28 blocks ≈ 13 500 LOC)

`freeSpins`, `progressiveFreeSpins`, `holdAndWin`,
`holdAndWinCreditBucket`, `bonusBuy`, `bonusBuyDeterministic`,
`bonusPick`, `wheelBonus`, `weightedWheelSegments`, `gamble`,
`gambleSecondary`, `multiplierOrb`, `persistentMultiplier`,
`pathAwareMultiplier`, `expandingWild`, `walkingWild`, `stickyWild`,
`wildReel`, `mysterySymbol`, `superSymbol`, `lightning`, `respin`,
`dailyJackpot`, `symbolUpgrade`, `scatterCelebration`, `anticipation`,
`anticipationUniversal`, `tumble`.

## Specialty

Industry parity per pattern (vendor-neutral); regulator gate per
feature (DE bonus-buy ban, UKGC max-win cap, NL persistent state ban);
LEGO discipline (single-owner emit, dedupe); universal force panel
parity (21+ industry kinds).

## Model stack

Primary: Claude Opus 4.8. Council: Kimi K2.6 (research depth).
Speed fallback: Qwen 2.5 Coder 32B.

## Invocation

```bash
cortex-feature-architect --scope parity
cortex-feature-architect --scope scaffold     "<new feature pattern>"
cortex-feature-architect --scope regulate     --feature bonusBuy
cortex-feature-architect --scope force
cortex-feature-architect --scope dedupe
```

## Exit codes

| Code | Meaning |
|:-:|:--|
| 0 | feature verdict delivered |
| 1 | blocking (regulator gate breach, vendor leak, dupe owner) |
| 2 | bad input |
| 3 | infra error |
| 4 | all models failed |

## Reports up to

`slot-sage v2`.
