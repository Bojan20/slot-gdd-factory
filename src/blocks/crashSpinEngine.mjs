/**
 * src/blocks/crashSpinEngine.mjs
 *
 * Wave J3 — Crash multiplier curve animation.
 *
 * Industry-reference rationale
 * ────────────────────────────
 *   Crash-style slot fronts draw a multiplier curve that rises from
 *   1.00x to a peak before "crashing". Pre-J3 the crash kind dropped
 *   into runStaticReroll() — a blink-fade with no curve motion. This
 *   block animates the SVG curve path stroke-dasharray + the multiplier
 *   counter text in lockstep, then snaps to the random peak.
 *
 * Composition contract (LEGO ownership)
 * ────────────────────────────────────
 *   • SOLE OWNER of the crash kind spin animation. Registers
 *     window.__SLOT_KIND_RUNSPIN__.crash. Rectangular dispatcher
 *     routes through the registry.
 *   • Reads: SHAPE.kind, document (DOM root), HookBus.
 *   • Owns: `.grid-crash svg path` (the multiplier curve) +
 *     `.grid-crash svg text` (the live multiplier label).
 *   • Emits no HookBus events — pure observer; lifecycle parity via
 *     dispatcher.
 *
 * Lifecycle (HookBus listeners)
 * ─────────────────────────────
 *   preSpin → cancel pending settle timer + reset stroke-dashoffset
 *             so a double-click can't double-animate.
 *
 * Vendor neutrality
 * ─────────────────
 *   Zero game / vendor mentions. "Crash curve" and "peak multiplier"
 *   are abstract topology references.
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitCrashSpinEngineCSS(cfg)
 *   emitCrashSpinEngineRuntime(cfg)
 */

const DEFAULTS = Object.freeze({
  enabled: true,
  spinDurationMs: 1800,
  peakMultiplierMin: 1.2,
  peakMultiplierMax: 25.0,
  fadeFallbackMs: 200,
});

export function defaultConfig() { return { ...DEFAULTS }; }

function clampInt(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return Math.floor(v);
}
function clampFloat(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return v;
}

export function resolveConfig(model) {
  const cfg = defaultConfig();
  const src = (model && model.crashSpinEngine) || {};
  const intMap = [
    ['spinDurationMs', 400, 6000],
    ['fadeFallbackMs',  40,  800],
  ];
  for (const [k, lo, hi] of intMap) {
    const v = clampInt(src[k], lo, hi);
    if (v !== null) cfg[k] = v;
  }
  const floatMap = [
    ['peakMultiplierMin', 1.0,  10.0],
    ['peakMultiplierMax', 1.1, 1000.0],
  ];
  for (const [k, lo, hi] of floatMap) {
    const v = clampFloat(src[k], lo, hi);
    if (v !== null) cfg[k] = v;
  }
  if (cfg.peakMultiplierMax < cfg.peakMultiplierMin) {
    const t = cfg.peakMultiplierMax;
    cfg.peakMultiplierMax = cfg.peakMultiplierMin;
    cfg.peakMultiplierMin = t;
  }
  if (typeof src.enabled === 'boolean') cfg.enabled = src.enabled;
  return cfg;
}

/* ── Emit ─────────────────────────────────────────────────────── */

export function emitCrashSpinEngineCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* ── Crash spin engine (Wave J3) ────────────────────────────── */
.grid-crash svg.crash-curve {
  will-change: transform;
}
.grid-crash svg.crash-curve path {
  /* JS owns stroke-dashoffset for the rising-curve reveal. */
  transition: stroke-dashoffset ${cfg.spinDurationMs}ms cubic-bezier(0.42, 0, 0.58, 1.0);
}
.grid-crash svg.crash-curve text {
  /* Live multiplier label flickers slightly during spin */
  font-variant-numeric: tabular-nums;
}
.grid-crash svg.crash-curve.is-spinning text {
  animation: crashCounter ${Math.max(80, Math.floor(cfg.spinDurationMs / 20))}ms steps(1, end) infinite;
}
@keyframes crashCounter {
  0%   { opacity: 0.65; }
  50%  { opacity: 1.0;  }
  100% { opacity: 0.65; }
}
@media (prefers-reduced-motion: reduce) {
  .grid-crash svg.crash-curve path,
  .grid-crash svg.crash-curve.is-spinning text {
    transition: opacity ${cfg.fadeFallbackMs}ms ease !important;
    animation: none !important;
  }
}
`;
}

export function emitCrashSpinEngineRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const SPIN_MS = cfg.spinDurationMs;
  const PEAK_MIN = cfg.peakMultiplierMin;
  const PEAK_MAX = cfg.peakMultiplierMax;
  return `
  /* ── Crash spin runtime (Wave J3) ──────────────────────────── */
  (function () {
    if (!SHAPE || SHAPE.kind !== 'crash') return;
    window.__SLOT_KIND_RUNSPIN__ = window.__SLOT_KIND_RUNSPIN__ || {};

    var STATE = { rotating: false, peak: 1.0, settleTimer: null, pending: null, counterIv: null };
    Object.defineProperty(window, '__SLOT_CRASH_STATE__', {
      configurable: true,
      get: function () { return STATE; },
    });

    function _spin(onSettled) {
      var host = document.querySelector('.grid-crash');
      var svg = host ? host.querySelector('svg.crash-curve') : null;
      var path = svg ? svg.querySelector('path') : null;
      var text = svg ? svg.querySelector('text') : null;
      if (!svg || !path || !text) {
        if (typeof onSettled === 'function') setTimeout(onSettled, 0);
        return;
      }
      if (STATE.settleTimer) { clearTimeout(STATE.settleTimer); STATE.settleTimer = null; }
      if (STATE.counterIv) { clearInterval(STATE.counterIv); STATE.counterIv = null; }

      /* Turbo gate — CSS bakes transition duration. Override per-spin so
         turbo chip ACTUALLY compresses cadence (Boki bug). */
      var _tm = (typeof window.__SLOT_TURBO_SPEED_MULT__ === 'number' && window.__SLOT_TURBO_SPEED_MULT__ > 0)
        ? window.__SLOT_TURBO_SPEED_MULT__ : 1.0;
      var _spinDur = Math.max(60, Math.round(${SPIN_MS} * _tm));

      var len = (typeof path.getTotalLength === 'function') ? path.getTotalLength() : 320;
      /* Pre-roll: curve hidden via stroke-dashoffset = full length. */
      path.style.transition = 'none';
      path.style.strokeDasharray = len + ' ' + len;
      path.style.strokeDashoffset = len;
      void path.offsetWidth; /* reflow */
      path.style.transition = 'stroke-dashoffset ' + _spinDur + 'ms cubic-bezier(0.42, 0, 0.58, 1.0)';

      svg.classList.add('is-spinning');

      /* Pick a random peak (log-distributed: most spins land near 1-3x,
         occasional spikes toward MAX). */
      var u = Math.random();
      var peak = ${PEAK_MIN} + Math.pow(u, 2.4) * (${PEAK_MAX} - ${PEAK_MIN});
      peak = Math.round(peak * 100) / 100;
      STATE.peak = peak;
      STATE.rotating = true;
      STATE.pending = onSettled || null;

      /* Counter tick — interpolate displayed value from 1.00 to peak. */
      var startedAt = Date.now();
      STATE.counterIv = setInterval(function () {
        var t = Math.min(1, (Date.now() - startedAt) / _spinDur);
        var v = 1 + (peak - 1) * t * t; /* quadratic ease-in */
        text.textContent = v.toFixed(2) + 'x';
      }, 30);

      /* Trigger the path reveal */
      path.style.strokeDashoffset = '0';

      function _settle() {
        if (STATE.counterIv) { clearInterval(STATE.counterIv); STATE.counterIv = null; }
        text.textContent = peak.toFixed(2) + 'x';
        svg.classList.remove('is-spinning');
        STATE.rotating = false;
        var cb = STATE.pending; STATE.pending = null;
        /* onSpinResult is emitted by the dispatcher (reelEngine). */
        if (typeof cb === 'function') setTimeout(cb, 0);
      }
      STATE.settleTimer = setTimeout(_settle, _spinDur + 30);
    }

    if (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function') {
      HookBus.on('preSpin', function () {
        if (STATE.settleTimer) { clearTimeout(STATE.settleTimer); STATE.settleTimer = null; }
        if (STATE.counterIv) { clearInterval(STATE.counterIv); STATE.counterIv = null; }
        STATE.rotating = false;
      });
    }

    window.__SLOT_KIND_RUNSPIN__.crash = _spin;
  })();
`;
}
