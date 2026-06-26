import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/convergenceHud.mjs
 *
 * MATH-INTEGRATION-LV3 atom #14 (Boki 2026-06-26) — Live UI overlay
 * for the auto-converge solver. Sister to `liveRtpHud.mjs`:
 *
 *   • liveRtpHud      — shows MEASURED vs DECLARED RTP per spin
 *   • convergenceHud  — shows AUTO-SOLVER iteration progress
 *                       (current weights, residual, convergence band)
 *
 * # WHY A SEPARATE BLOCK
 *
 * The two HUDs answer different questions:
 *
 *   liveRtpHud      "Is the game converging on its declared RTP?"
 *   convergenceHud  "Is the auto-solver finding the right weights?"
 *
 * A regulator demo shows both side by side so an inspector can see
 * the SOLVER iterating in real time AND the slot game responding to
 * the new weight set per iteration. Without convergenceHud the
 * solver is a black box.
 *
 * # DATA SOURCE
 *
 * Polls `window.__SOLVER_STATE__` every 250 ms when the block is
 * enabled. The solver (LV3-13 `tools/auto-converge-solver.mjs`) is
 * a Node-side tool by design (regulator reproducibility), so the
 * client-side HUD only reads state that the operator pushes via
 * SSE / WebSocket from the uploader server. When no state is
 * available the HUD displays an "idle" placeholder and stays at
 * 0-byte runtime cost.
 *
 * Public API
 *   defaultConfig() / resolveConfig(model)
 *   emitConvergenceHudCSS(cfg)
 *   emitConvergenceHudMarkup(cfg)
 *   emitConvergenceHudRuntime(cfg, model)
 *
 * Lifecycle (HookBus contract)
 *   subscribes:
 *     onLiveRtpUpdate     → tick reading window.__SOLVER_STATE__
 *     onAutoSolverIter    → DOM refresh
 *   emits:
 *     onSolverConverged   { iter, finalRtp, deltaBps }
 *
 * GDD keys
 *   model.convergenceHud.enabled            boolean (default false)
 *   model.convergenceHud.position           string  (default 'top-left')
 *   model.convergenceHud.pollIntervalMs     number  (default 250)
 *   model.convergenceHud.toleranceBps       number  (default 5)
 *   model.convergenceHud.debugLog           boolean (default false)
 *
 * Anti-vendor: no product names embedded, vendor-neutral copy.
 */

import { Z } from '../registry/zIndexScale.mjs';

const DEFAULTS = Object.freeze({
  enabled: false,
  position: 'top-left',
  pollIntervalMs: 250,
  toleranceBps: 5,
  debugLog: false,
  schemaVersion: '1',
});

const VALID_POSITIONS = Object.freeze(new Set([
  'top-left', 'top-right', 'bottom-left', 'bottom-right',
]));

/* Numeric clamp bounds. */
const BOUNDS = Object.freeze({
  pollIntervalMs: { min: 50,  max: 5000, integer: true },
  toleranceBps:   { min: 1,   max: 500,  integer: true },
});

export function defaultConfig() {
  return Object.freeze({ ...DEFAULTS });
}

export function resolveConfig(model) {
  /* Spread to mutable working copy (UQ-U-1 P0-3 pattern). */
  const cfg = { ...defaultConfig() };
  const src = (model && model.convergenceHud) || {};

  /* LV3-14 audit fix (Boki 2026-06-26): fold smartDefault directly
     into resolveConfig. Pre-fix: smartDefault was an exported but
     never-invoked function — dead code that mooted the "auto-enable
     for regulator demo GDDs" claim in the block header. Post-fix:
     a GDD with `compliance: [...]` (or an explicit __lv3__ feature)
     auto-flips enabled=true, unless the operator explicitly disables
     it via model.convergenceHud.enabled = false (which still wins). */
  const wantsLv3 = !!(model && (
    (Array.isArray(model.features) && model.features.some(
      (f) => f && (f.kind === '__lv3__' || f === '__lv3__'),
    )) ||
    (Array.isArray(model.compliance) && model.compliance.length > 0)
  ));
  if (wantsLv3 && src.enabled !== false) cfg.enabled = true;

  if (src.enabled === true)  cfg.enabled = true;
  if (src.enabled === false) cfg.enabled = false;
  if (src.debugLog === true) cfg.debugLog = true;

  if (typeof src.position === 'string' && VALID_POSITIONS.has(src.position)) {
    cfg.position = src.position;
  }
  for (const key of Object.keys(BOUNDS)) {
    const v = src[key];
    const b = BOUNDS[key];
    if (typeof v === 'number' && v >= b.min && v <= b.max) {
      cfg[key] = b.integer ? Math.floor(v) : v;
    }
  }
  return cfg;
}

export function emitConvergenceHudCSS(cfgIn) {
  const cfg = cfgIn || defaultConfig();
  if (!cfg.enabled) return '';

  /* Position → CSS edge offsets. */
  const POS = {
    'top-left':     'top: 12px;   left: 12px;',
    'top-right':    'top: 12px;   right: 12px;',
    'bottom-left':  'bottom: 12px; left: 12px;',
    'bottom-right': 'bottom: 12px; right: 12px;',
  }[cfg.position] || 'top: 12px; left: 12px;';

  return `
/* ── convergenceHud BLOCK — emitted by src/blocks/convergenceHud.mjs ── */
.convergence-hud {
  position: fixed;
  ${POS}
  z-index: ${Z.HUD};
  background: rgba(8, 14, 28, 0.92);
  border: 1px solid rgba(120, 200, 255, 0.30);
  border-radius: 8px;
  padding: 10px 14px;
  color: #cdeaff;
  font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  min-width: 200px;
  max-width: 280px;
  pointer-events: none;
  user-select: none;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
}
.convergence-hud[data-state="idle"]  { border-color: rgba(120, 140, 160, 0.30); color: #8aa0b8; }
.convergence-hud[data-state="run"]   { border-color: rgba(120, 200, 255, 0.55); }
.convergence-hud[data-state="ok"]    { border-color: rgba(80, 220, 160, 0.55); }
.convergence-hud[data-state="warn"]  { border-color: rgba(255, 200, 80, 0.55); }
.convergence-hud[data-state="fail"]  { border-color: rgba(255, 100, 100, 0.55); }
.convergence-hud .ch-title {
  display: block;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  font-size: 9px;
  opacity: 0.75;
  margin-bottom: 4px;
}
.convergence-hud .ch-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  white-space: nowrap;
}
.convergence-hud .ch-row > span:last-child { font-weight: 600; }
.convergence-hud .ch-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 9px;
  margin-left: 4px;
  background: rgba(80, 220, 160, 0.18);
  color: #80ddb0;
}
.convergence-hud .ch-badge[data-band="warn"] { background: rgba(255, 200, 80, 0.18); color: #ffcc80; }
.convergence-hud .ch-badge[data-band="fail"] { background: rgba(255, 100, 100, 0.20); color: #ff8080; }
.convergence-hud .ch-state-label {
  font-size: 9px;
  opacity: 0.9;
  padding-left: 4px;
}
.convergence-hud .ch-sr-only {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
`;
}

export function emitConvergenceHudMarkup(cfgIn) {
  const cfg = cfgIn || defaultConfig();
  if (!cfg.enabled) return '';
  /* UQ-LV3-QA-3 #5: `aria-live="off"` on the live-updating panel
     prevents the screen-reader spam (250ms ticks). A separate
     visually-hidden `chAnnounce` span carries the polite announcement
     and is updated ONLY on `onSolverConverged` (or band transitions).
     UQ-LV3-QA-3 #6: state badge carries a TEXT label
     ("RUNNING"/"CONVERGED"/"WARN"/"DIVERGED") so WCAG 1.4.1 use-of-
     color rule is satisfied — color is supplementary, not the only
     channel. */
  return tagBlockMarkup(`
<div class="convergence-hud" data-state="idle" aria-live="off" aria-atomic="true">
  <span class="ch-title">Auto-Converge Solver <span class="ch-state-label" id="chStateLabel">IDLE</span></span>
  <div class="ch-row"><span>iter</span><span id="chIter">—</span></div>
  <div class="ch-row"><span>residual</span><span id="chResid">—</span></div>
  <div class="ch-row"><span>delta</span><span id="chDelta">— bps <span id="chBadge" class="ch-badge" data-band="ok">—</span></span></div>
  <span id="chAnnounce" class="ch-sr-only" aria-live="polite"></span>
</div>
`, 'convergenceHud');
}

export function emitConvergenceHudRuntime(cfgIn) {
  const cfg = cfgIn || defaultConfig();
  if (!cfg.enabled) return `\n  /* ── convergenceHud BLOCK · disabled ── */\n`;

  return `
  /* ── convergenceHud BLOCK — emitted by src/blocks/convergenceHud.mjs ──
     LV3-14 (Boki 2026-06-26) — polls window.__SOLVER_STATE__ every
     ${cfg.pollIntervalMs}ms. Band threshold ±${cfg.toleranceBps} bps. */
  (function convergenceHudInit() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (window.__CONVERGENCE_HUD_INIT__) return;
    window.__CONVERGENCE_HUD_INIT__ = true;

    const POLL_MS = ${cfg.pollIntervalMs};
    const TOL_BPS = ${cfg.toleranceBps};
    const DEBUG = ${cfg.debugLog};

    const root  = document.querySelector('.convergence-hud');
    const elIter  = document.getElementById('chIter');
    const elResid = document.getElementById('chResid');
    const elDelta = document.getElementById('chDelta');
    const elBadge = document.getElementById('chBadge');
    const elStateLabel = document.getElementById('chStateLabel');
    const elAnnounce   = document.getElementById('chAnnounce');
    if (!root || !elIter || !elResid || !elDelta || !elBadge) return;

    /* UQ-LV3-QA-3 #6 — text label paired with the data-state colour
       so WCAG 1.4.1 (use of colour) is satisfied. */
    const STATE_COPY = {
      idle: 'IDLE',
      run:  'RUNNING',
      ok:   'CONVERGED',
      warn: 'WARN',
      fail: 'DIVERGED',
    };
    let lastAnnouncedState = null;
    function setState(name) {
      root.dataset.state = name;
      if (elStateLabel) elStateLabel.textContent = STATE_COPY[name] || name.toUpperCase();
      if (elAnnounce && name !== lastAnnouncedState && (name === 'ok' || name === 'fail')) {
        /* Only announce terminal state transitions — never the
           polling ticks. Avoids SR spam. */
        elAnnounce.textContent = 'Solver ' + (STATE_COPY[name] || name);
        lastAnnouncedState = name;
      }
    }

    function log(msg) {
      if (DEBUG && typeof console !== 'undefined' && console.log) {
        console.log('[convergenceHud]', msg);
      }
    }

    /* UQ-LV3-QA-3 #7: WARN_MULTIPLIER named constant + documented.
       Pre-fix: bare \`TOL_BPS * 10\` was magic. Operator can now read
       the rationale: "amber zone is 10× the OK band". A future GDD
       key (\`warnBpsMultiplier\`) could expose this to regulators that
       want a different ratio; today it's a sane built-in. */
    const WARN_MULTIPLIER = 10;
    function bandFor(deltaBps) {
      const abs = Math.abs(deltaBps);
      if (abs <= TOL_BPS) return 'ok';
      if (abs <= TOL_BPS * WARN_MULTIPLIER) return 'warn';
      return 'fail';
    }

    /* UQ-LV3-QA-3 audit #9: own-property guard against prototype
       pollution. A line like "Object.prototype.converged = true"
       (no backticks here — they break the outer template literal)
       would otherwise spoof the converged state and trip a fake
       onSolverConverged emit. _has returns true only when the key
       is an OWN property. */
    function _has(o, k) {
      return Object.prototype.hasOwnProperty.call(o, k);
    }
    function _ownNum(o, k) {
      if (!_has(o, k)) return null;
      const v = o[k];
      return Number.isFinite(v) ? v : null;
    }

    function render() {
      const st = window.__SOLVER_STATE__;
      if (!st || typeof st !== 'object') {
        setState('idle');
        elIter.textContent = '—';
        elResid.textContent = '—';
        elDelta.textContent = '— bps';
        elBadge.dataset.band = 'ok';
        elBadge.textContent = '—';
        return;
      }
      const iter = _ownNum(st, 'iter');
      const residual = _ownNum(st, 'residual');
      const finalRtp = _ownNum(st, 'finalRtp');
      const targetRtp = _ownNum(st, 'targetRtp');
      const deltaBps = _ownNum(st, 'deltaBps') !== null
        ? _ownNum(st, 'deltaBps')
        : (finalRtp !== null && targetRtp !== null
            ? Math.round((finalRtp - targetRtp) * 10000)
            : null);
      const converged = _has(st, 'converged') && st.converged === true;
      elIter.textContent  = iter === null ? '—' : String(iter);
      elResid.textContent = residual === null ? '—' : residual.toExponential(2);
      /* UQ-LV3-QA-3 #1 + #2: explicit if/else replaces ternary-assign.
         Also guard firstChild access — refactored markup may move the
         text node behind the badge span. */
      const deltaTextNode = elDelta.firstChild;
      if (deltaBps === null) {
        if (deltaTextNode) deltaTextNode.textContent = '— bps ';
        elBadge.dataset.band = 'ok';
        elBadge.textContent = '—';
        setState(converged ? 'ok' : 'run');
      } else {
        const sign = deltaBps > 0 ? '+' : '';
        if (deltaTextNode) deltaTextNode.textContent = sign + deltaBps + ' bps ';
        const band = bandFor(deltaBps);
        elBadge.dataset.band = band;
        elBadge.textContent = band.toUpperCase();
        setState(converged ? (band === 'ok' ? 'ok' : band) : 'run');
        if (converged && typeof window.HookBus !== 'undefined' &&
            typeof window.HookBus.emit === 'function') {
          window.HookBus.emit('onSolverConverged', {
            iter, finalRtp, deltaBps,
          });
        }
      }
      log('render iter=' + iter + ' residual=' + residual + ' delta=' + deltaBps);
    }

    /* UQ-LV3-QA-3 #3 + #4: lifecycle teardown.
       Pre-fix: setInterval leaked across iframe nav / hot-reload, and
       a re-injected runtime would leave the OLD interval ticking against
       stale DOM nodes.
       Post-fix: (1) tear down any pre-existing interval before
       installing the new one, (2) wire \`beforeunload\` to stop the
       loop, (3) subscribe to the HookBus \`onSlotDestroy\` event so a
       managed teardown via the game lifecycle also cleans up. */
    if (typeof window.__CONVERGENCE_HUD_STOP__ === 'function') {
      try { window.__CONVERGENCE_HUD_STOP__(); } catch (_) { /* swallow */ }
    }
    render();
    const handle = setInterval(render, POLL_MS);
    function stop() { clearInterval(handle); }
    window.__CONVERGENCE_HUD_STOP__ = stop;
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('beforeunload', stop, { once: true });
    }
    if (typeof window.HookBus !== 'undefined' &&
        typeof window.HookBus.on === 'function') {
      try { window.HookBus.on('onSlotDestroy', stop); } catch (_) { /* swallow */ }
    }

    log('convergenceHud ready · poll=' + POLL_MS + 'ms');
  })();
`;
}

/* GDD smart-default backfill: convergenceHud auto-enables alongside
   liveRtpHud when the GDD declares any compliance gate (regulator
   demo mode). LV3-14 (Boki 2026-06-26): smart-default is now FOLDED
   into resolveConfig() above — there's no external smartDefaults
   walker that iterates `block.smartDefault()`, so keeping this as a
   separate export was dead code. This wrapper is preserved for two
   reasons: (a) backward-compat if any external tool starts iterating
   block.smartDefault hooks (e.g., src/registry/smartDefaults.mjs
   stage-7 if it ever lands), (b) the smartDefault logic is testable
   in isolation. The single source of truth for "should this block
   auto-enable" is now the wantsLv3 branch inside resolveConfig. */
export function smartDefault(model, current) {
  const declared = current && typeof current === 'object' ? current : {};
  if (declared.enabled === true || declared.enabled === false) return declared;
  const wantsLv3 = !!(model && (
    (Array.isArray(model.features) && model.features.some(
      (f) => f && (f.kind === '__lv3__' || f === '__lv3__'),
    )) ||
    (Array.isArray(model.compliance) && model.compliance.length > 0)
  ));
  if (wantsLv3) {
    return { ...DEFAULTS, ...declared, enabled: true };
  }
  return declared;
}
