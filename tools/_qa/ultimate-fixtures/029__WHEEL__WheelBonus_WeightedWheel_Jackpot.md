# Synth 029 Wheel bonus with weighted segments

**Game name:** Synth 029 Wheel bonus with weighted segments

| Field | Value |
|---|---|
| **Internal name** | UQ-wheel-wheel-bonus |
| **Genre** | wheel-bonus |
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
| **Reels** | 1 |
| **Rows** | 1 |
| **Paylines** | 1 |
| **Evaluation** | wheel |

This game uses a wheel grid topology.

## Symbols

### High-pay
| ID | Name |
|---|---|
| `H1` | Crown |
| `H2` | Bell |

### Mid-pay
| ID | Name |
|---|---|
| `A` | Ace |
| `K` | King |

### Low-pay
| ID | Name |
|---|---|
| `J` | Jack |
| `10` | Ten |

### Specials
| ID | Name |
|---|---|
| `S` | Scatter |

### Symbol Roster (parser-friendly fallback)

- `H1` — Crown (HP)
- `H2` — Bell (HP)
- `A` — Ace (MP)
- `K` — King (MP)
- `J` — Jack (LP)
- `10` — Ten (LP)
- `S` — Scatter (Special)

## Features
- Wheel Bonus
- Weighted Wheel Segments
- Jackpot

## Wheel Bonus

segmentCount: 12

## Weighted Wheel Segments

| Segment | Value | Weight |

|---|--:|--:|

| 2× bet | 2 | 30 |

| 5× bet | 5 | 20 |

| MINI | jackpot | 5 |

| MAJOR | jackpot | 1 |

## Big Win Tier
| Tier | Threshold (x bet) | Label |
|---|--:|---|
| 1 | 10 | BIGWINTIER1 |
| 2 | 25 | BIGWINTIER2 |
| 3 | 50 | BIGWINTIER3 |
| 4 | 200 | BIGWINTIER4 |
| 5 | 1000 | BIGWINTIER5 |

## Notes
Synthetic fixture for Wave UQ Ultimate QA. Pattern: Scatter triggers a wheel; segments are non-uniformly weighted; 4 jackpot cells.
