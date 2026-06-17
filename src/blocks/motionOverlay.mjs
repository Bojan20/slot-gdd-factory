/**
 * src/blocks/motionOverlay.mjs
 *
 * Wave 3 (W48 spin-quality rollout) — Shared ::after / ::before motion-
 * overlay block, consumed by all six reel engines (rectangular, hex,
 * wheel, crash, plinko, slingo).
 *
 * Industry-reference rationale
 * ────────────────────────────
 *   The non-negotiable rule (HARD RULE #4): the cell layer is NEVER
 *   mutated during motion. Motion legibility is delivered ENTIRELY by
 *   sibling pseudo-element overlays on the motion surface (column for
 *   rect/hex/slingo, frame for wheel, curve viewport for crash, peg-
 *   grid for plinko). The glyph stays sharp; the speed cue is in the
 *   overlay.
 *
 *   Three composable layers (any can be enabled/disabled per engine):
 *     1. Top/bottom shadow mask  — sells the "reel cabinet" depth cue
 *     2. Vertical streak texture — subtle white scratches that imply
 *                                  vertical motion (universal cabinet
 *                                  pattern)
 *     3. Scrolling speed-lines   — diagonal tint band that scrolls
 *                                  through the surface
 *
 *   Reduced-motion media query collapses every animation to a static
 *   alpha=0 overlay (WCAG 2.1 Success Criterion 2.3.3 Animation from
 *   Interactions — operator-controllable motion).
 *
 *   Before this block existed, the same ::after/::before pattern was
 *   inlined in `reelEngineCSS.mjs` (rectangular) and re-implemented in
 *   `hexReelEngine.mjs` after Wave 1. SVG engines (wheel/crash/plinko/
 *   slingo) had NO motion overlay at all — their spin felt flat and was
 *   the root cause of Boki's "slow and dumb" feedback on those grids.
 *
 *   This block emits the CSS rules for one selector family at a time
 *   (e.g. `.reelCol.is-spinning`, `.hex-reel-col.is-spinning`, etc.)
 *   so every engine can wire it without inheriting another engine's
 *   selector namespace.
 *
 * Public API
 *   export function defaultConfig(): MotionOverlayConfig
 *   export function resolveConfig(model?: object): MotionOverlayConfig
 *   export function emitMotionOverlayCSS(cfg: MotionOverlayConfig,
 *                                        opts: { surfaceSelector: string,
 *                                                kindKey: string,
 *                                                layers?: object }): string
 *
 * Lifecycle
 *   • CSS-only block — no runtime. Consumed by each engine's CSS emit.
 *   • No HookBus listener (presentation-only layer).
 *
 * Perf budget
 *   • 0 JS per frame. GPU-composited transforms only. Two pseudo-element
 *     layers per spinning surface; no allocations.
 *
 * Accessibility
 *   • Pointer-events: none on overlays (no hit-test interference).
 *   • prefers-reduced-motion: reduce → animations off + opacity 0.
 *   • Overlay z-index 4-5 sits BELOW any 11+ paytable / popup z-index.
 *
 * GDD knobs (under `model.motionOverlay`)
 *   • shadowAlpha       0.0–0.6  (default 0.22) — top/bottom mask alpha
 *   • streakAlpha       0.0–0.5  (default 0.10) — vertical streak alpha
 *   • streakSpacingPx   2–12     (default 6)    — streak gap
 *   • speedLinesAlpha   0.0–0.6  (default 0.06) — speed-line band alpha
 *   • speedLineSpeedMs  100–3000 (default 600)  — scroll cycle ms
 *   • enableShadow      bool     (default true)
 *   • enableStreaks     bool     (default true)
 *   • enableSpeedLines  bool     (default true)
 */

const DEFAULTS = Object.freeze({
  shadowAlpha:        0.22,
  streakAlpha:        0.10,
  streakSpacingPx:    6,
  speedLinesAlpha:    0.06,
  speedLineSpeedMs:   600,
  enableShadow:       true,
  enableStreaks:      true,
  enableSpeedLines:   true,
});

const BOUNDS = Object.freeze({
  shadowAlpha:        [0,    0.6],
  streakAlpha:        [0,    0.5],
  streakSpacingPx:    [2,    12],
  speedLinesAlpha:    [0,    0.6],
  speedLineSpeedMs:   [100,  3000],
});

export function defaultConfig() { return { ...DEFAULTS }; }

function clampFloat(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return v;
}
function clampInt(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return Math.floor(v);
}

export function resolveConfig(model) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.motionOverlay) || {};
  const floatKeys = ['shadowAlpha', 'streakAlpha', 'speedLinesAlpha'];
  const intKeys   = ['streakSpacingPx', 'speedLineSpeedMs'];
  const boolKeys  = ['enableShadow', 'enableStreaks', 'enableSpeedLines'];
  for (const k of floatKeys) {
    if (k in src) {
      const v = clampFloat(src[k], BOUNDS[k][0], BOUNDS[k][1]);
      if (v !== null) cfg[k] = v;
    }
  }
  for (const k of intKeys) {
    if (k in src) {
      const v = clampInt(src[k], BOUNDS[k][0], BOUNDS[k][1]);
      if (v !== null) cfg[k] = v;
    }
  }
  for (const k of boolKeys) {
    if (typeof src[k] === 'boolean') cfg[k] = src[k];
  }
  return cfg;
}

/**
 * Emit the motion-overlay CSS rule set for ONE engine's spinning
 * surface. The caller supplies the selector family + a unique key
 * used to name the @keyframes rules so multiple engines can coexist
 * without animation-name collisions.
 *
 * @param {object} cfg              — resolved config
 * @param {object} opts
 * @param {string} opts.surfaceSelector  — e.g. `.reelCol.is-spinning`,
 *                                         `.hex-reel-col.is-spinning`,
 *                                         `.wheel-frame.is-spinning`
 * @param {string} opts.kindKey          — short id used in animation
 *                                         name (e.g. `rect`, `hex`,
 *                                         `wheel`, `crash`, `plinko`,
 *                                         `slingo`)
 * @param {object} [opts.layers]         — per-call layer override
 *                                         { shadow?, streaks?, speedLines? }
 *                                         Each engine can disable a
 *                                         layer that doesn't fit its
 *                                         topology (e.g. wheel skips
 *                                         vertical streaks).
 * @param {object} [opts.configOverride] — per-surface knob override
 *                                         (W3.1). Each key in the override
 *                                         replaces the resolved cfg's value
 *                                         for THIS emit only — caller cfg
 *                                         remains untouched. Whitelisted to
 *                                         the 5 visual knobs (shadowAlpha /
 *                                         streakAlpha / streakSpacingPx /
 *                                         speedLinesAlpha / speedLineSpeedMs)
 *                                         so a typo can't silently flip an
 *                                         enable-* flag. Out-of-bounds values
 *                                         are dropped via the same clamp
 *                                         resolveConfig uses, keeping the
 *                                         contract single-source-of-truth.
 *                                         Use case: rectangular engine
 *                                         migration (Wave 3.1) needs the
 *                                         pre-W54 reelEngineCSS knob
 *                                         vintage (streakAlpha 0.04 /
 *                                         shadowAlpha 0.20 / speedLinesAlpha
 *                                         0.04 / speedLineSpeedMs 150 /
 *                                         streakSpacingPx 4) so the visual
 *                                         output of the rect grid does NOT
 *                                         change when the inline overlay is
 *                                         dropped from reelEngineCSS.
 * @returns {string} CSS rule block (empty string if every layer disabled)
 */
export function emitMotionOverlayCSS(cfg, opts) {
  const baseCfg = cfg || defaultConfig();
  const o = opts || {};
  const sel = String(o.surfaceSelector || '').trim();
  const key = String(o.kindKey || 'overlay').replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!sel) return '';

  /* W3.1 — Per-surface knob override. Whitelisted to the 5 visual knobs
   * + clamped via the same BOUNDS resolveConfig uses so typos and OOB
   * values can't sneak past. The base cfg is NEVER mutated. */
  const overrideRaw = (o && o.configOverride) || {};
  const c = { ...baseCfg };
  if (typeof overrideRaw === 'object' && overrideRaw !== null) {
    const floatKeys = ['shadowAlpha', 'streakAlpha', 'speedLinesAlpha'];
    const intKeys   = ['streakSpacingPx', 'speedLineSpeedMs'];
    for (const k of floatKeys) {
      if (k in overrideRaw) {
        const v = clampFloat(overrideRaw[k], BOUNDS[k][0], BOUNDS[k][1]);
        if (v !== null) c[k] = v;
      }
    }
    for (const k of intKeys) {
      if (k in overrideRaw) {
        const v = clampInt(overrideRaw[k], BOUNDS[k][0], BOUNDS[k][1]);
        if (v !== null) c[k] = v;
      }
    }
  }

  const layers = o.layers || {};
  const showShadow     = c.enableShadow     && (layers.shadow     !== false);
  const showStreaks    = c.enableStreaks    && (layers.streaks    !== false);
  const showSpeedLines = c.enableSpeedLines && (layers.speedLines !== false);
  if (!showShadow && !showStreaks && !showSpeedLines) return '';

  /* z-index 4 (speed lines, below) + 5 (streaks + shadow, above).
   * Stays under any 11+ overlay (paytable, FS, popups). */
  const streakLayer = showStreaks
    ? `repeating-linear-gradient(
        to bottom,
        transparent 0px,
        rgba(255,255,255,${c.streakAlpha}) 2px,
        transparent ${c.streakSpacingPx}px
      )`
    : null;
  const shadowTop = showShadow
    ? `linear-gradient(to bottom, rgba(0,0,0,${c.shadowAlpha}) 0%, transparent 12%)`
    : null;
  const shadowBot = showShadow
    ? `linear-gradient(to top,    rgba(0,0,0,${c.shadowAlpha}) 0%, transparent 12%)`
    : null;
  const afterBg = [shadowTop, shadowBot, streakLayer].filter(Boolean).join(',\n    ');

  const afterRule = (showShadow || showStreaks) ? `
${sel}::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
  background: ${afterBg};
  opacity: 0;
  animation: motionOverlayIn_${key} 0.25s ease-out forwards;
}` : '';

  const beforeRule = showSpeedLines ? `
${sel}::before {
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
  animation: motionOverlaySpeedLines_${key} ${c.speedLineSpeedMs}ms linear infinite;
}` : '';

  const keyframesIn = (showShadow || showStreaks) ? `
@keyframes motionOverlayIn_${key} {
  0%   { opacity: 0; transform: scaleY(0.98); }
  100% { opacity: 1; transform: scaleY(1); }
}` : '';

  const keyframesSpeed = showSpeedLines ? `
@keyframes motionOverlaySpeedLines_${key} {
  0%   { transform: translateY(-100%); }
  100% { transform: translateY(100%); }
}` : '';

  /* Only nuke layers we actually emitted — if speed-lines disabled
   * there's no ::before to reset (and asserting on it confuses tests). */
  const rmTargets = [];
  if (showShadow || showStreaks) rmTargets.push(`${sel}::after`);
  if (showSpeedLines)            rmTargets.push(`${sel}::before`);
  const reducedMotion = rmTargets.length === 0 ? '' : `
@media (prefers-reduced-motion: reduce) {
  ${rmTargets.join(',\n  ')} { animation: none; opacity: 0; }
}`;

  return `
/* motionOverlay block — surface: ${sel} (key: ${key}) */
${afterRule}${beforeRule}${keyframesIn}${keyframesSpeed}${reducedMotion}
`;
}
