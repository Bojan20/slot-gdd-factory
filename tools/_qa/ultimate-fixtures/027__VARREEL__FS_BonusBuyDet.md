# Synth 027 Bonus Buy (deterministic tier picker)

**Game name:** Synth 027 Bonus Buy (deterministic tier picker)

| Field | Value |
|---|---|
| **Internal name** | UQ-variable_reel-bonus-buy-deterministic |
| **Genre** | bonus-buy-deterministic |
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
| **Reels** | 6 |
| **Rows** | 5 |
| **Paylines** | 1 |
| **Evaluation** | Ways |

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

### Specials
| ID | Name |
|---|---|
| `S` | Scatter |

### Symbol Roster (parser-friendly fallback)

- `H1` — Crystal (HP)
- `H2` — Ember (HP)
- `H3` — Frost (HP)
- `A` — Ace (MP)
- `K` — King (MP)
- `Q` — Queen (MP)
- `J` — Jack (LP)
- `10` — Ten (LP)
- `S` — Scatter (Special)

## Features
- Free Spins
- Bonus Buy Deterministic

## Bonus Buy Tier

| Tier | Cost | Plants | Mult |

|---|--:|---|--:|

| Standard | 75 | 3 scatters | 1× |

| Premium | 150 | 4 scatters | 2× |

| Super | 300 | 5 scatters | 3× |

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
Synthetic fixture for Wave UQ Ultimate QA. Pattern: STANDARD / PREMIUM / SUPER buy tiers — each plants explicit scatter positions.
