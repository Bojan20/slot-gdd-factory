/**
 * src/blocks/ambientBackgroundWheel.mjs
 *
 * Wave H9 — Ambient Background Wheel (theme atmosphere visual).
 *
 * Industry baseline (vendor-neutral):
 *   Modern slot themes layer a slowly-rotating cosmetic background element
 *   (rune ring, gear wheel, zodiac chart, mandala) BEHIND the reels to add
 *   life to idle and dynamic feedback during spins. This block owns that
 *   ambient layer as a self-contained LEGO:
 *
 *     • Single fixed background div with a CSS rotation animation.
 *     • Three phases driven by HookBus lifecycle:
 *         - 'idle'     — slow rotation (default 60 s / revolution)
 *         - 'spinning' — fast rotation (default 6 s / revolution)
 *         - 'win'      — pulse-out (1.5 s) then back to idle
 *     • prefers-reduced-motion kills the animation entirely.
 *     • Vendor-neutral SVG (rune dial: 12 spokes + 2 concentric rings).
 *     • Opt-in per GDD: model.ambientBackgroundWheel.enabled.
 *
 *   Composition note: lives at z-index 5 (BELOW grid frame z 10), pointer-
 *   events: none, opacity gated. Frame chrome reads on top.
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitAmbientBackgroundWheelCSS(cfg)
 *   emitAmbientBackgroundWheelMarkup(cfg)
 *   emitAmbientBackgroundWheelRuntime(cfg)
 *
 * Lifecycle:
 *   subscribes:
 *     preSpin                → set phase 'spinning' (speed up)
 *     postSpin               → set phase 'idle'    (slow down)
 *     onBigWinTierEntered    → set phase 'win'     (pulse-out 1.5 s)
 *     onFsTrigger            → set phase 'win'     (pulse + FS entry feel)
 *   emits:
 *     onAmbientPhase { phase, speedMul, source }
 *
 * a11y:
 *   - aria-hidden="true" on the host (pure decoration; no AT exposure).
 *   - prefers-reduced-motion gate (animation disabled).
 *
 * Vendor-neutral. No game / studio strings.
 *
 * @module ambientBackgroundWheel
 */

const PHASES = new Set(['idle', 'spinning', 'win']);
const BOUNDS = Object.freeze({
  idleDurationSec:     [10, 240],
  spinDurationSec:     [1.0, 30],
  winPulseMs:          [400, 3000],
  opacity:             [0.05, 1.0],
  zIndex:              [1, 9],
  sizePct:             [40, 200],
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
    enabled:           false,
    idleDurationSec:   60,
    spinDurationSec:   6,
    winPulseMs:        1500,
    opacity:           0.18,
    color:             '#c9a227',
    zIndex:            5,
    sizePct:           120,      /* % of min(viewport-w, viewport-h) */
    autoOnPreSpin:     true,
    autoOnPostSpin:    true,
    autoOnBigWin:      true,
    autoOnFsTrigger:   true,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.ambientBackgroundWheel) || {};
  const auto = !!model.ambientBackgroundWheel;
  if (typeof m.enabled === 'boolean') cfg.enabled = m.enabled;
  else if (auto) cfg.enabled = true;

  cfg.idleDurationSec = _clamp(m.idleDurationSec, BOUNDS.idleDurationSec, cfg.idleDurationSec);
  cfg.spinDurationSec = _clamp(m.spinDurationSec, BOUNDS.spinDurationSec, cfg.spinDurationSec);
  cfg.winPulseMs      = _clamp(m.winPulseMs,      BOUNDS.winPulseMs,      cfg.winPulseMs);
  cfg.opacity         = _clamp(m.opacity,         BOUNDS.opacity,         cfg.opacity);
  cfg.zIndex          = _clamp(m.zIndex,          BOUNDS.zIndex,          cfg.zIndex);
  cfg.sizePct         = _clamp(m.sizePct,         BOUNDS.sizePct,         cfg.sizePct);
  cfg.color           = _safeColor(m.color, cfg.color);

  if (typeof m.autoOnPreSpin   === 'boolean') cfg.autoOnPreSpin   = m.autoOnPreSpin;
  if (typeof m.autoOnPostSpin  === 'boolean') cfg.autoOnPostSpin  = m.autoOnPostSpin;
  if (typeof m.autoOnBigWin    === 'boolean') cfg.autoOnBigWin    = m.autoOnBigWin;
  if (typeof m.autoOnFsTrigger === 'boolean') cfg.autoOnFsTrigger = m.autoOnFsTrigger;
  return cfg;
}

function _runeSvgURI(color) {
  /* 12-spoke rune dial + 2 concentric rings, vendor-neutral. */
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='-100 -100 200 200' width='200' height='200'>` +
    `<g fill='none' stroke='${color}' stroke-width='1.6' stroke-linecap='round'>` +
    `<circle cx='0' cy='0' r='88'/>` +
    `<circle cx='0' cy='0' r='64'/>` +
    Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      const x1 = Math.cos(a) * 64;
      const y1 = Math.sin(a) * 64;
      const x2 = Math.cos(a) * 88;
      const y2 = Math.sin(a) * 88;
      return `<line x1='${x1.toFixed(2)}' y1='${y1.toFixed(2)}' x2='${x2.toFixed(2)}' y2='${y2.toFixed(2)}'/>`;
    }).join('') +
    `<circle cx='0' cy='0' r='8'/>` +
    `</g></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function emitAmbientBackgroundWheelCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const uri = _runeSvgURI(cfg.color);
  return `
  /* ambientBackgroundWheel — Wave H9 */
  .ambient-bg-wheel {
    position: fixed;
    left: 50%;
    top: 50%;
    width: min(${cfg.sizePct}vw, ${cfg.sizePct}vh);
    height: min(${cfg.sizePct}vw, ${cfg.sizePct}vh);
    transform: translate(-50%, -50%) rotate(0deg);
    transform-origin: center;
    z-index: ${cfg.zIndex};
    pointer-events: none;
    opacity: ${cfg.opacity};
    background-image: url("${uri}");
    background-repeat: no-repeat;
    background-size: contain;
    background-position: center;
    will-change: transform, opacity;
    animation: ambient-rotate ${cfg.idleDurationSec}s linear infinite;
  }
  .ambient-bg-wheel[data-phase="spinning"] {
    animation-duration: ${cfg.spinDurationSec}s;
  }
  .ambient-bg-wheel[data-phase="win"] {
    animation-duration: ${cfg.spinDurationSec}s;
    opacity: ${Math.min(1.0, cfg.opacity * 2.4)};
  }
  @keyframes ambient-rotate {
    from { transform: translate(-50%, -50%) rotate(0deg); }
    to   { transform: translate(-50%, -50%) rotate(360deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    .ambient-bg-wheel { animation: none; }
  }
  `;
}

export function emitAmbientBackgroundWheelMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `<div id="ambientBackgroundWheel" class="ambient-bg-wheel" aria-hidden="true" data-phase="idle"></div>`;
}

export function emitAmbientBackgroundWheelRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) {
    return `
  /* ── ambientBackgroundWheel (disabled) ─────────────────────────────── */
  /* No-op when block is OFF. */
`;
  }
  return `
  /* ── ambientBackgroundWheel BLOCK — Wave H9 ───────────────────────── */
  (function () {
    if (typeof window === 'undefined' || !window.HookBus) return;
    var IDLE_SEC = ${cfg.idleDurationSec};
    var SPIN_SEC = ${cfg.spinDurationSec};
    var WIN_MS = ${cfg.winPulseMs};
    var AUTO_PRE = ${JSON.stringify(cfg.autoOnPreSpin)};
    var AUTO_POST = ${JSON.stringify(cfg.autoOnPostSpin)};
    var AUTO_BW = ${JSON.stringify(cfg.autoOnBigWin)};
    var AUTO_FS = ${JSON.stringify(cfg.autoOnFsTrigger)};
    var host = (typeof document !== 'undefined') ? document.getElementById('ambientBackgroundWheel') : null;
    var phase = 'idle';
    var pulseTimer = null;

    function setPhase(next, source) {
      if (!PHASES_OK(next) || next === phase) return;
      phase = next;
      var speedMul;
      if (next === 'idle') speedMul = 1.0;
      else if (next === 'spinning') speedMul = IDLE_SEC / SPIN_SEC;
      else speedMul = IDLE_SEC / SPIN_SEC * 1.4;
      if (host) host.setAttribute('data-phase', next);
      try { window.HookBus.emit('onAmbientPhase', { phase: next, speedMul: speedMul, source: source || 'auto' }); } catch (_) {}
    }
    function PHASES_OK(p) { return p === 'idle' || p === 'spinning' || p === 'win'; }

    if (AUTO_PRE) window.HookBus.on('preSpin', function () { setPhase('spinning', 'preSpin'); });
    if (AUTO_POST) window.HookBus.on('postSpin', function () { setPhase('idle', 'postSpin'); });
    if (AUTO_BW) window.HookBus.on('onBigWinTierEntered', function () {
      setPhase('win', 'onBigWinTierEntered');
      if (pulseTimer) clearTimeout(pulseTimer);
      pulseTimer = setTimeout(function () { setPhase('idle', 'pulseAuto'); }, WIN_MS);
    });
    if (AUTO_FS) window.HookBus.on('onFsTrigger', function () {
      setPhase('win', 'onFsTrigger');
      if (pulseTimer) clearTimeout(pulseTimer);
      pulseTimer = setTimeout(function () { setPhase('idle', 'pulseAuto'); }, WIN_MS);
    });

    /* External API */
    window.ambientSetPhase = function (p) { setPhase(p, 'api'); };
  })();
  `;
}
