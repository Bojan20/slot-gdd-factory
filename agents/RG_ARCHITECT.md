# RG_ARCHITECT — subagent twin

> Canonical source: `~/Projects/cortex/agents/rg-architect/`.

## Owns (3 blocks ≈ 1700 LOC)

`realityCheck`, `sessionTimeout`, `netLossIndicator`.

## Specialty

Jurisdiction matrix authority: UKGC LCCP 8.3.1 (reality check 30/60),
UKGC LCCP 1.4.6 (autoplay), AGCO 4.07 (session cap), MGA Player
Protection §5 (net loss), SE Spelinspektionen Spellag 14:6 (bonus-buy
ban), DE GlüStV §11 (spin ≥ 5 s + bonus-buy ban + no saved state),
NL Cruks (cool-off). Always cites rule numbers.

## Model stack

Primary: Claude Opus 4.8. Council: `reg-oracle` (live RSS feed
of regulator changes — Cortex W46.S11). Speed fallback: Mistral 7B.

## Invocation

```bash
cortex-rg-architect --scope jurisdiction --target UKGC
cortex-rg-architect --scope cross
cortex-rg-architect --scope reality
cortex-rg-architect --scope session
cortex-rg-architect --scope loss
cortex-rg-architect --scope scaffold      "<new rg block>"
```

## Exit codes

| Code | Meaning |
|:-:|:--|
| 0 | rg verdict delivered |
| 1 | blocking (jurisdiction rule breach, missing RG surface) |
| 2 | bad input |
| 3 | infra error |
| 4 | all models failed |

## Reports up to

`slot-sage v2`.
