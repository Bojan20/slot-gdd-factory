# UQ Fixture 186 · Persistent base-game multiplier · cluster

| Field | Value |
|---|---|
| **Internal name** | UQ-cluster-persistent-mult-bg |
| **Genre** | persistent-mult-bg |
| **Theme tags** | synthetic · vendor-neutral · QA fixture |
| **Mood** | balanced |
| **Typography** | UI sans 14px |

## Topology

| Field | Value |
|---|---|
| **Reels** | 7 |
| **Rows** | 7 |
| **Paylines** | — |
| **Evaluation** | Cluster |

## Symbols

### High-pay
| ID | Name |
|---|---|
| `H1` | Garnet |
| `H2` | Emerald |
| `H3` | Sapphire |

### Mid-pay
| ID | Name |
|---|---|
| `M1` | Topaz |
| `M2` | Citrine |

### Low-pay
| ID | Name |
|---|---|
| `L1` | Amber |
| `L2` | Slate |

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
