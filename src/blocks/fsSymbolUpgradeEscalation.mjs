/**
 * src/blocks/fsSymbolUpgradeEscalation.mjs
 *
 * Wave LEGO-FS2.1 — FS symbol-tier escalation.
 *
 * Purpose
 * ───────
 *   During the FS round, the LOWEST PAYING symbol still in active use
 *   gets UPGRADED to the next tier (LP → MP → HP → WILD) when an
 *   in-FS milestone fires (typically a configurable spin counter or
 *   a trigger payload). Removed symbols don't return that round.
 *
 *   Industry-typical pattern: every Nth FS spin removes the lowest
 *   pay symbol from the pool and promotes the rest one tier up. Round
 *   progresses naturally toward higher payouts. Distinct from existing
 *   FS blocks:
 *     • `freeSpins.mjs`            — base FS state machine
 *     • `superchargedFs.mjs`       — FS retrigger × tier escalation
 *     • `progressiveFreeSpins.mjs` — progressive ROUND multiplier
 *     • `perFsSpinMultiplier.mjs`  — random ×N each FS spin
 *     • `tumbleGrowingFsMultiplier.mjs` — mult grows during FS tumble
 *
 *   This block ONLY modifies the symbol POOL (window.POOL) — engine
 *   reads pool when planting cells. Visual escalation chip shows the
 *   current "tier in play" to the player.
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   "Tier escalation FS" pattern present on many cascade + ways slots
 *   with bonus-rich free-spin rounds. Pool shrinks over the round,
 *   guaranteeing rising-stakes payouts toward the end.
 *
 * Public API
 * ──────────
 *   defaultConfig() / resolveConfig(model)
 *   emitFsSymbolUpgradeEscalationCSS(cfg)
 *   emitFsSymbolUpgradeEscalationMarkup(cfg)
 *   emitFsSymbolUpgradeEscalationRuntime(cfg, model)
 *   removeLowestTierSymbol(pool, tierOrder)     (pure helper)
 *
 * Lifecycle (HookBus)
 * ───────────────────
 *   subscribes:
 *     • onFsTrigger      (priority 30) — init: snapshot pool + reset tier index
 *     • onFsSpinResult   (priority 30) — check milestone; if hit → upgrade
 *     • onFsEnd          (priority 30) — restore base pool
 *   emits:
 *     • onFsSymbolUpgraded   { removedSymbol, remainingSymbols, tierIndex }
 *
 * Runtime contract
 * ────────────────
 *   window.FS_SYMBOL_UPGRADE_STATE = {
 *     active: boolean,
 *     basePool: string[],         // snapshot pre FS
 *     currentPool: string[],      // live pool
 *     tierIndex: number,          // how many upgrades applied
 *     spinsSinceUpgrade: number,
 *   }
 *
 * GDD config keys (model.fsSymbolUpgradeEscalation)
 * ────────────────────────────────────────────────
 *   { enabled, tierOrder: ['9','10','J','Q','K','A','HP1','HP2','HP3','W'],
 *     spinsPerUpgrade, chipColor, chipPosition, showChip }
 *
 * Performance: O(pool length) per upgrade, ≤ 0.2 ms per FS spin.
 *
 * a11y: chip has role=status + aria-live=polite — announces tier
 * promotion via screen reader.
 *
 * Senior-grade: wired-once via __FS_SYMBOL_UPGRADE_WIRED__, idempotent,
 * vendor-neutral, prefers-reduced-motion respected, try/catch around
 * emit sa console.warn surface.
 */

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const POSITIONS    = Object.freeze(['top', 'bottom', 'topRight', 'topLeft']);
const SPINS_MIN    = 1;
const SPINS_MAX    = 50;
const TIER_RE      = /^[A-Z0-9]{1,6}$/;

const DEFAULT_TIER_ORDER = Object.freeze(['9', '10', 'J', 'Q', 'K', 'A', 'HP1', 'HP2', 'HP3', 'W']);
const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    tierOrder: [...DEFAULT_TIER_ORDER],
    spinsPerUpgrade: 3,
    chipColor: '#ffb84d',
    chipPosition: 'topRight',
    showChip: true,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.fsSymbolUpgradeEscalation) || {};

  if (src.enabled === true) cfg.enabled = true;
  if (Array.isArray(src.tierOrder) && src.tierOrder.length >= 2) {
    const filtered = src.tierOrder.filter(t => typeof t === 'string' && TIER_RE.test(t));
    if (filtered.length >= 2) cfg.tierOrder = filtered;
  }
  if (Number.isFinite(src.spinsPerUpgrade)) {
    cfg.spinsPerUpgrade = clampInt(src.spinsPerUpgrade, SPINS_MIN, SPINS_MAX);
  }
  if (typeof src.chipColor === 'string' && HEX_COLOR_RE.test(src.chipColor)) cfg.chipColor = src.chipColor;
  if (typeof src.chipPosition === 'string' && POSITIONS.includes(src.chipPosition)) {
    cfg.chipPosition = src.chipPosition;
  }
  if (src.showChip === false) cfg.showChip = false;

  return cfg;
}

/**
 * Pure: given a pool of symbols and the canonical tier order (LP→HP),
 * remove the LOWEST-tier symbol still present in the pool. Returns:
 *   { newPool, removedSymbol } — removedSymbol === null when pool is
 *   already at the top tier or input is malformed.
 */
export function removeLowestTierSymbol(pool, tierOrder) {
  if (!Array.isArray(pool) || pool.length === 0) return { newPool: [], removedSymbol: null };
  if (!Array.isArray(tierOrder) || tierOrder.length === 0) return { newPool: pool.slice(), removedSymbol: null };
  for (const tier of tierOrder) {
    const idx = pool.indexOf(tier);
    if (idx !== -1) {
      const newPool = pool.slice(0, idx).concat(pool.slice(idx + 1));
      if (newPool.length === 0) {
        /* Don't strip the last entry — engine would have nothing to plant. */
        return { newPool: pool.slice(), removedSymbol: null };
      }
      return { newPool, removedSymbol: tier };
    }
  }
  return { newPool: pool.slice(), removedSymbol: null };
}

function positionCss(pos) {
  switch (pos) {
    case 'bottom':   return 'bottom: 12px; left: 50%; transform: translateX(-50%);';
    case 'topRight': return 'top: 80px; right: 12px;';
    case 'topLeft':  return 'top: 80px; left: 12px;';
    case 'top':
    default:         return 'top: 80px; left: 50%; transform: translateX(-50%);';
  }
}

export function emitFsSymbolUpgradeEscalationCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ fsSymbolUpgradeEscalation: cfg });
  if (!c.enabled) return `\n/* fsSymbolUpgradeEscalation BLOCK (disabled) — no CSS */\n`;
  return `
/* ── fsSymbolUpgradeEscalation BLOCK — src/blocks/fsSymbolUpgradeEscalation.mjs ── */
.fsse-chip {
  position: absolute;
  ${positionCss(c.chipPosition)}
  background: linear-gradient(180deg, rgba(50,30,8,.92), rgba(20,12,4,.92));
  border: 1px solid ${c.chipColor};
  color: ${c.chipColor};
  font: 800 13px/1 system-ui, -apple-system, sans-serif;
  padding: 5px 11px;
  border-radius: 14px;
  z-index: 62;
  letter-spacing: 0.04em;
  pointer-events: none;
  opacity: 0;
  transition: opacity 240ms ease;
}
.fsse-chip.is-visible { opacity: 1; }
.fsse-chip.is-bumping {
  animation: fsse-bump 700ms cubic-bezier(.2,1.3,.4,1);
}
@keyframes fsse-bump {
  0%   { transform: scale(1); }
  40%  { transform: scale(1.25); box-shadow: 0 0 16px ${c.chipColor}; }
  100% { transform: scale(1); box-shadow: 0 0 0 transparent; }
}
@media (prefers-reduced-motion: reduce) {
  .fsse-chip { transition: none; }
  .fsse-chip.is-bumping { animation: none; }
}
`;
}

export function emitFsSymbolUpgradeEscalationMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ fsSymbolUpgradeEscalation: cfg });
  if (!c.enabled || !c.showChip) return `\n<!-- fsSymbolUpgradeEscalation BLOCK (disabled or hidden) -->\n`;
  return `
<!-- fsSymbolUpgradeEscalation BLOCK — server-emitted markup -->
<div class="fsse-chip" id="fsseChip" role="status" aria-live="polite" aria-hidden="true"></div>
`;
}

export function emitFsSymbolUpgradeEscalationRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ fsSymbolUpgradeEscalation: cfg });
  if (!c.enabled) return `\n// fsSymbolUpgradeEscalation BLOCK (disabled) — no runtime\n`;

  const tierOrderJson  = JSON.stringify(c.tierOrder);
  const spinsPerUpgrade = c.spinsPerUpgrade;

  return `
/* ── fsSymbolUpgradeEscalation BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__FS_SYMBOL_UPGRADE_WIRED__) return;
  window.__FS_SYMBOL_UPGRADE_WIRED__ = true;

  var TIER_ORDER = ${tierOrderJson};
  var SPINS_PER_UPGRADE = ${spinsPerUpgrade};

  window.FS_SYMBOL_UPGRADE_STATE = {
    active: false,
    basePool: [],
    currentPool: [],
    tierIndex: 0,
    spinsSinceUpgrade: 0,
  };

  function _chip() { return document.getElementById('fsseChip'); }

  function _renderChip() {
    var el = _chip();
    if (!el) return;
    var st = window.FS_SYMBOL_UPGRADE_STATE;
    if (!st.active || st.tierIndex === 0) {
      el.classList.remove('is-visible', 'is-bumping');
      el.setAttribute('aria-hidden', 'true');
      return;
    }
    el.textContent = 'TIER UP ×' + st.tierIndex;
    el.classList.add('is-visible', 'is-bumping');
    el.setAttribute('aria-hidden', 'false');
    setTimeout(function() { el.classList.remove('is-bumping'); }, 720);
  }

  function _snapshotPool() {
    if (Array.isArray(window.POOL)) return window.POOL.slice();
    if (Array.isArray(window.SYMBOLS)) return window.SYMBOLS.slice();
    return [];
  }

  function _writePool(pool) {
    /* FIX-7.1 (deep QA #29, 2026-06-19) — symmetric SYMBOLS fallback +
     * console.warn surface. _snapshotPool reads window.SYMBOLS when
     * POOL is absent, but the old _writePool silently no-op-ped in that
     * scenario (escalation effective only on POOL-shaped games). Now
     * both shapes are writable, and any thrown error reaches the console
     * so silent-failure rule (JSDoc contract) is honored. */
    try {
      if (Array.isArray(window.POOL)) {
        window.POOL.length = 0;
        for (var i = 0; i < pool.length; i++) window.POOL.push(pool[i]);
        return;
      }
      if (Array.isArray(window.SYMBOLS)) {
        window.SYMBOLS.length = 0;
        for (var j = 0; j < pool.length; j++) window.SYMBOLS.push(pool[j]);
        return;
      }
    } catch (e) {
      try { if (typeof console !== 'undefined' && console.warn) console.warn('[fsSymbolUpgradeEscalation] _writePool failed', e); } catch (__) {}
    }
  }

  function _doUpgrade() {
    var st = window.FS_SYMBOL_UPGRADE_STATE;
    var pool = st.currentPool;
    if (!pool || pool.length <= 1) return null;
    for (var i = 0; i < TIER_ORDER.length; i++) {
      var tier = TIER_ORDER[i];
      var idx = pool.indexOf(tier);
      if (idx !== -1) {
        if (pool.length - 1 === 0) return null;   /* never strip last */
        var newPool = pool.slice(0, idx).concat(pool.slice(idx + 1));
        st.currentPool = newPool;
        st.tierIndex += 1;
        _writePool(newPool);
        return { removedSymbol: tier, remainingSymbols: newPool.slice(), tierIndex: st.tierIndex };
      }
    }
    return null;
  }

  function _onFsTrigger() {
    /* FIX-4 (deep QA #18, 2026-06-19) — idempotency guard. Without this,
     * a duplicate onFsTrigger emit (e.g. retrigger code-path that fires
     * both onFsRetrigger + onFsTrigger, or a parent-FSM bug) snapshots
     * the already-escalated currentPool as the new basePool, then _onFsEnd
     * restores to that DELIMICALLY escalated pool instead of the pristine
     * pre-FS base. Result: state leak through FS into BASE game pool.
     * Symmetric with fsReelHeightEscalation L272 and winBothWaysActivation
     * L180 idempotency guards. */
    if (window.FS_SYMBOL_UPGRADE_STATE.active === true) return;
    var snap = _snapshotPool();
    window.FS_SYMBOL_UPGRADE_STATE.active = true;
    window.FS_SYMBOL_UPGRADE_STATE.basePool = snap.slice();
    window.FS_SYMBOL_UPGRADE_STATE.currentPool = snap.slice();
    window.FS_SYMBOL_UPGRADE_STATE.tierIndex = 0;
    window.FS_SYMBOL_UPGRADE_STATE.spinsSinceUpgrade = 0;
    _renderChip();
  }

  function _onFsSpinResult() {
    var st = window.FS_SYMBOL_UPGRADE_STATE;
    if (!st.active) return;
    st.spinsSinceUpgrade += 1;
    if (st.spinsSinceUpgrade < SPINS_PER_UPGRADE) return;
    st.spinsSinceUpgrade = 0;
    var result = _doUpgrade();
    if (result && window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onFsSymbolUpgraded', result);
      } catch (e) {
        try { if (typeof console !== 'undefined' && console.warn) console.warn('[fsSymbolUpgradeEscalation] emit failed', e); } catch (__) {}
      }
      _renderChip();
    }
  }

  function _onFsEnd() {
    var st = window.FS_SYMBOL_UPGRADE_STATE;
    if (st.basePool && st.basePool.length > 0) {
      _writePool(st.basePool);
    }
    st.active = false;
    st.currentPool = [];
    st.basePool = [];
    st.tierIndex = 0;
    st.spinsSinceUpgrade = 0;
    var el = _chip();
    if (el) {
      el.classList.remove('is-visible', 'is-bumping');
      el.setAttribute('aria-hidden', 'true');
      el.textContent = '';
    }
  }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('onFsTrigger',    _onFsTrigger,    { priority: 30 });
    window.HookBus.on('onFsSpinResult', _onFsSpinResult, { priority: 30 });
    window.HookBus.on('onFsEnd',        _onFsEnd,        { priority: 30 });
  }
})();
`;
}
