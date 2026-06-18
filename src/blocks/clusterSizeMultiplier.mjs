/**
 * src/blocks/clusterSizeMultiplier.mjs
 *
 * Wave LEGO-M5 — Cluster pays multiplier scales with cluster size.
 *
 * Purpose
 * ───────
 *   On cluster-pays slots, the winning cluster gets a multiplier whose
 *   value depends on cluster SIZE (number of connected matching cells).
 *   Industry pattern: tiered ladder maps a cluster size range to a mult
 *   value:
 *     5–7   cells  → ×1
 *     8–10  cells  → ×2
 *     11–14 cells  → ×5
 *     15+   cells  → ×10
 *
 *   Block subscribes to `onClusterPay` (emitted by clusterPaysEval block)
 *   and applies the tier mult via HookBus.setMult.
 *
 *   Distinct from `pathAwareMultiplier.mjs` (which is per-path on
 *   ways-eval) and `winMultiplierBadge.mjs` (visual chip without semantic
 *   mult application).
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   Tier-based cluster-size multiplier present in many cluster-pays
 *   slots — common scaling pattern where bigger clusters earn
 *   multiplicative bonuses on top of the size-based base payout.
 *
 * Public API
 * ──────────
 *   defaultConfig() / resolveConfig(model)
 *   emitClusterSizeMultiplierCSS(cfg)
 *   emitClusterSizeMultiplierRuntime(cfg, model)
 *   tierMultForSize(tiers, size)        (pure helper)
 *
 * Lifecycle (HookBus)
 * ───────────────────
 *   subscribes:
 *     • onClusterPay   (priority 28) — apply tier mult per cluster
 *     • preSpin        (priority 28) — clear last applied mult
 *   emits:
 *     • onClusterSizeMultiplierApplied   { clusterSize, multX }
 *
 * Runtime contract
 * ────────────────
 *   window.CLUSTER_SIZE_MULT_STATE = { lastSize, lastMult }
 *
 * GDD config keys (model.clusterSizeMultiplier)
 * ─────────────────────────────────────────────
 *   { enabled, tiers: [{minSize, maxSize, multX}, ...],
 *     chipColor, showBadge }
 *
 * Performance: O(tiers) lookup per cluster (≤ 6 tiers typical) = O(1).
 *
 * a11y: cluster badge has aria-label="Cluster multiplier 5 times".
 *
 * Senior-grade, wired-once, vendor-neutral.
 */

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

const DEFAULT_TIERS = Object.freeze([
  { minSize:  5, maxSize:  7, multX:  1 },
  { minSize:  8, maxSize: 10, multX:  2 },
  { minSize: 11, maxSize: 14, multX:  5 },
  { minSize: 15, maxSize: 9999, multX: 10 },
]);

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    tiers: DEFAULT_TIERS.map(t => ({ ...t })),
    chipColor: '#7af2c8',
    showBadge: true,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.clusterSizeMultiplier) || {};

  if (src.enabled === true) cfg.enabled = true;
  if (Array.isArray(src.tiers) && src.tiers.length > 0) {
    const filtered = src.tiers
      .filter(t => Number.isFinite(t.minSize) && Number.isFinite(t.maxSize)
                 && Number.isFinite(t.multX) && t.maxSize >= t.minSize && t.multX > 0)
      .map(t => ({
        minSize: Math.trunc(Number(t.minSize)),
        maxSize: Math.trunc(Number(t.maxSize)),
        multX:   Number(t.multX),
      }))
      .sort((a, b) => a.minSize - b.minSize);
    if (filtered.length > 0) cfg.tiers = filtered;
  }
  if (typeof src.chipColor === 'string' && HEX_COLOR_RE.test(src.chipColor)) cfg.chipColor = src.chipColor;
  if (src.showBadge === false) cfg.showBadge = false;

  return cfg;
}

/** Pure: find the tier mult for a given cluster size. Returns 1 when
 * no tier matches (safe identity multiplier). */
export function tierMultForSize(tiers, size) {
  if (!Array.isArray(tiers) || tiers.length === 0) return 1;
  const s = Number(size);
  if (!Number.isFinite(s)) return 1;
  for (const t of tiers) {
    if (s >= t.minSize && s <= t.maxSize) return t.multX;
  }
  return 1;
}

export function emitClusterSizeMultiplierCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ clusterSizeMultiplier: cfg });
  if (!c.enabled) return `\n/* clusterSizeMultiplier BLOCK (disabled) — no CSS */\n`;
  return `
/* ── clusterSizeMultiplier BLOCK — src/blocks/clusterSizeMultiplier.mjs ── */
.csm-badge {
  position: absolute;
  top: 2px;
  left: 50%;
  transform: translateX(-50%);
  font: 800 14px/1 system-ui, -apple-system, sans-serif;
  color: ${c.chipColor};
  text-shadow: 0 2px 6px rgba(0,0,0,0.8);
  background: rgba(10, 18, 14, 0.75);
  padding: 3px 9px;
  border-radius: 12px;
  border: 1px solid ${c.chipColor};
  z-index: 8;
  pointer-events: none;
  opacity: 0;
  transition: opacity 240ms ease, transform 240ms ease;
}
.csm-badge.is-visible {
  opacity: 1;
  transform: translateX(-50%) translateY(2px) scale(1.05);
  animation: csm-pulse 1.4s ease-in-out forwards;
}
@keyframes csm-pulse {
  0%   { transform: translateX(-50%) scale(0.5); opacity: 0; }
  30%  { transform: translateX(-50%) scale(1.2); opacity: 1; }
  90%  { transform: translateX(-50%) scale(1);   opacity: 1; }
  100% { transform: translateX(-50%) scale(1);   opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .csm-badge.is-visible { animation: none; opacity: 1; }
}
`;
}

export function emitClusterSizeMultiplierRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ clusterSizeMultiplier: cfg });
  if (!c.enabled) return `\n// clusterSizeMultiplier BLOCK (disabled) — no runtime\n`;

  const tiersJs = JSON.stringify(c.tiers);

  return `
/* ── clusterSizeMultiplier BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__CLUSTER_SIZE_MULT_WIRED__) return;
  window.__CLUSTER_SIZE_MULT_WIRED__ = true;

  var TIERS = ${tiersJs};
  var SHOW_BADGE = ${c.showBadge};

  window.CLUSTER_SIZE_MULT_STATE = { lastSize: 0, lastMult: 1 };

  function _tier(size) {
    for (var i = 0; i < TIERS.length; i++) {
      if (size >= TIERS[i].minSize && size <= TIERS[i].maxSize) return TIERS[i].multX;
    }
    return 1;
  }

  function _showBadgeAt(cellEl, value) {
    if (!SHOW_BADGE || !cellEl) return;
    var badge = document.createElement('div');
    badge.className = 'csm-badge';
    badge.textContent = 'x' + value;
    badge.setAttribute('aria-label', 'Cluster multiplier ' + value + ' times');
    badge.setAttribute('role', 'status');
    cellEl.appendChild(badge);
    requestAnimationFrame(function() { badge.classList.add('is-visible'); });
    setTimeout(function() { try { badge.remove(); } catch (_) {} }, 1500);
  }

  function _onClusterPay(payload) {
    if (!payload || typeof payload !== 'object') return;
    var size = Number(payload.clusterSize || payload.size || (Array.isArray(payload.cells) ? payload.cells.length : 0));
    if (!Number.isFinite(size) || size <= 0) return;
    var mult = _tier(size);
    window.CLUSTER_SIZE_MULT_STATE.lastSize = size;
    window.CLUSTER_SIZE_MULT_STATE.lastMult = mult;
    if (mult > 1 && window.HookBus && typeof window.HookBus.setMult === 'function') {
      var current = (window.HookBus.lastMult || 1);
      window.HookBus.setMult(current * mult);
    }
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try { window.HookBus.emit('onClusterSizeMultiplierApplied', { clusterSize: size, multX: mult }); } catch (_) {}
    }
    /* Badge on the first cell of the cluster (or center). */
    if (mult > 1 && Array.isArray(payload.cells) && payload.cells.length > 0) {
      var anchor = payload.cells[0];
      var sel = '.cell[data-reel="' + (anchor.reel || anchor.r || '') + '"][data-row="' + (anchor.row || '') + '"]';
      var cellEl = document.querySelector(sel);
      if (!cellEl) {
        var allCells = document.querySelectorAll('.cell');
        cellEl = allCells[0];
      }
      _showBadgeAt(cellEl, mult);
    }
  }

  function _clear() {
    window.CLUSTER_SIZE_MULT_STATE.lastSize = 0;
    window.CLUSTER_SIZE_MULT_STATE.lastMult = 1;
    var badges = document.querySelectorAll('.csm-badge');
    for (var i = 0; i < badges.length; i++) { try { badges[i].remove(); } catch (_) {} }
  }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('onClusterPay', _onClusterPay, { priority: 28 });
    window.HookBus.on('preSpin',      _clear,        { priority: 28 });
  }
})();
`;
}
