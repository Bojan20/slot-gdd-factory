# Slot GDD Factory · block catalog (Wave W1)

> Auto-generated from `src/blocks/*.mjs` JSDoc contract headers.
> Regenerate with `node tools/_wave-w-build-block-catalog.mjs`.

**193 blocks indexed**

| Block | Purpose (one-line) | GDD keys | Emits | Subscribes | Feature kinds |
|:--|:--|:--|:--|:--|:--|
| `achievementToast` | When `playerXp.mjs` emits `onPlayerLevelUp` or when another block (or operator)  | — | onAchievementToastDismissed, onAchievementToastShown | — | achievement |
| `allWaysEval` | ─────── Universal "all-ways" win evaluator: counts a winning combination wheneve | — | onAllWaysCleared, onAllWaysPay | onSpinResult, preSpin, onFsEnd | respin, paytable |
| `ambientBackgroundWheel` | Wave H9 — Ambient Background Wheel (theme atmosphere visual). | — | onAmbientPhase | preSpin, postSpin, onFsTrigger | respin |
| `ambientBgVariants` | Listens to win/loss signals and switches the body background to a mood-appropria | — | onAmbientMoodChanged | onSpinResult, onFsTrigger, onFsEnd | — |
| `anteBet` | When GDD declares an `ante_bet` feature, this block emits an opt-in footer toggl | — | onAnteBetChanged | — | anteBet |
| `anteBetLadder` | When GDD declares `ante_bet_ladder` (or `ante_bet.tiers[]`), this block replaces | — | onAnteBetLadderChanged | onFsTrigger, onFsEnd | anteBet |
| `anticipation` | Slot GDD Factory · anticipation BLOCK | — | — | preSpin, onFsTrigger, onFsEnd | — |
| `audio` | Wave U2 — Audio scaffolding block. | — | — | preSpin, onSpinResult, onTumbleStep, postSpin … | tumble, respin |
| `autoplay` | Wave U4 — Autoplay session block. | — | onAutoplayDisclosureRequired, onAutoplayStart, onAutoplayStop, onMinSpinPaceDeferred … | onSpinResult, postSpin, onFsTrigger, onFsEnd | autoplay, lightning |
| `balanceHud` | Wave U8 — Balance HUD block. | — | onBalanceChanged | preSpin, postSpin, onFsTrigger, onFsEnd … | gamble, respin, autoplay |
| `betSelector` | Wave U5 — Bet Selector block. | — | onBetChanged | preSpin, postSpin, onAutoplayStart, onFsTrigger … | respin, autoplay, paytable |
| `bidirectionalWaysEval` | ─────── Industry-reference "win-both-ways" paytable evaluator. Walks the grid in | — | onBidirectionalWaysPay, onBidirectionalWaysCleared | onSpinResult, preSpin, onFsEnd | respin, paytable |
| `bigSymbolRender2x2` | Provides a vendor-neutral, math-blind, opt-in renderer that takes the configured | — | onBigSymbolUnmounted, onBigSymbolMounted | preSpin, onSpinResult, onFsSpinResult, onTumbleStep … | bigSymbolRender2x2, tumble, respin |
| `bigWinTier` | Wave H5 — Big-Win Tier Ladder block. | — | onBigWinTierEntered, onBigWinTierExited, onBigWinTierEnd | preSpin | bigWinTier, respin, cascade |
| `bonusBuy` | When GDD declares a `bonus_buy` feature, this block emits a "Buy Bonus" button i | — | onBonusBuyRequested | onFsTrigger, onFsEnd | bonusBuy |
| `bonusBuyDeterministic` | Wave H11 — Bonus Buy Deterministic Plant extension. | — | onBonusBuyTierSelected, onDeterministicPlantApplied | onSpinResult, postSpin, onFsTrigger, onFsEnd | bonusBuy |
| `bonusBuyMenu` | When GDD declares `bonus_buy_menu` (or `bonus_buy.tiers[]`), this block replaces | — | onBonusBuyMenuOpened, onBonusBuyMenuClosed, onBonusBuyMenuTierSelected | onFsTrigger, onFsEnd | bonusBuy |
| `bonusClimaxReveal` | Wave H6 — Bonus Climax Reveal (presenter for any bonus-entry event). | — | onBonusClimaxStart, onBonusClimaxEnd | onFsTrigger | respin, jackpot |
| `bonusOverlayMutex` | ─────── Coordinates the 3 parallel bonus overlays from Wave LEGO-B2 (matchThreeB | — | onBonusOverlayMutexAcquired, onBonusOverlayMutexReleased | — | — |
| `bonusPick` | tiles, reveal-on-click, terminator-token round end. | mode, tileCount, maxPicks, prizePool … | — | onFsTrigger, onFsEnd, postSpin | bonusPick, respin |
| `cascadeBooster` | Wave H15 — Cascade Booster (per-cascade-depth multiplier escalation). | — | onCascadeBoosterTick, onCascadeBoosterReset | preSpin, onTumbleStep, onFsEnd | cascade, tumble, respin |
| `cascadePathDraw` | Wave H24 — Cascade Path Draw (visual chain between cascade win cells). | — | onCascadePathCleared, onCascadePathDrawn | preSpin, onSpinResult, onTumbleStep | cascade, tumble, respin |
| `cascadingWildPersistence` | ─────── On cascade / tumble slots, a wild that landed on the grid stays PINNED f | — | onCascadingWildPinned | preSpin, onSpinResult, onTumbleStep, postSpin | tumble, respin, cascade |
| `cellLevelUpgrade` | Wave H7 — Cell Level Upgrade (per-cell numeric level meter + badge). | — | onCellLevelReset, onCellLevelUp | preSpin, onSpinResult, onTumbleStep, postSpin … | tumble, respin, cascade |
| `cellOverflowCounter` | Wave H8 — Cell Overflow Counter (per-reel stack-overflow badge). | — | onCellOverflow | preSpin, postSpin, onTumbleStep, onFsSpinResult | tumble, respin, cascade |
| `clusterPaysEval` | Wave M1 — Cluster Pays evaluator block. | minCluster, paytable, bucketEdges, bucketMultipliers … | onClusterPay | — | clusterPaysEval, paytable |
| `clusterSizeMultiplier` | ─────── On cluster-pays slots, the winning cluster gets a multiplier whose value | — | onClusterSizeMultiplierApplied | preSpin | respin |
| `coinCollect` | When GDD declares `coin_collect` (or `token_collect`), this block scans every `o | — | onCoinCollected | onSpinResult, onFsTrigger, onFsEnd | jackpot |
| `coinShower` | Wave W47.S13 — B68 · coinShower block. | — | onCoinShowerStart, onCoinShowerEnd | onFsTrigger, onTumbleStep, onSpinResult | tumble, cascade |
| `collectableSymbol` | Wave H19 — Collectable Symbol (industry-standard symbol-collector meter). | — | onSymbolCollected, onCollectionFull, onCollectionReset | postSpin, onTumbleStep, onFsSpinResult, preSpin … | tumble, respin, cascade |
| `collectRevealOverlay` | When `cumulativeMeter.mjs` emits `onCumulativeMeterThresholdHit`, this block pai | — | onCollectRevealOpened, onCollectRevealClaimed | onFsTrigger, onFsEnd | — |
| `colorblindPatterns` | Wave H4 — Color-blind pattern overlay (WCAG 2.2 SC 1.4.1 Use of Color · AAA). | — | onCbPatternsToggle | postSpin, onTumbleStep, onFsSpinResult | colorblind, tumble, cascade |
| `crashSpinEngine` | Wave J3 — Crash multiplier curve animation. | — | — | preSpin | respin |
| `creditAwardConversion` | Provides a vendor-neutral, math-blind helper API that exposes: • current coin_va | — | onAwardConverted, onCoinValueChanged | onBetChanged | creditAwardConversion |
| `cumulativeMeter` | Visible HUD widget (top-right corner default) that mirrors the `window.__COIN_CO | — | onCumulativeMeterThresholdHit, onCumulativeMeterReset | — | — |
| `dailyJackpot` | Slot GDD Factory · dailyJackpot BLOCK | — | onDailyJackpotAward | preSpin, postSpin, onFsTrigger, onFsEnd | respin, jackpot |
| `dualRoleScatter` | Wave H10 — Dual-Role Scatter (scatter that doubles as wild or pay). | — | onDualRoleActivated | postSpin, onTumbleStep, onFsTrigger | tumble, cascade, paytable |
| `dynamicWaysEngine` | ─────── Industry-reference "variable rows per reel" ways system. Each spin the e | — | onWaysReshaped, onWaysResetForRound | preSpin, onSpinResult, onFsTrigger, onFsEnd | respin |
| `energyMeter` | Wave B73 — Energy Meter side-feature gauge block. | — | onEnergyChange, onEnergyFull | preSpin, onSpinResult, onTumbleStep, onFsEnd | tumble, respin, cascade |
| `euAiActComplianceGate` | W58.J-EU — EU AI Act (Regulation 2024/1689) compliance gate. | — | onAiActDdaProhibited, onAiSystemDeclarationRequired | — | gamble |
| `expandingWild` | Wave L2 — Expanding Wild block. | mode, wildSymbolId, expandDurationMs, haloColor | — | onSpinResult, preSpin, onFsTrigger | expandingWild, respin |
| `expandingWildMultiplier` | ─────── When a wild lands on a reel, the wild EXPANDS to cover the entire reel A | — | onExpandingWildMultsCleared, onExpandingWildMultRolled | preSpin, onSpinResult, onFsSpinResult, onFsEnd | expandingWild, respin |
| `forceSkip` | Wave V2 — Force-Skip button block. | — | onSkipRequested | onSpinResult, onFsTrigger, onFsEnd, preSpin … | — |
| `franceComplianceGate` | W58.J-FR — French ANJ (Autorité nationale des jeux) compliance gate. | — | onAutoplayBanned, onTurboBanned, onMinSpinDurationEnforced, onFrjCheckRequired | — | autoplay |
| `freeSpins` | Slot GDD Factory · freeSpins BLOCK | — | onFsTrigger, onFsSpinResult, onFsRetrigger, onFsEnd … | postSpin, onFsTrigger | freeSpins |
| `fsExpansionWilds` | ─────── Free Spins feature where any wild landing in a reel during a FS spin EXP | — | onExpansionWildAdded, onExpansionWildsCleared | onFsTrigger, onFsSpinResult, onFsEnd, preSpin | respin |
| `fsPersistentJackpotPool` | ─────── FS round maintains a JACKPOT POOL (×bet units) that: • starts at a confi | — | onFsJackpotPoolBumped, onFsJackpotPoolPaidOut, onFsJackpotPoolEndRequested | onFsTrigger, onSpinResult, onFsSpinResult, onFsEnd | jackpot, cascade |
| `fsProgressBar` | Wave B69 — Free-Spins Progress Bar block. | — | — | onFsTrigger, onFsSpinResult, onFsEnd | — |
| `fsReelHeightEscalation` | ─────── Each FS retrigger BUMPS the visible row count of every reel by `rowsPerR | — | onFsReelHeightEscalated | onFsTrigger, onFsEnd | cascade |
| `fsSymbolUpgradeEscalation` | ─────── During the FS round, the LOWEST PAYING symbol still in active use gets U | — | onFsSymbolUpgraded | onFsTrigger, onFsSpinResult, onFsEnd | tumble, cascade |
| `gamble` | ladder variants with optional auto-collect cap. | mode, maxRounds, multiplier, collectThresholdX … | — | postSpin, onFsTrigger, onFsEnd | gamble, respin |
| `gambleSecondary` | Wave U6 — Secondary Gamble feature (Card branch + Ladder branch). | — | onGambleEnd, onGambleStart, onGambleRound | onSpinResult, postSpin, onAutoplayStart, onFsTrigger … | gamble, autoplay, paytable |
| `gddRealityCheck` | Closes the GDD-truth pipeline at runtime. Parser publishes a canonical declared- | — | onGddRealityReport | preSpin | gddRealityCheck |
| `genericFeatureBanner` | ─────── Catch-all listener for `onForceFeatureRequested` events whose `kind` has | — | — | postSpin | gamble, respin, lightning |
| `germanyComplianceGate` | W58.J-DE — GlüStV (Glücksspielstaatsvertrag 2021) compliance gate. | — | onMinSpinPaceEnforced, onGameStateCleared, onIndexedDbCleared | — | respin, autoplay |
| `grandInterruptionLock` | Provides a vendor-neutral, opt-in lock layer that enforces the GRAND celebration | — | onGrandLock, onHandpayRequested, onGrandReleased | — | grandInterruptionLock, autoplay, jackpot |
| `hapticFeedback` | Wave A10 — Haptic feedback gating (Web Vibration API). | — | — | onFsTrigger | autoplay |
| `hexClusterEngine` | ─────── Combines hex-axial grid topology (q,r coordinates) with cluster- pays ev | — | onHexClusterPay | onSpinResult, onTumbleStep, preSpin | tumble, respin, cascade, paytable |
| `hexReelEngine` | Wave J2b — Hex real reel engine. | — | — | preSpin | respin |
| `hiLoGamble` | Wave H16 — Hi/Lo Card Gamble (classic post-win risk presenter). | — | onHiLoStart, onHiLoCollected, onHiLoChoice, onHiLoResolved | preSpin, onFsTrigger, onFsEnd | gamble, respin |
| `historyLog` | Wave U9 — Session History Log block. | — | — | preSpin, onFsTrigger, postSpin, onFsEnd … | gamble |
| `holdAndWin` | Hold & Win / Hold & Spin block — industry-standard lock-and-respin pattern. | triggerCount, bonusSymbolId, respinsAwarded, resetOnNewBonus … | onHoldAndWinPhase, onHoldAndWinPayout, onHoldAndWinEnd | preSpin, postSpin, onSpinResult, onFsTrigger … | holdAndWin, tumble, respin, jackpot |
| `holdAndWinCreditBucket` | Wave H14 — Hold-and-Win Credit Bucket extension. | — | onCreditBucketLocked, onCreditBucketRespinStart, onCreditBucketEnd | postSpin, onSpinResult, onFsTrigger, onFsEnd | holdAndWin, respin, jackpot |
| `holdAndWinFrameMultiplier` | ─────── In some Hold & Win formats each locked bonus cell carries its OWN persis | — | onFrameMultiplierBumped, onFrameMultiplierFinal | preSpin | holdAndWin, respin |
| `holdAndWinLockedOrbMultiplier` | ─────── Alternative round-end semantics for Hold & Win where each locked orb car | — | onLockedOrbMultiplierRolled, onLockedOrbMultiplierFinal | preSpin | holdAndWin, respin |
| `holdAndWinReelExpansion` | ─────── Mid-round during an active H&W feature, the grid EXPANDS by an extra ree | — | onHoldAndWinReelExpanded | postSpin | holdAndWin, respin, jackpot |
| `holdAndWinRoomJackpotMultiplier` | ─────── For Hold & Win (Respin / Lock & Spin) rounds where the player progresses | — | onRoomPromoted, onRoomJackpotFinal | preSpin | holdAndWin, respin, jackpot |
| `hookBus` | Slot GDD Factory · hookBus BLOCK | — | onMultiplierChanged | — | tumble, respin, autoplay, lightning … |
| `hotReload` | Wave P8 — **Hot-Reload bez page refresh** (dev-mode feedback loop). | — | onGddChange, onHotReloadConnect, onHotReloadDisconnect | — | — |
| `i18n` | Wave HX3 + HX4 — Internationalization + currency formatting. | — | onLanguagePackApplied | — | — |
| `infiniteFsUntilLoss` | ─────── FS round runs INDEFINITELY as long as each spin produces a win. The firs | — | onInfiniteFsStreakBumped, onInfiniteFsModeEnded | onFsTrigger, onFsSpinResult, onFsEnd | tumble |
| `infinityReels` | Wave H18 — Infinity Reels (grid expands per cascade-win counter presenter). | — | onInfinityReelAdded, onInfinityChainMilestone, onInfinityReelsReset | preSpin, onTumbleStep, postSpin, onFsTrigger … | tumble, respin, cascade |
| `infinityReelsEngine` | ─────── Industry-reference "infinity reels grid expansion" pattern. When a tumbl | — | onInfinityEngineReset, onInfinityEngineExpanded, onInfinityEngineCommit | preSpin, onTumbleStep, onSpinResult, onFsTrigger … | tumble, respin, cascade |
| `insuranceBet` | Pre-spin toggle that lets the player add a small "insurance" wager (default +20% | — | onInsuranceBetChanged | onFsTrigger, onFsEnd | — |
| `italyComplianceGate` | W58.J-IT — Italian ADM (Agenzia delle Dogane e dei Monopoli, formerly | — | onAutoplayBanned, onTurboBanned, onMinSpinDurationEnforced, onMandatoryRealityCheckIntervalEnforced … | — | autoplay |
| `jackpotLadderRooms` | Wave H13 — Jackpot Ladder Rooms (4-tier room ladder presenter). | — | onJackpotRoomExit, onJackpotRoomEntered, onJackpotRoomWon, onJackpotRoomEnter … | preSpin | jackpot, respin |
| `jackpotPicker` | ─────── Industry-reference "jackpot pick reveal grid" feature. On a trigger even | — | onJackpotPickerTileRevealed, onJackpotPickerComplete, onJackpotPickerDismissed | preSpin | jackpot, respin |
| `jackpotRoomReveal` | ─────── When a Hold-and-Win style trigger event fires (e.g. collecting N+ orbs,  | — | onJackpotRoomDismissed, onJackpotRoomRevealed | preSpin | jackpot, respin |
| `jurisdictionGate` | W59.H1 — Centralized jurisdiction-precedence resolver + audit gate. | — | onJurisdictionResolved | — | autoplay |
| `leaderboardChip` | Small HUD chip showing the player's session rank vs the operator- provided cohor | — | onLeaderboardRankChanged, onLeaderboardOpened, onLeaderboardClosed | onSpinResult | — |
| `lightning` | Wave P1 — Lightning random-hit feature block. | mode, triggerChance, multipliers, haloColor … | — | preSpin, onSpinResult, onFsEnd | lightning |
| `linkedReels` | Provides a vendor-neutral, math-blind, opt-in mechanism to (a) visually fuse N c | — | onReelsLinked, onLinkUnits | onFsEnter, onFsEnd, onSpinResult, onFsSpinResult | linkedReels, respin |
| `lockedSymbolFs` | ─────── On FS_INTRO (before the first FS spin actually rolls), this block plants | — | onLockedSymbolFsSeeded | onFsTrigger, onFsEnd, preSpin, postSpin | respin |
| `matchThreeBonusReveal` | ─────── On bonus trigger, player is shown a 3×3 face-down grid. Each tap reveals | — | onMatchThreeBonusRevealed, onMatchThreeBonusEnded, onMatchThreeBonusEntered | onFsEnd | jackpot |
| `megaSymbol` | Wave H11 — Mega Symbol (oversized 2×2 / 3×3 symbol block). | — | onMegaSymbolCleared, onMegaSymbolPlaced, onMegaSymbolLanded | preSpin, postSpin, onFsEnd | respin, cascade |
| `megaWildCluster` | ─────── Industry-typical "colossal wild" / "oversized wild block" pattern: inste | — | onMegaWildClusterCleared, onMegaWildClusterLanded | preSpin, onSpinResult, onFsSpinResult, onFsEnd | respin |
| `moneyGrabGrid` | ─────── Player is shown an N×M grid of face-down cells. Each tap reveals a money | — | onMoneyGrabRevealed, onMoneyGrabEnded, onMoneyGrabEntered | onFsEnd | — |
| `motionOverlay` | Wave 3 (W48 spin-quality rollout) — Shared ::after / ::before motion- | — | — | — | paytable |
| `multiplierLadder` | Wave B67 — Persistent Multiplier Ladder UI block. | — | onMultLadderStep, onMultLadderReset | onFsTrigger, onFsSpinResult, onTumbleStep, onFsEnd … | tumble, cascade |
| `multiplierOrb` | Wave K3 — Multiplier Orb runtime. | — | — | onSpinResult, onTumbleStep, onFsTrigger, onFsEnd … | multiplierOrb, tumble, respin, cascade |
| `mysteryPrizeBox` | When GDD declares `mystery_prize_box`, this block randomly drops a "treasure che | — | onMysteryPrizeBoxAppeared, onMysteryPrizeBoxOpened, onMysteryPrizeBoxDismissed | postSpin, onFsTrigger, onFsEnd | — |
| `mysteryReveal` | Wave W47.S19 — B65 · mysteryReveal block. | — | onMysteryRevealStart, onMysteryRevealEnd | onSpinResult | — |
| `mysterySymbol` | Wave L5 — Mystery Symbol block. | mode, mysterySymbolId, revealDelayMs, revealDurationMs … | — | preSpin, onSpinResult, onFsEnd | mysterySymbol |
| `mysterySymbolMultiplier` | ─────── Distinct from `mysterySymbol.mjs` (which reveals a random PAY symbol) an | — | onMysteryMultiplierRevealed | onSpinResult, onTumbleStep, preSpin | mysterySymbol, multiplierOrb, tumble, respin … |
| `mysteryWildReveal` | ─────── Mystery "?" symbol on the grid is revealed not as a pay symbol but as th | — | onMysteryWildRevealed | onSpinResult, onTumbleStep, preSpin | tumble, respin, cascade |
| `nearMissTease` | Wave H22 — Near-Miss Tease (visual "almost won" highlight). | — | onNearMissCleared, onNearMissTease | preSpin, onSpinResult, onFsTrigger, onFsEnd | respin |
| `netherlandsComplianceGate` | W58.J-NL — NL KSA (Wet kansspelen op afstand) compliance gate. | — | onCruksCheckRequired, onCoolOffEnforced, onCoolOffPeriodActive, onCoolOffPeriodExpired … | — | — |
| `netLossIndicator` | Wave H12 — Net Win/Loss Indicator extension. | — | onNetThresholdCrossed | onAutoplayStart, onFsTrigger, onFsEnd | respin, autoplay, jackpot |
| `nudgeReel` | Wave H17 — Nudge Reel (classic fruit-machine near-miss rescue presenter). | — | onNudgeOffered, onNudgeAccepted, onNudgeResolved, onNudgeDeclined | postSpin, preSpin, onFsTrigger, onFsEnd | respin |
| `paletteRoulette` | On page load, randomly picks one of N configured color palettes (weighted) and a | — | onPaletteRolled | — | — |
| `pathAwareMultiplier` | Wave H13 — Path-Aware Multiplier extension (extends `waysEval`). | — | onPathMultiplierAssigned, onPathMultiplierAggregate | preSpin, postSpin, onFsTrigger, onFsEnd | pathAwareMultiplier, waysEval, respin, lightning |
| `pathBonusEngine` | ─────── Bonus round in board-game style: linear path of N tiles, player rolls "d | — | onPathBonusRolled, onPathBonusEnded, onPathBonusEntered | onFsEnd | — |
| `patternWin` | Provides a vendor-neutral, math-blind, opt-in detector for a single board patter | — | onPatternWinTrigger, onPatternWinPaid | onSpinResult, onFsSpinResult, postSpin, onFsEnd | patternWin |
| `payAnywhereEval` | Wave K1 — Pay-anywhere (scatter pays) win evaluator. | — | — | — | payAnywhereEval, paytable |
| `paylineDimmer` | Wave H27 — Payline Dimmer (dim non-winning cells during win presentation). | — | onPaylineDimmerCleared, onPaylineDimmerStart | preSpin, onSpinResult, onTumbleStep, onFsTrigger … | respin |
| `paylineOverlay` | Slot GDD Factory · paylineOverlay BLOCK | — | — | — | — |
| `paylines` | Slot GDD Factory · paylines BLOCK | — | — | — | paylines |
| `paytable` | Industry-standard pattern (every certified slot ships one): an "i" / "?" button  | — | — | onBetChanged, preSpin, onFsTrigger, onAutoplayStart | paytable, gamble, respin, autoplay |
| `perFsSpinMultiplier` | ─────── For Free Spins rounds where EACH individual FS spin carries its own inde | — | onPerFsSpinMultiplierRolled | onFsSpinResult, onFsEnd | — |
| `persistentMultiplier` | carries state inside a round and resets on round boundary per config. | mode, startMult, growPerWin, growPerCascade … | onMultChange | preSpin, onFsSpinResult, onTumbleStep, onFsTrigger … | persistentMultiplier, tumble, respin, cascade |
| `perTriggerVolatilitySet` | Provides a vendor-neutral, engine-driven, opt-in classifier wrapper for the "vol | — | onVolatilitySetLocked, onVolatilitySetExpired | onFsEnd | perTriggerVolatilitySet |
| `pickBonusReveal` | Wave W47.S16 — B71 · pickBonusReveal block. | — | onPickRevealStart, onPickRevealEnd | onFsTrigger | — |
| `pickYourFs` | ─────── On FS trigger, present the player with N (typically 3) selectable FS var | — | onFsModePicked | onFsTrigger, onFsEnd | — |
| `playerXp` | Awards XP per spin (proportional to bet units) and per coin collected (from coin | — | onPlayerXpGained, onPlayerLevelUp | onSpinResult, onFsTrigger, onFsEnd | — |
| `plinkoSpinEngine` | Wave J3 — Plinko ball-drop animation. | — | — | preSpin | respin |
| `postSpin` | Slot GDD Factory · postSpin BLOCK | — | postSpin | preSpin, postSpin | — |
| `potSymbolFireball` | Provides a vendor-neutral, math-blind, opt-in classifier that (a) tags pot symbo | — | onPotSymbolLanded, onPotSymbolCollected | onSpinResult, onFsSpinResult | potSymbolFireball, holdAndWin, respin |
| `prizeBoostBet` | Pre-spin toggle that lets the player add a cost premium (default +50% bet) in ex | — | onPrizeBoostChanged | onFsTrigger, onFsEnd | — |
| `progressiveFreeSpins` | Wave U1 — Progressive Free-Spins multiplier block. | — | — | onFsTrigger, onFsSpinResult, onFsEnd | tumble |
| `progressiveFsRetriggerLadder` | ─────── During a Free Spins round, every retrigger JUMPS the player to the NEXT  | — | onLadderRungPromoted, onLadderReset | onFsTrigger, onFsSpinResult, onFsEnd, preSpin | respin |
| `pwaInstallability` | Wave A8 — Progressive Web App installability. | — | onPwaSwReady, onPwaInstallable, onPwaInstalled | — | — |
| `pyramidGridEngine` | ─────── Renders + animates a PYRAMID grid where each subsequent reel has ONE MOR | — | onPyramidSpinResult | preSpin | respin |
| `randomLightningMultiplier` | ─────── | — | onLightningStrikeMissed, onLightningStrike | preSpin, onSpinResult, onFsTrigger, onFsEnd | randomLightningMultiplier, respin, lightning |
| `randomWildBurst` | When GDD declares `random_wild_burst`, this block randomly "bursts" N cells into | — | onRandomWildBurstFired | onSpinResult, onFsTrigger, onFsEnd | tumble, lightning |
| `realityCheck` | Wave H2 — Reality Check player-protection modal block. | — | onRealityCheckShown, onRealityCheckDismissed, onRealityCheckPaused, onRealityCheckResumed … | preSpin | respin, autoplay |
| `reelEngine` | Slot GDD Factory · reelEngine BLOCK (hot-path) | — | onSpinResult, onSlamComplete, onCruksCheckPending, onManualSpinPaceBlocked … | preSpin | — |
| `reelEngineCSS` | Slot GDD Factory · reelEngineCSS BLOCK | — | — | — | — |
| `reelHeightAdapter` | ─────── Provides ATOMIC grow + shrink of reel column height at runtime. Consumes | — | onReelHeightGrown, onReelHeightShrunk | onFsEnd | — |
| `reelLockHold` | showing a visual "LOCKED" badge with a per-tick countdown. | — | onReelLockStart, onReelLockEnd, onReelLockTick, onReelLockCleared | postSpin, onFsTrigger, onFsEnd | respin |
| `regulatorDisclosureModal` | Wave W60 — Universal regulator disclosure modal. | — | onRegulatorDisclosureShown, onRegulatorDisclosureAcknowledged | — | autoplay |
| `replayControlBar` | Bottom-center floating control bar with REPLAY · ⏮ · ⏯ · ⏭ · STOP buttons that d | — | onReplayControlInvoked | onSpinResult, onFsTrigger, onFsEnd | — |
| `respin` | perf budget: O(reels*rows) DOM walk, ≤0.3ms @ 5×3 | mode, triggerChance, costX, holdRule … | — | postSpin, onFsTrigger, onFsEnd | respin, gamble |
| `respinCharge` | respin once full; presenter + HookBus emitter, math is engine-side. | — | onRespinChargeBump, onRespinChargeFull, onRespinChargeReset, onRespinChargeTick | onSpinResult, onTumbleStep, onFsEnd | respin, tumble |
| `retriggerEscalator` | Wave H30 — Retrigger Escalator (multi-tier FS retrigger reward ladder). | — | onRetriggerEscalated, onRetriggerEscalatorReset | onFsTrigger, onFsEnd | — |
| `retriggerMeter` | Wave H20 — Retrigger Meter (FS retrigger visual progress meter). | — | onRetriggerMeterReset, onRetriggerMeterTick, onRetriggerMeterCommit | onFsTrigger, onFsSpinResult, onFsEnd | — |
| `retriggerMultiplierBump` | ─────── Every FS retrigger (additional scatters during FS) BUMPS the round- leve | — | onRetriggerMultiplierBumped | onFsTrigger, onFsEnd | — |
| `rewardChest` | Wave W47.S16 — B74 · rewardChest block. | kinds | onRewardChestOpen, onRewardChestClose | onFsEnd, onSpinResult | — |
| `rtlLayout` | Wave A5 — Right-to-left (RTL) layout support. | — | onDirChanged | — | jackpot |
| `scatterCelebration` | Plays AFTER all reels have settled with a trigger-count of scatters, and BEFORE  | — | onScatterCelebrationStart, onScatterCelebrationEnd, onSkipComplete | onFsTrigger | scatterCelebration |
| `sessionLevelMeter` | HUD widget (top-left, below ante-bet dock) that mirrors `window.__PLAYER_XP__`.  | — | — | — | — |
| `sessionTimeout` | Wave H3 — Session Timeout (continuous-play limit + forced break) block. | — | onSessionWarningShown, onSessionTimeoutFired, onSessionResumed, onSessionExtended … | preSpin | respin, autoplay |
| `settingsPanel` | Wave U13 — Settings Panel (gear-icon modal). | — | onVolatilityChanged, onBetStepPresetChanged, onMaxWinCapToggled, onLocaleChanged | preSpin, onFsTrigger, onAutoplayStart | respin, autoplay |
| `shareReplay` | On big-win events, surfaces a "SHARE" button that bundles the captured spin fram | — | onShareReplayInvoked | onFsTrigger, onFsEnd | — |
| `simultaneousFsHoldAndWinPriority` | Provides a vendor-neutral, math-blind, opt-in arbiter that enforces the Foundry- | — | onFeaturePriorityDeferred, onFeaturePriorityResumed | onFsEnter | simultaneousFsHoldAndWinPriority |
| `slamStop` | Wave V1 — Slam-Stop button block. | — | onSlamRequested, onSkipRequested | preSpin, onSpinResult, postSpin, onFsTrigger … | respin |
| `slingoSpinEngine` | Wave J3 — Slingo board + strip animation. | — | — | preSpin | respin |
| `spainComplianceGate` | W58.J-ES — Spanish DGOJ (Dirección General de Ordenación del Juego) | — | onAutoplayBanned, onMinSpinDurationEnforced, onMandatoryRealityCheckIntervalEnforced, onRgiajCheckRequired | — | autoplay |
| `spinControl` | Wave V3 — Unified primary-action button (SPIN / STOP / SKIP). | — | — | preSpin, onSpinResult, postSpin, onFsTrigger … | respin |
| `spinHistoryReplay` | Captures the last N spin outcomes (grid snapshot + win + timestamp) into a ring  | — | onSpinReplayStart, onSpinReplayEnd, onSpinReplayPaused | onSpinResult, onFsTrigger, onFsEnd | — |
| `spinTempo` | Slot GDD Factory · spinTempo BLOCK | — | — | — | — |
| `splitSymbol` | Wave H16 — Split Symbol (one symbol divides into 2 after landing). | — | onSplitSymbolPlaced, onSplitSymbolCleared | preSpin, onSpinResult, onTumbleStep, onFsSpinResult | cascade |
| `stageBadge` | Slot GDD Factory · stageBadge BLOCK | — | — | onFsTrigger | — |
| `stickyMeter` | Wave B70 — Sticky Symbol Counter HUD block. | — | onStickyCountChange | onFsTrigger, preSpin, postSpin, onSpinResult … | tumble, respin, cascade |
| `stickyWild` | Wave L1 — Sticky Wild block. | mode, durationSpins, wildSymbolId, haloColor | — | onSpinResult, postSpin, onFsTrigger, onFsEnd … | stickyWild |
| `stormMultiplierReel` | Provides a vendor-neutral side multiplier reel that composes additively with lin | — | onStormMultiplierStart, onStormMultiplierStop | preSpin, onSpinResult, postSpin, onSlamStop | storm, respin, lightning, paylines |
| `streakBonus` | Wave H25 — Streak Bonus (N consecutive wins trigger bonus). | — | onStreakBump, onStreakBonusEarned, onStreakReset | onSpinResult, onFsEnd | tumble, respin, jackpot |
| `superchargedFs` | Wave H14 — Supercharged FS (free-spins retrigger multiplier escalation). | — | onFsMultiplierEscalated, onFsSuperchargeReset, onFsRetrigger | onFsTrigger, onFsEnd | — |
| `superSymbol` | of the same symbol for paytable evaluation; presenter + math hook. | mode, blockSize, triggerChance, symbolPool … | onSuperSymbolLand | preSpin, onSpinResult, onFsEnd | superSymbol, respin, paytable |
| `superSymbolUpgrade` | ─────── Composite of two industry-standard primitives: • "super symbol" oversize | — | onSuperSymbolUpgradeReset, onSuperSymbolUpgraded | preSpin, onTumbleStep, onSpinResult, onFsTrigger … | superSymbol, tumble, respin, cascade |
| `symbolInfoPopover` | Slot GDD Factory · symbolInfoPopover BLOCK | — | — | preSpin, onFsTrigger, onFsEnd | respin, paytable |
| `symbolSplitReveal` | ─────── When an N×N oversized "super symbol" block lands on the reels (carrying  | — | onSymbolSplitCleared, onSymbolSplitStarted, onSymbolSplitRevealed | preSpin, onSpinResult, onFsSpinResult, onFsEnd | respin |
| `symbolStackCollapse` | Wave W47.S18 — B75 · symbolStackCollapse block. | — | onStackCollapseStart, onStackCollapseEnd | onTumbleStep | tumble, cascade |
| `symbolUpgrade` | Wave B64 (Faza 3 · Pre-Math Roadmap) — Symbol Upgrade / Transmute block. | — | onSymbolUpgrade, onSymbolUpgradeCascade | preSpin, onTumbleStep, postSpin, onFsEnd | tumble, respin, cascade |
| `syncReels` | Wave H19 — Sync Reels (2+ reels show identical symbol stack). | — | onSyncReelsCleared, onReelsSynced | preSpin, onSpinResult, onTumbleStep, onFsSpinResult | — |
| `themeCSS` | Wave T-slim — extract of the slot-template "chrome" CSS that previously | — | — | — | — |
| `themePicker` | Top-right gear-style picker that lets the player swap between configured visual  | — | onThemeChanged, onThemePickerOpened, onThemePickerClosed | preSpin | — |
| `totalMultiplierChip` | ─────── Universal HUD widget showing the CURRENT global multiplier — the product | — | — | preSpin, onFsEnd | respin |
| `triggerCounting` | Slot GDD Factory · triggerCounting BLOCK | — | — | onSpinResult, preSpin | — |
| `tumble` | Wave K2 — Tumble (cascade / avalanche) runtime engine. | — | onTumbleStep | preSpin, onFsEnd | tumble, cascade |
| `tumbleGrowingFsMultiplier` | ─────── For Free Spins rounds where the multiplier GROWS with each tumble / casc | — | onTumbleMultiplierReset, onTumbleMultiplierGrown | onFsSpinResult, onTumbleStep, onFsEnd, preSpin | tumble, respin, cascade |
| `tumbleOnlyFs` | ─────── FS variant where each "spin" is actually a tumble chain — no fresh reel  | — | onTumbleOnlyFsChainEnded, onTumbleOnlyFsModeEntered | onFsTrigger, onTumbleStep, onFsEnd | tumble, cascade |
| `turboMode` | Wave U11 — Turbo Mode block. | — | onTurboToggle | preSpin | respin, autoplay |
| `uiToast` | Wave U3 — Unified UI toast block. | — | — | postSpin, onFsTrigger, onFsEnd, preSpin | respin, lightning |
| `universalForcePanel` | ─────── When a regulator, sales-team member, or partner uploads ANY GDD into the | — | onForceFeatureRequested, onForceMultiplier | — | gamble, respin, lightning, cascade |
| `volatilitySelector` | When GDD declares `volatility_selector`, this block paints a 3-5 tier choice sur | — | onVolatilityChanged | onFsTrigger, onFsEnd | — |
| `walkingWild` | position per spin in the configured direction and triggers a respin until the wi | mode, wildSymbolId, direction, triggerRespin … | requestRespin | onSpinResult, preSpin, onFsTrigger, onFsEnd | walkingWild, respin |
| `walkingWildStepper` | ─────── Free Spins (or base, configurable) walking-wild variant where a SINGLE w | — | onWalkingWildSpawned, onWalkingWildExited, onWalkingWildStep | onFsTrigger, onFsSpinResult, onFsEnd, preSpin … | walkingWild, respin |
| `waysEval` | Wave M2 — Ways-to-Win evaluator block. | waysCount, minRun, direction, maxEvents … | — | — | waysEval |
| `weightedWheelSegments` | Wave H15 — Weighted Wheel Segments + Jackpot Tier Mapping extension. | — | onWheelSegmentChosen, onWheelJackpotHit, onWheelAwardCollected | onFsTrigger, onFsEnd | jackpot |
| `wheelBonus` | Wave O2 — Wheel Bonus / Wheel of Fortune mini-game block. | segments, spinDurationMs, haloColor, autoSpin … | onWheelModalOpened, onWheelSettled, onWheelCollect, onWheelBonusReady | onFsTrigger, onFsEnd, postSpin | wheelBonus |
| `wheelBonusReveal` | Wave W47.S18 — B72 · wheelBonusReveal block. | — | onWheelRevealStart, onWheelRevealEnd | — | wheelBonus, jackpot |
| `wheelSpinEngine` | Wave J3 — Wheel / Radial spin engine. | — | — | preSpin | respin |
| `wildCollectionTrail` | Wave H12 — Wild Collection Trail (persistent wild-counter meter). | — | onWildTrailBump, onWildCollectionReward, onWildTrailReset | onSpinResult, onTumbleStep, onFsEnd | tumble, respin, cascade |
| `wildCollisionMultiplier` | ─────── When 2+ wild symbols both contribute to the SAME winning line / way / cl | — | onWildCollision | onSpinResult, onTumbleStep, preSpin | wildCollisionMultiplier, tumble, respin, cascade |
| `wildReel` | Wave L4 — Wild Reel block. | mode, wildSymbolId, chancePerSpin, maxReelsPerSpin … | symbolOverride | preSpin, onSpinResult, onFsEnd | wildReel |
| `wildTriggerHoldAndWin` | ─────── On base-game spins, when N or more WILD symbols land on the grid simulta | — | onWildTriggerHoldAndWinRequested | preSpin, onSpinResult, onTumbleStep | tumble, respin, cascade |
| `winBothWaysActivation` | ─────── During FS rounds, the paywin direction expands from default LTR (left-to | — | onWinBothWaysActivated, onWinBothWaysDeactivated | onFsTrigger, onFsEnd | tumble, paylines |
| `winCap` | Wave N3 (base) + W51 (cross-jurisdiction enforcement) — Win Cap terminator. | maxWinX, mode, jurisdiction, overlayLabel … | onWinCapClamped, onRtpDisclosureRequired, onWinCapTriggered | postSpin, preSpin, onFsTrigger, onFsEnd | winCap |
| `winLineFlash` | Wave H21 — Win Line Flash (per-line directional flash on win). | — | onWinLineFlashCleared, onWinLineFlashStart, onWinLineFlashEnd | preSpin, onSpinResult, onTumbleStep | respin |
| `winMultiplierBadge` | Wave H20 — Win Multiplier Badge (per-line / per-win × N chip). | — | onWinMultBadgeCleared, onWinMultBadgePlaced | preSpin, onSpinResult, onFsEnd | respin |
| `winPresentation` | Slot GDD Factory · winPresentation BLOCK | — | onWinPresentationStart, onWinPresentationEnd, onLdwSuppressed, onSkipComplete | onSpinResult, preSpin | — |
| `winRollup` | Slot GDD Factory · winRollup BLOCK | — | — | preSpin, onFsTrigger, onFsEnd | respin |
| `winwaysIndicator` | Wave B66 — Win-Ways Count Indicator block. | — | — | onSpinResult, preSpin | — |