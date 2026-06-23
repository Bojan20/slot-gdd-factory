#!/usr/bin/env node
/**
 * tests/contracts/slingo-kernel-bridge.test.mjs
 *
 * MATH-DEEP D+4 (2026-06-23) — Slingo closed-form analytical RTP contract.
 *
 * Validates:
 *   1. buildSlingoParamsFromModel emits sane defaults from any model
 *   2. computeSlingoKernelRtp returns ok=true for slingo topology
 *   3. Non-slingo topology returns ok=false with reason
 *   4. Deterministic: same model + opts ⇒ same rtpContribution
 *   5. Cache: second invocation returns same object reference
 *   6. Expected-marks trajectory monotonically non-decreasing
 *   7. Rainbow-riches-online slingo baseline yields positive RTP
 *   8. Per-spin RTP is sessionRTP / spinsPerSession (invariant)
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildSlingoParamsFromModel,
  computeSlingoKernelRtp,
  _resetCache,
} from '../../src/blocks/featureSimPlugins/slingoKernelBridge.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const REAL_GAMES = join(REPO, 'dist/real-games');

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '\n    ' + detail : '')); }
}
async function asyncT(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + e.message); }
}
function assert(c, m) { if (!c) throw new Error(m); }

console.log('\n=== SLINGO kernel bridge (closed-form) ===\n');

/* Load rainbow-riches if present. */
const rainbowSlugs = ['25-rainbow-riches-online-ports-megaways-slingo-cluster'];
let rainbow = null;
for (const slug of rainbowSlugs) {
  const p = join(REAL_GAMES, slug, 'model.json');
  if (existsSync(p)) { rainbow = JSON.parse(readFileSync(p, 'utf8')); break; }
}

const synthSlingo = {
  topology: { kind: 'slingo', is_slingo: true, reels: 5, rows: 5 },
  slingo: { gridSize: 5, poolSize: 50, revealsPerSpin: 5, spinsPerSession: 11 },
};
const synthLine = { topology: { kind: 'lines', reels: 5, rows: 3 } };

/* (1) Default params */
const p1 = buildSlingoParamsFromModel(synthSlingo);
t('buildSlingoParamsFromModel emits sane defaults',
  p1.gridSize === 5 && p1.poolSize === 50 && p1.revealsPerSpin === 5 && p1.isSlingo === true);

/* (3) Non-slingo gate */
await asyncT('non-slingo topology returns ok=false', async () => {
  _resetCache();
  const r = await computeSlingoKernelRtp(synthLine);
  assert(r.ok === false, `expected ok=false, got ${JSON.stringify(r).slice(0,200)}`);
  assert(/not a slingo/i.test(r.reason), `bad reason: ${r.reason}`);
});

/* (2) Synthetic slingo ok=true */
await asyncT('computeSlingoKernelRtp returns ok=true for slingo topology', async () => {
  _resetCache();
  const r = await computeSlingoKernelRtp(synthSlingo);
  assert(r.ok === true, `expected ok=true, got reason: ${r.reason}`);
  assert(Number.isFinite(r.rtpContribution), 'rtpContribution not finite');
  assert(r.rtpContribution >= 0, 'rtpContribution negative');
  assert(Array.isArray(r.stepwise) && r.stepwise.length === 11, 'stepwise length mismatch');
});

/* (4) Determinism */
await asyncT('deterministic: same input → same rtpContribution', async () => {
  _resetCache();
  const r1 = await computeSlingoKernelRtp(synthSlingo);
  _resetCache();
  const r2 = await computeSlingoKernelRtp(synthSlingo);
  assert(Math.abs(r1.rtpContribution - r2.rtpContribution) < 1e-12, 'non-deterministic');
});

/* (5) Cache reference */
await asyncT('cache: second call returns same object reference', async () => {
  _resetCache();
  const r1 = await computeSlingoKernelRtp(synthSlingo);
  const r2 = await computeSlingoKernelRtp(synthSlingo);
  assert(r1 === r2, 'cache miss');
});

/* (6) Stepwise monotonic */
await asyncT('expected-marks trajectory monotonically non-decreasing', async () => {
  _resetCache();
  const r = await computeSlingoKernelRtp(synthSlingo);
  let prev = 0;
  for (const step of r.stepwise) {
    assert(step.accumulatedMarks >= prev,
      `monotonic violated: ${prev} → ${step.accumulatedMarks} on spin ${step.spin}`);
    prev = step.accumulatedMarks;
  }
});

/* (7) Rainbow-riches baseline */
if (rainbow) {
  await asyncT('rainbow-riches slingo baseline yields positive RTP', async () => {
    _resetCache();
    const r = await computeSlingoKernelRtp(rainbow);
    assert(r.ok === true, `expected ok=true, got reason: ${r.reason}`);
    assert(r.rtpContribution > 0, `RTP should be > 0, got ${r.rtpContribution}`);
  });
}

/* (8) Invariant */
await asyncT('invariant: perSpinRtp === sessionRtp / spinsPerSession', async () => {
  _resetCache();
  const r = await computeSlingoKernelRtp(synthSlingo);
  const expected = r.sessionRtpContribution / r.params.spinsPerSession;
  assert(Math.abs(r.rtpContribution - expected) < 1e-12,
    `invariant broken: ${r.rtpContribution} ≠ ${expected}`);
});

console.log(`\nResult: ${pass} passed · ${fail} failed`);
if (fail > 0) process.exit(1);
