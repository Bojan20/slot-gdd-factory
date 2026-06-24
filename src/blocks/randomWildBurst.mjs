/**
 * src/blocks/randomWildBurst.mjs
 *
 * Wave LEGO-RANDOM (B-3) — Random Wild Burst.
 *
 * @module randomWildBurst
 *
 * Purpose:
 *   When GDD declares `random_wild_burst`, this block randomly "bursts"
 *   N cells into wilds during a spin's settle phase — typically 2-8
 *   cells at random positions on the grid, with a brief flash + halo
 *   visual cue. This is a sister-pattern to expandingWild + mysterySymbol
 *   but operates as a STOCHASTIC per-spin event (not a symbol-driven
 *   reveal). The burst happens on the orchestrator's onSpinResult, BEFORE
 *   evaluator runs — so the planted wilds boost win frequency.
 *
 * Industry-reference (vendor-neutral):
 *   Random-wild events are an industry-standard delight pattern in
 *   non-tumble slots — historically called "Random Wilds Feature" /
 *   "Lightning Wilds" / "Wild Explosion". 2024-2026 implementations
 *   trend toward 3-6 cells burst at ~1-in-15 spin rate. The block models
 *   the visual + planting surface; the math layer reads the planted
 *   wild count via window.__RANDOM_WILD_BURST__ to weight the RTP.
 *
 * Public API:
 *   defaultConfig()                          → frozen safe defaults
 *   resolveConfig(model)                     → merge defaults with GDD override
 *   emitRandomWildBurstCSS(cfg)              → CSS string (flash + halo overlay)
 *   emitRandomWildBurstMarkup(cfg)           → HTML string (overlay host)
 *   emitRandomWildBurstRuntime(cfg)          → runtime JS string for orchestrator
 *
 * Lifecycle (HookBus contract):
 *   subscribes:  onSpinResult — RNG dice + cell planting
 *                onFsTrigger  — suspend mid-bonus (FS has own random pool)
 *                onFsEnd      — resume after bonus
 *   emits:       onRandomWildBurstFired { cells, count }
 *
 * a11y / perf:
 *   • Overlay flash respects prefers-reduced-motion (collapses to
 *     instant opacity 0→1→0 in 1 frame).
 *   • aria-live="polite" announces "N random wilds added" so screen
 *     readers track the outcome change. Live region is hidden from
 *     visual but audible to AT.
 *   • Tokens hoisted (0 magic numbers).
 *   • Self-disabled mid-FS (no nesting with bonus presentations).
 *   • Cooldown — minimum N spins between bursts so the feature stays
 *     scarce and surprising.
 */
import { applyGridProfile } from '../registry/gridProfile.mjs';

const TOKENS = Object.freeze({
  zIndexOverlay:  56,
  flashMs:        420,
  haloFadeMs:     500,
  liveFontPx:     1, // sr-only sizing
  burstHaloPx:    32,
  pulseScale:     1.25,
});

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const RGB_RE = /^\d{1,3},\d{1,3},\d{1,3}$/;

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    /* Probability per spin of a burst firing. Default 0.07 ≈ 1 in 14. */
    burstChance: 0.07,
    /* Cell count range — pick uniformly between min and max inclusive. */
    minCells: 2,
    maxCells: 6,
    /* Minimum spins between bursts (anti-clustering guard). */
    cooldownSpins: 4,
    /* Visual flash params */
    flashColor: '#ffe066',
    haloRGB:    '255,224,102',
    /* Optional cap on grid size we'll plant into. Bursts on huge
     * tumble cascade grids can over-saturate; clamp to a reasonable
     * fraction. Default 0.4 = at most 40% of cells turn wild. */
    maxCellFraction: 0.4,
  });
}

function _clampFloat(n, lo, hi, fallback) {
  n = Number(n);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}
function _clampInt(n, lo, hi, fallback) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

export function resolveConfig(model = {}) {
  let cfg = { ...applyGridProfile('randomWildBurst', defaultConfig(), model) };
  const m = model.randomWildBurst || {};

  if (m.enabled != null) {
    if (m.enabled === true) {
      const ctxOverride = applyGridProfile('randomWildBurst', { enabled: true }, model);
      cfg.enabled = ctxOverride.enabled !== false;
    } else {
      cfg.enabled = false;
    }
  }

  if (Number.isFinite(m.burstChance)) cfg.burstChance = _clampFloat(m.burstChance, 0, 1, cfg.burstChance);
  if (Number.isFinite(m.minCells))    cfg.minCells = _clampInt(m.minCells, 1, 20, cfg.minCells);
  if (Number.isFinite(m.maxCells))    cfg.maxCells = _clampInt(m.maxCells, 1, 30, cfg.maxCells);
  if (cfg.maxCells < cfg.minCells)    cfg.maxCells = cfg.minCells;
  if (Number.isFinite(m.cooldownSpins)) cfg.cooldownSpins = _clampInt(m.cooldownSpins, 0, 100, cfg.cooldownSpins);
  if (typeof m.flashColor === 'string' && HEX_RE.test(m.flashColor)) cfg.flashColor = m.flashColor;
  if (typeof m.haloRGB    === 'string' && RGB_RE.test(m.haloRGB))    cfg.haloRGB    = m.haloRGB;
  if (Number.isFinite(m.maxCellFraction)) cfg.maxCellFraction = _clampFloat(m.maxCellFraction, 0.05, 1.0, cfg.maxCellFraction);

  if (Array.isArray(model.features) &&
      model.features.some(f => f.kind === 'random_wild_burst' || f.kind === 'random_wilds')) {
    const ctxOverride = applyGridProfile('randomWildBurst', { enabled: true }, model);
    cfg.enabled = ctxOverride.enabled !== false;
  }

  return cfg;
}

export function emitRandomWildBurstCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const T = TOKENS;
  return `
/* ─── random wild burst ──────────────────────────────────────────── */
.rwb-flash {
  position: fixed; inset: 0;
  z-index: ${T.zIndexOverlay};
  pointer-events: none;
  background: radial-gradient(circle at center,
    rgba(${cfg.haloRGB},.45) 0%, rgba(${cfg.haloRGB},0) 60%);
  opacity: 0;
  transition: opacity ${T.flashMs}ms cubic-bezier(.4, 0, .2, 1);
}
.rwb-flash[data-fire="true"] { opacity: 1; }
.rwb-cell-halo {
  position: absolute;
  pointer-events: none;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(${cfg.haloRGB},.85) 0%,
                              rgba(${cfg.haloRGB},.2) 50%,
                              rgba(${cfg.haloRGB},0) 100%);
  width: ${T.burstHaloPx}px; height: ${T.burstHaloPx}px;
  transform: translate(-50%, -50%) scale(0);
  transition: transform ${T.haloFadeMs}ms cubic-bezier(.34, 1.56, .64, 1),
              opacity ${T.haloFadeMs}ms ease;
  opacity: 0;
}
.rwb-cell-halo[data-on="true"] {
  opacity: 1;
  transform: translate(-50%, -50%) scale(${T.pulseScale});
}
.rwb-live {
  position: absolute; left: -9999px; top: 0;
  width: 1px; height: 1px; overflow: hidden;
  font-size: ${T.liveFontPx}px;
}
@media (prefers-reduced-motion: reduce) {
  .rwb-flash, .rwb-cell-halo { transition: none !important; }
}
`;
}

export function emitRandomWildBurstMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `<div id="rwbFlash" class="rwb-flash" data-fire="false" aria-hidden="true"></div>
<div id="rwbLive" class="rwb-live" role="status" aria-live="polite" aria-atomic="true"></div>`;
}

export function emitRandomWildBurstRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* randomWildBurst: disabled */`;
  return `/* ─── random wild burst runtime ──────────────────────────────── */
const RWB_CHANCE        = ${cfg.burstChance};
const RWB_MIN           = ${cfg.minCells};
const RWB_MAX           = ${cfg.maxCells};
const RWB_COOLDOWN      = ${cfg.cooldownSpins};
const RWB_MAX_FRACTION  = ${cfg.maxCellFraction};

(function wireRandomWildBurst(){
  const flash = document.getElementById('rwbFlash');
  const live  = document.getElementById('rwbLive');
  if (!flash || !live) return;

  let spinsSinceLast = RWB_COOLDOWN;
  let suspended = false;

  function pickCellCount() {
    const range = RWB_MAX - RWB_MIN + 1;
    return RWB_MIN + Math.floor(Math.random() * range);
  }

  function visibleCells() {
    return Array.prototype.slice.call(document.querySelectorAll('#gridHost .cell, .reel .cell, .reelStrip .cell'));
  }

  function fireBurst() {
    const cells = visibleCells();
    if (cells.length === 0) return;
    const cap = Math.max(1, Math.floor(cells.length * RWB_MAX_FRACTION));
    const desired = Math.min(pickCellCount(), cap);
    /* Random sample without replacement via Fisher-Yates partial. */
    const pool = cells.slice();
    for (let i = 0; i < desired && i < pool.length; i++) {
      const j = i + Math.floor(Math.random() * (pool.length - i));
      const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    const picked = pool.slice(0, desired);

    /* Flash overlay */
    flash.setAttribute('data-fire', 'true');
    setTimeout(function(){ flash.setAttribute('data-fire', 'false'); }, 420);

    /* Plant wild marker + halo per cell */
    const cellIds = [];
    picked.forEach(function(cell, idx){
      /* D-3 guard — defensive for cluster/tumble eval that may pass stale
         refs after gravity; visibleCells() returns DOM but we double-check. */
      if (!cell || typeof cell.getBoundingClientRect !== 'function' || !cell.classList) return;
      cell.classList.add('is-wild', 'rwb-planted');
      cell.setAttribute('data-rwb-planted', '1');
      /* UQ-DEEP-R P6 fix: data-symbol + GRID + symbolOverride emit so win
       * evaluator sees planted wild (was only visual flash + halo, no
       * payout impact). */
      var _wsym = (typeof window.__RANDOM_WILD_BURST_SYMBOL__ === 'string')
                  ? window.__RANDOM_WILD_BURST_SYMBOL__ : 'W';
      cell.setAttribute('data-symbol', _wsym);
      var _ri = Number(cell.getAttribute('data-reel'));
      var _row = Number(cell.getAttribute('data-row'));
      if (Number.isFinite(_ri) && Number.isFinite(_row) && window.GRID && typeof window.GRID.set === 'function') {
        try { window.GRID.set(_ri, _row, _wsym); } catch (_) {}
      }
      if (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function'
          && Number.isFinite(_ri) && Number.isFinite(_row)) {
        try { HookBus.emit('symbolOverride', { r: _row, c: _ri, sym: _wsym, source: 'randomWildBurst' }); } catch (_) {}
      }
      cellIds.push(cell.id || cell.getAttribute('data-cell-id') || ('idx' + idx));

      const rect = cell.getBoundingClientRect();
      const halo = document.createElement('div');
      halo.className = 'rwb-cell-halo';
      halo.style.left = (rect.left + rect.width / 2) + 'px';
      halo.style.top  = (rect.top + rect.height / 2) + 'px';
      halo.style.position = 'fixed';
      halo.setAttribute('data-on', 'false');
      document.body.appendChild(halo);
      requestAnimationFrame(function(){ halo.setAttribute('data-on', 'true'); });
      setTimeout(function(){
        if (halo.parentNode) halo.parentNode.removeChild(halo);
      }, 700);
    });

    /* Math hook — expose for evaluator + RTP balance (Phase 2). */
    if (typeof window !== 'undefined') {
      window.__RANDOM_WILD_BURST__ = {
        firedAt: Date.now(),
        cellCount: desired,
        cellIds: cellIds,
      };
    }

    /* a11y live region — describe the change for screen readers */
    live.textContent = desired + ' random wilds added to the grid';

    if (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function') {
      HookBus.emit('onRandomWildBurstFired', { cells: cellIds, count: desired });
    }
  }

  HookBus.on('onSpinResult', function(){
    if (suspended) return;
    spinsSinceLast++;
    if (spinsSinceLast < RWB_COOLDOWN) return;
    if (Math.random() < RWB_CHANCE) {
      fireBurst();
      spinsSinceLast = 0;
    }
  });
  (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onFsTrigger', function(){ suspended = true; }) : void 0);
  HookBus.on('onFsEnd', function(){ suspended = false; spinsSinceLast = RWB_COOLDOWN; });
})();
`;
}
