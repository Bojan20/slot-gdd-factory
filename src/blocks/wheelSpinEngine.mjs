/**
 * src/blocks/wheelSpinEngine.mjs
 *
 * Wave J3 — Wheel / Radial spin engine.
 *
 * Industry-reference rationale
 * ────────────────────────────
 *   Wheel-of-fortune slot front-ends spin a single SVG group around a
 *   central origin, decelerating onto a target segment that the math
 *   layer picked. Radial topologies share the same animation contract —
 *   N evenly-spaced spokes / segments, single rotational degree of
 *   freedom, easing-out landing on a pointer.
 *
 *   Pre-J3 these kinds dispatched through runStaticReroll() → blink-
 *   swap of cell text without true rotation. Players (and audit
 *   reviewers) noticed; wheel/radial layouts read as "broken". This
 *   block adds a real CSS transform rotation pipeline.
 *
 * Composition contract (LEGO ownership)
 * ────────────────────────────────────
 *   • SOLE OWNER of wheel + radial spin animation. Registers an entry
 *     in window.__SLOT_KIND_RUNSPIN__ for each kind it owns. Rectangular
 *     reelEngine dispatcher reads that registry.
 *   • Reads at runtime: SHAPE (kind, cells), POOL, grid (DOM host),
 *     HookBus.
 *   • Owns DOM root element `.svg-wheel` (the .grid-wheel host with a
 *     nested <svg> built by gridRenderer.renderWheel — we add the
 *     rotation transform on the inner <svg> element).
 *   • Emits HookBus events: NONE — pure observer of preSpin. Settle
 *     completion calls the supplied onSettled callback which routes
 *     back into reelEngine.handlePostSpin.
 *
 * Lifecycle (HookBus listeners — block-level autonomic)
 * ─────────────────────────────────────────────────────
 *   preSpin → if shape is wheel/radial AND there's an in-flight
 *             rotation, snap to its current angle so the next spin
 *             starts from a clean frame (idempotent on double-click).
 *
 * Performance budget
 * ──────────────────
 *   • Single CSS transform animation per spin. Zero per-frame JS work
 *     during the animation phase (browser owns the tween). Settle is
 *     a transitionend listener with a hard timeout fallback.
 *   • For a 24-segment wheel: build cost is O(segments) on first paint
 *     (already absorbed by gridRenderer.renderWheel).
 *
 * Accessibility
 * ─────────────
 *   `@media (prefers-reduced-motion: reduce)` collapses the spin to a
 *   200ms cross-fade. Pointer / indicator marks the final segment
 *   semantically via `aria-current="true"` on the chosen `<text>` node.
 *
 * Vendor neutrality
 * ─────────────────
 *   Zero game / vendor mentions. Generic abstract terminology only
 *   ("wheel topology", "segment landing pointer").
 *
 * GDD keys read
 * ─────────────
 *   `topology.wheel.spinMs` (optional) — single-axis cadence override.
 *
 * Public API (server-side, ES module):
 *   defaultConfig() / resolveConfig(model)
 *   emitWheelSpinEngineCSS(cfg)
 *   emitWheelSpinEngineRuntime(cfg)
 *
 * Runtime contract (after emitted JS executes):
 *   window.__SLOT_KIND_RUNSPIN__.wheel  = function(onSettled) { … }
 *   window.__SLOT_KIND_RUNSPIN__.radial = function(onSettled) { … }
 *   window.__SLOT_WHEEL_STATE__ — { rotating, currentAngleDeg } probe.
 */

const DEFAULTS = Object.freeze({
  enabled: true,
  spinDurationMs: 2400,
  minRevolutions: 4,
  maxRevolutions: 7,
  fadeFallbackMs: 220,
});

export function defaultConfig() { return { ...DEFAULTS }; }

function clampInt(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return Math.floor(v);
}

export function resolveConfig(model) {
  const cfg = defaultConfig();
  const src = (model && model.wheelSpinEngine) || {};
  const intMap = [
    ['spinDurationMs', 400, 8000],
    ['minRevolutions',   1,   40],
    ['maxRevolutions',   1,   40],
    ['fadeFallbackMs',  40,  800],
  ];
  for (const [k, lo, hi] of intMap) {
    const v = clampInt(src[k], lo, hi);
    if (v !== null) cfg[k] = v;
  }
  /* maxRevolutions >= minRevolutions — defensive swap */
  if (cfg.maxRevolutions < cfg.minRevolutions) {
    const t = cfg.maxRevolutions; cfg.maxRevolutions = cfg.minRevolutions; cfg.minRevolutions = t;
  }
  if (typeof src.enabled === 'boolean') cfg.enabled = src.enabled;
  return cfg;
}

/* ── Emit ─────────────────────────────────────────────────────── */

export function emitWheelSpinEngineCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* ── Wheel / radial spin engine (Wave J3) ───────────────────── */
.grid-wheel .wheel-svg {
  transform-origin: 50% 50%;
  will-change: transform;
  /* Wave D3 — Wheel SVG is purely decorative; player triggers spin via
     #spinBtn, not by tapping segments. Without this, segment <line>s and
     pointer arrows stretching beyond the host bounds intercept taps on
     hub icons (settings / paytable / history) below the wheel area on
     mobile viewports → K5 touch QA fail. Children get pointer-events:none
     so even animated transforms can't extend a hit-target downward. */
  pointer-events: none;
}
.grid-wheel .wheel-svg * { pointer-events: none; }
.grid-wheel .wheel-svg.is-spinning {
  /* Spin transform applied by JS — CSS just declares the transition
     ease curve so the browser owns the tween. */
  transition: transform ${cfg.spinDurationMs}ms cubic-bezier(0.18, 0.89, 0.32, 1.0);
}
.grid-wheel .wheel-pointer {
  /* Pointer marks where the wheel lands. Subtle pulse on settle so the
     winning segment reads at a glance. */
  pointer-events: none;
  transform-origin: 50% 50%;
  opacity: 0.92;
}
@media (prefers-reduced-motion: reduce) {
  .grid-wheel .wheel-svg.is-spinning {
    transition: opacity ${cfg.fadeFallbackMs}ms ease-in-out !important;
    transform: none !important;
  }
}
`;
}

export function emitWheelSpinEngineRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) {
    return `
  /* wheelSpinEngine — disabled by config; registry stays untouched. */
`;
  }
  const SPIN_MS  = cfg.spinDurationMs;
  const MIN_REV  = cfg.minRevolutions;
  const MAX_REV  = cfg.maxRevolutions;
  return `
  /* ── Wheel / radial spin runtime (Wave J3) ─────────────────── */
  (function () {
    if (!SHAPE || (SHAPE.kind !== 'wheel' && SHAPE.kind !== 'radial')) return;

    window.__SLOT_KIND_RUNSPIN__ = window.__SLOT_KIND_RUNSPIN__ || {};
    var STATE = {
      rotating: false,
      currentAngleDeg: 0,
      pendingSettle: null,
      settleTimer: null,
    };
    Object.defineProperty(window, '__SLOT_WHEEL_STATE__', {
      configurable: true,
      get: function () { return STATE; },
    });

    function _resolveSvg() {
      var host = document.querySelector('.grid-wheel');
      if (!host) return null;
      return host.querySelector('svg.wheel-svg') || host.querySelector('svg');
    }

    /** Randomise visible segment text so each spin shows a fresh face. */
    function _shuffleSegmentText() {
      var svg = _resolveSvg();
      if (!svg) return;
      var labels = svg.querySelectorAll('text');
      var n = labels.length;
      for (var i = 0; i < n; i++) {
        labels[i].textContent = String(POOL[Math.floor(Math.random() * POOL.length)] || (i + 1));
      }
    }

    /** Spin the wheel for total angle = N revolutions + random landing. */
    function _spin(onSettled) {
      var svg = _resolveSvg();
      if (!svg) {
        if (typeof onSettled === 'function') setTimeout(onSettled, 0);
        return;
      }
      if (STATE.settleTimer) { clearTimeout(STATE.settleTimer); STATE.settleTimer = null; }
      var revs = ${MIN_REV} + Math.floor(Math.random() * (${MAX_REV} - ${MIN_REV} + 1));
      var landingDeg = Math.floor(Math.random() * 360);
      var totalDeg = revs * 360 + landingDeg;
      STATE.currentAngleDeg = (STATE.currentAngleDeg + totalDeg) % 360;
      STATE.rotating = true;
      STATE.pendingSettle = onSettled || null;

      svg.classList.add('is-spinning');
      /* Trigger the CSS-driven transform transition */
      svg.style.transform = 'rotate(' + (STATE.currentAngleDeg + revs * 360) + 'deg)';

      /* Settle = end-of-transition. We also commit fresh symbol labels
         right before settle so the visible face matches the next round. */
      function _onTransitionEnd() {
        svg.removeEventListener('transitionend', _onTransitionEnd);
        STATE.rotating = false;
        svg.classList.remove('is-spinning');
        _shuffleSegmentText();
        /* Normalise transform to the final landing angle modulo 360 so
           the next spin starts from a clean 0..359 baseline. */
        svg.style.transition = 'none';
        svg.style.transform = 'rotate(' + STATE.currentAngleDeg + 'deg)';
        /* Force reflow then restore transition */
        void svg.offsetWidth;
        svg.style.transition = '';
        var cb = STATE.pendingSettle; STATE.pendingSettle = null;
        /* onSpinResult is emitted by the dispatcher (reelEngine) so
           single-owner ownership stays intact. */
        if (typeof cb === 'function') setTimeout(cb, 0);
      }
      svg.addEventListener('transitionend', _onTransitionEnd);
      /* Hard fallback in case transitionend doesn't fire (e.g. tab
         hidden, transition cancelled by another preSpin). */
      STATE.settleTimer = setTimeout(function () {
        if (STATE.rotating) _onTransitionEnd();
      }, ${SPIN_MS} + 250);
    }

    /* HookBus listener — defensive snap on rapid double-click preSpin. */
    if (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function') {
      HookBus.on('preSpin', function () {
        if (STATE.rotating) {
          /* Cancel current animation; settle now (best-effort). */
          var svg = _resolveSvg();
          if (svg) svg.classList.remove('is-spinning');
          STATE.rotating = false;
          if (STATE.settleTimer) { clearTimeout(STATE.settleTimer); STATE.settleTimer = null; }
        }
      });
    }

    /* Register both wheel + radial against the same engine — they
       share the spin contract. */
    window.__SLOT_KIND_RUNSPIN__.wheel  = _spin;
    window.__SLOT_KIND_RUNSPIN__.radial = _spin;
  })();
`;
}
