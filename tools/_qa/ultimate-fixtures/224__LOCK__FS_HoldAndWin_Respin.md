# UQ Fixture 224 · Hold & Win round inside Free Spins · lock_respin

| Field | Value |
|---|---|
| **Internal name** | UQ-lock_respin-hold-in-fs |
| **Genre** | hold-in-fs |
| **Theme tags** | synthetic · vendor-neutral · QA fixture |
| **Mood** | balanced |
| **Typography** | UI sans 14px |

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
| `S` | Scatter |
| `B` | Bonus Coin |

## Features
- Free Spins
- Hold And Win
- Respin

## Free Spins

| Scatters | Spins |

|--:|--:|

| 3 | 14 |

| 4 | 16 |

| 5 | 18 |

## Hold and Win

triggerCount: 6
appliesTo: fs
respinsAwarded: 3
resetOnCollect: 3

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
Synthetic fixture for Wave UQ Ultimate QA. Pattern: Free Spins can spawn a Hold & Win sub-round triggered by 6+ bonus coins during FS.
