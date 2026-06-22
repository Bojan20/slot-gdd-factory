#!/usr/bin/env node
/**
 * tests/math/per-spin-time.test.mjs
 *
 * MATH-12 · QA Test #3 — Per-spin time budget.
 *
 * Probe MUST complete 50k spins under 16 sec (60fps budget per spin avg).
 * Industry expectation: > 100k spins/sec for pure-JS sim, > 1M for WASM.
 * Bilo koja regression koja oslabi performance je critical (probe je
 * core math tool — sve breakdown calcs depend on it).
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const PROBE = join(REPO, 'tools/math-rtp-probe.mjs');
const REPORT = join(REPO, 'reports/math-rtp/cash-eruption-foundry-gdd.json');

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

try {
  const t0 = Date.now();
  const r = spawnSync('node', [PROBE, '--runs', '50000', '--seed', '42'], { cwd: REPO });
  const elapsed = Date.now() - t0;
  assert(r.status === 0, `probe failed`);

  const s = JSON.parse(readFileSync(REPORT, 'utf8'));

  /* (1) Wall clock < 16 sec for 50k spins (very generous — actual is ~50ms) */
  assert(elapsed < 16000, `50k spin wall clock ${elapsed}ms exceeds 16 sec budget`);

  /* (2) Probe reports > 100k spins/sec internally */
  assert(s.spinsPerSec > 100000,
    `spinsPerSec ${s.spinsPerSec} below 100k threshold — performance regression`);

  /* (3) Per-spin time < 0.5ms (sub-millisecond per spin) */
  const perSpinUs = (elapsed / 50000) * 1000;
  assert(perSpinUs < 500, `per-spin ${perSpinUs.toFixed(1)}μs above 500μs threshold`);

  console.log(`✓ per-spin-time.test.mjs — 50k spins in ${elapsed}ms (${s.spinsPerSec} spin/s, ${perSpinUs.toFixed(1)}μs/spin avg)`);
} catch (e) {
  console.error('✗ per-spin-time.test.mjs:', e.message);
  process.exit(1);
}
