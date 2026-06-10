# Synth 218 Mystery symbol on cluster pays

**Game name:** Synth 218 Mystery symbol on cluster pays

| Field | Value |
|---|---|
| **Internal name** | UQ-megaclusters-mystery-cluster |
| **Genre** | mystery-cluster |
| **Theme tags** | synthetic · vendor-neutral · QA fixture |
| **Mood** | balanced |
| **Setting** | abstract neon arcade |
| **Vibe refs** | retro · synthetic · QA |
| **Typography** | UI sans 14px |

Mood: balanced.
Setting: abstract neon arcade backdrop.
Vibe references: retro · synthetic · QA.

## Topology

| Field | Value |
|---|---|
| **Reels** | 4 |
| **Rows** | 4 |
| **Paylines** | 1 |
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

### Symbol Roster (parser-friendly fallback)

- `H1` — Garnet (HP)
- `H2` — Emerald (HP)
- `H3` — Sapphire (HP)
- `M1` — Topaz (MP)
- `M2` — Citrine (MP)
- `L1` — Amber (LP)
- `L2` — Slate (LP)
- `MY` — Mystery (Special)

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
