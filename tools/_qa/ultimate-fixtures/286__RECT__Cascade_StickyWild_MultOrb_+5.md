# Synth 286 Maximalist

**Game name:** Synth 286 Maximalist

| Field | Value |
|---|---|
| **Internal name** | UQ-rectangular-maximalist-fs-hold-mult |
| **Genre** | maximalist-fs-hold-mult |
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
| **Rows** | 3 |
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

### Specials
| ID | Name |
|---|---|
| `W` | Wild |
| `S` | Scatter |
| `M` | Multiplier Orb |
| `B` | Bonus Coin |

### Symbol Roster (parser-friendly fallback)

- `H1` — Crystal (HP)
- `H2` — Ember (HP)
- `H3` — Frost (HP)
- `A` — Ace (MP)
- `K` — King (MP)
- `Q` — Queen (MP)
- `J` — Jack (LP)
- `10` — Ten (LP)
- `W` — Wild (Special)
- `S` — Scatter (Special)
- `M` — Multiplier Orb (Special)
- `B` — Bonus Coin (Special)

## Features
- Cascade
- Sticky Wild
- Multiplier Orb
- Bonus Buy
- Free Spins
- Progressive Free Spins
- Hold And Win
- Gamble

## Bonus Buy
costX: 100

## Hold and Win
triggerCount: 6
respinsAwarded: 3

## Progressive Free Spins
startAt: 1
increment: 1
cap: 10

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
Synthetic fixture for Wave UQ Ultimate QA. Pattern: Cascade + sticky wild + multiplier orb + bonus buy + Hold & Win in FS + progressive FS multiplier + gamble.
