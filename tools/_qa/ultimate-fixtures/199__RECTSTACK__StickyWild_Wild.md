# Synth 199 Sticky wilds in base game

**Game name:** Synth 199 Sticky wilds in base game

| Field | Value |
|---|---|
| **Internal name** | UQ-rectangular_stacked_scatter-sticky-wild-bg |
| **Genre** | sticky-wild-bg |
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

### Specials
| ID | Name |
|---|---|
| `W` | Wild |

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

## Features
- Sticky Wild
- Wild

## Sticky Wild
appliesTo: base
resetOn: spin_after_stick

## Big Win Tier
| Tier | Threshold (x bet) | Label |
|---|--:|---|
| 1 | 10 | BIGWINTIER1 |
| 2 | 25 | BIGWINTIER2 |
| 3 | 50 | BIGWINTIER3 |
| 4 | 200 | BIGWINTIER4 |
| 5 | 1000 | BIGWINTIER5 |

## Notes
Synthetic fixture for Wave UQ Ultimate QA. Pattern: Rare pattern — sticky wilds persist across base-game spins, not only Free Spins.
