# Synth 113 Ladder gamble

**Game name:** Synth 113 Ladder gamble

| Field | Value |
|---|---|
| **Internal name** | UQ-rectangular_stacked_scatter-gamble-ladder |
| **Genre** | gamble-ladder |
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
| **Reels** | 5 |
| **Rows** | 4 |
| **Paylines** | 20 |
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

### Symbol Roster (parser-friendly fallback)

- `H1` — Crystal (HP)
- `H2` — Ember (HP)
- `H3` — Frost (HP)
- `A` — Ace (MP)
- `K` — King (MP)
- `Q` — Queen (MP)
- `J` — Jack (LP)
- `10` — Ten (LP)

## Features
- Gamble Secondary

## Gamble Ladder
maxRung: 10

## Big Win Tier
| Tier | Threshold (x bet) | Label |
|---|--:|---|
| 1 | 10 | BIGWINTIER1 |
| 2 | 25 | BIGWINTIER2 |
| 3 | 50 | BIGWINTIER3 |
| 4 | 200 | BIGWINTIER4 |
| 5 | 1000 | BIGWINTIER5 |

## Notes
Synthetic fixture for Wave UQ Ultimate QA. Pattern: Climbing ladder gamble with steps for incremental risk; collect anytime.
