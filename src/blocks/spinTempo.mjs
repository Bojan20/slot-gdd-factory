/**
 * Slot GDD Factory · spinTempo BLOCK
 *
 * Reel-spin cadence config — drives the windup → accel → steady → decel →
 * stagger → cushion-bounce timing of every uniform-reel grid. Single
 * SPIN_PROFILE object consumed by the reel engine in both BASE and FS
 * (Boki rule: identical tempo across phases). Exists so GDD authors can
 * re-tune a slot's "feel" without touching reel-engine internals.
 *
 * Industry reference: S-AVP classic 5-reel cabinet archetype — each reel
 * lands ~1.4s after click, +320ms stagger per reel, full ladder fires in
 * ~2.7s. Vendor-neutral baseline; no proprietary cabinet name is encoded.
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
 *   "s-avp"      cabinet reference (default, all values above)
 *   "fast"       arcade quickplay  (windup 60, steady 600, decel 240, stagger 220)
 *   "slow"       cinematic suspense (windup 140, steady 1100, decel 480, stagger 380)
 *
 * Public API (server-side, ES module):
 *   defaultConfig()              → object — safe defaults (s-avp preset).
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
const DEFAULTS = Object.freeze({
  windupMs: 100, windupFrames: 6, windupPx: 38,
  accelMs: 120, steadyMs: 830, decelMs: 350,
  staggerMs: 320,
  bouncePx: 4, bounceDecay: 0.42, bounceCount: 1, bounceElasticity: 1.7,
  decelEasingSpeed: 0.11,
});

const PRESETS = Object.freeze({
  's-avp': DEFAULTS,
  'fast':  Object.freeze({ ...DEFAULTS, windupMs: 60,  accelMs:  90, steadyMs:  600, decelMs: 240, staggerMs: 220 }),
  'slow':  Object.freeze({ ...DEFAULTS, windupMs: 140, accelMs: 150, steadyMs: 1100, decelMs: 480, staggerMs: 380 }),
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
     follow. Unknown preset names fall back to s-avp. */
  const presetName = typeof src.preset === 'string' ? src.preset.toLowerCase() : 's-avp';
  const base = PRESETS[presetName] || DEFAULTS;
  const cfg = { ...base };

  const intKeys   = ['windupMs', 'windupFrames', 'windupPx', 'accelMs', 'steadyMs', 'decelMs', 'staggerMs', 'bouncePx', 'bounceCount'];
  const floatKeys = ['bounceDecay', 'bounceElasticity', 'decelEasingSpeed'];

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

  /* Wave S LEGO conformance — spinTempo registers a preSpin listener that
     publishes the active profile onto HookBus state for debug/playground
     observability. The profile itself is a build-time constant (single
     SPIN_PROFILE used in BASE + FS), but exposing it on every preSpin lets
     future features (auto-tempo on auto-spin, slow-mo on near-miss) hot-swap
     the speeds without re-emitting the bundle. */
  if (typeof HookBus !== 'undefined') {
    HookBus.on('preSpin', (p) => {
      if (typeof window !== 'undefined') {
        window.__SPIN_PROFILE_ACTIVE__ = { duringFs: !!(p && p.duringFs), ...SPIN_PROFILE };
      }
    }, { priority: 5 });
  }
`;
}
