# UQ Fixture 183 · Persistent base-game multiplier · expanding

| Field | Value |
|---|---|
| **Internal name** | UQ-expanding-persistent-mult-bg |
| **Genre** | persistent-mult-bg |
| **Theme tags** | synthetic · vendor-neutral · QA fixture |
| **Mood** | balanced |
| **Typography** | UI sans 14px |

## Topology

| Field | Value |
|---|---|
| **Reels** | 5 |
| **Rows** | 3 |
| **Paylines** | 15 |
| **Evaluation** | Lines |

## Symbols

### High-pay
| ID | Name |
|---|---|
| `H1` | Crystal |
| `H2` | Ember |
| `H3` | Frost |

### Mid-pay
| ID | Name |
|---|---|
| `A` | Ace |
| `K` | King |
| `Q` | Queen |

### Low-pay
| ID | Name |
|---|---|
| `J` | Jack |
| `10` | Ten |

## Features
- Multiplier
- Persistent Multiplier

## Persistent Multiplier
appliesTo: base
resetOn: session
startAt: 1
increment: 1

## Big Win Tier
| Tier | Threshold (x bet) | Label |
|---|--:|---|
| 1 | 10 | BIGWINTIER1 |
| 2 | 25 | BIGWINTIER2 |
| 3 | 50 | BIGWINTIER3 |
| 4 | 200 | BIGWINTIER4 |
| 5 | 1000 | BIGWINTIER5 |

## Notes
Synthetic fixture for Wave UQ Ultimate QA. Pattern: Multiplier persists across base-game spins; resets on session end.
