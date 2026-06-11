import { applyGridProfile } from '../registry/gridProfile.mjs';
/**
 * Slot GDD Factory · scatterCelebration BLOCK
 *
 * Plays AFTER all reels have settled with a trigger-count of scatters, and
 * BEFORE the FS_INTRO placard fades in. Composable with every mechanic —
 * pure CSS keyframes scoped to `.cell--scatter-celebrate`, triggered by JS
 * `playScatterCelebration()` returning a Promise.
 *
 * Reference cadence: industry-standard scatter-celebration pace — total ~1500ms
 * = 3 pulse-glow cycles × 500ms each. Brightness pulse + soft gold drop-
 * shadow, NO transform — the scatter glyph stays strictly inside its reel
 * cell, never crossing the frame mask. Non-scatter cells dim to 0.18
 * opacity so the eye locks on the trigger via pure luminance contrast.
 *
 * GDD-driven configuration (consumed from `model.scatterCelebration`):
 *   enabled       boolean                                         (default true)
 *   durationMs    number ms — total celebration duration          (default 1500)
 *   pulseCycles   number — how many brightness cycles to play     (default 3)
 *   pulseCycleMs  number ms — duration of ONE cycle               (default 500)
 *   dimOpacity    number in [0,1] — non-scatter cells dim level   (default 0.18)
 *   glowColor     "r,g,b" string — drop-shadow halo color         (default "255,214,110")
 *   glowPeak      number — brightness peak inside a cycle          (default 1.5)
 *   haloPx        number px — peak-stage drop-shadow blur          (default 8)
 *   haloMidPx     number px — mid-stage drop-shadow blur           (default 5)
 *   haloAlphaPeak number in [0,1] — peak-stage halo alpha          (default 0.85)
 *   haloAlphaMid  number in [0,1] — mid-stage halo alpha           (default 0.50)
 *   midPeakRatio  number in [0,1] — mid-stage brightness curve     (default 0.4)
 *   dimTransitionMs number ms — dim/halo CSS transition duration   (default 220)
 *   celebrateZIndex number — celebrating cell stack level          (default 10)
 *   reducedMotionPeakRatio number in [0,1] — RM brightness ratio   (default 0.6)
 *   reducedMotionHaloPx    number px — RM halo blur                (default 6)
 *   reducedMotionHaloAlpha number in [0,1] — RM halo alpha         (default 0.7)
 *
 * Public API (server-side, ES module):
 *   defaultConfig()                            → safe defaults
 *   resolveConfig(model)                       → merge defaults with GDD override
 *   emitScatterCelebrationCSS(model)           → CSS string (keyframes + classes)
 *   emitScatterCelebrationRuntime(model)       → runtime JS string for orchestrator
 *
 * Runtime contract (after emitted JS executes):
 *   findScatterCellsOnGrid()                   → { host, cells } locator
 *   playScatterCelebration({ durationMs? })    → Promise<void>
 *
 * Runtime dependencies (must exist in enclosing scope):
 *   grid, FREESPINS, RECT_REELS, ROWS
 */

const DEFAULTS = Object.freeze({
  enabled: true,
  durationMs: 1500,
  pulseCycles: 3,
  pulseCycleMs: 500,
  dimOpacity: 0.18,
  glowColor: '255,214,110',
  glowPeak: 1.5,
  haloPx: 8,
  haloMidPx: 5,
  haloAlphaPeak: 0.85,
  haloAlphaMid: 0.50,
  midPeakRatio: 0.4,
  dimTransitionMs: 220,
  celebrateZIndex: 10,
  reducedMotionPeakRatio: 0.6,
  reducedMotionHaloPx: 6,
  reducedMotionHaloAlpha: 0.7,
});

/* Numeric clamp bounds — single source of truth for resolveConfig + tests.
   Each entry: { min, max, integer? }; integer keys are floored after the
   bounds check. Lifted out per senior review (0-magic-numbers rule). */
const BOUNDS = Object.freeze({
  durationMs:             { min: 100, max: 10000, integer: true },
  pulseCycles:            { min: 1,   max: 12,    integer: true },
  pulseCycleMs:           { min: 50,  max: 5000,  integer: true },
  dimOpacity:             { min: 0,   max: 1,     integer: false },
  glowPeak:               { min: 1,   max: 5,     integer: false },
  haloPx:                 { min: 0,   max: 64,    integer: true },
  haloMidPx:              { min: 0,   max: 64,    integer: true },
  haloAlphaPeak:          { min: 0,   max: 1,     integer: false },
  haloAlphaMid:           { min: 0,   max: 1,     integer: false },
  midPeakRatio:           { min: 0,   max: 1,     integer: false },
  dimTransitionMs:        { min: 0,   max: 5000,  integer: true },
  celebrateZIndex:        { min: 0,   max: 1000,  integer: true },
  reducedMotionPeakRatio: { min: 0,   max: 1,     integer: false },
  reducedMotionHaloPx:    { min: 0,   max: 64,    integer: true },
  reducedMotionHaloAlpha: { min: 0,   max: 1,     integer: false },
});

export function defaultConfig() {
  return { ...DEFAULTS };
}

/* Validate "r,g,b" RGB string — 0..255 integers, no alpha. */
function isValidGlow(s) {
  if (typeof s !== 'string') return false;
  const parts = s.split(',').map(p => p.trim());
  if (parts.length !== 3) return false;
  return parts.every(p => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

/* Merge defaults with model.scatterCelebration, accepting only known keys
   with the correct shape — defends against malformed GDD overrides.
   Wave UD: gridProfile contextual override sits between baseline and
   the explicit GDD entry. */
export function resolveConfig(model) {
  const cfg = applyGridProfile('scatterCelebration', defaultConfig(), model);
  const src = (model && model.scatterCelebration) || {};

  if (src.enabled === false) cfg.enabled = false;
  for (const key of Object.keys(BOUNDS)) {
    const v = src[key];
    const b = BOUNDS[key];
    if (typeof v === 'number' && v >= b.min && v <= b.max) {
      cfg[key] = b.integer ? Math.floor(v) : v;
    }
  }
  if (isValidGlow(src.glowColor)) cfg.glowColor = src.glowColor;

  return cfg;
}

/* Emit the CSS block (keyframes + classes). Knobs baked in as literals so
   no runtime style-recalc is needed when the celebration triggers.
   Takes the full GDD model (not the sub-config) so gridProfile context
   overrides survive — passing a raw sub-block strips model.SHAPE.kind. */
export function emitScatterCelebrationCSS(model = {}) {
  const c = resolveConfig(model);
  const peak  = c.glowPeak;
  const mid   = (1 + (peak - 1) * c.midPeakRatio).toFixed(2);
  const rmBri = (1 + (peak - 1) * c.reducedMotionPeakRatio).toFixed(2);
  return `
/* ── scatterCelebration BLOCK — emitted by src/blocks/scatterCelebration.mjs ─
   GDD knobs (baked at build time):
     enabled       = ${c.enabled}
     durationMs    = ${c.durationMs}
     pulseCycles   = ${c.pulseCycles}
     pulseCycleMs  = ${c.pulseCycleMs}
     dimOpacity    = ${c.dimOpacity}
     glowColor     = ${c.glowColor}
     glowPeak      = ${c.glowPeak}
   Reference: industry baseline ~1500ms = 3 × 500ms pulse cycles, brightness + halo only,
   NO transform so the glyph never crosses the reel frame mask. */
.gridHost.is-scatter-celebrating .cell,
.gridHost.is-scatter-celebrating text {
  opacity: ${c.dimOpacity};
  transition: opacity ${c.dimTransitionMs}ms ease;
}
.gridHost.is-scatter-celebrating .cell--scatter-celebrate,
.gridHost.is-scatter-celebrating text.cell--scatter-celebrate {
  opacity: 1 !important;
  animation: scatter-celebrate ${c.pulseCycleMs}ms ease-in-out ${c.pulseCycles};
  transform: none;
  z-index: ${c.celebrateZIndex};
  position: relative;
}
@keyframes scatter-celebrate {
  0%   { filter: brightness(1)        drop-shadow(0 0 0          transparent); }
  40%  { filter: brightness(${peak})  drop-shadow(0 0 ${c.haloPx}px    rgba(${c.glowColor}, ${c.haloAlphaPeak})); }
  70%  { filter: brightness(${mid})   drop-shadow(0 0 ${c.haloMidPx}px rgba(${c.glowColor}, ${c.haloAlphaMid})); }
  100% { filter: brightness(1)        drop-shadow(0 0 0          transparent); }
}
@media (prefers-reduced-motion: reduce) {
  .gridHost.is-scatter-celebrating .cell--scatter-celebrate,
  .gridHost.is-scatter-celebrating text.cell--scatter-celebrate {
    animation: none;
    filter: brightness(${rmBri}) drop-shadow(0 0 ${c.reducedMotionHaloPx}px rgba(${c.glowColor}, ${c.reducedMotionHaloAlpha}));
    transition: filter ${c.dimTransitionMs}ms ease;
  }
}
`;
}

/* Emit the runtime JS as a string. Config knobs baked into the output as
   literals — keeps the browser bundle clean. Takes the full GDD model
   (not the sub-config) so gridProfile context overrides survive. */
export function emitScatterCelebrationRuntime(model = {}) {
  const c = resolveConfig(model);
  /* If GDD disables the block entirely, emit a stub that resolves
     immediately — every caller can still `.then()` without branching. */
  if (!c.enabled) {
    return `
  /* ── scatterCelebration BLOCK (disabled by GDD) ─────────────────────── */
  function findScatterCellsOnGrid() { return { host: grid, cells: [] }; }
  function playScatterCelebration() { return Promise.resolve(); }
`;
  }
  return `
  /* ── scatterCelebration BLOCK — emitted by src/blocks/scatterCelebration.mjs ─
     GDD knobs (baked at build time):
       enabled       = ${c.enabled}
       durationMs    = ${c.durationMs}
       pulseCycles   = ${c.pulseCycles}
       pulseCycleMs  = ${c.pulseCycleMs}
       dimOpacity    = ${c.dimOpacity}
       glowColor     = ${c.glowColor}
       glowPeak      = ${c.glowPeak}

     Contract:
       playScatterCelebration({ durationMs? })  → Promise<void>
       - durationMs:   override total animation duration (default ${c.durationMs}ms)
     Adds .cell--scatter-celebrate to each scatter cell + .is-scatter-celebrating
     to the gridHost (dims everything else). Cleans both up on resolve so a
     follow-up overlay (FS placard) reads on the un-dimmed grid.

     Robustness:
       - empty cell list  → resolves immediately
       - FREESPINS.scatterCelebration === false → resolves immediately
         (runtime override; GDD-level disable already short-circuited at
         build time and emitted a stub instead). */
  function findScatterCellsOnGrid() {
    const trig = (FREESPINS.triggerSymbol || "S").toUpperCase();
    /* grid (= #gridHost) already carries the .gridHost class — the CSS
       rules target .gridHost.is-scatter-celebrating, so we mark the host
       directly. Don't querySelector('.gridHost') here: it looks for a
       DESCENDANT, but grid IS the .gridHost element. */
    const host = grid;
    /* Prefer reel-engine cells (visible-row range only, ignore buffers) so
       we don't celebrate scatters that are technically in the strip but
       above/below the mask. */
    if (typeof RECT_REELS !== 'undefined' && RECT_REELS && RECT_REELS.length > 0) {
      const hits = [];
      for (const reel of RECT_REELS) {
        const vis = reel.visibleRows || ROWS;
        for (let i = 1; i <= vis; i++) {
          const c = reel.cells[i];
          if (c && (c.textContent || "").toUpperCase() === trig) hits.push(c);
        }
      }
      return { host, cells: hits };
    }
    /* Non-reel-engine kinds: scan .cell + <text>. */
    const nodes = grid.querySelectorAll('.cell, text');
    const hits = [];
    nodes.forEach(n => {
      if ((n.textContent || "").toUpperCase() === trig) hits.push(n);
    });
    return { host, cells: hits };
  }

  /* Wave V6 — cancellation token for force-skip support. Each celebration
     run picks up the current token; an onSkipRequested handler bumps the
     counter, which the timer closure tests on fire and the early-resolve
     branch tests too. Defensive against double-fire.

     H5.20 (Boki bug 05.06.2026 "kada rucno stopiram i skipujem winove u
     FS, zabaguje i blokira FS blok"): the skip path used to bump the
     token WITHOUT calling the pending Promise resolver, so an awaiting
     handlePostSpin retrigger chain blocked forever. We now stash the
     resolver in _pendingResolve and the skip handler invokes it. */
  var _SCATTER_CELEBRATION_TOKEN = 0;
  var _scatterCelebrationActive  = false;
  var _scatterPendingResolve     = null;

  function playScatterCelebration(opts) {
    return new Promise(resolve => {
      if (FREESPINS.scatterCelebration === false) { resolve(); return; }
      const { host, cells } = findScatterCellsOnGrid();
      if (!cells || cells.length === 0) { resolve(); return; }
      const durationMs = (opts && opts.durationMs) || ${c.durationMs};
      const myToken = ++_SCATTER_CELEBRATION_TOKEN;
      _scatterCelebrationActive = true;
      _scatterPendingResolve    = resolve;
      host.classList.add('is-scatter-celebrating');
      cells.forEach(c => c.classList.add('cell--scatter-celebrate'));
      /* 2026-06-09 — emit lifecycle event so spinControl can morph
         the SPIN button into a SKIP CTA during the celebration phase.
         Was: spinControl registered for onScatterCelebrationStart but
         scatterCelebration never emitted it → unknown-event warning. */
      try { HookBus.emit('onScatterCelebrationStart', { cellCount: cells.length, durationMs: durationMs }); } catch (_) {}
      /* Safety: don't leak the classes if the page hides/unmounts mid-flight. */
      setTimeout(() => {
        if (myToken !== _SCATTER_CELEBRATION_TOKEN) return; /* cancelled — skip handler already resolved */
        host.classList.remove('is-scatter-celebrating');
        cells.forEach(c => c.classList.remove('cell--scatter-celebrate'));
        _scatterCelebrationActive = false;
        _scatterPendingResolve    = null;
        try { HookBus.emit('onScatterCelebrationEnd', { reason: 'natural' }); } catch (_) {}
        resolve();
      }, durationMs);
    });
  }

  if (typeof window !== 'undefined') {
    window.playScatterCelebration = playScatterCelebration;
    window.findScatterCellsOnGrid = findScatterCellsOnGrid;
  }

  /* HookBus wire-up — fire the scatter celebration when the engine settles
     enough scatters to trigger FS. The FS pipeline awaits the returned
     Promise via the onFsTrigger event below. Without this the animation
     CSS exists but never plays. */
  if (typeof HookBus !== 'undefined') {
    HookBus.on('onFsTrigger', () => {
      try { playScatterCelebration(); } catch (e) { /* defensive */ }
    });

    /* Wave V6 — react to force-skip during the celebration phase. Bump
       the token so any in-flight setTimeout closure bails, strip the
       classes manually, then emit onSkipComplete so forceSkip block
       hides the button + clears the global flag. */
    HookBus.on('onSkipRequested', (payload) => {
      if (!payload || payload.phase !== 'celebration') return;
      if (!_scatterCelebrationActive) return;
      const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      _SCATTER_CELEBRATION_TOKEN++;        /* invalidate in-flight timer */
      _scatterCelebrationActive = false;
      const { host, cells } = findScatterCellsOnGrid();
      if (host) host.classList.remove('is-scatter-celebrating');
      if (cells) cells.forEach(c => c.classList.remove('cell--scatter-celebrate'));
      /* H5.20 — resolve the pending Promise so handlePostSpin's await
       * chain unblocks immediately on skip (was blocking the next FS
       * spin scheduling indefinitely). */
      if (typeof _scatterPendingResolve === 'function') {
        const _r = _scatterPendingResolve;
        _scatterPendingResolve = null;
        _r();
      }
      const duration = Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0);
      try { HookBus.emit('onScatterCelebrationEnd', { reason: 'skipped' }); } catch (_) {}
      HookBus.emit('onSkipComplete', { phase: 'celebration', duration });
    });
  }
`;
}
