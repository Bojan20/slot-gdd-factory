/**
 * src/blocks/randomLightningMultiplier.mjs
 *
 * Wave LEGO-M2 — Random spin-wide "lightning" multiplier (base game).
 *
 * Purpose
 * ───────
 *   For BASE GAME spins only: after the win evaluation produces a
 *   non-zero base payout, a probabilistic "lightning strike" may fire,
 *   selecting a ×N value from a weighted distribution and multiplying
 *   the current spin's total win by N. A bolt VFX overlay paints across
 *   the grid host. Distinct from:
 *     • multiplierLadder       (FS progressive — grows monotonically)
 *     • persistentMultiplier   (FS accumulator — never resets)
 *     • multiplierOrb          (per-cell symbol-bound multiplier)
 *     • perFsSpinMultiplier    (per-FS-spin random — FS only)
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   "Random per-spin multiplier strike" base-game pattern — after a
 *   winning base spin, a chance roll triggers a screen-wide bolt
 *   overlay and multiplies the win amount by a weighted ×N draw.
 *   Disabled in Free Spins (FS owns its own multiplier system) and
 *   Hold & Win (round logic does not stack with strike multipliers).
 *
 * Public API (server-side, ES module)
 * ──────────────────────────────────
 *   defaultConfig()
 *   resolveConfig(model)
 *   emitRandomLightningMultiplierCSS(cfg)
 *   emitRandomLightningMultiplierMarkup(cfg)
 *   emitRandomLightningMultiplierRuntime(cfg)
 *   pickLightningMultiplier(distribution, rng)   (pure helper, exported for tests)
 *   shouldStrike(probability, rng)               (pure helper, exported for tests)
 *
 * Lifecycle (HookBus contract)
 * ────────────────────────────
 *   subscribes:
 *     • preSpin        (priority 40) — clears any lingering bolt overlay
 *     • onSpinResult   (priority 40) — runs strike roll on winning base spin
 *     • onFsTrigger    (priority 40) — guards FS entry (no strikes in FS)
 *     • onFsEnd        (priority 40) — clears state when FS ends
 *   emits:
 *     • onLightningStrike       { multX, prevMult, newMult }
 *     • onLightningStrikeMissed { }
 *
 * Runtime contract
 * ────────────────
 *   window.RLM_STATE = { lastMultX: number, strikes: number, misses: number }
 *
 * GDD config keys (model.randomLightningMultiplier)
 * ─────────────────────────────────────────────────
 *   { enabled, triggerProbability: 0..1,
 *     distribution: [{value, weight}, …],
 *     appliesOnlyOnBaseWin, vfxDurationMs,
 *     boltColor: hex, glowColor: hex, audioCueId: string|null }
 *
 * Performance budget: ≤ 0.2 ms per base spin settle on 5×4 grid; 1
 * listener per event (wired-once via window.__RLM_WIRED__).
 *
 * a11y: bolt overlay has role=img + aria-label="Multiplier strike Nx";
 * prefers-reduced-motion kills the flash keyframe (chip remains visible
 * as a static glow without strobing).
 *
 * Vendor-neutral, senior-grade, pure presentation + state. No math
 * decisions beyond emitting the drawn multiplier to HookBus.setMult().
 */

const DURATION_MIN_MS = 200;
const DURATION_MAX_MS = 3000;

const HEX_COLOR_RE   = /^#[0-9a-fA-F]{3,8}$/;
const clampInt   = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));
const clampFloat = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n)));

const DEFAULT_DISTRIBUTION = Object.freeze([
  { value:  2, weight: 50 },
  { value:  3, weight: 30 },
  { value:  5, weight: 15 },
  { value: 10, weight:  5 },
]);

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    triggerProbability: 0.05,
    distribution: DEFAULT_DISTRIBUTION.map(e => ({ ...e })),
    appliesOnlyOnBaseWin: true,
    vfxDurationMs: 1200,
    boltColor: '#ffffaa',
    glowColor: '#88ccff',
    audioCueId: null,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.randomLightningMultiplier) || {};

  if (src.enabled === true) cfg.enabled = true;

  if (Number.isFinite(src.triggerProbability)) {
    cfg.triggerProbability = clampFloat(src.triggerProbability, 0, 1);
  }

  if (Array.isArray(src.distribution) && src.distribution.length > 0) {
    const filtered = src.distribution
      .filter(e => Number.isFinite(e.value) && e.value > 0)
      .map(e => {
        const w = Number(e.weight);
        return { value: Number(e.value), weight: Number.isFinite(w) && w > 0 ? w : 1 };
      });
    if (filtered.length > 0) cfg.distribution = filtered;
  }

  if (typeof src.appliesOnlyOnBaseWin === 'boolean') {
    cfg.appliesOnlyOnBaseWin = src.appliesOnlyOnBaseWin;
  }

  if (Number.isFinite(src.vfxDurationMs)) {
    cfg.vfxDurationMs = clampInt(src.vfxDurationMs, DURATION_MIN_MS, DURATION_MAX_MS);
  }

  if (typeof src.boltColor === 'string' && HEX_COLOR_RE.test(src.boltColor)) {
    cfg.boltColor = src.boltColor;
  }
  if (typeof src.glowColor === 'string' && HEX_COLOR_RE.test(src.glowColor)) {
    cfg.glowColor = src.glowColor;
  }

  if (typeof src.audioCueId === 'string' && src.audioCueId.length > 0) {
    cfg.audioCueId = src.audioCueId;
  }

  return cfg;
}

/**
 * Weighted pick from a distribution. Pure function — accepts an RNG so
 * tests can use a deterministic seed; defaults to Math.random.
 * Returns 1 for empty/invalid distributions (multiplicative identity).
 */
export function pickLightningMultiplier(distribution, rng = Math.random) {
  if (!Array.isArray(distribution) || distribution.length === 0) return 1;
  const total = distribution.reduce((s, e) => s + (e.weight > 0 ? e.weight : 0), 0);
  /* QA sweep (2026-06-18): all-zero-weight distribution must fall back
   * to identity (1) per spec. Previously returned distribution[0].value
   * which was inconsistent with empty-array fallback above. */
  if (total <= 0) return 1;
  let r = rng() * total;
  for (const e of distribution) {
    r -= e.weight;
    if (r <= 0) return e.value;
  }
  return distribution[distribution.length - 1].value;
}

/**
 * Deterministic strike roll. Pure function. probability=1 → always
 * strikes; probability=0 → never strikes. Clamps to [0,1].
 */
export function shouldStrike(probability, rng = Math.random) {
  const p = clampFloat(probability, 0, 1);
  if (p <= 0) return false;
  if (p >= 1) return true;
  return rng() < p;
}

export function emitRandomLightningMultiplierCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ randomLightningMultiplier: cfg });
  if (!c.enabled) return `\n/* randomLightningMultiplier BLOCK (disabled) — no CSS */\n`;
  return `
/* ── randomLightningMultiplier BLOCK — src/blocks/randomLightningMultiplier.mjs ── */
.lightning-bolt-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 75;
  opacity: 0;
  background:
    radial-gradient(ellipse at 50% 40%, ${c.glowColor}33 0%, transparent 65%),
    linear-gradient(125deg, transparent 40%, ${c.boltColor}cc 48%, ${c.boltColor} 50%, ${c.boltColor}cc 52%, transparent 60%);
  mix-blend-mode: screen;
  filter: drop-shadow(0 0 18px ${c.glowColor});
}
.lightning-bolt-overlay.is-striking {
  animation: rlm-strike ${c.vfxDurationMs}ms ease-out forwards;
}
.lightning-bolt-overlay::after {
  content: attr(data-mult);
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0.6);
  font: 900 56px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: ${c.boltColor};
  text-shadow: 0 0 24px ${c.glowColor}, 0 0 8px rgba(0,0,0,0.85);
  opacity: 0;
}
.lightning-bolt-overlay.is-striking::after {
  animation: rlm-chip ${c.vfxDurationMs}ms ease-out forwards;
}
@keyframes rlm-strike {
  0%   { opacity: 0; }
  8%   { opacity: 1; }
  18%  { opacity: 0.2; }
  28%  { opacity: 0.95; }
  60%  { opacity: 0.6; }
  100% { opacity: 0; }
}
@keyframes rlm-chip {
  0%   { transform: translate(-50%, -50%) scale(0.6); opacity: 0; }
  20%  { transform: translate(-50%, -50%) scale(1.25); opacity: 1; }
  80%  { transform: translate(-50%, -50%) scale(1.0);  opacity: 1; }
  100% { transform: translate(-50%, -50%) scale(1.1);  opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .lightning-bolt-overlay.is-striking,
  .lightning-bolt-overlay.is-striking::after {
    animation: none;
    opacity: 1;
  }
}
`;
}

export function emitRandomLightningMultiplierMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ randomLightningMultiplier: cfg });
  if (!c.enabled) return `\n<!-- randomLightningMultiplier BLOCK (disabled) -->\n`;
  return `
<!-- randomLightningMultiplier BLOCK — server-emitted markup -->
<div class="lightning-bolt-overlay" id="rlmBoltOverlay" role="img" aria-label="Multiplier strike" aria-hidden="true" data-mult=""></div>
`;
}

export function emitRandomLightningMultiplierRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ randomLightningMultiplier: cfg });
  if (!c.enabled) return `\n// randomLightningMultiplier BLOCK (disabled) — no runtime\n`;

  const distJson    = JSON.stringify(c.distribution);
  const triggerProb = c.triggerProbability;
  const durationMs  = c.vfxDurationMs;
  const audioCueId  = c.audioCueId ? JSON.stringify(c.audioCueId) : 'null';

  return `
/* ── randomLightningMultiplier BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__RLM_WIRED__) return;
  window.__RLM_WIRED__ = true;

  var DIST          = ${distJson};
  var TRIGGER_PROB  = ${triggerProb};
  var DURATION_MS   = ${durationMs};
  var AUDIO_CUE_ID  = ${audioCueId};

  window.RLM_STATE = {
    lastMultX: 0,
    strikes: 0,
    misses: 0,
    _overlayTimerId: null,
  };

  function _rng() {
    /* QA sweep (2026-06-18): prefer HookBus session-scoped RNG so a
     * deterministic seed replay produces identical strike outcomes.
     * Falls back to GameRNG, then Math.random. */
    if (window.HookBus && typeof window.HookBus.getRng === 'function') {
      try { return window.HookBus.getRng(); } catch (_) {}
    }
    if (window.GameRNG && typeof window.GameRNG.next === 'function') return window.GameRNG.next();
    return Math.random();
  }

  function _pick() {
    var total = 0;
    for (var i = 0; i < DIST.length; i++) total += (DIST[i].weight > 0 ? DIST[i].weight : 0);
    if (total <= 0) return DIST[0].value;
    var r = _rng() * total;
    for (var j = 0; j < DIST.length; j++) {
      r -= DIST[j].weight;
      if (r <= 0) return DIST[j].value;
    }
    return DIST[DIST.length - 1].value;
  }

  function _roll() {
    if (TRIGGER_PROB <= 0) return false;
    if (TRIGGER_PROB >= 1) return true;
    return _rng() < TRIGGER_PROB;
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

  function _clearOverlay() {
    /* QA sweep (2026-06-18): cancel any in-flight auto-clear timer so a
     * back-to-back spin that calls _clearOverlay then _paintStrike does
     * not wipe the fresh overlay when the OLD timer fires later. */
    if (window.RLM_STATE && window.RLM_STATE._overlayTimerId) {
      try { clearTimeout(window.RLM_STATE._overlayTimerId); } catch (_) {}
      window.RLM_STATE._overlayTimerId = null;
    }
    var ov = document.getElementById('rlmBoltOverlay');
    if (!ov) return;
    ov.classList.remove('is-striking');
    ov.setAttribute('aria-hidden', 'true');
    ov.setAttribute('aria-label', 'Multiplier strike');
    ov.setAttribute('data-mult', '');
  }

  function _paintStrike(multX) {
    var ov = document.getElementById('rlmBoltOverlay');
    if (!ov) return;
    ov.setAttribute('data-mult', 'x' + multX);
    ov.setAttribute('aria-label', 'Multiplier strike ' + multX + 'x');
    ov.setAttribute('aria-hidden', 'false');
    ov.classList.add('is-striking');
    if (AUDIO_CUE_ID && window.AudioBus && typeof window.AudioBus.play === 'function') {
      try { window.AudioBus.play(AUDIO_CUE_ID); } catch (_) {}
    }
    /* QA sweep (2026-06-18): store handle on RLM_STATE so _clearOverlay
     * can cancel it on a back-to-back spin. Without this, the OLD timer
     * fires AFTER the new strike paints, wiping it prematurely. */
    if (window.RLM_STATE) {
      if (window.RLM_STATE._overlayTimerId) {
        try { clearTimeout(window.RLM_STATE._overlayTimerId); } catch (_) {}
      }
      window.RLM_STATE._overlayTimerId = setTimeout(function() {
        window.RLM_STATE._overlayTimerId = null;
        _clearOverlay();
      }, DURATION_MS);
    } else {
      setTimeout(_clearOverlay, DURATION_MS);
    }
  }

  function _onPreSpin() {
    _clearOverlay();
  }

  function _onSpinResult(payload) {
    if (_isFsActive()) return;
    if (_isHwActive()) return;
    var baseWin = (payload && Number.isFinite(payload.totalWin)) ? payload.totalWin
                : (payload && Number.isFinite(payload.win))      ? payload.win
                : 0;
    if (!(baseWin > 0)) return;

    if (!_roll()) {
      window.RLM_STATE.misses += 1;
      if (window.HookBus && typeof window.HookBus.emit === 'function') {
        try { window.HookBus.emit('onLightningStrikeMissed', {}); } catch (_) {}
      }
      return;
    }

    var multX = _pick();
    var prevMult = (window.HookBus && typeof window.HookBus.getMult === 'function')
                   ? (window.HookBus.getMult() || 1) : 1;
    var newMult = prevMult * multX;

    window.RLM_STATE.lastMultX = multX;
    window.RLM_STATE.strikes  += 1;

    if (window.HookBus && typeof window.HookBus.setMult === 'function') {
      window.HookBus.setMult(newMult);
    }
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onLightningStrike', {
          multX: multX,
          prevMult: prevMult,
          newMult: newMult,
        });
      } catch (_) {}
    }
    _paintStrike(multX);
  }

  function _onFsTrigger() {
    _clearOverlay();
  }

  function _onFsEnd() {
    _clearOverlay();
  }

  if (window.HookBus) {
    if (typeof window.HookBus.on === 'function') {
      window.HookBus.on('preSpin',       _onPreSpin,    { priority: 40 });
      window.HookBus.on('onSpinResult',  _onSpinResult, { priority: 40 });
      window.HookBus.on('onFsTrigger',   _onFsTrigger,  { priority: 40 });
      window.HookBus.on('onFsEnd',       _onFsEnd,      { priority: 40 });
    }
  }
})();
`;
}
