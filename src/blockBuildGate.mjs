/**
 * src/blockBuildGate.mjs
 *
 * BLOCK-1-c (Boki direktiva 2026-06-27) — "sve dok sve nije potpuno
 * savrseno ne gradi se slot."
 *
 * Hard convergence gate. Pure-Node module (no DOM, no globals) — safe
 * to import from buildSlotHTML.mjs, tools/build-gated.mjs i contract
 * testove.
 *
 * # API
 *
 *   assertConvergencePass(slug, { repoRoot? }) → void
 *     Throws BuildGateError ako:
 *       - nema reports/par-block-until-perfect/<slug>.json receipt-a,
 *       - receipt.verdict !== 'PASS',
 *       - receipt.buildAllowed !== true,
 *       - |receipt.finalDeltaPP| > MATH_PRECISION_BAND_PP (defense in depth).
 *
 *   tryConvergencePass(slug, opts) → { allowed: bool, reason, receipt? }
 *     Non-throwing pretpostavka — vraća strukturisani verdict.
 *
 *   loadConvergenceReceipt(slug, opts) → Object | null
 *     Čista I/O funkcija — vraća parsed receipt ili null ako fajl ne postoji.
 *
 *   isGateActive() → bool
 *     Čita process.env.SLOT_BUILD_REQUIRE_CONVERGENCE ('1' = aktivan).
 *
 * # OPT-IN AKTIVACIJA
 *
 * Postojeći build pipeline (samples/, synthetic, demo HTML) nikad nije
 * pokretao convergence — i ne treba da. Gate se aktivira SAMO kad:
 *
 *   1) `process.env.SLOT_BUILD_REQUIRE_CONVERGENCE === '1'`, ILI
 *   2) `model.__require_convergence__ === true` (explicit field na modelu).
 *
 * build-gated.mjs CLI postavi env pre buildSlotHTML poziva. Contract
 * testovi koriste oba puta.
 *
 * # ANTI-PATTERN GUARDS
 *
 *   - Slug normalization: prihvata bilo koji case + whitespace, normalizuje
 *     na lowercase dash-separated. Nedostatak normalizacije bio bi pravi
 *     bug (ingest deriveSlug → camelCase split fix iz PAR-14-J).
 *   - Receipt validation: proverava strukturu, ne samo postojanje. Stari
 *     receipt sa drugačijim shape-om mora explicitno failati.
 *   - Defense in depth: čak i kad receipt kaže PASS, dodatno verifikuje
 *     |deltaPP| ≤ band. Korumpiran receipt sa lažnim PASS bi tu pao.
 */

/* Browser-safe lazy bind of node-only modules. The same pattern parser.mjs
 * uses (Boki UQ-U-9): statički `import ... from 'node:fs'` u modulu koji
 * app.js statički importuje uzrokuje browser CORS fail ("Access to script
 * at 'node:fs' has been blocked by CORS policy"). Fix: top-level await
 * sa try/catch tako da browser bundle dobije `null` umesto network fetch-a.
 * Node CLI path je 100% nepromenjen. */
const _IS_NODE = typeof process !== 'undefined'
  && !!process?.versions?.node
  && typeof window === 'undefined';

const _nodeMods = await (async () => {
  if (!_IS_NODE) return null;
  try {
    const [fs, path, url] = await Promise.all([
      import('node:fs'),
      import('node:path'),
      import('node:url'),
    ]);
    return { fs, path, url };
  } catch (_) { return null; }
})();

import { MATH_PRECISION_BAND_PP } from './registry/mathPrecision.mjs';

const REPO_ROOT_DEFAULT = (() => {
  if (!_nodeMods) return null;
  const __filename = _nodeMods.url.fileURLToPath(import.meta.url);
  return _nodeMods.path.resolve(_nodeMods.path.dirname(__filename), '..');
})();

/* ─── Custom error class ───────────────────────────────────────────── */

export class BuildGateError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'BuildGateError';
    this.code = 'CONVERGENCE_GATE_FAIL';
    this.details = details;
  }
}

/* ─── Slug normalization ───────────────────────────────────────────── */

export function normalizeSlug(input) {
  if (input == null) return '';
  return String(input)
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/* ─── Gate activation ──────────────────────────────────────────────── */

export function isGateActive(model = null) {
  if (model && model.__require_convergence__ === true) return true;
  if (!_IS_NODE) return false;
  const env = process.env.SLOT_BUILD_REQUIRE_CONVERGENCE;
  return env === '1' || env === 'true';
}

/* ─── Receipt loader (pure I/O) ────────────────────────────────────── */

export function loadConvergenceReceipt(slug, { repoRoot = REPO_ROOT_DEFAULT } = {}) {
  if (!_nodeMods || !repoRoot) return null;
  const normalized = normalizeSlug(slug);
  if (!normalized) return null;
  const receiptPath = _nodeMods.path.join(
    repoRoot,
    'reports',
    'par-block-until-perfect',
    `${normalized}.json`,
  );
  if (!_nodeMods.fs.existsSync(receiptPath)) return null;
  try {
    const raw = _nodeMods.fs.readFileSync(receiptPath, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

/* ─── Verdict resolution ───────────────────────────────────────────── */

export function tryConvergencePass(slug, opts = {}) {
  const normalized = normalizeSlug(slug);
  if (!normalized) {
    return { allowed: false, reason: 'empty slug', receipt: null };
  }
  const receipt = loadConvergenceReceipt(normalized, opts);
  if (!receipt) {
    return {
      allowed: false,
      reason: `no convergence receipt for "${normalized}" — run par-sheet-block-until-perfect.mjs first`,
      receipt: null,
    };
  }
  /* Receipt schema validation. */
  if (typeof receipt.verdict !== 'string') {
    return {
      allowed: false,
      reason: 'receipt missing verdict field',
      receipt,
    };
  }
  if (receipt.verdict !== 'PASS') {
    return {
      allowed: false,
      reason: `receipt verdict "${receipt.verdict}" ≠ PASS`,
      receipt,
    };
  }
  if (receipt.buildAllowed !== true) {
    return {
      allowed: false,
      reason: 'receipt explicitly disallows build (buildAllowed=false)',
      receipt,
    };
  }
  /* Defense in depth: even if receipt claims PASS, re-verify delta band. */
  const delta = receipt.finalDeltaPP;
  if (typeof delta !== 'number' || !Number.isFinite(delta)) {
    return {
      allowed: false,
      reason: 'receipt finalDeltaPP missing or non-finite',
      receipt,
    };
  }
  if (Math.abs(delta) > MATH_PRECISION_BAND_PP) {
    return {
      allowed: false,
      reason: `receipt claims PASS but |Δ|=${Math.abs(delta).toFixed(3)} pp > band ±${MATH_PRECISION_BAND_PP} pp (defense-in-depth check)`,
      receipt,
    };
  }
  return {
    allowed: true,
    reason: `converged within ±${MATH_PRECISION_BAND_PP} pp at tier ${receipt.finalTier}`,
    receipt,
  };
}

/* ─── Throwing assertion ───────────────────────────────────────────── */

export function assertConvergencePass(slug, opts = {}) {
  const result = tryConvergencePass(slug, opts);
  if (!result.allowed) {
    throw new BuildGateError(
      `BUILD BLOKIRAN — slot "${slug}" ne sme da se gradi: ${result.reason}`,
      { slug, receipt: result.receipt, reason: result.reason },
    );
  }
  return result;
}

/* ─── Model-level entry point ──────────────────────────────────────── */

/**
 * Used from buildSlotHTML.mjs — proverava da li je gate aktivan i,
 * ako jeste, traži PASS receipt. Slug se izvlači iz model.__slug ILI
 * model.slug ILI normalizovanog model.name. Ako nema slug-a a gate je
 * aktivan, gate fail-uje sa explicit-no porukom.
 */
export function enforceBuildGate(model, opts = {}) {
  if (!isGateActive(model)) return { allowed: true, skipped: true };
  const slug = model.__slug || model.slug || normalizeSlug(model.name);
  if (!slug) {
    throw new BuildGateError(
      'BUILD BLOKIRAN — gate aktivan ali model nema slug/name za convergence lookup.',
      { reason: 'no slug derivable from model' },
    );
  }
  return assertConvergencePass(slug, opts);
}
