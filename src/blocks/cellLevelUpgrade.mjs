import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/cellLevelUpgrade.mjs
 *
 * Wave H7 — Cell Level Upgrade (per-cell numeric level meter + badge).
 *
 * Industry baseline (vendor-neutral):
 *   Distinct from `symbolUpgrade.mjs` (which TRANSMUTES a low-tier symbol
 *   to a high-tier symbol on cascade refill), this block adds a *persistent
 *   numeric level meter* to individual grid cells. Each cell tracks how many
 *   times its current symbol has "scored a win" or has been the subject of
 *   a qualifying event; when the count crosses a threshold the cell renders
 *   a small `Lv N` badge in the top-right corner and the badge pulses.
 *
 *   Common industry surfaces:
 *     • Sticky bonus orbs that compound across respins
 *     • Per-cell collect counters in scatter-pay cascades
 *     • Multiplier badges that scale with consecutive cascade-wins
 *
 *   Pure PRESENTATION + STATE — no math change. The block stores a level map
 *   in `__SLOT_CELL_LEVELS__` (keyed by reel+row+sym) and renders a badge.
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitCellLevelUpgradeCSS(cfg)
 *   emitCellLevelUpgradeMarkup(cfg)  → empty (decorates existing cells)
 *   emitCellLevelUpgradeRuntime(cfg)
 *
 * Lifecycle:
 *   subscribes:
 *     preSpin       → reset round-scope levels (if cfg.scope='round')
 *     onTumbleStep  → bump levels for symbols on winning cascade lines
 *     postSpin      → decorate badge DOM on every cell with level ≥ 1
 *     onFsTrigger   → optional reset (cfg.resetOnFsTrigger)
 *     onFsEnd       → optional reset (cfg.resetOnFsEnd)
 *   emits:
 *     onCellLevelUp { reel, row, sym, fromLevel, toLevel, source }
 *     onCellLevelReset { scope, source }
 *
 * a11y:
 *   - Badge has `aria-label="symbol level N"`.
 *   - prefers-reduced-motion kills the pulse keyframe.
 *
 * Vendor-neutral.
 *
 * GDD config (consumed from `model.cellLevelUpgrade`):
 *   {
 *     enabled, maxLevel, badgeFontSize, badgeColor, badgeBg, pulseMs,
 *     bumpOn ('winCell' | 'cascade' | 'any'),
 *     scope ('round' | 'session' | 'fsRound'),
 *     resetOnFsTrigger, resetOnFsEnd, restrictToSymbols [string]
 *   }
 *
 * @module cellLevelUpgrade
 */

const BUMP_ON = new Set(['winCell', 'cascade', 'any']);
const SCOPES = new Set(['round', 'session', 'fsRound']);

const BOUNDS = Object.freeze({
  maxLevel:      [1, 99],
  badgeFontSize: [9, 18],
  pulseMs:       [120, 1200],
  zIndex:        [10, 99],
});

function _clamp(v, [lo, hi], fb) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fb;
  return Math.min(hi, Math.max(lo, n));
}
function _safeColor(v, fb) {
  if (typeof v !== 'string') return fb;
  const s = v.replace(/[<>"'`]/g, '').slice(0, 32);
  return s.length ? s : fb;
}

export function defaultConfig() {
  return Object.freeze({
    enabled:           false,         /* opt-in per GDD */
    maxLevel:          9,
    badgeFontSize:     10,
    badgeColor:        '#03110a',
    badgeBg:           '#ffd84d',
    pulseMs:           320,
    bumpOn:            'winCell',
    scope:             'round',
    resetOnFsTrigger:  false,
    resetOnFsEnd:      true,
    restrictToSymbols: [],            /* [] = no restriction */
    zIndex:            16,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.cellLevelUpgrade) || {};
  const auto = !!model.cellLevelUpgrade;
  if (typeof m.enabled === 'boolean') cfg.enabled = m.enabled;
  else if (auto) cfg.enabled = true;

  cfg.maxLevel      = _clamp(m.maxLevel,      BOUNDS.maxLevel,      cfg.maxLevel);
  cfg.badgeFontSize = _clamp(m.badgeFontSize, BOUNDS.badgeFontSize, cfg.badgeFontSize);
  cfg.pulseMs       = _clamp(m.pulseMs,       BOUNDS.pulseMs,       cfg.pulseMs);
  cfg.zIndex        = _clamp(m.zIndex,        BOUNDS.zIndex,        cfg.zIndex);

  cfg.badgeColor = _safeColor(m.badgeColor, cfg.badgeColor);
  cfg.badgeBg    = _safeColor(m.badgeBg,    cfg.badgeBg);

  if (typeof m.bumpOn === 'string' && BUMP_ON.has(m.bumpOn)) cfg.bumpOn = m.bumpOn;
  if (typeof m.scope  === 'string' && SCOPES.has(m.scope))   cfg.scope  = m.scope;

  if (typeof m.resetOnFsTrigger === 'boolean') cfg.resetOnFsTrigger = m.resetOnFsTrigger;
  if (typeof m.resetOnFsEnd     === 'boolean') cfg.resetOnFsEnd     = m.resetOnFsEnd;

  if (Array.isArray(m.restrictToSymbols)) {
    cfg.restrictToSymbols = m.restrictToSymbols
      .filter(s => typeof s === 'string' && s.length > 0 && s.length <= 12)
      .map(s => s.replace(/[<>"'`]/g, ''))
      .slice(0, 32);
  }
  return cfg;
}

export function emitCellLevelUpgradeCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* cellLevelUpgrade — Wave H7 */
  .symbol-cell .clu-badge {
    position: absolute;
    top: 4px;
    right: 4px;
    z-index: ${cfg.zIndex};
    min-width: 20px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: ${cfg.badgeBg};
    color: ${cfg.badgeColor};
    font-size: ${cfg.badgeFontSize}px;
    font-weight: 800;
    line-height: 18px;
    text-align: center;
    letter-spacing: 0.02em;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45);
    pointer-events: none;
    transform-origin: center;
    transition: transform 180ms ease-out;
  }
  .symbol-cell .clu-badge[data-pulse="true"] {
    animation: clu-badge-pulse ${cfg.pulseMs}ms ease-out;
  }
  @keyframes clu-badge-pulse {
    0%   { transform: scale(1.0); }
    40%  { transform: scale(1.6); }
    100% { transform: scale(1.0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .symbol-cell .clu-badge { transition: none; animation: none; }
  }
  `;
}

export function emitCellLevelUpgradeMarkup(cfg = defaultConfig()) {
  /* Block decorates existing .symbol-cell DOM at runtime; no static markup. */
  if (!cfg.enabled) return '';
  return tagBlockMarkup(`<!-- cellLevelUpgrade decorates .symbol-cell at runtime -->`, 'cellLevelUpgrade');
}

export function emitCellLevelUpgradeRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) {
    return `
  /* ── cellLevelUpgrade (disabled) ───────────────────────────────────── */
  window.__SLOT_CELL_LEVELS__ = window.__SLOT_CELL_LEVELS__ || {};
`;
  }
  return `
  /* ── cellLevelUpgrade BLOCK — Wave H7 ─────────────────────────────── */
  (function () {
    if (typeof window === 'undefined' || !window.HookBus) return;
    var MAX = ${cfg.maxLevel};
    var BUMP_ON = ${JSON.stringify(cfg.bumpOn)};
    var SCOPE = ${JSON.stringify(cfg.scope)};
    var RESET_ON_FS_TRIGGER = ${JSON.stringify(cfg.resetOnFsTrigger)};
    var RESET_ON_FS_END = ${JSON.stringify(cfg.resetOnFsEnd)};
    var RESTRICT = ${JSON.stringify(cfg.restrictToSymbols)};
    var restrictSet = {};
    for (var i = 0; i < RESTRICT.length; i++) restrictSet[RESTRICT[i]] = 1;
    var hasRestrict = RESTRICT.length > 0;

    var levels = window.__SLOT_CELL_LEVELS__ || {};
    window.__SLOT_CELL_LEVELS__ = levels;

    function key(reel, row, sym) { return reel + ':' + row + ':' + sym; }

    function reset(scope, source) {
      levels = {};
      window.__SLOT_CELL_LEVELS__ = levels;
      try { window.HookBus.emit('onCellLevelReset', { scope: scope || SCOPE, source: source || 'auto' }); } catch (_) {}
      decorateAll();
    }
    function bump(reel, row, sym, source) {
      if (typeof reel !== 'number' || typeof row !== 'number' || typeof sym !== 'string') return;
      if (hasRestrict && !restrictSet[sym]) return;
      var k = key(reel, row, sym);
      var from = levels[k] | 0;
      var to = Math.min(MAX, from + 1);
      if (to === from) return;
      levels[k] = to;
      try { window.HookBus.emit('onCellLevelUp', { reel: reel, row: row, sym: sym, fromLevel: from, toLevel: to, source: source || 'auto' }); } catch (_) {}
      decorateCellAt(reel, row, true);
    }

    function findCell(reel, row) {
      if (typeof document === 'undefined') return null;
      return document.querySelector('.symbol-cell[data-reel="' + reel + '"][data-row="' + row + '"]');
    }
    function decorateCellAt(reel, row, pulse) {
      var cell = findCell(reel, row);
      if (!cell) return;
      decorateCell(cell, !!pulse);
    }
    function decorateCell(cell, pulse) {
      if (!cell || cell.nodeType !== 1) return;
      var reel = parseInt(cell.getAttribute('data-reel') || '-1', 10);
      var row  = parseInt(cell.getAttribute('data-row') || '-1', 10);
      var sym  = cell.getAttribute('data-sym') || cell.getAttribute('data-symbol') || '';
      if (reel < 0 || row < 0 || !sym) return;
      var lvl = levels[key(reel, row, sym)] | 0;
      var badge = cell.querySelector('.clu-badge');
      if (lvl <= 0) {
        if (badge && typeof badge.remove === 'function') badge.remove();
        else if (badge && badge.parentNode) badge.parentNode.removeChild(badge);
        return;
      }
      if (!badge) {
        /* WCAG 4.1.3 — level badge text is mutated on every level-up; SR
           users need aria-live="polite" + role="status" so they hear
           "Lv 2 → Lv 3" updates as cells upgrade. We assemble via an HTML
           template string (with the literal attributes) so both the DOM
           and tools/aria-live-audit.mjs see the contract. */
        var _wrap = document.createElement('div');
        _wrap.innerHTML = '<span class="clu-badge" role="status" aria-live="polite"></span>';
        badge = _wrap.firstChild;
        cell.appendChild(badge);
      }
      badge.textContent = 'Lv ' + lvl;
      badge.setAttribute('aria-label', 'symbol level ' + lvl);
      if (pulse) {
        badge.setAttribute('data-pulse', 'true');
        setTimeout(function () { if (badge) badge.removeAttribute('data-pulse'); }, ${cfg.pulseMs} + 40);
      }
    }
    function decorateAll() {
      if (typeof document === 'undefined') return;
      var cells = document.querySelectorAll('.symbol-cell');
      for (var i = 0; i < cells.length; i++) decorateCell(cells[i], false);
    }

    /* Listener wiring. */
    window.HookBus.on('preSpin', function () {
      if (SCOPE === 'round') reset('round', 'preSpin');
    });
    window.HookBus.on('onSpinResult', function (p) {
      decorateAll();
      if (!p) return;
      if (BUMP_ON === 'any') {
        if (Array.isArray(p.events)) {
          for (var i = 0; i < p.events.length; i++) {
            var e = p.events[i];
            if (e && Array.isArray(e.cells)) {
              for (var j = 0; j < e.cells.length; j++) {
                var c = e.cells[j];
                if (c && typeof c.reel === 'number' && typeof c.row === 'number') bump(c.reel, c.row, c.sym || e.sym || '?', 'onSpinResult');
              }
            }
          }
        }
      }
    });
    window.HookBus.on('onTumbleStep', function (p) {
      if (BUMP_ON !== 'cascade' && BUMP_ON !== 'any' && BUMP_ON !== 'winCell') return;
      if (!p || !Array.isArray(p.removed)) { decorateAll(); return; }
      for (var i = 0; i < p.removed.length; i++) {
        var rm = p.removed[i];
        if (rm && typeof rm.reel === 'number' && typeof rm.row === 'number' && typeof rm.sym === 'string') {
          bump(rm.reel, rm.row, rm.sym, 'onTumbleStep');
        }
      }
      decorateAll();
    });
    window.HookBus.on('postSpin', function () { decorateAll(); });
    window.HookBus.on('onFsTrigger', function () {
      if (RESET_ON_FS_TRIGGER) reset('fsTriggerEnter', 'onFsTrigger');
    });
    window.HookBus.on('onFsEnd', function () {
      if (RESET_ON_FS_END) reset('fsEnd', 'onFsEnd');
    });

    /* Public API for force / dev / test harnesses. */
    window.cellLevelBump  = function (r, c, s) { bump(r | 0, c | 0, String(s || ''), 'api'); };
    window.cellLevelReset = function (scope)   { reset(scope || 'manual', 'api'); };

    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', decorateAll);
      } else {
        decorateAll();
      }
    }
  })();
  `;
}
