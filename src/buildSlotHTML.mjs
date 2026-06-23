/**
 * Slot GDD Factory · build standalone playable slot HTML — BASE GAME ONLY.
 *
 * Static grid render. No animations, no spin/bet/autoplay controls,
 * no HUD, no footer. Grid is centered in the viewport with reference-grade
 * dimensions (frame inset, gap, cell radius, shadows, palette) extracted
 * from an industry reference base game.
 *
 * Dimensions reference (vendor-neutral):
 *   • Frame:        min(1200px, 82vw) × min(732px, 82vw·0.61)  — 1.64:1
 *   • Frame inset:  18px from frame edge to first cell
 *   • Cell gap:     6px between cells
 *   • Cell radius:  10px
 *   • Frame radius: 16px
 *   • Shadow:       0 20px 60px rgba(0,0,0,.5), inset 0 0 80px rgba(0,0,0,.3)
 *
 * Palette tokens (from theme.palette[] override these if present):
 *   --bg0  #05070c   deep blue-black
 *   --bg1  #0b0f16   mid background
 *   --gold #c9a227   primary accent
 *   --text #f2f2f2   default text
 *
 * Same module is consumed by app.js (browser tab) and tests (Node + Playwright).
 */
import { buildGridShape } from './gridShape.mjs';
import { paylineConfig } from './blocks/paylines.mjs';

/* ─── UQ-FORTIFY9 #1 · XSS-safe JSON encoding for inline <script> ──────
 * JSON.stringify može da emituje string koji sadrži `</script>`,
 * `<!--` ili `<script`. Browser HTML parser bi prekinuo script tag i
 * izvršio sve što sledi → XSS preko GDD prose-a (model.name,
 * features.label, symbol.name).
 *
 * Fix: zameni `<` `>` `&` sa JS escape sequencama. Validan JSON za
 * runtime parser, ali browser HTML parser ne vidi `<`. */
export function safeJSONInScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
import {
  emitPaylineOverlayCSS,
  emitPaylineOverlayRuntime,
  resolveConfig as resolvePaylineOverlayConfig,
} from './blocks/paylineOverlay.mjs';
// Wave T-slim — chrome + grid-shape CSS extracted from inline orchestrator
import {
  emitThemeCSS, emitGridShapesCSS, emitDevToolsCSS,
  resolveConfig as resolveThemeCSSConfig,
} from './blocks/themeCSS.mjs';
/* HookBus — the lifecycle bus that wires every feature block to the spin
   engine. Emitted FIRST so every other runtime block can register on it. */
import {
  emitHookBusRuntime,
  resolveConfig as resolveHookBusConfig,
} from './blocks/hookBus.mjs';
import {
  emitWinPresentationCSS,
  emitWinPresentationRuntime,
  emitDetectWinCombosRuntime,
  resolveConfig as resolveWinPresentationConfig,
} from './blocks/winPresentation.mjs';
import {
  emitScatterCelebrationCSS,
  emitScatterCelebrationRuntime,
} from './blocks/scatterCelebration.mjs';
import {
  emitStageBadgeCSS,
  emitStageBadgeMarkup,
  emitStageBadgeRuntime,
  resolveConfig as resolveStageBadgeConfig,
} from './blocks/stageBadge.mjs';
import {
  emitFsProgressBarCSS,
  emitFsProgressBarMarkup,
  emitFsProgressBarRuntime,
  resolveConfig as resolveFsProgressBarConfig,
} from './blocks/fsProgressBar.mjs';
import {
  emitWinwaysIndicatorCSS,
  emitWinwaysIndicatorMarkup,
  emitWinwaysIndicatorRuntime,
  resolveConfig as resolveWinwaysIndicatorConfig,
} from './blocks/winwaysIndicator.mjs';
import {
  emitMultiplierLadderCSS,
  emitMultiplierLadderMarkup,
  emitMultiplierLadderRuntime,
  resolveConfig as resolveMultiplierLadderConfig,
} from './blocks/multiplierLadder.mjs';
import {
  emitStickyMeterCSS,
  emitStickyMeterMarkup,
  emitStickyMeterRuntime,
  resolveConfig as resolveStickyMeterConfig,
} from './blocks/stickyMeter.mjs';
import {
  emitEnergyMeterCSS,
  emitEnergyMeterMarkup,
  emitEnergyMeterRuntime,
  resolveConfig as resolveEnergyMeterConfig,
} from './blocks/energyMeter.mjs';
import {
  emitPickBonusRevealCSS,
  emitPickBonusRevealMarkup,
  emitPickBonusRevealRuntime,
  resolveConfig as resolvePickBonusRevealConfig,
} from './blocks/pickBonusReveal.mjs';
import {
  emitCoinShowerCSS,
  emitCoinShowerMarkup,
  emitCoinShowerRuntime,
  resolveConfig as resolveCoinShowerConfig,
} from './blocks/coinShower.mjs';
import {
  emitRewardChestCSS,
  emitRewardChestMarkup,
  emitRewardChestRuntime,
  resolveConfig as resolveRewardChestConfig,
} from './blocks/rewardChest.mjs';
import {
  emitSymbolStackCollapseCSS,
  emitSymbolStackCollapseMarkup,
  emitSymbolStackCollapseRuntime,
  resolveConfig as resolveSymbolStackCollapseConfig,
} from './blocks/symbolStackCollapse.mjs';
import {
  emitWheelBonusRevealCSS,
  emitWheelBonusRevealMarkup,
  emitWheelBonusRevealRuntime,
  resolveConfig as resolveWheelBonusRevealConfig,
} from './blocks/wheelBonusReveal.mjs';
import {
  emitMysteryRevealCSS,
  emitMysteryRevealMarkup,
  emitMysteryRevealRuntime,
  resolveConfig as resolveMysteryRevealConfig,
} from './blocks/mysteryReveal.mjs';
import {
  emitAnticipationCSS,
  emitAnticipationRuntime,
  resolveConfig as resolveAnticipationConfig,
} from './blocks/anticipation.mjs';
import {
  emitSpinTempoRuntime,
  resolveConfig as resolveSpinTempoConfig,
  projectSpinProfile,
  projectSpinTempoIntoEngines,
} from './blocks/spinTempo.mjs';
import {
  emitFreeSpinsCSS,
  emitFreeSpinsHudMarkup,
  emitFreeSpinsToastMarkup,
  emitFreeSpinsOverlayMarkup,
  emitFreeSpinsRuntime,
  resolveConfig as resolveFreeSpinsConfig,
} from './blocks/freeSpins.mjs';
import {
  emitReelEngineCSS,
  resolveConfig as resolveReelEngineConfig,
} from './blocks/reelEngineCSS.mjs';
import {
  emitTriggerCountingRuntime,
  resolveConfig as resolveTriggerCountingConfig,
} from './blocks/triggerCounting.mjs';
import {
  emitPostSpinRuntime,
  resolveConfig as resolvePostSpinConfig,
} from './blocks/postSpin.mjs';
import {
  emitReelEngineRuntime,
  resolveConfig as resolveReelEngineHotConfig,
} from './blocks/reelEngine.mjs';
/* Wave K — Pay-Anywhere suite (scatter-pays / tumble-cascade family) */
import {
  emitPayAnywhereEvalRuntime,
  resolveConfig as resolvePayAnywhereEvalConfig,
} from './blocks/payAnywhereEval.mjs';
import {
  emitTumbleCSS,
  emitTumbleRuntime,
  resolveConfig as resolveTumbleConfig,
} from './blocks/tumble.mjs';
import {
  emitMultiplierOrbCSS,
  emitMultiplierOrbRuntime,
  resolveConfig as resolveMultiplierOrbConfig,
} from './blocks/multiplierOrb.mjs';
import {
  emitBonusBuyCSS,
  emitBonusBuyMarkup,
  emitBonusBuyRuntime,
  resolveConfig as resolveBonusBuyConfig,
} from './blocks/bonusBuy.mjs';
// Wave H11 — Bonus Buy Deterministic Plant extension (pure observer)
import {
  emitBonusBuyDeterministicCSS,
  emitBonusBuyDeterministicMarkup,
  emitBonusBuyDeterministicRuntime,
  resolveConfig as resolveBonusBuyDeterministicConfig,
} from './blocks/bonusBuyDeterministic.mjs';
import {
  emitAnteBetCSS,
  emitAnteBetMarkup,
  emitAnteBetRuntime,
  resolveConfig as resolveAnteBetConfig,
} from './blocks/anteBet.mjs';
/* Wave LEGO-BUY (4/8) — multi-tier upgrades. Mutex with bonusBuy / anteBet:
 * when the menu / ladder resolves enabled, the single-button block self-
 * suppresses (orchestrator wires only the multi-tier emit). */
import {
  emitBonusBuyMenuCSS,
  emitBonusBuyMenuMarkup,
  emitBonusBuyMenuRuntime,
  resolveConfig as resolveBonusBuyMenuConfig,
} from './blocks/bonusBuyMenu.mjs';
import {
  emitAnteBetLadderCSS,
  emitAnteBetLadderMarkup,
  emitAnteBetLadderRuntime,
  resolveConfig as resolveAnteBetLadderConfig,
} from './blocks/anteBetLadder.mjs';
/* Wave LEGO-RANDOM (B-3) — in-spin random pattern blocks. */
import {
  emitMysteryPrizeBoxCSS,
  emitMysteryPrizeBoxMarkup,
  emitMysteryPrizeBoxRuntime,
  resolveConfig as resolveMysteryPrizeBoxConfig,
} from './blocks/mysteryPrizeBox.mjs';
import {
  emitRandomWildBurstCSS,
  emitRandomWildBurstMarkup,
  emitRandomWildBurstRuntime,
  resolveConfig as resolveRandomWildBurstConfig,
} from './blocks/randomWildBurst.mjs';
/* Wave LEGO-COLLECT (B-4) — coin-collect meta-game trio. */
import {
  emitCoinCollectCSS,
  emitCoinCollectMarkup,
  emitCoinCollectRuntime,
  resolveConfig as resolveCoinCollectConfig,
} from './blocks/coinCollect.mjs';
import {
  emitCumulativeMeterCSS,
  emitCumulativeMeterMarkup,
  emitCumulativeMeterRuntime,
  resolveConfig as resolveCumulativeMeterConfig,
} from './blocks/cumulativeMeter.mjs';
import {
  emitCollectRevealOverlayCSS,
  emitCollectRevealOverlayMarkup,
  emitCollectRevealOverlayRuntime,
  resolveConfig as resolveCollectRevealOverlayConfig,
} from './blocks/collectRevealOverlay.mjs';
/* Wave LEGO-VOLATILITY (B-6) — pre-spin player choice selector. */
import {
  emitVolatilitySelectorCSS,
  emitVolatilitySelectorMarkup,
  emitVolatilitySelectorRuntime,
  resolveConfig as resolveVolatilitySelectorConfig,
} from './blocks/volatilitySelector.mjs';
/* Wave LEGO-REPLAY (B-2) — spin history + control bar. */
import {
  emitSpinHistoryReplayCSS,
  emitSpinHistoryReplayMarkup,
  emitSpinHistoryReplayRuntime,
  resolveConfig as resolveSpinHistoryReplayConfig,
} from './blocks/spinHistoryReplay.mjs';
import {
  emitReplayControlBarCSS,
  emitReplayControlBarMarkup,
  emitReplayControlBarRuntime,
  resolveConfig as resolveReplayControlBarConfig,
} from './blocks/replayControlBar.mjs';
/* Wave LEGO-SOCIAL (B-5) — leaderboard chip + share replay. */
import {
  emitLeaderboardChipCSS,
  emitLeaderboardChipMarkup,
  emitLeaderboardChipRuntime,
  resolveConfig as resolveLeaderboardChipConfig,
} from './blocks/leaderboardChip.mjs';
import {
  emitShareReplayCSS,
  emitShareReplayMarkup,
  emitShareReplayRuntime,
  resolveConfig as resolveShareReplayConfig,
} from './blocks/shareReplay.mjs';
/* Wave LEGO-SIDEBET (B-7) — insurance + prize boost. */
import {
  emitInsuranceBetCSS,
  emitInsuranceBetMarkup,
  emitInsuranceBetRuntime,
  resolveConfig as resolveInsuranceBetConfig,
} from './blocks/insuranceBet.mjs';
import {
  emitPrizeBoostBetCSS,
  emitPrizeBoostBetMarkup,
  emitPrizeBoostBetRuntime,
  resolveConfig as resolvePrizeBoostBetConfig,
} from './blocks/prizeBoostBet.mjs';
/* Wave LEGO-THEME (B-8) — themePicker + paletteRoulette + ambientBg. */
import {
  emitThemePickerCSS,
  emitThemePickerMarkup,
  emitThemePickerRuntime,
  resolveConfig as resolveThemePickerConfig,
} from './blocks/themePicker.mjs';
import {
  emitPaletteRouletteCSS,
  emitPaletteRouletteMarkup,
  emitPaletteRouletteRuntime,
  resolveConfig as resolvePaletteRouletteConfig,
} from './blocks/paletteRoulette.mjs';
import {
  emitAmbientBgVariantsCSS,
  emitAmbientBgVariantsMarkup,
  emitAmbientBgVariantsRuntime,
  resolveConfig as resolveAmbientBgVariantsConfig,
} from './blocks/ambientBgVariants.mjs';
/* Wave LEGO-PROG (DEF1) — playerXp + sessionLevelMeter + achievementToast. */
import {
  emitPlayerXpCSS,
  emitPlayerXpMarkup,
  emitPlayerXpRuntime,
  resolveConfig as resolvePlayerXpConfig,
} from './blocks/playerXp.mjs';
import {
  emitSessionLevelMeterCSS,
  emitSessionLevelMeterMarkup,
  emitSessionLevelMeterRuntime,
  resolveConfig as resolveSessionLevelMeterConfig,
} from './blocks/sessionLevelMeter.mjs';
import {
  emitAchievementToastCSS,
  emitAchievementToastMarkup,
  emitAchievementToastRuntime,
  resolveConfig as resolveAchievementToastConfig,
} from './blocks/achievementToast.mjs';
/* Wave L–P — 16 detected-but-unused feature kinds, now wired as LEGO blocks */
import {
  emitStickyWildCSS, emitStickyWildRuntime,
  resolveConfig as resolveStickyWildConfig,
} from './blocks/stickyWild.mjs';
import {
  emitExpandingWildCSS, emitExpandingWildRuntime,
  resolveConfig as resolveExpandingWildConfig,
} from './blocks/expandingWild.mjs';
import {
  emitGddRuntimeMeta,
  resolveConfig as resolveGddRuntimeMetaConfig,
} from './blocks/gddRuntimeMeta.mjs';
import {
  emitWalkingWildCSS, emitWalkingWildRuntime,
  resolveConfig as resolveWalkingWildConfig,
} from './blocks/walkingWild.mjs';
import {
  emitWildReelCSS, emitWildReelRuntime,
  resolveConfig as resolveWildReelConfig,
} from './blocks/wildReel.mjs';
import {
  emitMysterySymbolCSS, emitMysterySymbolRuntime,
  resolveConfig as resolveMysterySymbolConfig,
} from './blocks/mysterySymbol.mjs';
import {
  emitClusterPaysEvalRuntime,
  resolveConfig as resolveClusterPaysEvalConfig,
} from './blocks/clusterPaysEval.mjs';
import {
  emitWaysEvalRuntime,
  resolveConfig as resolveWaysEvalConfig,
} from './blocks/waysEval.mjs';
/* Wave LEGO-EV (06-19) — All-ways + bidirectional evaluators. */
import {
  emitAllWaysEvalCSS, emitAllWaysEvalMarkup, emitAllWaysEvalRuntime,
  resolveConfig as resolveAllWaysEvalConfig,
} from './blocks/allWaysEval.mjs';
import {
  emitBidirectionalWaysEvalCSS, emitBidirectionalWaysEvalMarkup, emitBidirectionalWaysEvalRuntime,
  resolveConfig as resolveBidirectionalWaysEvalConfig,
} from './blocks/bidirectionalWaysEval.mjs';
// Wave H13 — Path-Aware Multiplier extension (pure observer; decorates
// ways events with per-path multiplier chip + aggregate bonus award).
import {
  emitPathAwareMultiplierCSS,
  emitPathAwareMultiplierMarkup,
  emitPathAwareMultiplierRuntime,
  resolveConfig as resolvePathAwareMultiplierConfig,
} from './blocks/pathAwareMultiplier.mjs';
import {
  emitPersistentMultiplierCSS, emitPersistentMultiplierMarkup, emitPersistentMultiplierRuntime,
  resolveConfig as resolvePersistentMultiplierConfig,
} from './blocks/persistentMultiplier.mjs';
/* Wave LEGO-M (06-18) — 6 new market multiplier variants. Each block is a
 * self-contained LEGO atom — boot is no-op unless GDD enables it. */
import {
  emitPerFsSpinMultiplierCSS, emitPerFsSpinMultiplierMarkup, emitPerFsSpinMultiplierRuntime,
  resolveConfig as resolvePerFsSpinMultiplierConfig,
} from './blocks/perFsSpinMultiplier.mjs';
import {
  emitMysterySymbolMultiplierCSS, emitMysterySymbolMultiplierRuntime,
  resolveConfig as resolveMysterySymbolMultiplierConfig,
} from './blocks/mysterySymbolMultiplier.mjs';
import {
  emitWildCollisionMultiplierCSS, emitWildCollisionMultiplierRuntime,
  resolveConfig as resolveWildCollisionMultiplierConfig,
} from './blocks/wildCollisionMultiplier.mjs';
import {
  emitRetriggerMultiplierBumpCSS, emitRetriggerMultiplierBumpMarkup, emitRetriggerMultiplierBumpRuntime,
  resolveConfig as resolveRetriggerMultiplierBumpConfig,
} from './blocks/retriggerMultiplierBump.mjs';
import {
  emitClusterSizeMultiplierCSS, emitClusterSizeMultiplierRuntime,
  resolveConfig as resolveClusterSizeMultiplierConfig,
} from './blocks/clusterSizeMultiplier.mjs';
import {
  emitTotalMultiplierChipCSS, emitTotalMultiplierChipMarkup, emitTotalMultiplierChipRuntime,
  resolveConfig as resolveTotalMultiplierChipConfig,
} from './blocks/totalMultiplierChip.mjs';
/* Wave LEGO-H/FS/W (06-18) — 8 new GDD-driven variants for H&W, FS, wild families. */
import {
  emitHoldAndWinFrameMultiplierCSS, emitHoldAndWinFrameMultiplierMarkup, emitHoldAndWinFrameMultiplierRuntime,
  resolveConfig as resolveHoldAndWinFrameMultiplierConfig,
} from './blocks/holdAndWinFrameMultiplier.mjs';
import {
  emitHoldAndWinLockedOrbMultiplierCSS, emitHoldAndWinLockedOrbMultiplierMarkup, emitHoldAndWinLockedOrbMultiplierRuntime,
  resolveConfig as resolveHoldAndWinLockedOrbMultiplierConfig,
} from './blocks/holdAndWinLockedOrbMultiplier.mjs';
import {
  emitHoldAndWinRoomJackpotMultiplierCSS, emitHoldAndWinRoomJackpotMultiplierMarkup, emitHoldAndWinRoomJackpotMultiplierRuntime,
  resolveConfig as resolveHoldAndWinRoomJackpotMultiplierConfig,
} from './blocks/holdAndWinRoomJackpotMultiplier.mjs';
import {
  emitTumbleGrowingFsMultiplierCSS, emitTumbleGrowingFsMultiplierMarkup, emitTumbleGrowingFsMultiplierRuntime,
  resolveConfig as resolveTumbleGrowingFsMultiplierConfig,
} from './blocks/tumbleGrowingFsMultiplier.mjs';
import {
  emitFsExpansionWildsCSS, emitFsExpansionWildsMarkup, emitFsExpansionWildsRuntime,
  resolveConfig as resolveFsExpansionWildsConfig,
} from './blocks/fsExpansionWilds.mjs';
import {
  emitProgressiveFsRetriggerLadderCSS, emitProgressiveFsRetriggerLadderMarkup, emitProgressiveFsRetriggerLadderRuntime,
  resolveConfig as resolveProgressiveFsRetriggerLadderConfig,
} from './blocks/progressiveFsRetriggerLadder.mjs';
import {
  emitExpandingWildMultiplierCSS, emitExpandingWildMultiplierMarkup, emitExpandingWildMultiplierRuntime,
  resolveConfig as resolveExpandingWildMultiplierConfig,
} from './blocks/expandingWildMultiplier.mjs';
import {
  emitMegaWildClusterCSS, emitMegaWildClusterMarkup, emitMegaWildClusterRuntime,
  resolveConfig as resolveMegaWildClusterConfig,
} from './blocks/megaWildCluster.mjs';
/* Wave LEGO-L (06-18) — Random spin-wide "lightning" multiplier (WoO + CF demand). */
import {
  emitRandomLightningMultiplierCSS, emitRandomLightningMultiplierMarkup, emitRandomLightningMultiplierRuntime,
  resolveConfig as resolveRandomLightningMultiplierConfig,
} from './blocks/randomLightningMultiplier.mjs';
/* Wave LEGO-WW (06-18) — Walking wild stepper with progressive ×N mult. */
import {
  emitWalkingWildStepperCSS, emitWalkingWildStepperMarkup, emitWalkingWildStepperRuntime,
  resolveConfig as resolveWalkingWildStepperConfig,
} from './blocks/walkingWildStepper.mjs';
/* Wave LEGO-WAYS (06-18) — Variable rows per reel dynamic ways engine. */
import {
  emitDynamicWaysEngineCSS, emitDynamicWaysEngineMarkup, emitDynamicWaysEngineRuntime,
  resolveConfig as resolveDynamicWaysEngineConfig,
} from './blocks/dynamicWaysEngine.mjs';
/* Wave LEGO-INF (06-18) — Infinity reels engine (grid grows per win + ×N bump). */
import {
  emitInfinityReelsEngineCSS, emitInfinityReelsEngineMarkup, emitInfinityReelsEngineRuntime,
  resolveConfig as resolveInfinityReelsEngineConfig,
} from './blocks/infinityReelsEngine.mjs';
/* Wave LEGO-SS (06-18) — Super symbol family: split reveal + tier upgrade. */
import {
  emitSymbolSplitRevealCSS, emitSymbolSplitRevealMarkup, emitSymbolSplitRevealRuntime,
  resolveConfig as resolveSymbolSplitRevealConfig,
} from './blocks/symbolSplitReveal.mjs';
import {
  emitSuperSymbolUpgradeCSS, emitSuperSymbolUpgradeMarkup, emitSuperSymbolUpgradeRuntime,
  resolveConfig as resolveSuperSymbolUpgradeConfig,
} from './blocks/superSymbolUpgrade.mjs';
/* Wave LEGO-JR (06-18) — Jackpot room family: full-screen room reveal + pick grid. */
import {
  emitJackpotRoomRevealCSS, emitJackpotRoomRevealMarkup, emitJackpotRoomRevealRuntime,
  resolveConfig as resolveJackpotRoomRevealConfig,
} from './blocks/jackpotRoomReveal.mjs';
import {
  emitJackpotPickerCSS, emitJackpotPickerMarkup, emitJackpotPickerRuntime,
  resolveConfig as resolveJackpotPickerConfig,
} from './blocks/jackpotPicker.mjs';
import {
  emitProgressiveFreeSpinsCSS, emitProgressiveFreeSpinsMarkup, emitProgressiveFreeSpinsRuntime,
  resolveConfig as resolveProgressiveFreeSpinsConfig,
} from './blocks/progressiveFreeSpins.mjs';
// Wave U2 audio block held in repo (`src/blocks/audio.mjs`) ali NE učitavamo —
// audio je ADB tok, ne GDD. Hard rule #1 u CLAUDE.md. Import + 3 emit poziva
// uklonjeni 2026-06-04; blok fajl + parser extractor ostaju za potencijalnu
// re-aktivaciju, ali ne emituju ništa u trenutni template.
import {
  emitUiToastCSS, emitUiToastMarkup, emitUiToastRuntime,
  resolveConfig as resolveUiToastConfig,
} from './blocks/uiToast.mjs';
// Wave H5 — Big-Win Tier ladder (vendor-neutral 5-tier celebration ladder
// driven by totalAward/bet, with GDD-driven labels/thresholds/durations).
import {
  emitBigWinTierCSS, emitBigWinTierMarkup, emitBigWinTierRuntime,
  resolveConfig as resolveBigWinTierConfig,
} from './blocks/bigWinTier.mjs';
// Wave V1 — Slam-stop button (industry-standard fast-stop command pattern)
import {
  emitSlamStopCSS, emitSlamStopMarkup, emitSlamStopRuntime,
  resolveConfig as resolveSlamStopConfig,
} from './blocks/slamStop.mjs';
// Wave V2 — Force-skip button (industry-standard rollup/intro skip command pattern)
import {
  emitForceSkipCSS, emitForceSkipMarkup, emitForceSkipRuntime,
  resolveConfig as resolveForceSkipConfig,
} from './blocks/forceSkip.mjs';
// Wave U-FORCE-ALL — Universal feature force panel + generic banner fallback.
// Detects every parsed feature kind and paints a chip rail of FORCE buttons,
// each one driving a real spin with `__FORCE_FEATURE__` set so dedicated
// blocks (FS, BW, BB, …) or the generic banner respond. Presentation-time
// QA surface for partners/regulators uploading arbitrary GDDs.
import {
  emitUniversalForcePanelCSS, emitUniversalForcePanelMarkup, emitUniversalForcePanelRuntime,
  resolveConfig as resolveUniversalForcePanelConfig,
} from './blocks/universalForcePanel.mjs';
import {
  emitGenericFeatureBannerCSS, emitGenericFeatureBannerMarkup, emitGenericFeatureBannerRuntime,
  resolveConfig as resolveGenericFeatureBannerConfig,
} from './blocks/genericFeatureBanner.mjs';
// Wave V3 — Unified primary action button (SPIN / STOP / SKIP single contextual CTA).
// When enabled (default), supersedes the V1+V2 buttons — slamStop/forceSkip
// markup/CSS/runtime are gated off and spinControl emits their intent events
// directly on HookBus. Industry-reference PlayCore pattern.
import {
  emitSpinControlCSS, emitSpinControlMarkup, emitSpinControlRuntime,
  resolveConfig as resolveSpinControlConfig,
} from './blocks/spinControl.mjs';
// Wave U4 — Autoplay session (industry-standard auto-spin panel pattern)
import {
  emitAutoplayCSS, emitAutoplayMarkup, emitAutoplayRuntime,
  resolveConfig as resolveAutoplayConfig,
} from './blocks/autoplay.mjs';
// Wave U5 — Bet Selector (industry-standard coin × multiplier bet model)
import {
  emitBetSelectorCSS, emitBetSelectorMarkup, emitBetSelectorRuntime,
  resolveConfig as resolveBetSelectorConfig,
} from './blocks/betSelector.mjs';
// Wave U6 — Secondary Gamble (Card + Ladder branches, post-win risk feature)
import {
  emitGambleSecondaryCSS, emitGambleSecondaryMarkup, emitGambleSecondaryRuntime,
  resolveConfig as resolveGambleSecondaryConfig,
} from './blocks/gambleSecondary.mjs';
// Wave U8 — Balance HUD (industry-standard regulator-mandated wallet widget)
import {
  emitBalanceHudCSS, emitBalanceHudMarkup, emitBalanceHudRuntime,
  resolveConfig as resolveBalanceHudConfig,
} from './blocks/balanceHud.mjs';
// Wave H12 — Net Win/Loss Indicator extension (regulator-mandated player-protection chip)
import {
  emitNetLossIndicatorCSS,
  emitNetLossIndicatorMarkup,
  emitNetLossIndicatorRuntime,
  resolveConfig as resolveNetLossIndicatorConfig,
} from './blocks/netLossIndicator.mjs';
// Wave H2 — Reality Check player-protection modal (UKGC LCCP 8.3)
import {
  emitRealityCheckCSS,
  emitRealityCheckMarkup,
  emitRealityCheckRuntime,
  resolveConfig as resolveRealityCheckConfig,
} from './blocks/realityCheck.mjs';
// Wave W60 — Universal regulator disclosure modal (closes the modal DOM
// gap left by W58.J-{UKGC,AGCO,SE,DE,NL,EU,FR,IT,ES} which only emit
// *Required events; this block listens to all of them and renders one
// accessible queue-aware modal).
import {
  emitRegulatorDisclosureModalCSS,
  emitRegulatorDisclosureModalMarkup,
  emitRegulatorDisclosureModalRuntime,
  resolveConfig as resolveRegulatorDisclosureModalConfig,
} from './blocks/regulatorDisclosureModal.mjs';
// Wave H3 — Session Timeout (continuous-play cap + forced break)
// UKGC LCCP 8.3.1 / AGCO Standard 4.07 / MGA RGF Part III
import {
  emitSessionTimeoutCSS,
  emitSessionTimeoutMarkup,
  emitSessionTimeoutRuntime,
  resolveConfig as resolveSessionTimeoutConfig,
} from './blocks/sessionTimeout.mjs';
// Wave H5.8 — base-game total-win rollup counter (sits above the hub,
// hidden until a sub-big-win lands, persists until the next preSpin).
// Industry reference: statusBarController.rollupWin pattern.
import {
  emitWinRollupCSS, emitWinRollupMarkup, emitWinRollupRuntime,
  resolveConfig as resolveWinRollupConfig,
} from './blocks/winRollup.mjs';
// Wave U9 — Session history log (regulator-mandated audit trail)
import {
  emitHistoryLogCSS, emitHistoryLogMarkup, emitHistoryLogRuntime,
  resolveConfig as resolveHistoryLogConfig,
} from './blocks/historyLog.mjs';
// Wave U11 — Turbo mode (industry-standard 4th spin-cadence option)
import {
  emitTurboModeCSS, emitTurboModeMarkup, emitTurboModeRuntime,
  resolveConfig as resolveTurboModeConfig,
} from './blocks/turboMode.mjs';
// Wave U13 — Settings panel (gear modal sa konsolidovanim toggle-ovima)
import {
  emitSettingsPanelCSS, emitSettingsPanelMarkup, emitSettingsPanelRuntime,
  resolveConfig as resolveSettingsPanelConfig,
} from './blocks/settingsPanel.mjs';
// Wave A10 — Haptic feedback gate (Web Vibration API, opt-in)
import {
  emitHapticFeedbackRuntime,
  resolveConfig as resolveHapticFeedbackConfig,
} from './blocks/hapticFeedback.mjs';
// Wave A5 — RTL layout (bidirectional support, numeric isolation)
import {
  emitRtlLayoutCSS, emitRtlLayoutRuntime,
  resolveConfig as resolveRtlLayoutConfig,
} from './blocks/rtlLayout.mjs';
// Wave H4 — Colour-blind pattern overlay (WCAG 2.2 SC 1.4.1)
import {
  emitColorblindPatternsCSS, emitColorblindPatternsMarkup, emitColorblindPatternsRuntime,
  resolveConfig as resolveColorblindPatternsConfig,
} from './blocks/colorblindPatterns.mjs';
// Wave H6 — Bonus Climax Reveal (universal placard for bonus-entry events)
import {
  emitBonusClimaxRevealCSS, emitBonusClimaxRevealMarkup, emitBonusClimaxRevealRuntime,
  resolveConfig as resolveBonusClimaxRevealConfig,
} from './blocks/bonusClimaxReveal.mjs';
// Wave H7 — Cell Level Upgrade (per-cell numeric meter + badge)
import {
  emitCellLevelUpgradeCSS, emitCellLevelUpgradeMarkup, emitCellLevelUpgradeRuntime,
  resolveConfig as resolveCellLevelUpgradeConfig,
} from './blocks/cellLevelUpgrade.mjs';
// Wave H8 — Cell Overflow Counter (per-reel stack overflow badge)
import {
  emitCellOverflowCounterCSS, emitCellOverflowCounterMarkup, emitCellOverflowCounterRuntime,
  resolveConfig as resolveCellOverflowCounterConfig,
} from './blocks/cellOverflowCounter.mjs';
// Wave H9 — Ambient Background Wheel (theme atmosphere visual)
import {
  emitAmbientBackgroundWheelCSS, emitAmbientBackgroundWheelMarkup, emitAmbientBackgroundWheelRuntime,
  resolveConfig as resolveAmbientBackgroundWheelConfig,
} from './blocks/ambientBackgroundWheel.mjs';
// Wave H10 — Dual-Role Scatter (scatter-as-wild / scatter-as-pay observer)
import {
  emitDualRoleScatterCSS, emitDualRoleScatterMarkup, emitDualRoleScatterRuntime,
  resolveConfig as resolveDualRoleScatterConfig,
} from './blocks/dualRoleScatter.mjs';
// Wave H11 — Mega Symbol (oversized 2×2/3×3 block presenter)
import {
  emitMegaSymbolCSS, emitMegaSymbolMarkup, emitMegaSymbolRuntime,
  resolveConfig as resolveMegaSymbolConfig,
} from './blocks/megaSymbol.mjs';
// Wave H12 — Wild Collection Trail (persistent wild-counter meter)
import {
  emitWildCollectionTrailCSS, emitWildCollectionTrailMarkup, emitWildCollectionTrailRuntime,
  resolveConfig as resolveWildCollectionTrailConfig,
} from './blocks/wildCollectionTrail.mjs';
// Wave H13 — Jackpot Ladder Rooms (4-tier room ladder presenter)
import {
  emitJackpotLadderRoomsCSS, emitJackpotLadderRoomsMarkup, emitJackpotLadderRoomsRuntime,
  resolveConfig as resolveJackpotLadderRoomsConfig,
} from './blocks/jackpotLadderRooms.mjs';
// Wave H14 — Supercharged FS (retrigger multiplier escalation)
import {
  emitSuperchargedFsCSS, emitSuperchargedFsMarkup, emitSuperchargedFsRuntime,
  resolveConfig as resolveSuperchargedFsConfig,
} from './blocks/superchargedFs.mjs';
// Wave H15 — Cascade Booster (per-cascade-depth multiplier escalation)
import {
  emitCascadeBoosterCSS, emitCascadeBoosterMarkup, emitCascadeBoosterRuntime,
  resolveConfig as resolveCascadeBoosterConfig,
} from './blocks/cascadeBooster.mjs';
// Wave H16-H20 — Industry standard feature blocks (Wave 3)
import {
  emitSplitSymbolCSS, emitSplitSymbolMarkup, emitSplitSymbolRuntime,
  resolveConfig as resolveSplitSymbolConfig,
} from './blocks/splitSymbol.mjs';
import {
  emitNudgeReelCSS, emitNudgeReelMarkup, emitNudgeReelRuntime,
  resolveConfig as resolveNudgeReelConfig,
} from './blocks/nudgeReel.mjs';
import {
  emitRespinChargeCSS, emitRespinChargeMarkup, emitRespinChargeRuntime,
  resolveConfig as resolveRespinChargeConfig,
} from './blocks/respinCharge.mjs';
import {
  emitSyncReelsCSS, emitSyncReelsMarkup, emitSyncReelsRuntime,
  resolveConfig as resolveSyncReelsConfig,
} from './blocks/syncReels.mjs';
import {
  emitWinMultiplierBadgeCSS, emitWinMultiplierBadgeMarkup, emitWinMultiplierBadgeRuntime,
  resolveConfig as resolveWinMultiplierBadgeConfig,
} from './blocks/winMultiplierBadge.mjs';
// Wave H21-H25 — Industry standard feature blocks (Wave 4)
import {
  emitWinLineFlashCSS, emitWinLineFlashMarkup, emitWinLineFlashRuntime,
  resolveConfig as resolveWinLineFlashConfig,
} from './blocks/winLineFlash.mjs';
import {
  emitNearMissTeaseCSS, emitNearMissTeaseMarkup, emitNearMissTeaseRuntime,
  resolveConfig as resolveNearMissTeaseConfig,
} from './blocks/nearMissTease.mjs';
import {
  emitReelLockHoldCSS, emitReelLockHoldMarkup, emitReelLockHoldRuntime,
  resolveConfig as resolveReelLockHoldConfig,
} from './blocks/reelLockHold.mjs';
import {
  emitCascadePathDrawCSS, emitCascadePathDrawMarkup, emitCascadePathDrawRuntime,
  resolveConfig as resolveCascadePathDrawConfig,
} from './blocks/cascadePathDraw.mjs';
import {
  emitStreakBonusCSS, emitStreakBonusMarkup, emitStreakBonusRuntime,
  resolveConfig as resolveStreakBonusConfig,
} from './blocks/streakBonus.mjs';
// Wave H27 + H30 — Payline Dimmer + Retrigger Escalator
import {
  emitPaylineDimmerCSS, emitPaylineDimmerMarkup, emitPaylineDimmerRuntime,
  resolveConfig as resolvePaylineDimmerConfig,
} from './blocks/paylineDimmer.mjs';
import {
  emitRetriggerEscalatorCSS, emitRetriggerEscalatorMarkup, emitRetriggerEscalatorRuntime,
  resolveConfig as resolveRetriggerEscalatorConfig,
} from './blocks/retriggerEscalator.mjs';
import {
  emitRetriggerMeterCSS, emitRetriggerMeterMarkup, emitRetriggerMeterRuntime,
  resolveConfig as resolveRetriggerMeterConfig,
} from './blocks/retriggerMeter.mjs';
// Wave A8 — PWA installability (manifest + SW + a2hs prompt)
import {
  emitPwaInstallabilityMarkup, emitPwaInstallabilityRuntime,
  resolveConfig as resolvePwaInstallabilityConfig,
} from './blocks/pwaInstallability.mjs';
// Wave HX3 + HX4 — i18n (10 language packs) + currency formatter
import {
  emitI18nRuntime,
  resolveConfig as resolveI18nConfig,
} from './blocks/i18n.mjs';
// Wave U10 — Paytable modal (industry-standard regulator-mandated info pane)
import {
  emitPaytableCSS, emitPaytableMarkup, emitPaytableRuntime,
  resolveConfig as resolvePaytableConfig,
} from './blocks/paytable.mjs';
// Wave V7 — Tap-cell mini paytable popover (single-symbol inspector)
import {
  emitSymbolInfoPopoverCSS, emitSymbolInfoPopoverMarkup, emitSymbolInfoPopoverRuntime,
  resolveConfig as resolveSymbolInfoPopoverConfig,
} from './blocks/symbolInfoPopover.mjs';
// Wave B64 — Symbol upgrade / transmute on tumble refill (cascade level-up)
import {
  emitSymbolUpgradeCSS, emitSymbolUpgradeMarkup, emitSymbolUpgradeRuntime,
  resolveConfig as resolveSymbolUpgradeConfig,
} from './blocks/symbolUpgrade.mjs';
// W56 — Auxiliary multiplier reel (vendor-neutral aux_reel_multiplier).
// Closes W49.T5.B GDD corpus RE gap. Opt-in per GDD via
// model.stormMultiplierReel.enabled. Math-blind: receives target value
// externally from spinResult.stormMultiplierTarget.
import {
  emitStormMultiplierReelCSS, emitStormMultiplierReelRuntime,
  resolveConfig as resolveStormMultiplierReelConfig,
} from './blocks/stormMultiplierReel.mjs';
// D-17.1 — Pattern-Win detector (Foundry-family gap closure). Detects
// anchor-stack on a configured reel + winning-Wild presence on N other
// reels and signals a flat pattern multiplier on total bet. Opt-in per
// GDD via model.patternWin.enabled. Math-blind: emits canonical events
// and reconciles via setMultMax when GDD asks for replace-not-stack.
import {
  emitPatternWinCSS, emitPatternWinRuntime,
  resolveConfig as resolvePatternWinConfig,
} from './blocks/patternWin.mjs';
// D-17.2 — Big-Symbol render (2x2 / 3-high / fullReel) with UNIT-count
// gate (Foundry-family gap closure). Opt-in per GDD via
// model.bigSymbolRender2x2.enabled. Tags top-left cell as canonical
// UNIT so trigger thresholds counted per-unit work on small grids.
import {
  emitBigSymbolRender2x2CSS, emitBigSymbolRender2x2Runtime,
  resolveConfig as resolveBigSymbolRender2x2Config,
} from './blocks/bigSymbolRender2x2.mjs';
// D-17.3 — Linked-reels block (Foundry-family gap closure). Marks N
// consecutive reels as a single linked block; target landings repeat
// across the block emitting discrete unit anchors. FS-gated by default.
import {
  emitLinkedReelsCSS, emitLinkedReelsRuntime,
  resolveConfig as resolveLinkedReelsConfig,
} from './blocks/linkedReels.mjs';
// D-17.4 — Per-trigger volatility set (Foundry-family gap closure).
// Consumes engine-drawn tier label at hold-and-win trigger, locks it
// for the feature duration, exposes via body[data-volatility-tier] hook.
// Math-blind by contract; engine owns the weighted draw.
import {
  emitPerTriggerVolatilitySetCSS, emitPerTriggerVolatilitySetRuntime,
  resolveConfig as resolvePerTriggerVolatilitySetConfig,
} from './blocks/perTriggerVolatilitySet.mjs';
// D-17.5 — Pot-tier Fireball symbol (Foundry-family gap closure).
// Classifies MINI/MINOR/MAJOR pots as value-carrying cells; tags them
// on the grid, emits landed/collected events, tracks COLLECT-time sum.
// Math-blind; engine decides pot landings.
import {
  emitPotSymbolFireballCSS, emitPotSymbolFireballRuntime,
  resolveConfig as resolvePotSymbolFireballConfig,
} from './blocks/potSymbolFireball.mjs';
// D-17.6 — GRAND interruption-lock + handpay route. Detects award
// >= cfg.grandThresholdCredits at COLLECT, locks controls + runs the
// celebration to completion, emits handpay events on configured
// jurisdictions. Math-blind: award value flows through unchanged.
import {
  emitGrandInterruptionLockCSS, emitGrandInterruptionLockRuntime,
  resolveConfig as resolveGrandInterruptionLockConfig,
} from './blocks/grandInterruptionLock.mjs';
// D-17.7 — Simultaneous FS + Hold-and-Win priority arbiter. When both
// features trigger on a single spin, defer the secondary, let primary
// resolve, then re-fire the deferred trigger.
import {
  emitSimultaneousFsHoldAndWinPriorityCSS, emitSimultaneousFsHoldAndWinPriorityRuntime,
  resolveConfig as resolveSimultaneousFsHoldAndWinPriorityConfig,
} from './blocks/simultaneousFsHoldAndWinPriority.mjs';
// D-17.8 — Credit award conversion (SSOT credit→money). Centralizes the
// canonical coin_value = total_bet / fixedCoinCount derivation + per-
// pay-type award-unit modes so every block reads the same contract.
import {
  emitCreditAwardConversionCSS, emitCreditAwardConversionRuntime,
  resolveConfig as resolveCreditAwardConversionConfig,
} from './blocks/creditAwardConversion.mjs';
// D-18 — GDD reality check (Boki ultimativna arhitektura 2026-06-20).
// Wraps HookBus.emit and after sampleWindowMs reports verified-vs-
// declared compliance score (dead + spurious). Opt-in per GDD via
// model.gddRealityCheck.enabled.
import {
  emitGddRealityCheckCSS, emitGddRealityCheckRuntime,
  resolveConfig as resolveGddRealityCheckConfig,
} from './blocks/gddRealityCheck.mjs';
// W58.J-DE — GlüStV (Glücksspielstaatsvertrag 2021) compliance gate.
// Auto-enabled when jurisdiction === 'DE'. Boot-time only: sets
// window.__DE_MIN_SPIN_MS__ spin-pace floor (§11(2)) + clears prefixed
// session storage (§6e) + emits 2 sole-owner audit events.
import {
  emitGermanyComplianceGateCSS, emitGermanyComplianceGateRuntime,
  resolveConfig as resolveGermanyComplianceGateConfig,
} from './blocks/germanyComplianceGate.mjs';
// W58.J-NL — NL KSA (Wet kansspelen op afstand) compliance gate.
// Auto-enabled when jurisdiction === 'NL'. Boot-time only: sets
// window.__NL_CRUKS_CHECK_REQUIRED__ + __NL_COOL_OFF_HOURS__ flags
// + emits 2 sole-owner audit events.
import {
  emitNetherlandsComplianceGateCSS, emitNetherlandsComplianceGateRuntime,
  resolveConfig as resolveNetherlandsComplianceGateConfig,
} from './blocks/netherlandsComplianceGate.mjs';
// W58.J-EU — EU AI Act (Regulation 2024/1689) compliance gate.
// Auto-enabled when jurisdiction === 'EU'. Boot-time only: sets three
// AI Act window flags (Art.5(1)(a) subliminal + Art.5(1)(b) DDA +
// Art.50(1) declaration) + emits 2 sole-owner audit events.
import {
  emitEuAiActComplianceGateCSS, emitEuAiActComplianceGateRuntime,
  resolveConfig as resolveEuAiActComplianceGateConfig,
} from './blocks/euAiActComplianceGate.mjs';
// W59.H1 — Centralized jurisdiction-precedence resolver + audit gate.
// Single source of truth for the 3-key chain (regulator.profile >
// responsibleGambling.jurisdiction > <block>.jurisdiction). Each per-
// gate block (autoplay, winCap, realityCheck, germany/netherlands/EU
// gates) now imports resolveJurisdiction() instead of inlining the chain.
import {
  emitJurisdictionGateCSS, emitJurisdictionGateRuntime,
  resolveConfig as resolveJurisdictionGateConfig,
} from './blocks/jurisdictionGate.mjs';
// W58.J-FR — French ANJ compliance gate. Auto-enabled when jurisdiction
// === 'FR'. Boot-time only: sets four window flags (autoplay banned,
// turbo banned, min-spin duration, FRJ check required) + emits four
// audit events.
import {
  emitFranceComplianceGateCSS, emitFranceComplianceGateRuntime,
  resolveConfig as resolveFranceComplianceGateConfig,
} from './blocks/franceComplianceGate.mjs';
// W58.J-IT — Italian ADM compliance gate. Auto-enabled when jurisdiction
// === 'IT'. Boot-time only: sets five window flags + emits five audit
// events including mandatory reality-check interval.
import {
  emitItalyComplianceGateCSS, emitItalyComplianceGateRuntime,
  resolveConfig as resolveItalyComplianceGateConfig,
} from './blocks/italyComplianceGate.mjs';
// W58.J-ES — Spanish DGOJ compliance gate. Auto-enabled when jurisdiction
// === 'ES'. Boot-time only: sets five window flags + emits four audit
// events including bonus-offer restriction.
import {
  emitSpainComplianceGateCSS, emitSpainComplianceGateRuntime,
  resolveConfig as resolveSpainComplianceGateConfig,
} from './blocks/spainComplianceGate.mjs';
// WAVE F7 / HX1-HX6 (Boki 2026-06-20 "dalje4") — six new jurisdiction gates.
// Each auto-enables when the resolved jurisdiction matches its country
// code; boot-time only side effects (window flags + HookBus audit events).
import {
  emitUkgcComplianceGateCSS, emitUkgcComplianceGateRuntime,
  resolveConfig as resolveUkgcComplianceGateConfig,
} from './blocks/ukgcComplianceGate.mjs';
import {
  emitSwedenComplianceGateCSS, emitSwedenComplianceGateRuntime,
  resolveConfig as resolveSwedenComplianceGateConfig,
} from './blocks/swedenComplianceGate.mjs';
import {
  emitDenmarkComplianceGateCSS, emitDenmarkComplianceGateRuntime,
  resolveConfig as resolveDenmarkComplianceGateConfig,
} from './blocks/denmarkComplianceGate.mjs';
import {
  emitBelgiumComplianceGateCSS, emitBelgiumComplianceGateRuntime,
  resolveConfig as resolveBelgiumComplianceGateConfig,
} from './blocks/belgiumComplianceGate.mjs';
import {
  emitSwitzerlandComplianceGateCSS, emitSwitzerlandComplianceGateRuntime,
  resolveConfig as resolveSwitzerlandComplianceGateConfig,
} from './blocks/switzerlandComplianceGate.mjs';
import {
  emitRomaniaComplianceGateCSS, emitRomaniaComplianceGateRuntime,
  resolveConfig as resolveRomaniaComplianceGateConfig,
} from './blocks/romaniaComplianceGate.mjs';
// Wave P8 — Hot-Reload BLOCK (dev-mode SSE → in-page re-parse or full reload).
// Disabled by default; opt-in via model.hotReload.enabled (set by dev server
// or by the parent page on localhost). Production builds emit a 0-byte stub.
import {
  emitHotReloadCSS, emitHotReloadMarkup, emitHotReloadRuntime,
  resolveConfig as resolveHotReloadConfig,
} from './blocks/hotReload.mjs';
import {
  emitHoldAndWinCSS, emitHoldAndWinMarkup, emitHoldAndWinRuntime,
  resolveConfig as resolveHoldAndWinConfig,
} from './blocks/holdAndWin.mjs';
// Wave H14 — Hold-and-Win Credit Bucket extension (pure observer)
import {
  emitHoldAndWinCreditBucketCSS,
  emitHoldAndWinCreditBucketMarkup,
  emitHoldAndWinCreditBucketRuntime,
  resolveConfig as resolveHoldAndWinCreditBucketConfig,
} from './blocks/holdAndWinCreditBucket.mjs';
import {
  emitRespinCSS, emitRespinMarkup, emitRespinRuntime,
  resolveConfig as resolveRespinConfig,
} from './blocks/respin.mjs';
import {
  emitWinCapCSS, emitWinCapMarkup, emitWinCapRuntime,
  resolveConfig as resolveWinCapConfig,
} from './blocks/winCap.mjs';
import {
  emitBonusPickCSS, emitBonusPickMarkup, emitBonusPickRuntime,
  resolveConfig as resolveBonusPickConfig,
} from './blocks/bonusPick.mjs';
import {
  emitWheelBonusCSS, emitWheelBonusMarkup, emitWheelBonusRuntime,
  resolveConfig as resolveWheelBonusConfig,
} from './blocks/wheelBonus.mjs';
// Wave H15 — Weighted Wheel Segments extension (pure observer)
import {
  emitWeightedWheelSegmentsCSS,
  emitWeightedWheelSegmentsMarkup,
  emitWeightedWheelSegmentsRuntime,
  resolveConfig as resolveWeightedWheelSegmentsConfig,
} from './blocks/weightedWheelSegments.mjs';
import {
  emitLightningCSS, emitLightningRuntime,
  resolveConfig as resolveLightningConfig,
} from './blocks/lightning.mjs';
import {
  emitGambleCSS, emitGambleMarkup, emitGambleRuntime,
  resolveConfig as resolveGambleConfig,
} from './blocks/gamble.mjs';
import {
  emitSuperSymbolCSS, emitSuperSymbolRuntime,
  resolveConfig as resolveSuperSymbolConfig,
} from './blocks/superSymbol.mjs';
/* Wave J2b — hex real reel engine (axial-column spin animation for
   honeycomb topology). Hot-on whenever SHAPE.kind === 'hexagonal'. */
import {
  emitHexReelEngineCSS, emitHexReelEngineRuntime,
  resolveConfig as resolveHexReelEngineConfig,
} from './blocks/hexReelEngine.mjs';
/* Wave J3 — per-kind SVG spin engines. Each block self-disables when
   its kind doesn't match; otherwise registers a function under
   window.__SLOT_KIND_RUNSPIN__[kind] which the rectangular dispatcher
   in reelEngine.runOneBaseSpin() routes through. */
import {
  emitWheelSpinEngineCSS, emitWheelSpinEngineRuntime,
  resolveConfig as resolveWheelSpinEngineConfig,
} from './blocks/wheelSpinEngine.mjs';
import {
  emitCrashSpinEngineCSS, emitCrashSpinEngineRuntime,
  resolveConfig as resolveCrashSpinEngineConfig,
} from './blocks/crashSpinEngine.mjs';
import {
  emitPlinkoSpinEngineCSS, emitPlinkoSpinEngineRuntime,
  resolveConfig as resolvePlinkoSpinEngineConfig,
} from './blocks/plinkoSpinEngine.mjs';
import {
  emitSlingoSpinEngineCSS, emitSlingoSpinEngineRuntime,
  resolveConfig as resolveSlingoSpinEngineConfig,
} from './blocks/slingoSpinEngine.mjs';
/* Wave LEGO-ENG (2026-06-19) — pyramid layout engine (1-2-3-4-5 fall-down).
   Self-disables when shape.kind !== 'pyramid'; cost on rectangular = 0.
   Wave FIX-2 (2026-06-19) wires this into the orchestrator (block was dead
   code before — present in src/blocks/ but never imported). */
import {
  emitPyramidGridEngineCSS, emitPyramidGridEngineMarkup, emitPyramidGridEngineRuntime,
  resolveConfig as resolvePyramidGridEngineConfig,
} from './blocks/pyramidGridEngine.mjs';
/* Wave LEGO-ENG (2026-06-19) — axial-hex cluster engine. Self-disables
   when shape.kind !== 'hexagonal' or hexClusterEngine.enabled !== true.
   Wave FIX-2 wires into the orchestrator (block was dead code). */
import {
  emitHexClusterEngineCSS, emitHexClusterEngineRuntime,
  resolveConfig as resolveHexClusterEngineConfig,
} from './blocks/hexClusterEngine.mjs';
/* Wave LEGO-FS3.3 (2026-06-19) — atomic reel-height grow/shrink adapter.
   Publishes window.growReelHeight / window.shrinkReelHeight; consumed by
   fsReelHeightEscalation. Self-disables when reelHeightAdapter.enabled !==
   true in the GDD. Wave FIX-2 wires into the orchestrator. */
import {
  emitReelHeightAdapterCSS, emitReelHeightAdapterRuntime,
  resolveConfig as resolveReelHeightAdapterConfig,
} from './blocks/reelHeightAdapter.mjs';
/* Wave 3 (W48 spin-quality rollout) — shared ::after motion-overlay
   block, painted on each engine's spinning surface so the cell layer
   stays sharp on every topology (rectangular/hex/wheel/crash/plinko/
   slingo). LEGO discipline: engines don't import motionOverlay; the
   orchestrator emits it once per engine right after that engine's CSS. */
import {
  emitMotionOverlayCSS,
  resolveConfig as resolveMotionOverlayConfig,
} from './blocks/motionOverlay.mjs';
/* Engine surface map for Wave 3 motion-overlay parity. SVG engines that
 * rotate (wheel/crash/plinko) suppress vertical streaks per topology
 * semantics. Rectangular stays on legacy reelEngineCSS overlay until
 * Wave 3.1 migration. */
const MOTION_OVERLAY_SURFACES = Object.freeze([
  /* W3.1 — Rectangular engine migration. Pre-W54 the rectangular grid
   * had its own inline ::after / ::before overlay inside reelEngineCSS.
   * The defaults there (streakAlpha 0.04, streakSpacingPx 4, shadowAlpha
   * 0.20, speedLinesAlpha 0.04, speedLineSpeedMs 150) DIFFER from the
   * shared motionOverlay block (0.10, 6, 0.22, 0.06, 600). To preserve
   * the rect grid's visual identity exactly, we pass the pre-W54 numbers
   * as a per-surface configOverride. This is the only safe migration
   * path — drop the duplicate code without changing the pixel output. */
  { surfaceSelector: '.reelCol.is-spinning', kindKey: 'rect',
    configOverride: {
      streakAlpha:      0.04,
      streakSpacingPx:  4,
      shadowAlpha:      0.20,
      speedLinesAlpha:  0.04,
      speedLineSpeedMs: 150,
    } },
  { surfaceSelector: '.hex-reel-col.is-spinning',        kindKey: 'hex' },
  { surfaceSelector: '.grid-wheel .wheel-svg.is-spinning',   kindKey: 'wheel',  layers: { streaks: false } },
  { surfaceSelector: '.grid-crash .crash-svg.is-spinning',   kindKey: 'crash',  layers: { streaks: false } },
  { surfaceSelector: '.grid-plinko .plinko-svg.is-spinning', kindKey: 'plinko', layers: { streaks: false } },
  { surfaceSelector: '.grid-slingo .slingo-col.is-spinning', kindKey: 'slingo' },
]);
/* Wave T-slim Phase 2 — extracted grid-render infrastructure (~700 LOC).
   Helpers (symAt / makeCell / cellSize / UNIFORM_REEL_KINDS) emit BEFORE
   the reel engine; per-kind render dispatcher emits AFTER engine + payline
   overlay so all referenced helpers are in scope at runtime. */
import {
  emitGridHelpersRuntime,
  emitGridDispatchRuntime,
} from './runtime/gridRenderer.mjs';
import { emitDevForceButtonsRuntime } from './runtime/devForceButtons.mjs';
import { emitGlobalsContractRuntime } from './runtime/globalsContract.mjs';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

/* Build the base-game-only standalone HTML for a parsed model. */
export function buildSlotHTML(model) {
  /* Wave 2 (2026-06-16) — Project the canonical spinTempo profile into
   * every engine sub-config BEFORE the engines resolve. Single author-
   * facing knob retunes all six engines. Per-engine pinned overrides
   * win over projection (see spinTempo.projectSpinTempoIntoEngines). */
  model = projectSpinTempoIntoEngines(model);
  const allSyms = [
    ...model.symbols.specials, ...model.symbols.high,
    ...model.symbols.mid, ...model.symbols.low,
  ];
  /* Fallback if GDD declared no symbols */
  const allSymsResolved = allSyms.length > 0 ? allSyms : [
    { id: "W", name: "Wild" }, { id: "S", name: "Scatter" },
    { id: "A", name: "Ace" }, { id: "K", name: "King" }, { id: "Q", name: "Queen" },
    { id: "J", name: "Jack" }, { id: "T", name: "Ten" }, { id: "9", name: "Nine" },
  ];
  /* 2026-06-09 — synthetic scatter for FS-enabled GDDs without a declared
     scatter/bonus/trigger symbol. Real bug Boki saw (radial + wheel
     fixtures): GDD declares Free Spins as a feature but lists no scatter
     symbol. Before this guard:
       triggerSymbol defaulted to literal "S"
       countTriggerSymbols() matched any cell with text "S"
       radial pool [O,R,s,n] → lowercase "s" upper-case-matched "S"
         → 2-3 hits/spin → FS auto-trigger every spin
       wheel pool [J,B] with triggerSymbol="B" → 24 segments × 50%
         → ~12 B per spin → instant FS trigger
     Industry behavior: scatter MUST be a unique single-glyph id that no
     other tier symbol shadows. We inject a star-glyph entry whose upper-
     case form (★) doesn't collide with any A-Z paytable id. */
  const fsDeclared = !!(model.freeSpins && model.freeSpins.enabled);
  const scatterAlreadyDeclared = allSymsResolved.some(
    s => /scatter|trigger|bonus/i.test(s.name || '')
  );
  if (fsDeclared && !scatterAlreadyDeclared) {
    /* Synthetic scatter — see comment block above for the root cause.
       The actual injection happens here; the FS-incompatible-kind guard
       runs AFTER buildGridShape (we need the resolved shape.kind, not a
       tag-regex guess that misidentifies "radial" as "wheel"). */
    const SYNTH_SCATTER = { id: '★', name: 'Scatter (auto)' };
    allSymsResolved.unshift(SYNTH_SCATTER);
    if (!Array.isArray(model.symbols.specials)) model.symbols.specials = [];
    model.symbols.specials = [SYNTH_SCATTER, ...model.symbols.specials];
    model.freeSpins = Object.assign({}, model.freeSpins, { triggerSymbol: '★' });
  }
  /* 2026-06-09 — weighted random pool (industry-standard reel-strip
     emulation). Before this, the pool was uniform across all symbols,
     so a 13-symbol set produced scatter at ~7% per cell → 3+ scatters
     every other spin and FS triggers nonstop. Real slots use weighted
     strips: low-pay symbols dominate, wild/scatter/bonus rare.
     Multiplicity per tier (industry baseline ≈ 96% RTP):
       Wild     ×1
       Scatter  ×1
       Bonus    ×1
       High pay ×4 each
       Mid pay  ×6 each
       Low pay  ×9 each
     Effect: scatter rate per cell falls to ~1-2% on a typical 10-symbol
     roster — landed FS hit-frequency lands in the 0.5-3% band that the
     industry treats as canonical. Deterministic — same model → same
     pool layout (no rng leak). */
  const _isWild    = (s) => /wild/i.test(s.name || '');
  const _isScatter = (s) => /scatter|trigger/i.test(s.name || '');
  const _isBonus   = (s) => /bonus|coin\b|jack(pot)?/i.test(s.name || '');
  const _idsHigh   = new Set((model.symbols.high  || []).map(s => String(s.id).toUpperCase()));
  const _idsMid    = new Set((model.symbols.mid   || []).map(s => String(s.id).toUpperCase()));
  const _idsLow    = new Set((model.symbols.low   || []).map(s => String(s.id).toUpperCase()));
  function _weight(sym) {
    /* Synthetic ★ scatter (injected above for FS-enabled GDDs without an
       explicit scatter symbol) — weight 0 so it NEVER appears in random
       fills. FS in those games can only fire via the Force-FS dev panel
       or the universal force CTA, never accidentally. This is the only
       safe rate for tiny-roster grids (diamond / cross / l_shape /
       slingo) where a weight-1 scatter still hit-rated 3-5% per cell. */
    if (String(sym.id) === '★') return 0;
    if (_isWild(sym))    return 1;
    if (_isScatter(sym)) return 1;
    if (_isBonus(sym))   return 1;
    const id = String(sym.id).toUpperCase();
    if (_idsHigh.has(id)) return 4;
    if (_idsMid.has(id))  return 6;
    if (_idsLow.has(id))  return 9;
    // Fallback for unknown / specials list entries → middle weight
    return 5;
  }
  const pool = [];
  for (const sym of allSymsResolved) {
    const w = _weight(sym);
    for (let i = 0; i < w; i++) pool.push(sym);
  }
  /* ── Symbol registry for the win-cycle module ────────────────────────
     Classifies every symbol so detectWinCombos knows:
       • regularPay — HP/MP/LP, candidates for win-lines (each unique
         id with >=3 hits becomes ONE event)
       • wild — substitutes for any regular symbol; its cells join EVERY
         regular event (lit alongside the real symbol)
       • scatter — NEVER part of a win-line (trigger-only)
       • tier — 'HP' | 'MP' | 'LP' | 'WILD' (drives sort order so HP
         events fire first, then MP, then LP) */
  const _highIds = (model.symbols.high  || []).map(s => String(s.id).toUpperCase());
  const _midIds  = (model.symbols.mid   || []).map(s => String(s.id).toUpperCase());
  const _lowIds  = (model.symbols.low   || []).map(s => String(s.id).toUpperCase());
  const _specials = model.symbols.specials || [];
  const _wildSym = _specials.find(s => /wild/i.test(s.name || ''));
  const _scatterSym = _specials.find(s => /scatter|bonus|trigger/i.test(s.name || ''));
  const SYMBOL_REGISTRY = {
    regularPay: [..._highIds, ..._midIds, ..._lowIds],
    wild:    _wildSym    ? String(_wildSym.id).toUpperCase()    : null,
    scatter: _scatterSym ? String(_scatterSym.id).toUpperCase() : null,
    tier: Object.assign({},
      Object.fromEntries(_highIds.map(id => [id, 'HP'])),
      Object.fromEntries(_midIds .map(id => [id, 'MP'])),
      Object.fromEntries(_lowIds .map(id => [id, 'LP'])),
      _wildSym ? { [String(_wildSym.id).toUpperCase()]: 'WILD' } : {}
    ),
  };
  const shape = buildGridShape(model);
  /* FS-incompatible grid kinds — see comment block above. Resolved AFTER
     buildGridShape so we read the canonical shape.kind, not a tag guess. */
  const FS_INCOMPATIBLE_KINDS = new Set(['wheel', 'plinko', 'crash']);
  if (model.freeSpins && model.freeSpins.enabled && FS_INCOMPATIBLE_KINDS.has(shape.kind)) {
    model.freeSpins = Object.assign({}, model.freeSpins, { enabled: false });
  }
  /* ── Payline pool (LEGO-block delegation) ───────────────────────────────
     Server-side payline synthesis lives in `src/blocks/paylines.mjs`. This
     builder is now a pure orchestrator — it asks the block for the pool
     and trusts whatever it gets back. GDD-driven: if the parsed model
     declared an explicit pool (model.winPresentation.paylines), the block
     returns that verbatim; otherwise the industry-standard set for the
     grid kind. Empty pool = cluster/ways/wheel/SVG mode downstream. */
  const _payCfg = paylineConfig(model, shape);
  const PAYLINE_POOL = _payCfg.pool;
  const reels = shape.reels;
  const rows  = shape.rows;

  /* UQ-DEEP-E audit fix (BUILD-3): palette values flow into both
   * CSS `:root { --bg-0: ${bg0} }` and `<meta theme-color>` HTML
   * attribute. An adversarial GDD palette value like
   * `"red; } body { display: none "` would break out of the CSS rule.
   * Validate strict `#RGB | #RRGGBB | #RRGGBBAA` hex before embed; fall
   * back to safe default otherwise. */
  const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
  const safeHex = (v, fallback) => (typeof v === 'string' && HEX_RE.test(v.trim())) ? v.trim() : fallback;
  /* Palette — use GDD palette[] if available, else reference defaults */
  const p = model.theme.palette || [];
  const bg0    = safeHex(p[0], "#05070c");   // deep background
  const bg1    = safeHex(p[1], "#0b0f16");   // mid background
  const accent = safeHex(p[2], "#c9a227");   // primary accent (gold)
  const text   = "#f2f2f2";

  const layoutSub = `${shape.shapeNote}${shape.paylines ? ` · ${shape.paylines} lines` : ''}${shape.wayCount ? ` · ${shape.wayCount} ways` : ''}`;

  const _html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<!--
  Wave D3 — Mobile viewport contract.
  • width=device-width   → use the real screen, not the 980px default.
  • initial-scale=1 + max/min=1 → lock to 1:1, kill double-tap zoom.
  • viewport-fit=cover   → respect notch / home-bar safe-area-insets.

  Without this, mobile Safari/Chrome render at 980px and the layout falls
  off-screen — hub touch targets become unreachable (K5 audit 20/120 fail).

  NOTE: deliberately NO interactive-widget=resizes-content key. WebKit
  Safari emits a console warning on that key ("not recognized + ignored") which
  trips the K4 cross-browser zero-console-error gate even though the page
  still works. Chromium-only feature, not worth the cross-browser noise.
-->
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, viewport-fit=cover">
<meta name="theme-color" content="${bg0}">
<meta name="format-detection" content="telephone=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>${escapeHtml(model.name)} · Base Game</title>
${/* Wave A8 — PWA installability head injection (manifest + icons + theme). */ ''}
${emitPwaInstallabilityMarkup(resolvePwaInstallabilityConfig({ ...model, gameName: model.name }))}
<style>
${emitThemeCSS(resolveThemeCSSConfig(model))}
${emitStageBadgeCSS(resolveStageBadgeConfig(model))}
${emitFsProgressBarCSS(resolveFsProgressBarConfig(model))}
${emitWinwaysIndicatorCSS(resolveWinwaysIndicatorConfig(model))}
${emitMultiplierLadderCSS(resolveMultiplierLadderConfig(model))}
${emitStickyMeterCSS(resolveStickyMeterConfig(model))}
${emitEnergyMeterCSS(resolveEnergyMeterConfig(model))}
${emitPickBonusRevealCSS(resolvePickBonusRevealConfig(model))}
${emitCoinShowerCSS(resolveCoinShowerConfig(model))}
${emitRewardChestCSS(resolveRewardChestConfig(model))}
${emitSymbolStackCollapseCSS(resolveSymbolStackCollapseConfig(model))}
${emitWheelBonusRevealCSS(resolveWheelBonusRevealConfig(model))}
${emitMysteryRevealCSS(resolveMysteryRevealConfig(model))}
${emitPaylineOverlayCSS(resolvePaylineOverlayConfig(model))}
${emitGridShapesCSS()}
${emitReelEngineCSS(resolveReelEngineConfig(model))}
${/* Wave J2b — hex reel engine CSS (no-op when shape !== hexagonal). */ ''}
${emitHexReelEngineCSS(resolveHexReelEngineConfig(model))}
${/* Wave J3 — per-kind SVG spin engine CSS (no-op when shape mismatches). */ ''}
${emitWheelSpinEngineCSS(resolveWheelSpinEngineConfig(model))}
${emitCrashSpinEngineCSS(resolveCrashSpinEngineConfig(model))}
${emitPlinkoSpinEngineCSS(resolvePlinkoSpinEngineConfig(model))}
${emitSlingoSpinEngineCSS(resolveSlingoSpinEngineConfig(model))}
${/* Wave LEGO-ENG + FS3.3 (FIX-2, 2026-06-19) — pyramid layout,
     hex-cluster overlay, atomic reel-height adapter. Each block
     self-disables when its GDD trigger is not set. CSS emit cost
     on unrelated topologies = inline rule-set strings. */ ''}
${emitPyramidGridEngineCSS(resolvePyramidGridEngineConfig(model))}
${emitHexClusterEngineCSS(resolveHexClusterEngineConfig(model))}
${emitReelHeightAdapterCSS(resolveReelHeightAdapterConfig(model))}
${/* Wave 3 — motion overlay parity per engine (LEGO: orchestrator wires;
     engines stay sharp-cell). Wheel/crash/plinko rotate or transform-non-
     vertically → vertical streaks disabled there. */ ''}
${MOTION_OVERLAY_SURFACES.map(s => emitMotionOverlayCSS(resolveMotionOverlayConfig(model), s)).join('\n')}
${emitAnticipationCSS(resolveAnticipationConfig(model))}

${emitWinPresentationCSS(resolveWinPresentationConfig(model))}

${emitScatterCelebrationCSS(model)}
${emitTumbleCSS(resolveTumbleConfig(model))}
${emitMultiplierOrbCSS(resolveMultiplierOrbConfig(model))}
${/* Wave LEGO-BUY mutex — multi-tier menu/ladder takes precedence over
    the single-button / single-toggle blocks. When the menu resolves
    enabled (tiers.length >= 2), bonusBuy CSS is suppressed; same logic
    for anteBetLadder vs anteBet. */ ''}
${resolveBonusBuyMenuConfig(model).enabled ? '' : emitBonusBuyCSS(resolveBonusBuyConfig(model))}
${emitBonusBuyMenuCSS(resolveBonusBuyMenuConfig(model))}
${/* Wave H11 — Bonus Buy Deterministic Plant extension (tier picker modal CSS). */ ''}
${emitBonusBuyDeterministicCSS(resolveBonusBuyDeterministicConfig(model))}
${resolveAnteBetLadderConfig(model).enabled ? '' : emitAnteBetCSS(resolveAnteBetConfig(model))}
${emitAnteBetLadderCSS(resolveAnteBetLadderConfig(model))}
${/* Wave LEGO-RANDOM (B-3) — in-spin random feature surfaces. */ ''}
${emitMysteryPrizeBoxCSS(resolveMysteryPrizeBoxConfig(model))}
${emitRandomWildBurstCSS(resolveRandomWildBurstConfig(model))}
${/* Wave LEGO-COLLECT (B-4) — coin-collect meta-game trio. */ ''}
${emitCoinCollectCSS(resolveCoinCollectConfig(model))}
${emitCumulativeMeterCSS(resolveCumulativeMeterConfig(model))}
${emitCollectRevealOverlayCSS(resolveCollectRevealOverlayConfig(model))}
${/* Wave LEGO-VOLATILITY (B-6) — pre-spin player choice. */ ''}
${emitVolatilitySelectorCSS(resolveVolatilitySelectorConfig(model))}
${/* Wave LEGO-REPLAY (B-2) — spin history + control bar. */ ''}
${emitSpinHistoryReplayCSS(resolveSpinHistoryReplayConfig(model))}
${emitReplayControlBarCSS(resolveReplayControlBarConfig(model))}
${/* Wave LEGO-SOCIAL (B-5) — leaderboard + share. */ ''}
${emitLeaderboardChipCSS(resolveLeaderboardChipConfig(model))}
${emitShareReplayCSS(resolveShareReplayConfig(model))}
${/* Wave LEGO-SIDEBET (B-7) — insurance + prize boost. */ ''}
${emitInsuranceBetCSS(resolveInsuranceBetConfig(model))}
${emitPrizeBoostBetCSS(resolvePrizeBoostBetConfig(model))}
${/* Wave LEGO-THEME (B-8) — themePicker + paletteRoulette + ambientBg. */ ''}
${emitThemePickerCSS(resolveThemePickerConfig(model))}
${emitPaletteRouletteCSS(resolvePaletteRouletteConfig(model))}
${emitAmbientBgVariantsCSS(resolveAmbientBgVariantsConfig(model))}
${/* Wave LEGO-PROG (DEF1) — playerXp + sessionLevelMeter + achievementToast. */ ''}
${emitPlayerXpCSS(resolvePlayerXpConfig(model))}
${emitSessionLevelMeterCSS(resolveSessionLevelMeterConfig(model))}
${emitAchievementToastCSS(resolveAchievementToastConfig(model))}
/* Wave L–P — 16 feature blocks CSS (no-op when disabled) */
${emitStickyWildCSS(resolveStickyWildConfig(model))}
${emitExpandingWildCSS(resolveExpandingWildConfig(model))}
${emitWalkingWildCSS(resolveWalkingWildConfig(model))}
${emitWildReelCSS(resolveWildReelConfig(model))}
${emitMysterySymbolCSS(resolveMysterySymbolConfig(model))}
${emitPersistentMultiplierCSS(resolvePersistentMultiplierConfig(model))}
${emitProgressiveFreeSpinsCSS(resolveProgressiveFreeSpinsConfig(model))}
${/* audio CSS skipped — ADB tok, ne GDD */ ''}
${emitUiToastCSS(resolveUiToastConfig(model))}
${emitBigWinTierCSS(resolveBigWinTierConfig(model))}
${/* Wave V1+V2+V3 — primary action button CSS.
    When V3 spinControl is enabled (default), it owns the visual layer and
    V1/V2 standalone button CSS is suppressed (their state machines are
    superseded). Disable spinControl in GDD (`spinControl: { enabled: false }`)
    to fall back to the V1/V2 dual-button mode. */ ''}
${resolveSpinControlConfig(model).enabled ? '' : emitSlamStopCSS(resolveSlamStopConfig(model))}
${resolveSpinControlConfig(model).enabled ? '' : emitForceSkipCSS(resolveForceSkipConfig(model))}
${emitUniversalForcePanelCSS(resolveUniversalForcePanelConfig(model))}
${emitGenericFeatureBannerCSS(resolveGenericFeatureBannerConfig(model))}
${emitSpinControlCSS(resolveSpinControlConfig(model))}
${/* Wave U4 — autoplay session UI (button + panel + counter). */ ''}
${emitAutoplayCSS(resolveAutoplayConfig(model))}
${/* Wave U5 — bet selector UI (chip + panel + steps + max). */ ''}
${emitBetSelectorCSS(resolveBetSelectorConfig(model))}
${/* Wave U6 — secondary gamble overlay (Card + Ladder branches). */ ''}
${emitGambleSecondaryCSS(resolveGambleSecondaryConfig(model))}
${/* Wave U8 — balance HUD (hub widget: Balance | Bet | Win). */ ''}
${emitBalanceHudCSS(resolveBalanceHudConfig(model))}
${/* Wave H12 — Net Win/Loss Indicator (chip CSS for session-net column). */ ''}
${emitNetLossIndicatorCSS(resolveNetLossIndicatorConfig(model))}
${/* Wave H2 — Reality Check modal CSS (regulator player-protection popup). */ ''}
${emitRealityCheckCSS(resolveRealityCheckConfig(model))}
${emitRegulatorDisclosureModalCSS(resolveRegulatorDisclosureModalConfig(model))}
${/* Wave H3 — Session Timeout modal CSS (continuous-play cap + forced break). */ ''}
${emitSessionTimeoutCSS(resolveSessionTimeoutConfig(model))}
${emitWinRollupCSS(resolveWinRollupConfig(model))}
${/* Wave U9 — session history log (audit panel). */ ''}
${emitHistoryLogCSS(resolveHistoryLogConfig(model))}
${/* Wave U11 — turbo mode toggle (cadence override). */ ''}
${emitTurboModeCSS(resolveTurboModeConfig(model))}
${/* Wave U13 — settings panel (consolidated preferences modal). */ ''}
${emitSettingsPanelCSS(resolveSettingsPanelConfig(model))}
${/* Wave A5 — RTL layout (numeric isolation + html[dir=rtl] mirrors). */ ''}
${emitRtlLayoutCSS(resolveRtlLayoutConfig(model))}
${/* Wave H4 — Color-blind pattern overlay (WCAG 2.2 SC 1.4.1).
     Per-tier ::before pattern layer + chip toggle. 0-byte when disabled. */ ''}
${emitColorblindPatternsCSS(resolveColorblindPatternsConfig(model))}
${/* Wave H6 — Bonus Climax Reveal placard (universal bonus-entry presenter). */ ''}
${emitBonusClimaxRevealCSS(resolveBonusClimaxRevealConfig(model))}
${/* Wave H7 — Cell Level Upgrade badge (per-cell numeric meter). */ ''}
${emitCellLevelUpgradeCSS(resolveCellLevelUpgradeConfig(model))}
${/* Wave H8 — Cell Overflow Counter (+N per-reel badge). */ ''}
${emitCellOverflowCounterCSS(resolveCellOverflowCounterConfig(model))}
${/* Wave H9 — Ambient Background Wheel (theme atmosphere visual). */ ''}
${emitAmbientBackgroundWheelCSS(resolveAmbientBackgroundWheelConfig(model))}
${/* Wave H10 — Dual-Role Scatter badge (★ per scatter cell). */ ''}
${emitDualRoleScatterCSS(resolveDualRoleScatterConfig(model))}
${/* Wave H11-H15 — Mega Symbol / Wild Trail / Jackpot Ladder / Supercharged FS / Cascade Booster. */ ''}
${emitMegaSymbolCSS(resolveMegaSymbolConfig(model))}
${emitWildCollectionTrailCSS(resolveWildCollectionTrailConfig(model))}
${emitJackpotLadderRoomsCSS(resolveJackpotLadderRoomsConfig(model))}
${emitSuperchargedFsCSS(resolveSuperchargedFsConfig(model))}
${emitCascadeBoosterCSS(resolveCascadeBoosterConfig(model))}
${/* Wave H16-H20 — Split Symbol / Nudge Reel / Respin Charge / Sync Reels / Win Mult Badge. */ ''}
${emitSplitSymbolCSS(resolveSplitSymbolConfig(model))}
${emitNudgeReelCSS(resolveNudgeReelConfig(model))}
${emitRespinChargeCSS(resolveRespinChargeConfig(model))}
${emitSyncReelsCSS(resolveSyncReelsConfig(model))}
${emitWinMultiplierBadgeCSS(resolveWinMultiplierBadgeConfig(model))}
${/* Wave H21-H25 — Win Line Flash / Near-Miss Tease / Reel Lock Hold / Cascade Path / Streak Bonus. */ ''}
${emitWinLineFlashCSS(resolveWinLineFlashConfig(model))}
${emitNearMissTeaseCSS(resolveNearMissTeaseConfig(model))}
${emitReelLockHoldCSS(resolveReelLockHoldConfig(model))}
${emitCascadePathDrawCSS(resolveCascadePathDrawConfig(model))}
${emitStreakBonusCSS(resolveStreakBonusConfig(model))}
${/* Wave H27 + H30 — Payline Dimmer + Retrigger Escalator. */ ''}
${emitPaylineDimmerCSS(resolvePaylineDimmerConfig(model))}
${emitRetriggerEscalatorCSS(resolveRetriggerEscalatorConfig(model))}
${emitRetriggerMeterCSS(resolveRetriggerMeterConfig(model))}
${/* Wave U10 — paytable modal (i-button + symbol roster + features). */ ''}
${emitPaytableCSS(resolvePaytableConfig(model))}
${emitSymbolInfoPopoverCSS(resolveSymbolInfoPopoverConfig(model))}
${/* Wave B64 — Symbol upgrade flash + morph keyframes (decorates .cell). */ ''}
${emitSymbolUpgradeCSS(resolveSymbolUpgradeConfig(model))}
${/* W56 — aux multiplier reel CSS (no-op when model.stormMultiplierReel.enabled = false). */ ''}
${emitStormMultiplierReelCSS(resolveStormMultiplierReelConfig(model))}
${/* D-17.1 — pattern-win marquee overlay CSS (no-op when model.patternWin.enabled = false). */ ''}
${emitPatternWinCSS(resolvePatternWinConfig(model))}
${/* D-17.2 — big-symbol oversized footprint CSS (no-op when disabled). */ ''}
${emitBigSymbolRender2x2CSS(resolveBigSymbolRender2x2Config(model))}
${/* D-17.3 — linked-reels fuse CSS (no-op when disabled). */ ''}
${emitLinkedReelsCSS(resolveLinkedReelsConfig(model))}
${/* D-17.4 — per-trigger volatility set hook CSS (no-op when disabled). */ ''}
${emitPerTriggerVolatilitySetCSS(resolvePerTriggerVolatilitySetConfig(model))}
${/* D-17.5 — pot-symbol Fireball tag CSS (no-op when disabled). */ ''}
${emitPotSymbolFireballCSS(resolvePotSymbolFireballConfig(model))}
${/* D-17.6 — GRAND interruption-lock overlay CSS (no-op when disabled). */ ''}
${emitGrandInterruptionLockCSS(resolveGrandInterruptionLockConfig(model))}
${/* D-17.7 — simultaneous FS + H&W priority arbiter CSS (no-op when disabled). */ ''}
${emitSimultaneousFsHoldAndWinPriorityCSS(resolveSimultaneousFsHoldAndWinPriorityConfig(model))}
${/* D-17.8 — credit-award SSOT CSS (no-op when disabled). */ ''}
${emitCreditAwardConversionCSS(resolveCreditAwardConversionConfig(model))}
${/* D-18 — gddRealityCheck status + optional dev HUD CSS. */ ''}
${emitGddRealityCheckCSS(resolveGddRealityCheckConfig(model))}
${/* Wave P8 — hot-reload indicator badge (dev-mode only). */ ''}
${emitHotReloadCSS(resolveHotReloadConfig(model))}
${emitHoldAndWinCSS(resolveHoldAndWinConfig(model))}
${/* Wave H14 — Hold-and-Win Credit Bucket extension (chip + jackpot CSS). */ ''}
${emitHoldAndWinCreditBucketCSS(resolveHoldAndWinCreditBucketConfig(model))}
${emitRespinCSS(resolveRespinConfig(model))}
${emitWinCapCSS(resolveWinCapConfig(model))}
${emitBonusPickCSS(resolveBonusPickConfig(model))}
${emitWheelBonusCSS(resolveWheelBonusConfig(model))}
${/* Wave H15 — Weighted Wheel Segments extension (jackpot tier CSS). */ ''}
${emitWeightedWheelSegmentsCSS(resolveWeightedWheelSegmentsConfig(model))}
${/* Wave H13 — Path-Aware Multiplier extension (per-path chip + HUD CSS). */ ''}
${emitPathAwareMultiplierCSS(resolvePathAwareMultiplierConfig(model))}
${/* Wave LEGO-EV — all-ways + bidirectional ways evaluators (pay-path overlays). */ ''}
${emitAllWaysEvalCSS(resolveAllWaysEvalConfig(model))}
${emitBidirectionalWaysEvalCSS(resolveBidirectionalWaysEvalConfig(model))}
${/* Wave LEGO-M — 6 base/FS multiplier variants. Each emits empty CSS unless GDD enables. */ ''}
${emitPerFsSpinMultiplierCSS(resolvePerFsSpinMultiplierConfig(model))}
${emitMysterySymbolMultiplierCSS(resolveMysterySymbolMultiplierConfig(model))}
${emitWildCollisionMultiplierCSS(resolveWildCollisionMultiplierConfig(model))}
${emitRetriggerMultiplierBumpCSS(resolveRetriggerMultiplierBumpConfig(model))}
${emitClusterSizeMultiplierCSS(resolveClusterSizeMultiplierConfig(model))}
${emitTotalMultiplierChipCSS(resolveTotalMultiplierChipConfig(model))}
${/* Wave LEGO-H/FS/W — 8 GDD-driven variants (H&W frame/orb/room + FS tumble/expand/ladder + wild expand/mega). */ ''}
${emitHoldAndWinFrameMultiplierCSS(resolveHoldAndWinFrameMultiplierConfig(model))}
${emitHoldAndWinLockedOrbMultiplierCSS(resolveHoldAndWinLockedOrbMultiplierConfig(model))}
${emitHoldAndWinRoomJackpotMultiplierCSS(resolveHoldAndWinRoomJackpotMultiplierConfig(model))}
${emitTumbleGrowingFsMultiplierCSS(resolveTumbleGrowingFsMultiplierConfig(model))}
${emitFsExpansionWildsCSS(resolveFsExpansionWildsConfig(model))}
${emitProgressiveFsRetriggerLadderCSS(resolveProgressiveFsRetriggerLadderConfig(model))}
${emitExpandingWildMultiplierCSS(resolveExpandingWildMultiplierConfig(model))}
${emitMegaWildClusterCSS(resolveMegaWildClusterConfig(model))}
${emitRandomLightningMultiplierCSS(resolveRandomLightningMultiplierConfig(model))}
${emitWalkingWildStepperCSS(resolveWalkingWildStepperConfig(model))}
${emitDynamicWaysEngineCSS(resolveDynamicWaysEngineConfig(model))}
${emitInfinityReelsEngineCSS(resolveInfinityReelsEngineConfig(model))}
${emitSymbolSplitRevealCSS(resolveSymbolSplitRevealConfig(model))}
${emitSuperSymbolUpgradeCSS(resolveSuperSymbolUpgradeConfig(model))}
${emitJackpotRoomRevealCSS(resolveJackpotRoomRevealConfig(model))}
${emitJackpotPickerCSS(resolveJackpotPickerConfig(model))}
${emitLightningCSS(resolveLightningConfig(model))}
${emitGambleCSS(resolveGambleConfig(model))}
${emitSuperSymbolCSS(resolveSuperSymbolConfig(model))}

${emitFreeSpinsCSS(resolveFreeSpinsConfig(model))}
${emitDevToolsCSS()}
</style></head><body>

<!-- FIX-8 H4 (2026-06-19) — Shared aria-live announcer.
     20+ blocks dynamically mutate DOM text (win awards, multiplier
     escalation, jackpot ladder, mystery reveal, FS escalation, etc.)
     and lacked their own aria-live regions. Adding 20 regions =
     20× SR clutter. Industry pattern: ONE polite-priority shared
     announcer region + window.__SR_ANNOUNCE__(msg, opts) helper.
     Each text-mutating block calls __SR_ANNOUNCE__('Win 250 credits')
     and the SR queues the message exactly once. aria-atomic=true
     so partial text is not announced mid-mutation.
     Style 'sr-only' clipped: visually hidden, kept in accessibility tree. -->
<div id="srAnnouncer" role="status" aria-live="polite" aria-atomic="true"
     style="position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden;clip:rect(1px,1px,1px,1px);white-space:nowrap;"></div>
<div id="srAnnouncerAssertive" role="alert" aria-live="assertive" aria-atomic="true"
     style="position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden;clip:rect(1px,1px,1px,1px);white-space:nowrap;"></div>

${emitFreeSpinsHudMarkup(resolveFreeSpinsConfig(model))}
${emitFreeSpinsToastMarkup(resolveFreeSpinsConfig(model))}

<div class="stage">
  <div class="header">
    <div class="title">${escapeHtml(model.name)}</div>
    ${emitStageBadgeMarkup(resolveStageBadgeConfig(model))}
    ${emitFsProgressBarMarkup(resolveFsProgressBarConfig(model))}
    ${emitWinwaysIndicatorMarkup(resolveWinwaysIndicatorConfig(model))}
    ${emitMultiplierLadderMarkup(resolveMultiplierLadderConfig(model))}
    ${emitStickyMeterMarkup(resolveStickyMeterConfig(model))}
    ${emitEnergyMeterMarkup(resolveEnergyMeterConfig(model))}
    ${emitPickBonusRevealMarkup(resolvePickBonusRevealConfig(model))}
    ${emitCoinShowerMarkup(resolveCoinShowerConfig(model))}
    ${emitRewardChestMarkup(resolveRewardChestConfig(model))}
    <div class="sub">${escapeHtml(layoutSub)}</div>
  </div>
  <div class="play">
    <div class="leftSpacer" aria-hidden="true"></div>
    <div class="frame" id="frameHost">
      <div class="gridHost" id="gridHost" data-kind="${shape.kind}">
        <!-- Payline overlay — populated at runtime per winning-line cycle
             step. Sits above the grid (z-index 6) so polylines render
             over the reels without intercepting pointer events. SVG
             viewBox is sized to the gridHost client rect on every frame
             so cell coordinates stay accurate after layout changes. -->
        <svg class="payline-overlay" id="paylineOverlay" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"></svg>
        ${emitSymbolStackCollapseMarkup(resolveSymbolStackCollapseConfig(model))}
        ${emitWheelBonusRevealMarkup(resolveWheelBonusRevealConfig(model))}
        ${emitMysteryRevealMarkup(resolveMysteryRevealConfig(model))}
      </div>
    </div>
    <aside class="sideHud" aria-label="Game Controls">
      ${resolveSpinControlConfig(model).enabled
        ? emitSpinControlMarkup(resolveSpinControlConfig(model))
        : `<button class="spinBtn" id="spinBtn" aria-label="Spin" type="button">
        <!-- Industry-standard circular spin / refresh icon — two opposing
             arrows wrapping in a circle. Used by most major slot vendors
             on the primary SPIN CTA. -->
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M5.6 17.4a10.5 10.5 0 0 0 18.7 5.2"/>
          <path d="M26.4 14.6A10.5 10.5 0 0 0 7.7 9.4"/>
          <polyline points="24.3,22.6 24.3,16.6 18.3,16.6"/>
          <polyline points="7.7,9.4 7.7,15.4 13.7,15.4"/>
        </svg>
      </button>`}
      <button class="autoBtn" id="autoBtn" aria-label="Auto" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor"/></svg>
      </button>
    </aside>
  </div>
  ${/* Wave H5.8 — base-game total-win rollup counter. Mounted ABOVE the
      .hub element (Boki rule "iznad Hub-a koji stoji") so a regular win
      ticks up here while big wins still defer to bigWinTier overlay. */ ''}
  ${emitWinRollupMarkup(resolveWinRollupConfig(model))}
  <div class="hub">
    <button class="iconBtn" id="settingsMenuBtn" aria-label="Settings menu" type="button">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>
    </button>
    ${/* Wave U8 — balance HUD parented inside the hub (3 columns:
        BALANCE | BET | WIN with debit/credit pulse). Replaces the
        old .statBox--balance + .statBox--status pair. */ ''}
    ${emitBalanceHudMarkup(resolveBalanceHudConfig(model))}
    ${emitNetLossIndicatorMarkup(resolveNetLossIndicatorConfig(model))}
    ${emitRealityCheckMarkup(resolveRealityCheckConfig(model))}
    ${emitRegulatorDisclosureModalMarkup(resolveRegulatorDisclosureModalConfig(model))}
    ${/* Wave H3 — session-timeout modal (warning + forced-break dual mode). */ ''}
    ${emitSessionTimeoutMarkup(resolveSessionTimeoutConfig(model))}
    ${/* Wave U5 — bet chip + steps + panel. */ ''}
    ${emitBetSelectorMarkup(resolveBetSelectorConfig(model))}
    <button class="iconBtn" aria-label="Sound" type="button">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
    </button>
  </div>
  ${/* Legacy hidden tokens — kept so legacy runtime code that reaches
      for #bal / #status still finds writable nodes. Visually inert. */ ''}
  <span hidden aria-hidden="true">
    <span id="bal">1000.00</span>
    <span id="status">PRESS SPIN</span>
  </span>
</div>

<!-- 2026-06-09 — devFsBtn / devBwBtn / devMultBtn REMOVED.
     The bottom-left dev-rail duplicated the universal-force-panel (top-right).
     Players saw two FS buttons, two BIG-WIN buttons, two MULT buttons.
     The ufp-panel is the SOLE force CTA surface now. Legacy lookups
     (devFsBtn id) get a stub node so emitDevForceButtonsRuntime + freeSpins
     dev hooks degrade silently. -->
<span hidden id="devFsBtn" aria-hidden="true"></span>
<span hidden id="devBwBtn" aria-hidden="true"></span>
<span hidden id="devMultBtn" aria-hidden="true"></span>

${emitFreeSpinsOverlayMarkup(resolveFreeSpinsConfig(model))}

${resolveBonusBuyMenuConfig(model).enabled ? '' : emitBonusBuyMarkup(resolveBonusBuyConfig(model))}
${emitBonusBuyMenuMarkup(resolveBonusBuyMenuConfig(model))}
${emitBonusBuyDeterministicMarkup(resolveBonusBuyDeterministicConfig(model))}
${resolveAnteBetLadderConfig(model).enabled ? '' : emitAnteBetMarkup(resolveAnteBetConfig(model))}
${emitAnteBetLadderMarkup(resolveAnteBetLadderConfig(model))}
${/* Wave LEGO-RANDOM (B-3) — in-spin random surface markup. */ ''}
${emitMysteryPrizeBoxMarkup(resolveMysteryPrizeBoxConfig(model))}
${emitRandomWildBurstMarkup(resolveRandomWildBurstConfig(model))}
${/* Wave LEGO-COLLECT (B-4) — coin-collect meta-game markup. */ ''}
${emitCoinCollectMarkup(resolveCoinCollectConfig(model))}
${emitCumulativeMeterMarkup(resolveCumulativeMeterConfig(model))}
${emitCollectRevealOverlayMarkup(resolveCollectRevealOverlayConfig(model))}
${/* Wave LEGO-VOLATILITY (B-6) — pre-spin player choice markup. */ ''}
${emitVolatilitySelectorMarkup(resolveVolatilitySelectorConfig(model))}
${/* Wave LEGO-REPLAY (B-2) — spin history markup. */ ''}
${emitSpinHistoryReplayMarkup(resolveSpinHistoryReplayConfig(model))}
${emitReplayControlBarMarkup(resolveReplayControlBarConfig(model))}
${/* Wave LEGO-SOCIAL (B-5) — leaderboard + share markup. */ ''}
${emitLeaderboardChipMarkup(resolveLeaderboardChipConfig(model))}
${emitShareReplayMarkup(resolveShareReplayConfig(model))}
${/* Wave LEGO-SIDEBET (B-7) — insurance + prize boost markup. */ ''}
${emitInsuranceBetMarkup(resolveInsuranceBetConfig(model))}
${emitPrizeBoostBetMarkup(resolvePrizeBoostBetConfig(model))}
${/* Wave LEGO-THEME (B-8) — themePicker + paletteRoulette + ambientBg markup. */ ''}
${emitThemePickerMarkup(resolveThemePickerConfig(model))}
${emitPaletteRouletteMarkup(resolvePaletteRouletteConfig(model))}
${emitAmbientBgVariantsMarkup(resolveAmbientBgVariantsConfig(model))}
${/* Wave LEGO-PROG (DEF1) — playerXp + sessionLevelMeter + achievementToast. */ ''}
${emitPlayerXpMarkup(resolvePlayerXpConfig(model))}
${emitSessionLevelMeterMarkup(resolveSessionLevelMeterConfig(model))}
${emitAchievementToastMarkup(resolveAchievementToastConfig(model))}
<!-- Wave L–P markup (empty strings when disabled) -->
${emitPersistentMultiplierMarkup(resolvePersistentMultiplierConfig(model))}
${emitProgressiveFreeSpinsMarkup(resolveProgressiveFreeSpinsConfig(model))}
${/* audio markup skipped — ADB tok, ne GDD */ ''}
${emitUiToastMarkup(resolveUiToastConfig(model))}
${emitBigWinTierMarkup(resolveBigWinTierConfig(model))}
${/* Wave V1+V2 — spin-control buttons (hidden by default; runtime toggles). */ ''}
${/* Wave V3 supersede: when spinControl enabled, V1/V2 markup OFF (V3 owns the button). */ ''}
${resolveSpinControlConfig(model).enabled ? '' : emitSlamStopMarkup(resolveSlamStopConfig(model))}
${resolveSpinControlConfig(model).enabled ? '' : emitForceSkipMarkup(resolveForceSkipConfig(model))}
${emitUniversalForcePanelMarkup(resolveUniversalForcePanelConfig(model), model)}
${emitGenericFeatureBannerMarkup(resolveGenericFeatureBannerConfig(model))}
${/* Wave U4 — autoplay button + panel + counter overlay. */ ''}
${emitAutoplayMarkup(resolveAutoplayConfig(model))}
${emitHoldAndWinMarkup(resolveHoldAndWinConfig(model))}
${emitHoldAndWinCreditBucketMarkup(resolveHoldAndWinCreditBucketConfig(model))}
${emitRespinMarkup(resolveRespinConfig(model))}
${emitWinCapMarkup(resolveWinCapConfig(model))}
${emitBonusPickMarkup(resolveBonusPickConfig(model))}
${emitWheelBonusMarkup(resolveWheelBonusConfig(model))}
${emitWeightedWheelSegmentsMarkup(resolveWeightedWheelSegmentsConfig(model))}
${/* Wave H13 — Path-Aware Multiplier HUD container (chips appear inside cells). */ ''}
${emitPathAwareMultiplierMarkup(resolvePathAwareMultiplierConfig(model))}
${/* Wave LEGO-EV — all-ways + bidirectional evaluator overlay containers. */ ''}
${emitAllWaysEvalMarkup(resolveAllWaysEvalConfig(model))}
${emitBidirectionalWaysEvalMarkup(resolveBidirectionalWaysEvalConfig(model))}
${/* Wave LEGO-M (6 base/FS variants) + LEGO-H/FS/W (8 GDD-driven variants) — all empty unless GDD enables. */ ''}
${emitPerFsSpinMultiplierMarkup(resolvePerFsSpinMultiplierConfig(model))}
${emitRetriggerMultiplierBumpMarkup(resolveRetriggerMultiplierBumpConfig(model))}
${emitTotalMultiplierChipMarkup(resolveTotalMultiplierChipConfig(model))}
${emitHoldAndWinFrameMultiplierMarkup(resolveHoldAndWinFrameMultiplierConfig(model))}
${emitHoldAndWinLockedOrbMultiplierMarkup(resolveHoldAndWinLockedOrbMultiplierConfig(model))}
${emitHoldAndWinRoomJackpotMultiplierMarkup(resolveHoldAndWinRoomJackpotMultiplierConfig(model))}
${emitTumbleGrowingFsMultiplierMarkup(resolveTumbleGrowingFsMultiplierConfig(model))}
${emitFsExpansionWildsMarkup(resolveFsExpansionWildsConfig(model))}
${emitProgressiveFsRetriggerLadderMarkup(resolveProgressiveFsRetriggerLadderConfig(model))}
${emitExpandingWildMultiplierMarkup(resolveExpandingWildMultiplierConfig(model))}
${emitMegaWildClusterMarkup(resolveMegaWildClusterConfig(model))}
${emitRandomLightningMultiplierMarkup(resolveRandomLightningMultiplierConfig(model))}
${emitWalkingWildStepperMarkup(resolveWalkingWildStepperConfig(model))}
${emitDynamicWaysEngineMarkup(resolveDynamicWaysEngineConfig(model))}
${emitInfinityReelsEngineMarkup(resolveInfinityReelsEngineConfig(model))}
${emitSymbolSplitRevealMarkup(resolveSymbolSplitRevealConfig(model))}
${emitSuperSymbolUpgradeMarkup(resolveSuperSymbolUpgradeConfig(model))}
${emitJackpotRoomRevealMarkup(resolveJackpotRoomRevealConfig(model))}
${emitJackpotPickerMarkup(resolveJackpotPickerConfig(model))}
${emitGambleMarkup(resolveGambleConfig(model))}
${/* Wave U6 — secondary gamble overlay (full-screen modal). */ ''}
${emitGambleSecondaryMarkup(resolveGambleSecondaryConfig(model))}
${/* Wave U8 — balance HUD markup is now parented INSIDE the hub
    (see .hub block above). No free-floating emit here — keeping the
    block import for CSS + runtime, just not its markup. */ ''}
${/* Wave U9 — session history button + panel. */ ''}
${emitHistoryLogMarkup(resolveHistoryLogConfig(model))}
${/* Wave U11 — turbo button (in sideHud near SPIN). */ ''}
${emitTurboModeMarkup(resolveTurboModeConfig(model))}
${/* Wave U13 — settings gear button + modal. */ ''}
${emitSettingsPanelMarkup(resolveSettingsPanelConfig(model))}
${/* Wave U10 — paytable button (in hub) + modal backdrop. */ ''}
${emitPaytableMarkup(resolvePaytableConfig(model))}
${emitSymbolInfoPopoverMarkup(resolveSymbolInfoPopoverConfig(model))}
${/* Wave B64 — symbolUpgrade has no markup (decorates existing .cell DOM). */ ''}
${emitSymbolUpgradeMarkup(resolveSymbolUpgradeConfig(model))}
${/* W56 — aux multiplier reel mount slot (block runtime ensure-mounts here when enabled). */ ''}
<div id="stormMultiplierReelMount" aria-hidden="true"></div>
${/* Wave H4 — Color-blind toggle chip (top-right by default). */ ''}
${emitColorblindPatternsMarkup(resolveColorblindPatternsConfig(model))}
${/* Wave H6 — Bonus Climax overlay host (hidden until bonus event fires). */ ''}
${emitBonusClimaxRevealMarkup(resolveBonusClimaxRevealConfig(model))}
${/* Wave H7-H10 — runtime-only decorators / ambient layer host markup. */ ''}
${emitCellLevelUpgradeMarkup(resolveCellLevelUpgradeConfig(model))}
${emitCellOverflowCounterMarkup(resolveCellOverflowCounterConfig(model))}
${emitAmbientBackgroundWheelMarkup(resolveAmbientBackgroundWheelConfig(model))}
${emitDualRoleScatterMarkup(resolveDualRoleScatterConfig(model))}
${/* Wave H11-H15 — markup hosts (mega overlay built at runtime, others static). */ ''}
${emitMegaSymbolMarkup(resolveMegaSymbolConfig(model))}
${emitWildCollectionTrailMarkup(resolveWildCollectionTrailConfig(model))}
${emitJackpotLadderRoomsMarkup(resolveJackpotLadderRoomsConfig(model))}
${emitSuperchargedFsMarkup(resolveSuperchargedFsConfig(model))}
${emitCascadeBoosterMarkup(resolveCascadeBoosterConfig(model))}
${/* Wave H16-H20 — markup hosts (most decorate-at-runtime; respinCharge has static meter). */ ''}
${emitSplitSymbolMarkup(resolveSplitSymbolConfig(model))}
${emitNudgeReelMarkup(resolveNudgeReelConfig(model))}
${emitRespinChargeMarkup(resolveRespinChargeConfig(model))}
${emitSyncReelsMarkup(resolveSyncReelsConfig(model))}
${emitWinMultiplierBadgeMarkup(resolveWinMultiplierBadgeConfig(model))}
${/* Wave H21-H25 — markup hosts (most decorate-at-runtime; cascadePathDraw + streakBonus have static elements). */ ''}
${emitWinLineFlashMarkup(resolveWinLineFlashConfig(model))}
${emitNearMissTeaseMarkup(resolveNearMissTeaseConfig(model))}
${emitReelLockHoldMarkup(resolveReelLockHoldConfig(model))}
${emitCascadePathDrawMarkup(resolveCascadePathDrawConfig(model))}
${emitStreakBonusMarkup(resolveStreakBonusConfig(model))}
${/* Wave H27 + H30 — markup hosts (Dimmer decorates runtime; Escalator has static badge). */ ''}
${emitPaylineDimmerMarkup(resolvePaylineDimmerConfig(model))}
${emitRetriggerEscalatorMarkup(resolveRetriggerEscalatorConfig(model))}
${emitRetriggerMeterMarkup(resolveRetriggerMeterConfig(model))}
${/* Wave P8 — hot-reload indicator host (hidden until connected). */ ''}
${emitHotReloadMarkup(resolveHotReloadConfig(model))}

<script>
  /* ── HookBus FIRST — every feature block registers on it. ────────── */
  ${emitHookBusRuntime(resolveHookBusConfig(model))}

  /* FIX-8 M6 (2026-06-19) — sessionId monotonic token.
   * Industry baseline (12+ regulator checkpoints): every spin needs an
   * id that is STRICTLY increasing across all tabs of the same session.
   * Multi-tab use case → spin orphan if id collisions occur. Solution:
   * a monotonic counter seeded from sessionStorage + per-spin atomic
   * increment. Idempotent re-bake guard. */
  if (typeof window !== 'undefined' && typeof window.__slotSessionId === 'undefined') {
    try {
      var __SS_KEY = '__slotSessionMono';
      var __SS_initial = 0;
      try {
        var raw = sessionStorage.getItem(__SS_KEY);
        if (raw) __SS_initial = parseInt(raw, 10) || 0;
      } catch (_) {}
      window.__slotSessionId = function nextSessionId() {
        var prev = Number.isFinite(window.__slotSessionId._last) ? window.__slotSessionId._last : __SS_initial;
        var next = prev + 1;
        window.__slotSessionId._last = next;
        try { sessionStorage.setItem(__SS_KEY, String(next)); } catch (_) {}
        return next;
      };
      window.__slotSessionId._last = __SS_initial;
    } catch (e) {
      /* Defensive fallback: simple in-memory counter if storage blocked. */
      var __ssfallback = 0;
      window.__slotSessionId = function() { return ++__ssfallback; };
    }
  }

  /* FIX-8 H4 (2026-06-19) — Shared aria-live announcer helper.
   * Any block can call window.__SR_ANNOUNCE__(message, { assertive: false })
   * to push text into the shared SR announce region. Default 'polite'
   * goes to #srAnnouncer; assertive (interrupting) goes to
   * #srAnnouncerAssertive. Empty/null clears. Sequential calls flush
   * via 50ms requeue so SRs re-read identical text (clear → set).
   * Idempotent re-bake guard. */
  if (typeof window !== 'undefined' && !window.__SR_ANNOUNCE__) {
    window.__SR_ANNOUNCE__ = function srAnnounce(msg, opts) {
      try {
        const id = (opts && opts.assertive) ? 'srAnnouncerAssertive' : 'srAnnouncer';
        const el = document.getElementById(id);
        if (!el) return false;
        const s = (msg == null) ? '' : String(msg).slice(0, 240);
        /* Clear-then-set so identical sequential text is re-announced. */
        el.textContent = '';
        if (s) setTimeout(function(){ el.textContent = s; }, 50);
        return true;
      } catch (e) {
        try { if (typeof console !== 'undefined' && console.warn) console.warn('[srAnnounce]', e); } catch (_) {}
        return false;
      }
    };
  }

  /* UQ-DEEP-E audit fix BUILD-2: safeJSONInScript guards against
   * adversarial values with end-script-tag, html-comment-open,
   * line-separator U+2028/U+2029, or CDATA-open. POOL ids come from
   * parser (controlled) but defense-in-depth costs nothing. SHAPE
   * includes topology eval kind which could carry adversarial GDD
   * prose. (Backticks intentionally absent from this comment — the
   * surrounding string is a JS template literal that would terminate
   * on any raw backtick character.) */
  const POOL = ${safeJSONInScript(pool.map(s => s.id))};
  const SHAPE = ${safeJSONInScript(shape)};
  const FREESPINS = ${safeJSONInScript(model.freeSpins || { enabled: false })};
  /* Wave AL-2 (4-GDD audit) — expose parser-detected feature kinds + name
   * + symbol tier counts as a window-side QA hook so external auditors
   * (cortex-eyes, regulator probes, dev tools) can verify parser → UI
   * parity without scraping inline scripts. Safe for production: read-only
   * snapshot of the build-time model, no runtime mutation. */
  const __MODEL_FEATURES__ = ${safeJSONInScript((model.features || []).map(f => ({ kind: f.kind, label: f.label })))};
  const __MODEL_NAME__ = ${safeJSONInScript(model.name || 'Untitled Slot')};
  const __MODEL_SYMBOL_COUNTS__ = ${safeJSONInScript({
    hp: (model.symbols && model.symbols.high) ? model.symbols.high.length : 0,
    mp: (model.symbols && model.symbols.mid)  ? model.symbols.mid.length  : 0,
    lp: (model.symbols && model.symbols.low)  ? model.symbols.low.length  : 0,
    sp: (model.symbols && model.symbols.specials) ? model.symbols.specials.length : 0,
  })};
  if (typeof window !== 'undefined') {
    window.__SLOT_MODEL_FEATURES__ = __MODEL_FEATURES__;
    window.__SLOT_MODEL_NAME__     = __MODEL_NAME__;
    window.__SLOT_MODEL_SYMBOLS__  = __MODEL_SYMBOL_COUNTS__;
  }
  /* Game topology hint — selects payout evaluator: 'line' (default),
     'cluster', 'ways', 'pay_anywhere'. Read by applyWinHighlight dispatch. */
  const GAME_EVAL_KIND = ${safeJSONInScript((model.topology && model.topology.evaluation) || 'line')};
  if (typeof window !== "undefined") window.GAME_EVAL_KIND = GAME_EVAL_KIND;
  /* Per-symbol registry — drives win-cycle event generation. See
     SYMBOL_REGISTRY construction in buildSlotHTML.mjs for the source. */
  const SYMBOL_REGISTRY = ${safeJSONInScript(SYMBOL_REGISTRY)};
  /* Payline pool — int[reels] per line, value = rowIdx at reel i.
     Empty for cluster-pays grids (cluster, megaclusters, hex, etc).
     When non-empty, the win cycle runs in line-pays mode (per-line
     event). When empty, it falls back to per-symbol cluster mode. */
  const PAYLINE_POOL = ${safeJSONInScript(PAYLINE_POOL)};
  const REELS = SHAPE.reels;
  const ROWS  = SHAPE.rows;

  const grid = document.getElementById("gridHost");
  const frame = document.getElementById("frameHost");

  /* Wave T-slim Phase 2 — symAt / makeCell / cellSize / UNIFORM_REEL_KINDS
     are extracted to src/runtime/gridRenderer.mjs. They MUST be emitted
     here, BEFORE the reel engine runtime, because the engine block
     references makeCell / symAt / UNIFORM_REEL_KINDS at its execution
     time. */
  ${emitGridHelpersRuntime(model)}

  ${emitReelEngineRuntime(resolveReelEngineHotConfig(model))}

  /* Wave J2b — hex real reel engine. MUST emit AFTER reelEngine so the
     rectangular dispatcher in runOneBaseSpin() can probe
     window.__SLOT_HEX_RUNSPIN__ once shape === 'hexagonal'. AFTER
     grid dispatch as well — renderHex() calls __SLOT_HEX_BUILD__()
     defensively. Hex engine self-disables when shape !== 'hexagonal'
     so the cost on rectangular builds is one stub assignment. */
  ${emitHexReelEngineRuntime(resolveHexReelEngineConfig(model))}

  /* Wave J3 — per-kind SVG spin engines. Each block self-disables
     when its kind doesn't match SHAPE.kind and registers an entry
     in window.__SLOT_KIND_RUNSPIN__ otherwise. Dispatcher in
     reelEngine.runOneBaseSpin reads the registry. Order does not
     matter between J3 blocks — each owns its own kind exclusively. */
  ${emitWheelSpinEngineRuntime(resolveWheelSpinEngineConfig(model))}
  ${emitCrashSpinEngineRuntime(resolveCrashSpinEngineConfig(model))}
  ${emitPlinkoSpinEngineRuntime(resolvePlinkoSpinEngineConfig(model))}
  ${emitSlingoSpinEngineRuntime(resolveSlingoSpinEngineConfig(model))}

  /* Wave LEGO-ENG + FS3.3 (FIX-2, 2026-06-19) — pyramid grid runtime
     (fall-down topology · self-disabled when shape.kind !== 'pyramid'),
     hex-cluster BFS scan runtime (self-disabled when not hex+cluster),
     reel-height adapter runtime (publishes window.growReelHeight /
     shrinkReelHeight · cellStep + targetY recalc inside _growOne to
     satisfy FS3.3 F3 deferred QA · self-disabled when adapter.enabled
     !== true). All three were dead code prior to FIX-2 because no
     import existed in the orchestrator. */
  ${emitPyramidGridEngineRuntime(resolvePyramidGridEngineConfig(model))}
  ${emitHexClusterEngineRuntime(resolveHexClusterEngineConfig(model))}
  ${emitReelHeightAdapterRuntime(resolveReelHeightAdapterConfig(model))}

  /* Reel spin engine cadence + anticipation — see src/blocks/reelEngine.mjs
     + src/blocks/spinTempo.mjs + src/blocks/anticipation.mjs JSDoc for the
     per-reel timing budget and rotation algorithm. */
  ${emitSpinTempoRuntime(resolveSpinTempoConfig(model))}

  ${emitAnticipationRuntime(resolveAnticipationConfig(model))}

  /* User-driven SPIN button click. During FS_* phases the FSM / placard CTA
     owns the input. Wave V3 — spinControl morphs the button between SPIN /
     STOP_PRE / STOP_POST / SKIP_*; this handler only fires a fresh spin
     when data-state is SPIN (otherwise spinControl emits its own intent).
     UQ-DEEP-H fix (Boki 2026-06-23): handler is attached HERE but the
     FSM declaration runs ~11000 lines later in the same script. Until
     that line runs, FSM is in Temporal Dead Zone — if the player
     clicks spin BEFORE late-bundle blocks finish initializing, JS
     throws "Cannot access FSM before initialization". Route via
     window.FSM (set right after the declaration) which is undefined
     during TDZ, not a throw.
     (No backticks in this comment — surrounding string is a template
     literal that would terminate on any raw backtick.) */
  const spinButton = document.getElementById("spinBtn");
  if (spinButton) {
    spinButton.addEventListener("click", () => {
      const _fsm = (typeof window !== 'undefined') ? window.FSM : null;
      if (!_fsm || _fsm.phase !== "BASE") return;
      const dataState = spinButton.getAttribute("data-state");
      if (dataState && dataState !== "SPIN") return;
      runOneBaseSpin();
    });
  }

  ${emitTriggerCountingRuntime(resolveTriggerCountingConfig(model))}

  /* Placeholder win-highlight clear — pure DOM strip-down of .is-win /
     .cell--winsym + .has-winselection grid flag + payline overlay reset.
     Called at the start of every new spin and at FS phase boundaries. */
  function clearWinHighlight() {
    grid.classList.remove("has-winselection");
    grid.classList.remove("is-winsym-cycling");
    grid.querySelectorAll(".cell.is-win, text.is-win").forEach(c => c.classList.remove("is-win"));
    grid.querySelectorAll(".cell--winsym, text.cell--winsym").forEach(c => c.classList.remove("cell--winsym"));
    if (typeof clearPaylineOverlay === 'function') clearPaylineOverlay();
  }
  /* detectWinCombos / paylineOverlay / winPresentation runtime — see the
     corresponding blocks under src/blocks/ for the algorithmic contract
     (per-symbol HP/MP/LP event generation, wild substitution, scatter
     exclusion, MAX_COMBOS cap). */
  ${emitDetectWinCombosRuntime(resolveWinPresentationConfig(model))}
  ${emitPaylineOverlayRuntime()}
  ${emitWinPresentationRuntime(resolveWinPresentationConfig(model))}

  ${emitScatterCelebrationRuntime(model)}

  /* Wave K — Pay-Anywhere suite. Order matters:
       1. multiplierOrb (annotates orbs + provides accumulateOrbMultiplier)
       2. payAnywhereEval (detectPayAnywhereWins consumes annotated grid)
       3. tumble (runTumbleChain consumes detect + orb accumulation)
       4. bonusBuy / anteBet (UI bindings, last) */
  ${emitMultiplierOrbRuntime(resolveMultiplierOrbConfig(model))}
  ${emitPayAnywhereEvalRuntime(resolvePayAnywhereEvalConfig(model))}
  ${emitTumbleRuntime(resolveTumbleConfig(model))}
  ${resolveBonusBuyMenuConfig(model).enabled ? '' : emitBonusBuyRuntime(resolveBonusBuyConfig(model))}
  ${emitBonusBuyMenuRuntime(resolveBonusBuyMenuConfig(model))}
  ${/* Wave H11 — Deterministic plant runtime monkey-patches #bonusBuyBtn
     * click at capture phase to open the tier picker BEFORE the original
     * Buy handler fires. Plants cells on onSpinResult. */ ''}
  ${emitBonusBuyDeterministicRuntime(resolveBonusBuyDeterministicConfig(model))}
  ${resolveAnteBetLadderConfig(model).enabled ? '' : emitAnteBetRuntime(resolveAnteBetConfig(model))}
  ${emitAnteBetLadderRuntime(resolveAnteBetLadderConfig(model))}
  ${/* Wave LEGO-RANDOM (B-3) — in-spin random runtime. */ ''}
  ${emitMysteryPrizeBoxRuntime(resolveMysteryPrizeBoxConfig(model))}
  ${emitRandomWildBurstRuntime(resolveRandomWildBurstConfig(model))}
  ${/* Wave LEGO-COLLECT (B-4) — runtime order: collect → meter → reveal
       (downstream subs first; emit chain coinCollect → cumulativeMeter
       → collectRevealOverlay). */ ''}
  ${emitCoinCollectRuntime(resolveCoinCollectConfig(model))}
  ${emitCumulativeMeterRuntime(resolveCumulativeMeterConfig(model))}
  ${emitCollectRevealOverlayRuntime(resolveCollectRevealOverlayConfig(model))}
  ${/* Wave LEGO-VOLATILITY (B-6) — pre-spin player choice runtime. */ ''}
  ${emitVolatilitySelectorRuntime(resolveVolatilitySelectorConfig(model))}
  ${/* Wave LEGO-REPLAY (B-2) — spin history capture before bar wires. */ ''}
  ${emitSpinHistoryReplayRuntime(resolveSpinHistoryReplayConfig(model))}
  ${emitReplayControlBarRuntime(resolveReplayControlBarConfig(model))}
  ${/* Wave LEGO-SOCIAL (B-5) — leaderboard + share. */ ''}
  ${emitLeaderboardChipRuntime(resolveLeaderboardChipConfig(model))}
  ${emitShareReplayRuntime(resolveShareReplayConfig(model))}
  ${/* Wave LEGO-SIDEBET (B-7) — insurance + prize boost. */ ''}
  ${emitInsuranceBetRuntime(resolveInsuranceBetConfig(model))}
  ${emitPrizeBoostBetRuntime(resolvePrizeBoostBetConfig(model))}
  ${/* Wave LEGO-THEME (B-8) — themePicker first (own theme), then
       paletteRoulette (depends on themePicker for re-sync), then
       ambientBgVariants (depends on themePicker for class re-apply). */ ''}
  ${emitThemePickerRuntime(resolveThemePickerConfig(model))}
  ${emitPaletteRouletteRuntime(resolvePaletteRouletteConfig(model))}
  ${emitAmbientBgVariantsRuntime(resolveAmbientBgVariantsConfig(model))}
  ${/* Wave LEGO-PROG (DEF1) — playerXp emit → sessionLevelMeter render
       → achievementToast popup. Order matters for correct hydration. */ ''}
  ${emitPlayerXpRuntime(resolvePlayerXpConfig(model))}
  ${emitSessionLevelMeterRuntime(resolveSessionLevelMeterConfig(model))}
  ${emitAchievementToastRuntime(resolveAchievementToastConfig(model))}

  /* Wave L–P — 16 feature kinds runtime (no-op stubs when disabled).
     Order: wilds first (modify the grid), then evaluators (read modified
     grid), then round-control (consume eval results), then mini-games
     (overlay UIs, independent triggers). */
  /* RENDER-INTEG-A (2026-06-23) — GDD math/compliance manifest. Emits
     window.__GDD_* constants for external audit + downstream blocks. */
  ${emitGddRuntimeMeta(resolveGddRuntimeMetaConfig(model))}
  ${emitStickyWildRuntime(resolveStickyWildConfig(model))}
  ${emitExpandingWildRuntime(resolveExpandingWildConfig(model))}
  ${emitWalkingWildRuntime(resolveWalkingWildConfig(model))}
  ${emitWildReelRuntime(resolveWildReelConfig(model))}
  ${emitMysterySymbolRuntime(resolveMysterySymbolConfig(model))}
  ${emitSuperSymbolRuntime(resolveSuperSymbolConfig(model))}
  ${emitClusterPaysEvalRuntime(resolveClusterPaysEvalConfig(model))}
  ${emitWaysEvalRuntime(resolveWaysEvalConfig(model))}
  /* Wave LEGO-EV — all-ways + bidirectional ways evaluators. */
  ${emitAllWaysEvalRuntime(resolveAllWaysEvalConfig(model))}
  ${emitBidirectionalWaysEvalRuntime(resolveBidirectionalWaysEvalConfig(model))}
  ${/* Wave H13 — Path-Aware Multiplier runtime monkey-patches
     * window.detectWaysWins AFTER waysEval runtime emits it. Pure
     * observer — adds pathMultiplier/pathMultiplierLabel to each event,
     * paints chips, aggregates additive bonus on postSpin. */ ''}
  ${emitPathAwareMultiplierRuntime(resolvePathAwareMultiplierConfig(model))}
  ${emitPersistentMultiplierRuntime(resolvePersistentMultiplierConfig(model))}
  /* Wave LEGO-M — 6 self-contained multiplier variant runtimes. */
  ${emitPerFsSpinMultiplierRuntime(resolvePerFsSpinMultiplierConfig(model))}
  ${emitMysterySymbolMultiplierRuntime(resolveMysterySymbolMultiplierConfig(model))}
  ${emitWildCollisionMultiplierRuntime(resolveWildCollisionMultiplierConfig(model))}
  ${emitRetriggerMultiplierBumpRuntime(resolveRetriggerMultiplierBumpConfig(model))}
  ${emitClusterSizeMultiplierRuntime(resolveClusterSizeMultiplierConfig(model))}
  ${emitTotalMultiplierChipRuntime(resolveTotalMultiplierChipConfig(model))}
  /* Wave LEGO-H/FS/W — 8 GDD-driven variant runtimes. */
  ${emitHoldAndWinFrameMultiplierRuntime(resolveHoldAndWinFrameMultiplierConfig(model))}
  ${emitHoldAndWinLockedOrbMultiplierRuntime(resolveHoldAndWinLockedOrbMultiplierConfig(model))}
  ${emitHoldAndWinRoomJackpotMultiplierRuntime(resolveHoldAndWinRoomJackpotMultiplierConfig(model))}
  ${emitTumbleGrowingFsMultiplierRuntime(resolveTumbleGrowingFsMultiplierConfig(model))}
  ${emitFsExpansionWildsRuntime(resolveFsExpansionWildsConfig(model))}
  ${emitProgressiveFsRetriggerLadderRuntime(resolveProgressiveFsRetriggerLadderConfig(model))}
  ${emitExpandingWildMultiplierRuntime(resolveExpandingWildMultiplierConfig(model))}
  ${emitMegaWildClusterRuntime(resolveMegaWildClusterConfig(model))}
  /* Wave LEGO-L — random spin-wide multiplier strike (vendor-neutral). */
  ${emitRandomLightningMultiplierRuntime(resolveRandomLightningMultiplierConfig(model))}
  /* Wave LEGO-WW — walking wild stepper with progressive ×N (vendor-neutral). */
  ${emitWalkingWildStepperRuntime(resolveWalkingWildStepperConfig(model))}
  /* Wave LEGO-WAYS — variable rows per reel dynamic ways engine (vendor-neutral). */
  ${emitDynamicWaysEngineRuntime(resolveDynamicWaysEngineConfig(model))}
  /* Wave LEGO-INF — infinity reels engine, grid grows on win + ×N bump (vendor-neutral). */
  ${emitInfinityReelsEngineRuntime(resolveInfinityReelsEngineConfig(model))}
  /* Wave LEGO-SS — super symbol family (split reveal + tier upgrade). */
  ${emitSymbolSplitRevealRuntime(resolveSymbolSplitRevealConfig(model))}
  ${emitSuperSymbolUpgradeRuntime(resolveSuperSymbolUpgradeConfig(model))}
  /* Wave LEGO-JR — jackpot room family (full-screen ladder + pick grid). */
  ${emitJackpotRoomRevealRuntime(resolveJackpotRoomRevealConfig(model))}
  ${emitJackpotPickerRuntime(resolveJackpotPickerConfig(model))}
  ${emitProgressiveFreeSpinsRuntime(resolveProgressiveFreeSpinsConfig(model))}
  ${/* audio runtime skipped — ADB tok, ne GDD */ ''}
  ${emitUiToastRuntime(resolveUiToastConfig(model))}
  ${/* Wave H5 — Big-Win Tier ladder runtime (5-tier vendor-neutral). */ ''}
  ${emitBigWinTierRuntime(resolveBigWinTierConfig(model))}
  ${/* Wave V1+V2 — spin-control runtime (emit-only blocks; engine listens). */ ''}
  ${/* Wave V3 supersede: V1/V2 runtimes OFF when spinControl is the active CTA. */ ''}
  ${resolveSpinControlConfig(model).enabled ? '' : emitSlamStopRuntime(resolveSlamStopConfig(model))}
  ${resolveSpinControlConfig(model).enabled ? '' : emitForceSkipRuntime(resolveForceSkipConfig(model))}
  ${emitUniversalForcePanelRuntime(resolveUniversalForcePanelConfig(model), model)}
  ${emitGenericFeatureBannerRuntime(resolveGenericFeatureBannerConfig(model))}
  ${/* Wave V3 — unified SPIN / STOP / SKIP CTA runtime (state machine owns #spinBtn). */ ''}
  ${emitSpinControlRuntime(resolveSpinControlConfig(model))}
  ${/* Wave U4 — autoplay session runtime. */ ''}
  ${emitAutoplayRuntime(resolveAutoplayConfig(model))}
  ${/* Wave U5 — bet selector runtime. Publishes window.__SLOT_BET__ +
      onBetChanged BEFORE autoplay/bonusBuy/anteBet runtimes consume it
      via emitBlock order; placement here keeps autoplay's onSpinResult
      read of __SLOT_BET__ deterministic. */ ''}
  ${emitBetSelectorRuntime(resolveBetSelectorConfig(model))}
  ${/* Wave U6 — secondary gamble runtime (Card + Ladder branches). */ ''}
  ${emitGambleSecondaryRuntime(resolveGambleSecondaryConfig(model))}
  ${/* Wave U8 — balance HUD runtime (owns __SLOT_BALANCE__ + onBalanceChanged). */ ''}
  ${emitBalanceHudRuntime(resolveBalanceHudConfig(model))}
  ${/* Wave H12 — Net Loss Indicator runtime: subscribes to onBalanceChanged
     * AFTER balanceHud is wired (so handler chain captures all events). */ ''}
  ${emitNetLossIndicatorRuntime(resolveNetLossIndicatorConfig(model))}
  ${/* Wave H2 — Reality Check runtime listens to preSpin / onAutoplayTick
     * / onBalanceChanged / onNetThresholdCrossed. Emits its own
     * lifecycle events. */ ''}
  ${emitRealityCheckRuntime(resolveRealityCheckConfig(model))}
  ${/* Wave W60 — Regulator disclosure modal runtime: subscribes to ALL
     * onAutoplayDisclosureRequired / onRtpDisclosureRequired / on*Required
     * / on*Enforced / on*Prohibited events from W58.J-* gates and renders
     * one accessible queue-aware modal. Sets ACK window flags after
     * acknowledgement so consumers (autoplay.autoplayStart guards) resume. */ ''}
  ${emitRegulatorDisclosureModalRuntime(resolveRegulatorDisclosureModalConfig(model))}
  ${/* Wave H3 — Session Timeout runtime: subscribes to preSpin / autoplay /
     * realityCheck pause-resume. MUST follow realityCheck so realityCheck's
     * emits already exist when sessionTimeout registers its listeners. */ ''}
  ${emitSessionTimeoutRuntime(resolveSessionTimeoutConfig(model))}
  ${emitWinRollupRuntime(resolveWinRollupConfig(model))}
  ${/* Wave U9 — session history runtime (ring buffer + panel). */ ''}
  ${emitHistoryLogRuntime(resolveHistoryLogConfig(model))}
  ${/* Wave U11 — turbo mode runtime (owns __SLOT_TURBO_ACTIVE__ + onTurboToggle). */ ''}
  ${emitTurboModeRuntime(resolveTurboModeConfig(model))}
  ${/* Wave U13 — settings panel runtime (gear modal + preferences). */ ''}
  ${emitSettingsPanelRuntime(resolveSettingsPanelConfig(model))}
  ${/* Wave A10 — haptic feedback runtime. Reads window.__SLOT_HAPTIC_ENABLED__
     * set by settingsPanel; fires on bigWin tier ≥ floor and FS trigger. */ ''}
  ${emitHapticFeedbackRuntime(resolveHapticFeedbackConfig(model))}
  ${/* Wave A5 — RTL layout runtime (auto-detect from __SLOT_LOCALE__,
     * flip html[dir=rtl] / 'ltr', emit onDirChanged event). */ ''}
  ${emitRtlLayoutRuntime(resolveRtlLayoutConfig(model))}
  ${/* Wave H4 — Color-blind pattern runtime (chip + decorate engine).
     * Listens postSpin / onTumbleStep / onFsSpinResult to apply per-tier
     * data-cb-tier attribute on every cell. Pure presentation layer. */ ''}
  ${emitColorblindPatternsRuntime(resolveColorblindPatternsConfig(model))}
  ${/* Wave H6 — Bonus Climax Reveal runtime (auto-wires onFsTrigger /
     * onWheelSegmentChosen / onBonusBuyTierSelected / onCreditBucketRespinStart /
     * onDailyJackpotAward → full-screen placard, dismissable via onSkipRequested
     * phase=bonusClimax|any). Sole owner of onBonusClimax{Start,End}. */ ''}
  ${emitBonusClimaxRevealRuntime(resolveBonusClimaxRevealConfig(model))}
  ${/* Wave H7 — Cell Level Upgrade runtime (per-cell numeric meter; sole
     * owner of onCellLevelUp + onCellLevelReset). */ ''}
  ${emitCellLevelUpgradeRuntime(resolveCellLevelUpgradeConfig(model))}
  ${/* Wave H8 — Cell Overflow Counter runtime (stack-overflow badge; sole
     * owner of onCellOverflow). */ ''}
  ${emitCellOverflowCounterRuntime(resolveCellOverflowCounterConfig(model))}
  ${/* Wave H9 — Ambient Background Wheel runtime (preSpin spin-up + postSpin
     * slow-down + bigWin/FS pulse; sole owner of onAmbientPhase). */ ''}
  ${emitAmbientBackgroundWheelRuntime(resolveAmbientBackgroundWheelConfig(model))}
  ${/* Wave H10 — Dual-Role Scatter runtime (postSpin / onTumbleStep / onFsTrigger
     * decorator; sole owner of onDualRoleActivated). */ ''}
  ${emitDualRoleScatterRuntime(resolveDualRoleScatterConfig(model))}
  ${/* Wave H11-H15 — Mega Symbol overlay / Wild Trail meter / Jackpot Ladder
     * Rooms / Supercharged FS multiplier badge / Cascade Booster chip. */ ''}
  ${emitMegaSymbolRuntime(resolveMegaSymbolConfig(model))}
  ${emitWildCollectionTrailRuntime(resolveWildCollectionTrailConfig(model))}
  ${emitJackpotLadderRoomsRuntime(resolveJackpotLadderRoomsConfig(model))}
  ${emitSuperchargedFsRuntime(resolveSuperchargedFsConfig(model))}
  ${emitCascadeBoosterRuntime(resolveCascadeBoosterConfig(model))}
  ${/* Wave H16-H20 — Split Symbol / Nudge Reel / Respin Charge / Sync Reels / Win Mult Badge */ ''}
  ${emitSplitSymbolRuntime(resolveSplitSymbolConfig(model))}
  ${emitNudgeReelRuntime(resolveNudgeReelConfig(model))}
  ${emitRespinChargeRuntime(resolveRespinChargeConfig(model))}
  ${emitSyncReelsRuntime(resolveSyncReelsConfig(model))}
  ${emitWinMultiplierBadgeRuntime(resolveWinMultiplierBadgeConfig(model))}
  ${/* Wave H21-H25 — Win Line Flash / Near-Miss Tease / Reel Lock Hold / Cascade Path / Streak Bonus */ ''}
  ${emitWinLineFlashRuntime(resolveWinLineFlashConfig(model))}
  ${emitNearMissTeaseRuntime(resolveNearMissTeaseConfig(model))}
  ${emitReelLockHoldRuntime(resolveReelLockHoldConfig(model))}
  ${emitCascadePathDrawRuntime(resolveCascadePathDrawConfig(model))}
  ${emitStreakBonusRuntime(resolveStreakBonusConfig(model))}
  ${/* Wave H27 + H30 — Payline Dimmer + Retrigger Escalator */ ''}
  ${emitPaylineDimmerRuntime(resolvePaylineDimmerConfig(model))}
  ${emitRetriggerEscalatorRuntime(resolveRetriggerEscalatorConfig(model))}
  ${emitRetriggerMeterRuntime(resolveRetriggerMeterConfig(model))}
  ${/* Wave A8 — PWA installability runtime (blob-URL SW register +
     * beforeinstallprompt + appinstalled + iOS detection). */ ''}
  ${emitPwaInstallabilityRuntime(resolvePwaInstallabilityConfig({ ...model, gameName: model.name }))}
  ${/* Wave HX3+HX4 — i18n + currency runtime (10 packs, [data-i18n]
     * + [data-money] painters, onLocaleChanged listener). */ ''}
  ${emitI18nRuntime(resolveI18nConfig(model))}
  ${/* Wave U10 — paytable modal runtime (i-button show/hide + roster). */ ''}
  ${emitPaytableRuntime(resolvePaytableConfig(model), model)}
  ${emitSymbolInfoPopoverRuntime(resolveSymbolInfoPopoverConfig(model))}
  ${/* Wave B64 — symbolUpgrade runtime. Listens onTumbleStep AFTER tumble
       refill so freshly-dropped symbols get a chance to morph upward. */ ''}
  ${emitSymbolUpgradeRuntime(resolveSymbolUpgradeConfig(model))}
  ${/* W56 — aux multiplier reel runtime. Subscribes preSpin → start,
       onSpinResult → set target, postSpin → stop on target, onSlamStop
       → instant snap. Math-blind (consumes spinResult.stormMultiplierTarget
       set by engine; force chip flag override consumed once and cleared). */ ''}
  ${emitStormMultiplierReelRuntime(resolveStormMultiplierReelConfig(model))}
  ${/* D-17.1 — Pattern-Win detector + celebration. Opt-in per GDD via
       model.patternWin.enabled. Lifecycle: onSpinResult / onFsSpinResult
       → detect anchor stack + winning Wilds → emit onPatternWinTrigger
       + optional setMultMax(payX). postSpin → render celebration + emit
       onPatternWinPaid. Math-blind (engine-supplied patternWinPayX wins
       over cfg fallback). Force chip: window.patternWinForceAt(). */ ''}
  ${emitPatternWinRuntime(resolvePatternWinConfig(model))}
  ${/* D-17.2 — Big-Symbol render + UNIT-count gate. Opt-in per GDD via
       model.bigSymbolRender2x2.enabled. Lifecycle: onSpinResult / FS /
       Tumble → unmount previous + detect footprints (engine tag or
       symbol-kind match) → mount + emit onBigSymbolMounted per unit.
       Top-left of each footprint is the canonical UNIT cell so
       per-unit trigger counts work on small grids. Force chip:
       window.bigSymbolForceAt(symbol, geometry, reel, row). */ ''}
  ${emitBigSymbolRender2x2Runtime(resolveBigSymbolRender2x2Config(model))}
  ${/* D-17.3 — Linked-reels FS block. Opt-in per GDD via
       model.linkedReels.enabled (FS-gated by default). Lifecycle:
       onFsEnter / onFsStart → activate fuse + tag reels (emit
       onReelsLinked active=true). onSpinResult / onFsSpinResult →
       scan linked reels for target landings → emit onLinkUnits
       with discrete unit anchors (same row repeat or full block
       fill per cfg). onFsEnd → deactivate. Force chip:
       window.linkedReelsForceSymbol(symbol, sourceReelIdx, row). */ ''}
  ${emitLinkedReelsRuntime(resolveLinkedReelsConfig(model))}
  ${/* D-17.4 — Per-trigger volatility set lock. Opt-in per GDD via
       model.perTriggerVolatilitySet.enabled. Lifecycle:
       onHoldAndWinTrigger → consume payload.volatilityTier (or force
       flag) → normalize via tier whitelist + synonyms → lock + tag
       body[data-volatility-tier] → emit onVolatilitySetLocked.
       onHoldAndWinEnd / onFsEnd → expire + clear. Force chip:
       window.perTriggerVolatilitySetForce(tier). Math-blind by
       contract: engine owns the weighted draw, block only locks +
       exposes for presentation hooks. */ ''}
  ${emitPerTriggerVolatilitySetRuntime(resolvePerTriggerVolatilitySetConfig(model))}
  ${/* D-17.5 — Pot-tier Fireball symbol. Opt-in per GDD via
       model.potSymbolFireball.enabled. Lifecycle:
       onHoldAndWinTrigger → reset session state + unmount old tags.
       onSpinResult / onFsSpinResult → classify cells (engine __pot__
       tag OR prefix+tier OR bare tier match) → mount overlay + emit
       onPotSymbolLanded per pot. onHoldAndWinEnd → sum + emit
       onPotSymbolCollected with breakdown. Force chip:
       window.potSymbolFireballForce(tier, reel, row). */ ''}
  ${emitPotSymbolFireballRuntime(resolvePotSymbolFireballConfig(model))}
  ${/* D-17.6 — GRAND interruption-lock + handpay route. Opt-in per
       GDD via model.grandInterruptionLock.enabled. Lifecycle:
       onPotSymbolCollected / onHoldAndWinEnd / onFeaturePayout →
       read amount → if >= grandThresholdCredits → set body
       [data-grand-lock=true] + window.__SLOT_GRAND_LOCK_ACTIVE__ +
       emit onGrandLock + onHandpayRequested (when jurisdiction
       matches). Timer expires after celebrationDurationMs → emit
       onGrandReleased + clear flag. Force chip:
       window.grandInterruptionLockForce(award). */ ''}
  ${emitGrandInterruptionLockRuntime(resolveGrandInterruptionLockConfig(model))}
  ${/* D-17.7 — Simultaneous FS + H&W priority arbiter. Opt-in per
       GDD via model.simultaneousFsHoldAndWinPriority.enabled.
       Lifecycle: onHoldAndWinTrigger → primaryActive=true.
       onFsTriggerArmed / onFsEnter → if primaryActive, defer +
       emit deferred. onHoldAndWinEnd / onGrandReleased →
       primaryActive=false → if pending, resume + re-fire onFsEnter
       + emit resumed. Force chip:
       window.simultaneousFsHoldAndWinPriorityForce(). */ ''}
  ${emitSimultaneousFsHoldAndWinPriorityRuntime(resolveSimultaneousFsHoldAndWinPriorityConfig(model))}
  ${/* D-17.8 — Credit award SSOT conversion. Opt-in per GDD via
       model.creditAwardConversion.enabled. Lifecycle: boot →
       set body[data-award-unit] + emit initial onCoinValueChanged.
       onBetChanged → recompute coin_value + emit onCoinValueChanged.
       Exposes: window.creditAwardConvert(credits, payType, ctx) ·
       window.creditAwardCoinValue() · window.creditAwardSetBet(bet)
       · window.creditAwardPayTypeMode(payType). */ ''}
  ${emitCreditAwardConversionRuntime(resolveCreditAwardConversionConfig(model))}
  ${/* D-18 — GDD Reality Check. Opt-in per GDD via
       model.gddRealityCheck.enabled. Lifecycle: boot → instrument
       HookBus.emit (wraps existing) to collect every emitted event
       name. After cfg.sampleWindowMs → compute reality report
       (verified vs dead vs spurious) + emit onGddRealityReport.
       Exposes: window.gddRealityCheckReport() · window
       .gddRealityCheckForceReport(). Math-blind by contract. */ ''}
  ${emitGddRealityCheckRuntime(resolveGddRealityCheckConfig(model))}
  ${/* W58.J-DE — GlüStV §11(2) spin pace floor + §6e session state clear.
       Boot-time IIFE; 0-byte side effect when jurisdiction is not DE. */ ''}
  ${emitGermanyComplianceGateRuntime(resolveGermanyComplianceGateConfig(model))}
  ${/* W58.J-NL — Wet KSA §31 Cruks check + §33 cool-off floor.
       Boot-time IIFE; 0-byte side effect when jurisdiction is not NL. */ ''}
  ${emitNetherlandsComplianceGateRuntime(resolveNetherlandsComplianceGateConfig(model))}
  ${/* W58.J-EU — EU AI Act Art.5(1)(a) subliminal + Art.5(1)(b) DDA +
       Art.50(1) transparency. Boot-time IIFE; 0-byte when non-EU. */ ''}
  ${emitEuAiActComplianceGateRuntime(resolveEuAiActComplianceGateConfig(model))}
  ${/* W58.J-FR — ANJ no-autoplay + no-turbo + min-spin + FRJ register
       check. Boot-time IIFE; 0-byte when jurisdiction is not FR. */ ''}
  ${emitFranceComplianceGateRuntime(resolveFranceComplianceGateConfig(model))}
  ${/* W58.J-IT — ADM no-autoplay + no-turbo + min-spin + mandatory
       reality-check interval + RUA register check. 0-byte when not IT. */ ''}
  ${emitItalyComplianceGateRuntime(resolveItalyComplianceGateConfig(model))}
  ${/* W58.J-ES — DGOJ no-autoplay + min-spin + mandatory reality-check
       interval + RGIAJ register check + bonus-offer restriction flag.
       0-byte when jurisdiction is not ES. */ ''}
  ${emitSpainComplianceGateRuntime(resolveSpainComplianceGateConfig(model))}
  ${/* WAVE F7 / HX1 — UKGC RTS 8/11/12/13/14 + GamStop check.
       0-byte when jurisdiction is not UK/UKGC/GB. */ ''}
  ${emitUkgcComplianceGateRuntime(resolveUkgcComplianceGateConfig(model))}
  ${/* WAVE F7 / HX2 — SGA Spellagen 2018:1138 no-autoplay + Spelpaus +
       deposit-limit + bonus-consent. 0-byte when jurisdiction is not SE/SGA. */ ''}
  ${emitSwedenComplianceGateRuntime(resolveSwedenComplianceGateConfig(model))}
  ${/* WAVE F7 / HX3 — DGA BEK 727/2010 reality-check + ROFUS + loss limit.
       0-byte when jurisdiction is not DK/DGA. */ ''}
  ${emitDenmarkComplianceGateRuntime(resolveDenmarkComplianceGateConfig(model))}
  ${/* WAVE F7 / HX4 — BGC AR 25/10/2018 EPIS + under-21 weekly cap +
       cooling-off + EUR loss display. 0-byte when jurisdiction is not BE/BGC. */ ''}
  ${emitBelgiumComplianceGateRuntime(resolveBelgiumComplianceGateConfig(model))}
  ${/* WAVE F7 / HX5 — ESBK BGS SR 935.51 whitelist + reality-check +
       cantonal restriction + self-exclusion register. 0-byte when not CH. */ ''}
  ${emitSwitzerlandComplianceGateRuntime(resolveSwitzerlandComplianceGateConfig(model))}
  ${/* WAVE F7 / HX6 — ONJN OUG 77/2009 win-tax disclosure + OSAJ +
       handpay threshold. 0-byte when jurisdiction is not RO/ONJN. */ ''}
  ${emitRomaniaComplianceGateRuntime(resolveRomaniaComplianceGateConfig(model))}
  ${/* W59.H1 — Centralized jurisdiction resolver. Fires AFTER per-gate
       blocks so the audit event records the final resolved value;
       0-byte when no jurisdiction signal in the model. */ ''}
  ${emitJurisdictionGateRuntime(resolveJurisdictionGateConfig(model))}
  ${/* Wave P8 — hot-reload runtime (dev-mode). Placed AFTER HookBus and
     * AFTER every other block runtime so that subscribers to onGddChange
     * are already registered when an SSE-driven re-parse fires. Disabled
     * by default → 0-byte side effect in production. */ ''}
  ${emitHotReloadRuntime(resolveHotReloadConfig(model))}
  ${emitHoldAndWinRuntime(resolveHoldAndWinConfig(model))}
  ${/* Wave H14 — Credit Bucket emits AFTER holdAndWin runtime so HW_STATE
     * is already populated when the observer's postSpin listener fires. */ ''}
  ${emitHoldAndWinCreditBucketRuntime(resolveHoldAndWinCreditBucketConfig(model))}
  ${emitRespinRuntime(resolveRespinConfig(model))}
  ${emitWinCapRuntime(resolveWinCapConfig(model))}
  ${emitLightningRuntime(resolveLightningConfig(model))}
  ${emitBonusPickRuntime(resolveBonusPickConfig(model))}
  ${emitWheelBonusRuntime(resolveWheelBonusConfig(model))}
  ${/* Wave H15 — Weighted Wheel runtime monkey-patches window.wbSpin
     * AFTER wheelBonus runtime emits it. resolveConfig requires the
     * second positional arg (the resolved wheelBonus config) so it can
     * bake the live segments[] array into the patch (jackpotTier reads). */ ''}
  ${emitWeightedWheelSegmentsRuntime(resolveWeightedWheelSegmentsConfig(model), resolveWheelBonusConfig(model))}
  ${emitGambleRuntime(resolveGambleConfig(model))}

  ${emitPostSpinRuntime(resolvePostSpinConfig(model))}

  const devFsBtn   = document.getElementById("devFsBtn");
  const statusElGlobal = document.getElementById("status");
  ${emitStageBadgeRuntime(resolveStageBadgeConfig(model))}
  ${emitFsProgressBarRuntime(resolveFsProgressBarConfig(model))}
  ${emitWinwaysIndicatorRuntime(resolveWinwaysIndicatorConfig(model))}
  ${emitMultiplierLadderRuntime(resolveMultiplierLadderConfig(model))}
  ${emitStickyMeterRuntime(resolveStickyMeterConfig(model))}
  ${emitEnergyMeterRuntime(resolveEnergyMeterConfig(model))}
  ${emitPickBonusRevealRuntime(resolvePickBonusRevealConfig(model))}
  ${emitCoinShowerRuntime(resolveCoinShowerConfig(model))}
  ${emitRewardChestRuntime(resolveRewardChestConfig(model))}
  ${emitSymbolStackCollapseRuntime(resolveSymbolStackCollapseConfig(model))}
  ${emitWheelBonusRevealRuntime(resolveWheelBonusRevealConfig(model))}
  ${emitMysteryRevealRuntime(resolveMysteryRevealConfig(model))}
  ${emitFreeSpinsRuntime(resolveFreeSpinsConfig(model))}

  /* Wave T-slim Phase 2 — extracted window.* exposure surface (was inline
     ~22 LOC). Now in src/runtime/globalsContract.mjs. */
  ${emitGlobalsContractRuntime()}

  /* Wave T-slim Phase 2 — extracted three QA / dev force-button handlers
     (~144 LOC was inline). Now in src/runtime/devForceButtons.mjs. The
     emit MUST come after globalsContract so window.BIG_WIN_TIER_STATE is
     already wired, after spinButton lookup, after HookBus runtime, and
     after FREESPINS / FSM / FORCE_TRIGGER are in scope. */
  ${emitDevForceButtonsRuntime(model)}

  /* Wave T-slim Phase 2 — extracted ~280 LOC of inline renderRect /
     renderVariableReel / renderMaskedRect / renderHex / renderWheel /
     renderPlinko / renderCrash / renderSlingo / renderDual / renderGrid
     dispatcher / fit + resize listener. Lives in
     src/runtime/gridRenderer.mjs#emitGridDispatchRuntime. Emitted at this
     point so all referenced helpers are already in scope:
       • buildReelColumns / RECT_REELS (from emitReelEngineRuntime)
       • ensurePaylineOverlay (from emitPaylineOverlayRuntime)
       • symAt / makeCell / cellSize / UNIFORM_REEL_KINDS
         (from emitGridHelpersRuntime above, pre-engine)
       • POOL / SHAPE / REELS / ROWS (top-of-script constants)
       • grid / frame (DOM refs from top of script). */
  ${emitGridDispatchRuntime(model)}
</script>
</body></html>`;

  /* UQ-DEEP-E audit fix (BUILD-4): hard payload cap. A pathological
   * model (e.g. cluster game with 49 reels × 50 symbols, or 10k
   * paylines) can balloon embedded SYMBOL_REGISTRY + PAYLINE_POOL JSON
   * into hundreds of MB, blowing browser memory + CDN delivery limits.
   * 15 MB is generous (real production slots cap at ~3-5 MB) and trips
   * loud BEFORE the artifact reaches operator / browser. */
  const _MAX_PAYLOAD_BYTES = 15 * 1024 * 1024;
  if (_html.length > _MAX_PAYLOAD_BYTES) {
    throw new Error(`buildSlotHTML payload ${(_html.length/1e6).toFixed(1)}MB exceeds ${_MAX_PAYLOAD_BYTES/1e6}MB cap — adversarial or pathological model`);
  }
  return _html;
}
