/**
 * Slot GDD Factory · spinTempo BLOCK
 *
 * Reel-spin cadence config — drives the windup → accel → steady → decel →
 * stagger → cushion-bounce timing of every uniform-reel grid. Single
 * SPIN_PROFILE object consumed by the reel engine in both BASE and FS
 * (Boki rule: identical tempo across phases). Exists so GDD authors can
 * re-tune a slot's "feel" without touching reel-engine internals.
 *
 * Industry reference: classic 5-reel cabinet archetype — each reel lands
 * ~1.4s after click, +320ms stagger per reel, full ladder fires in ~2.7s.
 * Vendor-neutral baseline; no proprietary cabinet name is encoded.
 *
 * GDD-driven configuration (consumed from `model.spinTempo`):
 *   windupMs           number ms — pre-spin recoil duration   (default 100)
 *   windupFrames       number — recoil tween frames           (default 6)
 *   windupPx           number px — recoil pull-back distance  (default 38)
 *   accelMs            number ms — ramp-up phase              (default 120)
 *   steadyMs           number ms — full-speed loop            (default 830)
 *   decelMs            number ms — visible slow-down phase    (default 350)
 *   staggerMs          number ms — gap between adjacent reels (default 320)
 *   bouncePx           number px — cushion bounce amplitude   (default 4)
 *   bounceDecay        number — bounce-to-bounce damping      (default 0.42)
 *   bounceCount        number — max bounce iterations         (default 1)
 *   bounceElasticity   number — bounce easing exponent        (default 1.7)
 *   decelEasingSpeed   number — decel curve speed (0..1)      (default 0.11)
 *
 * Presets (set via `preset: "<name>"` in GDD before per-key overrides):
 *   "classic"    cabinet reference (default, all values above)
 *   "fast"       arcade quickplay  (windup 60, steady 600, decel 240, stagger 220)
 *   "slow"       cinematic suspense (windup 140, steady 1100, decel 480, stagger 380)
 *   "s-avp"      DEPRECATED alias for "classic" — vendor identifier retained
 *                for back-compat only; new GDDs SHOULD use "classic".
 *
 * Public API (server-side, ES module):
 *   defaultConfig()              → object — safe defaults (classic preset).
 *                                  Pure, deterministic, no side effects.
 *   resolveConfig(model)         → object — merges defaults with
 *                                  `model.spinTempo` (preset first, then
 *                                  per-key overrides). Pure, no I/O,
 *                                  unknown keys ignored.
 *   emitSpinTempoRuntime(config) → string — runtime JS source declaring
 *                                  `const SPIN_PROFILE = {...}`, ready to
 *                                  concatenate into the bundled player.
 *
 * Lifecycle bus contract:
 *   Consumed only at build time, no runtime HookBus subscription. This
 *   block neither calls `bus.on(...)` nor emits `bus.emit(...)` — it
 *   produces a static `SPIN_PROFILE` literal that the reel engine reads
 *   synchronously on spin start. Future runtime re-tuning (e.g. turbo
 *   toggle) MUST add an explicit `spin:tempo:update` contract here before
 *   wiring any subscriber.
 *
 * Performance budget:
 *   defaultConfig()              ≤ 0.1 ms, single object allocation.
 *   resolveConfig(model)         ≤ 0.5 ms, ≤ 1 shallow-merge allocation.
 *   emitSpinTempoRuntime(config) ≤ 1.0 ms, ≤ 1 string allocation.
 *   DOM mutations per call:      0 — server-side emitter, no DOM access.
 *   Runtime consumer (reel engine): one rAF-driven tween per reel; the
 *   full five-reel ladder must hold the 60 fps frame budget (≤ 16.6 ms).
 *
 * Accessibility (default-on):
 *   This block draws no UI and emits no ARIA roles — config-only module.
 *   `prefers-reduced-motion: reduce` is honored at the consumer (reel
 *   engine) layer: when the media query matches, the consumer MUST scale
 *   all *Ms values by ≤ 0.2 and force `bounceCount = 0`, preserving the
 *   auditable spin outcome while collapsing the cinematic ladder. Authors
 *   SHOULD NOT bake reduced-motion timings into the GDD preset itself —
 *   the toggle is a runtime user preference, not a slot setting.
 */
/* 2026-06-16 (Boki "polako i glupo, nije tako radilo. pogledaj rectangular
   kako radi. sve je sporo gledavo, mutno i dalje"). Numbers retuned to match
   the WoO `SPIN_PROFILE_NORMAL` benchmark (src/timing.ts L42-59):
     accelMs    130   (was 120)   — snappy ramp-up
     steadyMs   720   (was 830)   — short of WoO 1350 for crisper feel
     decelMs    300   (was 350)   — efficient deceleration
     staggerMs  180   (was 320)   — WoO match; reels stop in tight cascade
     windupPx   42    (was 38)    — visible AAA windup pull
     windupFrames 7   (was 6)     — ~115ms snap
     bouncePx   6     (was 4)     — soft cushion landing
     bounceDecay 0.3  (was 0.42)  — subtle secondary
     bounceCount 2    (was 1)     — weighted feel
     bounceElasticity 1.8 (was 1.7) — softer spring
   The old "classic" alias is preserved via the PRESETS map so any GDD that
   explicitly sets `spinTempo.preset: "classic"` continues to receive the
   pre-retune values verbatim — only the unset default changes. */
const DEFAULTS = Object.freeze({
  windupMs: 100, windupFrames: 7, windupPx: 42,
  accelMs: 130, steadyMs: 720, decelMs: 300,
  staggerMs: 180,
  bouncePx: 6, bounceDecay: 0.3, bounceCount: 2, bounceElasticity: 1.8,
  decelEasingSpeed: 0.16,
});

/* Legacy pre-retune values, exposed verbatim via `preset: "classic"` so
   existing GDDs that pinned the old feel are not silently mutated. */
const CLASSIC_LEGACY = Object.freeze({
  windupMs: 100, windupFrames: 6, windupPx: 38,
  accelMs: 120, steadyMs: 830, decelMs: 350,
  staggerMs: 320,
  bouncePx: 4, bounceDecay: 0.42, bounceCount: 1, bounceElasticity: 1.7,
  decelEasingSpeed: 0.11,
});

const PRESETS = Object.freeze({
  /* "classic" = pre-retune legacy timings (kept verbatim for back-compat). */
  'classic': CLASSIC_LEGACY,
  's-avp':   CLASSIC_LEGACY, /* deprecated vendor alias — prefer "classic" */
  /* "woo" = new default tuned to WoO `SPIN_PROFILE_NORMAL` (the shipping
     reference cabinet feel). When `spinTempo` is omitted from a GDD, this
     profile is what authors get out of the box. */
  'woo':   DEFAULTS,
  'fast':  Object.freeze({ ...DEFAULTS, windupMs: 60,  accelMs:  90, steadyMs:  500, decelMs: 240, staggerMs: 120 }),
  'slow':  Object.freeze({ ...DEFAULTS, windupMs: 140, accelMs: 150, steadyMs: 1100, decelMs: 480, staggerMs: 260 }),
});

export function defaultConfig() {
  return { ...DEFAULTS };
}

/* numeric bounds per knob — defends the runtime against absurd values that
   would otherwise hang the spin loop or skip animation entirely. */
const BOUNDS = Object.freeze({
  windupMs:         [0, 1000],
  windupFrames:     [0, 60],
  windupPx:         [0, 200],
  accelMs:          [0, 1500],
  steadyMs:         [50, 5000],
  decelMs:          [0, 2000],
  staggerMs:        [0, 1500],
  bouncePx:         [0, 30],
  bounceDecay:      [0, 1],
  bounceCount:      [0, 6],
  bounceElasticity: [0.5, 4],
  decelEasingSpeed: [0.01, 1],
});

function clampInt(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return Math.floor(v);
}
function clampFloat(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return v;
}

export function resolveConfig(model) {
  const src = (model && model.spinTempo) || {};
  /* preset (if given) becomes the starting point; per-key overrides
     follow. Unknown preset names fall back to "classic". The legacy
     "s-avp" key is accepted as a deprecated alias; a one-shot console
     warning nudges authors toward the neutral name without breaking
     existing GDDs. */
  /* Default preset is now "woo" — when a GDD omits spinTempo entirely it
     receives the WoO-tuned feel. Authors can pin the previous default
     explicitly via `spinTempo.preset: "classic"`. */
  const rawPreset = typeof src.preset === 'string' ? src.preset.toLowerCase() : 'woo';
  if (rawPreset === 's-avp' && typeof console !== 'undefined' && !resolveConfig.__sAvpWarned) {
    resolveConfig.__sAvpWarned = true;
    console.warn('[spinTempo] preset "s-avp" is deprecated; use "classic" instead.');
  }
  const presetName = rawPreset;
  const base = PRESETS[presetName] || DEFAULTS;
  const cfg = { ...base };

  const intKeys   = ['windupMs', 'windupFrames', 'windupPx', 'accelMs', 'steadyMs', 'decelMs', 'staggerMs', 'bounceCount'];
  const floatKeys = ['bouncePx', 'bounceDecay', 'bounceElasticity', 'decelEasingSpeed'];

  for (const k of intKeys) {
    if (k in src) {
      const v = clampInt(src[k], BOUNDS[k][0], BOUNDS[k][1]);
      if (v !== null) cfg[k] = v;
    }
  }
  for (const k of floatKeys) {
    if (k in src) {
      const v = clampFloat(src[k], BOUNDS[k][0], BOUNDS[k][1]);
      if (v !== null) cfg[k] = v;
    }
  }
  return cfg;
}

/* ── projectSpinProfile(kind, profile) ──────────────────────────────────
 * Wave 2 of the senior spin-quality plan: one canonical tempo source,
 * six engines consume.
 *
 * Each engine has its own natural motion axis (translateY, rotate,
 * stroke-dashoffset, gravity step) but shares cadence semantics. This
 * projector takes the canonical SPIN_PROFILE knobs and returns the
 * engine-shaped fields the engine's resolveConfig() previously baked
 * from private DEFAULTS:
 *
 *   rectangular  → already consumes SPIN_PROFILE directly (no projection)
 *   hex          → { spinDurationMs }
 *   wheel        → { spinDurationMs }
 *   crash        → { spinDurationMs }
 *   plinko       → { rowStepMs }
 *   slingo       → { perColumnSpinMs, staggerMs }
 *
 * Author retunes one block (spinTempo preset / per-key overrides) and
 * all six engines respond. Engine-local DEFAULTS shrink to geometry-
 * only (ball px, peg rows, segment count). Anything in milliseconds
 * belongs here.
 *
 * The projector is a PURE function: given the same `profile` it always
 * returns the same engine-shaped record. No globals, no side effects.
 *
 * @param {string} kind           — one of 'rectangular' | 'hex' | 'wheel'
 *                                  | 'crash' | 'plinko' | 'slingo'
 * @param {object} [profile]      — canonical profile (defaults to DEFAULTS)
 * @returns {object}              — engine-shaped fields
 */
export function projectSpinProfile(kind, profile) {
  const p = profile || DEFAULTS;
  const fullCycle = (p.windupMs | 0) + (p.accelMs | 0) + (p.steadyMs | 0) + (p.decelMs | 0);
  switch (String(kind || '').toLowerCase()) {
    case 'rectangular':
    case 'rect':
      /* Rectangular engine consumes SPIN_PROFILE directly — projection
       * is a no-op identity for symmetry with the other engines. */
      return { ...p };
    case 'hex':
      /* Hex strip translates Y like rectangular; total column duration
       * equals one full cycle. Stagger inherits canonical staggerMs. */
      return {
        spinDurationMs: fullCycle,
        staggerMs:      p.staggerMs | 0,
      };
    case 'wheel':
      /* Wheel rotates by N revolutions over the full cycle plus a half-
       * cycle deceleration overshoot. Slightly longer than rectangular
       * to give the rim a satisfying overshoot bounce. */
      return {
        spinDurationMs: fullCycle + ((p.decelMs | 0) >> 1),
      };
    case 'crash':
      /* Crash curves draw across the full cycle (counter ticks per
       * counterTickDivisor frames against the same total). */
      return {
        spinDurationMs: fullCycle,
      };
    case 'plinko':
      /* Plinko ball drops one row per stagger tick (staggerMs is the
       * natural per-row gate — accelMs+decelMs are bundled into the
       * easing curve, not added rows). Bounded to plinko BOUNDS. */
      return {
        rowStepMs: Math.max(40, Math.min(500, p.staggerMs | 0)),
      };
    case 'slingo':
      /* Slingo strips pump down per column; perColumnSpinMs ≈ full
       * cycle, stagger matches canonical (tight cascade, no per-strip
       * private value). */
      return {
        perColumnSpinMs: fullCycle,
        staggerMs:       p.staggerMs | 0,
      };
    default:
      return { ...p };
  }
}

/**
 * Wave 2 orchestrator helper — project the canonical spinTempo profile
 * into every engine sub-config so all six engines retune from one knob.
 *
 * Per-engine fields the GDD already pinned WIN over projection — we
 * only fill in shared cadence fields the author didn't override. Pure:
 * returns a new model object, never mutates the input.
 *
 * Lives next to projectSpinProfile to keep tempo logic in one block
 * (LEGO discipline) and to free orchestrator LOC budget.
 *
 * @param {object} model — parsed GDD model
 * @returns {object} — model with engine sub-configs projection-filled
 */
export function projectSpinTempoIntoEngines(model) {
  if (!model || typeof model !== 'object') return model;
  const profile = resolveConfig(model);
  function fill(src, key, projected) {
    const existing = (src[key] && typeof src[key] === 'object') ? src[key] : {};
    return { ...src, [key]: { ...projected, ...existing } };
  }
  const hex    = projectSpinProfile('hex',    profile);
  const wheel  = projectSpinProfile('wheel',  profile);
  const crash  = projectSpinProfile('crash',  profile);
  const plinko = projectSpinProfile('plinko', profile);
  const slingo = projectSpinProfile('slingo', profile);
  let m = model;
  m = fill(m, 'hexReelEngine',    { spinDurationMs: hex.spinDurationMs, staggerPerColumnMs: hex.staggerMs });
  m = fill(m, 'wheelSpinEngine',  { spinDurationMs: wheel.spinDurationMs });
  m = fill(m, 'crashSpinEngine',  { spinDurationMs: crash.spinDurationMs });
  m = fill(m, 'plinkoSpinEngine', { rowStepMs:      plinko.rowStepMs });
  m = fill(m, 'slingoSpinEngine', { perColumnSpinMs: slingo.perColumnSpinMs, staggerMs: slingo.staggerMs });
  return m;
}

export function emitSpinTempoRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ spinTempo: cfg });
  return `
  /* ── spinTempo BLOCK — emitted by src/blocks/spinTempo.mjs ────────────
     SINGLE profile used in BOTH base game and free spins — Boki rule:
     reel spin + reel stop speed must be identical in BG and FS across
     every grid. No bonus-tempo flip.
     GDD knobs baked at build time. */
  const SPIN_PROFILE = {
    windupMs: ${c.windupMs}, windupFrames: ${c.windupFrames}, windupPx: ${c.windupPx},
    accelMs: ${c.accelMs}, steadyMs: ${c.steadyMs}, decelMs: ${c.decelMs},
    staggerMs: ${c.staggerMs},
    bouncePx: ${c.bouncePx}, bounceDecay: ${c.bounceDecay}, bounceCount: ${c.bounceCount}, bounceElasticity: ${c.bounceElasticity},
    decelEasingSpeed: ${c.decelEasingSpeed},
  };
`;
}
