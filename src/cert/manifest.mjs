/**
 * src/cert/manifest.mjs
 *
 * Wave C1 — op-package manifest builder (zero-touch cert pipeline).
 *
 * Purpose
 *   Translate a parsed GDD model + build metadata into a deterministic,
 *   regulator-friendly manifest.json that becomes the root of the
 *   submission bundle.
 *
 *   Math claims (RTP / volatility / max-win) are PASSED THROUGH from
 *   `mathClaim` arg if supplied — they are NOT derived here. The math
 *   PAR layer is OFF-TOPIC per Boki's standing rule and lands later.
 *
 * Public API
 *   buildManifest({ model, jurisdiction, version, build, mathClaim }) → ManifestObject
 *   slugifyGameId(name) → string                 — deterministic id stem
 *   manifestToJSON(manifest) → string            — canonical pretty JSON
 *
 * Lifecycle / perf
 *   Pure transform. No I/O, no DOM. Output is stable across runs given
 *   identical inputs (sorted arrays, fixed key order in JSON serialisation).
 *
 * GDD keys consumed
 *   model.name, model.topology.{reels,rows,paylines},
 *   model.features[].kind/label, model.theme.tags
 *
 * Senior-grade contract
 *   • Schema version field — bump on breaking change, never silently mutate.
 *   • All collections deterministically sorted before emission.
 *   • `built_at` is provided by caller (test-friendly); falls back to ISO now.
 *   • No vendor/title leakage — only neutral, model-derived fields.
 */

import { checkCompliance } from './complianceGate.mjs';

/* UQ-DEEP-AP G-5 bump: schema_version 1.1.0 — added `stages` array +
   `lifecycle_pairs` for IGT-style stage gating contract (Auditor G #5). */
const MANIFEST_SCHEMA_VERSION = '1.1.0';

/**
 * @typedef {Object} BuildMeta
 * @property {string} [version]   — Semver of the game build (default '0.0.0').
 * @property {string} [build]     — Build identifier / commit hash.
 * @property {string} [built_at]  — ISO-8601 timestamp (caller-controlled for tests).
 */

/**
 * @typedef {Object} MathClaim
 * @property {number} [rtp]              — Theoretical RTP % (e.g. 96.10).
 * @property {string} [volatility]       — 'low' | 'medium' | 'high' | 'very-high'.
 * @property {number} [max_win_x]        — Multiple of bet (cap).
 * @property {number} [hit_frequency]    — Per-spin hit probability (0..1).
 * @property {string} [par_sheet_hash]   — Hash of authoritative PAR sheet (math layer).
 */

/**
 * @typedef {Object} ManifestObject
 * @property {string} schema_version
 * @property {string} game_id
 * @property {string} display_name
 * @property {string} version
 * @property {string|null} build
 * @property {string} built_at
 * @property {object} topology
 * @property {string[]} theme_tags
 * @property {Array<{kind:string,label:string}>} features
 * @property {object|null} math_claim
 * @property {object} compliance
 */

/**
 * Derive a deterministic, URL-/filesystem-safe id from a display name.
 * @param {string} name
 * @returns {string}
 */
export function slugifyGameId(name) {
  if (typeof name !== 'string' || !name.trim()) return 'untitled-game';
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')   // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'untitled-game';
}

/**
 * UQ-DEEP-AR I-7 / F-6 (Auditor F #6 — slug collision SHA-prefix assert):
 * `slugifyGameId('Crystal-Forge')` and `slugifyGameId('Crystal Forge')`
 * both yield `crystal-forge`. Today's curated corpus has no exploited
 * collision, but tomorrow's drop could. This helper maintains a name→slug
 * map and throws when 2 DIFFERENT source names normalize to the SAME slug.
 *
 * Usage:
 *   const tracker = createSlugCollisionTracker();
 *   tracker.track('Crystal-Forge');   // returns 'crystal-forge'
 *   tracker.track('Crystal Forge');   // THROWS — collision
 *
 * Opt-in: not wired into pipeline by default (would break legacy back-compat
 * where parser deliberately re-uses display name variants). Surface it from
 * tools/ingest.mjs --strict in a follow-up.
 *
 * @returns {{track:(name:string)=>string, snapshot:()=>Record<string,string>}}
 */
export function createSlugCollisionTracker() {
  const slugByName = Object.create(null);
  const nameBySlug = Object.create(null);
  return {
    track(name) {
      const slug = slugifyGameId(name);
      if (slugByName[name] === slug) return slug; // idempotent re-track
      const incumbent = nameBySlug[slug];
      if (incumbent && incumbent !== name) {
        throw new Error(
          'slug collision: "' + name + '" and "' + incumbent + '" both → "' + slug + '" — ' +
          'distinct GDDs must produce distinct slugs (cert manifest unique-key contract)'
        );
      }
      slugByName[name] = slug;
      nameBySlug[slug] = name;
      return slug;
    },
    snapshot() {
      return { ...slugByName };
    },
  };
}

/**
 * Defensively read the topology block off the parsed model.
 * @param {object} model
 * @returns {{reels:number|null,rows:number|null,paylines:number|null}}
 */
function readTopology(model) {
  const t = model && model.topology ? model.topology : {};
  return {
    reels: Number.isFinite(t.reels) ? t.reels : null,
    rows: Number.isFinite(t.rows) ? t.rows : null,
    paylines: Number.isFinite(t.paylines) ? t.paylines : null,
  };
}

/**
 * Defensively read theme tags, dedupe + sort for stability.
 * @param {object} model
 * @returns {string[]}
 */
function readThemeTags(model) {
  const tags = model && model.theme && Array.isArray(model.theme.tags)
    ? model.theme.tags
    : [];
  return [...new Set(tags.filter((t) => typeof t === 'string' && t.trim()))].sort();
}

/**
 * Defensively read features, sort by kind for stable diffs.
 * @param {object} model
 * @returns {Array<{kind:string,label:string}>}
 */
function readFeatures(model) {
  const features = model && Array.isArray(model.features) ? model.features : [];
  return features
    .filter((f) => f && typeof f.kind === 'string' && f.kind.length > 0)
    .map((f) => ({
      kind: f.kind,
      label: typeof f.label === 'string' && f.label.length ? f.label : f.kind,
    }))
    .sort((a, b) => a.kind.localeCompare(b.kind));
}

/**
 * UQ-DEEP-AP G-5 (Auditor G — IGT layout residual adoption):
 * Derive canonical lifecycle stages from the model so manifest carries
 * `stages` array (post-AO-6 stage gating contract). Stages reflect what
 * the runtime visibility walker will reveal/hide. Stable sorted for
 * diff-friendly cert.
 */
function readStages(model) {
  const stages = new Set(['boot', 'base']);
  const fs = model && Array.isArray(model.features) ? model.features : [];
  for (const f of fs) {
    const k = f && typeof f.kind === 'string' ? f.kind.toLowerCase() : '';
    if (k.includes('freespin') || k === 'fs') stages.add('freeSpins');
    if (k.includes('holdandwin') || k.includes('hold_and_win')) stages.add('holdAndWin');
    if (k.includes('bonusbuy') || k.includes('bonus_buy')) stages.add('bonusBuy');
    if (k.includes('gamble')) stages.add('gamble');
    if (k.includes('wheel')) stages.add('wheel');
    if (k.includes('jackpot')) stages.add('jackpot');
    if (k.includes('respin')) stages.add('respin');
    if (k.includes('cluster')) stages.add('cluster');
    if (k.includes('cascade') || k.includes('tumble')) stages.add('cascade');
  }
  return [...stages].sort();
}

/**
 * UQ-DEEP-AP G-5 + G-10: emit symmetric lifecycle pairs the runtime
 * promises (setup → destroy). Cert reader can verify each setup hook
 * has a paired destroy hook, catching memory-leak regressions.
 */
function readLifecyclePairs(model) {
  /* Static canonical pair set; runtime HookBus emits onBlockSetup +
     onBlockDestroy per block. Stages can override the default set when
     model declares custom stages in the future. */
  const stages = readStages(model);
  return stages.map((s) => ({
    stage: s,
    setup: 'onBlockSetup',
    destroy: 'onBlockDestroy',
  }));
}

/**
 * Build the op-package manifest object.
 * Does NOT serialise — caller decides JSON / file shape.
 *
 * @param {{
 *   model: object,
 *   jurisdiction: string,
 *   version?: string,
 *   build?: string,
 *   built_at?: string,
 *   mathClaim?: MathClaim|null,
 * }} args
 * @returns {ManifestObject}
 */
export function buildManifest(args) {
  if (!args || typeof args !== 'object') {
    throw new TypeError('buildManifest: args object is required');
  }
  const { model, jurisdiction } = args;
  if (!model || typeof model !== 'object') {
    throw new TypeError('buildManifest: args.model must be a parsed GDD object');
  }
  if (typeof jurisdiction !== 'string' || !jurisdiction.trim()) {
    throw new TypeError('buildManifest: args.jurisdiction is required');
  }

  const displayName = typeof model.name === 'string' && model.name.trim()
    ? model.name.trim()
    : 'Untitled Game';
  const version = typeof args.version === 'string' && args.version.trim()
    ? args.version.trim()
    : '0.0.0';
  const build = typeof args.build === 'string' && args.build.trim()
    ? args.build.trim()
    : null;
  const built_at = typeof args.built_at === 'string' && args.built_at.trim()
    ? args.built_at.trim()
    : new Date().toISOString();
  const mathClaim = args.mathClaim && typeof args.mathClaim === 'object'
    ? { ...args.mathClaim }
    : null;

  const compliance = checkCompliance(model, jurisdiction);

  return {
    schema_version: MANIFEST_SCHEMA_VERSION,
    game_id: slugifyGameId(displayName),
    display_name: displayName,
    version,
    build,
    built_at,
    topology: readTopology(model),
    theme_tags: readThemeTags(model),
    features: readFeatures(model),
    /* UQ-DEEP-AP G-5: IGT-style stage inventory + lifecycle pair contract. */
    stages: readStages(model),
    lifecycle_pairs: readLifecyclePairs(model),
    math_claim: mathClaim,
    compliance,
  };
}

/**
 * Canonical, pretty JSON serialisation of a manifest.
 * Uses 2-space indent + trailing newline for diff-friendly output.
 * @param {ManifestObject} manifest
 * @returns {string}
 */
export function manifestToJSON(manifest) {
  return JSON.stringify(manifest, null, 2) + '\n';
}

/**
 * UQ-DEEP-AS J-P2-2: named error class for Sentry/log-aggregator grouping.
 * Generic Error throws all manifest mismatches into the same bucket as
 * unrelated throws. Named class makes alerting/dashboarding tractable.
 */
export class ManifestSchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ManifestSchemaError';
  }
}

/**
 * UQ-DEEP-AR I-5 (Auditor I #5 — back-compat reader):
 * AP bumped MANIFEST_SCHEMA_VERSION 1.0.0 → 1.1.0 (stages + lifecycle_pairs
 * added). Pre-existing cert bundles on disk are stamped 1.0.0 and must
 * keep parsing. Reader-side check: accept any 1.x.y stream + optional
 * semver pre-release/build suffix (e.g. 1.2.0-rc1, 1.2.0+build5).
 *
 * UQ-DEEP-AS J-P2-1: explicit pre-release/build suffix support — QA
 * pipelines stamp -rc tags before promotion, regex must accept them.
 *
 * @param {string} version - semver string from disk
 * @returns {boolean}
 */
export function isCompatibleSchema(version) {
  if (typeof version !== 'string') return false;
  // Accept 1.x.y with optional -prerelease.id / +build.id suffix.
  // Major bump (2.x) would force migration.
  return /^1\.\d+\.\d+(?:[-+][\w.]+)?$/.test(version);
}

/**
 * UQ-DEEP-AR I-5 + AS J-P2-2: throws ManifestSchemaError on mismatch.
 * @param {string} version
 * @throws {ManifestSchemaError}
 */
export function assertCompatibleSchema(version) {
  if (!isCompatibleSchema(version)) {
    throw new ManifestSchemaError(
      'manifest schema_version=' + version + ' incompatible with reader ' + MANIFEST_SCHEMA_VERSION
    );
  }
}

export { MANIFEST_SCHEMA_VERSION };
