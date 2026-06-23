#!/usr/bin/env node
/**
 * tests/contracts/cluster-hf-clamp-convergence.test.mjs
 *
 * MATH-DEEP D+7 (2026-06-23) — HF auto-clamp convergence contract.
 *
 * Purpose
 *   Locks the behavior that --auto-hf-clamp / model.payback.useAutoHfClamp
 *   converges measured HF toward declared HF for cluster topology games.
 *   Without this contract, future refactors could silently regress the
 *   clamp math.
 *
 * Coverage
 *   1. Starlight cluster game w/o flag: rawMeasuredHF > 30% (uncalibrated)
 *   2. Same game w/ --auto-hf-clamp:    measuredHF ≈ declaredHF (|Δ| < 1pp)
 *   3. Probe summary carries autoHfClampApplied=true when clamp fires
 *   4. autoHfClampFactor is in (0,1] (clamp reduces, never amplifies HF)
 *   5. Idempotent: flag activation does NOT mutate rawMeasuredHF
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const PROBE = join(REPO, 'tools/math-rtp-probe.mjs');

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '\n    ' + detail : '')); }
}
function assert(c, m) { if (!c) throw new Error(m); }

console.log('\n=== cluster HF clamp convergence contract ===\n');

function runProbe(slug, extraArgs = []) {
  const r = spawnSync('node', [PROBE, '--slug', slug, '--runs', '15000', '--seed', '7', ...extraArgs],
    { cwd: REPO, encoding: 'utf8', timeout: 60_000 });
  if (r.status !== 0) {
    throw new Error(`probe failed status=${r.status} stderr=${(r.stderr||'').slice(-200)}`);
  }
  const report = JSON.parse(readFileSync(join(REPO, 'reports/math-rtp', slug + '.json'), 'utf8'));
  return report;
}

const SLUG = 'starlight-travellers-gdd';

/* (1) Raw HF uncalibrated */
let raw, clamped;
try {
  raw = runProbe(SLUG);
  t(`(${SLUG}) raw HF > declared (uncalibrated baseline)`,
    raw.declaredHF != null && raw.rawMeasuredHF > raw.declaredHF,
    `raw=${raw.rawMeasuredHF}% declared=${raw.declaredHF}%`);
} catch (e) {
  t('raw probe runs', false, e.message);
  process.exit(1);
}

/* (2) Clamped HF converges */
try {
  clamped = runProbe(SLUG, ['--auto-hf-clamp']);
  t(`(${SLUG}) clamped HF within ±1pp of declared`,
    clamped.declaredHF != null &&
    Math.abs(clamped.measuredHF - clamped.declaredHF) < 1.0,
    `measured=${clamped.measuredHF}% declared=${clamped.declaredHF}%`);
} catch (e) {
  t('clamped probe runs', false, e.message);
  process.exit(1);
}

/* (3) Flag emit */
t('autoHfClampApplied=true when flag set + delta > 1pp',
  clamped.autoHfClampApplied === true);
t('autoHfClampApplied=false by default (no flag)',
  raw.autoHfClampApplied === false);

/* (4) Clamp factor sane */
t('autoHfClampFactor in (0,1] (clamp reduces, never amplifies)',
  clamped.autoHfClampFactor > 0 && clamped.autoHfClampFactor <= 1,
  `factor=${clamped.autoHfClampFactor}`);

/* (5) Idempotent on rawMeasuredHF */
t('rawMeasuredHF unchanged by flag activation',
  Math.abs(raw.rawMeasuredHF - clamped.rawMeasuredHF) < 0.01,
  `raw(noflag)=${raw.rawMeasuredHF}% raw(flag)=${clamped.rawMeasuredHF}%`);

/* (6) hfDelta reports against the clamped value */
t('hfDelta computed from measuredHF (post-clamp)',
  Math.abs(clamped.measuredHF - clamped.declaredHF - clamped.hfDelta) < 0.01,
  `measured=${clamped.measuredHF} declared=${clamped.declaredHF} delta=${clamped.hfDelta}`);

console.log(`\nResult: ${pass} passed · ${fail} failed`);
if (fail > 0) process.exit(1);
