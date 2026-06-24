# GDD snippet index

> Auto-generated from `src/blocks/<name>.mjs` `defaultConfig()`
> exports + JSDoc header purpose lines.

Total blocks: **211**.

| Block | Has defaultConfig | Purpose |
|:--|:-:|:--|
| `achievementToast` | ✅ | Wave LEGO-PROG (DEF1 · 3/3) — Level-up + achievement toast popups. @module achievementToast Purpose: When `playerXp.mjs` emits `onPlayerLevelUp` or when another |
| `addedSymbolsInjector` | ✅ | UQ-DEEP-AK · WAVE 1 · BLOCK D — ADDED SYMBOLS INJECTOR. Presentation + state block for the industry-canonical "added symbols" paradigm. |
| `allWaysEval` | ✅ | Wave LEGO — All-ways universal evaluator block. Purpose ─────── Universal "all-ways" win evaluator: counts a winning combination whenever a symbol appears on AN |
| `ambientBackgroundWheel` | ✅ | Wave H9 — Ambient Background Wheel (theme atmosphere visual). Industry baseline (vendor-neutral): Modern slot themes layer a slowly-rotating cosmetic background |
| `ambientBgVariants` | ✅ | Wave LEGO-THEME (B-8 · 3/3) — Mood-driven ambient background variants. @module ambientBgVariants Purpose: Listens to win/loss signals and switches the body back |
| `anteBet` | ✅ | Wave K5 — Ante Bet toggle (+25% bet, doubled trigger probability). @module anteBet Purpose: When GDD declares an `ante_bet` feature, this block emits an opt-in  |
| `anteBetLadder` | ✅ | Wave LEGO-BUY (4 / 8) — Multi-tier ante bet ladder (stake escalator). @module anteBetLadder Purpose: When GDD declares `ante_bet_ladder` (or `ante_bet.tiers[]`) |
| `anticipation` | ✅ | Slot GDD Factory · anticipation BLOCK Dynamic anticipation arming — when the scatter ladder is one short of the GDD's smallest trigger threshold (or already mee |
| `audio` | ✅ | Wave U2 — Audio scaffolding block. Zero-dependency Web Audio API wrapper that provides a Howler-style cue API for the slot lifecycle, without pulling Howler.js  |
| `autoplay` | ✅ | Wave U4 — Autoplay session block. Industry-standard pattern (auto-spin settings panel + session runner): • Player picks N from a set of supported steps (10 / 25 |
| `backendSpinEngine` | ✅ | LV3-3 — Backend spin engine adapter (MATH-INTEGRATION-LV3 · Boki 2026-06-24). Purpose Wraps the in-browser spin pipeline tako da svaki postSpin tick takođe pozi |
| `balanceHud` | ✅ | Wave U8 — Balance HUD block. Industry-standard pattern (every certified slot ships one): a hub-bar widget that shows BALANCE \| BET \| WIN (and TOTAL WIN during |
| `batchSimulatorPanel` | ✅ | LV3-5 — Batch simulator panel (MATH-INTEGRATION-LV3 · Boki 2026-06-24). Floating bottom-right panel sa "Run 1M / 10⁹ spins" CTAs. |
| `belgiumComplianceGate` | ✅ | W60.J-BE (Wave F7 / HX4) — Belgian Gaming Commission (BGC / KSC) gate. Loi du 7 mai 1999 sur les jeux de hasard + Arrêté royal du 25/10/2018 — Belgium runs one  |
| `betSelector` | ✅ | Wave U5 — Bet Selector block. Industry-standard pattern (coin × multiplier 2-axis bet model): • Player picks a coin denomination from a fixed coin ladder (e.g.  |
| `bidirectionalWaysEval` | ✅ | Wave LEGO-BW1 — Bidirectional ways evaluator ("win-both-ways"). Purpose ─────── Industry-reference "win-both-ways" paytable evaluator. |
| `bigSymbolRender2x2` | ✅ | Wave D-17.2 (industry-reference lock_respin family gap closure) — Oversized "big" symbol render + unit-count gate. Vendor-neutral generalization of the "2×2 Big |
| `bigWinTier` | ✅ | Wave H5 — Big-Win Tier Ladder block. Five-tier celebration ladder for any win whose total-award-to-bet ratio exceeds a configurable threshold. |
| `bonusBuy` | ✅ | Wave K4 — Bonus Buy button (direct purchase into FS bonus). @module bonusBuy Purpose: When GDD declares a `bonus_buy` feature, this block emits a "Buy Bonus" bu |
| `bonusBuyDeterministic` | ✅ | Wave H11 — Bonus Buy Deterministic Plant extension. Industry pattern (template-neutral, vendor-neutral): The modern Bonus Buy ecosystem evolved beyond the origi |
| `bonusBuyMenu` | ✅ | Wave LEGO-BUY (4 / 8) — Multi-tier bonus buy menu. @module bonusBuyMenu Purpose: When GDD declares `bonus_buy_menu` (or `bonus_buy.tiers[]`), this block replace |
| `bonusClimaxReveal` | ✅ | Wave H6 — Bonus Climax Reveal (presenter for any bonus-entry event). Industry baseline (vendor-neutral): When a bonus path is entered (free spins, hold-and-win, |
| `bonusOverlayMutex` | ✅ | Wave LEGO-FS3.3.B — Bonus overlay mutex / z-index manager. Purpose ─────── Coordinates the 3 parallel bonus overlays from Wave LEGO-B2 (matchThreeBonusReveal, m |
| `bonusPick` | ✅ | Wave O1 — Bonus Pick / Pick-Em mini-game block. Modal overlay with K hidden tiles. |
| `cascadeBooster` | ✅ | Wave H15 — Cascade Booster (per-cascade-depth multiplier escalation). Industry baseline (vendor-neutral): Tumble/cascade-pays slots commonly escalate a session- |
| `cascadePathDraw` | ✅ | Wave H24 — Cascade Path Draw (visual chain between cascade win cells). Industry baseline (vendor-neutral): Cascade/tumble slots benefit from a brief visual line |
| `cascadingWildPersistence` | ✅ | Wave LEGO-W2.1 — Cascading wild persistence. Purpose ─────── On cascade / tumble slots, a wild that landed on the grid stays PINNED for the rest of the tumble c |
| `cellLevelUpgrade` | ✅ | Wave H7 — Cell Level Upgrade (per-cell numeric level meter + badge). Industry baseline (vendor-neutral): Distinct from `symbolUpgrade.mjs` (which TRANSMUTES a l |
| `cellOverflowCounter` | ✅ | Wave H8 — Cell Overflow Counter (per-reel stack-overflow badge). Industry baseline (vendor-neutral): Stack-based slots (giant-symbol cascade, multi-row stacked  |
| `clusterPaysEval` | ✅ | Wave M1 — Cluster Pays evaluator block. Flood-fill 4-connected (orthogonal) cluster detection for cluster-style grids (typical: 6x5 / 7x7). |
| `clusterSizeMultiplier` | ✅ | Wave LEGO-M5 — Cluster pays multiplier scales with cluster size. Purpose ─────── On cluster-pays slots, the winning cluster gets a multiplier whose value depend |
| `coinCollect` | ✅ | Wave LEGO-COLLECT (B-4 · 1/3) — Coin / Token collection mechanic. @module coinCollect Purpose: When GDD declares `coin_collect` (or `token_collect`), this block |
| `coinShower` | ✅ | Wave W47.S13 — B68 · coinShower block. Particle-burst celebration block. |
| `collectRevealOverlay` | ✅ | Wave LEGO-COLLECT (B-4 · 3/3) — Threshold reveal choreography. @module collectRevealOverlay Purpose: When `cumulativeMeter.mjs` emits `onCumulativeMeterThreshol |
| `collectStreakBonus` | ✅ | Wave Z2 (Boki 2026-06-21 "automatski generise, ali neka povlaci znanje iz agenata koji su zaduzeni za te blokove") — agent-augmented scaffold. Archetype: accumu |
| `collectableSymbol` | ✅ | Wave H19 — Collectable Symbol (industry-standard symbol-collector meter). Industry baseline (vendor-neutral): Many modern slots track a SPECIFIC symbol (typical |
| `colorblindPatterns` | ✅ | Wave H4 — Color-blind pattern overlay (WCAG 2.2 SC 1.4.1 Use of Color · AAA). Industry baseline (vendor-neutral): Information that is conveyed by colour alone ( |
| `copyWildOrchestrator` | ✅ | UQ-DEEP-AK · WAVE 1 · BLOCK A — Copy Wild Orchestrator. Purpose ─────── Industry-canonical "copy wild" paradigm: when a wild symbol lands on a designated source |
| `crashSpinEngine` | ✅ | Wave J3 — Crash multiplier curve animation. Industry-reference rationale ──────────────────────────── Crash-style slot fronts draw a multiplier curve that rises |
| `creditAwardConversion` | ✅ | Wave D-17.8 (industry-reference lock_respin family gap closure) — Single-source-of-truth credit → money conversion contract. Centralizes the canonical `coin_val |
| `cumulativeMeter` | ✅ | Wave LEGO-COLLECT (B-4 · 2/3) — Session-cumulative HUD meter. @module cumulativeMeter Purpose: Visible HUD widget (top-right corner default) that mirrors the `w |
| `dailyJackpot` | ✅ | Slot GDD Factory · dailyJackpot BLOCK Vendor-neutral DAILY JACKPOT presenter — a persistent pool that grows by a fraction of every bet, resets each UTC day at a |
| `denmarkComplianceGate` | ✅ | W60.J-DK (Wave F7 / HX3) — Denmark Spillemyndigheden (DGA) compliance gate. Bekendtgørelse om online kasino (BEK nr 727 af 25/06/2010) + Spillemyndighedens vejl |
| `driftSentinel` | ✅ | LV3-6 — Drift sentinel (MATH-INTEGRATION-LV3 · Boki 2026-06-24). Listens for onDriftAlert / onLiveRtpUpdate events i prikazuje toast notifikaciju kada measured  |
| `dualRoleScatter` | ✅ | Wave H10 — Dual-Role Scatter (scatter that doubles as wild or pay). Industry baseline (vendor-neutral): Many modern games extend the classic scatter so the symb |
| `dynamicWaysEngine` | ✅ | Wave LEGO-DWE — Dynamic Ways Engine (variable rows per reel). Purpose ─────── Industry-reference "variable rows per reel" ways system. |
| `energyMeter` | ✅ | Wave B73 — Energy Meter side-feature gauge block. Industry baseline: many modern slot themes expose a metered side feature (e.g. "ENERGY 7/10") that fills on qu |
| `euAiActComplianceGate` | ✅ | W58.J-EU — EU AI Act (Regulation 2024/1689) compliance gate. Centralized opt-in block that enforces three EU AI Act obligations at boot time. |
| `expandingWild` | ✅ | Wave L2 — Expanding Wild block. When GDD declares an `expanding_wild` feature, this block emits: • CSS expand-grow keyframe + column-fill overlay • Runtime that |
| `expandingWildMultiplier` | ✅ | Wave LEGO-EWM — Expanding wild + ×N multiplier tag. Purpose ─────── When a wild lands on a reel, the wild EXPANDS to cover the entire reel AND carries a ×N mult |
| `extendedWildCountdown` | ✅ | UQ-DEEP-AK · WAVE 1 · BLOCK C — EXTENDED WILD COUNTDOWN. Industry-canonical "extended wild" paradigm presentation + state block. |
| `forceSkip` | ✅ | Wave V2 — Force-Skip button block. Industry-standard pattern (force-skip command for rollup/intro/outro): • A button shown during win-presentation, FS-intro, FS |
| `franceComplianceGate` | ✅ | W58.J-FR — French ANJ (Autorité nationale des jeux) compliance gate. Centralized opt-in block that enforces ANJ's slot-mechanics obligations at boot time. |
| `freeSpins` | ✅ | Slot GDD Factory · freeSpins BLOCK Performance budget: ≤ 1ms per FSM_renderHud, ≤ 50KB cumulative listener heap across a 200-retrigger session. The full Free-Sp |
| `fsExpansionWilds` | ✅ | Wave LEGO — Free Spins Expanding Sticky Wilds. Purpose ─────── Free Spins feature where any wild landing in a reel during a FS spin EXPANDS to cover the entire  |
| `fsPersistentJackpotPool` | ✅ | Wave LEGO-FS2.2 — Persistent jackpot pool across FS spins. Purpose ─────── FS round maintains a JACKPOT POOL (×bet units) that: • starts at a configured floor o |
| `fsProgressBar` | ✅ | Wave B69 — Free-Spins Progress Bar block. Industry baseline: a small, persistent UI strip that tells the player exactly where they are in the FS round (e.g. "Sp |
| `fsReelHeightEscalation` | ✅ | Wave LEGO-FS3.2 — FS retrigger → reel height escalation. Purpose ─────── Each FS retrigger BUMPS the visible row count of every reel by `rowsPerRetrigger` (defa |
| `fsSymbolUpgradeEscalation` | ✅ | Wave LEGO-FS2.1 — FS symbol-tier escalation. Purpose ─────── During the FS round, the LOWEST PAYING symbol still in active use gets UPGRADED to the next tier (L |
| `gamble` | ✅ | Wave P2 — Gamble (Double-or-Nothing) feature block. After a winning spin, player can gamble the win. |
| `gambleSecondary` | ✅ | Wave U6 — Secondary Gamble feature (Card branch + Ladder branch). Industry-standard pattern (two-branch double-or-nothing risk feature): Branch 1 — CARD GAMBLE  |
| `gddRealityCheck` | ✅ | Wave D-18 (Boki "ultimativna arhitektura" 2026-06-20) — GDD-truth reality check. Lifecycle: subscribe to ALL canonical events for a configurable sample window ( |
| `gddRuntimeMeta` | ✅ | Wave RENDER-INTEG-A (2026-06-23) — GDD runtime meta-emit block. @module gddRuntimeMeta Purpose: Surfaces parser-extracted GDD math/compliance fields to the runt |
| `genericFeatureBanner` | ✅ | Wave U-FORCE-ALL.2 — Generic feature banner (fallback). Purpose ─────── Catch-all listener for `onForceFeatureRequested` events whose `kind` has no dedicated ha |
| `germanyComplianceGate` | ✅ | W58.J-DE — GlüStV (Glücksspielstaatsvertrag 2021) compliance gate. Centralized opt-in block that enforces TWO German jurisdiction obligations at boot time: §11( |
| `grandInterruptionLock` | ✅ | Wave D-17.6 (industry-reference lock_respin family gap closure) — GRAND interruption-lock + handpay route. Detects when a hold-and-win session has reached the G |
| `hapticFeedback` | ✅ | Wave A10 — Haptic feedback gating (Web Vibration API). Industry pattern: short, contextual vibration bursts on high-impact player events. |
| `hexClusterEngine` | ✅ | Wave LEGO-ENG.2 — Hex grid + cluster pays evaluator fusion. Purpose ─────── Combines hex-axial grid topology (q,r coordinates) with cluster- pays evaluator (con |
| `hexReelEngine` | ✅ | Wave J2b — Hex real reel engine. Industry-reference rationale ──────────────────────────── Honeycomb / hex slot layouts (axial q,r coordinates) cannot reuse the |
| `hiLoGamble` | ✅ | Wave H16 — Hi/Lo Card Gamble (classic post-win risk presenter). Industry baseline (vendor-neutral): Many classic and modern slots offer a post-win double-or-not |
| `historyLog` | ✅ | Wave U9 — Session History Log block. Industry-standard pattern (regulator-mandated, MGA/UKGC/NJ): every spin records an entry the player can scrub through after |
| `holdAndWin` | ✅ | Hold & Win / Hold & Spin block — industry-standard lock-and-respin pattern. Trigger: ≥N bonus/coin symbols on the grid → enter Hold round. |
| `holdAndWinCreditBucket` | ✅ | Wave H14 — Hold-and-Win Credit Bucket extension. Industry pattern (template-neutral, vendor-neutral): The "Credit Bucket" / "Cash-On-Reels" pattern is the unive |
| `holdAndWinFrameMultiplier` | ✅ | Wave LEGO-HW2 — Frozen Frame Multiplier for Hold & Win respin rounds. Purpose ─────── In some Hold & Win formats each locked bonus cell carries its OWN persiste |
| `holdAndWinLockedOrbMultiplier` | ✅ | Wave LEGO-HW-M2 — Locked-orb ×N multiplier tag for Hold & Win respins. Purpose ─────── Alternative round-end semantics for Hold & Win where each locked orb carr |
| `holdAndWinReelExpansion` | ✅ | Wave LEGO-HW2.2 — Hold & Win reel expansion (premium tier). Purpose ─────── Mid-round during an active H&W feature, the grid EXPANDS by an extra reel column whe |
| `holdAndWinRoomJackpotMultiplier` | ✅ | Wave LEGO-HW-RJM — Hold & Win Room/Jackpot Multiplier ladder. Purpose ─────── For Hold & Win (Respin / Lock & Spin) rounds where the player progresses through a |
| `hookBus` | ✅ | Slot GDD Factory · hookBus BLOCK THE central lifecycle bus. Every feature block registers its runtime callbacks here; the spin engine (runOneBaseSpin / handlePo |
| `hotReload` | ✅ | Wave P8 — **Hot-Reload bez page refresh** (dev-mode feedback loop). Industry pattern (template-neutral, vendor-neutral): Modern slot-game dev tooling exposes a  |
| `i18n` | ✅ | Wave HX3 + HX4 — Internationalization + currency formatting. Industry pattern: a slot ships to ~10 markets per release. |
| `inSyncReels` | ✅ | UQ-DEEP-AK · WAVE 1 · BLOCK B — Synchronized Reels presentation + state. Industry baseline (vendor-neutral): "Synchronized reels" / "linked columns" paradigm —  |
| `infiniteFsUntilLoss` | ✅ | Wave LEGO-FSV.4 — Infinite Free Spins until first losing spin. Purpose ─────── FS round runs INDEFINITELY as long as each spin produces a win. |
| `infinityReels` | ✅ | Wave H18 — Infinity Reels (grid expands per cascade-win counter presenter). Industry baseline (vendor-neutral): A modern industry pattern adds one extra reel to |
| `infinityReelsEngine` | ✅ | Wave LEGO-IRE — Infinity Reels Engine (grid grows on every win). Purpose ─────── Industry-reference "infinity reels grid expansion" pattern. |
| `insuranceBet` | ✅ | Wave LEGO-SIDEBET (B-7 · 1/2) — Insurance side bet. @module insuranceBet Purpose: Pre-spin toggle that lets the player add a small "insurance" wager (default +2 |
| `italyComplianceGate` | ✅ | W58.J-IT — Italian ADM (Agenzia delle Dogane e dei Monopoli, formerly AAMS) compliance gate. Centralized opt-in block that enforces ADM's slot-mechanics obligat |
| `jackpotLadderRooms` | ✅ | Wave H13 — Jackpot Ladder Rooms (4-tier room ladder presenter). Industry baseline (vendor-neutral): Many partner GDDs specify a 4-tier "jackpot ladder" with nam |
| `jackpotPicker` | ✅ | Wave LEGO-JPK — Jackpot Picker (N×M tile reveal grid, pick-K-of-N). Purpose ─────── Industry-reference "jackpot pick reveal grid" feature. |
| `jackpotRoomReveal` | ✅ | Wave LEGO-JRR — Jackpot Room Reveal (full-screen room ladder placard). Purpose ─────── When a Hold-and-Win style trigger event fires (e.g. collecting N+ orbs, o |
| `jurisdictionGate` | ✅ | W59.H1 — Centralized jurisdiction-precedence resolver + audit gate. Six jurisdiction-aware blocks (W57.A4 + W58.J-{UKGC,AGCO,SE,DE,NL,EU}) implemented the SAME  |
| `leaderboardChip` | ✅ | Wave LEGO-SOCIAL (B-5 · 1/2) — Session leaderboard chip. @module leaderboardChip Purpose: Small HUD chip showing the player's session rank vs the operator- prov |
| `lightning` | ✅ | Wave P1 — Lightning random-hit feature block. On a winning spin (or with a random chance), strike N cells with lightning bolts that overlay random multiplier va |
| `linkedReels` | ✅ | Wave D-17.3 (industry-reference lock_respin family gap closure) — Linked-reel block. Marks a configurable set of reel indices as a single "linked block" inside  |
| `liveRtpHud` | ✅ | LV3 — Live RTP HUD block (MATH-INTEGRATION-LV3 · Boki 2026-06-24). Purpose: Real-time HUD overlay koji prikazuje: • Measured RTP since boot (running mean payX / |
| `lockedSymbolFs` | ✅ | Wave LEGO-FSV.2 — Free Spins start with N symbols already locked. Purpose ─────── On FS_INTRO (before the first FS spin actually rolls), this block plants N "lo |
| `matchThreeBonusReveal` | ✅ | Wave LEGO-B2.1 — 3×3 pick-and-reveal match-three bonus game. Purpose ─────── On bonus trigger, player is shown a 3×3 face-down grid. |
| `mathEngine` | — | MATH-7 — slot-math-engine-template WASM oracle wrapper. Lazy-loads sister repo's compiled WASM (`~/Projects/slot-math-engine-template/ packages/slot-math-wasm/p |
| `megaSymbol` | ✅ | Wave H11 — Mega Symbol (oversized 2×2 / 3×3 symbol block). Industry baseline (vendor-neutral): Many cascade / scatter-pay slots occasionally drop a single "mega |
| `megaWildCluster` | ✅ | Wave LEGO-MWC — Mega Wild Cluster (oversized wild block). Purpose ─────── Industry-typical "colossal wild" / "oversized wild block" pattern: instead of a single |
| `moneyGrabGrid` | ✅ | Wave LEGO-B2.2 — Pick-N-cells money grab grid. Purpose ─────── Player is shown an N×M grid of face-down cells. |
| `motionOverlay` | ✅ | Wave 3 (W48 spin-quality rollout) — Shared ::after / ::before motion- overlay block, consumed by all six reel engines (rectangular, hex, wheel, crash, plinko, s |
| `multiplierLadder` | ✅ | Wave B67 — Persistent Multiplier Ladder UI block. Industry baseline: many FS rounds expose a discrete climbing-mult ladder (e.g. 1× → 2× → 3× → 5× → 10×). |
| `multiplierOrb` | ✅ | Wave K3 — Multiplier Orb runtime. Special "orb" symbol (`M` by default) that carries a multiplier value (e.g. 2x, 5x, 25x, 1000x). |
| `mysteryPrizeBox` | ✅ | Wave LEGO-RANDOM (B-3) — In-spin Mystery Prize Box. @module mysteryPrizeBox Purpose: When GDD declares `mystery_prize_box`, this block randomly drops a "treasur |
| `mysteryReveal` | ✅ | Wave W47.S19 — B65 · mysteryReveal block. Event-presenter sibling of src/blocks/mysterySymbol.mjs. |
| `mysterySymbol` | ✅ | Wave L5 — Mystery Symbol block. Mystery cells appear with a "?" face, then transform into ONE picked regular symbol after the reels settle. |
| `mysterySymbolMultiplier` | ✅ | Wave LEGO-M2 — Mystery symbol reveals as a multiplier value. Purpose ─────── Distinct from `mysterySymbol.mjs` (which reveals a random PAY symbol) and `multipli |
| `mysteryWildReveal` | ✅ | Wave LEGO-W2.2 — Mystery symbol reveals as WILD. Purpose ─────── Mystery "?" symbol on the grid is revealed not as a pay symbol but as the WILD symbol. |
| `nearMissTease` | ✅ | Wave H22 — Near-Miss Tease (visual "almost won" highlight). Industry baseline (vendor-neutral): When a high-value combination falls one cell short (e.g. 2 scatt |
| `netLossIndicator` | ✅ | Wave H12 — Net Win/Loss Indicator extension. Industry pattern (template-neutral, vendor-neutral): Regulator-mandated player-protection HUD chip. |
| `netherlandsComplianceGate` | ✅ | W58.J-NL — NL KSA (Wet kansspelen op afstand) compliance gate. Centralized opt-in block that enforces TWO Dutch jurisdiction obligations at boot time: §31 Cruks |
| `nudgeReel` | ✅ | Wave H17 — Nudge Reel (classic fruit-machine near-miss rescue presenter). Industry baseline (vendor-neutral): On near-miss spins (e.g. scatter 2 visible + 1 jus |
| `paletteRoulette` | ✅ | Wave LEGO-THEME (B-8 · 2/3) — Random palette roulette (per session). @module paletteRoulette Purpose: On page load, randomly picks one of N configured color pal |
| `pathAwareMultiplier` | ✅ | Wave H13 — Path-Aware Multiplier extension (extends `waysEval`). Industry pattern (template-neutral, vendor-neutral): In a Ways-to-Win evaluator each anchored s |
| `pathBonusEngine` | ✅ | Wave LEGO-B2.3 — Board-game path traversal bonus. Purpose ─────── Bonus round in board-game style: linear path of N tiles, player rolls "dice" (random 1..maxRol |
| `patternWin` | ✅ | Wave D-17.1 (industry-reference lock_respin family gap closure) — Pattern-Win block. Detects a named board pattern (stacked anchor symbol on a single anchor ree |
| `payAnywhereEval` | ✅ | Wave K1 — Pay-anywhere (scatter pays) win evaluator. Replaces the line-based `detectLineWins()` when GDD declares `evaluation: 'pay_anywhere'` (pay-anywhere clu |
| `paylineDimmer` | ✅ | Wave H27 — Payline Dimmer (dim non-winning cells during win presentation). Industry baseline (vendor-neutral): On a winning spin, modern slots dim every cell th |
| `paylineOverlay` | ✅ | Slot GDD Factory · paylineOverlay BLOCK Browser-side SVG overlay that renders ONE polyline per win event through the geometric centres of matched cells, with a  |
| `paylines` | — | Slot GDD Factory · paylines BLOCK One concern: produce the canonical PAYLINE_POOL (array of line definitions, each line = array of row indices per reel) for a g |
| `paytable` | ✅ | Wave U10 — Paytable modal block. @module paytable Purpose: Industry-standard pattern (every certified slot ships one): an "i" / "?" button on the hub opens a fu |
| `perFsSpinMultiplier` | ✅ | Wave LEGO-M1 — Per-FS-spin random multiplier. Purpose ─────── For Free Spins rounds where EACH individual FS spin carries its own independent random ×N multipli |
| `perTriggerVolatilitySet` | ✅ | Wave D-17.4 (industry-reference lock_respin family gap closure) — Per-trigger volatility set classifier + lock. Consumes an engine-supplied tier draw at hold-an |
| `persistentMultiplier` | ✅ | Wave M3 — Persistent Multiplier block. Multiplier that does NOT reset between spins inside a round (typically FS round). |
| `pickBonusReveal` | ✅ | Wave W47.S16 — B71 · pickBonusReveal block. Reveal-celebration overlay that fires AFTER a pick-bonus game resolves (bonusPick.mjs / bonusPickDeterministic) or a |
| `pickYourFs` | ✅ | Wave LEGO-FSV.1 — Pick-Your-Free-Spins mode selector. Purpose ─────── On FS trigger, present the player with N (typically 3) selectable FS variants — e.g.: A) 8 |
| `playerXp` | ✅ | Wave LEGO-PROG (DEF1 · 1/3) — XP accumulator + session levels. @module playerXp Purpose: Awards XP per spin (proportional to bet units) and per coin collected ( |
| `plinkoSpinEngine` | ✅ | Wave J3 — Plinko ball-drop animation. Industry-reference rationale ──────────────────────────── Plinko slot fronts drop a single ball through a triangular peg g |
| `postSpin` | ✅ | Slot GDD Factory · postSpin BLOCK Emits the orchestration function called after every reel settles: handlePostSpin(duringFs) 1. Count visible trigger symbols (c |
| `potSymbolFireball` | ✅ | Wave D-17.5 (industry-reference lock_respin family gap closure) — Pot-symbol classifier + value tracker. Adapter block that lets the hold-and-win cell persisten |
| `prizeBoostBet` | ✅ | Wave LEGO-SIDEBET (B-7 · 2/2) — Prize boost side bet. @module prizeBoostBet Purpose: Pre-spin toggle that lets the player add a cost premium (default +50% bet)  |
| `progressiveFreeSpins` | ✅ | Wave U1 — Progressive Free-Spins multiplier block. Multiplier that **escalates on every FS spin regardless of win**, in contrast to `persistentMultiplier` which |
| `progressiveFsRetriggerLadder` | ✅ | Wave LEGO-M — Progressive FS Retrigger Ladder. Purpose ─────── During a Free Spins round, every retrigger JUMPS the player to the NEXT pre-defined rung on a mul |
| `pwaInstallability` | ✅ | Wave A8 — Progressive Web App installability. Industry pattern: operators ship slots as installable web apps so players can add to home-screen, run full-screen  |
| `pyramidGridEngine` | ✅ | Wave LEGO-ENG.1 — Pyramid grid topology engine. Purpose ─────── Renders + animates a PYRAMID grid where each subsequent reel has ONE MORE row than its predecess |
| `randomLightningMultiplier` | ✅ | Wave LEGO-M2 — Random spin-wide "lightning" multiplier (base game). Purpose ─────── For BASE GAME spins only: after the win evaluation produces a non-zero base  |
| `randomWildBurst` | ✅ | Wave LEGO-RANDOM (B-3) — Random Wild Burst. @module randomWildBurst Purpose: When GDD declares `random_wild_burst`, this block randomly "bursts" N cells into wi |
| `realityCheck` | ✅ | Wave H2 — Reality Check player-protection modal block. Industry pattern (template-neutral, vendor-neutral): Regulator-mandated "Reality Check" popup. |
| `reelEngine` | ✅ | Slot GDD Factory · reelEngine BLOCK (hot-path) The complete reel spin engine — column builder + tick loop + spin orchestrator + static-reroll fallback for non-u |
| `reelEngineCSS` | ✅ | Slot GDD Factory · reelEngineCSS BLOCK Pure CSS layer for the reel-strip engine (rectangular + every uniform column-grid shape). Defines: .reelCol — column cont |
| `reelHeightAdapter` | ✅ | Wave LEGO-FS3.3.A — reelEngine grow/shrink adapter. Purpose ─────── Provides ATOMIC grow + shrink of reel column height at runtime. |
| `reelLockHold` | ✅ | Wave H23 — Reel Lock Hold (lock visible reels during a respin with countdown). Purpose: lock an entire reel column for a fixed N-spin window showing a visual "L |
| `regulatorDisclosureModal` | ✅ | Wave W60 — Universal regulator disclosure modal. The 13 regulator-gate atoms from W58 sweep + W59.H1 (UKGC autoplay disclosure / AGCO RTP transparency / SE play |
| `replayControlBar` | ✅ | Wave LEGO-REPLAY (B-2 · 2/2) — Player-facing replay control bar. @module replayControlBar Purpose: Bottom-center floating control bar with REPLAY · ⏮ · ⏯ · ⏭ ·  |
| `respin` | ✅ | perf budget: O(reels*rows) DOM walk, ≤0.3ms @ 5×3 Accessibility: banner uses aria-live="polite" + role="status" for screen reader. Wave N2 — Respin block. |
| `respinCharge` | ✅ | Wave H18 — Respin Charge (collect-N-charges-for-auto-respin meter). Industry baseline (vendor-neutral): Player collects "charges" (e.g. one per losing spin, or  |
| `retriggerEscalator` | ✅ | Wave H30 — Retrigger Escalator (multi-tier FS retrigger reward ladder). Industry baseline (vendor-neutral): Different from `superchargedFs` (multiplier ladder p |
| `retriggerMeter` | ✅ | Wave H20 — Retrigger Meter (FS retrigger visual progress meter). Industry baseline (vendor-neutral): Modern free-spins rounds commonly grant additional spins wh |
| `retriggerMultiplierBump` | ✅ | Wave LEGO-M4 — FS retrigger bumps the round multiplier by a fixed step or via a configured ladder. Purpose ─────── Every FS retrigger (additional scatters durin |
| `rewardChest` | ✅ | Wave W47.S16 — B74 · rewardChest block. End-of-round chest reveal presenter. |
| `romaniaComplianceGate` | ✅ | W60.J-RO (Wave F7 / HX6) — Romanian ONJN (Oficiul Naţional pentru Jocuri de Noroc) compliance gate. OUG 77/2009 + Regulament ONJN — emerging EU market with rapi |
| `rtlLayout` | ✅ | Wave A5 — Right-to-left (RTL) layout support. Industry pattern: slot UIs ship to MENA / Israel / Iran / Pakistan markets need bidirectional layout. |
| `scatterCelebration` | ✅ | Wave H03 — Scatter celebration block. @module scatterCelebration Purpose: Plays AFTER all reels have settled with a trigger-count of scatters, and BEFORE the FS |
| `sessionLevelMeter` | ✅ | Wave LEGO-PROG (DEF1 · 2/3) — Visible XP / level progress meter. @module sessionLevelMeter Purpose: HUD widget (top-left, below ante-bet dock) that mirrors `win |
| `sessionTimeout` | ✅ | Wave H3 — Session Timeout (continuous-play limit + forced break) block. Industry pattern (template-neutral, vendor-neutral): Regulator-mandated continuous-play  |
| `settingsPanel` | ✅ | Wave U13 — Settings Panel (gear-icon modal). Industry-standard pattern (every certified slot ships one): a gear / cog button on the hub opens a modal sa konsoli |
| `shareReplay` | ✅ | Wave LEGO-SOCIAL (B-5 · 2/2) — Anonymous share-replay link generator. @module shareReplay Purpose: On big-win events, surfaces a "SHARE" button that bundles the |
| `simultaneousFsHoldAndWinPriority` | ✅ | Wave D-17.7 (industry-reference lock_respin family gap closure) — Cross-feature trigger priority arbiter. When a single spin lands BOTH a free-spins scatter thr |
| `slamStop` | ✅ | Wave V1 — Slam-Stop button block. Industry-standard pattern (fast-stop / "slam" command): • A button (and optional whole-reels click area) that the player can p |
| `slingoSpinEngine` | ✅ | Wave J3 — Slingo board + strip animation. Industry-reference rationale ──────────────────────────── Slingo combines bingo + slot: 5×5 marked board + 1×5 strip t |
| `spainComplianceGate` | ✅ | W58.J-ES — Spanish DGOJ (Dirección General de Ordenación del Juego) compliance gate. Centralized opt-in block that enforces DGOJ's slot-mechanics obligations at |
| `spinControl` | ✅ | Wave V3 — Unified primary-action button (SPIN / STOP / SKIP). Perf budget: state morph ≤ 1ms; click handler ≤ 0.2ms; zero layout thrash (icon swap via data-stat |
| `spinHistoryReplay` | ✅ | Wave LEGO-REPLAY (B-2 · 1/2) — Spin history buffer + replay engine. @module spinHistoryReplay Purpose: Captures the last N spin outcomes (grid snapshot + win +  |
| `spinTempo` | ✅ | Slot GDD Factory · spinTempo BLOCK Reel-spin cadence config — drives the windup → accel → steady → decel → stagger → cushion-bounce timing of every uniform-reel |
| `splitSymbol` | ✅ | Wave H16 — Split Symbol (one symbol divides into 2 after landing). Industry baseline (vendor-neutral): Modern cascade and ways-engine games sometimes settle wit |
| `stageBadge` | ✅ | Slot GDD Factory · stageBadge BLOCK Performance budget: ≤1 active animation; backdrop-filter limited to header pill; runtime <0.5KB minified. Live indicator pil |
| `stickyMeter` | ✅ | Wave B70 — Sticky Symbol Counter HUD block. Industry baseline: many FS rounds expose a small counter that tracks how many sticky symbols (typically wilds) are c |
| `stickyWild` | ✅ | Wave L1 — Sticky Wild block. When GDD declares a `sticky_wild` feature, this block emits: • CSS halo + lock-icon overlay for sticky cells • Runtime registry of  |
| `stormMultiplierReel` | ✅ | Wave W56 (W49.T5.B gap closure) — Auxiliary multiplier reel block. A side-by-side strip reel that spins synchronously with the main grid and lands on a multipli |
| `streakBonus` | ✅ | Wave H25 — Streak Bonus (N consecutive wins trigger bonus). Industry baseline (vendor-neutral): Some slots reward consecutive winning spins with a bonus (free s |
| `superSymbol` | ✅ | Wave P3 — Super / Colossal / Mega Symbol block. 2×2 / 3×3 / 4×4 super-symbol blocks land on the grid as a single oversized tile. All N×N cells under it count as |
| `superSymbolUpgrade` | ✅ | Wave LEGO-SSU — Super Symbol Upgrade (tumble-tier promotion). Purpose ─────── Composite of two industry-standard primitives: • "super symbol" oversized cell tha |
| `superchargedFs` | ✅ | Wave H14 — Supercharged FS (free-spins retrigger multiplier escalation). Industry baseline (vendor-neutral): Many modern slots escalate a session-multiplier eac |
| `swedenComplianceGate` | ✅ | W60.J-SE (Wave F7 / HX2) — Sweden Spelinspektionen (SGA) compliance gate. Spel om pengar — Spellagen (SFS 2018:1138) + Spelinspektionens föreskrifter — Sweden's |
| `switzerlandComplianceGate` | ✅ | W60.J-CH (Wave F7 / HX5) — Swiss ESBK (Eidgenössische Spielbankenkommission) + Comlot compliance gate. Bundesgesetz über Geldspiele (BGS, SR 935.51) + Verordnun |
| `symbolInfoPopover` | ✅ | Slot GDD Factory · symbolInfoPopover BLOCK Wave V7 — tap / hover a grid cell → small popover with that symbol's tier + label + (placeholder) payout hint. Closes |
| `symbolModifiers` | ✅ | UQ-DEEP-AJ · P1B — SYMBOL MODIFIERS SCREEN LAYER. Unified screen-symbol modifier engine. |
| `symbolSplitReveal` | ✅ | Wave LEGO-SSR — Symbol Split Reveal (oversized block → N×N small wins). Purpose ─────── When an N×N oversized "super symbol" block lands on the reels (carrying  |
| `symbolStackCollapse` | ✅ | Wave W47.S18 — B75 · symbolStackCollapse block. Full-column "stack drop" celebration that fires when a tumble step clears an entire reel of the same symbol (or  |
| `symbolUpgrade` | ✅ | Wave B64 (Faza 3 · Pre-Math Roadmap) — Symbol Upgrade / Transmute block. ─── Purpose ────────────────────────────────────────────────────────── During a tumble  |
| `syncReels` | ✅ | Wave H19 — Sync Reels (2+ reels show identical symbol stack). Industry baseline (vendor-neutral): Feature in which a configured pair (or trio) of reels are forc |
| `themeCSS` | ✅ | Wave T-slim — extract of the slot-template "chrome" CSS that previously lived inline in `src/buildSlotHTML.mjs` (lines ~273-555, ≈280 LOC). What this block cove |
| `themePicker` | ✅ | Wave LEGO-THEME (B-8 · 1/3) — Player theme/skin picker. @module themePicker Purpose: Top-right gear-style picker that lets the player swap between configured vi |
| `totalMultiplierChip` | ✅ | Wave LEGO-M6 — Global accumulated-multiplier HUD chip. Purpose ─────── Universal HUD widget showing the CURRENT global multiplier — the product of every mult so |
| `triggerCounting` | ✅ | Slot GDD Factory · triggerCounting BLOCK Emits the two helpers that turn a settled grid into a "scatter count → spins awarded" answer. Decoupled from the reel e |
| `tumble` | ✅ | Wave K2 — Tumble (cascade / avalanche) runtime engine. When GDD declares `topology.cascade.enabled: true` (cluster-cascade / pay-anywhere / cluster-cascade refe |
| `tumbleGrowingFsMultiplier` | ✅ | Wave LEGO-M2 — Tumble-growing FS multiplier. Purpose ─────── For Free Spins rounds where the multiplier GROWS with each tumble / cascade step inside a SINGLE FS |
| `tumbleOnlyFs` | ✅ | Wave LEGO-FSV.3 — Tumble-only Free Spins (no fresh re-spin). Purpose ─────── FS variant where each "spin" is actually a tumble chain — no fresh reel spin, just  |
| `turboMode` | ✅ | Wave U11 — Turbo Mode block. Industry-standard pattern (every certified slot ships a turbo / quick- spin toggle): a hub button flips a global flag that compress |
| `uiToast` | ✅ | Wave U3 — Unified UI toast block. Centralised "celebration" overlay for win tiers and feature triggers. |
| `ukgcComplianceGate` | ✅ | W60.J-UK (Wave F7 / HX1) — UK Gambling Commission (UKGC) RTS compliance gate. Centralized opt-in block that enforces UKGC Remote Technical Standards (RTS) basel |
| `universalForcePanel` | ✅ | Wave U-FORCE-ALL.1 — Universal feature force panel (PRESENTATION MODE). Purpose ─────── When a regulator, sales-team member, or partner uploads ANY GDD into the |
| `volatilitySelector` | ✅ | Wave LEGO-VOLATILITY (B-6) — Pre-spin player volatility chooser. @module volatilitySelector Purpose: When GDD declares `volatility_selector`, this block paints  |
| `walkingWild` | ✅ | Wave L3 — Walking Wild block. Wild walks one position per spin (typical: leftward) and triggers a respin until it walks off the grid. |
| `walkingWildStepper` | ✅ | Wave LEGO-WWS — Walking Wild Stepper with progressive multiplier. Purpose ─────── Free Spins (or base, configurable) walking-wild variant where a SINGLE wild la |
| `waysEval` | ✅ | Wave M2 — Ways-to-Win evaluator block. Evaluates "ways" wins: from leftmost reel, count consecutive reels containing the same symbol; multiply by the count of t |
| `weightedWheelSegments` | ✅ | Wave H15 — Weighted Wheel Segments + Jackpot Tier Mapping extension. Industry pattern (template-neutral, vendor-neutral): Modern wheel-bonus mini-games use **no |
| `wheelBonus` | ✅ | Wave O2 — Wheel Bonus / Wheel of Fortune mini-game block. Overlay with a wheel of N segments. |
| `wheelBonusReveal` | ✅ | Wave W47.S18 — B72 · wheelBonusReveal block. Extension presenter that sits on top of the existing `wheelBonus.mjs` (mini-game) and `weightedWheelSegments.mjs` ( |
| `wheelSpinEngine` | ✅ | Wave J3 — Wheel / Radial spin engine. Industry-reference rationale ──────────────────────────── Wheel-of-fortune slot front-ends spin a single SVG group around  |
| `wildCollectionTrail` | ✅ | Wave H12 — Wild Collection Trail (persistent wild-counter meter). Industry baseline (vendor-neutral): Modern slot themes track wild landings across spins and re |
| `wildCollisionMultiplier` | ✅ | Wave LEGO-M3 — Wild × Wild collision multiplier. Purpose ─────── When 2+ wild symbols both contribute to the SAME winning line / way / cluster, this block multi |
| `wildReel` | ✅ | Wave L4 — Wild Reel block. A randomly-picked reel turns fully wild on selected spins. |
| `wildTriggerHoldAndWin` | ✅ | Wave LEGO-HW2.1 — Wild-symbol-triggered Hold & Win round. Purpose ─────── On base-game spins, when N or more WILD symbols land on the grid simultaneously, the b |
| `winBothWaysActivation` | ✅ | Wave LEGO-FS3.1 — FS-only "win both ways" activation. Purpose ─────── During FS rounds, the paywin direction expands from default LTR (left-to-right) to BOTH wa |
| `winCap` | ✅ | Wave N3 (base) + W51 (cross-jurisdiction enforcement) — Win Cap terminator. Regulator-mandated max-win enforcement. |
| `winLineFlash` | ✅ | Wave H21 — Win Line Flash (per-line directional flash on win). Industry baseline (vendor-neutral): When a line win lands, modern slots paint a brief left-to-rig |
| `winMultiplierBadge` | ✅ | Wave H20 — Win Multiplier Badge (per-line / per-win × N chip). Industry baseline (vendor-neutral): When a win line carries a multiplier (random per-line mult, p |
| `winPresentation` | ✅ | Slot GDD Factory · winPresentation BLOCK Orchestrates how winning combinations are PRESENTED to the player after reels settle — token cancellation, per-event cy |
| `winRollup` | ✅ | Slot GDD Factory · winRollup BLOCK Base-game total-win counter that ticks "TOTAL WIN: €X.XX" with a slot-machine digit-by-digit rollup whenever a regular win la |
| `winwaysIndicator` | ✅ | Wave B66 — Win-Ways Count Indicator block. Industry baseline: every "ways" game (243 / 1024 / 4096 / 7776 / 117 649 ways) displays a persistent label so the pla |
