#!/usr/bin/env node
/**
 * tests/contracts/block-until-perfect.test.mjs
 *
 * BLOCK-1-e (Boki direktiva 2026-06-27) — "ja zelim da simulator radi sve
 * dok ne izadje sve savrseno za igru i ne izgradi se slot."
 *
 * Contract test za BLOCK-UNTIL-PERFECT gate. Pokriva:
 *
 *   1. Slug normalization (lowercase + dash-collapse + safe charset).
 *   2. Gate activation: env + model flag oba aktiviraju gate.
 *   3. Gate inactive default — postojeći build path netaknut.
 *   4. tryConvergencePass: missing receipt → ALLOWED=false.
 *   5. tryConvergencePass: FAIL receipt → ALLOWED=false.
 *   6. tryConvergencePass: PASS receipt out-of-band → ALLOWED=false (defense in depth).
 *   7. tryConvergencePass: valid PASS → ALLOWED=true.
 *   8. assertConvergencePass throws BuildGateError kad fail.
 *   9. enforceBuildGate: skipped kad gate inaktivan.
 *   10. enforceBuildGate: throws kad nema slug-a a gate aktivan.
 *   11. Block-until-perfect loop: PASS na tier 1 (immediate).
 *   12. Block-until-perfect loop: PASS na tier 3 (escalation).
 *   13. Block-until-perfect loop: NON_CONVERGENT kad tier exhaust.
 *   14. Diagnostic: konzistentno pozitivni deltas → "HIGH_PAY weight" hint.
 *   15. Diagnostic: konzistentno negativni deltas → "missing feature" hint.
 *   16. Diagnostic: sign-flip → "statistical noise" hint.
 *   17. Receipt: PASS produces writeable shape sa svim ključnim poljima.
 *   18. Tier ladder: monotono raste sa pravim spinovima per seed.
 *
 * Pure-in-process — koristi mock oracle iz par-sheet-block-until-perfect.mjs,
 * nema spawn-a subprocesa, nema mreže, nema Rust kernel-a. < 100ms wall.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import {
  assertConvergencePass,
  BuildGateError,
  enforceBuildGate,
  isGateActive,
  loadConvergenceReceipt,
  normalizeSlug,
  tryConvergencePass,
} from '../../src/blockBuildGate.mjs';

import {
  TIER_LADDER,
  diagnoseNonConvergence,
  runBlockUntilPerfect,
  writeReceipt,
} from '../../tools/par-sheet-block-until-perfect.mjs';

import { MATH_PRECISION_BAND_PP } from '../../src/registry/mathPrecision.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/* ─── Test scratch dir ─────────────────────────────────────────────── */

const SCRATCH = join(tmpdir(), `block-until-perfect-${process.pid}-${Date.now()}`);
const SCRATCH_RECEIPTS = join(SCRATCH, 'reports', 'par-block-until-perfect');
mkdirSync(SCRATCH_RECEIPTS, { recursive: true });

function writeMockReceipt(slug, payload) {
  const path = join(SCRATCH_RECEIPTS, `${slug}.json`);
  writeFileSync(path, JSON.stringify(payload, null, 2));
  return path;
}

let testCount = 0;
let failCount = 0;
function t(name, fn) {
  testCount++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failCount++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    if (process.env.DEBUG) console.log(err.stack);
  }
}

async function ta(name, fn) {
  testCount++;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failCount++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    if (process.env.DEBUG) console.log(err.stack);
  }
}

/* ─── env helpers ──────────────────────────────────────────────────── */

function withEnv(key, value, fn) {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

async function withEnvAsync(key, value, fn) {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

/* ─── Main ─────────────────────────────────────────────────────────── */

(async function main() {
  console.log('\nBLOCK-1-e · block-until-perfect contract test\n');

  /* 1. Slug normalization */
  t('1. normalizeSlug lowercase + dash-collapse + safe charset', () => {
    assert.equal(normalizeSlug('Cash Eruption'), 'cash-eruption');
    assert.equal(normalizeSlug('  Fort_Knox  '), 'fort-knox');
    assert.equal(normalizeSlug('Wrath of Olympus!'), 'wrath-of-olympus');
    assert.equal(normalizeSlug(''), '');
    assert.equal(normalizeSlug(null), '');
    assert.equal(normalizeSlug('---a--b---'), 'a-b');
  });

  /* 2. Gate activation */
  t('2. isGateActive: env=1 → true', () => {
    withEnv('SLOT_BUILD_REQUIRE_CONVERGENCE', '1', () => {
      assert.equal(isGateActive(), true);
    });
  });

  /* 3. Gate inactive default */
  t('3. isGateActive: env unset + no model flag → false', () => {
    withEnv('SLOT_BUILD_REQUIRE_CONVERGENCE', undefined, () => {
      assert.equal(isGateActive(), false);
      assert.equal(isGateActive({ name: 'x' }), false);
    });
  });

  t('3b. isGateActive: model.__require_convergence__=true → true', () => {
    withEnv('SLOT_BUILD_REQUIRE_CONVERGENCE', undefined, () => {
      assert.equal(isGateActive({ __require_convergence__: true }), true);
    });
  });

  /* 4. Missing receipt */
  t('4. tryConvergencePass: missing receipt → ALLOWED=false', () => {
    const r = tryConvergencePass('totally-nonexistent-slug-xyz', { repoRoot: SCRATCH });
    assert.equal(r.allowed, false);
    assert.match(r.reason, /no convergence receipt/);
  });

  /* 5. FAIL receipt */
  t('5. tryConvergencePass: FAIL verdict → ALLOWED=false', () => {
    writeMockReceipt('mock-fail', {
      slug: 'mock-fail',
      verdict: 'FAIL',
      buildAllowed: false,
      finalDeltaPP: 0.8,
      finalTier: '10B',
    });
    const r = tryConvergencePass('mock-fail', { repoRoot: SCRATCH });
    assert.equal(r.allowed, false);
    assert.match(r.reason, /FAIL/);
  });

  /* 6. PASS receipt but delta out of band (defense in depth) */
  t('6. tryConvergencePass: lying PASS receipt → defense rejects', () => {
    writeMockReceipt('mock-liar', {
      slug: 'mock-liar',
      verdict: 'PASS',
      buildAllowed: true,
      finalDeltaPP: 0.42,
      finalTier: '5M',
    });
    const r = tryConvergencePass('mock-liar', { repoRoot: SCRATCH });
    assert.equal(r.allowed, false);
    assert.match(r.reason, /defense-in-depth/);
  });

  /* 7. Valid PASS */
  t('7. tryConvergencePass: valid PASS → ALLOWED=true', () => {
    writeMockReceipt('mock-pass', {
      slug: 'mock-pass',
      verdict: 'PASS',
      buildAllowed: true,
      finalDeltaPP: 0.02,
      finalTier: '100M',
    });
    const r = tryConvergencePass('mock-pass', { repoRoot: SCRATCH });
    assert.equal(r.allowed, true);
    assert.match(r.reason, /converged/);
  });

  /* 8. assertConvergencePass throws BuildGateError */
  t('8. assertConvergencePass throws BuildGateError on FAIL', () => {
    assert.throws(
      () => assertConvergencePass('mock-fail', { repoRoot: SCRATCH }),
      (err) => err instanceof BuildGateError && err.code === 'CONVERGENCE_GATE_FAIL',
    );
  });

  /* 9. enforceBuildGate skipped kad inactive */
  t('9. enforceBuildGate: inactive → { allowed:true, skipped:true }', () => {
    withEnv('SLOT_BUILD_REQUIRE_CONVERGENCE', undefined, () => {
      const r = enforceBuildGate({ name: 'whatever', slug: 'whatever' });
      assert.equal(r.allowed, true);
      assert.equal(r.skipped, true);
    });
  });

  /* 10. enforceBuildGate throws when no slug derivable */
  t('10. enforceBuildGate: active + no slug → throws', () => {
    withEnv('SLOT_BUILD_REQUIRE_CONVERGENCE', '1', () => {
      assert.throws(
        () => enforceBuildGate({}),
        (err) => err instanceof BuildGateError,
      );
    });
  });

  /* 11. Loop: PASS on tier 1 (immediate) */
  await ta('11. runBlockUntilPerfect: PASS on tier 1 (immediate)', async () => {
    /* Mock oracle koji odmah PASS-uje. */
    const oracle = async (slug, i, tier) => ({
      tier: tier.label,
      spins: tier.spins * tier.seeds,
      declaredPct: 96.5,
      measuredPct: 96.52,
      deltaPP: 0.02,
      wilsonHalfPP: 0.5,
      verdict: 'PASS',
      reason: 'mock immediate pass',
      walltimeMs: 1,
    });
    const result = await runBlockUntilPerfect({
      slug: 'mock-immediate',
      oracle,
      maxTierLabel: '10B',
      autoTune: false,
    });
    assert.equal(result.verdict, 'PASS');
    assert.equal(result.buildAllowed, true);
    assert.equal(result.iterations.length, 1);
    assert.equal(result.finalTier, '5M');
  });

  /* 12. Loop: PASS on tier 3 (escalation) */
  await ta('12. runBlockUntilPerfect: PASS on tier 3 (escalation)', async () => {
    let calls = 0;
    const oracle = async (slug, i, tier) => {
      calls++;
      const passing = i >= 2;
      const delta = passing ? 0.03 : 0.5 - i * 0.1;
      return {
        tier: tier.label,
        spins: tier.spins * tier.seeds,
        declaredPct: 96.5,
        measuredPct: 96.5 + delta,
        deltaPP: delta,
        wilsonHalfPP: passing ? 0.4 : 5.0,
        verdict: passing ? 'PASS' : 'FAIL',
        reason: passing ? 'mock tier3 pass' : 'mock not yet',
        walltimeMs: 1,
      };
    };
    const result = await runBlockUntilPerfect({
      slug: 'mock-escalate',
      oracle,
      maxTierLabel: '10B',
      autoTune: false,
    });
    assert.equal(result.verdict, 'PASS');
    assert.equal(result.buildAllowed, true);
    assert.equal(result.iterations.length, 3);
    assert.equal(result.finalTier, '100M');
    assert.equal(calls, 3);
  });

  /* 13. Loop: NON_CONVERGENT */
  await ta('13. runBlockUntilPerfect: NON_CONVERGENT terminal', async () => {
    const oracle = async (slug, i, tier) => ({
      tier: tier.label,
      spins: tier.spins * tier.seeds,
      declaredPct: 96.5,
      measuredPct: 97.5,
      deltaPP: 1.0,
      wilsonHalfPP: 0.5,
      verdict: 'FAIL',
      reason: 'mock never converges',
      walltimeMs: 1,
    });
    const result = await runBlockUntilPerfect({
      slug: 'mock-non-conv',
      oracle,
      maxTierLabel: '50M',  /* 2 tiers only */
      autoTune: false,
    });
    assert.equal(result.verdict, 'NON_CONVERGENT');
    assert.equal(result.buildAllowed, false);
    assert.equal(result.iterations.length, 2);
    assert.ok(result.diagnosis);
  });

  /* 14. Diagnostic: positive deltas */
  t('14. diagnoseNonConvergence: all positive → HIGH_PAY hint', () => {
    const iter = [
      { deltaPP: 0.3 }, { deltaPP: 0.25 }, { deltaPP: 0.2 },
    ];
    const d = diagnoseNonConvergence(iter);
    assert.match(d.hint, /IZNAD declared|HIGH_PAY/);
  });

  /* 15. Diagnostic: negative deltas */
  t('15. diagnoseNonConvergence: all negative → missing feature', () => {
    const iter = [
      { deltaPP: -0.4 }, { deltaPP: -0.3 }, { deltaPP: -0.2 },
    ];
    const d = diagnoseNonConvergence(iter);
    assert.match(d.hint, /ISPOD declared|feature/);
  });

  /* 16. Diagnostic: sign flip */
  t('16. diagnoseNonConvergence: sign flip → noise hint', () => {
    const iter = [
      { deltaPP: 0.3 }, { deltaPP: -0.25 }, { deltaPP: 0.1 },
    ];
    const d = diagnoseNonConvergence(iter);
    assert.match(d.hint, /noise|znak/);
  });

  /* 17. Receipt shape */
  t('17. writeReceipt produces all key fields', () => {
    const result = {
      verdict: 'PASS',
      finalTier: '5M',
      finalDeltaPP: 0.03,
      iterations: [{ tier: '5M', deltaPP: 0.03, verdict: 'PASS' }],
      buildAllowed: true,
      terminalReason: 'mock pass',
    };
    /* writeReceipt uses real OUT_DIR; we just verify the in-memory shape
     * by calling it and reading back. To avoid polluting reports/, we
     * write into scratch via env trick: writeReceipt writes to repo-
     * relative OUT_DIR. Instead, just smoke-call it and verify the
     * receipt was written. */
    const receipt = writeReceipt('mock-receipt-shape-test', result);
    assert.ok(receipt.slug);
    assert.equal(receipt.verdict, 'PASS');
    assert.equal(receipt.buildAllowed, true);
    assert.ok(receipt.band);
    assert.equal(receipt.band.pp, MATH_PRECISION_BAND_PP);
    assert.ok(receipt.generatedAt);
    assert.ok(receipt.receiptPath);
    /* Clean up */
    try { rmSync(receipt.receiptPath); } catch (_) {}
  });

  /* 18. Tier ladder monotonic */
  t('18. TIER_LADDER monotonic + correct seed structure', () => {
    assert.ok(TIER_LADDER.length >= 7, 'ladder has ≥ 7 tiers');
    for (let i = 1; i < TIER_LADDER.length; i++) {
      assert.ok(
        TIER_LADDER[i].spins > TIER_LADDER[i - 1].spins,
        `tier ${i} spins (${TIER_LADDER[i].spins}) must exceed prev (${TIER_LADDER[i - 1].spins})`,
      );
    }
    /* First tier is 5M */
    assert.equal(TIER_LADDER[0].label, '5M');
    assert.equal(TIER_LADDER[0].spins, 5_000_000);
    /* Last tier is 10B */
    assert.equal(TIER_LADDER[TIER_LADDER.length - 1].label, '10B');
    assert.equal(TIER_LADDER[TIER_LADDER.length - 1].spins, 10_000_000_000);
    /* All seeds = 4 */
    for (const tier of TIER_LADDER) assert.equal(tier.seeds, 4);
  });

  /* ─── Cleanup ─────────────────────────────────────────────────── */
  try { rmSync(SCRATCH, { recursive: true, force: true }); } catch (_) {}

  console.log(`\n${testCount - failCount}/${testCount} PASS`);
  if (failCount > 0) {
    console.log(`✗ ${failCount} FAIL`);
    process.exit(1);
  }
  console.log('✓ contract green');
})().catch((err) => {
  console.error('fatal:', err.stack || err.message);
  process.exit(1);
});
