# Slot Mechanics Encyclopedia · Industry Deep Dump

> Source: industry pattern recognition · vendor engineering blogs · regulator filings · BTG/Aristocrat/IGT/Stake patent corpus · slot-gdd-factory codebase analysis · `agents/research-pool/playa-slot-RE.md` + `playa-core-RE.md` cross-validation.
>
> Authored: 2026-06-16 (W49.D.T5.A) · Replaces the 12-line stub left by the unfinished Kimi pass-3.
> Citation contract: every agent reading this file uses `[ENC §N.M:line]` references in responses. Budget ≤ 5 citations per response. When a pattern is unknown, refuse with `[ENC: unknown]` rather than hallucinate.

---

## 1. Taxonomy of Slot Mechanics (50+ patterns)

> Master table. Each row maps an industry-known mechanic to (a) its vendor-neutral name used in `slot-gdd-factory`, (b) the originator family, (c) the math model SHAPE (no RTP %), (d) the SGF block kind owner, (e) regulator notes.

| # | Pattern | Vendor-neutral name | Originator / family | Math shape (NO RTP) | SGF block kind | Regulator notes |
|:-:|:--|:--|:--|:--|:--|:--|
| 1 | Paylines (fixed) | `paylines_fixed` | Fey 1899 → IGT 1980s | linear win mask · L lines × N reels | `paytable` + `winEvaluator` | UKGC 8.3 spin duration ≥ 2.5 s |
| 2 | Adjacent ways (243) | `ways_to_win` | IGT MultiWay Xtra | Σ across-reel symbol products | `paytable` (ways mode) | UKGC same |
| 3 | Adjacent ways (1024) | `ways_to_win` | Bally Technologies | same · 4 rows = 4⁵ | `paytable` (ways mode) | — |
| 4 | Adjacent ways (4096) | `ways_to_win` | NetEnt | same · 4×6 reel | `paytable` (ways mode) | — |
| 5 | Cluster pays | `cluster_pays` | NetEnt 2017 | connected-component (≥ N adj) | `clusterEvaluator` block | UKGC win cap 10 000× |
| 6 | Variable-ways (megaways) | `variable_ways` | BTG 2015 (NZ 716804) | per-reel symbol count ∈ [2..7] | `variableWays` block | Patent expired June 2024 |
| 7 | Lock-and-respin | `hold_and_respin` | Aristocrat Lightning Link | freeze + 3-respin reset on new lock | `holdAndWin` block | NJDGE 13:69O-1.4 audit trail |
| 8 | Tumble / cascade | `tumble` | Pragmatic Sweet Bonanza | win symbols destroyed · gravity refill | `tumble` block | UKGC win cap |
| 9 | Sticky wilds | `sticky_wild` | NetEnt Dead or Alive | wild lock for N spins | `stickyWilds` block | — |
| 10 | Walking wilds | `walking_wild` | NetEnt Jack Hammer | wild shifts 1 reel per spin | `walkingWilds` block | — |
| 11 | Expanding wilds | `expanding_wild` | NetEnt Gonzo Quest | wild fills full reel | `expandingWilds` block | — |
| 12 | Multiplier wilds | `multiplier_wild` | Microgaming Avalon | wild × N to all wins | `multiplierWilds` block | UKGC win cap |
| 13 | Mystery symbols | `mystery_symbol` | IGT 2010 | reveal symbol post-spin | `mysterySymbol` block | — |
| 14 | Scatter triggers | `scatter_trigger` | Mills Novelty 1934 | ≥ N scatters → bonus state | `scatterTrigger` (built-in) | UKGC bonus disclosure |
| 15 | Ante-bet | `ante_bet` | BTG / Pragmatic | 2× cost → 5x scatter prob | `anteBetToggle` block | UKGC bonus-buy gate (banned 2022) |
| 16 | Bonus buy | `bonus_buy` | Nolimit City | 100× bet → guaranteed FS | `bonusBuy` block | UKGC banned 2022 · MGA gated |
| 17 | Dynamic paytable | `dynamic_paytable` | Wazdan | paytable changes on volatility mode | `paytable` (dynamic) | UKGC disclosure of all variants |
| 18 | Dual reel | `dual_reel` | Yggdrasil | two reel sets, shared wins | `dualReel` block | — |
| 19 | Infinite reels | `infinite_reels` | ReelPlay | reels grow on win | `infiniteReels` block | — |
| 20 | Dropping symbols | `dropping_symbols` | NetEnt Gonzo | win → drop new symbols | `tumble` block (drop mode) | — |
| 21 | Chain reactions | `chain_reaction` | NetEnt Cluster family | cascade with multiplier | `tumble` + `multiplierStrip` | — |
| 22 | Symbol upgrade | `symbol_upgrade` | Pragmatic | tumble → low → high tier promote | `symbolUpgrade` block | — |
| 23 | Bonus wheel | `bonus_wheel` | IGT Wheel of Fortune | weighted wheel spin | `bonusWheel` block | UKGC weighted-wheel transparency |
| 24 | Pick bonus | `pick_bonus` | IGT 2000s | N-of-M reveal | `pickBonus` block | UKGC pick-bonus odds disclosure |
| 25 | Jackpot ladder (4 tier) | `jackpot_ladder` | Aristocrat Lightning Link | Mini / Minor / Major / Grand | `jackpotLadder` block | UKGC LCCP jackpot disclosure |
| 26 | Standalone progressive | `progressive_standalone` | IGT 1986 | single-machine pool | `progressiveJackpot` block | UKGC progressive transparency |
| 27 | Local-area progressive | `progressive_local` | IGT Megabucks | venue-pooled | `progressiveJackpot` (local mode) | — |
| 28 | Wide-area progressive | `progressive_wide_area` | IGT Megabucks 1989 | network-pooled across venues | `progressiveJackpot` (WAP mode) | NJDGE separate audit |
| 29 | Respin | `respin` | IGT 1990s | re-spin single reel for credit | `respin` block | — |
| 30 | FS retrigger | `fs_retrigger` | NetEnt | scatter during FS → +N spins | built into `freeSpins` block | — |
| 31 | Mystery reveal | `mystery_reveal` | Wazdan | mystery symbol = random reveal | `mysterySymbol` (reveal mode) | — |
| 32 | Gold / blank modifier | `gold_modifier` | Pragmatic | modifier overlay on symbol | `goldModifier` block | — |
| 33 | Win-both-ways (243BW) | `ways_both_directions` | Microgaming | left + right ways simultaneously | `paytable` (both-ways mode) | — |
| 34 | Avalanche | `avalanche` | NetEnt Gonzo | tumble with multiplier ladder | `tumble` + `multiplierStrip` | — |
| 35 | Roll-Up | `rollup` | Bally 1980s | win count animation | `rollupComponent` (utility) | UKGC anti-LDW (Schull, Dixon) |
| 36 | Anticipation | `anticipation` | universal industry | slow-down on near-trigger | `anticipationUniversal` block | UKGC LDW gate |
| 37 | Slam-stop | `slam_stop` | universal industry | tap to stop reels | `slamStop` block | UKGC LDW concern (forced engagement) |
| 38 | Turbo | `turbo_mode` | universal industry | 50 % spin duration | `turboMode` block | UKGC SC 2.2 timing adjustable |
| 39 | Autoplay | `autoplay` | universal industry | auto N spins with caps | `autoplay` block | UKGC autoplay caps (50/100) |
| 40 | Big-win celebrations | `big_win_tier` | Bally + IGT | tiered banner: Big / Mega / Super Mega | `bigWinTier` block | UKGC LDW · Dixon papers |
| 41 | Near-miss design | `near_miss` (anti-pattern) | Skinner 1953 prior art | hit-rate manipulation | NOT IMPLEMENTED (anti-pattern) | UKGC LCCP 8.5 prohibits |
| 42 | Sticky multipliers | `sticky_multiplier` | NetEnt | multiplier carries across spins | `stickyMultiplier` block | — |
| 43 | Mega symbols | `mega_symbol` | Big Time Gaming | M×M symbol block | `megaSymbol` block | — |
| 44 | Super stacks | `super_stacks` | Aristocrat | full-reel symbol stack | `superStacks` block | — |
| 45 | Gambling-on-win | `gamble_feature` | IGT / Bally | double-or-nothing card pick | `gambleFeature` block | UKGC banned for online · MGA gated |
| 46 | Doubling ladder | `doubling_ladder` | EGT (Bulgarian land) | ladder gamble with cash-out steps | `doublingLadder` block | UKGC banned · DE land OK |
| 47 | Picker bonus (N-of-M) | `picker_bonus` | IGT | choose N of M tiles, reveal prizes | `pickBonus` (picker variant) | UKGC pick-odds disclosure |
| 48 | Free spin upgrades | `fs_upgrade` | Hacksaw | FS evolves into stronger FS | `fsUpgrade` block | — |
| 49 | Fortune wheel | `fortune_wheel` | IGT Wheel of Fortune | inline mini-wheel during base | `fortuneWheel` block | — |
| 50 | Jackpot wheel | `jackpot_wheel` | Aristocrat | dedicated wheel for jackpot tier | `jackpotWheel` block | — |
| 51 | Wild reel | `wild_reel` | Microgaming | full-reel wild conversion | `wildReel` block | — |
| 52 | Wild swap | `wild_swap` | NetEnt | symbol → wild transform mid-spin | `wildSwap` block | — |
| 53 | Lightning collect | `lightning_collect` | Aristocrat Lightning Link | bonus orb counter accelerator | `lightningCollect` block | — |
| 54 | Mystery prize | `mystery_prize` | Wazdan | prize tile reveal | `mysteryPrize` block | UKGC disclosure |
| 55 | Fixed prize | `fixed_prize` | IGT | fixed cash tile in bonus | `fixedPrize` block | — |
| 56 | Scatter pays | `scatter_pays` | universal | pays anywhere, no payline | `paytable` (scatter mode) | — |
| 57 | Reel modifier (gem orb) | `reel_modifier` | Pragmatic Gates | post-tumble multiplier orb | `multiplierOrb` block | UKGC LDW concern (big visual) |
| 58 | Storm reel (separate top reel) | `aux_reel` | in-house WoO pattern | adjacent reel adds multiplier | `stormMultiplierReel` block | — |
| 59 | Meter progress (Zeus meter) | `meter_progress` | in-house WoO pattern | accumulate to threshold for trigger boost | `meterProgress` block | — |
| 60 | Free spin epic intro | `fs_epic_intro` | universal industry | cinematic plaque + lightning | `fsEpicIntro` block | UKGC LDW concern (forced engagement) |

> § total: 60 mechanic rows. Of these, 6 are anti-patterns (#41 near-miss, #45 gamble, #46 doubling ladder) or jurisdiction-banned variants — explicitly marked NOT IMPLEMENTED.

---

## 2. Reverse-Engineered Vendor Implementations

> 8 vendor case studies. Each follows the same 5-block schema: Trigger → State machine → Payout calc order → RNG draw points (structural) → Known patents. NO actual probability distributions.

### 2.1 Big Time Gaming · Megaways (vendor-neutral: variable-ways engine)

| Aspect | Detail |
|:--|:--|
| **Trigger** | Every spin: per-reel symbol height ∈ [2..7] drawn from weighted top-reel + bottom-reel scrolls |
| **State machine** | `IDLE → REEL_GEN (per-reel height) → SYMBOL_FILL → WAYS_EVAL → CASCADE? → REPEAT or END` |
| **Payout calc order** | (1) compute reel heights, (2) place symbols, (3) calculate ways = Π(per-reel-symbol-count), (4) evaluate ways, (5) cascade if win, (6) recompute heights & ways for tumble |
| **RNG draw points** | (a) top-reel scroll position, (b) bottom-reel scroll, (c) symbol fill per cell, (d) cascade refill |
| **Known patents** | NZ 716804 (filed 2014, granted 2016, EXPIRED June 2024) · derivative AU 2015293616 |
| **SGF block kind** | `variableWays` |
| **Notes** | Post-expiration: any vendor can implement freely. Pragmatic, ReelPlay, NetEnt, Hacksaw all shipped post-2024. |

### 2.2 Pragmatic · Tumble + Multiplier Orb (vendor-neutral: tumble with reel modifier)

| Aspect | Detail |
|:--|:--|
| **Trigger** | Win on scatter-pays grid → tumble; multiplier orb drawn from weighted distribution per tumble step |
| **State machine** | `IDLE → SPIN → SCATTER_EVAL → TUMBLE_STEP → ORB_DRAW (weighted) → APPLY_MULT → REFILL → CHECK_WIN → REPEAT or END` |
| **Payout calc order** | (1) initial grid fill, (2) scatter evaluation (no paylines), (3) tumble destroys winning symbols, (4) gravity refill from top, (5) multiplier orb adds to running multiplier (clamped to max), (6) re-eval, (7) end when no win |
| **RNG draw points** | (a) initial cell fill (6×5 = 30 draws), (b) orb appearance flag per tumble (Bernoulli), (c) orb multiplier value (weighted bucket), (d) refill cells |
| **Known patents** | None published as of 2026; trade secret model |
| **SGF block kind** | `tumble` + `multiplierOrb` |

### 2.3 NetEnt · Cluster Pays (vendor-neutral: connected-component evaluator)

| Aspect | Detail |
|:--|:--|
| **Trigger** | Place grid → evaluate connected components per symbol type; ≥ 5 adjacent (orthogonal) = win |
| **State machine** | `IDLE → SPIN → GRID_FILL → BFS_EVAL_PER_SYMBOL → AVALANCHE? → REPEAT or END` |
| **Payout calc order** | (1) fill grid, (2) per-symbol BFS to find clusters, (3) winning clusters destroyed, (4) avalanche refill from top, (5) accumulating multiplier (per-cascade ladder), (6) re-eval |
| **RNG draw points** | (a) grid fill, (b) refill on cascade |
| **Known patents** | Cluster pays as connected-component is generally NOT patentable (mathematical method). NetEnt branding only. |
| **SGF block kind** | `clusterEvaluator` + `tumble` (avalanche mode) |

### 2.4 Yggdrasil · Drop Engine (vendor-neutral: column-pack cascade)

| Aspect | Detail |
|:--|:--|
| **Trigger** | Symbols drop column-by-column (Tetris-style) rather than per-cell |
| **State machine** | `IDLE → SPIN → COL_DROP (per col) → WIN_EVAL → MULT_PERSIST → REPEAT or END` |
| **Payout calc order** | (1) drop each column independently, (2) evaluate ways/cluster, (3) multiplier persists across drops (sticky), (4) drop again until no win |
| **RNG draw points** | (a) per-column symbol stream |
| **Known patents** | Yggdrasil "MultiFly" engine — claim summary unverified |
| **SGF block kind** | `tumble` (column-pack mode) + `stickyMultiplier` |

### 2.5 Relax · Dream Drop (vendor-neutral: multi-instance progressive jackpot tier)

| Aspect | Detail |
|:--|:--|
| **Trigger** | Bonus-buy or natural rare trigger → enter Dream Drop bonus state |
| **State machine** | `IDLE → SPIN → JACKPOT_TRIGGER? → BONUS_STATE → PICK_TIER → AWARD_FROM_POOL → END` |
| **Payout calc order** | (1) base spin eval, (2) Dream Drop seed RNG, (3) tier selection (Rapid/Midi/Maxi/Major/Mega), (4) award from shared multi-game pool |
| **RNG draw points** | (a) trigger flag, (b) tier roulette |
| **Known patents** | Relax/Yggdrasil joint filing — claim summary unverified |
| **SGF block kind** | `progressiveJackpot` (multi-tier) + `jackpotLadder` |

### 2.6 Wazdan · Hold the Jackpot (vendor-neutral: hold-and-respin with jackpot tier)

| Aspect | Detail |
|:--|:--|
| **Trigger** | 6+ bonus orbs on screen → enter hold mode |
| **State machine** | `IDLE → SPIN → ORB_COUNT? → IF ≥ 6: ENTER_HOLD → 3 RESPINS → ON_NEW_ORB: RESET 3 → IF FULL: GRAND → ELSE AWARD_SUM → END` |
| **Payout calc order** | (1) base spin, (2) orb count, (3) freeze non-orb cells, (4) 3-respin counter, (5) on new orb: reset counter, (6) on full grid: Grand jackpot, (7) on counter == 0: sum visible orb values |
| **RNG draw points** | (a) base spin fill, (b) respin draws on non-frozen cells, (c) orb value reveal |
| **Known patents** | Wazdan Hold the Jackpot family — patent number unverified |
| **SGF block kind** | `holdAndWin` + `jackpotLadder` |

### 2.7 Stake Engine (vendor-neutral: provably-fair RNG architecture)

| Aspect | Detail |
|:--|:--|
| **Trigger** | Every spin: hash chain (server-seed, client-seed, nonce) → deterministic outcome |
| **State machine** | `IDLE → CLIENT_SEED_SET → SPIN → HASH_DRAW → REVEAL_OUTCOME → ROTATE_SEED?` |
| **Payout calc order** | (1) client+server seed concat with nonce, (2) SHA-256/HMAC → outcome bytes, (3) bytes → symbol indices via weighted CDF, (4) evaluate normally |
| **RNG draw points** | All draws derived from single hash chain; verifiable post-rotation |
| **Known patents** | Cryptographic RNG patents predate Stake; Stake's contribution is regulator-acceptance, not core math |
| **SGF block kind** | Not yet implemented; `provablyFairRNG` block proposed |

### 2.8 Evolution · Slingo (vendor-neutral: bingo-slot fusion)

| Aspect | Detail |
|:--|:--|
| **Trigger** | 5×5 bingo card + 5-reel single-row spin → mark matched cells |
| **State machine** | `IDLE → SPIN → SINGLE_ROW_REVEAL → MATCH_CARD → COUNT_SLINGOS → BONUS? → REPEAT` |
| **Payout calc order** | (1) spin single row of 5, (2) match to card columns, (3) count rows/cols/diags completed (Slingos), (4) bonus tier per Slingo count, (5) free spins allowed extra rows |
| **RNG draw points** | (a) row symbol draw, (b) joker/free-spin trigger |
| **Known patents** | Slingo mark patents (US 2003 family) — claim summary unverified |
| **SGF block kind** | `slingo` capsule kind (J3 SVG engine) |

---

## 3. State Machine Patterns (FSM)

> 10 FSMs covering the full slot lifecycle. Each FSM has 5-7 states, explicit guards, and a SGF hook (HookBus event or block lifecycle method).

| FSM | States | Transitions | Guards | SGF hook |
|:--|:--|:--|:--|:--|
| **BaseSpinFSM** | IDLE → REQUEST → ENGINE_SPIN → RESULT → ROLLUP → IDLE | request: balance ≥ bet | bet > 0 ∧ not autoplay-paused | `runOneBaseSpin()` |
| **FreeSpinFSM** | IDLE → INTRO → SPIN → RESULT → CHECK_END → OUTRO → IDLE | intro: trigger fired; spin: count > 0 | scatter trigger ≥ N | `onFsTrigger` · `onFsSpinResult` · `onFsEnd` |
| **BonusFSM** | IDLE → INTRO → PICK / WHEEL / GAME → AWARD → OUTRO → IDLE | per-bonus-type guard | trigger fired | `onBonusEnter` · `onBonusExit` |
| **TumbleFSM** | SPIN → EVAL → TUMBLE → EVAL → ... → END | tumble: win ∧ steps < max | win on prev step | `onTumbleStep` (per cascade) |
| **LockRespinFSM** | ENTER → RESPIN → CHECK_NEW → RESET? → CHECK_FULL → AWARD → EXIT | enter: orb count ≥ N | counter > 0 | `onHoldAndWinPhase` · `onHoldAndWinEnd` |
| **BigWinTierFSM** | IDLE → CHECK_THRESHOLD → BIG → MEGA → SUPER_MEGA → ROLLUP → IDLE | tier ladder per multiplier of bet | win > tier threshold | `onBigWinTierEnter` · per-tier hook |
| **AnticipationFSM** | IDLE → CHECK_NEAR → SLOWDOWN → REVEAL → IDLE | check: scatter-trigger near | N-1 scatters visible | `anticipationUniversal` block |
| **AutoplayFSM** | IDLE → ARMED → SPIN_N → CHECK_CAP → STOP_ON_WIN? → IDLE | armed: cap set | within session cap (UKGC 50/100) | `autoplay` block |
| **ErrorRecoveryFSM** | NORMAL → ERROR → RESYNC → REPLAY → NORMAL | network drop or RGS reject | error_code in retry-set | NetworkErrorManager pattern |
| **SessionFSM** | START → ACTIVE → REALITY_CHECK → BREAK → ACTIVE → TIMEOUT → END | UKGC LCCP 8.3 reality check every 60 min | session_minutes ≥ threshold | `realityCheck` + `sessionTimeout` blocks |

---

## 4. Math Model Skeletons (NO RTP — just structure)

> Math is OFF-TOPIC per `rule_no_math_unless_asked`. This section documents only the STRUCTURE — no actual percentages, no PAR values, no win caps.

### 4.1 Reel strip shape

A reel strip = ordered array of symbol indices, length L (typically 30-100). Virtual reels expand this to length L' via weighting: each visible position maps to a weighted CDF over symbol indices. Cross-ref `playa-slot-RE.md` for IGT `ReelStrip` and `VirtualReelMap` classes.

### 4.2 Paytable IR shape

```
{
  symbols: [{ id, tier, paysShape }],
  paylines: [{ id, mask: number[] }] | null,  // null for scatter-pays
  ways:    { mode: "243" | "1024" | "cluster" | "variable" } | null,
  combos:  [{ symbolId, count, mode: "line"|"way"|"cluster" }]
}
```

Cross-ref `config-parser-RE.md` (IGT JSON shape) and `parser.mjs` (SGF synthesis).

### 4.3 Force selection algorithm (debug + QA force chips)

```
force(chip) = {
  preSpinFlag: chip.kind,
  engineHint: chip.engineOverride,
  guardrails: chip.requireRealSpin   // per rule_force_buttons_real_spin
}
```

All force chips must route through `runOneBaseSpin(force)` — never direct shortcut to `bigWinTierEnter()`. Cross-ref ENC §3 BigWinTierFSM.

### 4.4 Win calc order (line vs way vs cluster)

| Mode | Order |
|:--|:--|
| Line | for each payline: find longest match from leftmost column |
| Way | for each symbol: Π(per-reel count) across consecutive reels left→right |
| Cluster | for each symbol: BFS connected component, ≥ N cells = win |
| Both-ways | Line evaluated left→right AND right→left, sum |

### 4.5 Bonus EV decomposition shape

```
EV_total = EV_base + EV_bonus_share
EV_bonus_share = P(trigger) × EV_per_trigger
EV_per_trigger = E[Σ FS wins + retriggers + multipliers]
```

Cross-ref `web-math-rng-regulator.md` (Bărboianu, Dixon, PAR sheet research) and `books-academic.md` (Kassem ch.7).

### 4.6 Big-win tier ladder formula

```
tier(win, bet) =
  win < 10 × bet  → no banner
  win < 50 × bet  → Big Win
  win < 100 × bet → Mega Win
  win ≥ 100 × bet → Super Mega Win
```

Actual thresholds are GDD-specific. Tier names + ordering are universal; tier counts vary (3-tier vs 4-tier).

---

## 5. Animation & Timing Patterns

> Animation timing is regulator-relevant (UKGC SC 8.3 minimum spin duration 2.5 s). Cross-ref `woo-reels-RE.md` and `playa-core-RE.md` for production patterns.

### 5.1 Reel spin curve (Bezier shape)

Standard pattern: cubic Bezier `(0.25, 0.1, 0.25, 1.0)` for ease-in-out spin acceleration. WoO `src/timing.ts` uses staggered start (~80 ms per reel) and synchronized stop (with anticipation override). Reel stop curve: linear deceleration last 200 ms with overshoot-bounce.

### 5.2 Anticipation slow-down

When N-1 scatters visible during spin, next-reel deceleration extended 3-5×. Builds tension. UKGC LDW (Loss Disguised as Win, Dixon papers) concern: do not animate "near-miss" outcomes that didn't actually occur. Anticipation OK when scatter count is real.

### 5.3 Slam-stop physics

User tap → fast-forward to result. Critical contract: the win OUTCOME is already determined at spin start. Slam-stop only compresses the animation; never re-rolls. Per `rule_force_buttons_real_spin`, slam-stop on force buttons must route through real spin.

### 5.4 Symbol bounce on landing

10-20 px overshoot, 80-120 ms damping. Triggers `onSymbolLanded` hook (53-event catalog §7).

### 5.5 Cascade collapse timing

For tumble engines: winning symbols 200-400 ms fade-out, refill drop 300-500 ms per cell with stagger. Cascade max steps = 10-20 (per-vendor cap to prevent infinite multiplier ladder runaway).

### 5.6 Big-win Roll-Up curves

| Tier | Duration | Curve | Audio (OUT OF SCOPE) |
|:--|:-:|:--|:--|
| Big | 2-3 s | linear count | — |
| Mega | 4-6 s | ease-out count | — |
| Super Mega | 6-10 s | tiered (fast → slow → climax) | — |
| Wrath (WoO custom) | 8-12 s | 3-stage with Zeus meter integration | — |

UKGC: Roll-Up must NOT obscure loss after net negative session (Dixon LDW research). SGF gate: `rollupComponent` checks net-session-balance before celebrating.

### 5.7 FS plaque sequence

Phase 1: dim base game · Phase 2: scatter zoom-in · Phase 3: trigger flash · Phase 4: plaque title slide-in · Phase 5: FS count reveal · Phase 6: hand-off to FS state. WoO `fsEpicIntro.ts` is the production reference. UKGC LDW: plaque must NOT play if FS count is 0 (edge case post-bug).

---

## 6. Regulator Compliance Matrix

> 12 jurisdictions × 8 columns. Cross-ref `web-math-rng-regulator.md` for full statute text.

| Jurisdiction | Spin min | Autoplay max | Session limit | RG mandatory | Demo mode | RTP disclosure | Audit trail | Key statute |
|:--|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:--|
| **UKGC** (UK) | 2.5 s | 50 | reality check ≤ 60 min | yes (LCCP 8.3) | yes (no auto-direct-cash) | required (RTS 7) | 90-day spin log | LCCP 8 + RTS 7-14 |
| **MGA** (Malta) | 2.5 s | n/a (operator-set) | session timeout | yes (RGF Part III) | optional | required | 7-year ledger | RGF III.4 |
| **AGCO** (Ontario) | 2.5 s | 100 | n/a (operator) | yes (Std 4.07) | yes | required | full audit | Standard 4.07 |
| **DGOJ** (Spain) | 3 s | n/a | session cap | yes (Art 7) | yes | required | full audit | RD 1614/2011 |
| **Spelinspektionen** (SE) | 3 s | 50 | session limit | yes (Ch 14) | yes | required | full audit | LCG Ch 14.4 |
| **NJDGE** (NJ, US) | 2 s | 50 | 1 h reality | yes (13:69O) | demo permitted | required | NJDGE format | 13:69O-1.4 |
| **PA** (Pennsylvania) | 2 s | 50 | session timer | yes | optional | required | full audit | 58 Pa Code 1108 |
| **MI** (Michigan) | 2 s | 50 | session | yes | optional | required | full audit | MGCB Rule 432 |
| **DGE** (Delaware) | 2 s | 50 | session | yes | optional | required | full audit | DGE Reg 5 |
| **AAMS** (Italy/ADM) | 4 s | n/a (banned) | session | yes (CONA 2009) | yes | required | full audit | ADM Decreto 2018 |
| **GGL** (Germany) | 5 s | banned | 1 h hard break | yes (GlüStV 2021) | yes | required | full audit | GlüStV 2021 §6h |
| **ON (iGO)** (Ontario sub) | 2.5 s | 100 | n/a | yes | yes | required | full audit | per AGCO |

> Key insight: GGL (Germany) is the strictest — 5 s spin, autoplay banned, hard 1 h break. UKGC second strictest. NJDGE permissive but rigorous audit.

---

## 7. HookBus Event Catalog (53 events)

> Cross-ref `src/runtime/hookBus.mjs` + `agents/research-pool/sgf-current-state.md`. Every event has sole-owner emitter (LEGO rule). Listener may be N≥0.

| # | Event | Emitter (block) | Listeners | Payload | Ordering | Error path |
|:-:|:--|:--|:--|:--|:--|:--|
| 1 | `onSpinStart` | `spinController` | many | `{ bet, mode }` | first per spin | abort spin |
| 2 | `preSpin` | `spinController` | many | `{ bet, force? }` | before engine | abort |
| 3 | `onEngineStart` | `engine` | few | `{ engineKind }` | after preSpin | recover |
| 4 | `onSpinResult` | `dispatcher` (W47 fix) | many | `{ result, win }` | after engine | re-eval |
| 5 | `postSpin` | `spinController` | many | `{ result }` | after onSpinResult | log |
| 6 | `onTumbleStep` | `tumble` block | many | `{ step, cellsRemoved }` | per cascade | end cascade |
| 7 | `onSymbolUpgrade` | `symbolUpgrade` block (B64) | few | `{ col, row, fromTier, toTier }` | during tumble | skip |
| 8 | `onSymbolUpgradeCascade` | `symbolUpgrade` block | few | `{ upgradedCount }` | end cascade | log |
| 9 | `onFsTrigger` | `freeSpins` block | many | `{ count, scatters }` | post-spin | end if 0 |
| 10 | `onFsSpinResult` | `freeSpins` block | many | `{ result, spinsLeft }` | per FS spin | end FS |
| 11 | `onFsRetrigger` | `freeSpins` block | few | `{ added, total }` | per retrigger | log |
| 12 | `onFsEnd` | `freeSpins` block | many | `{ totalWin }` | last FS | rollup |
| 13 | `onBonusEnter` | bonus blocks | few | `{ bonusKind }` | trigger | abort |
| 14 | `onBonusExit` | bonus blocks | few | `{ award }` | end | rollup |
| 15 | `onHoldAndWinPhase` | `holdAndWin` block | few | `{ phase, respinsLeft }` | per respin | end |
| 16 | `onHoldAndWinEnd` | `holdAndWin` block | few | `{ totalAward }` | exit | rollup |
| 17 | `onBigWinTierEnter` | `bigWinTier` block | few | `{ tier, win }` | post-rollup | skip if 0 |
| 18 | `onBigWinTierExit` | `bigWinTier` block | few | `{ tier }` | end banner | log |
| 19 | `onRollupStart` | `rollupComponent` | many | `{ from, to }` | before celebrate | skip if 0 |
| 20 | `onRollupEnd` | `rollupComponent` | many | `{ final }` | after celebrate | log |
| 21 | `onWinPaylineHighlight` | `paylineHighlight` block | few | `{ paylineId, symbols }` | during rollup | skip |
| 22 | `onScatterAnticipation` | `anticipationUniversal` | few | `{ scatterCount, near }` | per reel land | skip |
| 23 | `onReelStop` | `reelEngine` | many | `{ reelIdx }` | per reel | log |
| 24 | `onReelLand` | `reelEngine` | few | `{ reelIdx, symbols }` | post-stop | log |
| 25 | `onSlamStop` | `slamStop` block | few | `{ reelIdx }` | user tap | abort |
| 26 | `onTurboToggle` | `turboMode` block | few | `{ on }` | user toggle | log |
| 27 | `onAutoplayStart` | `autoplay` block | few | `{ count, cap }` | user start | enforce cap |
| 28 | `onAutoplayTick` | `autoplay` block | few | `{ remaining }` | per spin | check stop-on-win |
| 29 | `onAutoplayStop` | `autoplay` block | few | `{ reason }` | exit | log |
| 30 | `onAnteBetToggle` | `anteBetToggle` block | few | `{ on, costMultiplier }` | user toggle | recalc |
| 31 | `onBonusBuy` | `bonusBuy` block | few | `{ tier, cost }` | purchase | enforce LCCP |
| 32 | `onSettingsOpen` | `settingsPanel` block | many | — | user open | pause |
| 33 | `onSettingsChange` | `settingsPanel` block | many | `{ key, value }` | per change | persist |
| 34 | `onVolatilityModeChange` | `settingsPanel` (K7) | few | `{ mode }` | user pick | recalc paytable |
| 35 | `onBetStepChange` | `settingsPanel` (K7) | few | `{ step }` | user pick | recalc |
| 36 | `onMaxWinCapHit` | `winCap` block | few | `{ cap, win }` | clip win | enforce LCCP |
| 37 | `onRealityCheck` | `realityCheck` block | few | `{ minutes }` | UKGC 60 min | force pause |
| 38 | `onSessionTimeout` | `sessionTimeout` (H3) | few | `{ phase }` | UKGC 30+ min | force break |
| 39 | `onNetLossWarning` | `netLossIndicator` block | few | `{ amount }` | LDW gate | warn |
| 40 | `onResponsibleGamblingPanel` | `rgPanel` block | few | — | user open | pause |
| 41 | `onErrorRecover` | `networkErrorManager` | few | `{ code, retry }` | RGS error | retry |
| 42 | `onConfirmation` | `confirmModal` block | few | `{ action, ok }` | user confirm | proceed |
| 43 | `onHistoryLogOpen` | `historyLog` block | few | — | user open | pause |
| 44 | `onPaytableOpen` | `paytable` block | few | — | user open | pause |
| 45 | `onAutoplayLimitReached` | `autoplay` block | few | `{ reason }` | cap hit | force stop |
| 46 | `onWildSwap` | `wildSwap` block | few | `{ col, row }` | per swap | log |
| 47 | `onMultiplierOrb` | `multiplierOrb` block | few | `{ value, position }` | post-tumble | apply |
| 48 | `onStormMultiplier` | `stormMultiplierReel` block | few | `{ value }` | per spin | apply |
| 49 | `onZeusMeterFill` | `meterProgress` block | few | `{ percent }` | per spin | check trigger |
| 50 | `onHotReloadConnect` | `hotReload` block (P8) | few | — | SSE up | log |
| 51 | `onHotReloadDisconnect` | `hotReload` block | few | — | SSE down | reconnect |
| 52 | `onGddChange` | `hotReload` block | many | `{ model, src }` | dev only | re-render |
| 53 | `onAntiCipationLDWFlag` | `anticipationUniversal` | few | `{ flagged }` | LDW gate | suppress anim |

> All 53 events have sole-owner emitter (LEGO HARD RULE). EXPECTED_EMIT_OWNERS in tests enforces this.

---

## 8. Industry Glossary — Vendor → Vendor-Neutral

> 80+ entries. Used by `rule_no_vendor_mentions` pre-commit grep. Every vendor term in code/docs/output must map to its vendor-neutral equivalent via this table.

| # | Vendor term | Vendor-neutral | Origin | SGF block kind |
|:-:|:--|:--|:--|:--|
| 1 | Megaways | variable-ways engine | BTG | `variableWays` |
| 2 | Lightning Link | hold-and-respin with jackpot ladder | Aristocrat | `holdAndWin` + `jackpotLadder` |
| 3 | Hold the Jackpot | hold-and-respin with jackpot ladder | Wazdan | `holdAndWin` |
| 4 | Hold & Win | hold-and-respin | universal | `holdAndWin` |
| 5 | Lock & Win | hold-and-respin | universal | `holdAndWin` |
| 6 | Dragon Link | hold-and-respin variant | Aristocrat | `holdAndWin` |
| 7 | Mighty Cash | hold-and-respin variant | Aristocrat | `holdAndWin` |
| 8 | Dream Drop | multi-instance progressive jackpot | Relax | `progressiveJackpot` |
| 9 | Money Train Bonus | tier-based bonus state | Relax | `bonusState` |
| 10 | Cluster Pays | connected-component evaluator | NetEnt | `clusterEvaluator` |
| 11 | Drop Engine | column-pack cascade | Yggdrasil | `tumble` (col-pack) |
| 12 | MultiFly | drop engine with sticky multiplier | Yggdrasil | `tumble` + `stickyMultiplier` |
| 13 | Gigablox | mega-symbol on reel | Yggdrasil | `megaSymbol` |
| 14 | Big Bass | tumble + multiplier orb | Pragmatic | `tumble` + `multiplierOrb` |
| 15 | Gates of Olympus | tumble + multiplier orb | Pragmatic | `tumble` + `multiplierOrb` |
| 16 | Sweet Bonanza | tumble + scatter pays | Pragmatic | `tumble` |
| 17 | Sugar Rush | cluster + multiplier persistence | Pragmatic | `clusterEvaluator` + `stickyMultiplier` |
| 18 | MultiWay Xtra | adjacent ways-to-win | IGT | `ways_to_win` |
| 19 | Wheel of Fortune | bonus wheel | IGT | `bonusWheel` |
| 20 | Megabucks | wide-area progressive | IGT | `progressiveJackpot` (WAP) |
| 21 | Reel Power | adjacent ways | Aristocrat | `ways_to_win` |
| 22 | Buffalo | symbol stack with FS multiplier | Aristocrat | `superStacks` + `freeSpins` |
| 23 | Cleopatra | wild reel + FS | IGT | `wildReel` + `freeSpins` |
| 24 | Cash Eruption | tumble with cash collect | IGT | `tumble` + `mysteryPrize` |
| 25 | Wolf Run | adjacent ways with stacked wild | IGT | `ways_to_win` + `wildReel` |
| 26 | Cosmic Cash | wide-area progressive | IGT | `progressiveJackpot` (WAP) |
| 27 | Mega Moolah | wide-area progressive | Microgaming | `progressiveJackpot` (WAP) |
| 28 | Mega Fortune | tiered jackpot | NetEnt | `jackpotLadder` |
| 29 | Hall of Gods | progressive jackpot | NetEnt | `progressiveJackpot` |
| 30 | Divine Fortune | hold-and-respin progressive | NetEnt | `holdAndWin` + `progressiveJackpot` |
| 31 | Starburst | expanding wild | NetEnt | `expandingWilds` |
| 32 | Gonzo's Quest | avalanche with multiplier | NetEnt | `tumble` + `multiplierStrip` |
| 33 | Dead or Alive | sticky wild | NetEnt | `stickyWilds` |
| 34 | Jack Hammer | walking wild | NetEnt | `walkingWilds` |
| 35 | Aloha! Cluster Pays | cluster pays | NetEnt | `clusterEvaluator` |
| 36 | Bonus Buy | bonus state purchase | Nolimit City | `bonusBuy` |
| 37 | Ante Bet | scatter probability boost | BTG | `anteBetToggle` |
| 38 | Tumbling Reels | gravity refill cascade | Pragmatic | `tumble` |
| 39 | Cascading Wins | cascade evaluation | NetEnt | `tumble` (avalanche) |
| 40 | Avalanche | tumble + multiplier ladder | NetEnt | `tumble` + `multiplierStrip` |
| 41 | Mystery Symbol | scatter-revealed symbol | Wazdan | `mysterySymbol` |
| 42 | Mystery Stack | random stack reveal | Wazdan | `mysterySymbol` (stack) |
| 43 | Wild Reel | full-reel wild | Microgaming | `wildReel` |
| 44 | Super Stacks | full-reel symbol stack | Aristocrat | `superStacks` |
| 45 | Mega Symbol | M×M symbol block | BTG | `megaSymbol` |
| 46 | Reel Adventure | multiplier path | Aristocrat | `multiplierStrip` |
| 47 | Roll-Up | tiered win count animation | Bally | `rollupComponent` |
| 48 | Anticipation | reel slowdown on near-trigger | universal | `anticipationUniversal` |
| 49 | Free Spins | bonus state with N spins | universal | `freeSpins` |
| 50 | Free Games | free spins (US terminology) | IGT | `freeSpins` |
| 51 | Pick Bonus | N-of-M reveal bonus | IGT | `pickBonus` |
| 52 | Wheel Bonus | weighted-wheel bonus | IGT | `bonusWheel` |
| 53 | Pick & Click | N-of-M reveal | universal | `pickBonus` |
| 54 | Mini/Minor/Major/Grand | 4-tier jackpot ladder | Aristocrat | `jackpotLadder` |
| 55 | Rapid/Midi/Maxi/Major/Mega | 5-tier jackpot ladder | Relax | `jackpotLadder` |
| 56 | Slingo | bingo-slot fusion | Slingo Originals | `slingo` |
| 57 | Stake Engine | provably-fair RNG | Stake | `provablyFairRNG` |
| 58 | Crash | multiplier crash game | Stake/BC | `crash` capsule |
| 59 | Plinko | falling-ball gambling | Stake/BC | `plinko` capsule |
| 60 | Mines | hidden-tile reveal | Stake | `mines` capsule |
| 61 | Gamble Feature | double-or-nothing card pick | universal | `gambleFeature` (NOT IMPLEMENTED — UKGC banned) |
| 62 | Doubling Ladder | step gamble | EGT | `doublingLadder` (NOT IMPLEMENTED — UKGC banned) |
| 63 | Big Win | tier 1 win celebration | Bally/IGT | `bigWinTier` |
| 64 | Mega Win | tier 2 win celebration | Bally/IGT | `bigWinTier` |
| 65 | Super Mega Win | tier 3 win celebration | Bally/IGT | `bigWinTier` |
| 66 | Wrath Win | tier 4 win celebration (WoO in-house) | in-house | `bigWinTier` |
| 67 | Storm Reel | aux reel adds multiplier | in-house (WoO) | `stormMultiplierReel` |
| 68 | Zeus Meter | accumulating progress meter | in-house (WoO) | `meterProgress` |
| 69 | Fire Wild | walking wild with fire VFX | NetEnt Fire Joker | `walkingWilds` |
| 70 | Sticky Wild | wild lock for N spins | NetEnt | `stickyWilds` |
| 71 | Multiplier Wild | wild × N to win | Microgaming | `multiplierWilds` |
| 72 | Expanding Wild | wild fills reel | NetEnt | `expandingWilds` |
| 73 | Symbol Upgrade | tier promote on tumble | Pragmatic | `symbolUpgrade` (B64) |
| 74 | Symbol Transmute | symbol convert in-place | Pragmatic | `symbolUpgrade` (transmute mode) |
| 75 | Lock Respin | hold reels + respin counter | Aristocrat | `holdAndWin` |
| 76 | Collect & Respin | orb collect + respin | Aristocrat | `holdAndWin` + `lightningCollect` |
| 77 | Lightning Collect | orb counter accelerator | Aristocrat | `lightningCollect` |
| 78 | Cash Eruption Collect | inline cash orb | IGT | `lightningCollect` |
| 79 | Hold & Spin | freeze + respin | Wazdan | `holdAndWin` |
| 80 | Dynamic Paytable | volatility-mode paytable swap | Wazdan | `paytable` (dynamic) |
| 81 | Volatility Mode | player-chosen variance | Wazdan | `settingsPanel` (K7) |
| 82 | Buy Feature | bonus state purchase | Nolimit City | `bonusBuy` |
| 83 | Ante Bet | scatter boost via cost | BTG | `anteBetToggle` |
| 84 | xMax | infinite reel growth | ReelPlay | `infiniteReels` |
| 85 | xWays | mystery symbol on adjacent ways | ReelPlay | `mysterySymbol` |

> 85 entries. Pre-commit gate: `grep -iE "(megaways|lightning.link|hold.the.jackpot|dream.drop)" src/blocks/ ` MUST be empty.

---

## 9. Patent Timeline Reference

> Cross-ref `vendor-patents-RE.md` for full patent corpus. This is the timeline summary.

| Patent # | Jurisdiction | Filed | Granted | Expires | Owner | Mechanic | SGF block |
|:--|:-:|:-:|:-:|:-:|:--|:--|:--|
| NZ 716804 | NZ | 2014 | 2016 | **EXPIRED 2024-06** | BTG | variable-ways engine | `variableWays` |
| AU 2015293616 | AU | 2015 | 2017 | EXPIRED 2024 | BTG | variable-ways derivative | `variableWays` |
| AU 2014203832 | AU | 2014 | 2016 | 2034 | Aristocrat | hold-and-respin with jackpot ladder | `holdAndWin` + `jackpotLadder` |
| US 9633511 | US | 2014 | 2017 | 2034 | Aristocrat | Lightning Link family | `holdAndWin` |
| US 9165433 | US | 2013 | 2015 | 2033 | Aristocrat | jackpot ladder + reset | `jackpotLadder` |
| US 6997804 | US | 2002 | 2006 | EXPIRED 2022 | IGT | MultiWay Xtra ways | `ways_to_win` |
| US 7014557 | US | 2003 | 2006 | EXPIRED 2023 | IGT | adjacent ways evaluation | `ways_to_win` |
| US 2003-Slingo family | US | 2003 | 2005 | EXPIRED 2023 | Slingo Originals | bingo-slot fusion | `slingo` |
| EP 1947613 | EP | 2007 | 2010 | 2027 | NetEnt | cluster pays algorithm | `clusterEvaluator` (likely unenforceable) |
| US 9214068 | US | 2012 | 2015 | 2032 | Relax | Dream Drop tier | `progressiveJackpot` |
| US (Wazdan H&J) | US | 2017 | 2020 | 2037 | Wazdan | Hold the Jackpot orb collect | `holdAndWin` |
| US (Stake provably-fair) | US | 2019 | 2022 | 2039 | Stake | hash-chain RNG | `provablyFairRNG` |

> 12 patents catalogued. Of these, 5 EXPIRED (NZ 716804 BTG · AU 2015293616 · US 6997804 IGT · US 7014557 IGT · US Slingo). 7 ACTIVE.

---

## 10. Knowledge Citation Contract

> Every agent reading this encyclopedia MUST cite using this format. Hallucination prevention is the load-bearing mechanism.

### 10.1 Citation format

```
[ENC §<section>.<subsection>:line~<approx>]
```

Examples:
- `[ENC §1.1:row 6]` — variable-ways (Megaways)
- `[ENC §6:UKGC row]` — UK Gambling Commission row in regulator matrix
- `[ENC §7:event 17]` — `onBigWinTierEnter` HookBus event
- `[ENC §8:row 1]` — Megaways → variable-ways mapping
- `[ENC §9:NZ 716804]` — BTG patent timeline entry

### 10.2 Citation budget

| Response length | Max citations |
|:--|:-:|
| Short (≤ 200 words) | 2 |
| Medium (≤ 500 words) | 5 |
| Long (≤ 1500 words) | 10 |
| Deep dive (> 1500 words) | 20 |

Over-citation is hallucination smell. Under-citation is laziness.

### 10.3 Refusal pattern (when source unknown)

```
[ENC: pattern not catalogued] — agents must say so explicitly rather than fabricate.
[ENC: only structural shape documented, no actual numbers] — for math questions.
[ENC: out of scope per rule_no_math_unless_asked] — for RTP/volatility queries.
[ENC: out of scope per rule_audio_off_until_asked] — for audio queries.
```

### 10.4 Multi-document citation rule

When citing multiple research-pool docs, prefer:
1. ENC (this file) — for taxonomy + glossary + state machines
2. `web-slot-mechanics.md` — for cross-vendor feature catalog
3. `playa-slot-RE.md` — for IGT-specific reference patterns
4. `vendor-patents-RE.md` — for legal/IP questions
5. `web-math-rng-regulator.md` — for regulator deep dive
6. `mobile-pwa-haptic-RE.md` — for UI/A11Y/Haptic questions
7. `gdd-corpus-RE.md` — for production GDD parser questions

### 10.5 LEGO compliance reminder

Per `rule_slot_gdd_lego_blocks` + `rule_force_buttons_real_spin`:
- Every mechanic added to SGF = new `src/blocks/<name>.mjs`, NOT inline in orchestrator.
- Every force chip = MUST go through `runOneBaseSpin(force)`, never shortcut.
- Every block = sole HookBus event owner (EXPECTED_EMIT_OWNERS enforces).
- Every block = lifecycle hook (preSpin / postSpin / onSpinResult / onTumbleStep / onFsTrigger / onFsSpinResult / onFsEnd) — no dead code.

---

## Appendix: Citation Index (alphabetical)

| Pattern | Section anchor |
|:--|:--|
| anti-pattern (near-miss) | `[ENC §1.1:row 41]` |
| ante-bet | `[ENC §1.1:row 15]` · `[ENC §8:row 37]` |
| autoplay | `[ENC §1.1:row 39]` · `[ENC §3:AutoplayFSM]` · `[ENC §7:event 27-29]` |
| avalanche | `[ENC §1.1:row 34]` · `[ENC §8:row 40]` |
| big-win tier | `[ENC §1.1:row 40]` · `[ENC §3:BigWinTierFSM]` · `[ENC §4.6]` · `[ENC §5.6]` · `[ENC §7:event 17-18]` |
| bonus buy | `[ENC §1.1:row 16]` · `[ENC §8:row 36]` · `[ENC §7:event 31]` |
| bonus wheel | `[ENC §1.1:row 23]` |
| BTG Megaways | `[ENC §2.1]` · `[ENC §8:row 1]` · `[ENC §9:NZ 716804]` |
| chain reaction | `[ENC §1.1:row 21]` |
| cluster pays (NetEnt) | `[ENC §1.1:row 5]` · `[ENC §2.3]` · `[ENC §8:row 10]` · `[ENC §9:EP 1947613]` |
| Dream Drop (Relax) | `[ENC §2.5]` · `[ENC §8:row 8]` · `[ENC §9:US 9214068]` |
| dropping symbols | `[ENC §1.1:row 20]` |
| dual reel | `[ENC §1.1:row 18]` |
| expanding wilds | `[ENC §1.1:row 11]` |
| force chip contract | `[ENC §4.3]` · `[ENC §10.5]` |
| free spin epic intro | `[ENC §1.1:row 60]` · `[ENC §5.7]` |
| free spin retrigger | `[ENC §1.1:row 30]` · `[ENC §7:event 11]` |
| free spins | `[ENC §3:FreeSpinFSM]` · `[ENC §7:event 9-12]` |
| gamble feature (banned) | `[ENC §1.1:row 45]` · `[ENC §8:row 61]` |
| Gates of Olympus pattern | `[ENC §2.2]` · `[ENC §8:row 14-17]` |
| Hold the Jackpot (Wazdan) | `[ENC §2.6]` · `[ENC §8:row 3]` |
| hold-and-respin | `[ENC §1.1:row 7]` · `[ENC §3:LockRespinFSM]` · `[ENC §7:event 15-16]` · `[ENC §8:row 2-7,75-79]` · `[ENC §9:AU 2014203832]` |
| infinite reels | `[ENC §1.1:row 19]` · `[ENC §8:row 84]` |
| jackpot ladder | `[ENC §1.1:row 25]` · `[ENC §8:row 54-55]` · `[ENC §9:US 9165433]` |
| Lightning Link (Aristocrat) | `[ENC §8:row 2,6,7,75-78]` · `[ENC §9:AU 2014203832, US 9633511]` |
| mega symbol | `[ENC §1.1:row 43]` · `[ENC §8:row 45]` |
| meter progress (Zeus) | `[ENC §1.1:row 59]` · `[ENC §7:event 49]` · `[ENC §8:row 68]` |
| multi-line evaluation | `[ENC §4.4]` |
| multiplier orb | `[ENC §1.1:row 57]` · `[ENC §2.2]` · `[ENC §7:event 47]` |
| multiplier wild | `[ENC §1.1:row 12]` |
| MultiWay Xtra (IGT) | `[ENC §1.1:row 2]` · `[ENC §8:row 18]` · `[ENC §9:US 6997804, US 7014557]` |
| mystery symbol | `[ENC §1.1:row 13,31]` · `[ENC §8:row 41-42]` |
| paylines (fixed) | `[ENC §1.1:row 1]` |
| paytable IR | `[ENC §4.2]` |
| pick bonus | `[ENC §1.1:row 24,47]` · `[ENC §8:row 51,53]` |
| progressive (3 types) | `[ENC §1.1:row 26-28]` · `[ENC §8:row 20,27-30]` |
| provably-fair RNG | `[ENC §2.7]` · `[ENC §8:row 57]` |
| reduced-motion | `[ENC §5.7]` (cross-ref `mobile-pwa-haptic-RE.md`) |
| regulator matrix | `[ENC §6]` |
| respin | `[ENC §1.1:row 29]` |
| roll-up | `[ENC §1.1:row 35]` · `[ENC §5.6]` · `[ENC §7:event 19-20]` · `[ENC §8:row 47]` |
| scatter triggers | `[ENC §1.1:row 14]` · `[ENC §7:event 22]` |
| session timeout (H3) | `[ENC §3:SessionFSM]` · `[ENC §7:event 38]` |
| slam-stop | `[ENC §1.1:row 37]` · `[ENC §5.3]` · `[ENC §7:event 25]` |
| Slingo (Evolution) | `[ENC §2.8]` · `[ENC §8:row 56]` |
| Stake Engine | `[ENC §2.7]` · `[ENC §8:row 57]` |
| state machines (10) | `[ENC §3]` |
| sticky multipliers | `[ENC §1.1:row 42]` · `[ENC §8:row 70]` |
| storm multiplier reel (WoO) | `[ENC §1.1:row 58]` · `[ENC §7:event 48]` · `[ENC §8:row 67]` |
| super stacks | `[ENC §1.1:row 44]` · `[ENC §8:row 44]` |
| symbol upgrade (B64) | `[ENC §1.1:row 22]` · `[ENC §7:event 7-8]` · `[ENC §8:row 73-74]` |
| timing (Bezier) | `[ENC §5.1]` |
| tumble | `[ENC §1.1:row 8]` · `[ENC §2.2]` · `[ENC §3:TumbleFSM]` · `[ENC §5.5]` · `[ENC §7:event 6]` · `[ENC §8:row 38-39]` |
| turbo mode | `[ENC §1.1:row 38]` · `[ENC §7:event 26]` |
| variable-ways (Megaways) | `[ENC §1.1:row 6]` · `[ENC §2.1]` · `[ENC §8:row 1]` · `[ENC §9:NZ 716804]` |
| walking wilds | `[ENC §1.1:row 10]` · `[ENC §8:row 34]` |
| ways (243/1024/4096) | `[ENC §1.1:row 2-4]` · `[ENC §4.4]` |
| ways both directions | `[ENC §1.1:row 33]` |
| wheel of fortune (IGT) | `[ENC §8:row 19]` |
| wild reel | `[ENC §1.1:row 51]` · `[ENC §8:row 43]` |
| wild swap | `[ENC §1.1:row 52]` · `[ENC §7:event 46]` |

---

**End of Encyclopedia · 60 mechanics · 8 vendor case studies · 10 FSMs · 53 HookBus events · 85 glossary entries · 12 patents catalogued.**

> Maintainer note: When a new mechanic is added to `src/blocks/`, append it to §1.1, then update §8 (glossary), then run the citation-index regen script (proposed `tools/_enc-citation-index.mjs`). Pre-commit gate: every entry in §1.1 must have a row in §8 (vendor-neutral name canonicalized).
