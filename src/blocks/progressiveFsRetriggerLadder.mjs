/**
 * src/blocks/progressiveFsRetriggerLadder.mjs
 *
 * Wave LEGO-M — Progressive FS Retrigger Ladder.
 *
 * Purpose
 * ───────
 *   During a Free Spins round, every retrigger JUMPS the player to the
 *   NEXT pre-defined rung on a multiplier ladder. The full ladder is
 *   rendered as a vertical (or horizontal) HUD with active rung
 *   highlighted. Each rung carries its own multX value applied to every
 *   FS spin win until the next retrigger promotion. Distinct from:
 *     • `retriggerMultiplierBump.mjs` (single-step or contiguous-ladder
 *       bump, no full visible ladder; this block is the LADDER-FIRST
 *       variant with rich UI + rung promote celebration)
 *     • `multiplierLadder.mjs`        (base-game progressive ladder)
 *     • `perFsSpinMultiplier.mjs`     (per-spin random, no retrigger gate)
 *     • `persistentMultiplier.mjs`    (accumulator without retrigger gate)
 *
 *   Semantically: retrigger = climb one rung; cap at top rung;
 *   ladder rungs are HUD-visible at all times during FS round.
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   "Stepped FS multiplier ladder" — visible rung column with active
 *   step highlighted. Each new scatter persistence event (retrigger)
 *   promotes the player one fixed step on the ladder. Common in
 *   modern FS bonus rounds where the ladder is part of the visible UX
 *   contract (player sees ahead, anticipates promotions).
 *
 * Public API (server-side, ES module)
 * ──────────────────────────────────
 *   defaultConfig()
 *   resolveConfig(model)
 *   emitProgressiveFsRetriggerLadderCSS(cfg)
 *   emitProgressiveFsRetriggerLadderMarkup(cfg)
 *   emitProgressiveFsRetriggerLadderRuntime(cfg)
 *   promoteRung(currentRung, ladderLength)        (pure helper, exported for tests)
 *
 * Lifecycle (HookBus contract)
 * ────────────────────────────
 *   subscribes:
 *     • onFsTrigger     (priority 28) — init PFRL_STATE; HUD render; setMult(ladder[0].multX)
 *     • onFsRetrigger   (priority 28) — promote rung; setMult; emit onLadderRungPromoted
 *     • onFsSpinResult  (priority 28) — defensive re-sync setMult(currentRung.multX)
 *     • onFsEnd         (priority 28) — clear state; setMult(1); emit onLadderReset
 *     • preSpin         (priority 28) — HW guard tap (no-op if HW active)
 *   emits:
 *     • onLadderRungPromoted   { oldRung, newRung, multX }
 *     • onLadderReset          { }
 *
 * Runtime contract
 * ────────────────
 *   window.PFRL_STATE = { currentRung: number, ladder: Array<{rung,multX,label}> }
 *
 * GDD config keys (model.progressiveFsRetriggerLadder)
 * ────────────────────────────────────────────────────
 *   {
 *     enabled: false,
 *     ladder: [{rung,multX,label}, …],        // strictly monotone multX
 *     ladderPosition: 'left'|'right'|'top'|'bottom',
 *     fontSizePx: 10..20,
 *     activeColor: '#ffd700',
 *     inactiveColor: '#aaaaaa',  // WCAG AAA 7.5:1 (F4 A1 fix)
 *     pulseMs: 200..3000
 *   }
 *
 * Performance budget: ≤ 0.2 ms per FS spin settle (single CSS class
 * toggle), no DOM scan, wired-once via window.__PFRL_WIRED__.
 *
 * a11y: HUD container has role=list; each rung is role=listitem with
 * aria-current="true" on the active rung so screen readers announce
 * "Rung 3 of 5, multiplier 10x". prefers-reduced-motion disables the
 * promote pulse keyframe.
 *
 * Vendor-neutral, senior-grade, pure presentation + state. All math
 * decisions remain in the engine; this block only PUBLISHES the
 * current mult via HookBus.setMult and emits promotion events.
 */

const LADDER_POSITIONS = Object.freeze(['left', 'right', 'top', 'bottom']);
const FONT_SIZE_MIN    = 10;
const FONT_SIZE_MAX    = 20;
const PULSE_MIN_MS     = 200;
const PULSE_MAX_MS     = 3000;

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));

const DEFAULT_LADDER = Object.freeze([
  { rung: 0, multX:  1, label: 'BASE' },
  { rung: 1, multX:  2, label: '×2'   },
  { rung: 2, multX:  5, label: '×5'   },
  { rung: 3, multX: 10, label: '×10'  },
  { rung: 4, multX: 25, label: 'MAX'  },
]);

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    ladder: DEFAULT_LADDER.map(e => ({ ...e })),
    ladderPosition: 'right',
    fontSizePx: 12,
    activeColor: '#ffd700',
    /* WCAG AAA (F4 A1) — #666666 was 2.1:1 on near-black bg (FAIL);
     * #aaaaaa lifts to 7.5:1 (AAA pass) for inactive rung label */
    inactiveColor: '#aaaaaa',
    pulseMs: 600,
  });
}

/**
 * Validate ladder: every entry must be a finite-multX object and the
 * sequence of multX must be strictly monotone non-decreasing. Returns
 * a normalised ladder array OR null if invalid (caller falls back to
 * default).
 */
function validateLadder(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const e = arr[i];
    if (!e || typeof e !== 'object') return null;
    const multX = Number(e.multX);
    if (!Number.isFinite(multX) || multX <= 0) return null;
    if (i > 0 && multX < out[i - 1].multX) return null; /* non-monotone */
    out.push({
      rung: Number.isFinite(e.rung) ? Math.trunc(e.rung) : i,
      multX,
      label: typeof e.label === 'string' ? e.label : ('×' + multX),
    });
  }
  return out;
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  /* Make ladder mutable in cfg copy. */
  cfg.ladder = cfg.ladder.map(e => ({ ...e }));

  const src = (model && model.progressiveFsRetriggerLadder) || {};

  if (src.enabled === true) cfg.enabled = true;

  if (src.ladder !== undefined) {
    const v = validateLadder(src.ladder);
    if (v) cfg.ladder = v;
    /* if invalid → silently fall back to default (do not throw). */
  }

  if (typeof src.ladderPosition === 'string' && LADDER_POSITIONS.includes(src.ladderPosition)) {
    cfg.ladderPosition = src.ladderPosition;
  }
  if (Number.isFinite(src.fontSizePx)) cfg.fontSizePx = clampInt(src.fontSizePx, FONT_SIZE_MIN, FONT_SIZE_MAX);
  if (Number.isFinite(src.pulseMs))    cfg.pulseMs    = clampInt(src.pulseMs,    PULSE_MIN_MS,  PULSE_MAX_MS);

  if (typeof src.activeColor   === 'string' && HEX_COLOR_RE.test(src.activeColor))   cfg.activeColor   = src.activeColor;
  if (typeof src.inactiveColor === 'string' && HEX_COLOR_RE.test(src.inactiveColor)) cfg.inactiveColor = src.inactiveColor;

  return cfg;
}

/**
 * Pure helper — promote a rung index by one, capped to ladderLength-1.
 * Negative inputs are clamped to 0. Non-finite inputs are clamped to 0.
 *
 *   promoteRung(0, 5) → 1
 *   promoteRung(4, 5) → 4   (cap)
 *   promoteRung(-3, 5) → 0
 */
export function promoteRung(currentRung, ladderLength) {
  const len = Number.isFinite(ladderLength) ? Math.trunc(ladderLength) : 0;
  if (len <= 0) return 0;
  const cur = Number.isFinite(currentRung) ? Math.trunc(currentRung) : 0;
  if (cur < 0) return 0;
  if (cur >= len - 1) return len - 1;
  return cur + 1;
}

function escAttr(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function containerPositionCss(pos) {
  switch (pos) {
    case 'left':
      return 'top: 50%; left: 8px; transform: translateY(-50%); flex-direction: column;';
    case 'top':
      return 'top: 8px; left: 50%; transform: translateX(-50%); flex-direction: row;';
    case 'bottom':
      return 'bottom: 8px; left: 50%; transform: translateX(-50%); flex-direction: row;';
    case 'right':
    default:
      return 'top: 50%; right: 8px; transform: translateY(-50%); flex-direction: column;';
  }
}

export function emitProgressiveFsRetriggerLadderCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ progressiveFsRetriggerLadder: cfg });
  if (!c.enabled) return `\n/* progressiveFsRetriggerLadder BLOCK (disabled) — no CSS */\n`;
  return `
/* ── progressiveFsRetriggerLadder BLOCK — src/blocks/progressiveFsRetriggerLadder.mjs ── */
.pfrl-ladder {
  position: absolute;
  ${containerPositionCss(c.ladderPosition)}
  display: none;
  gap: 4px;
  padding: 6px 8px;
  background: rgba(8, 8, 16, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  z-index: 68;
  pointer-events: none;
  font: 700 ${c.fontSizePx}px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
}
.pfrl-ladder.is-active {
  display: flex;
}
.pfrl-rung {
  min-width: 36px;
  padding: 4px 8px;
  border-radius: 6px;
  text-align: center;
  letter-spacing: 0.04em;
  color: ${c.inactiveColor};
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid transparent;
  transition: color 200ms ease, background 200ms ease, border-color 200ms ease, transform 200ms ease;
}
.pfrl-rung.is-current {
  color: ${c.activeColor};
  background: rgba(255, 215, 0, 0.12);
  border-color: ${c.activeColor};
}
.pfrl-rung.is-promoted {
  animation: pfrl-promote ${c.pulseMs}ms ease-out;
}
@keyframes pfrl-promote {
  0%   { transform: scale(1);   box-shadow: 0 0 0 transparent; }
  35%  { transform: scale(1.25); box-shadow: 0 0 16px ${c.activeColor}; }
  100% { transform: scale(1);   box-shadow: 0 0 0 transparent; }
}
@media (prefers-reduced-motion: reduce) {
  .pfrl-rung { transition: none; }
  .pfrl-rung.is-promoted { animation: none; }
}
`;
}

export function emitProgressiveFsRetriggerLadderMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ progressiveFsRetriggerLadder: cfg });
  if (!c.enabled) return `\n<!-- progressiveFsRetriggerLadder BLOCK (disabled) -->\n`;

  const rungs = c.ladder.map((e, i) => {
    const isCurrent = i === 0;
    return `  <div class="pfrl-rung${isCurrent ? ' is-current' : ''}" data-rung="${i}" role="listitem"${isCurrent ? ' aria-current="true"' : ''}>${escAttr(e.label)}</div>`;
  }).join('\n');

  return `
<!-- progressiveFsRetriggerLadder BLOCK — server-emitted markup -->
<div class="pfrl-ladder" id="pfrlLadder" role="list" aria-label="Free Spins multiplier ladder" aria-hidden="true">
${rungs}
</div>
`;
}

export function emitProgressiveFsRetriggerLadderRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ progressiveFsRetriggerLadder: cfg });
  if (!c.enabled) return `\n// progressiveFsRetriggerLadder BLOCK (disabled) — no runtime\n`;

  const ladderJson = JSON.stringify(c.ladder);
  const pulseMs    = c.pulseMs;

  return `
/* ── progressiveFsRetriggerLadder BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__PFRL_WIRED__) return;
  window.__PFRL_WIRED__ = true;

  var LADDER   = ${ladderJson};
  var PULSE_MS = ${pulseMs};

  window.PFRL_STATE = {
    currentRung: 0,
    ladder: LADDER.slice(),
  };

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
    return false;
  }

  function _show() {
    var el = document.getElementById('pfrlLadder');
    if (!el) return;
    el.classList.add('is-active');
    el.setAttribute('aria-hidden', 'false');
  }

  function _hide() {
    var el = document.getElementById('pfrlLadder');
    if (!el) return;
    el.classList.remove('is-active');
    el.setAttribute('aria-hidden', 'true');
  }

  function _paintCurrent(idx, promoted) {
    var el = document.getElementById('pfrlLadder');
    if (!el) return;
    var rungs = el.querySelectorAll('.pfrl-rung');
    for (var i = 0; i < rungs.length; i++) {
      var r = rungs[i];
      if (i === idx) {
        r.classList.add('is-current');
        r.setAttribute('aria-current', 'true');
        if (promoted) {
          r.classList.add('is-promoted');
          (function(node) {
            setTimeout(function() { node.classList.remove('is-promoted'); }, PULSE_MS + 50);
          })(r);
        }
      } else {
        r.classList.remove('is-current', 'is-promoted');
        r.removeAttribute('aria-current');
      }
    }
  }

  function _applyMult(multX) {
    /* FIX-8 H7 (2026-06-19) — compound rule for retrigger-ladder ×
     * reel-height escalation. Both blocks subscribe to onFsRetrigger
     * and both write to BONUS_MULTIPLIER pipeline. Industry baseline:
     * regulator-vetted RTP target expects MAX(ladder, reelHeight)
     * (defensive — both compound = overpay), NOT ADD.
     *
     * Implementation: read current registered max from
     * window.__PFRL_COMPOUND_MAX__ (cross-block agreement key); if our
     * candidate exceeds previous, install; HookBus.setMult always
     * called with MAX. fsReelHeightEscalation will read the same key
     * and follow the same MAX rule. */
    if (window.HookBus && typeof window.HookBus.setMult === 'function') {
      const prev = Number(window.__PFRL_COMPOUND_MAX__) || 1;
      const next = Math.max(prev, Number(multX) || 1);
      window.__PFRL_COMPOUND_MAX__ = next;
      window.HookBus.setMult(next);
    }
  }

  function _emit(name, payload) {
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try { window.HookBus.emit(name, payload); } catch (_) {}
    }
  }

  function _onFsTrigger() {
    if (_isHwActive()) return;
    window.PFRL_STATE.currentRung = 0;
    _show();
    _paintCurrent(0, false);
    _applyMult(LADDER[0].multX);
  }

  function _onFsRetrigger() {
    if (_isHwActive()) return;
    if (!_isFsActive()) return;
    var oldRung = window.PFRL_STATE.currentRung | 0;
    var newRung = oldRung;
    if (newRung < LADDER.length - 1) newRung = oldRung + 1;
    window.PFRL_STATE.currentRung = newRung;
    _paintCurrent(newRung, newRung !== oldRung);
    var multX = LADDER[newRung].multX;
    _applyMult(multX);
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try { window.HookBus.emit('onLadderRungPromoted', { oldRung: oldRung, newRung: newRung, multX: multX }); } catch (_) {}
    }
  }

  function _onFsSpinResult() {
    if (_isHwActive()) return;
    if (!_isFsActive()) return;
    /* Defensive re-sync — engine or another block may have clobbered
     * HookBus mult between retriggers; reapply current rung's value. */
    var idx = window.PFRL_STATE.currentRung | 0;
    if (idx < 0) idx = 0;
    if (idx > LADDER.length - 1) idx = LADDER.length - 1;
    _applyMult(LADDER[idx].multX);
  }

  function _onFsEnd() {
    window.PFRL_STATE.currentRung = 0;
    _paintCurrent(0, false);
    _hide();
    /* FIX-8 H7: clear compound MAX so next FS round starts fresh. */
    window.__PFRL_COMPOUND_MAX__ = 1;
    _applyMult(1);
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try { window.HookBus.emit('onLadderReset', {}); } catch (_) {}
    }
  }

  function _onPreSpin() {
    /* HW guard tap — if HW becomes active mid-flow, hide ladder so it
     * doesn't visually compete with HW celebration. Pure no-op when
     * HW inactive. */
    if (_isHwActive()) _hide();
  }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('onFsTrigger',    _onFsTrigger,    { priority: 28 });
    window.HookBus.on('onFsRetrigger',  _onFsRetrigger,  { priority: 28 });
    window.HookBus.on('onFsSpinResult', _onFsSpinResult, { priority: 28 });
    window.HookBus.on('onFsEnd',        _onFsEnd,        { priority: 28 });
    window.HookBus.on('preSpin',        _onPreSpin,      { priority: 28 });
  }
})();
`;
}
