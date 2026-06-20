/**
 * src/blocks/holdAndWinFrameMultiplier.mjs
 *
 * Wave LEGO-HW2 — Frozen Frame Multiplier for Hold & Win respin rounds.
 *
 * Purpose
 * ───────
 *   In some Hold & Win formats each locked bonus cell carries its OWN
 *   persistent FRAME tier (1×/2×/3×/5×/10×…). The tier sticks to the
 *   cell across every remaining respin. When ANOTHER bonus orb lands on
 *   an already-locked cell, that cell's tier BUMPS up one ladder step.
 *   At round-end, the bucket value of each cell is multiplied by its
 *   final frame tier — payouts therefore scale with how often a cell
 *   gets re-hit during the respin sequence. Distinct from:
 *     • multiplierOrb        (per-cell symbol-bound, one-shot)
 *     • multiplierLadder     (round-global progressive)
 *     • persistentMultiplier (round-global accumulator)
 *     • perFsSpinMultiplier  (per-spin rolling, FS-only)
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   "Frame persistence" pattern — chip rendered in a cell corner,
 *   visually distinct from the bucket value, bumps on re-land, persists
 *   through every respin until the round closes.
 *
 * Public API (server-side, ES module)
 * ──────────────────────────────────
 *   defaultConfig()
 *   resolveConfig(model)
 *   emitHoldAndWinFrameMultiplierCSS(cfg)
 *   emitHoldAndWinFrameMultiplierMarkup(cfg)
 *   emitHoldAndWinFrameMultiplierRuntime(cfg)
 *   tierBumpForLanding(currentTier, ladder)   (pure helper, exported for tests)
 *
 * Lifecycle (HookBus contract)
 * ────────────────────────────
 *   subscribes:
 *     • onHoldAndWinIntro  (priority 30) — init FRAME_MULT_STATE
 *     • onHoldAndWinLock   (priority 30) — assign tier 1 or bump existing
 *     • onHoldAndWinEnd    (priority 30) — compute totalProduct, emit final, clear
 *     • preSpin            (priority 30) — defensive clear if stale state survived
 *   emits:
 *     • onFrameMultiplierBumped { cellId, oldTier, newTier }
 *     • onFrameMultiplierFinal  { tiers, totalProduct }
 *
 * Runtime contract
 * ────────────────
 *   window.FRAME_MULT_STATE = { tiers: Map<HTMLElement, number>, ladder: number[] }
 *   HW guard: ALL listeners short-circuit unless `window.HW_STATE.active === true`.
 *
 * GDD config keys (model.holdAndWinFrameMultiplier)
 * ─────────────────────────────────────────────────
 *   { enabled, tierLadder: number[2..12],
 *     bumpOnReLand, showChip,
 *     chipPosition: 'topRight'|'topLeft'|'bottomRight'|'bottomLeft',
 *     chipColor, fontSizePx, durationMs }
 *
 * Performance budget: ≤ 0.2 ms per lock event on a 5×4 grid; 1 listener
 * per event (wired-once via `window.__HW_FRAME_MULT_WIRED__`).
 *
 * a11y: chip uses aria-label="frame multiplier <N> times"; respects
 * prefers-reduced-motion (suppresses pop-in keyframe).
 *
 * Vendor-neutral, senior-grade, pure presentation + tier ladder math.
 * No payout coupling beyond emitting the final tiers map to HookBus.
 */

const CHIP_POSITIONS = Object.freeze(['center', 'topRight', 'topLeft', 'bottomRight', 'bottomLeft']);

const FONT_SIZE_MIN = 8;
const FONT_SIZE_MAX = 24;
const DURATION_MIN_MS = 200;
const DURATION_MAX_MS = 3000;

const LADDER_MIN_LEN = 2;
const LADDER_MAX_LEN = 12;

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));

const DEFAULT_LADDER = Object.freeze([1, 2, 3, 5, 10]);

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    tierLadder: DEFAULT_LADDER.slice(),
    bumpOnReLand: true,
    showChip: true,
    /* D-14.5 PRESENTATION ALIGN (2026-06-20): default center placement
       per industry hold-and-win baseline. Corner positions stay valid
       via explicit GDD opt-in. */
    chipPosition: 'center',
    chipColor: '#ffd966',
    fontSizePx: 14,
    durationMs: 800,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig(), tierLadder: DEFAULT_LADDER.slice() };
  const src = (model && model.holdAndWinFrameMultiplier) || {};

  if (src.enabled === true) cfg.enabled = true;

  if (Array.isArray(src.tierLadder)) {
    const filtered = src.tierLadder
      .map(v => Number(v))
      .filter(v => Number.isFinite(v) && v >= 1);
    if (filtered.length >= LADDER_MIN_LEN && filtered.length <= LADDER_MAX_LEN) {
      cfg.tierLadder = filtered;
    }
  }

  if (src.bumpOnReLand === false) cfg.bumpOnReLand = false;
  if (src.showChip === false) cfg.showChip = false;

  if (typeof src.chipPosition === 'string' && CHIP_POSITIONS.includes(src.chipPosition)) {
    cfg.chipPosition = src.chipPosition;
  }

  if (typeof src.chipColor === 'string' && HEX_COLOR_RE.test(src.chipColor)) {
    cfg.chipColor = src.chipColor;
  }

  if (Number.isFinite(src.fontSizePx)) {
    cfg.fontSizePx = clampInt(src.fontSizePx, FONT_SIZE_MIN, FONT_SIZE_MAX);
  }

  if (Number.isFinite(src.durationMs)) {
    cfg.durationMs = clampInt(src.durationMs, DURATION_MIN_MS, DURATION_MAX_MS);
  }

  return cfg;
}

/**
 * Pure tier-bump helper.
 *
 * Given the current tier value held by a cell and the ordered ladder,
 * returns the NEXT step value. If the current value is the highest
 * ladder rung (or above), the function returns the highest rung
 * unchanged — no overflow. If the current value is not on the ladder,
 * the function returns the first rung that is strictly greater (or the
 * top rung when nothing is greater). If the ladder is empty/invalid,
 * returns the current tier untouched (defensive).
 */
export function tierBumpForLanding(currentTier, ladder) {
  if (!Array.isArray(ladder) || ladder.length === 0) return currentTier;
  const top = ladder[ladder.length - 1];
  if (!Number.isFinite(currentTier)) return ladder[0];
  if (currentTier >= top) return top;
  for (let i = 0; i < ladder.length; i++) {
    if (ladder[i] > currentTier) return ladder[i];
  }
  return top;
}

function positionCss(pos) {
  /* D-14.5 PRESENTATION ALIGN (2026-06-20): industry baseline (hold-and-
     win cash-on-reels pattern) places the multiplier value chip DEAD-
     CENTER of the orb cell so the value reads at a glance across the
     whole reel set. The corner positions stay supported for legacy GDDs
     that explicitly opt into them; 'center' is the new default. */
  switch (pos) {
    case 'topLeft':     return 'top: 4px; left: 4px;';
    case 'bottomRight': return 'bottom: 4px; right: 4px;';
    case 'bottomLeft':  return 'bottom: 4px; left: 4px;';
    case 'topRight':    return 'top: 4px; right: 4px;';
    case 'center':
    default:            return 'top: 50%; left: 50%; transform: translate(-50%, -50%);';
  }
}

export function emitHoldAndWinFrameMultiplierCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ holdAndWinFrameMultiplier: cfg });
  if (!c.enabled) return `\n/* holdAndWinFrameMultiplier BLOCK (disabled) — no CSS */\n`;
  return `
/* ── holdAndWinFrameMultiplier BLOCK — src/blocks/holdAndWinFrameMultiplier.mjs ── */
.hwfm-chip {
  position: absolute;
  ${positionCss(c.chipPosition)}
  font: 800 ${c.fontSizePx}px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: ${c.chipColor};
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid ${c.chipColor};
  border-radius: 4px;
  padding: 2px 5px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  pointer-events: none;
  z-index: 65;
  opacity: 0;
  transform: scale(0.7);
  transition: opacity 200ms ease, transform 200ms ease;
}
.hwfm-chip.is-visible {
  opacity: 1;
  transform: scale(1);
}
.hwfm-chip.is-bumped {
  animation: hwfm-bump ${Math.min(c.durationMs, 1200)}ms ease-out;
}
@keyframes hwfm-bump {
  0%   { transform: scale(1);   filter: brightness(1); }
  35%  { transform: scale(1.55); filter: brightness(2.2); }
  100% { transform: scale(1);   filter: brightness(1); }
}
@media (prefers-reduced-motion: reduce) {
  .hwfm-chip,
  .hwfm-chip.is-bumped { animation: none; transition: none; }
  .hwfm-chip.is-visible { opacity: 1; transform: none; }
}
`;
}

export function emitHoldAndWinFrameMultiplierMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ holdAndWinFrameMultiplier: cfg });
  if (!c.enabled) return `\n<!-- holdAndWinFrameMultiplier BLOCK (disabled) -->\n`;
  return `
<!-- holdAndWinFrameMultiplier BLOCK — server-emitted markup -->
<!-- Chips are mounted at runtime per-cell; no static DOM required. -->
`;
}

export function emitHoldAndWinFrameMultiplierRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ holdAndWinFrameMultiplier: cfg });
  if (!c.enabled) return `\n// holdAndWinFrameMultiplier BLOCK (disabled) — no runtime\n`;

  const ladderJson = JSON.stringify(c.tierLadder);

  return `
/* ── holdAndWinFrameMultiplier BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__HW_FRAME_MULT_WIRED__) return;
  window.__HW_FRAME_MULT_WIRED__ = true;

  var LADDER       = ${ladderJson};
  var BUMP_ON_RELAND = ${c.bumpOnReLand ? 'true' : 'false'};
  var SHOW_CHIP    = ${c.showChip ? 'true' : 'false'};
  var DURATION_MS  = ${c.durationMs};

  window.FRAME_MULT_STATE = {
    tiers: new Map(),
    ladder: LADDER.slice(),
  };

  function _isHwActive() {
    return !!(window.HW_STATE && window.HW_STATE.active === true);
  }

  function _bump(curr) {
    if (!Number.isFinite(curr)) return LADDER[0];
    var top = LADDER[LADDER.length - 1];
    if (curr >= top) return top;
    for (var i = 0; i < LADDER.length; i++) {
      if (LADDER[i] > curr) return LADDER[i];
    }
    return top;
  }

  function _cellIdOf(cellEl) {
    if (!cellEl) return null;
    if (cellEl.id) return cellEl.id;
    if (cellEl.dataset && cellEl.dataset.cellId) return cellEl.dataset.cellId;
    var r = cellEl.dataset && cellEl.dataset.row;
    var col = cellEl.dataset && cellEl.dataset.col;
    if (r != null && col != null) return 'r' + r + 'c' + col;
    return null;
  }

  function _mountChip(cellEl, tier) {
    if (!SHOW_CHIP || !cellEl) return;
    if (getComputedStyle(cellEl).position === 'static') {
      cellEl.style.position = 'relative';
    }
    var chip = cellEl.querySelector(':scope > .hwfm-chip');
    var bumped = !!chip;
    if (!chip) {
      chip = document.createElement('div');
      chip.className = 'hwfm-chip';
      cellEl.appendChild(chip);
    }
    chip.textContent = 'x' + tier;
    chip.setAttribute('aria-label', 'frame multiplier ' + tier + ' times');
    chip.classList.add('is-visible');
    if (bumped) {
      chip.classList.remove('is-bumped');
      void chip.offsetWidth; /* restart anim */
      chip.classList.add('is-bumped');
      setTimeout(function() {
        if (chip && chip.classList) chip.classList.remove('is-bumped');
      }, DURATION_MS);
    }
  }

  function _emit(event, payload) {
    if (!window.HookBus || typeof window.HookBus.emit !== 'function') return;
    try { window.HookBus.emit(event, payload); } catch (_) {}
  }

  function _clear() {
    if (window.FRAME_MULT_STATE && window.FRAME_MULT_STATE.tiers) {
      window.FRAME_MULT_STATE.tiers.forEach(function(_, cellEl) {
        if (cellEl && cellEl.querySelector) {
          var chip = cellEl.querySelector(':scope > .hwfm-chip');
          if (chip && chip.parentNode) chip.parentNode.removeChild(chip);
        }
      });
      window.FRAME_MULT_STATE.tiers.clear();
    }
  }

  function _onIntro() {
    if (!_isHwActive()) return;
    _clear();
  }

  function _onLock(payload) {
    if (!_isHwActive()) return;
    var cellEl = payload && (payload.cellEl || payload.cell || payload.el);
    if (!cellEl) return;
    var tiers = window.FRAME_MULT_STATE.tiers;
    var existing = tiers.get(cellEl);
    var oldTier, newTier;
    if (existing == null) {
      oldTier = 0;
      newTier = LADDER[0];
    } else if (BUMP_ON_RELAND) {
      oldTier = existing;
      newTier = _bump(existing);
    } else {
      oldTier = existing;
      newTier = existing;
    }
    tiers.set(cellEl, newTier);
    _mountChip(cellEl, newTier);
    if (oldTier !== newTier) {
      if (window.HookBus && typeof window.HookBus.emit === 'function') {
        try {
          window.HookBus.emit('onFrameMultiplierBumped', {
            cellId: _cellIdOf(cellEl),
            oldTier: oldTier,
            newTier: newTier,
          });
        } catch (_) {}
      }
    }
  }

  function _onEnd() {
    if (!window.FRAME_MULT_STATE) return;
    var tiers = window.FRAME_MULT_STATE.tiers;
    var serialized = [];
    var product = 1;
    var sum = 0;
    tiers.forEach(function(tier, cellEl) {
      serialized.push({ cellId: _cellIdOf(cellEl), tier: tier });
      product *= (Number.isFinite(tier) && tier > 0) ? tier : 1;
      sum     += (Number.isFinite(tier) && tier > 0) ? tier : 0;
    });
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onFrameMultiplierFinal', {
          tiers: serialized,
          totalProduct: product,
          totalSum: sum,
        });
      } catch (_) {}
    }
    /* D-14.4 (Boki 2026-06-20, industry-reference cross-ref): Industry
     * standard za FRAME tier pool (Mini/Minor/Major/Grand) je SUM
     * (sabiranje fixed-tier vrednosti pri HW_END), ne PRODUCT. Earlier
     * D-14.1 impl je radio totalProduct sto bi davao apsurdne payout
     * cap-ove (5 frame-locked cells × 10× = 100,000× bet, dok industry
     * reference dopusta max ~5,000× bet per H&W round). Sum je istovremeno
     * pravilo iz Skeleton Key + Wrath par sheet referenci.
     *
     * Sum (≥ 1) ide kroz setMultMax — last-writer-wins bi srusio
     * locked-orb / room-jackpot aggregat ako oba postoje na istom
     * H&W round-u. */
    var aggregate = (sum >= 1) ? sum : 1;
    if (window.HookBus && typeof window.HookBus.setMultMax === 'function') {
      try { window.HookBus.setMultMax(aggregate); } catch (_) {}
    }
    _clear();
  }

  function _onPreSpin() {
    /* Defensive: if a stale H&W state survived, clear residual chips. */
    if (_isHwActive()) return;
    if (window.FRAME_MULT_STATE && window.FRAME_MULT_STATE.tiers && window.FRAME_MULT_STATE.tiers.size > 0) {
      _clear();
    }
  }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('onHoldAndWinIntro', _onIntro, { priority: 30 });
    window.HookBus.on('onHoldAndWinLock',  _onLock,  { priority: 30 });
    window.HookBus.on('onHoldAndWinEnd',   _onEnd,   { priority: 30 });
    window.HookBus.on('preSpin',           _onPreSpin, { priority: 30 });
  }
})();
`;
}
