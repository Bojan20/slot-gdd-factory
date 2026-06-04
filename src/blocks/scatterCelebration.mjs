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
 *
 * Public API (server-side, ES module):
 *   defaultConfig()                            → safe defaults
 *   resolveConfig(model)                       → merge defaults with GDD override
 *   emitScatterCelebrationCSS(config)          → CSS string (keyframes + classes)
 *   emitScatterCelebrationRuntime(config)      → runtime JS string for orchestrator
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
   with the correct shape — defends against malformed GDD overrides. */
export function resolveConfig(model) {
  const cfg = defaultConfig();
  const src = (model && model.scatterCelebration) || {};

  if (src.enabled === false) cfg.enabled = false;
  if (typeof src.durationMs === 'number' && src.durationMs >= 100 && src.durationMs <= 10000) {
    cfg.durationMs = Math.floor(src.durationMs);
  }
  if (typeof src.pulseCycles === 'number' && src.pulseCycles >= 1 && src.pulseCycles <= 12) {
    cfg.pulseCycles = Math.floor(src.pulseCycles);
  }
  if (typeof src.pulseCycleMs === 'number' && src.pulseCycleMs >= 50 && src.pulseCycleMs <= 5000) {
    cfg.pulseCycleMs = Math.floor(src.pulseCycleMs);
  }
  if (typeof src.dimOpacity === 'number' && src.dimOpacity >= 0 && src.dimOpacity <= 1) {
    cfg.dimOpacity = src.dimOpacity;
  }
  if (isValidGlow(src.glowColor)) cfg.glowColor = src.glowColor;
  if (typeof src.glowPeak === 'number' && src.glowPeak >= 1 && src.glowPeak <= 5) {
    cfg.glowPeak = src.glowPeak;
  }

  return cfg;
}

/* Emit the CSS block (keyframes + classes). Knobs baked in as literals so
   no runtime style-recalc is needed when the celebration triggers. */
export function emitScatterCelebrationCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ scatterCelebration: cfg });
  const peak = c.glowPeak;
  const mid  = (1 + (peak - 1) * 0.4).toFixed(2); /* gentler 70%-stage value */
  const haloPx = 8;
  const haloMidPx = 5;
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
  transition: opacity 220ms ease;
}
.gridHost.is-scatter-celebrating .cell--scatter-celebrate,
.gridHost.is-scatter-celebrating text.cell--scatter-celebrate {
  opacity: 1 !important;
  animation: scatter-celebrate ${c.pulseCycleMs}ms ease-in-out ${c.pulseCycles};
  transform: none;
  z-index: 10;
  position: relative;
}
@keyframes scatter-celebrate {
  0%   { filter: brightness(1)        drop-shadow(0 0 0          transparent); }
  40%  { filter: brightness(${peak})  drop-shadow(0 0 ${haloPx}px    rgba(${c.glowColor}, 0.85)); }
  70%  { filter: brightness(${mid})   drop-shadow(0 0 ${haloMidPx}px rgba(${c.glowColor}, 0.50)); }
  100% { filter: brightness(1)        drop-shadow(0 0 0          transparent); }
}
@media (prefers-reduced-motion: reduce) {
  .gridHost.is-scatter-celebrating .cell--scatter-celebrate,
  .gridHost.is-scatter-celebrating text.cell--scatter-celebrate {
    animation: none;
    filter: brightness(${(1 + (peak - 1) * 0.6).toFixed(2)}) drop-shadow(0 0 6px rgba(${c.glowColor}, 0.7));
    transition: filter 220ms ease;
  }
}
`;
}

/* Emit the runtime JS as a string. Config knobs baked into the output as
   literals — keeps the browser bundle clean. */
export function emitScatterCelebrationRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ scatterCelebration: cfg });
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

  function playScatterCelebration(opts) {
    return new Promise(resolve => {
      if (FREESPINS.scatterCelebration === false) { resolve(); return; }
      const { host, cells } = findScatterCellsOnGrid();
      if (!cells || cells.length === 0) { resolve(); return; }
      const durationMs = (opts && opts.durationMs) || ${c.durationMs};
      host.classList.add('is-scatter-celebrating');
      cells.forEach(c => c.classList.add('cell--scatter-celebrate'));
      /* Safety: don't leak the classes if the page hides/unmounts mid-flight. */
      setTimeout(() => {
        host.classList.remove('is-scatter-celebrating');
        cells.forEach(c => c.classList.remove('cell--scatter-celebrate'));
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
  }
`;
}
