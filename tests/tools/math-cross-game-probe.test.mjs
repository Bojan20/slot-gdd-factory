#!/usr/bin/env node
/**
 * tests/tools/math-cross-game-probe.test.mjs
 *
 * MATH-DEEP cross-game probe test (informational, not RTP-gate).
 *
 * What this asserts
 *   - All 5 baseline GDDs probe-able (model.json exists, probe doesn't crash)
 *   - probeGame() returns a structured report with required fields
 *   - generateComparativeReport() aggregates correctly
 *   - Cross-game summary computes avg/max/min gap deterministically
 *
 * What this does NOT assert
 *   - measured RTP matches declared (cluster + lines topologies are known
 *     mismatches; probe is 5×3 lock_respin-optimized; closing gap is a
 *     FS-7 sister-repo kernel job, not this test's responsibility)
 *
 * Determinism
 *   Same seed across runs -> identical measured RTP per game.
 */

import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { probeGame, generateComparativeReport } from '../../tools/math-cross-game-probe.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('MATH-DEEP cross-game probe · test suite');

/* ── (1) Single-game probe smoke ──────────────────────────────────────── */

test('probeGame returns structured report for Cash Eruption', () => {
  const r = probeGame('cash-eruption-foundry-gdd', { runs: 5000, seed: 42 });
  assert(r.ok === true, `probe failed: ${r.error}`);
  assert(typeof r.report.measuredRTP === 'number', 'measuredRTP missing or wrong type');
  assert(typeof r.report.measuredHF  === 'number', 'measuredHF missing or wrong type');
  assert(r.report.runs === 5000, `runs: ${r.report.runs}`);
});

/* ── (2) Missing slug handled gracefully ──────────────────────────────── */

test('probeGame returns ok=false for missing slug', () => {
  /* Use a slug that PASSES the safe-slug regex but doesn't exist. */
  const r = probeGame('no-such-game-zzz-xyz', { runs: 100 });
  assert(r.ok === false, 'should fail for missing slug');
  assert(r.error.includes('missing'), `error message: ${r.error}`);
});

test('probeGame rejects invalid slug (path traversal guard)', () => {
  /* QA Agent#4 finding #6 fix: malicious slug with traversal is rejected. */
  const r = probeGame('../etc/passwd', { runs: 100 });
  assert(r.ok === false, 'should fail for malicious slug');
  assert(r.error.includes('invalid slug'), `expected invalid slug error, got: ${r.error}`);
});

/* ── (3) Comparative report aggregates 5 baselines ────────────────────── */

test('generateComparativeReport runs 5 baseline games', () => {
  const slugs = [
    'cash-eruption-foundry-gdd',
    'huff-n-more-puff-gdd',
    'starlight-travellers-gdd',
    'wrath-of-olympus-gdd',
    'gates-of-olympus-1000-gdd',
  ];
  const { games, summary, exit } = generateComparativeReport(slugs, { runs: 2000, seed: 42 });
  assert(games.length === 5, `expected 5 games, got ${games.length}`);
  assert(summary.gamesOk === 5, `expected 5 ok, got ${summary.gamesOk}`);
  assert(exit === 0, `exit code: ${exit}`);
  for (const g of games) {
    assert(typeof g.slug === 'string' && g.slug.length > 0, 'slug missing');
    assert(g.ok === true, `${g.slug} not ok: ${g.error}`);
    assert(typeof g.measuredRTP === 'number', `${g.slug} measuredRTP not a number`);
    assert(typeof g.topologyKind === 'string', `${g.slug} topologyKind missing`);
  }
});

/* ── (4) Determinism: same seed -> same RTP ───────────────────────────── */

test('Same seed produces same measured RTP', () => {
  const r1 = probeGame('cash-eruption-foundry-gdd', { runs: 5000, seed: 999 });
  const r2 = probeGame('cash-eruption-foundry-gdd', { runs: 5000, seed: 999 });
  assert(r1.ok && r2.ok, 'both probes should succeed');
  assert(r1.report.measuredRTP === r2.report.measuredRTP,
    `non-deterministic: ${r1.report.measuredRTP} ≠ ${r2.report.measuredRTP}`);
});

/* ── (5) Summary stats are well-formed ────────────────────────────────── */

test('Summary stats avgMeasured/avgDeclared/maxGap computed', () => {
  const slugs = ['cash-eruption-foundry-gdd', 'huff-n-more-puff-gdd'];
  const { summary } = generateComparativeReport(slugs, { runs: 2000, seed: 42 });
  assert(typeof summary.avgMeasuredRTP === 'number', 'avgMeasuredRTP missing');
  assert(typeof summary.maxRTPGap === 'number', 'maxRTPGap missing');
  assert(typeof summary.minRTPGap === 'number', 'minRTPGap missing');
  assert(summary.maxRTPGap >= summary.minRTPGap, `max >= min violated: ${summary.maxRTPGap} vs ${summary.minRTPGap}`);
});

/* ── (6) Topology kind classification covers expected variants ────────── */

test('topology kinds emit expected labels', () => {
  const r = probeGame('cash-eruption-foundry-gdd', { runs: 100 });
  assert(r.ok, `probe failed: ${r.error}`);
  /* Trigger generateComparativeReport to walk topology kind. */
  const { games } = generateComparativeReport(['cash-eruption-foundry-gdd'], { runs: 100 });
  const valid = ['plinko', 'slingo', 'hex', 'wheel', 'radial', 'crash',
                 'cluster', 'cascade', 'tumble', 'lock_respin', 'ways',
                 'lines', 'unknown'];
  assert(valid.includes(games[0].topologyKind),
    `unknown topology kind: ${games[0].topologyKind}`);
});

/* ── Result ──────────────────────────────────────────────────────────── */

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
