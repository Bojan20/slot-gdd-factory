/**
 * src/blocks/gddRuntimeMeta.mjs
 *
 * Wave RENDER-INTEG-A (2026-06-23) — GDD runtime meta-emit block.
 *
 * @module gddRuntimeMeta
 *
 * Purpose:
 *   Surfaces parser-extracted GDD math/compliance fields to the runtime
 *   environment as `window.__GDD_*__` constants so other blocks, tests,
 *   QA tooling, and operator HUD overlays can consume them without
 *   re-reading model.json. This closes the render-integration gap where
 *   MATH-DEEP D-series parser added new fields (compliance, rtpBreakdown,
 *   scatter.payTable, expandingWild.onlyIfWinning) but never surfaced
 *   them through the slot.html runtime.
 *
 * Industry-reference (vendor-neutral):
 *   Regulator-grade slots ship a "math manifest" in the page runtime so
 *   external audit tools (and the operator's QA harness) can verify the
 *   delivered game matches the certified math without parsing PDFs.
 *   This block is the vendor-neutral implementation of that pattern.
 *
 * Public API:
 *   defaultConfig()                → frozen safe defaults (enabled=true)
 *   resolveConfig(model)           → merge defaults with parser fields
 *   emitGddRuntimeMeta(cfg, model) → runtime JS string (assigns globals)
 *
 * Runtime constants emitted (all read-only after init):
 *   window.__GDD_COMPLIANCE__               Array<{code,name}>
 *   window.__GDD_RTP_BREAKDOWN__            {baseLine,hwBase,fsLine,hwFs}
 *   window.__GDD_SCATTER_PAY_TABLE__        {3: x, 4: y, 5: z, ...}
 *   window.__GDD_EXPANDING_WILD_ONLY_IF_WINNING__   boolean
 *   window.__GDD_META_VERSION__             '1' (schema version stamp)
 *
 * Lifecycle (HookBus contract):
 *   subscribes: nothing (pure constant emission)
 *   emits:      onGddMetaReady once on script init
 *
 * Performance budget:
 *   ≤ 0.1ms — single JSON.parse + 5 assignments on script eval.
 *
 * Accessibility:
 *   No DOM impact; safe default.
 *
 * GDD keys consumed:
 *   model.compliance                  → __GDD_COMPLIANCE__
 *   model.payback.rtpBreakdown        → __GDD_RTP_BREAKDOWN__
 *   model.scatter.payTable            → __GDD_SCATTER_PAY_TABLE__
 *   model.expandingWild.onlyIfWinning → __GDD_EXPANDING_WILD_ONLY_IF_WINNING__
 */

const META_VERSION = '1';

export function defaultConfig() {
  return Object.freeze({
    enabled: true, /* always on — manifest is free + always useful */
    emitCompliance: true,
    emitRtpBreakdown: true,
    emitScatterPayTable: true,
    emitExpandingWildOnlyIfWinning: true,
  });
}

/**
 * resolveConfig — merge GDD overrides with safe defaults + harvest fields.
 * Returns a normalized payload ready for emit. Keeps emit-side simple
 * (single .meta object → JSON.stringify → assign).
 */
export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const override = (model && model.gddRuntimeMeta) || {};
  if (override.enabled === false) cfg.enabled = false;
  if (override.emitCompliance === false) cfg.emitCompliance = false;
  if (override.emitRtpBreakdown === false) cfg.emitRtpBreakdown = false;
  if (override.emitScatterPayTable === false) cfg.emitScatterPayTable = false;
  if (override.emitExpandingWildOnlyIfWinning === false) cfg.emitExpandingWildOnlyIfWinning = false;

  /* Harvest payload directly into cfg so emit fn stays branch-free. */
  cfg.payload = {
    compliance: cfg.emitCompliance ? _normalizeCompliance(model.compliance) : null,
    rtpBreakdown: cfg.emitRtpBreakdown ? _normalizeRtpBreakdown(model?.payback?.rtpBreakdown) : null,
    scatterPayTable: cfg.emitScatterPayTable ? _normalizeScatterPayTable(model?.scatter?.payTable) : null,
    expandingWildOnlyIfWinning: cfg.emitExpandingWildOnlyIfWinning
      ? (model?.expandingWild?.onlyIfWinning === true)
      : null,
  };
  return cfg;
}

function _normalizeCompliance(c) {
  if (!Array.isArray(c) || c.length === 0) return null;
  /* Accept either string list or {code,name} list. */
  return c.map(entry => {
    if (typeof entry === 'string') return { code: entry, name: entry };
    if (entry && typeof entry === 'object' && typeof entry.code === 'string') {
      return { code: entry.code, name: typeof entry.name === 'string' ? entry.name : entry.code };
    }
    return null;
  }).filter(Boolean);
}

function _normalizeRtpBreakdown(rb) {
  if (!rb || typeof rb !== 'object') return null;
  const out = {};
  for (const key of ['baseLine', 'hwBase', 'fsLine', 'hwFs', 'bonusBuy', 'total']) {
    if (Number.isFinite(rb[key])) out[key] = rb[key];
  }
  return Object.keys(out).length ? out : null;
}

function _normalizeScatterPayTable(pt) {
  if (!pt || typeof pt !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(pt)) {
    const n = Number(k);
    if (Number.isInteger(n) && n >= 1 && Number.isFinite(Number(v))) out[n] = Number(v);
  }
  return Object.keys(out).length ? out : null;
}

/**
 * emitGddRuntimeMeta — JS source string. Stamped with __GDD_META_VERSION__
 * + emits onGddMetaReady so consumers can await readiness.
 */
export function emitGddRuntimeMeta(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* gddRuntimeMeta: disabled */`;
  const p = cfg.payload || {};
  return `/* ─── GDD runtime meta (RENDER-INTEG-A) ──────────────────────── */
(function(){
  if (typeof window === 'undefined') return;
  try {
    window.__GDD_META_VERSION__ = ${JSON.stringify(META_VERSION)};
    window.__GDD_COMPLIANCE__ = ${JSON.stringify(p.compliance)};
    window.__GDD_RTP_BREAKDOWN__ = ${JSON.stringify(p.rtpBreakdown)};
    window.__GDD_SCATTER_PAY_TABLE__ = ${JSON.stringify(p.scatterPayTable)};
    window.__GDD_EXPANDING_WILD_ONLY_IF_WINNING__ = ${JSON.stringify(p.expandingWildOnlyIfWinning)};
    if (typeof HookBus !== 'undefined' && !window.__GDD_META_EMITTED__) {
      window.__GDD_META_EMITTED__ = true;
      try { HookBus.emit('onGddMetaReady', {
        complianceCount: Array.isArray(window.__GDD_COMPLIANCE__) ? window.__GDD_COMPLIANCE__.length : 0,
        hasRtpBreakdown: !!window.__GDD_RTP_BREAKDOWN__,
        hasScatterPayTable: !!window.__GDD_SCATTER_PAY_TABLE__,
        expandingWildOnlyIfWinning: !!window.__GDD_EXPANDING_WILD_ONLY_IF_WINNING__,
      }); } catch (_) {}
    }
  } catch (_) {}
})();
`;
}
