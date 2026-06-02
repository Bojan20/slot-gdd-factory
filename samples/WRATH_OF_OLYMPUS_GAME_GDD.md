# Wrath of Olympus — Game Design Document (Game GDD)

> **Document type**: Game GDD (theme · narrative · UI/UX · animations · audio)
> **Pair**: must be paired with `WRATH_OF_OLYMPUS_MATH_GDD.md` for a playable build
> **Audience**: art team, UX designers, animation team, audio team
> **Owner**: Boki · VanVinkl Studio
> **Status**: production-locked, mirrors shipped v12.1.0
> **Last update**: 2026-05-31

---

## 1. Game identity

| Field | Value |
|---|---|
| **Internal name** | Wrath of Olympus |
| **Genre** | Video slot |
| **Theme tags** | greek-mythology · gods · lightning · olympus · premium-fantasy |
| **Target market** | Global, regulator-grade (UKGC / MGA / GLI-19 / NJ DGE / Quebec / ADM) |
| **Target session length** | 8–15 minutes (mobile) · 20–40 minutes (desktop) |
| **Player persona** | Recreational + high-volatility slot enthusiast aged 25–55 |
| **Platforms** | HTML5 (mobile + desktop), portrait-first, 1080×1920 design grid |

---

## 2. Theme & narrative

| Element | Description |
|---|---|
| **Setting** | Mount Olympus during a divine storm; clouds parted, lightning forking through the columns |
| **Protagonist** | The player (mortal champion) summoned by Zeus to face the gods' wrath |
| **Mood** | Epic · regal · stormy · cinematic — never cartoony, never grim |
| **Color palette** | Deep navy `#0d1437` (background) · electric cyan `#3df0ff` (lightning) · gold `#ffd700` (premium accents) · marble white (UI panels) |
| **Typography** | Display: ornate serif (god names) · UI: clean modern sans (Inter / SF Pro) |
| **Vibe references** | Stormy night above a marble temple; thunder rumbles; coins glint when struck |

---

## 3. Topology & layout

| Element | Value |
|---|---|
| **Reels** | 5 columns |
| **Rows** | 3 visible per column |
| **Paylines** | 10 fixed |
| **Reel mechanism** | Independent weighted reels (no shared strip) |
| **Anticipation** | Yes — slow-stop on reels 3-4-5 when ≥2 Scatters already landed |
| **Reel spin profile** | WINDUP → ACCEL → STEADY → DECEL → CUSHION BOUNCE (mirrors `SPIN_PROFILE_NORMAL`) |

### Paylines (visual reference, 1-indexed)

| # | Pattern (rows per reel) | Shape label |
|:---:|---|---|
| 1 | `1, 1, 1, 1, 1` | Middle straight |
| 2 | `0, 0, 0, 0, 0` | Top straight |
| 3 | `2, 2, 2, 2, 2` | Bottom straight |
| 4 | `0, 1, 2, 1, 0` | V down (Λ) |
| 5 | `2, 1, 0, 1, 2` | V up (V) |
| 6 | `0, 0, 1, 0, 0` | Top dip |
| 7 | `2, 2, 1, 2, 2` | Bottom rise |
| 8 | `1, 0, 0, 0, 1` | Zig top |
| 9 | `1, 2, 2, 2, 1` | Zig bottom |
| 10 | `0, 1, 1, 1, 0` | Shallow V |

---

## 4. Symbol roster

### High-pay symbols (Gods, 3) — premium reveals + booming SFX

| ID | Name | Art brief | Reveal animation |
|:---:|---|---|---|
| `Z` | Zeus | Stern bearded god, gold crown, holding fork-lightning bolt; chest glow on win | Lightning fork strikes from above; symbol flashes white → gold; 600 ms |
| `H` | Hades | Dark helm, smoldering eyes, ember motes drifting | Embers swirl up; symbol pulses ember-orange; 500 ms |
| `P` | Poseidon | Sea-foam beard, trident raised, water droplets on shoulders | Sea ripple wash from bottom; cyan tint; 450 ms |

### Mid-pay symbols (Items, 3)

| ID | Name | Art brief |
|:---:|---|---|
| `HM` | Helm | Bronze Spartan helm, crest plume |
| `SH` | Shield | Round hoplite shield, embossed gorgon face |
| `SW` | Sword | Short xiphos blade, leather grip |

### Low-pay symbols (Items, 5)

| ID | Name | Art brief |
|:---:|---|---|
| `LA` | Lyre | Curved gold lyre, taut strings |
| `GM` | Gold Coin | Drachma-style coin with profile bust |
| `AM` | Amphora | Twin-handle clay vessel, geometric trim |
| `LR` | Laurel | Olive-laurel wreath, fresh green |
| `VA` | Vase | Slender black-figure pottery |

### Specials

| ID | Name | Role | Art brief | Reveal |
|:---:|---|---|---|---|
| `W` | Wild | Substitutes all paying symbols (not S, not B) | Bolt of lightning frozen mid-strike, electric corona | Crackle + arc to neighbours; 800 ms |
| `S` | Scatter | Triggers Free Spins (3+ on screen) | Stone tablet etched with omega Ω, glowing rim | Stone rumble + slow glow; 700 ms |
| `B` | Bonus Orb | Triggers Hold & Win (6+ on screen) | Floating cracked-marble orb with electric core, value visible (1×, 5×, JACKPOT…) | Orb spawns, value snaps in, glass-clink + low-bass thump; 500 ms |

---

## 5. Features (narrative description)

### 5.1 Base game

Player spins the reels. Lines are evaluated left-to-right from reel 1. Wilds substitute high/mid/low pays. Scatter pays anywhere on the grid.

**Visual**: marble columns frame the reel area. Storm clouds drift behind the grid. Reel grid has a subtle gold inner border that pulses when a win lands.

### 5.2 Lightning multiplier (base-game feature)

After any spin that **already produced a base win**, Zeus may strike with a multiplier bolt that multiplies that spin's win.

**Mechanic narrative**: Zeus's avatar (top-left HUD) charges via a glowing meter. When the bolt fires, a strip-meter scrolls horizontally (×2 · ×3 · ×5 · ×10) and a pointer halts on the rolled value. The base win is recomputed and big-win tier animation may trigger.

**Disabled in**: Free Spins (FS uses its own progressive multiplier).

### 5.3 Free Spins (Scatter trigger)

3+ Scatters anywhere → Free Spins.

**Narrative**: temple ceiling cracks open, Zeus's eye glares through, screen shakes, "FREE SPINS" placard rises from below.

**Awards**:

| Scatters | Spins awarded |
|:---:|:---:|
| 3 | 14 |
| 4 | 16 |
| 5 | 18 |

**Progressive multiplier**: starts at ×1, increments by ×1 on every spin where a line win lands, caps at ×10. Retrigger possible (extra spins added to remaining counter). HUD shows: spins remaining · current multiplier · cumulative FS total.

### 5.4 Hold & Win (Bonus Orb trigger)

6+ Bonus Orbs anywhere → Hold & Win round.

**Narrative**: the screen darkens; marble pedestal rises; the 6+ orbs lock in place; remaining cells are blank.

**Round mechanic**:

| Step | Behaviour |
|---|---|
| Initial respins | 3 |
| New orb landed | Locks; respins reset to 3 |
| Round ends | When 3 consecutive respins yield no new orb |
| Full grid bonus | If all 15 cells fill with orbs → **+500× total bet** (Grand-tier celebration) |

Each orb carries a value (revealed on land) or a **MINI / MINOR / MAJOR / GRAND jackpot** label. At round-end, all orb values + jackpots are summed × total bet.

### 5.5 Win cap

Maximum win per spin (including all feature payouts) is **5000× total bet**. Hit cap triggers a "OLYMPUS REACHED" celebration plaque (one-time per session animation, unless retriggered after 24h).

---

## 6. UI/UX flow

### 6.1 Main screen layout (portrait 1080×1920)

```
┌────────────────────────────────────────┐
│  ⚙   ZEUS METER ▓▓░░░   BALANCE 1000  │  ← top HUD (80 px)
├────────────────────────────────────────┤
│                                        │
│    [storm cloud parallax background]   │
│                                        │
│    ┌──────────────────────────────┐    │
│    │                              │    │
│    │   5 × 3   REEL  GRID          │    │
│    │                              │    │
│    └──────────────────────────────┘    │
│                                        │
│         (marble column frame)          │
│                                        │
├────────────────────────────────────────┤
│  BET 1.00 ▼      WIN 0.00     [⟳ SPIN] │  ← bottom HUD (140 px)
├────────────────────────────────────────┤
│  STATUS BAR — Press SPIN to play…     │  ← rolling messages (44 px)
└────────────────────────────────────────┘
```

### 6.2 Bet denominations & multipliers

Game must support **multi-denomination + multi-multiplier**:

| Tier | Values |
|---|---|
| Denominations (currency-per-coin) | 0.01 · 0.02 · 0.05 · 0.10 · 0.20 · 0.25 · 0.50 · 1.00 · 2.00 |
| Bet multipliers | 1× · 2× · 3× · 5× · 8× · 10× · 15× · 20× · 25× · 30× · 40× · 50× · 60× · 75× · 100× · 150× · 200× · 250× · 300× · 400× · 500× · 600× · 800× · 1000× |
| Default | 1.00 EUR · ×1 → 1.00 total bet |

### 6.3 Main flows

| Flow | User intent | Screens |
|---|---|---|
| **Spin** | Place bet, see result | Main → spin animation → win count-up → return |
| **Adjust bet** | Pick denom + multiplier | Main → bet-picker drawer → Main |
| **Paytable** | See symbol payouts | Main → menu → paytable scroll → back |
| **Settings** | Audio · turbo · auto-play | Main → menu → settings → back |
| **Auto-play** | Run N spins automatically with loss/win cutoffs | Main → menu → auto-play config → main with auto-indicator |
| **Free Spins entry** | 3+ Scatters trigger | Spin → epic intro overlay (4s) → FS HUD on top + reels continue |
| **Free Spins exit** | All spins consumed | Last spin → totals plaque → "Returning to Olympus" outro → main with FS total added |
| **Hold & Win entry** | 6+ Bonus Orbs | Spin → orbs lock in place → "HOLD & WIN" plaque (3s) → respin mode |
| **Hold & Win exit** | 3 respins no new orb (or full grid) | All values revealed → total sum count-up → main with bonus total added |
| **Big-win celebration** | Win ≥ 10× / 25× / 50× total bet | Win count-up halts → BIG / MEGA / EPIC plaque → particles 4s per tier |

### 6.4 Big-win thresholds

| Tier | Trigger | Plaque duration | VFX |
|:---:|:---:|:---:|---|
| BIG | ≥ 10× total bet | 4 s | Gold particle burst, slow zoom |
| MEGA | ≥ 25× total bet | 4 s | Cyan lightning swirl + coin shower |
| EPIC | ≥ 50× total bet | 4 s | Full Zeus avatar slam, screen rumble, marble crack |

### 6.5 Status bar messages

Rolling rotation (4 s each) when idle:

1. "PRESS SPIN TO PLAY"
2. "10 PAYLINES · 5000× MAX WIN"
3. "FREE SPINS WITH PROGRESSIVE MULTIPLIER"
4. "BONUS ORBS LOCK FOR HOLD & WIN"
5. "ZEUS MAY STRIKE WITH MULTIPLIER × ANY WIN"

On event:
- Win: "YOU WIN {amount}!"
- Feature trigger: "FREE SPINS COMING…" / "HOLD & WIN STARTING…"
- Cap hit: "MAXIMUM WIN ACHIEVED"

---

## 7. Audio brief

> Audio is implemented LAST per project rule. This brief defines the target.

| Layer | Tone | Examples |
|---|---|---|
| **Ambient bed** | Stormy temple — distant thunder, wind through columns, low brass drone | Loops; ducks under SFX |
| **Reel spin** | Whoosh + marble click on stop | 250 ms tail per reel |
| **Symbol land — LP** | Soft coin chime | 200 ms |
| **Symbol land — MP** | Bronze ring | 300 ms |
| **Symbol land — HP** | Gold gong + light reverb | 500 ms |
| **Wild land** | Lightning crack + tail | 800 ms |
| **Scatter land** | Stone slab thud + glow shimmer | 700 ms |
| **Orb land** | Glass clink + sub-bass thump | 500 ms |
| **Line win** | Coin cascade matched to count-up | Length = count-up duration |
| **Big win tiers** | Brass swell building per tier (BIG → EPIC) | 4 s each |
| **Zeus strike** | Thunder crack + electric sizzle | 1.2 s |
| **FS intro** | Choral swell + thunderclap | 4 s |
| **FS loop** | Tense orchestral pulse | Loops during FS |
| **FS outro** | Choir descrescendo | 3 s |
| **HW intro** | Low bass drone + marble grind | 3 s |
| **HW respin tick** | Dry tick + held breath | 1 s |
| **HW jackpot** | Brass fanfare + reverb tail | 4 s |
| **Max-win cap** | Massive cathedral choir | 6 s |
| **UI buttons** | Soft marble tap | 80 ms |

---

## 8. Animation timing (mirrors `timing.ts`)

| Event | Duration | Easing |
|---|---:|---|
| Spin total (normal) | 1200 ms | windup 100 + accel 200 + steady 600 + decel 250 + cushion 50 |
| Spin total (turbo) | 600 ms | windup 50 + accel 100 + steady 250 + decel 150 + cushion 50 |
| Win count-up base | 600 ms | linear with cubic-out tail |
| Win count-up big (per tier) | 4000 ms | logarithmic with pause beats |
| Symbol reveal LP / MP / HP | 200 / 300 / 500 ms | ease-out |
| Wild crackle | 800 ms | ease-in-out |
| Scatter glow | 700 ms | ease-out |
| Bonus orb spawn + value reveal | 500 ms | spring |
| FS intro overlay | 4000 ms | choreographed (4 keyframes) |
| FS outro | 3000 ms | ease-in |
| HW intro plaque | 3000 ms | ease-out |
| HW round outro (total reveal) | 5000 ms | per-orb 200 ms cascade + 2s sum count-up |
| Big-win plaque (per tier) | 4000 ms | each tier compounds |
| Zeus strike | 1200 ms | crack 200 + bolt travel 400 + multiplier reel 600 |

---

## 9. Accessibility & responsible-gambling UI

| Requirement | Implementation |
|---|---|
| **Spin pacing** | Minimum 2500 ms per spin (UKGC RTS 14D) — turbo disabled in UK builds |
| **Auto-play** | Disabled in UK and Italy; elsewhere 10/25/50/100 with loss/win/single-win cut-offs |
| **Reality check** | Configurable 30/60 min reminder modal with elapsed time + session P&L |
| **Self-exclusion deep link** | Settings → "Need a break?" → operator-provided URL |
| **Balance always visible** | Top-right HUD, never hidden during animations |
| **No celebratory animation on net-loss "wins"** | Win count-up suppressed if bet > win and aggregate session < 0 (configurable) |

---

## 10. Multi-jurisdiction matrix

| Jurisdiction | Stake cap | Spin pacing | Auto-play | Turbo | Bonus wager cap |
|---|---:|---:|:---:|:---:|---:|
| **UKGC** (UK) | £5.00 (18-24: £2.00) | 2500 ms min | ❌ | ❌ | 10× |
| **MGA** (Malta) | — | — | ✅ | ✅ | — |
| **GLI-19** (US fed std) | — | — | ✅ | ✅ | — |
| **NJ DGE** (NJ) | — | — | ✅ | ✅ | — |
| **ADM** (Italy) | €1.00 | — | ❌ | ✅ | — |
| **Quebec (RACJ)** | — | — | ✅ | ✅ | — |

Default unprofiled jurisdiction: most-permissive (MGA-equivalent).

---

## 11. Asset deliverable list (art & VFX team)

| Bucket | Items | Format |
|---|---|---|
| **Symbols** | 14 base + 14 win-state variants | PNG 256×256 @2x, SVG for HD scaling |
| **Backgrounds** | 1 ambient storm loop + 1 FS variant + 1 HW variant | WebM/MP4 1080×1920 |
| **Lightning bolt sprites** | 5 fork variations | PNG sprite-sheet |
| **Orb art** | 4 jackpot variants + value-card template | PNG + dynamic text |
| **Big-win plaques** | BIG · MEGA · EPIC | PNG 800×400 + particle FX |
| **FS intro/outro** | 2 cinematics | Sprite-sheet animations |
| **HW intro plaque** | 1 cinematic | Sprite-sheet animation |
| **Coin particles** | Generic gold-coin shower | Atlas |
| **UI chrome** | Buttons (idle/hover/press/disabled), drawer, menus, paytable scroll | SVG + PNG |
| **Logo** | Wrath of Olympus wordmark | SVG primary + 3 size variants |

---

## 12. Out-of-scope / explicit non-features

| Item | Reason |
|---|---|
| Tumble / cascade mechanic | Not in this product — fixed-reel slot |
| Megaways / variable reel count | Out of scope |
| Buy-feature option | Disabled across all jurisdictions for v1 |
| Real-time multiplayer / tournament | Out of scope |
| In-game currency purchases (e.g. gem packs) | Real-money-only build |
| Skill-based mini-games | Strictly luck-based; chance-only |

---

## 13. Math interface (cross-doc handoff)

**Everything that affects payout, probability, RTP, hit-rate, volatility, jackpot odds, or any number visible to the player** lives in `WRATH_OF_OLYMPUS_MATH_GDD.md`. This document does **not** define:

- Reel weights
- Symbol payouts (numbers)
- Feature trigger probabilities
- Jackpot values / weights
- RTP target
- Volatility target
- Max win cap value

This document **does** define:

- Theme & narrative
- Visual layout & symbol art briefs
- UI flow & screens
- Animation timing & easing
- Audio briefs
- Accessibility & responsible gambling UX
- Jurisdiction operational behaviour

The **handoff contract** is the file `game.config.json` (JSON Schema in `gdd.schema.json`). The math team fills the numeric side; this document fills the experience side. Both merge into the same `game.config.json` at build time.

---

*Generated 2026-05-31 · vendor-neutral, regulator-grade · Boki + Corti partnership*
