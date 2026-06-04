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
  resolveConfig as resolveScatterCelebrationConfig,
} from './blocks/scatterCelebration.mjs';
import {
  emitStageBadgeCSS,
  emitStageBadgeMarkup,
  emitStageBadgeRuntime,
  resolveConfig as resolveStageBadgeConfig,
} from './blocks/stageBadge.mjs';
import {
  emitAnticipationCSS,
  emitAnticipationRuntime,
  resolveConfig as resolveAnticipationConfig,
} from './blocks/anticipation.mjs';
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
// Wave U4 — Autoplay session (industry-standard auto-spin panel pattern)
import {
  emitAutoplayCSS, emitAutoplayMarkup, emitAutoplayRuntime,
  resolveConfig as resolveAutoplayConfig,
} from './blocks/autoplay.mjs';
import {
  emitHoldAndWinCSS, emitHoldAndWinMarkup, emitHoldAndWinRuntime,
  resolveConfig as resolveHoldAndWinConfig,
} from './blocks/holdAndWin.mjs';
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
  const pool = allSyms.length > 0 ? allSyms : [
    { id: "W", name: "Wild" }, { id: "S", name: "Scatter" },
    { id: "A", name: "Ace" }, { id: "K", name: "King" }, { id: "Q", name: "Queen" },
    { id: "J", name: "Jack" }, { id: "T", name: "Ten" }, { id: "9", name: "Nine" },
  ];
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
<meta charset="UTF-8"><title>${escapeHtml(model.name)} · Base Game</title>
<style>
${emitThemeCSS(resolveThemeCSSConfig(model))}
${emitStageBadgeCSS(resolveStageBadgeConfig(model))}
${emitPaylineOverlayCSS(resolvePaylineOverlayConfig(model))}
${emitGridShapesCSS()}
${emitReelEngineCSS(resolveReelEngineConfig(model))}
${emitAnticipationCSS(resolveAnticipationConfig(model))}

${emitWinPresentationCSS(resolveWinPresentationConfig(model))}

${emitScatterCelebrationCSS(resolveScatterCelebrationConfig(model))}
${emitTumbleCSS(resolveTumbleConfig(model))}
${emitMultiplierOrbCSS(resolveMultiplierOrbConfig(model))}
${emitBonusBuyCSS(resolveBonusBuyConfig(model))}
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
${/* Wave V1+V2 — spin-control overlay buttons. z-index: slam 20, skip 25. */ ''}
${emitSlamStopCSS(resolveSlamStopConfig(model))}
${emitForceSkipCSS(resolveForceSkipConfig(model))}
${/* Wave U4 — autoplay session UI (button + panel + counter). */ ''}
${emitAutoplayCSS(resolveAutoplayConfig(model))}
${emitHoldAndWinCSS(resolveHoldAndWinConfig(model))}
${emitRespinCSS(resolveRespinConfig(model))}
${emitWinCapCSS(resolveWinCapConfig(model))}
${emitBonusPickCSS(resolveBonusPickConfig(model))}
${emitWheelBonusCSS(resolveWheelBonusConfig(model))}
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
      <button class="spinBtn" id="spinBtn" aria-label="Spin" type="button">
        <!-- Industry-standard circular spin / refresh icon — two opposing
             arrows wrapping in a circle. Used by most major slot vendors
             on the primary SPIN CTA. -->
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M5.6 17.4a10.5 10.5 0 0 0 18.7 5.2"/>
          <path d="M26.4 14.6A10.5 10.5 0 0 0 7.7 9.4"/>
          <polyline points="24.3,22.6 24.3,16.6 18.3,16.6"/>
          <polyline points="7.7,9.4 7.7,15.4 13.7,15.4"/>
        </svg>
      </button>
      <button class="autoBtn" id="autoBtn" aria-label="Auto" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor"/></svg>
      </button>
    </aside>
  </div>
  <div class="hub">
    <button class="iconBtn" aria-label="Menu" type="button">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>
    </button>
    <div class="statBox statBox--balance">
      <div class="statBox__label">BAL</div>
      <div class="statBox__value" id="bal">1000.00</div>
    </div>
    <div class="statBox statBox--status">
      <div class="statBox__label">STATUS</div>
      <div class="statBox__value" id="status">PRESS SPIN</div>
    </div>
    <div class="betGroup">
      <button class="betStep" aria-label="bet -" type="button">−</button>
      <div class="statBox statBox--bet">
        <div class="statBox__label">BET</div>
        <div class="statBox__value" id="bet">1.00</div>
      </div>
      <button class="betStep" aria-label="bet +" type="button">+</button>
    </div>
    <button class="iconBtn" aria-label="Sound" type="button">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
    </button>
  </div>
</div>

<!-- Dev-only Free-Spins trigger. Pinned bottom-left of the viewport — visible
     in every template (even with FS disabled in the GDD) so QA can click
     directly into the FS round without grinding scatter hits. Disabled when
     FS is not in the parsed model. -->
<button class="dev-fs-btn" id="devFsBtn" type="button"
        aria-label="Dev: Trigger Free Spins"
        title="DEV — force Free Spins entry">FS</button>

${emitFreeSpinsOverlayMarkup(resolveFreeSpinsConfig(model))}

${emitBonusBuyMarkup(resolveBonusBuyConfig(model))}
${emitAnteBetMarkup(resolveAnteBetConfig(model))}
<!-- Wave L–P markup (empty strings when disabled) -->
${emitPersistentMultiplierMarkup(resolvePersistentMultiplierConfig(model))}
${emitProgressiveFreeSpinsMarkup(resolveProgressiveFreeSpinsConfig(model))}
${/* audio markup skipped — ADB tok, ne GDD */ ''}
${emitUiToastMarkup(resolveUiToastConfig(model))}
${/* Wave V1+V2 — spin-control buttons (hidden by default; runtime toggles). */ ''}
${emitSlamStopMarkup(resolveSlamStopConfig(model))}
${emitForceSkipMarkup(resolveForceSkipConfig(model))}
${/* Wave U4 — autoplay button + panel + counter overlay. */ ''}
${emitAutoplayMarkup(resolveAutoplayConfig(model))}
${emitHoldAndWinMarkup(resolveHoldAndWinConfig(model))}
${emitRespinMarkup(resolveRespinConfig(model))}
${emitWinCapMarkup(resolveWinCapConfig(model))}
${emitBonusPickMarkup(resolveBonusPickConfig(model))}
${emitWheelBonusMarkup(resolveWheelBonusConfig(model))}
${emitGambleMarkup(resolveGambleConfig(model))}

<script>
  /* ── HookBus FIRST — every feature block registers on it. ────────── */
  ${emitHookBusRuntime(resolveHookBusConfig(model))}

  const POOL = ${JSON.stringify(pool.map(s => s.id))};
  const SHAPE = ${JSON.stringify(shape)};
  const FREESPINS = ${JSON.stringify(model.freeSpins || { enabled: false })};
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

  /* Deterministic symbol fill — repeatable layout per fixture for snapshots */
  function symAt(i) { return POOL[i % POOL.length]; }

  function makeCell(text, extraClass = "") {
    const el = document.createElement("div");
    el.className = "cell" + (extraClass ? " " + extraClass : "");
    el.textContent = text || "?";
    return el;
  }

  /* Compute the side length so a (cols x rowsCount) grid of square cells
     with the given gap between them fits inside frame inner box. The grid is
     centered automatically by .gridHost flex layout. */
  function cellSize(cols, rowsCount, gap = 6) {
    /* frame already has padding=var(--frame-inset); use clientWidth/Height
       which exclude padding. */
    const innerW = grid.clientWidth || frame.clientWidth;
    const innerH = grid.clientHeight || frame.clientHeight;
    const cellW = (innerW - gap * Math.max(0, cols - 1)) / cols;
    const cellH = (innerH - gap * Math.max(0, rowsCount - 1)) / rowsCount;
    return Math.max(20, Math.floor(Math.min(cellW, cellH)));
  }

  /* Track per-reel strips for the spin engine. Populated for every
     uniform-column-grid shape kind so the rectangular reel engine
     (windup → accel → steady → decel → cushion bounce) drives every
     reel-like shape identically.

     UNIFORM_REEL_KINDS lists shapes that share a flat REELS×ROWS column
     layout — all of them now build the same RECT_REELS array of reelCol
     strips. Cluster's 7×7 looks like 7 stacked-symbol columns spinning,
     same beat as rectangular's 5×3 — just larger. */
  const UNIFORM_REEL_KINDS = new Set([
    'rectangular',
    'cluster',
    'megaclusters',
    'lock_respin',
    'expanding',
    'infinity',
    /* Wave J1 — variable_reel (per-reel row counts, e.g. 6×[2,5,7,7,5,2]).
       Shares the rectangular spin engine but each column has its own
       visibleRows and is center-aligned in the grid host. */
    'variable_reel',
    /* Wave J2 — diamond / pyramid: irregular silhouettes that map cleanly
       onto the uniform reel engine via per-column visibleRows. Diamond
       center-aligns each column (rhombus); pyramid bottom-anchors (triangle).
       cross / l_shape: rectangular silhouette with masked corner cells —
       each column has the same visible row count as a full reel, but
       individual cells inside the masked area render as transparent
       blanks (handled in renderRect post-build pass). */
    'diamond',
    'pyramid',
    'cross',
    'l_shape',
  ]);
  ${emitReelEngineRuntime(resolveReelEngineHotConfig(model))}


  function renderRect() {
    const host = document.createElement("div");
    host.className = "grid-rect";
    const side = cellSize(REELS, ROWS);
    host.style.gridTemplateColumns = "repeat(" + REELS + ", " + side + "px)";
    host.style.gridTemplateRows = side + "px";  // single row of reel columns

    if (UNIFORM_REEL_KINDS.has(SHAPE.kind)) {
      const extraClass = (SHAPE.kind === 'lock_respin') ? 'lockable' : '';
      /* Per-reel visibleRows array (variable_reel / diamond / pyramid use
         this; uniform kinds pass a scalar). For cross / l_shape we keep
         visibleRows uniform (=ROWS) and rely on mask metadata after build
         to dim disabled cells — the engine still spins every column. */
      let perReelRows = ROWS;
      /* Anchor: 'center' default (variable_reel / diamond hourglass).
         'bottom' for pyramid (triangle anchored to bottom of the host). */
      let anchor = 'center';
      const PER_COLUMN_KINDS = new Set(['variable_reel', 'diamond', 'pyramid']);
      const SHAPED_HOST_KINDS = new Set(['variable_reel', 'diamond', 'pyramid', 'cross', 'l_shape']);
      if (PER_COLUMN_KINDS.has(SHAPE.kind) && Array.isArray(SHAPE.columns)) {
        perReelRows = SHAPE.columns.map(c => c.rows || ROWS);
        if (SHAPE.kind === 'pyramid') anchor = 'bottom';
      }
      if (SHAPED_HOST_KINDS.has(SHAPE.kind)) {
        /* Shape-driven hosts need the grid to render as ROWS-tall stacked
           rows so the (center/bottom) anchored columns have somewhere to
           anchor. */
        host.style.gridTemplateRows = "repeat(" + ROWS + ", " + side + "px)";
      }
      buildReelColumns(host, REELS, perReelRows, side, extraClass, anchor);
      /* cross / l_shape: dim cells that the GDD shape mask marks as blank
         (corner cuts). Engine still spins every column, just visual mask. */
      if (SHAPE.kind === 'cross' || SHAPE.kind === 'l_shape') {
        for (let c = 0; c < REELS; c++) {
          const colMask = SHAPE.columns[c] && SHAPE.columns[c].mask;
          if (!colMask) continue;
          const reel = RECT_REELS[c];
          if (!reel) continue;
          for (let r = 0; r < ROWS; r++) {
            if (colMask[r]) continue;
            /* Strip cells are indexed 0..stripBufferCells+visibleRows-1.
               The visible window is cells[1..visibleRows]. Mark cells in
               the blank rows as cell--masked so CSS can hide them. */
            const cell = reel.cells[1 + r];
            if (cell) cell.classList.add('cell--masked');
          }
        }
      }
      if (SHAPE.kind === "expanding" || SHAPE.kind === "infinity") {
        const tag = document.createElement("div");
        tag.className = "grow-tag";
        tag.textContent = SHAPE.kind === "infinity" ? "∞ horizontal" : "expand vertical";
        frame.appendChild(tag);
      }
      grid.appendChild(host);
      return;
    }

    /* Irregular shapes (hex / diamond / pyramid / cross / l_shape) — they
       don't share the rectangular column layout, so they keep the legacy
       static-cell render. runOneBaseSpin dispatches to runStaticReroll for
       these. (variable_reel used to live here but Wave J1 moved it onto
       the uniform reel engine with per-column visibleRows.) */
    host.style.gridTemplateRows = "repeat(" + ROWS + ", " + side + "px)";
    let idx = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < REELS; c++) {
        host.appendChild(makeCell(symAt(idx), ""));
        idx++;
      }
    }
    grid.appendChild(host);
  }

  /* ─── Reel spin engine (rectangular only) ──────────────────────────────
     Mirrors the reference base game onTick + reel cell rotation. Symbols
     are ALWAYS visible during spin because we rotate cells in the strip
     rather than translating beyond the visible window:

        every frame: offsetPx += speedPxPerFrame
        when offsetPx >= cellStep:
          • offsetPx -= cellStep
          • pop bottom cell, unshift to top, randomize the top cell symbol
          • re-render strip with cells at indexes [0..n-1]
          • rotation count++
        strip.transform.y = round(offsetPx - cellStep)
          (oscillates between -cellStep and 0, exposing the next cell as
           the top one slides off-mask above)

     On stop request:
        • spin keeps rotating until rotationCount >= minRotations AND
          enough time has passed for this reel's stop-delay (stagger)
        • transition to "stopping" — strip eases towards targetY with
          a soft cushion bounce on land (6px overshoot, ~2 bounces)
        • final visible 3 cells are the new outcome

     Timing constants mirror SPIN_PROFILE_NORMAL — industry baseline cabinet cadence. */
  /* Industry-reference cadence (S-AVP / classic 5-reel cabinet timing).
     Each reel: windup → accel → steady spin → DECEL (perceivable slow-
     down before the snap) → snap onto symbols → subtle cushion bounce.
     Reels stop one-by-one with a 320ms gap = classic cabinet beat
     (slightly longer than mobile-arcade quickplay).
     Land timing from SPIN click:
       reel 1 :  ~1.40s   (windup 100 + accel 120 + steady 830 + decel 350)
       reel 2 :  ~1.72s
       reel 3 :  ~2.04s
       reel 4 :  ~2.36s
       reel 5 :  ~2.68s
     Total spin ~2.7s — matches the reference base-game cadence. */
  ${emitSpinTempoRuntime(resolveSpinTempoConfig(model))}

  ${emitAnticipationRuntime(resolveAnticipationConfig(model))}


  /* onSettled (optional) fires once when every reel has fully stopped and
     bounced. Used by the FS auto-spin loop to chain spins back-to-back, and
     by the post-spin scatter-detection hook to evaluate FS triggers. */


  /* ─── User-driven spin entry (player click on the SPIN button) ─────────
     During FS_ACTIVE the spin loop is driven by the FSM, not by the player,
     so we ignore clicks. During FS_INTRO / FS_OUTRO the placard CTA owns
     the input, so we ignore clicks as well. */
  const spinButton = document.getElementById("spinBtn");
  if (spinButton) {
    spinButton.addEventListener("click", () => {
      if (FSM.phase !== "BASE") return;
      runOneBaseSpin();
    });
  }


  /* ─── Static-grid reroll path (every non-rectangular kind) ───────────────
     The base-game template doesn't ship a per-kind spin animation for hex /
     wheel / cluster / plinko / etc. — those just blink to a fresh random
     symbol set with a quick fade. Good enough for the FS visual flow (the
     real per-kind spin animations land in the per-kind engine packages). */

  ${emitTriggerCountingRuntime(resolveTriggerCountingConfig(model))}

  /* ── Placeholder win-combo highlight ─────────────────────────────────────
     No math yet, so we fake the "winning combination" by picking the most-
     frequent non-scatter symbol on the grid (must occur ≥ 3 times) and
     marking those cells .is-win while the parent .grid carries
     .has-winselection (which dims every other cell via CSS). About one
     spin in three is a "loss" with no highlight at all, so the player gets
     visual variance instead of every spin lighting up. Cleared at the start
     of every new spin and at FS phase boundaries. */
  function clearWinHighlight() {
    grid.classList.remove("has-winselection");
    grid.classList.remove("is-winsym-cycling");
    grid.querySelectorAll(".cell.is-win, text.is-win").forEach(c => c.classList.remove("is-win"));
    grid.querySelectorAll(".cell--winsym, text.cell--winsym").forEach(c => c.classList.remove("cell--winsym"));
    /* Drop any leftover payline SVG so the next spin's neutral state
       reads clean (no ghost line bleeding into the windup frame). */
    if (typeof clearPaylineOverlay === 'function') clearPaylineOverlay();
  }
  /* Detect candidate win combos on the settled grid. Placeholder math:
     every non-scatter symbol with count >= 3 becomes one combo. Sorted
     by count desc and capped to MAX_COMBOS so the cycle stays inside a
     few seconds (no math layer yet — when real evaluator lands this
     function is the swap point). */
  /* ── detectWinCombos — per-symbol event generation ─────────────────────
     Ultimate behaviour (Boki rule): every HP/MP/LP symbol with >= 3
     visible hits becomes its OWN event in the cycle. Wild substitutes —
     wild cells join EVERY regular event's cell list (lit alongside the
     real symbol). Scatter NEVER participates (trigger-only).

     Returns array of events:
       [{ symbol, tier: 'HP'|'MP'|'LP', cells: [...] }, ...]
     Sorted: HP first, then MP, then LP. Hard cap on event count so the
     cycle never blows the per-spin time budget (industry parity:
     small-win cycles cap the line bouquet around 6-8 entries). */
  ${emitDetectWinCombosRuntime(resolveWinPresentationConfig(model))}
  ${emitPaylineOverlayRuntime()}
  ${emitWinPresentationRuntime(resolveWinPresentationConfig(model))}

  ${emitScatterCelebrationRuntime(resolveScatterCelebrationConfig(model))}

  /* Wave K — Pay-Anywhere suite. Order matters:
       1. multiplierOrb (annotates orbs + provides accumulateOrbMultiplier)
       2. payAnywhereEval (detectPayAnywhereWins consumes annotated grid)
       3. tumble (runTumbleChain consumes detect + orb accumulation)
       4. bonusBuy / anteBet (UI bindings, last) */
  ${emitMultiplierOrbRuntime(resolveMultiplierOrbConfig(model))}
  ${emitPayAnywhereEvalRuntime(resolvePayAnywhereEvalConfig(model))}
  ${emitTumbleRuntime(resolveTumbleConfig(model))}
  ${emitBonusBuyRuntime(resolveBonusBuyConfig(model))}
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
  ${emitPersistentMultiplierRuntime(resolvePersistentMultiplierConfig(model))}
  ${emitProgressiveFreeSpinsRuntime(resolveProgressiveFreeSpinsConfig(model))}
  ${/* audio runtime skipped — ADB tok, ne GDD */ ''}
  ${emitUiToastRuntime(resolveUiToastConfig(model))}
  ${/* Wave V1+V2 — spin-control runtime (emit-only blocks; engine listens). */ ''}
  ${emitSlamStopRuntime(resolveSlamStopConfig(model))}
  ${emitForceSkipRuntime(resolveForceSkipConfig(model))}
  ${/* Wave U4 — autoplay session runtime. */ ''}
  ${emitAutoplayRuntime(resolveAutoplayConfig(model))}
  ${emitHoldAndWinRuntime(resolveHoldAndWinConfig(model))}
  ${emitRespinRuntime(resolveRespinConfig(model))}
  ${emitWinCapRuntime(resolveWinCapConfig(model))}
  ${emitLightningRuntime(resolveLightningConfig(model))}
  ${emitBonusPickRuntime(resolveBonusPickConfig(model))}
  ${emitWheelBonusRuntime(resolveWheelBonusConfig(model))}
  ${emitGambleRuntime(resolveGambleConfig(model))}

  ${emitPostSpinRuntime(resolvePostSpinConfig(model))}

  const devFsBtn   = document.getElementById("devFsBtn");
  const statusElGlobal = document.getElementById("status");
  ${emitStageBadgeRuntime(resolveStageBadgeConfig(model))}
  ${emitFreeSpinsRuntime(resolveFreeSpinsConfig(model))}

  /* Expose FREESPINS / SHAPE / RECT_REELS / payline + win probes on window
     for the QA harness (Playwright eval). FSM is already exposed by the
     freeSpins block. */
  if (typeof window !== "undefined") {
    window.FREESPINS = FREESPINS;
    window.SHAPE = SHAPE;
    /* Wave T5 — without these two, every block that does
       \`window.REELS || 5\` / \`window.ROWS || 3\` was falling through
       to default 5×3, so feature blocks placed coordinates on a phantom
       grid (e.g. walkingWild registry rows beyond actual ROWS). Expose
       the live SHAPE dimensions so blocks always read the truth. */
    window.REELS = SHAPE.reels;
    window.ROWS  = SHAPE.rows;
    Object.defineProperty(window, 'RECT_REELS', {
      configurable: true,
      get: () => RECT_REELS,
    });
    window.PAYLINE_POOL = PAYLINE_POOL;
    window.SYMBOL_REGISTRY = SYMBOL_REGISTRY;
    window.applyWinHighlight = applyWinHighlight;
    window.detectLineWins = detectLineWins;
    window.drawPaylineOverlay = drawPaylineOverlay;
  }

  /* Dev-only FS trigger — runs a real spin with the scatter outcome forced
     so the player sees the FULL trigger sequence: reels rotate, scatters
     land one by one with anticipation slowdown on the trigger reel, brief
     settle pause, THEN the cinematic intro placard fades in. This mirrors
     what an organic feature hit looks like — exactly the "you spun into a
     bonus" moment a player remembers.

     Implementation: sets FORCE_TRIGGER flag, kicks runOneBaseSpin(), which
     uses the normal spin engine + handlePostSpin. The scatter detection in
     handlePostSpin sees the planted scatters and naturally fires intro. */
  if (devFsBtn) {
    devFsBtn.disabled = !FREESPINS.enabled;
    devFsBtn.addEventListener("click", () => {
      if (FSM.phase !== "BASE" || !FREESPINS.enabled) return;
      const first = (FREESPINS.awards && FREESPINS.awards[0]) || { count: 3, spins: 10 };
      /* Disable both buttons immediately so a stray double-tap can't queue
         a second spin behind this one. They get re-enabled on FSM_enterBase
         (or by handlePostSpin if FS doesn't trigger for some reason). */
      devFsBtn.disabled = true;
      if (spinButton) spinButton.disabled = true;
      FORCE_TRIGGER = { scatterCount: first.count };
      runOneBaseSpin();
    });
  }

  function renderVariableReel() {
    const host = document.createElement("div");
    host.className = "grid-vrl";
    const maxRows = Math.max(...SHAPE.columns.map(c => c.rows));
    const side = cellSize(SHAPE.columns.length, maxRows);
    let idx = 0;
    for (let c = 0; c < SHAPE.columns.length; c++) {
      const colEl = document.createElement("div");
      colEl.className = "col";
      const colRows = SHAPE.columns[c].rows;
      for (let r = 0; r < colRows; r++) {
        const cell = makeCell(symAt(idx));
        cell.style.width = side + "px";
        cell.style.height = side + "px";
        colEl.appendChild(cell);
        idx++;
      }
      host.appendChild(colEl);
    }
    grid.appendChild(host);
  }

  function renderMaskedRect() {
    const host = document.createElement("div");
    host.className = "grid-rect";
    const side = cellSize(REELS, ROWS);
    host.style.gridTemplateColumns = "repeat(" + REELS + ", " + side + "px)";
    host.style.gridTemplateRows = "repeat(" + ROWS + ", " + side + "px)";
    let idx = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < REELS; c++) {
        const colMask = SHAPE.columns[c] && SHAPE.columns[c].mask;
        const enabled = colMask ? colMask[r] : true;
        if (enabled) {
          host.appendChild(makeCell(symAt(idx)));
          idx++;
        } else {
          const blank = document.createElement("div");
          blank.style.cssText = "width:" + side + "px;height:" + side + "px;opacity:0.02";
          host.appendChild(blank);
        }
      }
    }
    grid.appendChild(host);
  }

  function renderHex() {
    const host = document.createElement("div");
    host.className = "grid-hex";
    const ring = Math.floor((SHAPE.columns.length - 1) / 2);
    /* tile size derived from frame dimensions */
    const innerW = grid.clientWidth || frame.clientWidth;
    const innerH = grid.clientHeight || frame.clientHeight;
    const dim = ring * 2 + 1;
    const size = Math.min(innerW / (dim * 1.05), innerH / (dim * 0.9));
    const w = size, h = size * 0.85;
    host.style.width  = (dim * w * 1.05 + 20) + "px";
    host.style.height = (dim * h + 20) + "px";
    SHAPE.cells.forEach((c, i) => {
      const q = c.hex ? c.hex.q : 0;
      const r = c.hex ? c.hex.r : 0;
      const x = (q + ring) * w * 1.0 + (r % 2 ? w * 0.5 : 0) + 10;
      const y = (r + ring) * h + 10;
      const el = makeCell(symAt(i), "hex");
      el.style.left = x + "px";
      el.style.top = y + "px";
      el.style.width = w + "px";
      el.style.height = (h * 1.15) + "px";
      host.appendChild(el);
    });
    grid.appendChild(host);
  }

  function renderWheel() {
    const host = document.createElement("div");
    host.className = "grid-wheel";
    const segments = SHAPE.cells.length;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "wheel-svg");
    svg.setAttribute("viewBox", "-100 -100 200 200");
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * 2 * Math.PI - Math.PI / 2;
      const a1 = ((i + 1) / segments) * 2 * Math.PI - Math.PI / 2;
      const x0 = Math.cos(a0) * 92, y0 = Math.sin(a0) * 92;
      const x1 = Math.cos(a1) * 92, y1 = Math.sin(a1) * 92;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "M 0 0 L " + x0.toFixed(2) + " " + y0.toFixed(2) + " A 92 92 0 0 1 " + x1.toFixed(2) + " " + y1.toFixed(2) + " Z");
      path.setAttribute("fill", i % 2 ? "#1a2230" : "#0f1620");
      path.setAttribute("stroke", "${accent}");
      path.setAttribute("stroke-width", "0.5");
      svg.appendChild(path);
      const mid = (a0 + a1) / 2;
      const tx = Math.cos(mid) * 62, ty = Math.sin(mid) * 62;
      const tEl = document.createElementNS("http://www.w3.org/2000/svg", "text");
      tEl.setAttribute("x", tx.toFixed(2)); tEl.setAttribute("y", ty.toFixed(2));
      tEl.setAttribute("text-anchor", "middle"); tEl.setAttribute("dominant-baseline", "middle");
      tEl.setAttribute("fill", "${accent}");
      tEl.setAttribute("font-size", "8");
      tEl.setAttribute("font-weight", "700");
      tEl.textContent = String(symAt(i) || (i + 1));
      svg.appendChild(tEl);
    }
    host.appendChild(svg);
    grid.appendChild(host);
  }

  function renderPlinko() {
    const host = document.createElement("div");
    host.className = "grid-plinko";
    let idx = 0;
    for (let r = 0; r < SHAPE.columns.length; r++) {
      const rowEl = document.createElement("div");
      rowEl.className = "plinko-row";
      const pegCount = SHAPE.columns[r].rows;
      for (let c = 0; c < pegCount; c++) {
        const peg = document.createElement("div");
        peg.className = "peg";
        rowEl.appendChild(peg);
        idx++;
      }
      host.appendChild(rowEl);
    }
    grid.appendChild(host);
  }

  function renderCrash() {
    const host = document.createElement("div");
    host.className = "grid-crash";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "crash-curve");
    svg.setAttribute("viewBox", "0 0 320 180");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    let d = "M 0 180";
    for (let x = 0; x <= 320; x += 6) {
      const y = 180 - Math.pow(x / 320, 2) * 160 * 0.85;
      d += " L " + x + " " + y.toFixed(1);
    }
    path.setAttribute("d", d);
    path.setAttribute("stroke", "${accent}");
    path.setAttribute("stroke-width", "3");
    path.setAttribute("fill", "none");
    svg.appendChild(path);
    const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
    txt.setAttribute("x", "240"); txt.setAttribute("y", "40");
    txt.setAttribute("fill", "${accent}");
    txt.setAttribute("font-size", "24"); txt.setAttribute("font-weight", "800");
    txt.textContent = "1.00x";
    svg.appendChild(txt);
    host.appendChild(svg);
    grid.appendChild(host);
  }

  function renderSlingo() {
    const host = document.createElement("div");
    host.className = "grid-slingo";
    const innerH = grid.clientHeight || frame.clientHeight;
    /* board takes 5 rows, strip is 1 row; reserve 6 row-units total with gap */
    const totalRows = 6 + 0.4; /* small visual separator */
    const side = (innerH - 12 - 6 * 5) / totalRows;
    const board = document.createElement("div");
    board.className = "grid-rect";
    board.style.gridTemplateColumns = "repeat(5, " + side + "px)";
    board.style.gridTemplateRows = "repeat(5, " + side + "px)";
    for (let i = 0; i < 25; i++) board.appendChild(makeCell(symAt(i)));
    host.appendChild(board);
    const strip = document.createElement("div");
    strip.className = "grid-rect";
    strip.style.gridTemplateColumns = "repeat(5, " + side + "px)";
    strip.style.gridTemplateRows = side + "px";
    /* Spacing only — visual separator removed for the flat look. */
    strip.style.marginTop = "12px";
    for (let i = 25; i < 30; i++) strip.appendChild(makeCell(symAt(i)));
    host.appendChild(strip);
    grid.appendChild(host);
  }

  function renderDual() {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;gap:20px;align-items:center;width:100%;height:100%;justify-content:center";
    const sgRowsB = (SHAPE.subgrids && SHAPE.subgrids[0]) ? SHAPE.subgrids[0].rows : ROWS;
    const sgReelsB = (SHAPE.subgrids && SHAPE.subgrids[0]) ? SHAPE.subgrids[0].reels : REELS;
    const innerW = (grid.clientWidth || frame.clientWidth) - 30;
    const innerH = grid.clientHeight || frame.clientHeight;
    const gap = 4;
    /* Compute each side's max cell so it fits entirely in the available
       half-width AND the full inner height. Subgrid B has more rows so its
       cell will be smaller — this is desired for Colossal asymmetric dual. */
    const halfW = innerW / 2;
    const sideA = Math.min(
      (halfW - gap * (REELS - 1)) / REELS,
      (innerH - gap * (ROWS - 1)) / ROWS,
    );
    const sideB = Math.min(
      (halfW - gap * (sgReelsB - 1)) / sgReelsB,
      (innerH - gap * (sgRowsB - 1)) / sgRowsB,
    );
    /* primary */
    const a = document.createElement("div");
    a.className = "grid-rect";
    a.style.gridTemplateColumns = "repeat(" + REELS + ", " + sideA + "px)";
    a.style.gridTemplateRows = "repeat(" + ROWS + ", " + sideA + "px)";
    a.style.gap = gap + "px";
    const primCells = SHAPE.totalCells || REELS * ROWS;
    for (let i = 0; i < primCells; i++) {
      const el = makeCell(symAt(i));
      el.style.fontSize = (sideA * 0.32) + "px";
      a.appendChild(el);
    }
    wrap.appendChild(a);
    if (SHAPE.subgrids && SHAPE.subgrids[0]) {
      const sg = SHAPE.subgrids[0];
      const b = document.createElement("div");
      b.className = "grid-rect";
      b.style.gridTemplateColumns = "repeat(" + sg.reels + ", " + sideB + "px)";
      b.style.gridTemplateRows = "repeat(" + sg.rows + ", " + sideB + "px)";
      b.style.gap = gap + "px";
      for (let i = 0; i < sg.totalCells; i++) {
        const el = makeCell(symAt(primCells + i));
        el.style.fontSize = Math.max(8, sideB * 0.32) + "px";
        b.appendChild(el);
      }
      wrap.appendChild(b);
    }
    grid.appendChild(wrap);
  }

  /* Dispatch */
  function renderGrid() {
    grid.innerHTML = "";
    /* Re-attach the payline SVG overlay after every render — innerHTML
       wipe blows away the static node from initial HTML. Idempotent. */
    ensurePaylineOverlay();
    switch (SHAPE.kind) {
      case "rectangular":
      case "cluster":
      case "lock_respin":
      case "megaclusters":
      case "infinity":
      case "expanding":
      /* Wave J1: variable_reel now uses the rectangular reel engine via
         per-reel visibleRows in buildReelColumns (handled inside renderRect
         when SHAPE.kind === 'variable_reel'). */
      case "variable_reel":
      /* Wave J2 — diamond / pyramid / cross / l_shape join the rectangular
         reel engine via per-column visibleRows (diamond/pyramid) or via
         masked-cell post-build pass (cross / l_shape). */
      case "diamond":
      case "pyramid":
      case "cross":
      case "l_shape":
        return renderRect();
      case "hexagonal":
        return renderHex();
      case "radial":
      case "wheel":
        return renderWheel();
      case "plinko":
        return renderPlinko();
      case "crash":
        return renderCrash();
      case "slingo":
        return renderSlingo();
      case "dual":
        return renderDual();
      default:
        return renderRect();
    }
  }

  /* Initial render + responsive on resize */
  function fit() { renderGrid(); }
  window.addEventListener("resize", fit);
  /* run after first layout pass so .frame has measured dimensions */
  requestAnimationFrame(fit);
</script>
</body></html>`;
}
