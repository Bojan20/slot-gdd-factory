import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/fsProgressBar.mjs
 *
 * Wave B69 — Free-Spins Progress Bar block.
 *
 * Industry baseline: a small, persistent UI strip that tells the player
 * exactly where they are in the FS round (e.g. "Spin 7 of 15"). The bar
 * shows a filled segment proportional to spins consumed and a plain-text
 * label so screen readers announce the same information.
 *
 * Public API (server-side, ES module):
 *   defaultConfig()                    → safe defaults (disabled, no UI).
 *   resolveConfig(model)               → merge defaults with model.fsProgressBar.
 *   emitFsProgressBarCSS(cfg)          → CSS rules for the strip + fill.
 *   emitFsProgressBarMarkup(cfg)       → host element with ARIA wiring.
 *   emitFsProgressBarRuntime(cfg)      → runtime JS that listens to FS lifecycle.
 *
 * Lifecycle:
 *   subscribes:
 *     onFsTrigger       — total spins awarded; show strip, set max, value=0
 *     onFsSpinResult    — increment consumed, update fill + label
 *     onFsEnd           — clear, hide strip after a brief hold
 *     onFsRetrigger     — bump total + max, keep fill ratio honest
 *   emits:
 *     (none — pure presenter; no downstream side-effects)
 *
 * Vendor-neutral. No game-name strings, no studio identifiers, no
 * proprietary cabinet vocabulary. Industry-reference is the generic
 * "feature-progress chip" UX pattern, not any particular vendor.
 *
 * Performance budget:
 *   defaultConfig()                  ≤ 0.1 ms.
 *   resolveConfig()                  ≤ 0.5 ms.
 *   emitFsProgressBarCSS()           ≤ 0.5 ms.
 *   emitFsProgressBarMarkup()        ≤ 0.3 ms.
 *   emitFsProgressBarRuntime()       ≤ 1.0 ms.
 *   onFsSpinResult handler           ≤ 0.3 ms (single textContent + style write).
 *
 * Accessibility:
 *   - <div role="progressbar"> on the host element.
 *   - aria-valuemin / aria-valuemax / aria-valuenow kept in sync.
 *   - aria-live="polite" on the label so the next text update is queued
 *     (never interrupting). Apple HIG 11 px font floor.
 *   - prefers-reduced-motion neutralises the fill transition; the bar
 *     still updates instantly but without the slide animation.
 *
 * GDD knobs (under model.fsProgressBar):
 *   enabled         boolean
 *   position        'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'
 *   barColor        'r,g,b'
 *   barTextColor    'r,g,b'
 *   trackColor      'r,g,b'
 *   labelTemplate   string — '{i} of {n}' or 'Spin {i}/{n}'; tokens
 *                   {i} = consumed (1-based on first spin) and {n} = total
 *   showOnRetrigger boolean
 */

const TRANSITION_MS  = 240;
const HIDE_DELAY_MS  = 1100;
const MAX_TOTAL      = 999;
const MIN_LABEL_SIZE = 11;        /* Apple HIG floor */
const MAX_LABEL_SIZE = 18;
const POSITIONS      = new Set(['top-right', 'top-left', 'bottom-right', 'bottom-left']);

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    position: 'top-right',
    barColor:      '255,210,90',   /* warm yellow — readable on dark themes */
    barTextColor:  '14,12,28',     /* near-black — guaranteed contrast with bar */
    trackColor:    '255,255,255',  /* track behind the bar (will be alpha-blended) */
    labelTemplate: '{i} of {n}',
    showOnRetrigger: true,
    fontSizePx: 12,
  });
}

function clampInt(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  return Math.min(Math.max(Math.floor(n), lo), hi);
}

function isRgbTriplet(s) {
  return typeof s === 'string' && /^\d{1,3},\d{1,3},\d{1,3}$/.test(s);
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.fsProgressBar) || {};

  if (m.enabled != null) cfg.enabled = !!m.enabled;
  /* Auto-enable when the GDD declares a feature kind that maps to
   * the standard FS round. The presence of fs-style features is the
   * single source of truth — adding fsProgressBar to a slot without an
   * fs round would render an empty bar forever. */
  if (m.enabled == null) {
    const features = Array.isArray(model && model.features) ? model.features : [];
    const FS_PATTERN = /^(free[_-]?spins?|fs[_-]?round|fs[_-]?feature)$/i;
    cfg.enabled = features.some(f => f && typeof f.kind === 'string' && FS_PATTERN.test(f.kind));
  }

  if (POSITIONS.has(m.position)) cfg.position = m.position;
  if (isRgbTriplet(m.barColor)) cfg.barColor = m.barColor;
  if (isRgbTriplet(m.barTextColor)) cfg.barTextColor = m.barTextColor;
  if (isRgbTriplet(m.trackColor)) cfg.trackColor = m.trackColor;

  if (typeof m.labelTemplate === 'string' && m.labelTemplate.length > 0
      && m.labelTemplate.length <= 60
      && m.labelTemplate.includes('{i}') && m.labelTemplate.includes('{n}')) {
    cfg.labelTemplate = m.labelTemplate;
  }

  if (m.showOnRetrigger != null) cfg.showOnRetrigger = !!m.showOnRetrigger;
  if (Number.isFinite(m.fontSizePx)) {
    cfg.fontSizePx = clampInt(m.fontSizePx, MIN_LABEL_SIZE, MAX_LABEL_SIZE);
  }

  return cfg;
}

function positionCss(pos) {
  switch (pos) {
    case 'top-left':     return 'top: calc(max(12px, env(safe-area-inset-top, 12px)) + 4px); left: 12px;';
    case 'bottom-right': return 'bottom: calc(max(12px, env(safe-area-inset-bottom, 12px)) + 4px); right: 12px;';
    case 'bottom-left':  return 'bottom: calc(max(12px, env(safe-area-inset-bottom, 12px)) + 4px); left: 12px;';
    case 'top-right':
    default:             return 'top: calc(max(12px, env(safe-area-inset-top, 12px)) + 4px); right: 12px;';
  }
}

export function emitFsProgressBarCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* ─── fsProgressBar ─────────────────────────────────────────────── */
.fs-progress {
  position: fixed;
  ${positionCss(cfg.position)}
  z-index: 32;                  /* sits between modal hub (30) and fixed chips (35) */
  display: none;
  align-items: center;
  gap: 8px;
  min-width: 144px;
  padding: 7px 11px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.72);
  border: 1px solid rgba(${cfg.barColor}, 0.55);
  font-size: ${cfg.fontSizePx}px;
  font-weight: 700;
  color: rgb(${cfg.barColor});
  letter-spacing: 0.05em;
  /* W47.S5 (A1 lesson) — halo for the label so theme overrides don't
   * regress contrast even when the GDD picks a near-track barColor. */
  text-shadow: 0 0 4px rgba(0, 0, 0, 0.85);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
}
.fs-progress[data-show="true"] { display: inline-flex; }
.fs-progress__label { white-space: nowrap; }
.fs-progress__track {
  position: relative;
  width: 64px;
  height: 6px;
  border-radius: 999px;
  background: rgba(${cfg.trackColor}, 0.16);
  overflow: hidden;
}
.fs-progress__fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: 0%;
  background: linear-gradient(90deg, rgba(${cfg.barColor}, 0.65), rgba(${cfg.barColor}, 1));
  border-radius: 999px;
  transition: width ${TRANSITION_MS}ms ease-out;
}
.fs-progress.is-done .fs-progress__fill { background: rgba(${cfg.barColor}, 1); }
@media (prefers-reduced-motion: reduce) {
  .fs-progress__fill { transition: none; }
}
`;
}

export function emitFsProgressBarMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  /* UQ-DEEP-AT H-1 phase-3: aria-label localized via data-i18n-aria. */
  return tagBlockMarkup(`
  <div id="fsProgress" class="fs-progress" role="progressbar"
       aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"
       aria-label="Free spins progress" data-i18n-aria="fsProgressBar.0" data-i18n-aria-fallback="Free spins progress" data-dynamic-aria="true" data-show="false">
    <span id="fsProgressLabel" class="fs-progress__label" aria-live="polite">Spin 0 of 0</span>
    <span class="fs-progress__track"><span id="fsProgressFill" class="fs-progress__fill"></span></span>
  </div>`, 'fsProgressBar');
}

export function emitFsProgressBarRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) {
    return `
  /* ─── fsProgressBar BLOCK (disabled by GDD) ──────────────────────── */
  window.fsProgressShow   = function () {};
  window.fsProgressUpdate = function () {};
  window.fsProgressHide   = function () {};
`;
  }
  const tmpl = JSON.stringify(cfg.labelTemplate);
  const showOnRetrigger = cfg.showOnRetrigger ? 'true' : 'false';
  return `
  /* ─── fsProgressBar BLOCK — emitted by src/blocks/fsProgressBar.mjs ──
     Owns: progress strip lifecycle for the FS round.
     Listens: onFsTrigger / onFsSpinResult / onFsRetrigger / onFsEnd.
     Emits: nothing (pure presenter).
     The block reads FSM.spinsTotal + FSM.spinsRemaining when present so
     a host slot that drives the FS round through freeSpins.mjs gets the
     counters for free; everything else flows through HookBus payloads. */
  (function _fsProgressBarBoot() {
    var LABEL_TMPL    = ${tmpl};
    var SHOW_ON_RETRIG = ${showOnRetrigger};
    var HIDE_DELAY    = ${HIDE_DELAY_MS};

    var state = { total: 0, consumed: 0, hideTimer: 0 };

    function _node()  { return document.getElementById('fsProgress'); }
    function _label() { return document.getElementById('fsProgressLabel'); }
    function _fill()  { return document.getElementById('fsProgressFill'); }

    function _fmt(i, n) {
      return LABEL_TMPL.replace('{i}', String(i)).replace('{n}', String(n));
    }

    function _paint() {
      var host = _node(); if (!host) return;
      var lbl  = _label();
      var fill = _fill();
      var total = Math.max(0, state.total);
      var done  = Math.min(state.consumed, total);
      if (lbl)  lbl.textContent = _fmt(done, total);
      if (fill) fill.style.width = (total > 0 ? (done * 100 / total) : 0) + '%';
      host.setAttribute('aria-valuemax', String(total));
      host.setAttribute('aria-valuenow', String(done));
      host.classList.toggle('is-done', total > 0 && done >= total);
    }

    function fsProgressShow(total) {
      var host = _node(); if (!host) return;
      if (state.hideTimer) { clearTimeout(state.hideTimer); state.hideTimer = 0; }
      state.total = Math.max(0, Math.min(${MAX_TOTAL}, Math.floor(Number(total) || 0)));
      state.consumed = 0;
      _paint();
      host.setAttribute('data-show', 'true');
    }

    function fsProgressUpdate(consumed) {
      var n = Number(consumed);
      if (!Number.isFinite(n)) return;
      state.consumed = Math.max(0, Math.floor(n));
      _paint();
    }

    function fsProgressRetrigger(extra) {
      var add = Number(extra);
      if (!Number.isFinite(add) || add <= 0) return;
      state.total = Math.min(${MAX_TOTAL}, state.total + Math.floor(add));
      _paint();
      if (SHOW_ON_RETRIG) {
        var host = _node(); if (host) host.setAttribute('data-show', 'true');
      }
    }

    function fsProgressHide() {
      var host = _node(); if (!host) return;
      if (state.hideTimer) clearTimeout(state.hideTimer);
      state.hideTimer = setTimeout(function () {
        var n = _node();
        if (n) n.setAttribute('data-show', 'false');
        state.hideTimer = 0;
        state.total = 0;
        state.consumed = 0;
      }, HIDE_DELAY);
    }

    /* Public surface — exposed for hooks + manual force from the console. */
    window.fsProgressShow   = fsProgressShow;
    window.fsProgressUpdate = fsProgressUpdate;
    window.fsProgressHide   = fsProgressHide;

    function _spinsFromFSM(payload) {
      if (payload && Number.isFinite(payload.award))         return payload.award;
      if (payload && Number.isFinite(payload.spinsTotal))    return payload.spinsTotal;
      if (typeof FSM !== 'undefined' && Number.isFinite(FSM.spinsTotal)) return FSM.spinsTotal;
      return 0;
    }

    if (typeof HookBus !== 'undefined') {
      HookBus.on('onFsTrigger', function (payload) {
        fsProgressShow(_spinsFromFSM(payload));
      });
      HookBus.on('onFsSpinResult', function (payload) {
        var total = (typeof FSM !== 'undefined') ? FSM.spinsTotal : state.total;
        var remaining = (payload && Number.isFinite(payload.spinsRemaining))
                        ? payload.spinsRemaining
                        : (typeof FSM !== 'undefined' ? FSM.spinsRemaining : 0);
        if (total > 0 && state.total !== total) state.total = total;
        fsProgressUpdate(state.total - remaining);
      });
      (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onFsRetrigger', function (payload) {
        fsProgressRetrigger(payload && payload.award);
      }) : void 0);
      HookBus.on('onFsEnd', function () { fsProgressHide(); });
    }
  })();
`;
}
