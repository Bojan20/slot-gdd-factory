# Synth 105 Card gamble (red/black)

**Game name:** Synth 105 Card gamble (red/black)

| Field | Value |
|---|---|
| **Internal name** | UQ-hexagonal-gamble-card |
| **Genre** | gamble-card |
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
| **Rows** | 5 |
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

### Symbol Roster (parser-friendly fallback)

- `H1` — Garnet (HP)
- `H2` — Emerald (HP)
- `H3` — Sapphire (HP)
- `M1` — Topaz (MP)
- `M2` — Citrine (MP)
- `L1` — Amber (LP)
- `L2` — Slate (LP)

## Features
- Gamble

## Gamble
mode: card

## Big Win Tier
| Tier | Threshold (x bet) | Label |
|---|--:|---|
| 1 | 10 | BIGWINTIER1 |
| 2 | 25 | BIGWINTIER2 |
| 3 | 50 | BIGWINTIER3 |
| 4 | 200 | BIGWINTIER4 |
| 5 | 1000 | BIGWINTIER5 |

## Notes
Synthetic fixture for Wave UQ Ultimate QA. Pattern: After win: optional risk on next card colour for ×2.
