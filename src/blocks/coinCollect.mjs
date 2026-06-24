import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/coinCollect.mjs
 *
 * Wave LEGO-COLLECT (B-4 · 1/3) — Coin / Token collection mechanic.
 *
 * @module coinCollect
 *
 * Purpose:
 *   When GDD declares `coin_collect` (or `token_collect`), this block
 *   scans every `onSpinResult` for cells carrying a "coin" attribute
 *   (`data-coin-value` or a configured symbol id), tallies their value
 *   into a running session total exposed on `window.__COIN_COLLECT__`,
 *   and emits a per-spin collect event with the picked-up cell list.
 *
 *   This block owns the DETECTION + ACCUMULATION half. The sibling
 *   blocks own visualization (`cumulativeMeter.mjs`) and reveal
 *   choreography (`collectRevealOverlay.mjs`) — together they form the
 *   industry-standard "collect-and-claim" meta-game pattern.
 *
 * Industry-reference (vendor-neutral):
 *   Coin / orb / token collect is one of the dominant 2024-2026 retention
 *   mechanics. Coins land on the grid at a configurable rate (typically
 *   2-8% of cells per spin), the player's running total fills a meter,
 *   and at a threshold the meter "pays out" — credits / FS trigger /
 *   jackpot pick / bonus round. The pattern lives ABOVE the spin outcome
 *   so even losing spins feed the meta-progress (regulator-friendly LDW
 *   alternative).
 *
 * Public API:
 *   defaultConfig()                          → frozen safe defaults
 *   resolveConfig(model)                     → merge defaults with GDD override
 *   emitCoinCollectCSS(cfg)                  → CSS string (coin-cell decoration)
 *   emitCoinCollectMarkup(cfg)               → HTML string (sr-only live region)
 *   emitCoinCollectRuntime(cfg)              → runtime JS string for orchestrator
 *
 * Lifecycle (HookBus contract):
 *   subscribes:  onSpinResult — scan grid for coin cells, sum into total
 *                onFsTrigger  — optional reset (configurable)
 *                onFsEnd      — optional resume
 *   emits:       onCoinCollected { perSpinValue, cellIds, sessionTotal }
 *
 * Shared state contract:
 *   window.__COIN_COLLECT__ = {
 *     sessionTotal: number,    // running cumulative value
 *     lastSpinValue: number,   // most recent per-spin pickup
 *     lastSpinCells: string[], // cell ids picked up this spin
 *     totalCoinsLifetime: number, // count of individual coins seen
 *   }
 *
 * a11y / perf:
 *   • sr-only live region announces "{N} coins collected this spin
 *     (total: {T})" politely so blind players track session progress.
 *   • prefers-reduced-motion honored by sibling visual blocks.
 *   • Detection scan is bounded — only visible grid cells, no MutationObserver.
 *   • Self-disables mid-FS when `pauseDuringFs: true` (default false —
 *     coins typically still drop in bonus rounds in industry baseline).
 */
import { applyGridProfile } from '../registry/gridProfile.mjs';

const TOKENS = Object.freeze({
  coinBorderPx: 2,
  coinHaloPx:   8,
  liveSrPx:     1,
});

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const RGB_RE = /^\d{1,3},\d{1,3},\d{1,3}$/;
const ID_RE  = /^[A-Z0-9_]{1,16}$/;

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    /* Which symbol id represents the coin/token in the grid. Set
     * to null to use the data-attribute fallback (`data-coin-value`). */
    coinSymbolId: 'COIN',
    /* Per-coin nominal value (used when grid declares only "is coin"
     * but no per-cell value). Concrete games override per-cell via
     * `data-coin-value` attribute populated by the engine. */
    defaultCoinValue: 1,
    /* If `true`, suspend tallying during FS. Default `false` — bonus
     * rounds typically continue to feed the meta-meter. */
    pauseDuringFs: false,
    /* Reset session total on `onFsEnd`? Default `false` — the meter
     * persists across bonus boundaries unless GDD requests reset. */
    resetOnFsEnd: false,
    /* Visual cell decoration (consumed by sibling visual blocks). */
    color:    '#ffd34a',
    haloRGB:  '255,211,74',
  });
}

function _clampInt(n, lo, hi, fallback) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

export function resolveConfig(model = {}) {
  let cfg = { ...applyGridProfile('coinCollect', defaultConfig(), model) };
  const m = model.coinCollect || {};

  /* Wave LEGO-BUY parity protocol — explicit `enabled:true` still
   * routes through gridProfile veto. */
  if (m.enabled != null) {
    if (m.enabled === true) {
      const ctxOverride = applyGridProfile('coinCollect', { enabled: true }, model);
      cfg.enabled = ctxOverride.enabled !== false;
    } else {
      cfg.enabled = false;
    }
  }

  if (typeof m.coinSymbolId === 'string' && ID_RE.test(m.coinSymbolId)) cfg.coinSymbolId = m.coinSymbolId;
  if (Number.isFinite(m.defaultCoinValue)) cfg.defaultCoinValue = _clampInt(m.defaultCoinValue, 0, 1_000_000, cfg.defaultCoinValue);
  if (typeof m.pauseDuringFs === 'boolean') cfg.pauseDuringFs = m.pauseDuringFs;
  if (typeof m.resetOnFsEnd === 'boolean') cfg.resetOnFsEnd = m.resetOnFsEnd;
  if (typeof m.color === 'string' && HEX_RE.test(m.color)) cfg.color = m.color;
  if (typeof m.haloRGB === 'string' && RGB_RE.test(m.haloRGB)) cfg.haloRGB = m.haloRGB;

  /* Auto-enable from features[] */
  if (Array.isArray(model.features) &&
      model.features.some(f => f.kind === 'coin_collect' || f.kind === 'token_collect')) {
    const ctxOverride = applyGridProfile('coinCollect', { enabled: true }, model);
    cfg.enabled = ctxOverride.enabled !== false;
  }

  return cfg;
}

export function emitCoinCollectCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const T = TOKENS;
  return `
/* ─── coin collect cell decoration ───────────────────────────────── */
.cell.is-coin,
.cell[data-coin-value] {
  position: relative;
  outline: ${T.coinBorderPx}px solid ${cfg.color};
  outline-offset: -${T.coinBorderPx}px;
  box-shadow: 0 0 ${T.coinHaloPx}px rgba(${cfg.haloRGB},.55) inset;
}
.cell.is-coin::after,
.cell[data-coin-value]::after {
  content: attr(data-coin-value);
  position: absolute;
  bottom: 2px; right: 4px;
  font-size: 0.65rem;
  font-weight: 800;
  color: ${cfg.color};
  text-shadow: 0 1px 2px rgba(0,0,0,.85);
  pointer-events: none;
}
.coin-collect-live {
  position: absolute; left: -9999px; top: 0;
  width: 1px; height: 1px; overflow: hidden;
  font-size: ${T.liveSrPx}px;
}
`;
}

export function emitCoinCollectMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return tagBlockMarkup(`<div id="coinCollectLive" class="coin-collect-live"
     role="status" aria-live="polite" aria-atomic="true"></div>`, 'coinCollect');
}

export function emitCoinCollectRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* coinCollect: disabled */`;
  return `/* ─── coin collect runtime ───────────────────────────────────── */
const CC_COIN_SYMBOL    = ${JSON.stringify(cfg.coinSymbolId)};
const CC_DEFAULT_VALUE  = ${cfg.defaultCoinValue};
const CC_PAUSE_FS       = ${cfg.pauseDuringFs};
const CC_RESET_FS_END   = ${cfg.resetOnFsEnd};

(function wireCoinCollect(){
  const live = document.getElementById('coinCollectLive');
  if (typeof window !== 'undefined' && !window.__COIN_COLLECT__) {
    window.__COIN_COLLECT__ = {
      sessionTotal: 0,
      lastSpinValue: 0,
      lastSpinCells: [],
      totalCoinsLifetime: 0,
    };
  }
  let suspended = false;

  function scanGrid() {
    /* Cells with explicit data-coin-value win. Fallback: cells whose
     * data-symbol matches CC_COIN_SYMBOL. */
    const explicit = Array.prototype.slice.call(
      document.querySelectorAll('.cell[data-coin-value]'));
    const bySymbol = Array.prototype.slice.call(
      document.querySelectorAll('.cell[data-symbol="' + CC_COIN_SYMBOL + '"]'));
    const seen = new Set();
    const out = [];
    for (const c of explicit.concat(bySymbol)) {
      if (seen.has(c)) continue;
      seen.add(c);
      out.push(c);
    }
    return out;
  }

  function tally() {
    if (suspended) return;
    const cells = scanGrid();
    /* WAVE Y6 force-guard (Boki 2026-06-20 "dalje"): UFP chip plants
     * __FORCE_COLLECTOR_FILL__ to demo 'partial' (40%) / 'full' (100%) /
     * 'overflow' (>100%). We synthesise a coin payload that pushes the
     * meter to the requested fraction of CC_THRESHOLD when available,
     * else 100/200 coin defaults. One-shot per spin. */
    let _forcedFill = null;
    try {
      _forcedFill = window.__FORCE_COLLECTOR_FILL__;
      if (_forcedFill) window.__FORCE_COLLECTOR_FILL__ = null;
    } catch (_) {}

    if (cells.length === 0 && !_forcedFill) return;

    let perSpinValue = 0;
    const cellIds = [];
    for (const cell of cells) {
      const raw = cell.getAttribute('data-coin-value');
      const val = (raw !== null && raw !== '') ? Number(raw) : CC_DEFAULT_VALUE;
      const safe = Number.isFinite(val) && val > 0 ? val : CC_DEFAULT_VALUE;
      perSpinValue += safe;
      cellIds.push(cell.id || cell.getAttribute('data-cell-id') || ('c' + cellIds.length));
      cell.classList.add('is-coin');
    }

    if (_forcedFill) {
      const _baseThreshold = (typeof CC_THRESHOLD === 'number' && CC_THRESHOLD > 0) ? CC_THRESHOLD : 100;
      const _fillTarget = _forcedFill === 'partial' ? _baseThreshold * 0.4
                        : _forcedFill === 'overflow' ? _baseThreshold * 1.2
                        : _baseThreshold;
      const _bonus = Math.max(0, Math.round(_fillTarget - (window.__COIN_COLLECT__?.sessionTotal || 0)));
      if (_bonus > 0) {
        perSpinValue += _bonus;
        cellIds.push('forced-coin:' + _forcedFill);
      }
    }

    const state = window.__COIN_COLLECT__;
    state.lastSpinValue = perSpinValue;
    state.lastSpinCells = cellIds;
    state.sessionTotal += perSpinValue;
    state.totalCoinsLifetime += cells.length;

    if (live) {
      live.textContent = cells.length + ' coins collected this spin · total ' + state.sessionTotal;
    }

    if (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function') {
      HookBus.emit('onCoinCollected', {
        perSpinValue: perSpinValue,
        cellIds: cellIds,
        sessionTotal: state.sessionTotal,
      });
    }
  }

  (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onSpinResult', tally) : void 0);
  HookBus.on('onFsTrigger', function(){ if (CC_PAUSE_FS) suspended = true; });
  HookBus.on('onFsEnd', function(){
    suspended = false;
    if (CC_RESET_FS_END) {
      window.__COIN_COLLECT__.sessionTotal = 0;
      window.__COIN_COLLECT__.totalCoinsLifetime = 0;
    }
  });
})();
`;
}
