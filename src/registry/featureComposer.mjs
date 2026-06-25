/**
 * src/registry/featureComposer.mjs
 *
 * UQ-DEEP-AJ · P1A — N-FEATURE COMPOSER (Boki 2026-06-24)
 *
 * Replaces the hardcoded 3-tier (baseLine + fsLine + hwBase+hwFs) composer in
 * `tools/math-backend.mjs::buildExecutorInput`. Real industry slots routinely
 * have 5-10 features (cluster + cascade + multiplier + jackpot + bonusBuy +
 * mysterySymbol + expandingWild + bigSymbol + retrigger + scatterPays). The
 * hardcoded 3-tier composer left non-FS / non-HnW features at zero contribution
 * → RTP under-shoot when the GDD listed declared RTP percentages for those
 * features.
 *
 * This module produces a structured N-feature contribution table from:
 *   1. `model.features[].config.{triggerProbability, sessionExpectedValue}`
 *   2. `declared.<kind>Line` per-feature RTP fragment (e.g. `clusterLine`)
 *   3. Industry-default GAP inference (closes the residual when neither given)
 *
 * Output is consumed by:
 *   - tools/math-backend.mjs buildExecutorInput — folds non-FS/HnW contributions
 *     into base_rtp residual (Rust executor signature is fixed at 2 features).
 *   - tools/math-backend.mjs /converge per-feature breakdown reporting.
 *
 * Schema is versioned: bumping requires updating downstream consumers.
 *
 * Vendor-neutral: no trademarked names emitted.
 */

/* ──────────────────────────────────────────────────────────────────────────
 * Whitelist of recognised feature kinds.
 *
 * Both camelCase (composer-canonical) and snake_case (parser-emitted) are
 * accepted on input; the composer normalises everything to camelCase on output.
 * ────────────────────────────────────────────────────────────────────────── */
export const KNOWN_FEATURE_KINDS = Object.freeze([
  'freeSpins',
  'holdAndWin',
  'cluster',
  'cascade',
  'multiplier',
  'jackpot',
  'bonusBuy',
  'mysterySymbol',
  'expandingWild',
  'bigSymbol',
  'retrigger',
  'scatterPays',
  'anteBet',
  'megaways',
  'wheelBonus',
]);

/* snake_case → camelCase alias map (parser kinds → composer kinds).
 * Unmapped snake_case → camel via auto-coerce below. */
const KIND_ALIAS = Object.freeze({
  free_spins: 'freeSpins',
  hold_and_win: 'holdAndWin',
  cluster_pays: 'cluster',
  cluster: 'cluster',
  cascade: 'cascade',
  tumble: 'cascade',
  multiplier: 'multiplier',
  jackpot: 'jackpot',
  bonus_buy: 'bonusBuy',
  mystery_symbol: 'mysterySymbol',
  expanding_wild: 'expandingWild',
  big_symbol: 'bigSymbol',
  super_symbol: 'bigSymbol',
  retrigger: 'retrigger',
  scatter_pay: 'scatterPays',
  scatter_pays: 'scatterPays',
  ante_bet: 'anteBet',
  ways: 'megaways',
  megaways: 'megaways',
  wheel_bonus: 'wheelBonus',
});

function normalizeKind(rawKind) {
  if (typeof rawKind !== 'string' || rawKind.length === 0) return null;
  if (KIND_ALIAS[rawKind]) return KIND_ALIAS[rawKind];
  /* Auto-coerce remaining snake_case → camelCase. */
  const camel = rawKind.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  return KNOWN_FEATURE_KINDS.includes(camel) ? camel : null;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Industry default trigger probabilities (used when feature exists but no
 * config supplies `triggerProbability`).
 *
 * Calibrated to typical industry-published averages for medium-vol 96% RTP
 * slots: jackpot ~1/1000, cluster ~21% hit-rate (cluster-pays slots are dense),
 * cascade ~31% (typical cascade chain depth ≥1), multiplier ~15% (mult lands
 * on top of base wins), bonusBuy/anteBet = entry mechanics with no
 * standalone trigger probability.
 * ────────────────────────────────────────────────────────────────────────── */
export const DEFAULT_TRIGGER_P = Object.freeze({
  freeSpins:     0.0085,
  holdAndWin:    0.009,
  cluster:       0.21,
  cascade:       0.31,
  multiplier:    0.15,
  jackpot:       0.001,
  bonusBuy:      0.0,
  mysterySymbol: 0.05,
  expandingWild: 0.08,
  bigSymbol:     0.04,
  retrigger:     0.10,
  scatterPays:   0.06,
  anteBet:       0.0,
  megaways:      0.20,
  wheelBonus:    0.005,
});

/* Industry-default per-feature CONTRIBUTION (RTP fraction) when feature
 * exists but neither config nor declared line is supplied. Falls back to
 * closing the cfTarget gap.
 *
 * Note: freeSpins was 0.20 before UQ-DEEP-AE — calibrated down to 0.15 to
 * match industry split for medium-vol 96% RTP slots. */
export const DEFAULT_CONTRIBUTION = Object.freeze({
  freeSpins:     0.15,
  holdAndWin:    0.36,
  cluster:       0.18,
  cascade:       0.12,
  multiplier:    0.08,
  jackpot:       0.01,
  bonusBuy:      0.00,
  mysterySymbol: 0.04,
  expandingWild: 0.05,
  bigSymbol:     0.03,
  retrigger:     0.02,
  scatterPays:   0.06,
  anteBet:       0.00,
  megaways:      0.10,
  wheelBonus:    0.04,
});

/* ──────────────────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────────────────── */

/* Coerce percent-or-fraction to fraction. GDD authors commonly write 41.9
 * meaning 41.9%, so values > 1 are treated as percent. */
function normFrac(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  return v > 1 ? v / 100 : v;
}

function clampBaseRtp(v) {
  if (!Number.isFinite(v)) return 0.30;
  if (v < 0.30) return 0.30;
  /* Ceiling 0.99 — high enough to allow zero-feature slots (e.g. classic
   * 3-reel paying only on lines, base = full RTP target 0.96) but block
   * pathological > 100% inputs. Was 0.95 before — too aggressive. */
  if (v > 0.99) return 0.99;
  return v;
}

/* Lookup convention-equivalent rtpBreakdown key for a given camelCase kind:
 * cluster → clusterLine, freeSpins → fsLine, holdAndWin → hwBase + hwFs sum.
 * Unknown kind → `<kind>Line`. */
function getDeclaredContribution(kind, declared) {
  if (!declared || typeof declared !== 'object') return null;
  if (kind === 'freeSpins') return normFrac(declared.fsLine);
  if (kind === 'holdAndWin') {
    const b = normFrac(declared.hwBase);
    const f = normFrac(declared.hwFs);
    if (b == null && f == null) return null;
    return (b || 0) + (f || 0);
  }
  if (kind === 'baseLine') return normFrac(declared.baseLine);
  /* Generic: `<kind>Line`. Also tolerate `<kind>Rtp`. */
  const direct = declared[`${kind}Line`];
  if (direct != null) return normFrac(direct);
  const altRtp = declared[`${kind}Rtp`];
  if (altRtp != null) return normFrac(altRtp);
  return null;
}

/* Extract config.triggerProbability / config.sessionExpectedValue from the
 * feature entry. Composer supports both `feature.config.X` (canonical) and
 * direct `feature.X` (lenient — parser sometimes emits flat). */
function getFeatureConfig(feature) {
  if (!feature || typeof feature !== 'object') return {};
  const cfg = (feature.config && typeof feature.config === 'object') ? feature.config : feature;
  return {
    triggerProbability: typeof cfg.triggerProbability === 'number' ? cfg.triggerProbability : null,
    sessionExpectedValue: typeof cfg.sessionExpectedValue === 'number' ? cfg.sessionExpectedValue : null,
  };
}

/* Detect features from model.freeSpins / model.holdAndWin top-level too —
 * many parsers emit those as sibling keys rather than entries in
 * model.features[]. Composer normalises to a single deduped kind set. */
function collectKinds(model) {
  const out = new Set();
  if (model && Array.isArray(model.features)) {
    for (const f of model.features) {
      const k = normalizeKind(f && f.kind);
      if (k) out.add(k);
    }
  }
  if (model && model.freeSpins && (model.freeSpins.enabled === true
    || typeof model.freeSpins.triggerProbability === 'number'
    || typeof model.freeSpins.sessionExpectedValue === 'number')) {
    out.add('freeSpins');
  }
  if (model && model.holdAndWin && (model.holdAndWin.enabled === true
    || typeof model.holdAndWin.triggerCount === 'number'
    || typeof model.holdAndWin.triggerProbability === 'number'
    || typeof model.holdAndWin.sessionExpectedValue === 'number')) {
    out.add('holdAndWin');
  }
  return out;
}

/* For freeSpins / holdAndWin the top-level model.freeSpins / model.holdAndWin
 * config takes precedence over model.features[].config (legacy back-compat). */
function getKindConfig(model, kind) {
  if (kind === 'freeSpins' && model && model.freeSpins) {
    return {
      triggerProbability: typeof model.freeSpins.triggerProbability === 'number' ? model.freeSpins.triggerProbability : null,
      sessionExpectedValue: typeof model.freeSpins.sessionExpectedValue === 'number' ? model.freeSpins.sessionExpectedValue : null,
    };
  }
  if (kind === 'holdAndWin' && model && model.holdAndWin) {
    return {
      triggerProbability: typeof model.holdAndWin.triggerProbability === 'number' ? model.holdAndWin.triggerProbability : null,
      sessionExpectedValue: typeof model.holdAndWin.sessionExpectedValue === 'number' ? model.holdAndWin.sessionExpectedValue : null,
    };
  }
  if (model && Array.isArray(model.features)) {
    for (const f of model.features) {
      if (normalizeKind(f && f.kind) === kind) return getFeatureConfig(f);
    }
  }
  return { triggerProbability: null, sessionExpectedValue: null };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Default config (frozen, schemaVersion stamp)
 * ────────────────────────────────────────────────────────────────────────── */
export function defaultConfig() {
  return Object.freeze({
    schemaVersion: '1',
    knownKinds: KNOWN_FEATURE_KINDS,
    defaultTriggerP: DEFAULT_TRIGGER_P,
    defaultContribution: DEFAULT_CONTRIBUTION,
    baseRtpFloor: 0.30,
    /* UQ-U-7 atom #4 (Boki 2026-06-25 audit #2 P1 VERIFIED): was 0.95
       but clampBaseRtp uses 0.99 internally (raised so classic line slots
       with zero features pass the gate). The defaultConfig export was
       stale, causing downstream consumers reading cfg for tolerance
       checks to reject base values in (0.95, 0.99] as "out of range"
       while composer happily returned them. Now sync to clamp ceiling. */
    baseRtpCeiling: 0.99,
  });
}

/* ──────────────────────────────────────────────────────────────────────────
 * Composer
 *
 * Inputs:
 *   model    — parser slot model { features?, freeSpins?, holdAndWin?, topology? }
 *   declared — rtpBreakdown { baseLine?, fsLine?, hwBase?, hwFs?, <kind>Line? }
 *   options  — { cfTargetRtp: number, hitFreqHint?: number }
 *
 * Output:
 *   {
 *     schemaVersion: '1',
 *     features: [{ kind, triggerProbability, sessionExpectedValue,
 *                  contribution, source }],
 *     baseRtp: number,
 *     totalRtp: number,
 *     gapInferenceUsed: boolean,
 *   }
 *
 * Algorithm:
 *   1. Detect ALL features from model (whitelist; skip unknowns).
 *   2. For each detected feature, derive (triggerP, sessionE, contribution)
 *      with precedence: config > declared line > industry default.
 *   3. baseRtp = cfTargetRtp - sum(featureContributions) (residual; respects
 *      declared.baseLine when present). Clamped [0.30, 0.95].
 *   4. gapInferenceUsed = true if ≥1 feature contribution came from pure
 *      industry-default fallback (no config, no declared).
 * ────────────────────────────────────────────────────────────────────────── */
export function composeFeatureContributions(model, declared, options) {
  const cfTargetRtp = (options && typeof options.cfTargetRtp === 'number' && options.cfTargetRtp > 0)
    ? options.cfTargetRtp
    : 0.96;
  const declaredObj = (declared && typeof declared === 'object') ? declared : {};
  const detected = collectKinds(model);
  const declaredBase = normFrac(declaredObj.baseLine);

  const features = [];
  let gapInferenceUsed = false;

  /* Stable iteration order: KNOWN_FEATURE_KINDS canonical list. */
  for (const kind of KNOWN_FEATURE_KINDS) {
    if (!detected.has(kind)) continue;
    const cfg = getKindConfig(model, kind);
    const declaredContrib = getDeclaredContribution(kind, declaredObj);
    const defaultTrigP = DEFAULT_TRIGGER_P[kind];
    const defaultContrib = DEFAULT_CONTRIBUTION[kind];

    let triggerP = null;
    let sessionE = null;
    let contribution = null;
    let source = null;

    if (cfg.triggerProbability != null && cfg.sessionExpectedValue != null) {
      /* Source 1 — full config: use directly. */
      triggerP = cfg.triggerProbability;
      sessionE = cfg.sessionExpectedValue;
      contribution = triggerP * sessionE;
      source = 'config';
    } else if (declaredContrib != null) {
      /* Source 2 — declared line: derive sessionE from contribution / trigP.
       * trigP comes from config if partial-supplied, else industry default. */
      triggerP = (cfg.triggerProbability != null) ? cfg.triggerProbability : defaultTrigP;
      contribution = declaredContrib;
      sessionE = (triggerP > 0) ? contribution / triggerP : 0;
      source = 'declared';
    } else {
      /* Source 3 — pure GAP / industry default. */
      triggerP = (cfg.triggerProbability != null) ? cfg.triggerProbability : defaultTrigP;
      contribution = defaultContrib;
      sessionE = (triggerP > 0) ? contribution / triggerP : 0;
      source = 'default';
      gapInferenceUsed = true;
    }

    features.push({
      kind,
      triggerProbability: triggerP,
      sessionExpectedValue: sessionE,
      contribution,
      source,
    });
  }

  const featureContribSum = features.reduce((s, f) => s + (f.contribution || 0), 0);

  /* baseRtp policy:
   *   - declared.baseLine present → use it directly (operator-authoritative).
   *     totalRtp will be derived from base + features.
   *   - else → residual = cfTargetRtp - sum(features), clamped [0.30, 0.95]. */
  let baseRtp;
  let totalRtp;
  if (declaredBase != null) {
    baseRtp = declaredBase;
    totalRtp = baseRtp + featureContribSum;
  } else {
    const residual = cfTargetRtp - featureContribSum;
    baseRtp = clampBaseRtp(residual);
    /* If clamp engaged we must recompute totalRtp from clamped base. */
    totalRtp = baseRtp + featureContribSum;
  }

  return {
    schemaVersion: '1',
    features,
    baseRtp,
    totalRtp,
    gapInferenceUsed,
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Convenience: extract the legacy Rust executor inputs (fs_trigger_p,
 * fs_session_e, hnw_trigger_p, hnw_session_e, base_rtp_per_spin) from a
 * composer result. Used by `tools/math-backend.mjs` to preserve the existing
 * /spin and /batch executor wire format unchanged.
 *
 * All non-fs / non-hnw feature contributions are FOLDED into base_rtp as a
 * residual: `base_rtp = cfTarget - fsContrib - hnwContrib - otherSum`.
 * Clamped [0.05, 0.95] for executor sanity (lower than composer floor because
 * declared.baseLine can legitimately be quite low for hnw-dominated slots).
 * ────────────────────────────────────────────────────────────────────────── */
export function toExecutorInputs(composerResult, options) {
  const cfTargetRtp = (options && typeof options.cfTargetRtp === 'number' && options.cfTargetRtp > 0)
    ? options.cfTargetRtp
    : 0.96;
  const out = {
    fsTriggerProbability: 0,
    fsSessionExpectedValue: 0,
    hnwTriggerProbability: 0,
    hnwSessionExpectedValue: 0,
    baseRtp: cfTargetRtp,
    otherContributionSum: 0,
  };
  let fsContrib = 0;
  let hnwContrib = 0;
  let otherSum = 0;
  for (const f of (composerResult && composerResult.features) || []) {
    if (f.kind === 'freeSpins') {
      out.fsTriggerProbability = f.triggerProbability;
      out.fsSessionExpectedValue = f.sessionExpectedValue;
      fsContrib = f.contribution || 0;
    } else if (f.kind === 'holdAndWin') {
      out.hnwTriggerProbability = f.triggerProbability;
      out.hnwSessionExpectedValue = f.sessionExpectedValue;
      hnwContrib = f.contribution || 0;
    } else {
      otherSum += f.contribution || 0;
    }
  }
  out.otherContributionSum = otherSum;
  /* base = cfTarget - fs - hnw - other (other folded into base for legacy
   * Rust executor that only knows 2 features). */
  const residual = cfTargetRtp - fsContrib - hnwContrib - otherSum;
  out.baseRtp = (residual >= 0.05 && residual <= 0.95) ? residual
    : (residual < 0.05 ? 0.05 : 0.95);
  return out;
}
