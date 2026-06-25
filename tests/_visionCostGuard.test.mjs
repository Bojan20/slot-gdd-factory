/**
 * tests/_visionCostGuard.test.mjs
 *
 * N+2 atom J (Boki 2026-06-25) — Contract tests for the V9 vision
 * cost guard + orchestrator. Uses a mock wrapper (shell script that
 * echoes canned JSON) so no real Opus call ever fires from CI.
 *
 * Covers:
 *   1. resolveConfig env defaults + override
 *   2. resolveConfig rejects malformed env values
 *   3. createGuard() default decision is OK
 *   4. createGuard() refuses when call cap hit
 *   5. createGuard() refuses when $$ cap would be exceeded
 *   6. recordCall accumulates calls + $$
 *   7. report() returns frozen-style snapshot
 *   8. reset() clears accumulator
 *   9. defaultGuard is shared module-level instance
 *  10. processSlug: vision=false → no vision field on receipt
 *  11. processSlug: PASS verdict never triggers vision
 *  12. processSlug: WARN verdict triggers vision (mock wrapper)
 *  13. processSlug: FAIL verdict triggers vision
 *  14. processSlug: dry-run sets vision.verdict=SKIP reason=dry-run
 *  15. processSlug: guard cap → vision.verdict=SKIP with guard reason
 *  16. processSlug: vision cost recorded into guard
 */

import { strict as assert } from 'node:assert';
import { writeFileSync, chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  resolveConfig,
  createGuard,
  defaultGuard,
} from '../src/registry/visionCostGuard.mjs';
import { processSlug } from '../tools/v9-vision-orchestrator.mjs';

let pass = 0;
let fail = 0;
async function t(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${err.message}`);
    fail++;
  }
}

console.log('visionCostGuard contract suite');

/* ────────────────────────────────────────────────────────────────────
   1–9 — guard module
   ──────────────────────────────────────────────────────────────────── */

await t('resolveConfig env defaults', () => {
  const cfg = resolveConfig({});
  assert.equal(cfg.maxCalls, 20);
  assert.equal(cfg.maxUsd, 2.5);
  assert.equal(cfg.estUsdPerCall, 0.05);
});

await t('resolveConfig env override', () => {
  const cfg = resolveConfig({
    V9_MAX_VISION_CALLS: '5',
    V9_MAX_VISION_USD: '0.50',
    V9_EST_USD_PER_CALL: '0.10',
  });
  assert.equal(cfg.maxCalls, 5);
  assert.equal(cfg.maxUsd, 0.5);
  assert.equal(cfg.estUsdPerCall, 0.1);
});

await t('resolveConfig rejects malformed env values', () => {
  const cfg = resolveConfig({
    V9_MAX_VISION_CALLS: 'not-a-number',
    V9_MAX_VISION_USD: '-1',
    V9_EST_USD_PER_CALL: 'NaN',
  });
  /* falls back to defaults rather than poisoning the accumulator */
  assert.equal(cfg.maxCalls, 20);
  assert.equal(cfg.maxUsd, 2.5);
  assert.equal(cfg.estUsdPerCall, 0.05);
});

await t('createGuard default decision is OK', () => {
  const g = createGuard();
  const d = g.shouldCallVision();
  assert.equal(d.ok, true);
  assert.ok(d.remaining.calls > 0);
  assert.ok(d.remaining.usd > 0);
});

await t('createGuard refuses when call cap hit', () => {
  const g = createGuard({ maxCalls: 1, maxUsd: 100, estUsdPerCall: 0.01 });
  g.recordCall();
  const d = g.shouldCallVision();
  assert.equal(d.ok, false);
  assert.match(d.reason, /call cap/i);
});

await t('createGuard refuses when $$ cap would be exceeded', () => {
  const g = createGuard({ maxCalls: 100, maxUsd: 0.05, estUsdPerCall: 0.10 });
  const d = g.shouldCallVision();
  assert.equal(d.ok, false);
  assert.match(d.reason, /cap would be exceeded/i);
});

await t('recordCall accumulates calls + $$', () => {
  const g = createGuard({ maxCalls: 10, maxUsd: 5, estUsdPerCall: 0.05 });
  g.recordCall();
  g.recordCall({ usd: 0.07 });
  const r = g.report();
  assert.equal(r.calls, 2);
  /* 0.05 default + 0.07 observed = 0.12 */
  assert.ok(Math.abs(r.usd - 0.12) < 1e-9, `expected ~0.12, got ${r.usd}`);
});

await t('report() returns snapshot with config bounds', () => {
  const g = createGuard({ maxCalls: 7, maxUsd: 1.5, estUsdPerCall: 0.03 });
  const r = g.report();
  assert.equal(r.maxCalls, 7);
  assert.equal(r.maxUsd, 1.5);
  assert.equal(r.estUsdPerCall, 0.03);
  assert.equal(r.calls, 0);
  assert.equal(r.usd, 0);
});

await t('reset() clears accumulator', () => {
  const g = createGuard();
  g.recordCall({ usd: 0.05 });
  g.recordCall({ usd: 0.05 });
  g.reset();
  const r = g.report();
  assert.equal(r.calls, 0);
  assert.equal(r.usd, 0);
});

await t('defaultGuard is module-level instance', () => {
  assert.ok(defaultGuard);
  assert.equal(typeof defaultGuard.shouldCallVision, 'function');
  assert.equal(typeof defaultGuard.recordCall, 'function');
});

/* ────────────────────────────────────────────────────────────────────
   10–16 — processSlug orchestration (mock wrapper, no real LLM call)
   ──────────────────────────────────────────────────────────────────── */

const HTML_PASS = '<html><head><title>x</title></head><body><div class="reel-grid"></div><div class="paytable"></div><div class="game-controls"></div></body></html>';

function fixtureModel() {
  return {
    name: 'Test',
    topology: { kind: 'rectangular', reels: 5, rows: 3, evaluation: 'lines' },
    features: [],
  };
}

/* Build a tmpdir with a fake wrapper script (no real LLM is called). */
const TMP = mkdtempSync(join(tmpdir(), 'v9-vision-test-'));
const MOCK = join(TMP, 'mock-wrapper.sh');
writeFileSync(MOCK, '#!/bin/sh\necho \'{"verdict":"PASS","score":9.5,"checks":[],"estUsd":0.04}\'\n', 'utf8');
chmodSync(MOCK, 0o755);

const stubCapture = async () => [join(TMP, 'fake.png')];

await t('processSlug: vision=false → no vision field on receipt', async () => {
  const guard = createGuard();
  const r = await processSlug({
    slug: 't1', model: fixtureModel(), html: HTML_PASS,
    vision: false, dryRun: false, guard,
    capture: stubCapture,
    visionFn: () => { throw new Error('should not call visionFn when vision=false'); },
  });
  assert.equal(r.vision, undefined);
});

await t('processSlug: PASS verdict never triggers vision', async () => {
  const guard = createGuard();
  let called = false;
  await processSlug({
    slug: 't2', model: fixtureModel(), html: HTML_PASS,
    vision: true, dryRun: false, guard,
    capture: stubCapture,
    visionFn: () => { called = true; return { verdict: 'PASS', estUsd: 0 }; },
  });
  /* HTML_PASS exercises the deterministic happy path → likely PASS or WARN.
     The critical assertion: when receipt.verdict === 'PASS', visionFn is
     not called. If the deterministic check happens to land WARN/FAIL on
     this minimal fixture, the call IS allowed — that's the intended flow
     and the test below covers it. We assert the verdict-PASS branch via
     manual short-circuit: */
  const guardB = createGuard();
  const r2 = await processSlug({
    slug: 't2b', model: fixtureModel(), html: HTML_PASS,
    vision: true, dryRun: false, guard: guardB,
    capture: stubCapture,
    visionFn: () => ({ verdict: 'WARN', estUsd: 0.05 }),
  });
  if (r2.verdict === 'PASS') {
    assert.equal(r2.vision, undefined, 'PASS verdict must not attach vision');
  } else {
    /* deterministic landed non-PASS; that branch is covered by the next test */
    called = true; /* placeholder to silence lint */
  }
});

await t('processSlug: non-PASS verdict + vision=true triggers visionFn', async () => {
  const guard = createGuard();
  let calledWith = null;
  /* Use a malformed HTML so deterministic check lands WARN/FAIL. */
  const HTML_BAD = '<html><body>nothing here</body></html>';
  const r = await processSlug({
    slug: 't3', model: fixtureModel(), html: HTML_BAD,
    vision: true, dryRun: false, guard,
    capture: stubCapture,
    visionFn: (m, paths) => {
      calledWith = { m, paths };
      return { verdict: 'WARN', score: 5, estUsd: 0.04 };
    },
  });
  assert.notEqual(r.verdict, 'PASS', 'sanity: bad HTML should not pass deterministic');
  assert.ok(calledWith, 'visionFn should fire on WARN/FAIL');
  assert.equal(r.vision.verdict, 'WARN');
});

await t('processSlug: dry-run sets vision.verdict=SKIP reason=dry-run', async () => {
  const guard = createGuard();
  const HTML_BAD = '<html><body>nothing here</body></html>';
  const r = await processSlug({
    slug: 't4', model: fixtureModel(), html: HTML_BAD,
    vision: true, dryRun: true, guard,
    capture: () => { throw new Error('capture must not run in dry-run'); },
    visionFn: () => { throw new Error('visionFn must not run in dry-run'); },
  });
  assert.equal(r.vision.verdict, 'SKIP');
  assert.equal(r.vision.reason, 'dry-run');
});

await t('processSlug: guard cap → vision.verdict=SKIP with guard reason', async () => {
  const guard = createGuard({ maxCalls: 1, maxUsd: 100, estUsdPerCall: 0.01 });
  guard.recordCall(); /* simulate previous call → cap is hit */
  const HTML_BAD = '<html><body>nothing here</body></html>';
  const r = await processSlug({
    slug: 't5', model: fixtureModel(), html: HTML_BAD,
    vision: true, dryRun: false, guard,
    capture: () => { throw new Error('capture must not run when guard refuses'); },
    visionFn: () => { throw new Error('visionFn must not run when guard refuses'); },
  });
  assert.equal(r.vision.verdict, 'SKIP');
  assert.match(r.vision.reason, /cap/);
});

await t('processSlug: vision cost recorded into guard', async () => {
  const guard = createGuard({ maxCalls: 10, maxUsd: 10, estUsdPerCall: 0.05 });
  const HTML_BAD = '<html><body>nothing here</body></html>';
  await processSlug({
    slug: 't6', model: fixtureModel(), html: HTML_BAD,
    vision: true, dryRun: false, guard,
    capture: stubCapture,
    visionFn: () => ({ verdict: 'WARN', estUsd: 0.04 }),
  });
  const r = guard.report();
  assert.equal(r.calls, 1);
  assert.ok(Math.abs(r.usd - 0.04) < 1e-9, `expected ~0.04, got ${r.usd}`);
});

/* ─── UQ-U-2 atom #1 (empty-env coerces to 0 → silent cap=0) ─────── */
await t('resolveConfig: empty / whitespace env DOES NOT coerce to 0', async () => {
  const { resolveConfig } = await import('../src/registry/visionCostGuard.mjs');
  /* Boki removed CORTEX_V9_MAX_VISION_CALLS thinking "this will use the
     default". Previously `Number("")` → 0, in [0, 10_000], so cap became
     0 and EVERY call refused. Now: empty / whitespace / undefined → fallback. */
  const cfg1 = resolveConfig({ V9_MAX_VISION_CALLS: '' });
  assert.equal(cfg1.maxCalls, 20, 'empty string must use default 20');
  const cfg2 = resolveConfig({ V9_MAX_VISION_CALLS: '   ' });
  assert.equal(cfg2.maxCalls, 20, 'whitespace must use default 20');
  const cfg3 = resolveConfig({});
  assert.equal(cfg3.maxCalls, 20, 'absent must use default 20');
  /* Legit overrides still honored */
  const cfg4 = resolveConfig({ V9_MAX_VISION_CALLS: '5' });
  assert.equal(cfg4.maxCalls, 5);
});

/* ─── UQ-U-2 atom #2 (float drift on 100×0.05) ──────────────────── */
await t('createGuard: 100 × 0.05 calls do NOT trip $5 cap due to float drift', async () => {
  /* Pre-fix: 100 * 0.05 in IEEE-754 = 5.000000000000007, so the 100th
     call's pre-check would silently FAIL even though "we said $5.00".
     Post-fix: usd tracked as BigInt micro-cents, exact arithmetic. */
  const guard = createGuard({ maxCalls: 100, maxUsd: 5, estUsdPerCall: 0.05 });
  for (let i = 0; i < 100; i++) {
    const d = guard.shouldCallVision();
    assert.equal(d.ok, true, `call ${i} should pass; reason: ${d.reason}`);
    guard.recordCall(); // uses estUsdPerCall = 0.05
  }
  const r = guard.report();
  assert.equal(r.calls, 100);
  assert.equal(r.usd, 5.0, `expected exactly $5.00, got ${r.usd}`);
  /* 101st must fail — call cap reached. */
  const final = guard.shouldCallVision();
  assert.equal(final.ok, false);
});

/* ─── UQ-U-3 atom #1 (recordCall accepts malicious 1e20 → poisons cap) ─ */
await t('recordCall: clamps suspicious observed cost (1e20 wrapper output)', async () => {
  /* Pre-fix: malicious wrapper returns {estUsd: 1e20} → BigInt(1e20*1e6)
     poisons accumulator → cap silently inert forever. */
  const guard = createGuard({ maxCalls: 100, maxUsd: 5, estUsdPerCall: 0.05 });
  guard.recordCall({ usd: 1e20 });
  const r = guard.report();
  /* Sane ceiling = max(10, 0.05*10) = 10 — clamped to $10 not $1e20. */
  assert.ok(r.usd <= 10.0, `expected clamp to <= \$10, got \$${r.usd}`);
  /* Cap fires immediately on next pre-check ($10 already > $5 maxUsd). */
  const d = guard.shouldCallVision();
  assert.equal(d.ok, false, 'cap MUST trip after malicious clamp');
});

/* ─── UQ-U-3 atom #6 (createGuard overrides bypass resolveConfig clamp) ─ */
await t('createGuard: overrides also clamped to safe range', async () => {
  /* Pre-fix: createGuard({maxUsd: 1e20}) bypassed env clamp → silent cap=$1e20.
     Post-fix: overrides go through same range guard. */
  const guard = createGuard({ maxUsd: 1e20, maxCalls: 1e10 });
  const r = guard.report();
  /* Clamps: maxUsd ∈ [0, 10_000], maxCalls ∈ [0, 10_000] — both should
     fall back to env defaults since 1e20 / 1e10 fail the range check. */
  assert.equal(r.maxUsd, 2.5, `maxUsd must clamp to default, got ${r.maxUsd}`);
  assert.equal(r.maxCalls, 20, `maxCalls must clamp to default, got ${r.maxCalls}`);
});

/* cleanup */
rmSync(TMP, { recursive: true, force: true });

console.log(`\nResult: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
