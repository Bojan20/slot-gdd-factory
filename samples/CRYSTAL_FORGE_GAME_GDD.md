# Crystal Forge — Game Design Document (Game GDD)

> **Document type**: Game GDD (theme · narrative · UI/UX · animations · audio)
> **Pair**: must be paired with `CRYSTAL_FORGE_MATH_GDD.md`
> **Audience**: art, UX, animation, audio teams
> **Status**: greenfield prototype — W6 template-generality proof
> **Last update**: 2026-05-31

---

## 1. Game identity

| Field | Value |
|---|---|
| Internal name | Crystal Forge |
| Genre | Video slot |
| Theme tags | gems · forge · crystal · mid-volatility · craft |
| Target market | Global, regulator-grade |
| Target session length | 6–12 minutes |
| Player persona | Casual + mid-volatility slot fans, 21–50 |
| Platforms | HTML5 mobile + desktop, portrait 1080×1920 |

---

## 2. Theme & narrative

| Element | Description |
|---|---|
| Setting | Subterranean forge cavern; molten crystal pours from ceiling stalactites |
| Mood | Warm · mystical · industrious — gem light reflecting off cave walls |
| Color palette | Deep amethyst `#2a1b4d` · ember gold `#ffaa00` · cool sapphire `#3a6fff` · marble white |
| Typography | Display: chiseled serif · UI: clean modern sans |
| Vibe references | A jeweler's forge under the mountain, sparks drifting upward |

---

## 3. Topology & layout

| Element | Value |
|---|---|
| Reels | 5 |
| Rows | 3 |
| Paylines | 10 fixed |
| Reel mechanism | Independent weighted reels |
| Anticipation | Yes — slow stop on reels 4–5 when 2+ Scatters already landed |

### Payline patterns (rows per reel)

| # | Pattern | Shape |
|:---:|---|---|
| 1 | `1, 1, 1, 1, 1` | Middle straight |
| 2 | `0, 0, 0, 0, 0` | Top straight |
| 3 | `2, 2, 2, 2, 2` | Bottom straight |
| 4 | `0, 1, 2, 1, 0` | V down |
| 5 | `2, 1, 0, 1, 2` | V up |
| 6 | `1, 0, 1, 0, 1` | Sawtooth top |
| 7 | `1, 2, 1, 2, 1` | Sawtooth bottom |
| 8 | `0, 0, 1, 2, 2` | Top-to-bottom slope |
| 9 | `2, 2, 1, 0, 0` | Bottom-to-top slope |
| 10 | `1, 1, 0, 1, 1` | Apex up |

---

## 4. Symbol roster

### High-pay (Gems, 3)

| ID | Name | Art brief |
|:---:|---|---|
| `D` | Diamond | Octahedron, brilliant-cut, refraction sparkle |
| `R` | Ruby | Cabochon, deep red glow, ember halo |
| `E` | Emerald | Step-cut, mossy green, soft inner light |

### Mid-pay (Tools, 3)

| ID | Name | Art brief |
|:---:|---|---|
| `HM` | Hammer | Bronze head, oak handle, glowing rim |
| `PK` | Pickaxe | Iron blade, leather-wrapped grip |
| `TG` | Tongs | Forged-iron grip, ember crackle |

### Low-pay (Cards, 4)

| ID | Name | Art brief |
|:---:|---|---|
| `A` | Ace | Engraved on slate, ember letter |
| `K` | King | Engraved on slate |
| `Q` | Queen | Engraved on slate |
| `J` | Jack | Engraved on slate |

### Specials (2)

| ID | Name | Role | Art brief |
|:---:|---|---|---|
| `W` | Wild | Substitutes all paying symbols (not S) | Glowing molten crystal cluster |
| `S` | Scatter | Triggers Free Spins (3+ on screen) | Ornate runestone with hammer crest |

> **Note**: Crystal Forge has **no Bonus Orb / Hold & Win**. The only feature
> trigger is Scatter → Free Spins. This proves the template handles
> games with a *different feature roster* than Wrath.

---

## 5. Features

### 5.1 Base game

Standard left-to-right line evaluation. Wild substitutes high/mid/low pays. Scatter pays anywhere.

### 5.2 Lightning multiplier (base-game feature)

After any spin with a base line win, a Spark (lightning's stand-in for this theme) may strike, multiplying the win.

**Visual**: ember meter charges; on trigger, a fork of sparks flashes across the reels; multiplier rolls on a horizontal strip (×2 · ×3 · ×5 · ×10).

**Disabled in**: Free Spins.

### 5.3 Free Spins (Scatter trigger)

3+ Scatters anywhere → Free Spins.

**Awards**:

| Scatters | Spins awarded |
|:---:|:---:|
| 3 | 12 |
| 4 | 15 |
| 5 | 20 |

**Progressive multiplier**: starts at ×1, +1 per winning FS spin, caps at ×8. Retrigger possible.

### 5.4 Win cap

Maximum win per spin: **2500× total bet**. Hits "FORGE TAMED" celebration plaque.

---

## 6. UI/UX flow

### Main screen (portrait 1080×1920)

```
┌────────────────────────────────────────┐
│  ⚙   EMBER METER ▓▓░░   BALANCE 1000  │
├────────────────────────────────────────┤
│                                        │
│    [cavern parallax background]        │
│                                        │
│    ┌──────────────────────────────┐    │
│    │   5 × 3   REEL  GRID          │    │
│    └──────────────────────────────┘    │
│                                        │
│         (stalactite frame)             │
│                                        │
├────────────────────────────────────────┤
│  BET 1.00 ▼      WIN 0.00     [⟳ SPIN] │
├────────────────────────────────────────┤
│  STATUS BAR — Press SPIN to play…     │
└────────────────────────────────────────┘
```

### Bet ladder

| Tier | Values |
|---|---|
| Denominations (EUR per coin) | 0.01 · 0.02 · 0.05 · 0.10 · 0.20 · 0.50 · 1.00 |
| Multipliers | 1 · 2 · 5 · 10 · 20 · 50 · 100 · 200 |
| Default total bet | 1.00 |

### Main flows

| Flow | Screens |
|---|---|
| Spin | Main → spin → win count-up |
| FS entry | Spin → 3+ Scatters → epic intro → FS HUD active |
| FS exit | All spins done → totals plaque → back to base |
| Big win | ≥ 10×: BIG · ≥ 25×: MEGA · ≥ 50×: EPIC |

---

## 7. Audio brief

| Layer | Tone |
|---|---|
| Ambient bed | Forge hum, distant hammer clinks, dripping water |
| Reel spin | Whoosh + soft anvil tap on stop |
| Symbol land HP | Brass chime |
| Symbol land MP | Iron ring |
| Symbol land LP | Stone click |
| Wild land | Molten crystal crackle |
| Scatter land | Resonant gong |
| Spark strike | Electric ember crackle |
| FS intro | Brass swell + hammer cadence |
| Big win tiers | Brass swell building per tier |
| Max-win cap | Cathedral choir + brass climax |

---

## 8. Animation timing

| Event | Duration |
|---|---:|
| Spin (normal) | 1200 ms |
| Spin (turbo) | 600 ms |
| Win count-up base | 600 ms |
| Win count-up big | 4000 ms / tier |
| Symbol reveal | 200–500 ms |
| Spark strike | 1200 ms |
| FS intro | 4000 ms |

---

## 9. Multi-jurisdiction matrix

| Jurisdiction | Stake cap | Spin pacing | Auto-play | Turbo | Bonus wager cap |
|---|---:|---:|:---:|:---:|---:|
| UKGC (UK) | £5.00 | 2500 ms | ❌ | ❌ | 10× |
| MGA | — | — | ✅ | ✅ | — |
| GLI-19 | — | — | ✅ | ✅ | — |
| NJ DGE | — | — | ✅ | ✅ | — |
| ADM (Italy) | €1.00 | — | ❌ | ✅ | — |

---

## 10. Asset deliverables

| Bucket | Items | Format |
|---|---|---|
| Symbols | 12 base + 12 win variants | PNG 256×256, SVG |
| Backgrounds | Cavern loop + FS variant | WebM 1080×1920 |
| Spark sprites | 5 variants | PNG sprite-sheet |
| Big-win plaques | BIG · MEGA · EPIC | PNG + particles |
| UI chrome | Buttons + drawer + menus | SVG |
| Logo | Crystal Forge wordmark | SVG |

---

## 11. Math interface

Theme + UX in this doc. Numbers live in `CRYSTAL_FORGE_MATH_GDD.md`. Pair them and feed both through `slot-factory ingest` to produce `game.config.json`.

---

*Generated 2026-05-31 · vendor-neutral · greenfield 2nd-game proof for slot-factory v1*
