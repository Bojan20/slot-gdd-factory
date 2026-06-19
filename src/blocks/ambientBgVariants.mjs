/**
 * src/blocks/ambientBgVariants.mjs
 *
 * Wave LEGO-THEME (B-8 · 3/3) — Mood-driven ambient background variants.
 *
 * @module ambientBgVariants
 *
 * Purpose:
 *   Listens to win/loss signals and switches the body background to a
 *   mood-appropriate variant: calm (idle / losing) → tense (small win) →
 *   celebration (big win) → bonus (FS in progress). Each variant is a
 *   CSS class applied to `<body>`; designer customizes via a stylesheet.
 *
 *   This is the "feels" layer that makes the table breathe. Sister
 *   blocks (themePicker, paletteRoulette) own visual identity; this
 *   block owns visual MOOD.
 *
 * Industry-reference (vendor-neutral):
 *   Mood-driven backgrounds are an emerging 2024-2026 polish layer.
 *   Industry baseline: 3-5 mood states (calm, tense, celebration,
 *   bonus), CSS-driven (no JS-thrashed gradients), graceful transitions
 *   that honor prefers-reduced-motion.
 *
 * Public API:
 *   defaultConfig()                          → frozen safe defaults
 *   resolveConfig(model)                     → merge defaults with GDD override
 *   emitAmbientBgVariantsCSS(cfg)            → CSS string
 *   emitAmbientBgVariantsMarkup(cfg)         → HTML string (no surface; just live region)
 *   emitAmbientBgVariantsRuntime(cfg)        → runtime JS string
 *
 * Lifecycle (HookBus contract):
 *   subscribes:  onSpinResult — pick mood from win value
 *                onBigWinTierEnter — celebration mood
 *                onBigWinTierExit  — calm down
 *                onFsTrigger — bonus mood
 *                onFsEnd     — calm
 *                onThemeChanged — re-apply mood class
 *   emits:       onAmbientMoodChanged { mood, prevMood }
 *
 * a11y / perf:
 *   • Mood is body class toggle — no DOM thrash, GPU-friendly.
 *   • prefers-reduced-motion → instant transition (no gradient animations).
 *   • Tokens hoisted.
 */
import { applyGridProfile } from '../registry/gridProfile.mjs';

const TOKENS = Object.freeze({
  transitionMs:    900,
});

const RGB_RE = /^\d{1,3},\d{1,3},\d{1,3}$/;

const VALID_MOODS = Object.freeze(['calm', 'tense', 'celebration', 'bonus']);

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    /* Win value thresholds (in bet multiples) that promote the mood. */
    tenseAtX: 1,         /* any non-zero win → tense */
    celebrationAtX: 10,  /* ≥ 10× bet win   → celebration */
    /* Per-mood RGB gradient stops. Designer customizes. */
    calmRGB:        '20,24,38',
    tenseRGB:       '38,30,20',
    celebrationRGB: '80,40,20',
    bonusRGB:       '24,16,48',
  });
}

function _clampFloat(n, lo, hi, fallback) {
  n = Number(n);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

export function resolveConfig(model = {}) {
  let cfg = { ...applyGridProfile('ambientBgVariants', defaultConfig(), model) };
  const m = model.ambientBgVariants || {};

  if (m.enabled != null) {
    if (m.enabled === true) {
      const ctxOverride = applyGridProfile('ambientBgVariants', { enabled: true }, model);
      cfg.enabled = ctxOverride.enabled !== false;
    } else {
      cfg.enabled = false;
    }
  }

  if (Number.isFinite(m.tenseAtX)) cfg.tenseAtX = _clampFloat(m.tenseAtX, 0, 1000, cfg.tenseAtX);
  if (Number.isFinite(m.celebrationAtX)) cfg.celebrationAtX = _clampFloat(m.celebrationAtX, 0, 10000, cfg.celebrationAtX);
  if (cfg.celebrationAtX < cfg.tenseAtX) cfg.celebrationAtX = cfg.tenseAtX;
  for (const key of ['calmRGB', 'tenseRGB', 'celebrationRGB', 'bonusRGB']) {
    if (typeof m[key] === 'string' && RGB_RE.test(m[key])) cfg[key] = m[key];
  }

  if (Array.isArray(model.features) &&
      model.features.some(f => f.kind === 'ambient_bg_variants' || f.kind === 'mood_bg')) {
    const ctxOverride = applyGridProfile('ambientBgVariants', { enabled: true }, model);
    cfg.enabled = ctxOverride.enabled !== false;
  }

  return cfg;
}

export function emitAmbientBgVariantsCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const T = TOKENS;
  return `
/* ─── ambient bg mood variants ──────────────────────────────────── */
body.ambient-bg {
  transition: background ${T.transitionMs}ms cubic-bezier(.4, 0, .2, 1);
  background:
    radial-gradient(circle at 50% 30%, rgba(var(--ambient-rgb, ${cfg.calmRGB}), .85) 0%, transparent 60%),
    linear-gradient(180deg, rgb(var(--ambient-rgb, ${cfg.calmRGB})) 0%, rgba(8,8,12,1) 100%);
}
body.ambient-bg[data-mood="calm"]        { --ambient-rgb: ${cfg.calmRGB}; }
body.ambient-bg[data-mood="tense"]       { --ambient-rgb: ${cfg.tenseRGB}; }
body.ambient-bg[data-mood="celebration"] { --ambient-rgb: ${cfg.celebrationRGB}; }
body.ambient-bg[data-mood="bonus"]       { --ambient-rgb: ${cfg.bonusRGB}; }
@media (prefers-reduced-motion: reduce) {
  body.ambient-bg { transition: none !important; }
}
`;
}

export function emitAmbientBgVariantsMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  /* sr-only status region so screen readers can hear mood changes
   * if the operator wants to surface them. By default empty. */
  return `<div id="ambientMoodLive" class="rwb-live" role="status" aria-live="off" aria-atomic="true"></div>`;
}

export function emitAmbientBgVariantsRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* ambientBgVariants: disabled */`;
  return `/* ─── ambient bg variants runtime ────────────────────────────── */
const AB_TENSE_AT       = ${cfg.tenseAtX};
const AB_CELEBRATION_AT = ${cfg.celebrationAtX};
const AB_VALID_MOODS    = ['calm','tense','celebration','bonus'];

(function wireAmbientBg(){
  document.body.classList.add('ambient-bg');
  let currentMood = 'calm';
  document.body.setAttribute('data-mood', currentMood);

  function setMood(next) {
    if (!AB_VALID_MOODS.includes(next)) return;
    if (next === currentMood) return;
    const prev = currentMood;
    currentMood = next;
    document.body.setAttribute('data-mood', next);
    if (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function') {
      HookBus.emit('onAmbientMoodChanged', { mood: next, prevMood: prev });
    }
  }

  function moodFromWin(winValue, betUnits) {
    const x = (betUnits > 0) ? (winValue / betUnits) : winValue;
    if (x >= AB_CELEBRATION_AT) return 'celebration';
    if (x >= AB_TENSE_AT)       return 'tense';
    return 'calm';
  }

  HookBus.on('onSpinResult', function(payload){
    if (currentMood === 'bonus') return; /* bonus dominates */
    const win = (payload && Number.isFinite(payload.totalWin)) ? payload.totalWin : 0;
    const bet = (typeof window !== 'undefined' && Number.isFinite(window.BET_UNITS)) ? window.BET_UNITS : 1;
    setMood(moodFromWin(win, bet));
  });
  HookBus.on('onBigWinTierEnter', function(){ setMood('celebration'); });
  HookBus.on('onBigWinTierExit',  function(){ setMood('calm'); });
  HookBus.on('onFsTrigger',       function(){ setMood('bonus'); });
  HookBus.on('onFsEnd',           function(){ setMood('calm'); });
  HookBus.on('onThemeChanged',    function(){
    /* Re-apply mood class to make sure new theme picks up the var. */
    document.body.classList.add('ambient-bg');
    document.body.setAttribute('data-mood', currentMood);
  });
})();
`;
}
