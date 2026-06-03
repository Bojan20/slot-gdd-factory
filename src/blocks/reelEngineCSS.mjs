/**
 * Slot GDD Factory · reelEngineCSS BLOCK
 *
 * Pure CSS layer for the reel-strip engine (rectangular + every uniform
 * column-grid shape). Defines:
 *   .reelCol      — column container (overflow:hidden creates the mask)
 *   .reelStrip    — translateY-driven inner strip
 *   .cell.is-blurring — motion-blur applied while a cell is spinning
 *
 * Engine runtime (buildReelColumns / onTickAll / startSpinAll) reads these
 * classes by name. CSS-only block — no JS emit.
 *
 * GDD-driven configuration (consumed from `model.reelEngine`):
 *   blurPx      number — motion-blur strength while spinning   (default 4.5)
 *   blurDim     number — brightness while blurring (0..1)      (default 0.88)
 *   blurFadeMs  number ms — transition into / out of blur      (default 80)
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitReelEngineCSS(cfg)  → CSS string
 */

const DEFAULTS = Object.freeze({
  blurPx: 4.5,
  blurDim: 0.88,
  blurFadeMs: 80,
});

export function defaultConfig() {
  return { ...DEFAULTS };
}

function clampNum(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return v;
}

export function resolveConfig(model) {
  const cfg = defaultConfig();
  const src = (model && model.reelEngine) || {};
  const m = [
    ['blurPx',     0, 20],
    ['blurDim',    0,  1],
    ['blurFadeMs', 0, 1000],
  ];
  for (const [k, lo, hi] of m) {
    if (k in src) {
      const v = clampNum(src[k], lo, hi);
      if (v !== null) cfg[k] = v;
    }
  }
  return cfg;
}

export function emitReelEngineCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ reelEngine: cfg });
  return `
/* ── reelEngineCSS BLOCK — emitted by src/blocks/reelEngineCSS.mjs ────────
   GDD knobs baked at build time:
     blurPx     = ${c.blurPx}
     blurDim    = ${c.blurDim}
     blurFadeMs = ${c.blurFadeMs}
   .reelCol      → column mask (overflow:hidden creates the visible window)
   .reelStrip    → translateY-driven inner strip
   .cell.is-blurring → motion blur while a cell is mid-spin */
.reelCol {
  position: relative;
  overflow: hidden;
  border-radius: var(--cell-radius);
  background: transparent;
}
.reelStrip {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--cell-gap);
  will-change: transform;
}
.cell.is-blurring {
  filter: blur(${c.blurPx}px) brightness(${c.blurDim});
  transition: filter ${c.blurFadeMs}ms linear;
}
`;
}
