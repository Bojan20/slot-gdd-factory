#!/usr/bin/env node
/**
 * tests/tools/par-14-j-portfolio-extension.test.mjs
 *
 * PAR-14-J contract test — portfolio extension via PAR-14-I orchestrator.
 *
 * # COVERAGE
 *
 *   A: pipeline `deriveSlug` import contract — uses the same canonical
 *      slug helper as the ingest tool (no parallel regex / drift).
 *   B: pipeline `renderSummary` guards against missing-stage receipts
 *      (ERR-path slug doesn't crash the run).
 *   C: 6th slug `book-expanding-bonus-buy` PASS verdict landed at
 *      `reports/par-convergence/book-expanding-bonus-buy.json` AND
 *      `reports/par-pipeline/book-expanding-bonus-buy.json`.
 *   D: cross-vendor xlsx duplicate detection — BoB and BoU share the
 *      same MD5 source hash (manifest provenance lets audit catch it).
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('PAR-14-J PORTFOLIO EXTENSION · contract test');

const pipePath = join(REPO, 'tools', 'par-sheet-pipeline.mjs');
const pipeSrc = readFileSync(pipePath, 'utf-8');

/* ── A: canonical deriveSlug usage ─────────────────────────────── */

test('A1: pipeline imports deriveSlug from _par-sheet-to-model.mjs', () => {
  assert(/import\s*\{[\s\S]{0,80}deriveSlug[\s\S]{0,80}\}\s+from\s+['"]\.\/_par-sheet-to-model\.mjs['"]/.test(pipeSrc),
    'expected pipeline to import deriveSlug from ingest tool');
});

test('A2: pipeline no longer defines local slug regex', () => {
  /* Pre-fix had a local /ParSheets[_\-\s]+([A-Za-z0-9_\-]+?)/ regex
   * that stripped CamelCase. Post-fix delegates to deriveSlug entirely. */
  assert(!/match\(\/ParSheets\[_\\\-\\\s\]/.test(pipeSrc),
    'expected pipeline to drop local ParSheets slug regex');
});

test('A3: pipeline calls deriveSlug(opts.xlsx) on --xlsx path', () => {
  assert(/const\s+slug\s*=\s*deriveSlug\(opts\.xlsx\)/.test(pipeSrc),
    'expected `const slug = deriveSlug(opts.xlsx)`');
});

/* ── B: renderSummary error-path guard ─────────────────────────── */

test('B1: renderSummary guards stages destructure', () => {
  assert(/const\s+stages\s*=\s*r\.stages\s*\|\|\s*\{\}/.test(pipeSrc),
    'expected `const stages = r.stages || {}` in renderSummary');
});

test('B2: error path renders r.error message in delta column', () => {
  assert(/r\.error\s*\?\s*`err:\s*\$\{r\.error/.test(pipeSrc),
    'expected error message in delta-column fallback');
});

/* ── C: 6th slug receipt persistence ───────────────────────────── */

const SLUG_6 = 'book-expanding-bonus-buy';
const convergenceReport = join(REPO, 'reports', 'par-convergence', `${SLUG_6}.json`);
const pipelineReport = join(REPO, 'reports', 'par-pipeline', `${SLUG_6}.json`);

test('C1: convergence report for 6th slug present', () => {
  assert(existsSync(convergenceReport), `expected ${convergenceReport}`);
  const j = JSON.parse(readFileSync(convergenceReport, 'utf-8'));
  assert(j.verdict === 'PASS', `expected PASS verdict, got ${j.verdict}`);
  assert(Math.abs(j.deltaPP) <= 0.05, `expected |Δ| ≤ 0.05 pp, got ${j.deltaPP}`);
});

test('C2: pipeline report for 6th slug present with all stages', () => {
  assert(existsSync(pipelineReport), `expected ${pipelineReport}`);
  const j = JSON.parse(readFileSync(pipelineReport, 'utf-8'));
  assert(j.slug === SLUG_6, `expected slug ${SLUG_6}, got ${j.slug}`);
  assert(j.stages.classify, 'expected stages.classify');
  assert(j.stages.autoTune, 'expected stages.autoTune');
  assert(j.stages.converge, 'expected stages.converge');
  assert(j.stages.classify.detectedFeatures.includes('bonus_buy'),
    `expected bonus_buy in detectedFeatures, got ${j.stages.classify.detectedFeatures}`);
  assert(j.stages.classify.detectedFeatures.includes('free_spins'),
    `expected free_spins in detectedFeatures, got ${j.stages.classify.detectedFeatures}`);
});

/* ── D: cross-vendor duplicate detection ───────────────────────── */

const BOB_XLSX = `${process.env.HOME}/Desktop/ParSheets/ParSheets_BookExpandingBonusBuy.xlsx`;
const BOU_XLSX = `${process.env.HOME}/Desktop/ParSheets/ParSheets_BookOfUnseen_BonusBuy.xlsx`;

test('D1: BoB and BoU share identical xlsx source (cross-vendor duplicate)', () => {
  if (!existsSync(BOB_XLSX) || !existsSync(BOU_XLSX)) {
    console.log('    (skipped — par sheets not present)');
    return;
  }
  const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
  const bobHash = sha256(BOB_XLSX);
  const bouHash = sha256(BOU_XLSX);
  assert(bobHash === bouHash,
    `expected identical SHA256 (cross-vendor duplicate), got BoB=${bobHash.substring(0, 12)} BoU=${bouHash.substring(0, 12)}`);
});

test('D2: manifest captures source SHA256 for audit deduplication', () => {
  const bobManifest = join(REPO, 'dist', 'par-sheet-real-games', SLUG_6, 'manifest.json');
  if (!existsSync(bobManifest)) {
    console.log('    (skipped — manifest not present)');
    return;
  }
  const m = JSON.parse(readFileSync(bobManifest, 'utf-8'));
  assert(m.source && m.source.sha256 && /^[a-f0-9]{64}$/.test(m.source.sha256),
    `expected manifest.source.sha256 to be a 64-char hex digest, got ${m.source?.sha256}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
