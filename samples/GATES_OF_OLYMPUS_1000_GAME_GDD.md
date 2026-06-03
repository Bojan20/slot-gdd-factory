# Gates of Olympus 1000

**Game Design Document — Reverse Engineered Analysis**

| Internal name | Gates of Olympus 1000 |
| Theme tags | Antička Grčka · Zeus · Olimp · Mythology |
| Mood | High-volatility · Dramatic · Anticipation |
| Setting | Mount Olympus / Heavens |
| Genre | Video Slot — Scatter Pays |
| Target market | Global · High-volatility igrači |

---

## 01 · Vision

> Scatter pays + akumulirajući multiplikatori do 1000x + maksimalni dobitak 15,000x.

Nadogradnja originalne igre Gates of Olympus sa povećanim maksimalnim dobitkom
(5,000x → **15,000x**) i višim multiplikatorima (500x → **1000x**). Zadržava isti
matematički model i mehanike, ali nudi veći potencijal za ekstremne dobitke.

---

## 02 · Topology

| Parametar | Vrednost | Napomena |
|---|---|---|
| Reels | 6 | columns |
| Rows | 5 | rows |
| Paylines | — | none (scatter pays) |
| Evaluation | Pay anywhere | Min. 8 istih simbola bilo gde |
| Direction | — | direction-less (count-based) |
| RTP (standard) | 96.50% | Glavna verzija |
| Max win | 15000x | Hard cap |
| Volatility | 5/5 — Maksimalna | High |
| Hit frequency | ~25-30% | Procena |

---

## 03 · Symbols & Paytable

8 regularnih + 1 Scatter + 1 Multiplier Orb. Format paytable-a je bucket-based —
više simbola istog tipa = veća isplata.

### High-pay

| ID | Name | min8 | 8-9 | 10-11 | 12+ |
|---|---|:-:|:-:|:-:|:-:|
| `Z` | Zeus (Crown) | 8 | 10x | 25x | 50x |
| `H` | Hourglass    | 8 | 2.5x | 10x | 25x |
| `R` | Ring         | 8 | 2x | 5x | 15x |
| `C` | Chalice      | 8 | 1.5x | 2x | 12x |

### Low-pay

| ID | Name | min8 | 8-9 | 10-11 | 12+ |
|---|---|:-:|:-:|:-:|:-:|
| `RG` | Red Gem    | 8 | 1x | 1.5x | 5x |
| `PG` | Purple Gem | 8 | 0.8x | 1.2x | 4x |
| `YG` | Yellow Gem | 8 | 0.5x | 1x | 3x |
| `GG` | Green Gem  | 8 | 0.4x | 0.9x | 2.5x |
| `BG` | Blue Gem   | 8 | 0.25x | 0.75x | 2x |

### Specials

| ID | Name | Role |
|---|---|---|
| `S` | Scatter (Zeus) | Trigger only — ne plaća direktno |
| `M` | Multiplier Orb | 2x – 1000x — stay-on-screen during tumble |

Scatter pays = simboli se plaćaju bez obzira na poziciju, samo ukupan broj na mreži.

---

## 04 · Tumble (Cascade) Mechanic

Reel mechanism — Cascade. Tumble mehanika u svakom spinu:

- Pobednički simboli nestaju sa mreže
- Simboli iznad padaju na prazna mesta (gravitacija)
- Novi simboli padaju sa vrha
- Proces se ponavlja dok postoje dobitne kombinacije
- Multiplier orbi **ostaju na ekranu** tokom celog tumblesa

---

## 05 · Multiplier Mehanika

| Category | Values | Probability |
|---|---|---|
| Nizki | 2x – 5x | ~60% |
| Srednji | 6x – 25x | ~30% |
| Visoki | 50x – 100x | ~8% |
| Ekstremni | 250x – 500x | ~1.8% |
| Max | 1000x | ~0.2% |

```
// Kalkulacija multiplikatora
Total_Multiplier = Σ(svi vidljivi multiplieri)
Total_Win = (Dobitak od tumblesa) × Total_Multiplier
// Važno: Multiplier se primenjuje samo na dobitke u tom tumble lancu
```

---

## 06 · Free Spins

### Trigger
4+ Scatter simbola (Zeus) bilo gde na mreži.
**Nagrada:** 15 Free Spins.

### Akumulirajući Multiplier
Svaki multiplier orb koji učestvuje u dobitku se dodaje u
**Bonus_Multiplier** (počinje na 0x).

### Globalni Multiplier
Bonus_Multiplier se primenjuje na **svaki naredni dobitak** u bonusu.

### Retrigger
3+ Scatter tokom bonusa = **+5 Free Spins** (neograničeno).

---

## 07 · Bonus Buy

| Parametar | Vrednost |
|---|---|
| Cena | **100x** trenutni ulog |
| Garantuje | 4+ Scatter simbola (trigger bonusa) |
| RTP | Identičan base RTP (96.50%) |
| Verovatnoća triggera (bez Ante) | ~1/400 spinova |
| Verovatnoća triggera (sa Ante) | ~1/200 spinova |

---

## 08 · Ante Bet

| Parametar | Vrednost |
|---|---|
| Cena | +25% uloga |
| Efekat | Duplira verovatnoću za bonus trigger |
| Primer | Ulog €1.00 → €1.25, šansa raste sa ~0.25% na ~0.50% |

---

## 09 · Win Presentation

| Knob | Vrednost |
|---|---|
| mode | per-symbol (scatter pays uses symbol-count buckets) |
| perEventMs | 600 |
| maxEvents | 9 |
| noWinChance | 0.7 |

---

## 10 · Scatter Celebration

| Knob | Vrednost |
|---|---|
| enabled | true |
| duration-ms | 3000 |
| pulse-cycles | 4 |
| glow-color | 255, 215, 0 |
| glow-peak | 1.8 |

---

## 11 · Anticipation

| Knob | Vrednost |
|---|---|
| enabled | true |
| hold-ms | 700 |
| pulse-ms | 1400 |

---

Gates of Olympus 1000 — GDD v1.0 · Reverse Engineered Analysis · 2026-06-03
