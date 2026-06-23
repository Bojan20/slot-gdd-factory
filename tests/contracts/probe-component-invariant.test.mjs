#!/usr/bin/env node
/**
 * tests/contracts/probe-component-invariant.test.mjs
 *
 * MATH-DEEP B++++ — Probe per-component RTP breakdown invariant (2026-06-23).
 *
 * Verifies that for every probe run:
 *   sum(measuredRtpBreakdown values) ≈ rawMeasuredRTP within float epsilon
 *
 * Why this matters
 *   Per-component breakdown is the foundation of apples-to-apples kernel
 *   comparison. If the sum drifts from rawMeasuredRTP, kernel comparisons
 *   become unreliable. The invariant test guards against silent additions
 *   of new plugins that bump totalWin but forget to bump a component.
 *
 * Strategy
 *   Run probe on 3 baselines (cash-eruption, starlight, gates) at small
 *   spin count, parse the JSON report, assert
 *     |sum(measuredRtpBreakdown) - rawMeasuredRTP| < 0.01pp
 *   (rounding tolerance from probe's .toFixed(4) per component).
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const PROBE = join(REPO, 'tools/math-rtp-probe.mjs');
const RTP_REPORTS = join(REPO, 'reports/math-rtp');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('PROBE COMPONENT INVARIANT contract · test suite');

function runProbeReport(slug) {
  const r = spawnSync('node', [PROBE, `--slug=${slug}`, '--runs=2000', '--seed=42'],
    { encoding: 'utf8', timeout: 60_000 });
  if (r.status !== 0) throw new Error(`probe exit ${r.status}: ${(r.stderr || '').slice(0, 200)}`);
  return JSON.parse(readFileSync(join(RTP_REPORTS, `${slug}.json`), 'utf8'));
}

const BASELINES = [
  'cash-eruption-foundry-gdd',
  'starlight-travellers-gdd',
  'gates-of-olympus-1000-gdd',
];

for (const slug of BASELINES) {
  test(`${slug}: measuredRtpBreakdown has all expected keys`, () => {
    const report = runProbeReport(slug);
    assert(typeof report.measuredRtpBreakdown === 'object', 'measuredRtpBreakdown missing');
    const expectedKeys = ['line', 'cluster', 'payAnywhere', 'scatter', 'pattern', 'hw', 'fsRound'];
    for (const k of expectedKeys) {
      assert(typeof report.measuredRtpBreakdown[k] === 'number',
        `measuredRtpBreakdown.${k} should be number, got ${typeof report.measuredRtpBreakdown[k]}`);
    }
  });

  test(`${slug}: sum(measuredRtpBreakdown) ≈ rawMeasuredRTP within 0.01pp`, () => {
    const report = runProbeReport(slug);
    const breakdown = report.measuredRtpBreakdown;
    const sum = Object.values(breakdown).reduce((a, b) => a + b, 0);
    const raw = report.rawMeasuredRTP;
    const delta = Math.abs(sum - raw);
    assert(delta < 0.01,
      `${slug}: sum ${sum.toFixed(4)} ≠ rawMeasuredRTP ${raw.toFixed(4)} (delta ${delta.toFixed(4)}pp)`);
  });
}

test('Non-zero components correspond to topology', () => {
  /* starlight is cluster — its breakdown.cluster should be > 0,
   * its breakdown.line should be 0 (cluster bypasses line eval). */
  const star = runProbeReport('starlight-travellers-gdd');
  assert(star.measuredRtpBreakdown.cluster > 0,
    `starlight cluster should be > 0, got ${star.measuredRtpBreakdown.cluster}`);
  assert(star.measuredRtpBreakdown.line === 0,
    `starlight line should be 0 (cluster topology), got ${star.measuredRtpBreakdown.line}`);
});

test('Components are non-negative', () => {
  const report = runProbeReport('cash-eruption-foundry-gdd');
  for (const [k, v] of Object.entries(report.measuredRtpBreakdown)) {
    assert(v >= 0, `${k} should be ≥ 0, got ${v}`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
