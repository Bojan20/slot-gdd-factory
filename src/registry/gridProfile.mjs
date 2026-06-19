/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  src/registry/gridProfile.mjs
 *
 *  Wave UD — Universal Grid-Aware Defaults.
 *
 *  Purpose
 *  ───────
 *    Single source of truth for per-`SHAPE.kind` contextual overrides.
 *    Every block's `resolveConfig(model)` can call
 *      `applyGridProfile(blockName, cfg, model)`
 *    which merges contextual overrides between the global baseline
 *    and any explicit GDD model entry:
 *
 *      effective = defaultConfig()                 ← global industry baseline
 *                ⊕ gridProfile.get(kind, blockName) ← contextual default
 *                ⊕ model[blockKey]                  ← explicit GDD override
 *
 *  Why
 *  ───
 *    Pre-UD, a single global `defaultConfig()` per block did not know
 *    about `SHAPE.kind`. As a result:
 *      • Cluster / wheel / plinko / crash / slingo got payline overlay
 *        defaults that don't apply to their topology.
 *      • Bonus Buy / Ante Bet auto-enabled on shapes where they cannot
 *        meaningfully drive a spin (wheel, crash, plinko).
 *      • Big-win thresholds were uniform across volatility profiles.
 *      • Paytable UI assumed a reel-strip / line-pay roster even when
 *        the topology is segment-based (wheel) or path-based (crash).
 *
 *    `gridProfile` lets each block describe its own per-kind override
 *    without hard-coding `if (SHAPE.kind === 'cluster')` branches
 *    inside the block (which would violate the LEGO rule
 *    `rule_slot_gdd_lego_blocks` — "nikad game-specific code").
 *    Overrides live in one registry that every block can read.
 *
 *  Design contract
 *  ───────────────
 *    • Pure data + a single pure merge function. Zero side effects.
 *    • Vendor-neutral. Never name a specific game / vendor.
 *    • Defensive: unknown kind / block returns `{}` (no override) so
 *      callers degrade to global baseline.
 *    • Deep merge for nested objects (e.g. `{ thresholds: [...] }`);
 *      array values replace whole (no element-wise merge).
 *    • Immutable inputs — function returns a new object; caller's
 *      `cfg` is never mutated in place.
 *
 *  Schema of profile.<kind>.<blockName>
 *  ─────────────────────────────────────
 *    Each block defines its own override shape. Profile entries are
 *    optional. Common patterns:
 *      enabled: boolean       — turn the block off for this kind
 *      <numeric knob>: number  — re-tune cadence / size / threshold
 *      <ladder>: array         — replace whole list (no merge)
 *      <colors>: { ... }       — partial color override (deep merge)
 *
 *  Public API
 *  ──────────
 *    PROFILE                            — read-only registry export
 *    listKinds()                        — every SHAPE.kind we know
 *    listBlocksForKind(kind)            — blocks with override for kind
 *    get(kind, blockName)               — { ...override } or {} on miss
 *    applyGridProfile(blockName, cfg, model) — merged effective config
 *
 *  How to extend
 *  ─────────────
 *    1. Add `<kind>.<blockName>: { ...override }` to the PROFILE map.
 *    2. The block's `resolveConfig(model)` calls
 *       `applyGridProfile('<blockName>', cfg, model)` once at the end.
 *    3. Add a unit test in `tests/registry/gridProfile.test.mjs` that
 *       asserts the override surfaces for that (kind, block).
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Per-kind override registry. Each top-level key is a `SHAPE.kind`;
 * each nested key is the block name (matches the block's filename
 * stem in `src/blocks/`). Values are partial config overrides that
 * deep-merge over the block's `defaultConfig()`.
 *
 * @type {Readonly<Object<string, Object<string, object>>>}
 */
export const PROFILE = Object.freeze({
  /* ── Reel-line topologies — paylines + line-pays apply natively ── */
  rectangular: Object.freeze({
    /* The industry baseline — no per-kind overrides needed; the global
       defaults already target this. Listed explicitly so listKinds()
       enumerates rectangular for parity. */
  }),
  variable_reel: Object.freeze({
    /* Per-column row counts already handled by gridShape; line-pays
       still apply over the longest column. No special overrides. */
  }),
  diamond: Object.freeze({
    /* Diamond uses per-column visible rows; pay-anywhere typically
       wins here so default the pay model away from strict paylines
       without disabling block availability. */
    paylines:        { defaultPayModel: 'pay_anywhere' },
    paylineOverlay:  { enabled: false }, /* no straight lines on a rhombus silhouette */
  }),
  pyramid: Object.freeze({
    paylines:        { defaultPayModel: 'pay_anywhere' },
    paylineOverlay:  { enabled: false },
  }),
  cross: Object.freeze({
    paylineOverlay:  { enabled: false }, /* masked corner cells break visual line continuity */
  }),
  l_shape: Object.freeze({
    paylineOverlay:  { enabled: false },
  }),
  lock_respin: Object.freeze({
    /* Hold-&-Win style — feature-driven; bonusBuy makes sense, ante
       generally doesn't (the trigger condition is rare scatter
       landing, not anteable). */
    anteBet:         { enabled: false },
    anteBetLadder:   { enabled: false }, /* Wave LEGO-BUY — mirror anteBet veto */
  }),

  /* ── Cluster topologies — no paylines, pure cluster-pays ── */
  cluster: Object.freeze({
    paylines:        { enabled: false },
    paylineOverlay:  { enabled: false },
    /* Cluster boards often run hot tumble cascades; bonusBuy is a
       common purchase but ante bet is not (the cluster trigger model
       doesn't use ante). */
    anteBet:         { enabled: false },
    anteBetLadder:   { enabled: false }, /* Wave LEGO-BUY — mirror anteBet veto */
    /* bonusBuyMenu is the multi-tier variant of bonusBuy — same
     * topology decision: clusters CAN host a buy ladder. Allowed. */
  }),
  megaclusters: Object.freeze({
    paylines:        { enabled: false },
    paylineOverlay:  { enabled: false },
    anteBet:         { enabled: false },
    anteBetLadder:   { enabled: false }, /* Wave LEGO-BUY — mirror anteBet veto */
  }),

  /* ── Hex topology — own engine + cluster-style scoring ── */
  hexagonal: Object.freeze({
    paylines:        { enabled: false },
    paylineOverlay:  { enabled: false },
    anteBet:         { enabled: false },
    anteBetLadder:   { enabled: false }, /* Wave LEGO-BUY — mirror anteBet veto */
  }),

  /* ── Growth topologies — variable visible window ── */
  expanding: Object.freeze({
    /* paylines re-evaluated each spin against the grown grid; overlay
       defaults remain on. No special override. */
  }),
  infinity: Object.freeze({
    /* Same as expanding — paylines re-eval per spin. */
  }),

  /* ── SVG kinds — no rectangular cells, no line-pays ── */
  wheel: Object.freeze({
    paylines:        { enabled: false },
    paylineOverlay:  { enabled: false },
    bonusBuy:        { enabled: false }, /* wheels are themselves a bonus/scaler — no buy-into-wheel */
    bonusBuyMenu:    { enabled: false }, /* Wave LEGO-BUY — multi-tier variant mirrors veto */
    anteBet:         { enabled: false },
    anteBetLadder:   { enabled: false },
    scatterCelebration: { enabled: false }, /* wheel landing is its own scatter ceremony */
    paytable:        { showLineMap: false }, /* segments listed instead */
  }),
  radial: Object.freeze({
    paylines:        { enabled: false },
    paylineOverlay:  { enabled: false },
    bonusBuy:        { enabled: false },
    bonusBuyMenu:    { enabled: false }, /* Wave LEGO-BUY — multi-tier variant mirrors veto */
    anteBet:         { enabled: false },
    anteBetLadder:   { enabled: false },
    scatterCelebration: { enabled: false },
    paytable:        { showLineMap: false },
  }),
  crash: Object.freeze({
    paylines:        { enabled: false },
    paylineOverlay:  { enabled: false },
    bonusBuy:        { enabled: false }, /* crash is its own multiplier — no separate buy */
    bonusBuyMenu:    { enabled: false }, /* Wave LEGO-BUY — multi-tier variant mirrors veto */
    anteBet:         { enabled: false },
    anteBetLadder:   { enabled: false },
    scatterCelebration: { enabled: false },
    paytable:        { showLineMap: false, showFeaturesList: false }, /* peak distribution table instead */
  }),
  plinko: Object.freeze({
    paylines:        { enabled: false },
    paylineOverlay:  { enabled: false },
    bonusBuy:        { enabled: false }, /* plinko is its own bucket scaler */
    bonusBuyMenu:    { enabled: false }, /* Wave LEGO-BUY — multi-tier variant mirrors veto */
    anteBet:         { enabled: false },
    anteBetLadder:   { enabled: false },
    scatterCelebration: { enabled: false },
    paytable:        { showLineMap: false }, /* bucket map instead */
  }),
  slingo: Object.freeze({
    paylines:        { enabled: false }, /* slingo uses bingo-style row/col completion */
    paylineOverlay:  { enabled: false },
    anteBet:         { enabled: false },
    anteBetLadder:   { enabled: false }, /* Wave LEGO-BUY — mirror anteBet veto (ladder rungs map to ante-bet RTP rebalance which slingo card-pick model does not use) */
    /* bonusBuy + bonusBuyMenu are OK for slingo — common pattern is "buy extra strips" */
  }),
  dual: Object.freeze({
    /* Twin / colossal — primary grid drives lines; subgrid is a mirror.
       No special override; both halves use rectangular defaults. */
  }),
});

/** @returns {string[]} every kind in the registry, alphabetical */
export function listKinds() {
  return Object.keys(PROFILE).sort();
}

/** @returns {string[]} block names that have an override for the given kind */
export function listBlocksForKind(kind) {
  const entry = PROFILE[kind];
  if (!entry) return [];
  return Object.keys(entry).sort();
}

/**
 * Returns a shallow copy of the override for (kind, blockName), or `{}`
 * when there is no entry. Never returns `undefined` — callers can spread
 * unconditionally.
 *
 * @param {string} kind
 * @param {string} blockName
 * @returns {object}
 */
export function get(kind, blockName) {
  if (!kind || typeof kind !== 'string') return {};
  if (!blockName || typeof blockName !== 'string') return {};
  const entry = PROFILE[kind];
  if (!entry) return {};
  const override = entry[blockName];
  if (!override) return {};
  /* deep clone via JSON round-trip — overrides are plain data */
  try { return JSON.parse(JSON.stringify(override)); }
  catch (_) { return {}; }
}

/**
 * Deep merge two plain objects. Right-hand wins for primitive + array
 * keys; nested objects recurse. Arrays are replaced whole — element-
 * wise merge would create ambiguity for ladder overrides.
 *
 * @param {object} base
 * @param {object} over
 * @returns {object}
 */
function deepMerge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return base;
  const out = (base && typeof base === 'object' && !Array.isArray(base))
    ? { ...base } : {};
  for (const k of Object.keys(over)) {
    const ov = over[k];
    const bv = out[k];
    if (ov && typeof ov === 'object' && !Array.isArray(ov)
        && bv && typeof bv === 'object' && !Array.isArray(bv)) {
      out[k] = deepMerge(bv, ov);
    } else {
      out[k] = ov;
    }
  }
  return out;
}

/**
 * Merge contextual override on top of the supplied baseline config.
 * Caller passes `model` so the resolver can read `model.topology.kind`
 * (or `model.SHAPE.kind` for already-built models). When the GDD
 * declares an explicit override under `model[blockName]`, that wins
 * via the block's normal resolveConfig path AFTER this returns — this
 * helper only fills the middle layer.
 *
 * @template T
 * @param {string} blockName
 * @param {T} cfg
 * @param {object} model
 * @returns {T}
 */
export function applyGridProfile(blockName, cfg, model) {
  if (!cfg || typeof cfg !== 'object') return cfg;
  if (!model || typeof model !== 'object') return cfg;
  const kind = _extractKind(model);
  if (!kind) return cfg;
  const override = get(kind, blockName);
  if (!override || !Object.keys(override).length) return cfg;
  return /** @type {T} */ (deepMerge(cfg, override));
}

/** @param {object} model */
function _extractKind(model) {
  if (model && model.SHAPE && typeof model.SHAPE.kind === 'string') return model.SHAPE.kind;
  if (model && model.topology && typeof model.topology.kind === 'string') return model.topology.kind;
  if (model && model.shapeKind && typeof model.shapeKind === 'string') return model.shapeKind;
  return null;
}
