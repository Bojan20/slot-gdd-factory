/**
 * src/blocks/turboMode.mjs
 *
 * Wave U11 — Turbo Mode block.
 *
 * Industry-standard pattern (every certified slot ships a turbo / quick-
 * spin toggle): a hub button flips a global flag that compresses the
 * spin cadence — shorter stagger, less bounce, instant settle — for
 * players who want fast play. When on, the slam-stop overlay is
 * redundant (turbo IS instant) and is suppressed.
 *
 * The block OWNS:
 *   • window.__SLOT_TURBO_ACTIVE__ (boolean, single source of truth)
 *   • Persistence in localStorage (key: 'slot.turbo.active') — survives
 *     reload like every industry vendor's turbo toggle.
 *
 * Cadence override mechanism:
 *   We do NOT mutate reelEngine's baked SPIN_PROFILE constants (those
 *   live inside an IIFE closure). Instead we expose a single global
 *   multiplier — `window.__SLOT_TURBO_SPEED_MULT__` (default 1.0) — that
 *   spin-tempo aware blocks read at preSpin to scale their timings.
 *   When turbo is active, this multiplier becomes the configured
 *   `turboSpeedMult` (default 0.35 = roughly 3× faster). Listeners that
 *   want to honor turbo can read the flag at spin-start; engines that
 *   bake constants at orchestrator time get the boolean only.
 *
 * Composition contract:
 *   • slamStop.mjs already gates `hideOnTurbo` on window.__SLOT_TURBO_ACTIVE__.
 *   • autoplay.mjs is unaffected — turbo is orthogonal (a turbo autoplay
 *     session just runs faster). Both can be on at once.
 *   • forceSkip.mjs is unaffected — the skip button still appears during
 *     rollup/FS; turbo only changes spin tempo, not rollup tempo.
 *   • spinTempo.mjs (Wave E) bakes its constants at orchestrator time so
 *     it doesn't react to live turbo toggle; future refactor can read
 *     window.__SLOT_TURBO_SPEED_MULT__ at preSpin for live override.
 *
 * Lifecycle (HookBus contract):
 *   onAutoplayStart → no-op (just observed; autoplay + turbo coexist)
 *   preSpin         → sync window.__SLOT_TURBO_SPEED_MULT__ to current
 *                     state (in case something cleared it externally)
 *
 * Emits new event:
 *   onTurboToggle ({ active: boolean, source: 'button' | 'init' | 'api' })
 *
 * Bake-time config:
 *   { enabled, initialActive, persistInLocalStorage,
 *     turboSpeedMult, chipLabel, chipColor, chipTextColor,
 *     position, ariaLabel }
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitTurboModeCSS(cfg)
 *   emitTurboModeMarkup(cfg)
 *   emitTurboModeRuntime(cfg)
 *
 * Runtime contract:
 *   turboModeOn() / turboModeOff() / turboModeToggle() / turboModeIsActive()
 *   TURBO_MODE_STATE on window
 */

export function defaultConfig() {
  return {
    /* Industry-default ON — the ⚡ floating chip is the universal
     * surface across modern HTML5 slot suites (most certified studios
     * expose it by default). GDDs that prefer a settings-panel toggle
     * instead can disable the standalone chip via
     * `## Turbo\nenabled: false` or by emitting a `no_turbo` (a.k.a.
     * `turbo_disabled`) feature kind. */
    enabled: true,
    initialActive: false,
    persistInLocalStorage: true,
    /* Multiplier applied to spin-tempo timings when turbo is on. 0.35
     * gives roughly 3× faster spins which matches the industry "quick
     * spin" baseline (turbo proper goes even further — see U12). */
    turboSpeedMult: 0.35,
    chipLabel: 'TURBO',
    chipColor:     '255,140,40',     /* warm orange, distinct from gold accent */
    chipTextColor: '255,255,255',
    /* Position is informational — markup is in-flow; orchestrator places
     * the button inside .sideHud beside the SPIN button. Future variant
     * could mount it elsewhere. */
    position: 'sideHud',
    ariaLabel: 'Toggle turbo spin mode',
  };
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = (model && model.turboMode) || {};

  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (m.initialActive != null) cfg.initialActive = !!m.initialActive;
  if (m.persistInLocalStorage != null) cfg.persistInLocalStorage = !!m.persistInLocalStorage;

  if (Number.isFinite(m.turboSpeedMult) && m.turboSpeedMult > 0) {
    /* Industry sane range: 0.1 (10× faster, basically instant) → 1.0
     * (no speedup, just a UI toggle without effect). */
    cfg.turboSpeedMult = Math.max(0.1, Math.min(1.0, Number(m.turboSpeedMult)));
  }

  if (typeof m.chipLabel === 'string' && m.chipLabel.length > 0 && m.chipLabel.length <= 8) {
    cfg.chipLabel = m.chipLabel;
  }
  for (const key of ['chipColor', 'chipTextColor']) {
    if (typeof m[key] === 'string' && /^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/.test(m[key])) {
      cfg[key] = m[key].replace(/\s+/g, '');
    }
  }
  if (typeof m.ariaLabel === 'string' && m.ariaLabel.length > 0 && m.ariaLabel.length <= 64) {
    cfg.ariaLabel = m.ariaLabel;
  }

  /* Auto-disable from feature kind. */
  if (model.features && Array.isArray(model.features)) {
    const explicitlyOff = model.features.some(
      (f) => f && typeof f.kind === 'string' && /^(no[_-]?turbo|turbo[_-]?disabled)$/i.test(f.kind),
    );
    if (explicitlyOff) cfg.enabled = false;
  }

  return cfg;
}

function _escape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function emitTurboModeCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const c = resolveConfig({ turboMode: cfg });
  return `
  /* ── turboMode BLOCK — emitted by src/blocks/turboMode.mjs ─────────── */
  /* Spin-cluster satellite: bottom-right, pinned next to side HUD.
     Same circular footprint as autoBtn so the cluster reads as one unit. */
  .turbo-btn {
    position: fixed;
    right: max(18px, env(safe-area-inset-right, 18px));
    bottom: max(18px, env(safe-area-inset-bottom, 18px));
    z-index: 25;
    width: var(--spin-auto-size);
    height: var(--spin-auto-size);
    border-radius: 50%;
    border: 2px solid rgba(${c.chipColor}, 0.55);
    background: linear-gradient(180deg, rgba(${c.chipColor}, 0.12), rgba(${c.chipColor}, 0.04));
    color: rgb(${c.chipTextColor});
    font-family: inherit;
    font-weight: 800;
    /* Wave Q-fix — bumped from 10px to 11px so the chip clears the
       universal-gdd typography gate (min readable size 11px). */
    font-size: 11px;
    letter-spacing: 1.2px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.06),
      0 2px 6px rgba(0, 0, 0, 0.45);
    transition: transform 120ms ease-out, opacity 140ms ease-out,
                background 200ms ease-out, box-shadow 200ms ease-out;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    opacity: 0.7;
  }
  @media (max-width: 620px) {
    .turbo-btn {
      right: max(12px, env(safe-area-inset-right, 12px));
      bottom: max(12px, env(safe-area-inset-bottom, 12px));
    }
  }
  .turbo-btn:hover  { transform: scale(1.06); opacity: 0.9; }
  .turbo-btn:active { transform: scale(0.94); }
  /* Active state — pronounced glow so the player knows turbo is on. */
  .turbo-btn.is-active {
    background: linear-gradient(180deg, rgba(${c.chipColor}, 0.65), rgba(${c.chipColor}, 0.45));
    border-color: rgba(${c.chipColor}, 1);
    opacity: 1;
    box-shadow:
      0 0 18px rgba(${c.chipColor}, 0.7),
      inset 0 1px 0 rgba(255, 255, 255, 0.18),
      0 2px 8px rgba(0, 0, 0, 0.5);
  }
  .turbo-btn::before {
    content: '⚡';
    margin-right: 2px;
    font-size: 11px;
    opacity: 0.85;
  }
  /* Reduced-motion gate — animations off. */
  @media (prefers-reduced-motion: reduce) {
    .turbo-btn { transition: none; }
  }
`;
}

export function emitTurboModeMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const c = resolveConfig({ turboMode: cfg });
  const safeAria  = _escape(c.ariaLabel);
  const safeLabel = _escape(c.chipLabel);
  /* aria-pressed reflects toggle state; runtime updates it on every change. */
  return `
  <button id="turboBtn" class="turbo-btn" type="button" aria-label="${safeAria}" aria-pressed="false">${safeLabel}</button>`;
}

export function emitTurboModeRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) {
    return `
  /* ── turboMode BLOCK (disabled) — stub ────────────────────────────── */
  window.turboModeOn       = function () {};
  window.turboModeOff      = function () {};
  window.turboModeToggle   = function () {};
  window.turboModeIsActive = function () { return false; };
  window.TURBO_MODE_STATE  = { enabled: false, active: false };
  /* Leave __SLOT_TURBO_ACTIVE__ undefined when disabled — slamStop already
   * treats undefined as "no turbo gate". */
`;
  }

  const c = resolveConfig({ turboMode: cfg });
  return `
  /* ── turboMode BLOCK — emitted by src/blocks/turboMode.mjs ────────────
     Owns: window.__SLOT_TURBO_ACTIVE__ + window.__SLOT_TURBO_SPEED_MULT__
           + emit of onTurboToggle event.
     Subscribes:
       preSpin → resync window.__SLOT_TURBO_SPEED_MULT__ to current state
                  (defensive — protects against external clears)
     Emits:
       onTurboToggle ({ active, source }) */
  (function () {
    var INITIAL_ACTIVE = ${c.initialActive};
    var PERSIST        = ${c.persistInLocalStorage};
    var SPEED_MULT     = ${c.turboSpeedMult};
    var LS_KEY         = 'slot.turbo.active';

    var STATE = {
      enabled: true,
      active: false,
    };

    function _readPersisted() {
      if (!PERSIST) return null;
      try {
        var raw = window.localStorage && window.localStorage.getItem(LS_KEY);
        if (raw === '1' || raw === 'true') return true;
        if (raw === '0' || raw === 'false') return false;
      } catch (_) { /* privacy mode — silent */ }
      return null;
    }
    function _writePersisted(val) {
      if (!PERSIST) return;
      try {
        if (window.localStorage) {
          window.localStorage.setItem(LS_KEY, val ? '1' : '0');
        }
      } catch (_) { /* defensive */ }
    }

    function _btn() { return document.getElementById('turboBtn'); }

    function _applyGlobals() {
      if (typeof window === 'undefined') return;
      window.__SLOT_TURBO_ACTIVE__     = !!STATE.active;
      window.__SLOT_TURBO_SPEED_MULT__ = STATE.active ? SPEED_MULT : 1.0;
    }

    function _paintBtn() {
      var b = _btn();
      if (!b) return;
      b.classList.toggle('is-active', !!STATE.active);
      b.setAttribute('aria-pressed', STATE.active ? 'true' : 'false');
    }

    function _emit(source) {
      if (!window.HookBus || typeof window.HookBus.emit !== 'function') return;
      try {
        window.HookBus.emit('onTurboToggle', {
          active: !!STATE.active,
          source: (typeof source === 'string') ? source : 'api',
        });
      } catch (_) { /* defensive — never strand the toggle path */ }
    }

    function turboModeOn(source) {
      if (STATE.active) return;
      STATE.active = true;
      _applyGlobals();
      _writePersisted(true);
      _paintBtn();
      _emit(source || 'api');
    }
    function turboModeOff(source) {
      if (!STATE.active) return;
      STATE.active = false;
      _applyGlobals();
      _writePersisted(false);
      _paintBtn();
      _emit(source || 'api');
    }
    function turboModeToggle(source) {
      if (STATE.active) turboModeOff(source);
      else turboModeOn(source);
    }
    function turboModeIsActive() { return !!STATE.active; }

    if (typeof window !== 'undefined') {
      window.turboModeOn       = turboModeOn;
      window.turboModeOff      = turboModeOff;
      window.turboModeToggle   = turboModeToggle;
      window.turboModeIsActive = turboModeIsActive;
      window.TURBO_MODE_STATE  = STATE;
    }

    /* Initial state: persisted value > INITIAL_ACTIVE config. */
    function _init() {
      var persisted = _readPersisted();
      var initial = (persisted !== null) ? persisted : INITIAL_ACTIVE;
      STATE.active = !!initial;
      _applyGlobals();
      _paintBtn();
      _emit('init');
    }

    function _wireDom() {
      var b = _btn();
      if (b) b.addEventListener('click', function () { turboModeToggle('button'); });
      _init();
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _wireDom, { once: true });
    } else {
      _wireDom();
    }

    /* HookBus wiring — defensive resync on every preSpin. Some tests
     * or third-party tools may overwrite window.__SLOT_TURBO_SPEED_MULT__;
     * we re-establish the source of truth before each new spin. */
    if (window.HookBus && typeof window.HookBus.on === 'function') {
      window.HookBus.on('preSpin', function () {
        _applyGlobals();
      }, { priority: 30 });
    }
  })();
`;
}
