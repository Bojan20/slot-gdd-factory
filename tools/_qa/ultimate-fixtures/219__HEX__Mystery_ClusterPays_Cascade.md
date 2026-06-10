# UQ Fixture 219 · Mystery symbol on cluster pays · hexagonal

| Field | Value |
|---|---|
| **Internal name** | UQ-hexagonal-mystery-cluster |
| **Genre** | mystery-cluster |
| **Theme tags** | synthetic · vendor-neutral · QA fixture |
| **Mood** | balanced |
| **Typography** | UI sans 14px |

## Topology

| Field | Value |
|---|---|
| **Reels** | 7 |
| **Rows** | 5 |
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

### Specials
| ID | Name |
|---|---|
| `MY` | Mystery |

## Features
- Mystery Symbol
- Cluster Pays
- Cascade

## Mystery Symbol
revealsTo: single_payable
resolveBefore: cluster_eval

## Big Win Tier
| Tier | Threshold (x bet) | Label |
|---|--:|---|
| 1 | 10 | BIGWINTIER1 |
| 2 | 25 | BIGWINTIER2 |
| 3 | 50 | BIGWINTIER3 |
| 4 | 200 | BIGWINTIER4 |
| 5 | 1000 | BIGWINTIER5 |

## Notes
Synthetic fixture for Wave UQ Ultimate QA. Pattern: Mystery symbols land then reveal a matching paying icon; cluster cascade evaluates after reveal.
