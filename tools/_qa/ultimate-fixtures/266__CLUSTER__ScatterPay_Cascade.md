# Synth 266 Scatter pays on hex grid

**Game name:** Synth 266 Scatter pays on hex grid

| Field | Value |
|---|---|
| **Internal name** | UQ-cluster-scatter-pay-hex |
| **Genre** | scatter-pay-hex |
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
| **Reels** | 7 |
| **Rows** | 7 |
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
| `S` | Scatter |

### Symbol Roster (parser-friendly fallback)

- `H1` — Garnet (HP)
- `H2` — Emerald (HP)
- `H3` — Sapphire (HP)
- `M1` — Topaz (MP)
- `M2` — Citrine (MP)
- `L1` — Amber (LP)
- `L2` — Slate (LP)
- `S` — Scatter (Special)

## Features
- Scatter Pays
- Cascade

## Scatter Pays
minMatch: 8
appliesTo: grid

## Big Win Tier
| Tier | Threshold (x bet) | Label |
|---|--:|---|
| 1 | 10 | BIGWINTIER1 |
| 2 | 25 | BIGWINTIER2 |
| 3 | 50 | BIGWINTIER3 |
| 4 | 200 | BIGWINTIER4 |
| 5 | 1000 | BIGWINTIER5 |

## Free Spins

### Trigger
3+ Scatter symbols anywhere.

### Award Table
| Scatters | Spins awarded |
|:---:|:---:|
| 3 | 5 |
| 4 | 5 |
| 5 | 5 |

### Retrigger
No retrigger — synthetic QA fixture.

## Notes
Synthetic fixture for Wave UQ Ultimate QA. Pattern: Hex / cluster grid evaluates 8+ matching scatter pays; cascade after.
