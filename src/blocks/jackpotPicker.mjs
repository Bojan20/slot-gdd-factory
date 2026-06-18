/**
 * src/blocks/jackpotPicker.mjs
 *
 * Wave LEGO-JPK — Jackpot Picker (N×M tile reveal grid, pick-K-of-N).
 *
 * Purpose
 * ───────
 *   Industry-reference "jackpot pick reveal grid" feature. On a trigger
 *   event the player is shown an N×M grid of unrevealed tiles, clicks
 *   K configurable tiles, and each tile flips to reveal a weighted-random
 *   jackpot tier (MINI/MINOR/MAJOR/GRAND). After K picks the final award
 *   is determined as the highest tier among the revealed picks. Distinct
 *   from:
 *     • bonusPick               (single pick → single prize)
 *     • pickBonusReveal         (post-resolution reveal banner only)
 *     • wheelBonusReveal        (rotational wheel, not tile grid)
 *     • dailyJackpot            (timer-bound progressive jackpot HUD)
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   Classic "pick-3-of-12 jackpot grid" reveal — tiles flip individually,
 *   each carries a weighted jackpot tier; the highest revealed tier wins.
 *   An optional auto-pick / debug mode resolves all K picks in sequence
 *   without manual click.
 *
 * Public API (server-side, ES module)
 * ──────────────────────────────────
 *   defaultConfig()
 *   resolveConfig(model)
 *   emitJackpotPickerCSS(cfg)
 *   emitJackpotPickerMarkup(cfg)
 *   emitJackpotPickerRuntime(cfg)
 *   pickTierFromDistribution(distribution, rng)   (pure helper, exported for tests)
 *   computeFinalTier(picks, distribution)         (pure helper, exported for tests)
 *
 * Lifecycle (HookBus contract)
 * ────────────────────────────
 *   subscribes:
 *     • onJackpotPickerTrigger (priority 30) — mount overlay, attach handlers
 *     • preSpin                (priority 30) — force-dismiss overlay
 *     • onSkipRequested        (priority 30) — fast-forward / dismiss
 *   emits:
 *     • onJackpotPickerTileRevealed { tile, tier, value }
 *     • onJackpotPickerComplete     { picks, finalTier }
 *     • onJackpotPickerDismissed    { reason }
 *
 * Runtime contract
 * ────────────────
 *   window.JPK_STATE = { picks: Array, finalTier: string|null, active: boolean }
 *
 * GDD config keys (model.jackpotPicker)
 * ─────────────────────────────────────
 *   { enabled, gridCols: 2..8, gridRows: 2..8, picksRequired: 1..5,
 *     distribution: [{tier, weight, value}, …],
 *     appliesIn: 'hw'|'bonus'|'both',
 *     pickAnimMs: 200..2000, dismissDelayMs: 0..5000,
 *     glowColor: hex, tileColor: hex, fontSizePx: 12..32,
 *     autoPickMode: boolean }
 *
 * Performance budget: ≤ 0.5 ms per tile reveal; 1 listener per event
 * (wired-once via window.__JPK_WIRED__). Overlay mount cost O(N*M).
 *
 * a11y: overlay is role=dialog + aria-modal=true; tiles are role=button
 * with aria-pressed; prefers-reduced-motion neutralises flip keyframe.
 *
 * Vendor-neutral, senior-grade, pure presentation + weighted draw. No
 * jurisdiction-specific math or RTP commitments — distribution is GDD-
 * driven and the host evaluator owns final settlement.
 */

const APPLIES_IN          = Object.freeze(['hw', 'bonus', 'both']);
const GRID_COLS_MIN       = 2;
const GRID_COLS_MAX       = 8;
const GRID_ROWS_MIN       = 2;
const GRID_ROWS_MAX       = 8;
const PICKS_REQUIRED_MIN  = 1;
const PICKS_REQUIRED_MAX  = 5;
const PICK_ANIM_MIN_MS    = 200;
const PICK_ANIM_MAX_MS    = 2000;
const DISMISS_DELAY_MIN_MS = 0;
const DISMISS_DELAY_MAX_MS = 5000;
const FONT_SIZE_MIN_PX    = 12;
const FONT_SIZE_MAX_PX    = 32;

const HEX_COLOR_RE        = /^#[0-9a-fA-F]{3,8}$/;

const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));

const DEFAULT_DISTRIBUTION = Object.freeze([
  { tier: 'MINI',  weight: 60, value:    10 },
  { tier: 'MINOR', weight: 25, value:    50 },
  { tier: 'MAJOR', weight: 12, value:   250 },
  { tier: 'GRAND', weight:  3, value:  1000 },
]);

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    gridCols: 4,
    gridRows: 3,
    picksRequired: 3,
    distribution: DEFAULT_DISTRIBUTION.map(e => ({ ...e })),
    appliesIn: 'bonus',
    pickAnimMs: 500,
    dismissDelayMs: 1500,
    glowColor: '#ffaa00',
    tileColor: '#222222',
    fontSizePx: 18,
    autoPickMode: false,
  });
}

function isValidDistribution(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return false;
  for (const e of arr) {
    if (!e || typeof e !== 'object') return false;
    if (typeof e.tier !== 'string' || e.tier.length === 0) return false;
    const w = Number(e.weight);
    const v = Number(e.value);
    if (!Number.isFinite(w) || w <= 0) return false;
    if (!Number.isFinite(v) || v < 0) return false;
  }
  return true;
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  cfg.distribution = cfg.distribution.map(e => ({ ...e }));
  const src = (model && model.jackpotPicker) || {};

  if (src.enabled === true) cfg.enabled = true;

  if (Number.isFinite(src.gridCols)) {
    cfg.gridCols = clampInt(src.gridCols, GRID_COLS_MIN, GRID_COLS_MAX);
  }
  if (Number.isFinite(src.gridRows)) {
    cfg.gridRows = clampInt(src.gridRows, GRID_ROWS_MIN, GRID_ROWS_MAX);
  }

  if (Number.isFinite(src.picksRequired)) {
    cfg.picksRequired = clampInt(src.picksRequired, PICKS_REQUIRED_MIN, PICKS_REQUIRED_MAX);
  }

  if (isValidDistribution(src.distribution)) {
    cfg.distribution = src.distribution.map(e => ({
      tier:   String(e.tier),
      weight: Number(e.weight),
      value:  Number(e.value),
    }));
  }

  if (typeof src.appliesIn === 'string' && APPLIES_IN.includes(src.appliesIn)) {
    cfg.appliesIn = src.appliesIn;
  }

  if (Number.isFinite(src.pickAnimMs)) {
    cfg.pickAnimMs = clampInt(src.pickAnimMs, PICK_ANIM_MIN_MS, PICK_ANIM_MAX_MS);
  }
  if (Number.isFinite(src.dismissDelayMs)) {
    cfg.dismissDelayMs = clampInt(src.dismissDelayMs, DISMISS_DELAY_MIN_MS, DISMISS_DELAY_MAX_MS);
  }

  if (typeof src.glowColor === 'string' && HEX_COLOR_RE.test(src.glowColor)) {
    cfg.glowColor = src.glowColor;
  }
  if (typeof src.tileColor === 'string' && HEX_COLOR_RE.test(src.tileColor)) {
    cfg.tileColor = src.tileColor;
  }

  if (Number.isFinite(src.fontSizePx)) {
    cfg.fontSizePx = clampInt(src.fontSizePx, FONT_SIZE_MIN_PX, FONT_SIZE_MAX_PX);
  }

  if (src.autoPickMode === true) cfg.autoPickMode = true;

  /* Invariant: picksRequired MUST NOT exceed total tile count, else the
   * pick game can never resolve. Clamp down silently — senior-grade
   * defensive rather than throwing at config-time, since GDD authors may
   * shrink the grid without updating picksRequired. */
  const totalTiles = cfg.gridCols * cfg.gridRows;
  if (cfg.picksRequired > totalTiles) cfg.picksRequired = totalTiles;

  return cfg;
}

/**
 * Pure helper: weighted-random pick from a distribution. Accepts an RNG
 * so tests can use a deterministic seed; defaults to Math.random.
 *
 * @param {Array<{tier:string,weight:number,value:number}>} distribution
 * @param {() => number} rng
 * @returns {{tier:string,weight:number,value:number}|null}
 */
export function pickTierFromDistribution(distribution, rng = Math.random) {
  if (!Array.isArray(distribution) || distribution.length === 0) return null;
  const total = distribution.reduce((s, e) => s + (e.weight > 0 ? e.weight : 0), 0);
  if (total <= 0) return distribution[0];
  let r = rng() * total;
  for (const e of distribution) {
    r -= e.weight;
    if (r <= 0) return e;
  }
  return distribution[distribution.length - 1];
}

/**
 * Pure helper: compute the "highest" tier across an array of picks. Tier
 * ranking is derived from distribution order: the LAST tier in the
 * configured distribution outranks the first (industry convention — the
 * lowest-weighted GRAND sits at the bottom of the distribution array as
 * the rarest, highest award). Returns the highest tier label, or null
 * when the picks array is empty.
 *
 * @param {Array<{tier:string,value?:number}>} picks
 * @param {Array<{tier:string}>} distribution
 * @returns {string|null}
 */
export function computeFinalTier(picks, distribution) {
  if (!Array.isArray(picks) || picks.length === 0) return null;
  if (!Array.isArray(distribution) || distribution.length === 0) return null;

  const rank = new Map();
  for (let i = 0; i < distribution.length; i++) {
    rank.set(distribution[i].tier, i);
  }

  let bestTier = null;
  let bestRank = -1;
  for (const p of picks) {
    if (!p || typeof p.tier !== 'string') continue;
    const r = rank.has(p.tier) ? rank.get(p.tier) : -1;
    if (r > bestRank) {
      bestRank = r;
      bestTier = p.tier;
    }
  }
  return bestTier;
}

export function emitJackpotPickerCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ jackpotPicker: cfg });
  if (!c.enabled) return `\n/* jackpotPicker BLOCK (disabled) — no CSS */\n`;
  return `
/* ── jackpotPicker BLOCK — src/blocks/jackpotPicker.mjs ── */
.jpk-overlay {
  position: fixed;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,0.78);
  z-index: 120;
  opacity: 0;
  transition: opacity 200ms ease;
}
.jpk-overlay.is-active {
  display: flex;
  opacity: 1;
}
.jpk-board {
  display: grid;
  grid-template-columns: repeat(${c.gridCols}, 1fr);
  grid-template-rows: repeat(${c.gridRows}, 1fr);
  gap: 8px;
  padding: 16px;
  max-width: min(90vw, 640px);
  max-height: min(80vh, 480px);
  background: rgba(20,20,30,0.92);
  border-radius: 12px;
  box-shadow: 0 0 32px ${c.glowColor}aa;
}
.jpk-tile {
  position: relative;
  min-width: 64px;
  min-height: 64px;
  background: ${c.tileColor};
  color: ${c.glowColor};
  border: 2px solid ${c.glowColor}55;
  border-radius: 8px;
  font: 900 ${c.fontSizePx}px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  user-select: none;
  transition: transform 150ms ease, border-color 150ms ease;
}
.jpk-tile:hover:not(.is-revealed):not([aria-disabled="true"]) {
  transform: scale(1.04);
  border-color: ${c.glowColor};
}
.jpk-tile.is-revealing {
  animation: jpk-flip ${c.pickAnimMs}ms ease-out forwards;
}
.jpk-tile.is-revealed {
  background: ${c.glowColor};
  color: #111;
  border-color: ${c.glowColor};
  text-shadow: 0 0 8px rgba(255,255,255,0.4);
  cursor: default;
}
.jpk-tile[aria-disabled="true"] {
  cursor: not-allowed;
  opacity: 0.7;
}
@keyframes jpk-flip {
  0%   { transform: rotateY(0deg)   scale(1);   }
  50%  { transform: rotateY(90deg)  scale(1.05); }
  100% { transform: rotateY(0deg)   scale(1);   }
}
@media (prefers-reduced-motion: reduce) {
  .jpk-overlay { transition: none; }
  .jpk-tile.is-revealing { animation: none; }
}
`;
}

export function emitJackpotPickerMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ jackpotPicker: cfg });
  if (!c.enabled) return `\n<!-- jackpotPicker BLOCK (disabled) -->\n`;
  return `
<!-- jackpotPicker BLOCK — server-emitted shell, tiles mounted at runtime -->
<div class="jpk-overlay" id="jpkOverlay" role="dialog" aria-modal="true" aria-label="Jackpot picker" aria-hidden="true">
  <div class="jpk-board" id="jpkBoard"></div>
</div>
`;
}

export function emitJackpotPickerRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ jackpotPicker: cfg });
  if (!c.enabled) return `\n// jackpotPicker BLOCK (disabled) — no runtime\n`;

  const distJson       = JSON.stringify(c.distribution);
  const gridCols       = c.gridCols;
  const gridRows       = c.gridRows;
  const picksRequired  = c.picksRequired;
  const appliesIn      = JSON.stringify(c.appliesIn);
  const pickAnimMs     = c.pickAnimMs;
  const dismissDelayMs = c.dismissDelayMs;
  const autoPickMode   = c.autoPickMode ? 'true' : 'false';

  return `
/* ── jackpotPicker BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__JPK_WIRED__) return;
  window.__JPK_WIRED__ = true;

  var DIST            = ${distJson};
  var GRID_COLS       = ${gridCols};
  var GRID_ROWS       = ${gridRows};
  var PICKS_REQUIRED  = ${picksRequired};
  var APPLIES_IN      = ${appliesIn};
  var PICK_ANIM_MS    = ${pickAnimMs};
  var DISMISS_DELAY_MS = ${dismissDelayMs};
  var AUTO_PICK_MODE  = ${autoPickMode};

  window.JPK_STATE = {
    picks: [],
    finalTier: null,
    active: false,
  };

  function _rng() {
    if (window.GameRNG && typeof window.GameRNG.next === 'function') return window.GameRNG.next();
    return Math.random();
  }

  function _pickTier() {
    var total = 0;
    for (var i = 0; i < DIST.length; i++) total += (DIST[i].weight > 0 ? DIST[i].weight : 0);
    if (total <= 0) return DIST[0];
    var r = _rng() * total;
    for (var j = 0; j < DIST.length; j++) {
      r -= DIST[j].weight;
      if (r <= 0) return DIST[j];
    }
    return DIST[DIST.length - 1];
  }

  function _computeFinal(picks) {
    if (!picks || picks.length === 0) return null;
    var rank = {};
    for (var i = 0; i < DIST.length; i++) rank[DIST[i].tier] = i;
    var bestTier = null;
    var bestRank = -1;
    for (var k = 0; k < picks.length; k++) {
      var t = picks[k].tier;
      var rr = (typeof rank[t] === 'number') ? rank[t] : -1;
      if (rr > bestRank) { bestRank = rr; bestTier = t; }
    }
    return bestTier;
  }

  function _isFsActive() {
    if (window.FSM && typeof window.FSM === 'object') {
      var st = window.FSM.state || window.FSM.phase;
      if (st && /^FS_/.test(st)) return true;
    }
    if (window.__SLOT_FSM_STATE && /^FS_/.test(window.__SLOT_FSM_STATE)) return true;
    if (window.FREESPINS && window.FREESPINS.remaining > 0) return true;
    return false;
  }

  function _isHwActive() {
    if (window.HW_STATE && window.HW_STATE.active === true) return true;
    if (window.__SLOT_FSM_STATE && /^HW_/.test(window.__SLOT_FSM_STATE)) return true;
    return false;
  }

  function _isBonusFsm() {
    /* QA sweep (2026-06-18): "bonus" branch must NOT default-true on
     * idle/base. A genuine bonus context is either an active FS round
     * or a non-BASE FSM phase ('BONUS_', 'PICK_', 'BUY_'). */
    if (window.FSM && typeof window.FSM === 'object') {
      var st = window.FSM.state || window.FSM.phase || '';
      if (/^(FS_|BONUS_|PICK_|BUY_)/.test(st)) return true;
    }
    if (window.__SLOT_FSM_STATE && /^(FS_|BONUS_|PICK_|BUY_)/.test(window.__SLOT_FSM_STATE)) return true;
    if (window.FREESPINS && window.FREESPINS.remaining > 0) return true;
    return false;
  }

  function _appliesNow() {
    if (APPLIES_IN === 'hw')    return _isHwActive();
    if (APPLIES_IN === 'bonus') return _isBonusFsm() && !_isHwActive();
    return _isHwActive() || _isBonusFsm(); /* both */
  }

  function _buildBoard() {
    var board = document.getElementById('jpkBoard');
    if (!board) return;
    board.innerHTML = '';
    var total = GRID_COLS * GRID_ROWS;
    for (var i = 0; i < total; i++) {
      var tile = document.createElement('div');
      tile.className = 'jpk-tile';
      tile.setAttribute('role', 'button');
      tile.setAttribute('aria-pressed', 'false');
      tile.setAttribute('tabindex', '0');
      tile.setAttribute('data-jpk-tile', String(i));
      tile.textContent = '?';
      tile.addEventListener('click', _onTileClick);
      tile.addEventListener('keydown', function(ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          _onTileClick.call(this, ev);
        }
      });
      board.appendChild(tile);
    }
  }

  function _onTileClick(ev) {
    if (!window.JPK_STATE.active) return;
    var node = ev.currentTarget || this;
    if (!node) return;
    if (node.classList.contains('is-revealed') || node.getAttribute('aria-disabled') === 'true') return;
    var idx = parseInt(node.getAttribute('data-jpk-tile'), 10);
    if (!Number.isFinite(idx)) return;
    _revealTile(idx, node);
  }

  function _revealTile(idx, node) {
    var entry = _pickTier();
    node.classList.add('is-revealing');
    node.setAttribute('aria-pressed', 'true');
    setTimeout(function() {
      node.classList.remove('is-revealing');
      node.classList.add('is-revealed');
      node.textContent = entry.tier;
      if (window.HookBus && typeof window.HookBus.emit === 'function') {
        try {
          window.HookBus.emit('onJackpotPickerTileRevealed', {
            tile:  idx,
            tier:  entry.tier,
            value: entry.value,
          });
        } catch (_) {}
      }
      window.JPK_STATE.picks.push({ tile: idx, tier: entry.tier, value: entry.value });
      var picksTarget = (window.JPK_STATE.picksThisRound > 0) ? window.JPK_STATE.picksThisRound : PICKS_REQUIRED;
      if (window.JPK_STATE.picks.length >= picksTarget) {
        _complete();
      }
    }, PICK_ANIM_MS);
  }

  function _disableRemaining() {
    var board = document.getElementById('jpkBoard');
    if (!board) return;
    var tiles = board.querySelectorAll('.jpk-tile:not(.is-revealed)');
    for (var i = 0; i < tiles.length; i++) {
      tiles[i].setAttribute('aria-disabled', 'true');
    }
  }

  function _complete() {
    _disableRemaining();
    var finalTier = _computeFinal(window.JPK_STATE.picks);
    window.JPK_STATE.finalTier = finalTier;
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onJackpotPickerComplete', {
          picks:     window.JPK_STATE.picks.slice(),
          finalTier: finalTier,
        });
      } catch (_) {}
    }
    setTimeout(function() { _dismiss('complete'); }, DISMISS_DELAY_MS);
  }

  function _autoPick() {
    var board = document.getElementById('jpkBoard');
    if (!board) return;
    var remaining = (window.JPK_STATE && window.JPK_STATE.picksThisRound > 0) ? window.JPK_STATE.picksThisRound : PICKS_REQUIRED;
    var attempt = 0;
    function tick() {
      if (remaining <= 0) return;
      var tiles = board.querySelectorAll('.jpk-tile:not(.is-revealed):not(.is-revealing)');
      if (tiles.length === 0) return;
      var rnd = Math.floor(_rng() * tiles.length);
      var node = tiles[rnd];
      var idx = parseInt(node.getAttribute('data-jpk-tile'), 10);
      if (Number.isFinite(idx)) {
        _revealTile(idx, node);
        remaining--;
      }
      attempt++;
      if (remaining > 0 && attempt < 50) {
        setTimeout(tick, PICK_ANIM_MS + 50);
      }
    }
    tick();
  }

  function _mount() {
    if (!_appliesNow()) return;
    if (window.JPK_STATE.active) return;
    window.JPK_STATE.active = true;
    window.JPK_STATE.picks = [];
    window.JPK_STATE.finalTier = null;
    var overlay = document.getElementById('jpkOverlay');
    if (!overlay) return;
    _buildBoard();
    overlay.classList.add('is-active');
    overlay.setAttribute('aria-hidden', 'false');
    if (AUTO_PICK_MODE) {
      _autoPick();
    }
  }

  function _dismiss(reason) {
    if (!window.JPK_STATE.active) return;
    window.JPK_STATE.active = false;
    /* QA sweep (2026-06-18): clear per-mount picksThisRound so the
     * NEXT trigger without explicit payload falls back to the
     * config-default PICKS_REQUIRED instead of inheriting the prior
     * override. */
    window.JPK_STATE.picksThisRound = 0;
    var overlay = document.getElementById('jpkOverlay');
    if (overlay) {
      overlay.classList.remove('is-active');
      overlay.setAttribute('aria-hidden', 'true');
    }
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onJackpotPickerDismissed', { reason: reason || 'dismissed' });
      } catch (_) {}
    }
  }

  function _onTrigger(payload) {
    /* QA sweep (2026-06-18): payload.picks override is per-mount only.
     * Use a STATE-scoped picksThisRound (cleared in _dismiss) instead
     * of rebinding the closure-scoped PICKS_REQUIRED — that would leak
     * the override into the NEXT trigger if dismissed without explicit
     * payload. */
    var override = (payload && Number.isFinite(payload.picks)) ? Math.trunc(payload.picks) : null;
    var clamped  = (override && override > 0 && override <= GRID_COLS * GRID_ROWS) ? override : PICKS_REQUIRED;
    window.JPK_STATE = window.JPK_STATE || {};
    window.JPK_STATE.picksThisRound = clamped;
    _mount();
  }

  function _onPreSpin() {
    _dismiss('preSpin');
  }

  function _onSkip() {
    _dismiss('skip');
  }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('onJackpotPickerTrigger', _onTrigger, { priority: 30 });
    window.HookBus.on('preSpin',                _onPreSpin, { priority: 30 });
    window.HookBus.on('onSkipRequested',        _onSkip,    { priority: 30 });
  }
})();
`;
}
