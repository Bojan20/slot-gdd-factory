# GDD snippet index

> Auto-generated from `src/blocks/<name>.mjs` `defaultConfig()`
> exports + JSDoc header purpose lines.

Total blocks: **85**.

| Block | Has defaultConfig | Purpose |
|:--|:-:|:--|
| `anteBet` | ✅ |  |
| `anticipation` | ✅ | Slot GDD Factory · anticipation BLOCK Dynamic anticipation arming — when the scatter ladder is one short of the GDD's smallest trigger threshold (or already mee |
| `anticipationUniversal` | ✅ | 2026-06-11 (Boki: "ne radi mi anticipacija u svim gridovima. potpuno sredi anticipaciju u gridovima da bude dvojaka, po jedan na svakom rilu i bilo gde, zavisno |
| `audio` | ✅ | Wave U2 — Audio scaffolding block. Zero-dependency Web Audio API wrapper that provides a Howler-style cue API for the slot lifecycle, without pulling Howler.js  |
| `autoplay` | ✅ | Wave U4 — Autoplay session block. Industry-standard pattern (auto-spin settings panel + session runner): • Player picks N from a set of supported steps (10 / 25 |
| `balanceHud` | ✅ | Wave U8 — Balance HUD block. Industry-standard pattern (every certified slot ships one): a hub-bar widget that shows BALANCE \| BET \| WIN (and TOTAL WIN during |
| `betSelector` | ✅ | Wave U5 — Bet Selector block. Industry-standard pattern (coin × multiplier 2-axis bet model): • Player picks a coin denomination from a fixed coin ladder (e.g.  |
| `bigWinTier` | ✅ | Wave H5 — Big-Win Tier Ladder block. Five-tier celebration ladder for any win whose total-award-to-bet ratio exceeds a configurable threshold. |
| `bonusBuy` | ✅ |  |
| `bonusBuyDeterministic` | ✅ | Wave H11 — Bonus Buy Deterministic Plant extension. Industry pattern (template-neutral, vendor-neutral): The modern Bonus Buy ecosystem evolved beyond the origi |
| `bonusPick` | ✅ | Wave O1 — Bonus Pick / Pick-Em mini-game block. Modal overlay with K hidden tiles. |
| `clusterPaysEval` | ✅ | Wave M1 — Cluster Pays evaluator block. Flood-fill 4-connected (orthogonal) cluster detection for cluster-style grids (typical: 6x5 / 7x7). |
| `coinShower` | ✅ | Wave W47.S13 — B68 · coinShower block. Particle-burst celebration block. |
| `crashSpinEngine` | ✅ | Wave J3 — Crash multiplier curve animation. Industry-reference rationale ──────────────────────────── Crash-style slot fronts draw a multiplier curve that rises |
| `dailyJackpot` | ✅ | Slot GDD Factory · dailyJackpot BLOCK Vendor-neutral DAILY JACKPOT presenter — a persistent pool that grows by a fraction of every bet, resets each UTC day at a |
| `energyMeter` | ✅ | Wave B73 — Energy Meter side-feature gauge block. Industry baseline: many modern slot themes expose a metered side feature (e.g. "ENERGY 7/10") that fills on qu |
| `expandingWild` | ✅ | Wave L2 — Expanding Wild block. When GDD declares an `expanding_wild` feature, this block emits: • CSS expand-grow keyframe + column-fill overlay • Runtime that |
| `forceSkip` | ✅ | Wave V2 — Force-Skip button block. Industry-standard pattern (force-skip command for rollup/intro/outro): • A button shown during win-presentation, FS-intro, FS |
| `freeSpins` | ✅ | Slot GDD Factory · freeSpins BLOCK Performance budget: ≤ 1ms per FSM_renderHud, ≤ 50KB cumulative listener heap across a 200-retrigger session. The full Free-Sp |
| `fsProgressBar` | ✅ | Wave B69 — Free-Spins Progress Bar block. Industry baseline: a small, persistent UI strip that tells the player exactly where they are in the FS round (e.g. "Sp |
| `gamble` | ✅ | Wave P2 — Gamble (Double-or-Nothing) feature block. After a winning spin, player can gamble the win. |
| `gambleSecondary` | ✅ | Wave U6 — Secondary Gamble feature (Card branch + Ladder branch). Industry-standard pattern (two-branch double-or-nothing risk feature): Branch 1 — CARD GAMBLE  |
| `genericFeatureBanner` | ✅ | Wave U-FORCE-ALL.2 — Generic feature banner (fallback). Purpose ─────── Catch-all listener for `onForceFeatureRequested` events whose `kind` has no dedicated ha |
| `hapticFeedback` | ✅ | Wave A10 — Haptic feedback gating (Web Vibration API). Industry pattern: short, contextual vibration bursts on high-impact player events. |
| `hexReelEngine` | ✅ | Wave J2b — Hex real reel engine. Industry-reference rationale ──────────────────────────── Honeycomb / hex slot layouts (axial q,r coordinates) cannot reuse the |
| `historyLog` | ✅ | Wave U9 — Session History Log block. Industry-standard pattern (regulator-mandated, MGA/UKGC/NJ): every spin records an entry the player can scrub through after |
| `holdAndWin` | ✅ | Hold & Win / Hold & Spin block — industry-standard lock-and-respin pattern. Trigger: ≥N bonus/coin symbols on the grid → enter Hold round. |
| `holdAndWinCreditBucket` | ✅ | Wave H14 — Hold-and-Win Credit Bucket extension. Industry pattern (template-neutral, vendor-neutral): The "Credit Bucket" / "Cash-On-Reels" pattern is the unive |
| `hookBus` | ✅ | Slot GDD Factory · hookBus BLOCK THE central lifecycle bus. Every feature block registers its runtime callbacks here; the spin engine (runOneBaseSpin / handlePo |
| `hotReload` | ✅ | Wave P8 — **Hot-Reload bez page refresh** (dev-mode feedback loop). Industry pattern (template-neutral, vendor-neutral): Modern slot-game dev tooling exposes a  |
| `i18n` | ✅ | Wave HX3 + HX4 — Internationalization + currency formatting. Industry pattern: a slot ships to ~10 markets per release. |
| `lightning` | ✅ | Wave P1 — Lightning random-hit feature block. On a winning spin (or with a random chance), strike N cells with lightning bolts that overlay random multiplier va |
| `multiplierLadder` | ✅ | Wave B67 — Persistent Multiplier Ladder UI block. Industry baseline: many FS rounds expose a discrete climbing-mult ladder (e.g. 1× → 2× → 3× → 5× → 10×). |
| `multiplierOrb` | ✅ | Wave K3 — Multiplier Orb runtime. Special "orb" symbol (`M` by default) that carries a multiplier value (e.g. 2x, 5x, 25x, 1000x). |
| `mysteryReveal` | ✅ | Wave W47.S19 — B65 · mysteryReveal block. Event-presenter sibling of src/blocks/mysterySymbol.mjs. |
| `mysterySymbol` | ✅ | Wave L5 — Mystery Symbol block. Mystery cells appear with a "?" face, then transform into ONE picked regular symbol after the reels settle. |
| `netLossIndicator` | ✅ | Wave H12 — Net Win/Loss Indicator extension. Industry pattern (template-neutral, vendor-neutral): Regulator-mandated player-protection HUD chip. |
| `pathAwareMultiplier` | ✅ | Wave H13 — Path-Aware Multiplier extension (extends `waysEval`). Industry pattern (template-neutral, vendor-neutral): In a Ways-to-Win evaluator each anchored s |
| `payAnywhereEval` | ✅ | Wave K1 — Pay-anywhere (scatter pays) win evaluator. Replaces the line-based `detectLineWins()` when GDD declares `evaluation: 'pay_anywhere'` (pay-anywhere clu |
| `paylineOverlay` | ✅ | Slot GDD Factory · paylineOverlay BLOCK Browser-side SVG overlay that renders ONE polyline per win event through the geometric centres of matched cells, with a  |
| `paylines` | — | Slot GDD Factory · paylines BLOCK One concern: produce the canonical PAYLINE_POOL (array of line definitions, each line = array of row indices per reel) for a g |
| `paytable` | ✅ |  |
| `persistentMultiplier` | ✅ | Wave M3 — Persistent Multiplier block. Multiplier that does NOT reset between spins inside a round (typically FS round). |
| `pickBonusReveal` | ✅ | Wave W47.S16 — B71 · pickBonusReveal block. Reveal-celebration overlay that fires AFTER a pick-bonus game resolves (bonusPick.mjs / bonusPickDeterministic) or a |
| `plinkoSpinEngine` | ✅ | Wave J3 — Plinko ball-drop animation. Industry-reference rationale ──────────────────────────── Plinko slot fronts drop a single ball through a triangular peg g |
| `postSpin` | ✅ | Slot GDD Factory · postSpin BLOCK Emits the orchestration function called after every reel settles: handlePostSpin(duringFs) 1. Count visible trigger symbols (c |
| `progressiveFreeSpins` | ✅ | Wave U1 — Progressive Free-Spins multiplier block. Multiplier that **escalates on every FS spin regardless of win**, in contrast to `persistentMultiplier` which |
| `pwaInstallability` | ✅ | Wave A8 — Progressive Web App installability. Industry pattern: operators ship slots as installable web apps so players can add to home-screen, run full-screen  |
| `realityCheck` | ✅ | Wave H2 — Reality Check player-protection modal block. Industry pattern (template-neutral, vendor-neutral): Regulator-mandated "Reality Check" popup. |
| `reelEngine` | ✅ | Slot GDD Factory · reelEngine BLOCK (hot-path) The complete reel spin engine — column builder + tick loop + spin orchestrator + static-reroll fallback for non-u |
| `reelEngineCSS` | ✅ | Slot GDD Factory · reelEngineCSS BLOCK Pure CSS layer for the reel-strip engine (rectangular + every uniform column-grid shape). Defines: .reelCol — column cont |
| `respin` | ✅ | perf budget: O(reels*rows) DOM walk, ≤0.3ms @ 5×3 Accessibility: banner uses aria-live="polite" + role="status" for screen reader. Wave N2 — Respin block. |
| `rewardChest` | ✅ | Wave W47.S16 — B74 · rewardChest block. End-of-round chest reveal presenter. |
| `rtlLayout` | ✅ | Wave A5 — Right-to-left (RTL) layout support. Industry pattern: slot UIs ship to MENA / Israel / Iran / Pakistan markets need bidirectional layout. |
| `scatterCelebration` | ✅ |  |
| `sessionTimeout` | ✅ | Wave H3 — Session Timeout (continuous-play limit + forced break) block. Industry pattern (template-neutral, vendor-neutral): Regulator-mandated continuous-play  |
| `settingsPanel` | ✅ | Wave U13 — Settings Panel (gear-icon modal). Industry-standard pattern (every certified slot ships one): a gear / cog button on the hub opens a modal sa konsoli |
| `slamStop` | ✅ | Wave V1 — Slam-Stop button block. Industry-standard pattern (fast-stop / "slam" command): • A button (and optional whole-reels click area) that the player can p |
| `slingoSpinEngine` | ✅ | Wave J3 — Slingo board + strip animation. Industry-reference rationale ──────────────────────────── Slingo combines bingo + slot: 5×5 marked board + 1×5 strip t |
| `spinControl` | ✅ | Wave V3 — Unified primary-action button (SPIN / STOP / SKIP). Perf budget: state morph ≤ 1ms; click handler ≤ 0.2ms; zero layout thrash (icon swap via data-stat |
| `spinTempo` | ✅ | Slot GDD Factory · spinTempo BLOCK Reel-spin cadence config — drives the windup → accel → steady → decel → stagger → cushion-bounce timing of every uniform-reel |
| `stageBadge` | ✅ | Slot GDD Factory · stageBadge BLOCK Performance budget: ≤1 active animation; backdrop-filter limited to header pill; runtime <0.5KB minified. Live indicator pil |
| `stickyMeter` | ✅ | Wave B70 — Sticky Symbol Counter HUD block. Industry baseline: many FS rounds expose a small counter that tracks how many sticky symbols (typically wilds) are c |
| `stickyWild` | ✅ | Wave L1 — Sticky Wild block. When GDD declares a `sticky_wild` feature, this block emits: • CSS halo + lock-icon overlay for sticky cells • Runtime registry of  |
| `superSymbol` | ✅ | Wave P3 — Super / Colossal / Mega Symbol block. 2×2 / 3×3 / 4×4 super-symbol blocks land on the grid as a single oversized tile. All N×N cells under it count as |
| `symbolInfoPopover` | ✅ | Slot GDD Factory · symbolInfoPopover BLOCK Wave V7 — tap / hover a grid cell → small popover with that symbol's tier + label + (placeholder) payout hint. Closes |
| `symbolStackCollapse` | ✅ | Wave W47.S18 — B75 · symbolStackCollapse block. Full-column "stack drop" celebration that fires when a tumble step clears an entire reel of the same symbol (or  |
| `symbolUpgrade` | ✅ | Wave B64 (Faza 3 · Pre-Math Roadmap) — Symbol Upgrade / Transmute block. ─── Purpose ────────────────────────────────────────────────────────── During a tumble  |
| `themeCSS` | ✅ | Wave T-slim — extract of the slot-template "chrome" CSS that previously lived inline in `src/buildSlotHTML.mjs` (lines ~273-555, ≈280 LOC). What this block cove |
| `triggerCounting` | ✅ | Slot GDD Factory · triggerCounting BLOCK Emits the two helpers that turn a settled grid into a "scatter count → spins awarded" answer. Decoupled from the reel e |
| `tumble` | ✅ | Wave K2 — Tumble (cascade / avalanche) runtime engine. When GDD declares `topology.cascade.enabled: true` (cluster-cascade / pay-anywhere / cluster-cascade refe |
| `turboMode` | ✅ | Wave U11 — Turbo Mode block. Industry-standard pattern (every certified slot ships a turbo / quick- spin toggle): a hub button flips a global flag that compress |
| `uiToast` | ✅ | Wave U3 — Unified UI toast block. Centralised "celebration" overlay for win tiers and feature triggers. |
| `universalForcePanel` | ✅ | Wave U-FORCE-ALL.1 — Universal feature force panel (PRESENTATION MODE). Purpose ─────── When a regulator, sales-team member, or partner uploads ANY GDD into the |
| `walkingWild` | ✅ | Wave L3 — Walking Wild block. Wild walks one position per spin (typical: leftward) and triggers a respin until it walks off the grid. |
| `waysEval` | ✅ | Wave M2 — Ways-to-Win evaluator block. Evaluates "ways" wins: from leftmost reel, count consecutive reels containing the same symbol; multiply by the count of t |
| `weightedWheelSegments` | ✅ | Wave H15 — Weighted Wheel Segments + Jackpot Tier Mapping extension. Industry pattern (template-neutral, vendor-neutral): Modern wheel-bonus mini-games use **no |
| `wheelBonus` | ✅ | Wave O2 — Wheel Bonus / Wheel of Fortune mini-game block. Overlay with a wheel of N segments. |
| `wheelBonusReveal` | ✅ | Wave W47.S18 — B72 · wheelBonusReveal block. Extension presenter that sits on top of the existing `wheelBonus.mjs` (mini-game) and `weightedWheelSegments.mjs` ( |
| `wheelSpinEngine` | ✅ | Wave J3 — Wheel / Radial spin engine. Industry-reference rationale ──────────────────────────── Wheel-of-fortune slot front-ends spin a single SVG group around  |
| `wildReel` | ✅ | Wave L4 — Wild Reel block. A randomly-picked reel turns fully wild on selected spins. |
| `winCap` | ✅ | Wave N3 — Win Cap terminator block. Regulator-mandated max-win enforcement. |
| `winPresentation` | ✅ | Slot GDD Factory · winPresentation BLOCK Orchestrates how winning combinations are PRESENTED to the player after reels settle — token cancellation, per-event cy |
| `winRollup` | ✅ | Slot GDD Factory · winRollup BLOCK Base-game total-win counter that ticks "TOTAL WIN: €X.XX" with a slot-machine digit-by-digit rollup whenever a regular win la |
| `winwaysIndicator` | ✅ | Wave B66 — Win-Ways Count Indicator block. Industry baseline: every "ways" game (243 / 1024 / 4096 / 7776 / 117 649 ways) displays a persistent label so the pla |
