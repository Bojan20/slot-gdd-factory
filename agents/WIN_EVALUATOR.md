# WIN_EVALUATOR — subagent twin

> Canonical source: `~/Projects/cortex/agents/win-evaluator/`.

## Owns (9 blocks ≈ 5200 LOC)

`paylines`, `paylineOverlay`, `payAnywhereEval`, `clusterPaysEval`,
`waysEval`, `winPresentation`, `winRollup`, `bigWinTier`, `winCap`.

## Specialty

EV correctness + max-win cap enforcement + big-win tier math.
Integrates with `math-debug` when the math layer is opened.
Tier badge thresholds (5×/15×/50×/250×/1000×). Cap per jurisdiction
(UKGC 100k×stake, MGA 500k×stake).

## Model stack

Primary: Claude Opus 4.8. Council: Kimi K2.6 (math paper recall).
Math escalation: `math-debug` subagent.

## Invocation

```bash
cortex-win-evaluator --scope cap            --jurisdiction UKGC
cortex-win-evaluator --scope tier
cortex-win-evaluator --scope ev             --math-state OFF
cortex-win-evaluator --scope presentation
```

## Exit codes

| Code | Meaning |
|:-:|:--|
| 0 | win evaluator verdict delivered |
| 1 | blocking (cap breach, EV drift, tier breach) |
| 2 | bad input |
| 3 | infra error |
| 4 | all models failed |

## Reports up to

`slot-sage v2`.
