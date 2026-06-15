# ENGINE_ARCHITECT — subagent twin

> Canonical source: `~/Projects/cortex/agents/engine-architect/`.

## Owns (13 blocks ≈ 5500 LOC)

`hookBus`, `reelEngine`, `reelEngineCSS`, `hexReelEngine`,
`wheelSpinEngine`, `crashSpinEngine`, `plinkoSpinEngine`,
`slingoSpinEngine`, `spinControl`, `spinTempo`, `postSpin`,
`hotReload`, `triggerCounting`.

## Specialty

Hot-path performance (≤ 1 ms `FSM_renderHud`), FSM correctness,
dead-code detection via lifecycle hooks, anticipation halo arm/disarm
(Wave AL-1 industry standard).

## Model stack

Primary: Claude Opus 4.8. Council: Fable 5 (perf-tuned).
Speed fallback: DeepSeek Coder V2 16B local.

## Invocation

```bash
cortex-engine-architect --scope perf
cortex-engine-architect --scope fsm           --block reelEngine
cortex-engine-architect --scope deadcode
cortex-engine-architect --scope anticipation
cortex-engine-architect --scope scaffold      "<new engine kind>"
```

## Exit codes

| Code | Meaning |
|:-:|:--|
| 0 | engine verdict delivered |
| 1 | blocking (perf budget breached, FSM drift, dead block) |
| 2 | bad input |
| 3 | infra error |
| 4 | all models failed |

## Reports up to

`slot-sage v2`.
