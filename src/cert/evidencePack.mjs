/**
 * src/cert/evidencePack.mjs
 *
 * Wave C1 — Evidence Pack builder (zero-touch cert pipeline).
 *
 * Purpose
 *   Aggregate everything a regulator wants to see beyond the manifest:
 *     • Test verdicts per block (pass/fail/skipped + count)
 *     • SHA-256 content fingerprint per attached artefact
 *     • Source GDD checksum (so they can prove the bundle matches the spec)
 *     • Block-level lifecycle summary (which lifecycle hooks each ships)
 *
 *   Inputs are plain JS objects so the builder is trivially testable in
 *   isolation. Actual disk I/O (reading test report files, hashing
 *   screenshots) is owned by `bundler.mjs` and `tools/cert-build.mjs`.
 *
 * Public API
 *   sha256Hex(buf|string) → string
 *   buildEvidencePack({ gddSource, testResults, artefacts, blocks }) → EvidencePack
 *   evidenceToJSON(evidence) → string         — canonical pretty JSON
 *
 * Lifecycle / perf
 *   Pure compute + node:crypto hashing. No DOM. Linear in artefact count.
 *
 * Senior-grade contract
 *   • Deterministic output ordering (sorted artefact list, sorted block list).
 *   • Hash algorithm is explicit + versioned via schema_version.
 *   • Counts (totals) recomputed at build time — never trust caller.
 *   • Never throws on missing optional fields; only on missing required.
 */

import { createHash } from 'node:crypto';

const EVIDENCE_SCHEMA_VERSION = '1.0.0';
const HASH_ALGO = 'sha256';

/**
 * @typedef {Object} TestResult
 * @property {string} name           — Test or suite label (e.g. 'realityCheck.test').
 * @property {number} passed
 * @property {number} failed
 * @property {number} [skipped]
 * @property {string} [verdict]      — 'pass' | 'fail' | 'partial' (derived if absent).
 * @property {string} [report_path]  — Relative path to a report file (optional).
 */

/**
 * @typedef {Object} Artefact
 * @property {string} path           — Relative path inside bundle (e.g. 'screenshots/spin-001.png').
 * @property {string} content_hash   — SHA-256 hex of the artefact contents.
 * @property {number} bytes          — Byte length of the artefact.
 * @property {string} [kind]         — Free-form classifier ('screenshot' | 'pdf' | 'log' | …).
 */

/**
 * @typedef {Object} BlockEvidence
 * @property {string} name           — e.g. 'realityCheck'
 * @property {string[]} lifecycle    — Lifecycle hooks the block implements.
 * @property {string} [test_status]  — 'pass' | 'fail' | 'untested'
 */

/**
 * @typedef {Object} EvidencePack
 * @property {string} schema_version
 * @property {string} hash_algo
 * @property {{ name:string, hash:string, bytes:number }} gdd_source
 * @property {{ total:{passed:number,failed:number,skipped:number}, suites:TestResult[] }} tests
 * @property {Artefact[]} artefacts
 * @property {BlockEvidence[]} blocks
 */

/**
 * SHA-256 hex of a Buffer or UTF-8 string.
 * @param {Buffer|string} buf
 * @returns {string}
 */
export function sha256Hex(buf) {
  const h = createHash(HASH_ALGO);
  if (typeof buf === 'string') {
    h.update(buf, 'utf8');
  } else if (buf instanceof Uint8Array) {
    h.update(buf);
  } else {
    throw new TypeError('sha256Hex: expected Buffer or string');
  }
  return h.digest('hex');
}

/**
 * Derive a single test verdict from a per-suite result.
 * @param {TestResult} r
 * @returns {'pass'|'fail'|'partial'}
 */
function deriveVerdict(r) {
  if (typeof r.verdict === 'string') {
    const v = r.verdict.toLowerCase();
    if (v === 'pass' || v === 'fail' || v === 'partial') return v;
  }
  if ((r.failed || 0) > 0) return 'fail';
  if ((r.passed || 0) > 0) return 'pass';
  return 'partial';
}

/**
 * Normalise + tally a list of test suite results.
 * @param {TestResult[]} suites
 * @returns {{ total:{passed:number,failed:number,skipped:number}, suites:TestResult[] }}
 */
function normaliseTests(suites) {
  const list = Array.isArray(suites) ? suites : [];
  const normalised = list
    .filter((s) => s && typeof s.name === 'string' && s.name.length > 0)
    .map((s) => ({
      name: s.name,
      passed: Number.isFinite(s.passed) ? s.passed : 0,
      failed: Number.isFinite(s.failed) ? s.failed : 0,
      skipped: Number.isFinite(s.skipped) ? s.skipped : 0,
      verdict: deriveVerdict(s),
      ...(typeof s.report_path === 'string' && s.report_path.length
        ? { report_path: s.report_path }
        : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const total = normalised.reduce(
    (acc, s) => {
      acc.passed += s.passed;
      acc.failed += s.failed;
      acc.skipped += s.skipped;
      return acc;
    },
    { passed: 0, failed: 0, skipped: 0 }
  );

  return { total, suites: normalised };
}

/**
 * Normalise + sort the artefact list.
 * @param {Artefact[]} artefacts
 * @returns {Artefact[]}
 */
function normaliseArtefacts(artefacts) {
  const list = Array.isArray(artefacts) ? artefacts : [];
  return list
    .filter((a) => a && typeof a.path === 'string' && typeof a.content_hash === 'string')
    .map((a) => ({
      path: a.path,
      content_hash: a.content_hash,
      bytes: Number.isFinite(a.bytes) ? a.bytes : 0,
      ...(typeof a.kind === 'string' && a.kind.length ? { kind: a.kind } : {}),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Normalise + sort the block evidence list.
 * @param {BlockEvidence[]} blocks
 * @returns {BlockEvidence[]}
 */
function normaliseBlocks(blocks) {
  const list = Array.isArray(blocks) ? blocks : [];
  return list
    .filter((b) => b && typeof b.name === 'string' && b.name.length > 0)
    .map((b) => ({
      name: b.name,
      lifecycle: Array.isArray(b.lifecycle)
        ? [...new Set(b.lifecycle.filter((x) => typeof x === 'string'))].sort()
        : [],
      test_status: typeof b.test_status === 'string' ? b.test_status : 'untested',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Build the evidence pack.
 *
 * @param {{
 *   gddSource: { name:string, content: Buffer|string },
 *   testResults?: TestResult[],
 *   artefacts?: Artefact[],
 *   blocks?: BlockEvidence[],
 * }} args
 * @returns {EvidencePack}
 */
export function buildEvidencePack(args) {
  if (!args || typeof args !== 'object') {
    throw new TypeError('buildEvidencePack: args object is required');
  }
  const { gddSource } = args;
  if (!gddSource || typeof gddSource !== 'object'
      || typeof gddSource.name !== 'string'
      || gddSource.content === undefined) {
    throw new TypeError('buildEvidencePack: args.gddSource{ name, content } required');
  }

  const content = gddSource.content;
  const bytes = typeof content === 'string'
    ? Buffer.byteLength(content, 'utf8')
    : (content instanceof Uint8Array ? content.byteLength : 0);

  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    hash_algo: HASH_ALGO,
    gdd_source: {
      name: gddSource.name,
      hash: sha256Hex(content),
      bytes,
    },
    tests: normaliseTests(args.testResults),
    artefacts: normaliseArtefacts(args.artefacts),
    blocks: normaliseBlocks(args.blocks),
  };
}

/**
 * Canonical, pretty JSON serialisation of the evidence pack.
 * @param {EvidencePack} ev
 * @returns {string}
 */
export function evidenceToJSON(ev) {
  return JSON.stringify(ev, null, 2) + '\n';
}

export { EVIDENCE_SCHEMA_VERSION, HASH_ALGO };
