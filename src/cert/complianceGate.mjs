/**
 * src/cert/complianceGate.mjs
 *
 * Wave C1 — Compliance Gate (zero-touch cert pipeline).
 *
 * Purpose
 *   Given a parsed GDD model and a target jurisdiction code, decide whether
 *   the game is eligible for cert submission. Hard-fails (missing required
 *   feature kind) block the gate; soft-warnings surface recommended-but-
 *   missing kinds without blocking.
 *
 * Public API
 *   checkCompliance(model, jurisdiction) → ComplianceReport
 *   checkComplianceMulti(model, codes[])  → Record<code, ComplianceReport>
 *
 * Lifecycle / perf
 *   Pure function over a frozen jurisdiction registry. O(F·K) where F is
 *   GDD feature count and K is required-kind count (both small, typically
 *   < 30 each). Zero I/O, zero DOM.
 *
 * GDD keys consumed
 *   model.name, model.features[].kind
 *
 * Senior-grade contract
 *   • Never throws on a malformed model — returns a structured fail report.
 *   • Unknown jurisdiction → explicit `unknown_jurisdiction` error code.
 *   • Report is plain-JSON serialisable (drops into manifest.compliance).
 *   • Deterministic ordering of missing[] / warnings[] (alpha) so diffs are
 *     stable across runs — critical for evidence-pack reproducibility.
 */

import {
  getJurisdiction,
  getRequiredKinds,
  getRecommendedKinds,
} from './jurisdictions.mjs';

/**
 * @typedef {Object} ComplianceReport
 * @property {boolean} pass             — Hard gate verdict (false ⇒ block submission).
 * @property {string} jurisdiction      — Canonical code echoed back.
 * @property {string} regulator         — Human-readable regulator name.
 * @property {string[]} missing         — Required kinds absent from model.
 * @property {string[]} warnings        — Recommended kinds absent from model.
 * @property {string[]} satisfied       — Required kinds present in model.
 * @property {string} anchor            — Regulator citation.
 * @property {string|null} error        — Error code (e.g. 'unknown_jurisdiction') or null.
 */

/**
 * Collect normalized feature kinds present on a parsed GDD model.
 * Defensive: tolerates missing / mis-typed arrays.
 * @param {object} model
 * @returns {Set<string>}
 */
function collectKinds(model) {
  const set = new Set();
  if (!model || !Array.isArray(model.features)) return set;
  for (const f of model.features) {
    if (f && typeof f.kind === 'string' && f.kind.length > 0) {
      set.add(f.kind);
    }
  }
  return set;
}

/**
 * Build an "unknown jurisdiction" fail report — preserves shape so callers
 * can branch on `error` without separate try/catch.
 * @param {string} code
 * @returns {ComplianceReport}
 */
function unknownJurisdictionReport(code) {
  return {
    pass: false,
    jurisdiction: typeof code === 'string' ? code.toUpperCase() : String(code),
    regulator: 'unknown',
    missing: [],
    warnings: [],
    satisfied: [],
    anchor: '',
    error: 'unknown_jurisdiction',
  };
}

/**
 * Run the compliance gate against a single jurisdiction.
 * @param {object} model           — Parsed GDD (see src/parser.mjs).
 * @param {string} jurisdiction    — Jurisdiction code (case-insensitive).
 * @returns {ComplianceReport}
 */
export function checkCompliance(model, jurisdiction) {
  const spec = getJurisdiction(jurisdiction);
  if (!spec) return unknownJurisdictionReport(jurisdiction);

  const presentKinds = collectKinds(model);
  const required = getRequiredKinds(spec.code);
  const recommended = getRecommendedKinds(spec.code);

  const missing = required
    .filter((k) => !presentKinds.has(k))
    .sort();
  const satisfied = required
    .filter((k) => presentKinds.has(k))
    .sort();
  const warnings = recommended
    .filter((k) => !presentKinds.has(k))
    .sort();

  return {
    pass: missing.length === 0,
    jurisdiction: spec.code,
    regulator: spec.name,
    missing,
    warnings,
    satisfied,
    anchor: spec.anchor,
    error: null,
  };
}

/**
 * Convenience: check against several jurisdictions in one call.
 * Returns a code-keyed map; order of `codes` is preserved logically but
 * map iteration follows insertion order, so callers can `Object.entries`.
 *
 * @param {object} model
 * @param {string[]} codes
 * @returns {Record<string, ComplianceReport>}
 */
export function checkComplianceMulti(model, codes) {
  /** @type {Record<string, ComplianceReport>} */
  const out = {};
  if (!Array.isArray(codes)) return out;
  for (const code of codes) {
    const report = checkCompliance(model, code);
    out[report.jurisdiction] = report;
  }
  return out;
}
