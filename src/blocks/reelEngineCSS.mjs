/**
 * Slot GDD Factory · reelEngineCSS BLOCK
 *
 * Pure CSS layer for the reel-strip engine (rectangular + every uniform
 * column-grid shape). Defines:
 *   .reelCol               — column container (overflow:hidden creates the mask)
 *   .reelCol.is-spinning   — WoO-style motion overlay (streak ::after +
 *                            speed-line ::before). Symbols stay sharp;
 *                            the OVERLAY conveys speed, not a blur on the
 *                            glyph itself. Mirrors WoO `.reelFrame.is-spinning`
 *                            pattern (src/styles.css L759-806).
 *   .reelStrip             — translateY-driven inner strip
 *   .cell.is-blurring      — legacy back-compat hook. Default blurPx=0 means
 *                            the rule is a visual no-op; engine keeps the
 *                            toggle so external blocks (wildReel, etc.) that
 *                            depend on the selector still match.
 *
 * 2026-06-16 (Boki "sve celije dok se reel okrece, u svakom gridu sve ti
 * glupo… polako i glupo, nije tako radilo… sve je sporo gledavo, mutno i
 * dalje"). The old `filter: blur(4.5px) brightness(0.88)` on EVERY cell
 * during spin made glyphs both blurry AND dim — WoO never paints the cell
 * itself; it overlays a vertical motion streak on the reel frame. We mirror
 * that pattern. Defaults shipped 0 so the symbol stays crisp out of the box.
 *
 * Engine runtime (buildReelColumns / onTickAll / startSpinAll) reads these
 * classes by name. CSS-only block — no JS emit.
 *
 * GDD-driven configuration (consumed from `model.reelEngine`):
 *   blurPx               number — legacy cell-level blur               (default 0)
 *   blurDim              number — legacy cell-level brightness (0..1)  (default 1)
 *   blurFadeMs           number ms — transition into / out of blur     (default 80)
 *   streakAlpha          number — motion streak whiteness (0..1)       (default 0.04)
 *   streakSpacingPx      number px — streak stripe spacing              (default 4)
 *   shadowAlpha          number — top/bottom mask shadow alpha (0..1)  (default 0.20)
 *   speedLinesAlpha      number — vertical speed-line tint alpha (0..1)(default 0.04)
 *   speedLineSpeedMs     number ms — speed-line scroll period           (default 150)
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitReelEngineCSS(cfg)  → CSS string
 */

const DEFAULTS = Object.freeze({
  blurPx: 0,
  blurDim: 1,
  blurFadeMs: 80,
  streakAlpha: 0.04,
  streakSpacingPx: 4,
  shadowAlpha: 0.20,
  speedLinesAlpha: 0.04,
  speedLineSpeedMs: 150,
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
    ['blurPx',           0, 20],
    ['blurDim',          0,  1],
    ['blurFadeMs',       0, 1000],
    ['streakAlpha',      0,  1],
    ['streakSpacingPx',  1, 24],
    ['shadowAlpha',      0,  1],
    ['speedLinesAlpha',  0,  1],
    ['speedLineSpeedMs', 30, 2000],
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
     blurPx           = ${c.blurPx}         (default 0 — cells stay sharp)
     blurDim          = ${c.blurDim}        (default 1 — no dim on cells)
     blurFadeMs       = ${c.blurFadeMs}
     streakAlpha      = ${c.streakAlpha}
     streakSpacingPx  = ${c.streakSpacingPx}
     shadowAlpha      = ${c.shadowAlpha}
     speedLinesAlpha  = ${c.speedLinesAlpha}
     speedLineSpeedMs = ${c.speedLineSpeedMs}
   .reelCol             → column mask (overflow:hidden creates the visible window)
   .reelCol.is-spinning → WoO-style motion overlay (sharp glyphs, streak ::after)
   .reelStrip           → translateY-driven inner strip
   .cell.is-blurring    → legacy back-compat (default no-op at blurPx=0) */
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

/* ── WoO-style motion overlay (src/styles.css L759-806 reference) ─────────
   Two pseudo-element layers paint on TOP of the reel column while spinning.
   The glyph stays sharp — the speed cue is in the OVERLAY, not in the cell
   filter. This is the universal cabinet pattern: vertical streak texture +
   subtle top/bottom mask shadow + thin scrolling speed-line tint. */
.reelCol.is-spinning::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
  background:
    linear-gradient(to bottom, rgba(0,0,0,${c.shadowAlpha}) 0%, transparent 12%),
    linear-gradient(to top,    rgba(0,0,0,${c.shadowAlpha}) 0%, transparent 12%),
    repeating-linear-gradient(
      to bottom,
      transparent 0px,
      rgba(255,255,255,${c.streakAlpha}) 2px,
      transparent ${c.streakSpacingPx}px
    );
  opacity: 0;
  animation: reelStreakIn 0.25s ease-out forwards;
}
.reelCol.is-spinning::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 4;
  background: linear-gradient(
    180deg,
    transparent 0%,
    rgba(200,220,255,${c.speedLinesAlpha}) 50%,
    transparent 100%
  );
  animation: reelSpeedLines ${c.speedLineSpeedMs}ms linear infinite;
}
@keyframes reelStreakIn {
  0%   { opacity: 0; transform: scaleY(0.98); }
  100% { opacity: 1; transform: scaleY(1); }
}
@keyframes reelSpeedLines {
  0%   { transform: translateY(-100%); }
  100% { transform: translateY(100%); }
}
@media (prefers-reduced-motion: reduce) {
  .reelCol.is-spinning::after,
  .reelCol.is-spinning::before { animation: none; opacity: 0; }
}

/* Cross / L-shape masked cells — engine still spins them, just hide.
   Wave J2: irregular shapes share the rectangular reel engine; masked
   cells are visual blanks anchored in the reel strip but not part of
   the playable surface. */
.cell.cell--masked,
.cell.cell--masked.is-blurring {
  opacity: 0;
  pointer-events: none;
  filter: none;
}
`;
}
