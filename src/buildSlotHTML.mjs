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
  emitAnticipationCSS,
  emitAnticipationRuntime,
  resolveConfig as resolveAnticipationConfig,
} from './blocks/anticipation.mjs';
import {
  emitAnticipationUniversalCSS,
  emitAnticipationUniversalRuntime,
  resolveConfig as resolveAnticipationUniversalConfig,
} from './blocks/anticipationUniversal.mjs';
import {
  emitSpinTempoRuntime,
  resolveConfig as resolveSpinTempoConfig,
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

  /* Palette — use GDD palette[] if available, else reference defaults */
  const p = model.theme.palette || [];
  const bg0    = p[0] || "#05070c";   // deep background
  const bg1    = p[1] || "#0b0f16";   // mid background
  const accent = p[2] || "#c9a227";   // primary accent (gold)
  const text   = "#f2f2f2";

  const layoutSub = `${shape.shapeNote}${shape.paylines ? ` · ${shape.paylines} lines` : ''}${shape.wayCount ? ` · ${shape.wayCount} ways` : ''}`;

  return `<!DOCTYPE html>
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
${emitAnticipationCSS(resolveAnticipationConfig(model))}
${emitAnticipationUniversalCSS(resolveAnticipationUniversalConfig(model))}

${emitWinPresentationCSS(resolveWinPresentationConfig(model))}

${emitScatterCelebrationCSS(model)}
${emitTumbleCSS(resolveTumbleConfig(model))}
${emitMultiplierOrbCSS(resolveMultiplierOrbConfig(model))}
${emitBonusBuyCSS(resolveBonusBuyConfig(model))}
${/* Wave H11 — Bonus Buy Deterministic Plant extension (tier picker modal CSS). */ ''}
${emitBonusBuyDeterministicCSS(resolveBonusBuyDeterministicConfig(model))}
${emitAnteBetCSS(resolveAnteBetConfig(model))}
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
${/* Wave H3 — Session Timeout modal CSS (continuous-play cap + forced break). */ ''}
${emitSessionTimeoutCSS(resolveSessionTimeoutConfig(model))}
${emitWinRollupCSS(resolveWinRollupConfig(model))}
${/* Wave U9 — session history log (audit panel). */ ''}
${emitHistoryLogCSS(resolveHistoryLogConfig(model))}
${/* Wave U11 — turbo mode toggle (cadence override). */ ''}
${emitTurboModeCSS(resolveTurboModeConfig(model))}
${/* Wave U13 — settings panel (consolidated preferences modal). */ ''}
${emitSettingsPanelCSS(resolveSettingsPanelConfig(model))}
${/* Wave U10 — paytable modal (i-button + symbol roster + features). */ ''}
${emitPaytableCSS(resolvePaytableConfig(model))}
${emitSymbolInfoPopoverCSS(resolveSymbolInfoPopoverConfig(model))}
${/* Wave B64 — Symbol upgrade flash + morph keyframes (decorates .cell). */ ''}
${emitSymbolUpgradeCSS(resolveSymbolUpgradeConfig(model))}
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
${emitLightningCSS(resolveLightningConfig(model))}
${emitGambleCSS(resolveGambleConfig(model))}
${emitSuperSymbolCSS(resolveSuperSymbolConfig(model))}

${emitFreeSpinsCSS(resolveFreeSpinsConfig(model))}
${emitDevToolsCSS()}
</style></head><body>

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

${emitBonusBuyMarkup(resolveBonusBuyConfig(model))}
${emitBonusBuyDeterministicMarkup(resolveBonusBuyDeterministicConfig(model))}
${emitAnteBetMarkup(resolveAnteBetConfig(model))}
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
${/* Wave P8 — hot-reload indicator host (hidden until connected). */ ''}
${emitHotReloadMarkup(resolveHotReloadConfig(model))}

<script>
  /* ── HookBus FIRST — every feature block registers on it. ────────── */
  ${emitHookBusRuntime(resolveHookBusConfig(model))}

  const POOL = ${JSON.stringify(pool.map(s => s.id))};
  const SHAPE = ${JSON.stringify(shape)};
  const FREESPINS = ${JSON.stringify(model.freeSpins || { enabled: false })};
  /* Wave AL-2 (4-GDD audit) — expose parser-detected feature kinds + name
   * + symbol tier counts as a window-side QA hook so external auditors
   * (cortex-eyes, regulator probes, dev tools) can verify parser → UI
   * parity without scraping inline scripts. Safe for production: read-only
   * snapshot of the build-time model, no runtime mutation. */
  const __MODEL_FEATURES__ = ${JSON.stringify((model.features || []).map(f => ({ kind: f.kind, label: f.label })))};
  const __MODEL_NAME__ = ${JSON.stringify(model.name || 'Untitled Slot')};
  const __MODEL_SYMBOL_COUNTS__ = ${JSON.stringify({
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
  const GAME_EVAL_KIND = ${JSON.stringify((model.topology && model.topology.evaluation) || 'line')};
  if (typeof window !== "undefined") window.GAME_EVAL_KIND = GAME_EVAL_KIND;
  /* Per-symbol registry — drives win-cycle event generation. See
     SYMBOL_REGISTRY construction in buildSlotHTML.mjs for the source. */
  const SYMBOL_REGISTRY = ${JSON.stringify(SYMBOL_REGISTRY)};
  /* Payline pool — int[reels] per line, value = rowIdx at reel i.
     Empty for cluster-pays grids (cluster, megaclusters, hex, etc).
     When non-empty, the win cycle runs in line-pays mode (per-line
     event). When empty, it falls back to per-symbol cluster mode. */
  const PAYLINE_POOL = ${JSON.stringify(PAYLINE_POOL)};
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

  /* Reel spin engine cadence + anticipation — see src/blocks/reelEngine.mjs
     + src/blocks/spinTempo.mjs + src/blocks/anticipation.mjs JSDoc for the
     per-reel timing budget and rotation algorithm. */
  ${emitSpinTempoRuntime(resolveSpinTempoConfig(model))}

  ${emitAnticipationRuntime(resolveAnticipationConfig(model))}
  ${emitAnticipationUniversalRuntime(resolveAnticipationUniversalConfig(model))}

  /* User-driven SPIN button click. During FS_* phases the FSM / placard CTA
     owns the input. Wave V3 — spinControl morphs the button between SPIN /
     STOP_PRE / STOP_POST / SKIP_*; this handler only fires a fresh spin
     when data-state is SPIN (otherwise spinControl emits its own intent). */
  const spinButton = document.getElementById("spinBtn");
  if (spinButton) {
    spinButton.addEventListener("click", () => {
      if (FSM.phase !== "BASE") return;
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
  ${emitBonusBuyRuntime(resolveBonusBuyConfig(model))}
  ${/* Wave H11 — Deterministic plant runtime monkey-patches #bonusBuyBtn
     * click at capture phase to open the tier picker BEFORE the original
     * Buy handler fires. Plants cells on onSpinResult. */ ''}
  ${emitBonusBuyDeterministicRuntime(resolveBonusBuyDeterministicConfig(model))}
  ${emitAnteBetRuntime(resolveAnteBetConfig(model))}

  /* Wave L–P — 16 feature kinds runtime (no-op stubs when disabled).
     Order: wilds first (modify the grid), then evaluators (read modified
     grid), then round-control (consume eval results), then mini-games
     (overlay UIs, independent triggers). */
  ${emitStickyWildRuntime(resolveStickyWildConfig(model))}
  ${emitExpandingWildRuntime(resolveExpandingWildConfig(model))}
  ${emitWalkingWildRuntime(resolveWalkingWildConfig(model))}
  ${emitWildReelRuntime(resolveWildReelConfig(model))}
  ${emitMysterySymbolRuntime(resolveMysterySymbolConfig(model))}
  ${emitSuperSymbolRuntime(resolveSuperSymbolConfig(model))}
  ${emitClusterPaysEvalRuntime(resolveClusterPaysEvalConfig(model))}
  ${emitWaysEvalRuntime(resolveWaysEvalConfig(model))}
  ${/* Wave H13 — Path-Aware Multiplier runtime monkey-patches
     * window.detectWaysWins AFTER waysEval runtime emits it. Pure
     * observer — adds pathMultiplier/pathMultiplierLabel to each event,
     * paints chips, aggregates additive bonus on postSpin. */ ''}
  ${emitPathAwareMultiplierRuntime(resolvePathAwareMultiplierConfig(model))}
  ${emitPersistentMultiplierRuntime(resolvePersistentMultiplierConfig(model))}
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
  ${/* Wave U10 — paytable modal runtime (i-button show/hide + roster). */ ''}
  ${emitPaytableRuntime(resolvePaytableConfig(model), model)}
  ${emitSymbolInfoPopoverRuntime(resolveSymbolInfoPopoverConfig(model))}
  ${/* Wave B64 — symbolUpgrade runtime. Listens onTumbleStep AFTER tumble
       refill so freshly-dropped symbols get a chance to morph upward. */ ''}
  ${emitSymbolUpgradeRuntime(resolveSymbolUpgradeConfig(model))}
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
}
