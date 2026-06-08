/**
 * src/cert/jurisdictions.mjs
 *
 * Wave C1 — Jurisdiction Registry (zero-touch cert pipeline foundation).
 *
 * Purpose
 *   Single source of truth for which player-protection / regulatory blocks
 *   a slot MUST ship in order to be eligible for submission in a given
 *   jurisdiction. Each entry binds a jurisdiction code to:
 *     • required feature `kind`s (matched against the parsed GDD model)
 *     • soft-warning kinds (recommended but not blocking)
 *     • regulator anchor citation (template-neutral, vendor-neutral)
 *
 * Public API
 *   listJurisdictions() → string[]                 — sorted code list
 *   getJurisdiction(code) → JurisdictionSpec|null  — null if unknown
 *   getRequiredKinds(code) → string[]              — empty array if unknown
 *   getRecommendedKinds(code) → string[]
 *
 * Industry / regulator anchors (template-neutral synthesis)
 *   • UKGC LCCP 8.3 / RTS 13 — reality check, session limit, autoplay disclosure
 *   • MGA RGF (Malta) — periodic summary + session timer
 *   • DGA SBET (Denmark) — net-loss visibility + session timer
 *   • SGA / Spelinspektionen (Sweden) — full social-responsibility quartet
 *   • NJDGE 13:69O (New Jersey) — reality check + session timer
 *   • DGOJ (Spain) — convergent baseline (reality check + autoplay disclosure)
 *
 * Lifecycle / perf
 *   Pure data + lookup helpers. Zero side-effects, zero DOM, O(1) reads.
 *
 * GDD keys consumed
 *   features[].kind — matched 1:1 against required/recommended sets.
 *
 * Senior-grade contract
 *   • Frozen objects (defensive against mutation by callers).
 *   • All codes upper-case canonicalised; lookup is case-insensitive.
 *   • Adding a jurisdiction is a one-record append — no other module touches.
 */

/**
 * @typedef {Object} JurisdictionSpec
 * @property {string} code            — Canonical upper-case code (e.g. "UKGC").
 * @property {string} name            — Human-readable regulator name.
 * @property {string} region          — ISO-3166-1 alpha-2 or region tag.
 * @property {string[]} required      — Required feature kinds (block on miss).
 * @property {string[]} recommended   — Soft-warn kinds (no block).
 * @property {string} anchor          — Regulator / framework citation.
 */

/** @type {Record<string, JurisdictionSpec>} */
const REGISTRY = Object.freeze({
  UKGC: Object.freeze({
    code: 'UKGC',
    name: 'UK Gambling Commission',
    region: 'GB',
    required: Object.freeze([
      'reality_check',
      'session_timeout',
      'net_loss_indicator',
      'win_cap',
    ]),
    recommended: Object.freeze([
      'autoplay',         // autoplay disclosure / loss-limit gating
      'history_log',      // session history surface
    ]),
    anchor: 'UKGC LCCP 8.3 / RTS 13 — player-protection mandates',
  }),
  MGA: Object.freeze({
    code: 'MGA',
    name: 'Malta Gaming Authority',
    region: 'MT',
    required: Object.freeze([
      'reality_check',
      'session_timeout',
    ]),
    recommended: Object.freeze([
      'net_loss_indicator',
      'win_cap',
      'autoplay',
    ]),
    anchor: 'MGA Responsible Gaming Framework (RGF)',
  }),
  DGA: Object.freeze({
    code: 'DGA',
    name: 'Danish Gambling Authority (Spillemyndigheden)',
    region: 'DK',
    required: Object.freeze([
      'session_timeout',
      'net_loss_indicator',
    ]),
    recommended: Object.freeze([
      'reality_check',
      'win_cap',
    ]),
    anchor: 'DGA SBET online gambling rules',
  }),
  SGA: Object.freeze({
    code: 'SGA',
    name: 'Spelinspektionen (Sweden)',
    region: 'SE',
    required: Object.freeze([
      'reality_check',
      'session_timeout',
      'net_loss_indicator',
      'win_cap',
    ]),
    recommended: Object.freeze([
      'autoplay',
      'history_log',
    ]),
    anchor: 'Spelinspektionen Spellag (2018:1138)',
  }),
  NJDGE: Object.freeze({
    code: 'NJDGE',
    name: 'New Jersey Division of Gaming Enforcement',
    region: 'US-NJ',
    required: Object.freeze([
      'reality_check',
      'session_timeout',
    ]),
    recommended: Object.freeze([
      'net_loss_indicator',
      'history_log',
    ]),
    anchor: 'NJDGE 13:69O Internet Gaming',
  }),
  DGOJ: Object.freeze({
    code: 'DGOJ',
    name: 'Dirección General de Ordenación del Juego (Spain)',
    region: 'ES',
    required: Object.freeze([
      'reality_check',
      'autoplay',
    ]),
    recommended: Object.freeze([
      'session_timeout',
      'net_loss_indicator',
    ]),
    anchor: 'DGOJ Real Decreto 958/2020',
  }),
});

/**
 * Sorted list of supported jurisdiction codes.
 * @returns {string[]}
 */
export function listJurisdictions() {
  return Object.keys(REGISTRY).sort();
}

/**
 * Look up a jurisdiction spec by code (case-insensitive).
 * @param {string} code
 * @returns {JurisdictionSpec|null}
 */
export function getJurisdiction(code) {
  if (typeof code !== 'string' || !code) return null;
  const key = code.toUpperCase();
  return REGISTRY[key] || null;
}

/**
 * Required feature kinds for a jurisdiction — empty array if unknown.
 * @param {string} code
 * @returns {string[]}
 */
export function getRequiredKinds(code) {
  const spec = getJurisdiction(code);
  return spec ? [...spec.required] : [];
}

/**
 * Recommended feature kinds for a jurisdiction — empty array if unknown.
 * @param {string} code
 * @returns {string[]}
 */
export function getRecommendedKinds(code) {
  const spec = getJurisdiction(code);
  return spec ? [...spec.recommended] : [];
}
