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
 *
 * W3.2 (2026-06-17) — Pre-W3.1 this block also exposed five motion-overlay
 * knobs (streakAlpha / streakSpacingPx / shadowAlpha / speedLinesAlpha /
 * speedLineSpeedMs) used by the rectangular ::after / ::before overlay.
 * W3.1 migrated that overlay to the shared motionOverlay.mjs block; the
 * five knobs were retained as no-ops for back-compat through one release.
 * The orchestrator's per-surface configOverride in MOTION_OVERLAY_SURFACES
 * (buildSlotHTML.mjs) carries the literal pre-W3.1 vintage values
 * (0.04 / 4 / 0.20 / 0.04 / 150) so the visual identity is unchanged.
 * W3.2 removes the no-op knobs to slim the surface area; future
 * customization happens via model.motionOverlay (the shared block).
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitReelEngineCSS(cfg)  → CSS string
 *
 * Wave Legacy · industry baseline (vendor-neutral). Original block predates the
 * formal Wave Hxx naming + JSDoc kontrakt header pattern (auto-tagged by
 * tools/cortex-block-mega-fix.mjs).
 */

const DEFAULTS = Object.freeze({
  blurPx: 0,
  blurDim: 1,
  blurFadeMs: 80,
});

export function defaultConfig() {
  return Object.freeze({ ...DEFAULTS });
}

function clampNum(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return v;
}

export function resolveConfig(model) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.reelEngine) || {};
  const m = [
    ['blurPx',           0, 20],
    ['blurDim',          0,  1],
    ['blurFadeMs',       0, 1000],
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
   .reelCol             → column mask (overflow:hidden creates the visible window)
   .reelStrip           → translateY-driven inner strip
   .cell.is-blurring    → legacy back-compat (default no-op at blurPx=0)

   W3.1 — Motion overlay migrated to shared motionOverlay.mjs block.
   Pre-W3.1 this file inlined the ::after / ::before streak overlay for
   the rectangular grid; that was duplicate code (motionOverlay shipped
   the same pattern for hex/wheel/crash/plinko/slingo since W54). The
   orchestrator now wires '.reelCol.is-spinning' to the shared block
   with a per-surface configOverride that preserves the pre-W54 knob
   vintage (streakAlpha 0.04 / streakSpacingPx 4 / shadowAlpha 0.20 /
   speedLinesAlpha 0.04 / speedLineSpeedMs 150) so the rect grid's
   visual output is unchanged at the pixel level. */
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
@media (prefers-reduced-motion: reduce) {
  .cell.is-blurring { transition: none; filter: none; }
}
`;
}
