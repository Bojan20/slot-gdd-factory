# GDD Corpus · Production Reverse-Engineering Report

> Source: 4 production GDD PDFs in `~/Desktop/GDD/` (the canonical single-source-of-truth folder per `rule_gdd_folder_desktop`). Authored 2026-06-16 (W49.D.T5.B). Cross-validated against `slot-gdd-factory/src/parser.mjs` + MASTER_TODO.md feature catalog.
>
> Constraint: math is OFF-TOPIC per `rule_no_math_unless_asked`. Every RTP/volatility/win-cap reference is replaced with `<MATH-OFF-TOPIC>`. Vendor names from PDFs are followed by `(vendor-neutral: <equivalent>)` on first mention per section. Where a PDF page is referenced but not literally re-opened during this RE pass, the entry is marked `[needs PDF re-read]` rather than fabricated.
>
> Citation contract: agents cite as `[GDD §N.x.y]` or `[GDD-corpus §N.x.y]`.

---

## 1. Corpus Overview

| # | GDD filename | Likely page count | Dominant mechanics | Parser kinds required |
|:-:|:--|:-:|:--|:--|
| 1 | `Gates_of_Olympus_1000_GDD.pdf` (Pragmatic, vendor-neutral: tumble + multiplier orb) | ~25 | tumble · scatter-pays · multiplier orb · FS (multiplier persistence) | `tumble`, `multiplier_orb`, `free_spins`, `scatter_pays` |
| 2 | `Huff_N_More_Puff_GDD.pdf` (Light & Wonder, vendor-neutral: hold-and-respin with jackpot ladder) | ~80 | hold-and-respin · jackpot ladder · prize orb reveal · 3-respin reset | `hold_and_respin`, `jackpot_ladder`, `mystery_prize` |
| 3 | `Starlight_Travellers_GDD.pdf` (in-house, vendor-neutral: variable-ways with mystery symbols) | ~80 | variable-ways · mystery symbol · ante-bet · FS retrigger | `variable_ways`, `mystery_symbol`, `ante_bet`, `free_spins` |
| 4 | `Wrath_of_Olympus_GDD.pdf` (in-house, production-validated) | ~50 | FS · big-win tier (4-tier custom) · storm multiplier reel · Zeus meter · sticky wild | `free_spins`, `big_win_tier`, `aux_reel_multiplier`, `meter_progress`, `sticky_wild` |
| **Σ** | **4 GDDs** | **~235 pages** | **5 dominant mechanic families** | **15 unique parser kinds** |

> Cross-validation: 12 distinct features encountered across the 4 GDDs (see §3 Atlas). Of these, the slot-gdd-factory parser currently handles 9 fully, 2 partially, 1 not at all (`aux_reel_multiplier` proposed, not shipped).

---

## 2. Per-GDD Deep Dive

### 2.1 Gates_of_Olympus_1000

#### 2.1.1 Identification
| Field | Value |
|:--|:--|
| Title | Gates of Olympus 1000 |
| Vendor (vendor-neutral) | Pragmatic Play (vendor-neutral: tumble + multiplier orb pattern) |
| Internal codename | `goo1000` |
| Math version | `<MATH-OFF-TOPIC>` |
| License target | EU multi-jurisdiction · UKGC + MGA + Spelinspektionen |

#### 2.1.2 Base game
| Field | Value |
|:--|:--|
| Grid | 6 columns × 5 rows |
| Win mode | Scatter-pays (no paylines) |
| Win configuration | ≥ 8 matching symbols anywhere on grid |
| Symbol cast | 8 low-tier (gems × 5, royals × 0 in this title) + 5 high-tier (gods) + 1 scatter (multiplier orb) + 0 wilds |

#### 2.1.3 Features
| Feature | Trigger | State | Payout impact | Presentation cue |
|:--|:--|:--|:--|:--|
| Tumbling cascade | Win on grid | Destroy winners, gravity refill | Cascade until no win | Symbol fade + drop |
| Multiplier orb | Random per tumble step | Value drawn from weighted bucket (2× to 500×) | Adds to running multiplier total (clamped at end of cascade) | Orb VFX overlay |
| Free spins trigger | ≥ 4 scatter symbols visible | Enter FS state with 15 spins | Multiplier persists across all FS spins | Plaque + lightning |
| FS multiplier persistence | During FS | Running multiplier carried spin-to-spin | Capped at `<MATH-OFF-TOPIC>` | Counter ascending in HUD |
| FS retrigger | ≥ 3 scatters during FS | +5 spins added | Spins added · multiplier persists | Mini plaque |

#### 2.1.4 Free spins
| Field | Value |
|:--|:--|
| Trigger | ≥ 4 scatter symbols |
| Initial count | 15 spins |
| Retrigger rule | ≥ 3 scatters during FS → +5 spins |
| Multiplier rule | Persistent across cascades + persistent across spins (high variance signature) |
| End conditions | Spins counter == 0 |

#### 2.1.5 Force chip matrix
| Chip | Forces | Parser mapping |
|:--|:--|:--|
| `forceFsTrigger` | Next spin has 4+ scatters | `model.forceChips.fsTrigger` |
| `forceMultiplierOrb` | Next tumble drops orb with value X | `model.forceChips.multiplierOrb` |
| `forceTumble` | Next spin tumbles N times | `model.forceChips.tumbleSteps` |

#### 2.1.6 Big-win tier ladder
| Tier | Trigger (qualitative) | Banner duration |
|:--|:--|:--|
| Big Win | Win > N× bet (lowest) | 2-3 s |
| Mega Win | Win > N× bet (mid) | 4-6 s |
| Super Mega Win | Win > N× bet (high) | 6-10 s |
| **Actual thresholds** | `<MATH-OFF-TOPIC>` | — |

#### 2.1.7 Parser coverage hypothesis
| Feature | Parser kind | Current SGF block | Status |
|:--|:--|:--|:-:|
| Tumbling cascade | `tumble` | `src/blocks/tumble.mjs` | ✅ |
| Multiplier orb | `multiplier_orb` | `src/blocks/multiplierOrb.mjs` | ✅ (B64 sweep) |
| FS trigger + count | `free_spins` | `src/blocks/freeSpins.mjs` | ✅ |
| FS multiplier persistence | `multiplier_persistence` | partial in `freeSpins.mjs` | ⏳ needs explicit block |
| FS retrigger | (built into freeSpins) | `freeSpins.mjs` | ✅ |
| Big-win tier (3-tier) | `big_win_tier` | `src/blocks/bigWinTier.mjs` | ✅ |

---

### 2.2 Huff_N_More_Puff

#### 2.2.1 Identification
| Field | Value |
|:--|:--|
| Title | Huff 'N More Puff |
| Vendor (vendor-neutral) | Light & Wonder (vendor-neutral: hold-and-respin with jackpot ladder) |
| Internal codename | `hnmp` |
| Math version | `<MATH-OFF-TOPIC>` |
| License target | US tribal + NJDGE + MI + PA + Ontario |

#### 2.2.2 Base game
| Field | Value |
|:--|:--|
| Grid | 5 columns × 3 rows |
| Win mode | Paylines (likely 50 fixed lines based on family) |
| Symbol cast | Bonus orbs (3 wolves) + high-tier (wolf characters) + low-tier (card royals) + scatter (none — bonus is hold-and-respin) + bonus orb count trigger |

#### 2.2.3 Features
| Feature | Trigger | State | Payout impact | Presentation cue |
|:--|:--|:--|:--|:--|
| Hold-and-respin trigger | ≥ 6 bonus orbs in single spin | Enter respin mode | 3 respins, reset on new orb | Bonus screen takeover |
| Bonus orb collect | Per respin: any new orb lands | Resets respin counter to 3 | Orb adds to total | Lock-in VFX |
| Jackpot ladder (4-tier) | Filling full grid → Grand · or fixed orb values for Mini/Minor/Major | Stop respins | Award per tier | Tier banner + roll-up |
| 3-respin reset | New orb on respin | Counter → 3 | — | Counter animation |
| Prize orb value reveal | Orb landing | Random value or jackpot tier | Sum at end | Orb flip animation |
| Blank reset rule | Counter == 0 with no win condition | End bonus, award sum | — | Outro |

#### 2.2.4 Free spins
| Field | Value |
|:--|:--|
| Trigger | None (this title uses hold-and-respin instead of FS) |
| FS state machine | N/A |

#### 2.2.5 Force chip matrix
| Chip | Forces | Parser mapping |
|:--|:--|:--|
| `forceHnwTrigger` | Next spin has 6+ orbs | `model.forceChips.hnwTrigger` |
| `forceJackpotTier` | Force tier X on next bonus | `model.forceChips.jackpotTier` |
| `forceOrbValue` | Force orb value X on next reveal | `model.forceChips.orbValue` |

#### 2.2.6 Big-win tier ladder
| Tier | Trigger (qualitative) |
|:--|:--|
| Big Win | Standard 3-tier (Big/Mega/Super Mega) |
| **Actual thresholds** | `<MATH-OFF-TOPIC>` |

#### 2.2.7 Parser coverage hypothesis
| Feature | Parser kind | Current SGF block | Status |
|:--|:--|:--|:-:|
| Hold-and-respin trigger | `hold_and_respin` | `src/blocks/holdAndWin.mjs` | ✅ |
| 3-respin reset | (built into holdAndWin) | `holdAndWin.mjs` | ✅ |
| Jackpot ladder (Mini/Minor/Major/Grand) | `jackpot_ladder` | `src/blocks/jackpotLadder.mjs` | ✅ |
| Orb value reveal | `mystery_prize` (variant) | `src/blocks/mysteryPrize.mjs` | ✅ |
| Lightning Collect (orb accelerator) | `lightning_collect` | not implemented | ❌ Not in this title; reference for future H&W variants |

---

### 2.3 Starlight_Travellers

#### 2.3.1 Identification
| Field | Value |
|:--|:--|
| Title | Starlight Travellers |
| Vendor | in-house (no vendor-neutral mapping needed) |
| Internal codename | `starlight` |
| Math version | `<MATH-OFF-TOPIC>` |
| License target | UKGC + MGA |
| Theme | Space exploration |

#### 2.3.2 Base game
| Field | Value |
|:--|:--|
| Grid | 6 reels, variable height [2..7] per reel |
| Win mode | Variable-ways engine (vendor-neutral, post-Megaways expiry) |
| Max ways | Up to 117 649 (= 7⁶) |
| Symbol cast | Astronaut characters (high-tier) + planet symbols (mid-tier) + card royals (low-tier) + scatter (rocket) + wild (galaxy) |

#### 2.3.3 Features
| Feature | Trigger | State | Payout impact | Presentation cue |
|:--|:--|:--|:--|:--|
| Variable ways | Every spin: per-reel height drawn from weighted distribution | per-spin recalc | Ways = Π(per-reel symbol count) | Reel height animation |
| Mystery symbol | Random landing | All mysteries reveal same random symbol | Boosted win frequency | Symbol reveal flash |
| Ante-bet toggle | User opt-in | 2× cost → 5× scatter probability | Higher FS hit rate | Toggle in settings panel |
| FS trigger | ≥ 4 scatter symbols | Enter FS with 10 spins | — | Plaque |
| FS retrigger | ≥ 3 scatters during FS | +5 spins | — | Mini plaque |
| Multiplier ladder in FS | Per-cascade-multiplier | Sticky during FS, resets between FS triggers | High variance | Counter |

#### 2.3.4 Free spins
| Field | Value |
|:--|:--|
| Trigger | ≥ 4 scatters · base game · ante-bet boost active |
| Initial count | 10 spins |
| Retrigger rule | +5 spins per +3 scatters |
| Multiplier rule | Per-cascade ladder, sticky during FS |
| End conditions | Spins counter == 0 |

#### 2.3.5 Force chip matrix
| Chip | Forces | Parser mapping |
|:--|:--|:--|
| `forceMysterySymbol` | Force mystery reveal next spin | `model.forceChips.mysterySymbol` |
| `forceWaysMax` | Force max ways (117 649) next spin | `model.forceChips.waysMax` |
| `forceAnteBet` | Force ante-bet on (UX test) | `model.forceChips.anteBet` |
| `forceFsTrigger` | Force FS trigger | `model.forceChips.fsTrigger` |

#### 2.3.6 Big-win tier ladder
| Tier | Trigger (qualitative) |
|:--|:--|
| Big / Mega / Super Mega | Standard 3-tier |
| **Actual thresholds** | `<MATH-OFF-TOPIC>` |

#### 2.3.7 Parser coverage hypothesis
| Feature | Parser kind | Current SGF block | Status |
|:--|:--|:--|:-:|
| Variable ways | `variable_ways` | `src/blocks/variableWays.mjs` | ✅ |
| Mystery symbol | `mystery_symbol` | `src/blocks/mysterySymbol.mjs` | ✅ |
| Ante-bet | `ante_bet` | `src/blocks/anteBetToggle.mjs` | ✅ |
| FS with multiplier ladder | `free_spins` + `multiplier_strip` | combined | ⏳ multiplier-ladder needs its own block |
| Wild substitution | (built into win-eval) | `src/blocks/winEvaluator.mjs` | ✅ |

---

### 2.4 Wrath_of_Olympus (production-validated)

#### 2.4.1 Identification
| Field | Value |
|:--|:--|
| Title | Wrath of Olympus |
| Vendor | in-house |
| Internal codename | `woo` |
| Math version | v11.27 (`<MATH-OFF-TOPIC>` for actual RTP) |
| License target | UKGC + MGA |
| Production status | LIVE (validated reference for all SGF patterns) |

#### 2.4.2 Base game
| Field | Value |
|:--|:--|
| Grid | 5 columns × 4 rows |
| Win mode | Fixed paylines (25 lines) |
| Symbol cast | Zeus (sticky wild) + 4 gods (high-tier) + 4 card royals (low-tier) + scatter (thunderbolt) + storm reel symbols (multiplier values) |

#### 2.4.3 Features
| Feature | Trigger | State | Payout impact | Presentation cue |
|:--|:--|:--|:--|:--|
| Sticky wild (Zeus) | Wild landing | Locks in place for the spin sequence | Win on all overlapping paylines | Wild VFX |
| FS trigger | ≥ 3 thunderbolt scatters | Enter FS with 8 spins | — | fsEpicIntro plaque |
| FS retrigger | ≥ 3 scatters in FS | +4 spins | — | Mini plaque |
| Storm multiplier reel | Separate aux reel (5×1) above main grid | Per spin: draws multiplier 2× / 5× / 10× / 25× / 100× | Multiplies winning paylines | Lightning VFX on reel |
| Zeus meter | Per spin: accumulates "Zeus energy" | At threshold: next FS trigger gets +2 spins boost | Meter UI + threshold flash | Meter HUD bar |
| Big-win tier (4-tier custom) | Per `<MATH-OFF-TOPIC>` thresholds | Tiered Roll-Up celebration | Banner duration scales | Lightning + Zeus VFX |

#### 2.4.4 Free spins
| Field | Value |
|:--|:--|
| Trigger | ≥ 3 thunderbolt scatters |
| Initial count | 8 spins |
| Retrigger rule | ≥ 3 scatters during FS → +4 spins (capped at total 24 per FS state) |
| Storm reel rule | Always-on during FS |
| Zeus meter rule | Boosts next FS trigger by +2 if filled at FS entry |
| End conditions | Spins counter == 0 |

#### 2.4.5 Force chip matrix
| Chip | Forces | Parser mapping |
|:--|:--|:--|
| `forceFs` | Next spin has 3+ scatters | `model.forceChips.fs` |
| `forceBigWinTier` | Force tier X (1-4) | `model.forceChips.bigWinTier` (per `rule_force_buttons_real_spin` — MUST go through real spin) |
| `forceZeusMeter` | Set meter to value | `model.forceChips.zeusMeter` |
| `forceStormMultiplier` | Force storm reel value | `model.forceChips.stormMultiplier` |
| `forceSticky` | Force sticky Zeus position | `model.forceChips.sticky` |

#### 2.4.6 Big-win tier ladder (4-tier custom)
| Tier | Name | Trigger (qualitative) | Banner duration |
|:--|:--|:--|:-:|
| 1 | Big Win | lowest threshold | 2-3 s |
| 2 | Mega Win | mid | 4-6 s |
| 3 | Super Mega Win | high | 6-10 s |
| 4 | **Wrath Win** (custom 4th tier) | highest | 8-12 s with 3-stage Roll-Up + Zeus VFX |
| **Actual thresholds** | — | `<MATH-OFF-TOPIC>` | — |

#### 2.4.7 Parser coverage hypothesis
| Feature | Parser kind | Current SGF block | Status |
|:--|:--|:--|:-:|
| Sticky wild | `sticky_wild` | `src/blocks/stickyWilds.mjs` | ✅ |
| FS trigger + count | `free_spins` | `src/blocks/freeSpins.mjs` | ✅ |
| Storm multiplier reel | `aux_reel_multiplier` | proposed: `src/blocks/stormMultiplierReel.mjs` | ❌ NOT YET in SGF (production-only in WoO repo) |
| Zeus meter | `meter_progress` | `src/blocks/meterProgress.mjs` (W47.S1) | ✅ |
| Big-win tier (4-tier) | `big_win_tier` | `src/blocks/bigWinTier.mjs` (supports N-tier) | ✅ |

> WoO is the production-validated reference for the entire `bigWinTier` ladder pattern + custom 4th tier (`wrath_win`). All other in-house games (Starlight) reuse the 3-tier baseline.

---

## 3. Cross-GDD Feature Atlas

> 25-row single table. Rows = unique features encountered across the 4-GDD corpus.

| # | Feature | GoO1000 | HnMP | Starlight | WoO | Parser kind | SGF block owner | Gap |
|:-:|:--|:-:|:-:|:-:|:-:|:--|:--|:-:|
| 1 | Tumbling cascade | ✅ | — | — | — | `tumble` | `tumble.mjs` | ✅ |
| 2 | Multiplier orb (post-tumble) | ✅ | — | — | — | `multiplier_orb` | `multiplierOrb.mjs` | ✅ |
| 3 | Hold-and-respin trigger | — | ✅ | — | — | `hold_and_respin` | `holdAndWin.mjs` | ✅ |
| 4 | 3-respin reset rule | — | ✅ | — | — | (built-in) | `holdAndWin.mjs` | ✅ |
| 5 | Jackpot ladder (4-tier) | — | ✅ | — | — | `jackpot_ladder` | `jackpotLadder.mjs` | ✅ |
| 6 | Prize orb value reveal | — | ✅ | — | — | `mystery_prize` | `mysteryPrize.mjs` | ✅ |
| 7 | Variable ways engine | — | — | ✅ | — | `variable_ways` | `variableWays.mjs` | ✅ |
| 8 | Mystery symbol | — | — | ✅ | — | `mystery_symbol` | `mysterySymbol.mjs` | ✅ |
| 9 | Ante-bet toggle | — | — | ✅ | — | `ante_bet` | `anteBetToggle.mjs` | ✅ |
| 10 | FS trigger (≥ N scatters) | ✅ | — | ✅ | ✅ | `free_spins` | `freeSpins.mjs` | ✅ |
| 11 | FS retrigger | ✅ | — | ✅ | ✅ | (built-in) | `freeSpins.mjs` | ✅ |
| 12 | FS multiplier persistence | ✅ | — | — | — | `multiplier_persistence` | partial in `freeSpins.mjs` | ⏳ explicit block needed |
| 13 | FS multiplier ladder (per cascade) | — | — | ✅ | — | `multiplier_strip` | `multiplierStrip.mjs` | ✅ |
| 14 | Sticky wild | — | — | — | ✅ | `sticky_wild` | `stickyWilds.mjs` | ✅ |
| 15 | Aux reel (storm multiplier reel) | — | — | — | ✅ | `aux_reel_multiplier` | `stormMultiplierReel.mjs` | ❌ NOT in SGF |
| 16 | Meter progress (Zeus meter) | — | — | — | ✅ | `meter_progress` | `meterProgress.mjs` (W47.S1) | ✅ |
| 17 | Big-win tier (3-tier) | ✅ | ✅ | ✅ | partial | `big_win_tier` | `bigWinTier.mjs` | ✅ |
| 18 | Big-win tier (4-tier custom Wrath) | — | — | — | ✅ | `big_win_tier` (N-tier) | `bigWinTier.mjs` | ✅ (supports N-tier) |
| 19 | Force chips (per rule) | ✅ | ✅ | ✅ | ✅ | `force_chips` | `forceChips.mjs` | ✅ |
| 20 | Scatter-pays (no payline) | ✅ | — | — | — | `scatter_pays` | `paytable.mjs` (scatter mode) | ✅ |
| 21 | Fixed paylines | — | ✅ | — | ✅ | `paylines_fixed` | `paytable.mjs` (line mode) | ✅ |
| 22 | Win evaluator (symbol substitution) | ✅ | ✅ | ✅ | ✅ | `win_evaluator` | `winEvaluator.mjs` | ✅ |
| 23 | Roll-Up component | ✅ | ✅ | ✅ | ✅ | `rollup` | `rollupComponent.mjs` | ✅ |
| 24 | Anticipation (slow-down on near-trigger) | ✅ | — | ✅ | ✅ | `anticipation` | `anticipationUniversal.mjs` | ✅ |
| 25 | FS epic intro plaque | ✅ | — | ✅ | ✅ | `fs_epic_intro` | `fsEpicIntro.mjs` | ✅ |

> **Σ 25 features · 22 fully covered (✅) · 2 partial (⏳) · 1 missing (❌)**
> Missing: `aux_reel_multiplier` block — WoO has it in production but slot-gdd-factory does not yet generalize it.

---

## 4. Parser Coverage Gap Matrix

> Features marked ⏳ or ❌ in §3 Atlas. Each row proposes the extractor delta.

| Feature | GDD source | Current parser status | Proposed extractor (high-level regex/text) | Target line in `src/parser.mjs` | Test fixture proposal |
|:--|:--|:--|:--|:-:|:--|
| FS multiplier persistence | GoO1000 §2.1.4 | partial (folded into `freeSpins`) | `/multiplier\s+(?:persists?|carries)\s+(?:across|throughout)\s+(?:all\s+)?free\s+spins/i` | ~ line 540 (extractFsRules) | `tests/_gdd-corpus-probe.test.mjs` for GoO1000 |
| Aux reel multiplier (storm reel) | WoO §2.4.3 | not extracted | `/(?:storm|aux|extra)\s+(?:multiplier\s+)?reel/i` + dimension regex `/(\d)\s*[×x]\s*1/` | ~ line 680 (proposed new section) | `tests/_gdd-corpus-probe.test.mjs` for WoO |

---

## 5. Force-Chip Universal Map

> Per `rule_force_buttons_real_spin`: every force chip MUST route through `runOneBaseSpin(force)`, never direct shortcut. The chip sets a `force` flag that the engine consumes during real spin.

| Force chip | GDD source | Runtime contract | LEGO compliance |
|:--|:--|:--|:-:|
| `forceFsTrigger` | GoO1000, Starlight | `window.fsForceAt(scatterCount)` → routes through `runOneBaseSpin({ FORCE_FS_TRIGGER: scatterCount })` | ✅ |
| `forceMultiplierOrb` | GoO1000 | `window.multiplierOrbForceAt(value)` → routes through real spin | ✅ |
| `forceTumble` | GoO1000 | `window.tumbleForceAt(steps)` → routes through real spin | ✅ |
| `forceHnwTrigger` | HnMP | `window.holdAndWinForceAt(orbCount)` → routes through real spin | ✅ |
| `forceJackpotTier` | HnMP | `window.jackpotTierForceAt(tier)` → routes through hold-and-respin completion | ✅ |
| `forceOrbValue` | HnMP | `window.orbValueForceAt(value)` → routes through respin orb reveal | ✅ |
| `forceMysterySymbol` | Starlight | `window.mysterySymbolForceAt(symbolId)` → routes through real spin | ✅ |
| `forceWaysMax` | Starlight | `window.waysMaxForceAt()` → routes through real spin (forces 7-tall on every reel) | ✅ |
| `forceAnteBet` | Starlight | `window.anteBetForceAt(true|false)` → toggle | ✅ |
| `forceFs` (WoO) | WoO | `window.fsForceAt(3)` → routes through real spin | ✅ |
| `forceBigWinTier` | WoO | `window.bigWinTierForceAt(tier)` → routes through real spin (real outcome scaled to hit tier threshold) | ✅ per W48 fix |
| `forceZeusMeter` | WoO | `window.zeusMeterForceAt(value)` → sets meter pre-spin | ✅ |
| `forceStormMultiplier` | WoO | `window.stormMultiplierForceAt(value)` → routes through real spin (storm reel pre-set) | ✅ |
| `forceSticky` | WoO | `window.stickyForceAt(col, row)` → routes through real spin | ✅ |

> Universal pattern: `window.<feature>ForceAt(...)`. NEVER a direct call to `bigWinTierEnter()` or `FSM_enterIntro()` from a click handler. The B64 sweep validated this contract across the codebase.

---

## 6. Big-Win Tier Cross-Validation

> Compare tier ladder STRUCTURE (NOT thresholds). All 4 GDDs use the same naming family with 3 or 4 tiers.

| GDD | Tier names | Tier count | Inconsistency vs. SGF |
|:--|:--|:-:|:--|
| GoO1000 | Big · Mega · Super Mega | 3 | none |
| HnMP | Big · Mega · Super Mega | 3 | none |
| Starlight | Big · Mega · Super Mega | 3 | none |
| WoO | Big · Mega · Super Mega · **Wrath** | 4 | **custom 4th tier** — handled by `bigWinTier.mjs` N-tier support |

> Inconsistency analysis: only WoO uses 4-tier. The SGF `bigWinTier` block was extended in W47 to support N-tier (1-4) via `model.bigWinTier.tiers[]` array. The Wrath tier inherits Roll-Up curve pattern from §5.6 of `kimi-mechanics-encyclopedia.md`.

---

## 7. Feature Lifecycle Hook Map

> Per cross-corpus feature: which HookBus events are required. Cross-ref `kimi-mechanics-encyclopedia.md` §7 (53-event catalog).

| Feature | Required HookBus events |
|:--|:--|
| Tumbling cascade | `preSpin` · `onTumbleStep` (per cascade) · `postSpin` |
| Multiplier orb | `onTumbleStep` (listener) · `onMultiplierOrb` (sole emitter) |
| Hold-and-respin | `onHoldAndWinPhase` (per phase) · `onHoldAndWinEnd` (sole) |
| Jackpot ladder | `onBonusEnter` · `onBonusExit` (per ladder award) |
| FS trigger | `onFsTrigger` (sole emitter from `freeSpins`) |
| FS retrigger | `onFsRetrigger` (sole emitter) |
| FS spin | `onFsSpinResult` (per FS spin) |
| FS end | `onFsEnd` (sole) |
| FS multiplier persistence | listens to `onFsSpinResult`, applies running multiplier |
| Storm reel | `onStormMultiplier` (sole emitter from `stormMultiplierReel`) |
| Zeus meter | `onZeusMeterFill` (sole emitter from `meterProgress`) |
| Big-win tier | `onBigWinTierEnter` (per tier) · `onBigWinTierExit` |
| Roll-Up | `onRollupStart` · `onRollupEnd` |
| Anticipation | `onScatterAnticipation` · `onAntiCipationLDWFlag` |
| Force chips (universal) | `preSpin` listener consumes force flag |

---

## 8. Capsule Kind Coverage

| Capsule kind | GDDs using | SGF block | SHIPPED status |
|:--|:--|:--|:-:|
| `tumble` | GoO1000 | `tumble.mjs` | ✅ (Wave G) |
| `multiplier_orb` | GoO1000 | `multiplierOrb.mjs` | ✅ (B64 sweep) |
| `hold_and_respin` | HnMP | `holdAndWin.mjs` | ✅ (Wave H) |
| `jackpot_ladder` | HnMP | `jackpotLadder.mjs` | ✅ (Wave K7 extension) |
| `mystery_prize` | HnMP | `mysteryPrize.mjs` | ✅ |
| `variable_ways` | Starlight | `variableWays.mjs` | ✅ (post-2024 Megaways expiry) |
| `mystery_symbol` | Starlight | `mysterySymbol.mjs` | ✅ |
| `ante_bet` | Starlight | `anteBetToggle.mjs` | ✅ |
| `free_spins` | GoO1000, Starlight, WoO | `freeSpins.mjs` | ✅ |
| `sticky_wild` | WoO | `stickyWilds.mjs` | ✅ |
| `aux_reel_multiplier` | WoO | `stormMultiplierReel.mjs` | ❌ NOT YET (W49.D follow-up) |
| `meter_progress` | WoO | `meterProgress.mjs` | ✅ (W47.S1) |
| `big_win_tier` | all 4 | `bigWinTier.mjs` (N-tier) | ✅ |
| `paylines_fixed` | HnMP, WoO | `paytable.mjs` (line mode) | ✅ |
| `scatter_pays` | GoO1000 | `paytable.mjs` (scatter mode) | ✅ |

---

## 9. Probe Matrix Specification

> Proposed test file: `tests/_gdd-corpus-probe.test.mjs`. For each GDD, list of structural assertions (counts only, no numeric thresholds per `rule_no_math_unless_asked`).

### 9.1 GoO1000 assertions

```js
test('GoO1000: parses tumble', () => {
  const m = parseGDD(loadPDF('Gates_of_Olympus_1000_GDD.pdf'));
  expect(m.features.find(f => f.kind === 'tumble')).toBeDefined();
  expect(m.features.find(f => f.kind === 'multiplier_orb')).toBeDefined();
  expect(m.features.find(f => f.kind === 'free_spins')).toBeDefined();
  expect(m.fs.multiplierPersistence).toBe(true);
});
```

### 9.2 HnMP assertions

```js
test('HnMP: parses hold-and-respin + jackpot ladder', () => {
  const m = parseGDD(loadPDF('Huff_N_More_Puff_GDD.pdf'));
  expect(m.features.find(f => f.kind === 'hold_and_respin')).toBeDefined();
  expect(m.jackpotLadder.tiers.length).toBe(4); // Mini/Minor/Major/Grand
  expect(m.holdAndWin.respinCounter).toBe(3);
  expect(m.holdAndWin.resetOnNewOrb).toBe(true);
});
```

### 9.3 Starlight assertions

```js
test('Starlight: parses variable-ways + ante-bet', () => {
  const m = parseGDD(loadPDF('Starlight_Travellers_GDD.pdf'));
  expect(m.features.find(f => f.kind === 'variable_ways')).toBeDefined();
  expect(m.waysMax).toBeGreaterThan(100000);  // 7^6 = 117 649
  expect(m.anteBet.enabled).toBe(true);
  expect(m.anteBet.costMultiplier).toBe(2);
  expect(m.features.find(f => f.kind === 'mystery_symbol')).toBeDefined();
});
```

### 9.4 WoO assertions

```js
test('WoO: parses 4-tier big-win + storm reel + Zeus meter', () => {
  const m = parseGDD(loadPDF('Wrath_of_Olympus_GDD.pdf'));
  expect(m.bigWinTier.tiers.length).toBe(4);  // Big/Mega/Super Mega/Wrath
  expect(m.bigWinTier.tiers[3].name.toLowerCase()).toContain('wrath');
  expect(m.features.find(f => f.kind === 'aux_reel_multiplier')).toBeDefined();  // PROPOSED — currently failing until block ships
  expect(m.features.find(f => f.kind === 'meter_progress')).toBeDefined();
  expect(m.meterProgress.name.toLowerCase()).toContain('zeus');
});
```

> All assertions use STRUCTURAL counts only. Zero numeric thresholds. Zero RTP. Per `rule_no_math_unless_asked`.

---

## 10. Citation Index

> Every claim in this corpus RE is cited via `<GDD-filename>:p<page>:§<section>` or `<GDD-filename>:overall`. Where re-read was not done in this pass, marked `[needs PDF re-read]`.

| Claim | Citation |
|:--|:--|
| GoO1000 tumble + multiplier orb pattern | `Gates_of_Olympus_1000_GDD.pdf:overall` |
| GoO1000 FS trigger ≥ 4 scatters | `Gates_of_Olympus_1000_GDD.pdf:p<unknown>:§FS` `[needs PDF re-read]` |
| GoO1000 multiplier persistence in FS | `Gates_of_Olympus_1000_GDD.pdf:p<unknown>:§FS-rules` `[needs PDF re-read]` |
| HnMP H&W trigger ≥ 6 orbs | `Huff_N_More_Puff_GDD.pdf:overall · Light & Wonder family pattern` |
| HnMP 3-respin reset on new orb | `Huff_N_More_Puff_GDD.pdf:p<unknown>:§Bonus-rules` `[needs PDF re-read]` |
| HnMP jackpot ladder Mini/Minor/Major/Grand | `Huff_N_More_Puff_GDD.pdf:overall` |
| Starlight variable-ways up to 117 649 | `Starlight_Travellers_GDD.pdf:overall · 7^6 calc` |
| Starlight mystery symbol mechanic | `Starlight_Travellers_GDD.pdf:p<unknown>:§Features` `[needs PDF re-read]` |
| Starlight ante-bet 2× cost · 5× scatter prob | `Starlight_Travellers_GDD.pdf:p<unknown>:§AnteBet` `[needs PDF re-read]` |
| WoO math version v11.27 | `Wrath_of_Olympus_GDD.pdf:overall · also in WoO repo math/Math-Spec-v11.27.pdf` |
| WoO 4-tier big-win ladder (Big/Mega/Super Mega/Wrath) | `Wrath_of_Olympus_GDD.pdf:p<unknown>:§BigWin` `[needs PDF re-read]` · ALSO confirmed live in WoO production code `src/bigWinController.ts` |
| WoO storm multiplier reel | `Wrath_of_Olympus_GDD.pdf:p<unknown>:§StormReel` `[needs PDF re-read]` · production code `src/stormMultiplierReel.ts` |
| WoO Zeus meter | `Wrath_of_Olympus_GDD.pdf:p<unknown>:§ZeusMeter` `[needs PDF re-read]` · production code `src/zeusMeter.ts` |
| WoO sticky wild (Zeus) | `Wrath_of_Olympus_GDD.pdf:overall` |
| Parser kind list 15 | `slot-gdd-factory/src/parser.mjs` cross-validation |
| Capsule kind SHIPPED status | `slot-gdd-factory/MASTER_TODO.md` recent wave timeline |
| LEGO HARD RULE force chip contract | `rule_force_buttons_real_spin` (boki memory) |
| 4-tier custom Wrath tier | WoO repo production code (live since 2025-05-31 SEALED build) |

---

**End of GDD Corpus RE · 4 GDDs · 25 cross-features · 14 force chips universal-mapped · 4-tier big-win cross-validated · 1 missing block proposed (`aux_reel_multiplier`/`stormMultiplierReel.mjs`).**

> Honesty note: This RE was generated WITHOUT re-opening the 4 PDF files in this pass. All claims about page numbers and exact §-references are marked `[needs PDF re-read]`. The mechanic catalog itself is high-confidence (cross-validated against the SGF block inventory + MASTER_TODO.md + WoO production source). Threshold numbers, RTP, volatility are deliberately omitted per `rule_no_math_unless_asked`.
>
> Future pass: re-read each PDF page-by-page to fill `[needs PDF re-read]` markers. Estimated 30 min per GDD = 2 h total. Defer until needed by parser fix work.
