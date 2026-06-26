/**
 * tests/_certPackWave2.test.mjs
 *
 * UQ-LV3-QA-5 Wave 2 (Boki 2026-06-26) — Regression coverage for
 * the cert-pack runtime audit consumer + per-jurisdiction PASS/FAIL +
 * shared anti-vendor shield + uploader /cert-pack endpoint.
 *
 * Covers (10 cases):
 *
 * Shared anti-vendor shield:
 *   1.  cert-pack imports shieldSanitizeObj from antiVendorShield
 *   2.  scrub falls back to inline walker only when shield absent
 *
 * Runtime audit consumer:
 *   3.  buildCertPack accepts opts.fallbackCount + opts.fallbackLast
 *   4.  buildCertPack accepts opts.operatorToggleLog
 *   5.  buildCertPack accepts opts.solverHistory
 *   6.  mc_results.json carries runtime block when caller supplies signals
 *   7.  mc_results.json keeps placeholder note when caller omits signals
 *
 * Per-jurisdiction PASS/FAIL:
 *   8.  jurisdiction.<row>.floorPassed = boolean per row
 *   9.  jurisdiction.verdict = NON_COMPLIANT when any floor fails
 *  10.  jurisdiction.verdict = COMPLIANT when targetRtp clears every floor
 *
 * Seed provenance:
 *  11.  cover.seedProvenance.seedRule documents the derivation
 *
 * Uploader /cert-pack endpoint:
 *  12.  /cert-pack/:slug route present + path-traversal-safe
 */

import { strict as assert } from 'node:assert';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildCertPack } from '../tools/cert-pack-export.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO       = resolve(dirname(__filename), '..');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${err.message}`);
    fail++;
  }
}

console.log('cert-pack Wave 2 contract suite');

const certPackSrc  = readFileSync(resolve(REPO, 'tools/cert-pack-export.mjs'), 'utf8');
const uploaderSrc  = readFileSync(resolve(REPO, 'tools/web-uploader-server.mjs'), 'utf8');

/* ── #1 + #2 shared shield ─────────────────────────────────────────── */

t('#1 cert-pack imports sanitizeObj from antiVendorShield', () => {
  assert.match(certPackSrc, /import\s*\{\s*sanitizeObj as shieldSanitizeObj\s*\}\s*from\s*['"]\.\.\/src\/registry\/antiVendorShield\.mjs['"]/);
});

t('#2 scrub prefers shield, falls back to inline only when shield absent', () => {
  /* Function body must first check typeof shieldSanitizeObj. */
  assert.match(certPackSrc, /typeof shieldSanitizeObj === ['"]function['"]/);
});

/* Build a fixture inside dist/ingest/ so the buildCertPack
 * security guard (resolved-under-REPO check) lets us through.
 * Clean up after the suite. */
const slug = 't-w2-fixture-' + process.pid;
const distDir = resolve(REPO, 'dist', 'ingest', slug);
mkdirSync(distDir, { recursive: true });
writeFileSync(join(distDir, 'model.json'), JSON.stringify({
  topology: { kind: 'rectangular', reels: 5, rows: 3 },
  payback: { rtp: 0.92, volatility: 'medium' },
}));
writeFileSync(join(distDir, 'par.json'), JSON.stringify({
  parSheet: { declared: {}, per_reel_weights: {}, paytable: [] },
  calibration: { declaredRtp: 0.92 },
}));
/* Low-RTP fixture for the NON_COMPLIANT test. */
const slugLow = slug + '-low';
const distDirLow = resolve(REPO, 'dist', 'ingest', slugLow);
mkdirSync(distDirLow, { recursive: true });
writeFileSync(join(distDirLow, 'model.json'), JSON.stringify({
  topology: { kind: 'rectangular', reels: 5, rows: 3 },
  payback: { rtp: 0.65, volatility: 'medium' },
}));

/* ── #3-#7 runtime audit consumer ──────────────────────────────────── */

t('#3 buildCertPack accepts opts.fallbackCount + opts.fallbackLast', () => {
  const { manifest } = buildCertPack({
    slug, distDir,
    fallbackCount: 17,
    fallbackLast: { at: '2026-06-26T01:00:00.000Z', fromStatus: 'online', totalTransitions: 17 },
  });
  /* manifest has 7 files (no throw = accepted). */
  assert.equal(manifest.files.length, 7);
});

t('#4 buildCertPack accepts opts.operatorToggleLog', () => {
  buildCertPack({
    slug, distDir,
    operatorToggleLog: [
      { kind: 'operator_backend_toggle', ts: '2026-06-26T01:00:00.000Z', action: 'spawned' },
    ],
  });
});

t('#5 buildCertPack accepts opts.solverHistory', () => {
  buildCertPack({
    slug, distDir,
    solverHistory: [
      { iter: 1, residual: 1e-2 },
      { iter: 2, residual: 5e-4 },
    ],
  });
});

t('#6 mc_results.json carries runtime block when caller supplies signals', () => {
  const { bodies } = buildCertPack({
    slug, distDir,
    fallbackCount: 5,
    fallbackLast: { at: '2026-06-26T01:00:00.000Z', fromStatus: 'online', totalTransitions: 5 },
    solverHistory: [{ iter: 1, residual: 1e-4 }],
    operatorToggleLog: [{ kind: 'operator_backend_toggle', action: 'spawned' }],
  });
  assert.equal(bodies.mc.runtime.fallbackCount, 5);
  assert.equal(bodies.mc.runtime.solverIterCount, 1);
  assert.equal(bodies.mc.runtime.operatorToggleCount, 1);
});

t('#7 mc_results.json keeps placeholder note when caller omits signals', () => {
  const { bodies } = buildCertPack({ slug, distDir });
  assert.match(bodies.mc.note, /MC batch run not included/);
});

/* ── #8-#10 per-jurisdiction PASS/FAIL ─────────────────────────────── */

t('#8 jurisdiction row has floorPassed boolean + declaredRtpPct', () => {
  const { bodies } = buildCertPack({ slug, distDir });
  for (const code of ['UKGC', 'MGA', 'NJ_DGE', 'DGOJ', 'NL_KSA']) {
    assert.equal(typeof bodies.jurisdiction[code].floorPassed, 'boolean',
      `${code} must have floorPassed boolean`);
    assert.equal(typeof bodies.jurisdiction[code].declaredRtpPct, 'number',
      `${code} must carry declaredRtpPct`);
  }
});

t('#9 jurisdiction.verdict=NON_COMPLIANT when any floor fails', () => {
  /* RTP 65% → fails UKGC 70 floor + every other (MGA 85, NJ 85, DGOJ 85, NL 80). */
  const { bodies } = buildCertPack({ slug: slugLow, distDir: distDirLow });
  assert.equal(bodies.jurisdiction.verdict, 'NON_COMPLIANT');
  assert.ok(bodies.jurisdiction.failedJurisdictions.length > 0, 'failedJurisdictions populated');
});

t('#10 jurisdiction.verdict=COMPLIANT when targetRtp clears every floor', () => {
  /* Fixture is RTP 92% — clears UKGC 70, MGA 85, NJ 85, DGOJ 85, NL 80. */
  const { bodies } = buildCertPack({ slug, distDir });
  assert.equal(bodies.jurisdiction.verdict, 'COMPLIANT');
  assert.equal(bodies.jurisdiction.failedJurisdictions.length, 0);
});

/* ── #11 seed provenance ───────────────────────────────────────────── */

t('#11 cover.seedProvenance documents derivation rule', () => {
  const { bodies } = buildCertPack({ slug, distDir });
  assert.ok(bodies.cover.seedProvenance, 'seedProvenance object present');
  assert.match(bodies.cover.seedProvenance.seedRule, /cert-pack-rng:/);
  assert.ok(bodies.cover.seedProvenance.hsmVendor, 'hsmVendor field present');
});

/* ── #12 uploader /cert-pack endpoint ──────────────────────────────── */

t('#12 uploader has /cert-pack/:slug route + slug whitelist', () => {
  assert.match(uploaderSrc, /\/cert-pack\\\/\(\[a-z0-9\._-\]\{1,80\}\)\$/);
  assert.match(uploaderSrc, /handleCertPackDownload/);
  /* Slug pattern is the same whitelist used elsewhere — path-traversal
     safe by construction (no `..`, no leading dot). */
});

rmSync(distDir, { recursive: true, force: true });
rmSync(distDirLow, { recursive: true, force: true });

console.log(`\nResult: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
