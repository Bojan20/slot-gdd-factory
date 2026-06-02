# Midnight Fangs — Game Design Document (Game GDD)

> **Document type**: Game GDD (theme · narrative · UI/UX · mechanics descriptions)
> **Pair**: math companion ships separately (NOT included with this document).
> **Audience**: art, UX, animation teams
> **Status**: greenfield prototype — synthetic fixture for parser stress-test
> **Last update**: 2026-06-02

---

## 1. Game identity

| Field | Value |
|---|---|
| **Internal name** | Midnight Fangs |
| Genre | Cluster-pays video slot |
| **Theme tags** | gothic · vampire · midnight · castle · ornate-baroque |
| Target market | Global, regulator-grade |
| Target session length | 8–14 minutes |
| Player persona | Premium dark-fantasy slot fans, 25–55 |
| Platforms | HTML5 mobile + desktop, portrait 1080×1920 |

---

## 2. Theme & narrative

| Element | Description |
|---|---|
| Setting | Moonlit Carpathian castle; mist rolls through stained-glass windows |
| **Mood** | Brooding · seductive · gothic — never campy, never bright |
| Color palette | Onyx night `#0a0612` · blood crimson `#c1121f` · moon silver `#dde2e8` · ornate gold `#bf8a3d` |
| Typography | Display: blackletter serif · UI: clean modern sans |
| Vibe references | Old-world horror lit, candlelit shadows on velvet drapes |

---

## 3. Topology & layout

| Element | Value |
|---|---|
| Reels | 6 columns |
| Rows | 5 visible per column |
| Evaluation | Cluster pays — 5+ adjacent symbols horizontally/vertically |
| Reel mechanism | Cascade — winning clusters vanish, new symbols drop |
| Min cluster size | 5 symbols |
| Max cluster size | 30 symbols (full grid) |

---

## 4. Symbol roster

### High-pay (Premium, 4)

| ID | Name | Art brief |
|:---:|---|---|
| `CT` | Count | Pale aristocrat in crimson cape, glowing eyes |
| `BR` | Bride | Lace gown, silver hairpiece, ghostly pallor |
| `BT` | Bat | Wings outstretched, fanged silhouette |
| `WO` | Wolf | Snarling, silver fur, blood-red eyes |

### Mid-pay (Artifacts, 4)

| ID | Name | Art brief |
|:---:|---|---|
| `CH` | Chalice | Silver, ruby-encrusted, brimming |
| `CO` | Coffin | Mahogany, ornate brass clasps |
| `CR` | Cross | Tarnished silver, ivy-wrapped |
| `KE` | Key | Antique iron, skull-shaped bow |

### Low-pay (Cards, 4)

| ID | Name | Art brief |
|:---:|---|---|
| `A` | Ace | Ornate blackletter on parchment |
| `K` | King | Blackletter, gilded border |
| `Q` | Queen | Blackletter, rose motif |
| `J` | Jack | Blackletter, dagger motif |

### Specials (3)

| ID | Name | Role | Art brief |
|:---:|---|---|---|
| `W` | Wild | Substitutes all paying symbols (not S, not B) | Glowing crimson rune |
| `S` | Scatter | Triggers Free Spins (4+ on screen) | Pentagram seal, silver glow |
| `B` | Bonus | Triggers Pick Bonus round (3+ on screen) | Coffin-shaped relic |

---

## 5. Features

### 5.1 Base game — Cluster pays

Standard cluster evaluation. Wild substitutes high/mid/low pays (not S, not B). 5+ adjacent matching symbols form a cluster; cluster vanishes, symbols above cascade down, new symbols drop from top. Chain continues until no new clusters form.

### 5.2 Cascade chain mechanic

Each cascade in the same spin increments a chain counter. Visual: ornate gothic frame around grid intensifies each cascade.

### 5.3 Free Spins (Scatter trigger)

4+ Scatters anywhere → Free Spins round. Persistent multiplier feature active during Free Spins (multiplier grows with each cascade, never resets within the round).

### 5.4 Pick Bonus (Bonus trigger)

3+ Bonus symbols anywhere → Pick Bonus round. Player picks coffins; reveals are credit prizes, multipliers, or "End" terminator.

### 5.5 Bonus Buy

Player can purchase direct entry to Free Spins. Two tiers available:
- Standard FS — base entry
- Hyper FS — boosted variant with enhanced multiplier ladder

Region-gated — disabled in UK / NL / DE markets per regulator rules.

### 5.6 Win Cap

Per-spin win is capped at the configured maximum. Once the cap is reached within a feature, the feature auto-terminates with a Cap Reached celebration animation.

### 5.7 Super Symbol

Occasionally a 2×2, 3×3, or 4×4 mega-symbol lands on the grid, occupying multiple positions with the same symbol identity. Treated as multiple matching symbols for cluster evaluation.

---

## 6. Out of scope

| Mechanic | Status |
|---|---|
| Tumble / cascade mechanic on fixed-reel lines | Not in this product — cluster-pays only |
| Hold & Win / cash-on-reel | Not in this product |
| Walking Wild | Not in this product |
| Sticky Wild outside Free Spins | Not in this product |
| Lightning multiplier | Not in this product |

---

## 7. Math reference (companion document, NOT part of this GDD)

**Everything that affects payout, probability, RTP, hit-rate, volatility, jackpot odds, or any number visible to the player** lives in the separate Math companion document. This Game GDD does **not** define:

- RTP target
- Volatility target
- Max win cap value
- Reel weight tables
- Cluster paytable values
- Multiplier ladder values
- Free Spins count
- Bonus Buy prices

Those land via the PAR hot-swap pipeline at integration time.

---

## 8. UI / UX

| Element | Description |
|---|---|
| Spin button | Ornate gothic frame, crimson glow on hover |
| Bet panel | Wax-seal-style increment chips |
| Win counter | Blackletter typography with silver shimmer |
| Cluster highlight | Crimson rune outline around winning cluster, pulses 600ms |
| Cascade VFX | Symbols dissolve into red mist, new symbols materialize from above |
| FS intro | Crimson curtain reveal, bat swarm transition |
| FS HUD | Persistent multiplier strip top-center |
| Big win tier | Standard → Big → Mega → Epic (visual escalation) |
| Cap-reached cue | Full-grid pentagram flash, "CAP REACHED" blackletter overlay |
