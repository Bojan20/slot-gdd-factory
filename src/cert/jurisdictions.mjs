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

  /* ─── Wave HX5 expansion (W48) ─────────────────────────────────── */

  /* Ontario, Canada — AGCO Standards for Internet Gaming (Reg 4.21).
   * Heavy social-responsibility quartet + mandatory self-exclusion path. */
  AGCO: Object.freeze({
    code: 'AGCO',
    name: 'Alcohol & Gaming Commission of Ontario',
    region: 'CA-ON',
    required: Object.freeze([
      'reality_check',
      'session_timeout',
      'net_loss_indicator',
      'win_cap',
      'autoplay',
    ]),
    recommended: Object.freeze([
      'history_log',
    ]),
    anchor: 'AGCO Registrar Standards for Internet Gaming s.4.21',
  }),

  /* Romania — ONJN Order 144/2018 + technical guidelines.
   * Reality check + session timer baseline. */
  ONJN: Object.freeze({
    code: 'ONJN',
    name: 'Oficiul National pentru Jocuri de Noroc (Romania)',
    region: 'RO',
    required: Object.freeze([
      'reality_check',
      'session_timeout',
    ]),
    recommended: Object.freeze([
      'net_loss_indicator',
      'autoplay',
    ]),
    anchor: 'ONJN Order 144/2018 + technical guideline 12/2021',
  }),

  /* Greece — HGC Regulation 17/2021 (Hellenic Gaming Commission).
   * Reality check + session timer + autoplay disclosure baseline. */
  HGC: Object.freeze({
    code: 'HGC',
    name: 'Hellenic Gaming Commission',
    region: 'GR',
    required: Object.freeze([
      'reality_check',
      'session_timeout',
      'autoplay',
    ]),
    recommended: Object.freeze([
      'net_loss_indicator',
      'win_cap',
    ]),
    anchor: 'HGC Regulation 17/2021 — online gambling player protection',
  }),

  /* Czech Republic — Ministry of Finance (Zakon c. 186/2016 Sb.).
   * Standard responsibility set; net loss indicator mandatory. */
  MFCR: Object.freeze({
    code: 'MFCR',
    name: 'Ministerstvo financi CR (Czech Republic)',
    region: 'CZ',
    required: Object.freeze([
      'reality_check',
      'session_timeout',
      'net_loss_indicator',
    ]),
    recommended: Object.freeze([
      'autoplay',
      'win_cap',
    ]),
    anchor: 'Act No. 186/2016 Coll. on Gambling + Decree 18/2017',
  }),

  /* Sweden v2 — SGA tightening (2024-2025) adds mandatory win cap +
   * autoplay disclosure on top of the prior quartet. Kept alongside
   * SGA so legacy submissions to the original framework remain valid. */
  SGA_V2: Object.freeze({
    code: 'SGA_V2',
    name: 'Spelinspektionen v2 (Sweden, 2024+)',
    region: 'SE',
    required: Object.freeze([
      'reality_check',
      'session_timeout',
      'net_loss_indicator',
      'win_cap',
      'autoplay',
    ]),
    recommended: Object.freeze([
      'history_log',
    ]),
    anchor: 'Spelinspektionen Foreskrifter v2 (2024-01) — strengthened controls',
  }),

  /* C-6 LEGO-CERT2 (2026-06-19) — 5 EU jurisdikcija koje već imaju
   * dedicated compliance gate blokove ali nisu bile u cert registry. */
  ADM: Object.freeze({
    code: 'ADM',
    name: 'Agenzia delle Dogane e dei Monopoli (Italy)',
    region: 'IT',
    required: Object.freeze([
      'reality_check',
      'session_timeout',
      'net_loss_indicator',
    ]),
    recommended: Object.freeze([
      'autoplay',
      'win_cap',
    ]),
    anchor: 'ADM Decreto Direttoriale + AAMS/ADM 2024 — periodic notice + loss limits',
  }),
  ANJ: Object.freeze({
    code: 'ANJ',
    name: 'Autorité Nationale des Jeux (France)',
    region: 'FR',
    required: Object.freeze([
      'reality_check',
      'session_timeout',
      'autoplay',         /* France HARD-bans autoplay — autoplay block self-disables */
      'net_loss_indicator',
    ]),
    recommended: Object.freeze([
      'win_cap',
      'history_log',
    ]),
    anchor: 'ANJ Décret 2019-1061 + Loi 2020-105 — RG mandates + autoplay ban',
  }),
  KSA: Object.freeze({
    code: 'KSA',
    name: 'Kansspelautoriteit (Netherlands)',
    region: 'NL',
    required: Object.freeze([
      'reality_check',
      'session_timeout',
      'net_loss_indicator',
      'win_cap',          /* NL Spel-1 strict win cap */
    ]),
    recommended: Object.freeze([
      'autoplay',
      'history_log',
    ]),
    anchor: 'KSA Spel-1 + Wet Kansspelen op Afstand — Cruks gate + cool-off + win cap',
  }),
  GGL: Object.freeze({
    code: 'GGL',
    name: 'Gemeinsame Glücksspielbehörde der Länder (Germany)',
    region: 'DE',
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
    anchor: 'GlüStV 2021 §6h-i + GGL Min-Spin-Pace + DE-month deposit limit',
  }),
  ESBK: Object.freeze({
    code: 'ESBK',
    name: 'Eidgenössische Spielbankenkommission (Switzerland)',
    region: 'CH',
    required: Object.freeze([
      'reality_check',
      'session_timeout',
      'net_loss_indicator',
    ]),
    recommended: Object.freeze([
      'win_cap',
      'autoplay',
      'history_log',
    ]),
    anchor: 'ESBK Geldspielgesetz (BGS) Art. 76 — Sozialkonzept + Session-Daten',
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
