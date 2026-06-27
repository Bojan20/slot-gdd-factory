#!/usr/bin/env node
/**
 * tests/contracts/ultimate-sweep.test.mjs
 *
 * Ultimate sweep contract test (Boki 2026-06-27 "nastavi do kraja
 * ultimativno") — single batched runner for the three atoms that
 * landed in this wave so verify gate runs them in one Node process
 * instead of three:
 *
 *   1. F3-b  Per-GDD compliance scorecard
 *   2. F4-a  Adversarial fuzz (1000-perm parser harness)
 *   3. PAR-14-I-FULL  Real sweep engine (synthetic-oracle contract)
 *
 * Each block is a self-contained assert block; first failure short-
 * circuits with non-zero exit so the verify-gate step lights up red.
 *
 * # COST
 *
 *   F3-b baseline pass    ≈ 1 s   (5 baselines × 4 walkers)
 *   F4-a 200-iter smoke  ≈ 0.5 s (full 1000-iter runs in CI cron)
 *   PAR-14-I-FULL smoke  ≈ 0.01 s (synthetic oracle, no I/O)
 *
 *   Total ≈ 1.5 s — fits pre-commit budget without blowing the gate.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scoreSlug, gradeFor, gddMatrixSignal } from '../../tools/f3-b-per-gdd-scorecard.mjs';
import { mulberry32, MUTATORS, pickSeedCorpus } from '../../tools/f4-a-adversarial-fuzz.mjs';
import {
  sweepAxis,
  makeSyntheticOracle,
  PRECISION_BAND,
  WILSON_LOCK_PP,
} from '../../tools/_par-sheet-sweep-engine.mjs';
import { renderSummary as renderPrSummary } from '../../tools/_verify-pr-summary.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

console.log('\n=== Ultimate Sweep Contract (F3-b + F4-a + PAR-14-I-FULL) ===\n');

/* ─────────────────────────────────────────────────────────────────────── */
/* PAR-14-I-FULL · pure sweep engine math (no I/O)                         */
/* ─────────────────────────────────────────────────────────────────────── */

t('PAR-14-I-FULL · sweepAxis converges on monotone synthetic oracle', () => {
  const oracle = makeSyntheticOracle({ baseRtp: 0.85, x0: 2.5, slope: 0.03, noise: 0.5 });
  const r = sweepAxis({
    slug: 'smoke',
    axis: 'wild_expand.factor',
    domain: [0, 5],
    declared: 0.85,
    oracle,
  });
  assert.equal(r.locked, true, 'sweep must lock within maxSteps');
  assert(Math.abs(r.lockedValue - 2.5) < 0.1, `locked value ${r.lockedValue} far from oracle root 2.5`);
  assert(r.finalDelta <= PRECISION_BAND, `finalDelta ${r.finalDelta} > ${PRECISION_BAND} band`);
  assert(r.finalWilson99HalfWidthPp <= WILSON_LOCK_PP, 'wilson half-width too wide');
  assert(r.history.length >= 1, 'sweep must record per-step receipts');
});

t('PAR-14-I-FULL · sweepAxis honors maxSteps when oracle is non-convergent', () => {
  /* Pathological oracle: returns constant huge delta. Sweep must NOT
   * lock and must stop at maxSteps. */
  const oracle = () => ({ measured: 0.50, wilson99HalfWidthPp: 0.5 });
  const r = sweepAxis({
    slug: 'smoke',
    axis: 'x',
    domain: [0, 10],
    declared: 0.85,
    oracle,
    maxSteps: 5,
  });
  assert.equal(r.locked, false);
  assert.equal(r.steps, 5);
});

t('PAR-14-I-FULL · sweepAxis rejects degenerate domain', () => {
  assert.throws(() => sweepAxis({
    slug: 's', axis: 'x', domain: [5, 5], declared: 0.85,
    oracle: () => ({ measured: 0.85, wilson99HalfWidthPp: 0 }),
  }), /bad domain/);
  assert.throws(() => sweepAxis({
    slug: 's', axis: 'x', domain: [5, 1], declared: 0.85,
    oracle: () => ({ measured: 0.85, wilson99HalfWidthPp: 0 }),
  }), /bad domain/);
});

t('PAR-14-I-FULL · WILSON + PRECISION constants are regulator-band', () => {
  /* If anyone loosens these, an entire band of "good enough" math
   * regressions could land silently. Pin to the values agreed with
   * Boki in MASTER_TODO sekcija A — ±0.05 pp regulator grade. */
  assert.equal(PRECISION_BAND, 0.0005);
  assert.equal(WILSON_LOCK_PP, 0.001);
});

/* ─────────────────────────────────────────────────────────────────────── */
/* F3-b · grade ladder + scoreSlug contract                                */
/* ─────────────────────────────────────────────────────────────────────── */

t('F3-b · gradeFor matrix is monotone (more violations → lower grade)', () => {
  /* A+ requires perfect with high coverage. Grade should never INCREASE
   * as either hard or soft violations climb. */
  const grades = ['A+', 'A', 'B', 'C', 'D', 'F'];
  const rank = (g) => grades.indexOf(g);
  /* Sweep hard 0..5 at fixed soft=0 cov=95 — grade must be monotone
   * non-increasing. */
  let last = -1;
  for (let h = 0; h <= 5; h++) {
    const g = gradeFor(h, 0, 95);
    const r = rank(g);
    assert(r >= last, `gradeFor(h=${h}, soft=0, cov=95) → ${g}: not monotone (${last}→${r})`);
    last = r;
  }
  /* Sweep soft 0..15 at fixed hard=0 cov=95 — same. */
  last = -1;
  for (let s = 0; s <= 15; s++) {
    const g = gradeFor(0, s, 95);
    const r = rank(g);
    assert(r >= last, `gradeFor(0, s=${s}, 95) → ${g}: not monotone (${last}→${r})`);
    last = r;
  }
});

t('F3-b · gradeFor coverage threshold gates A+/A/B', () => {
  /* Same violations, lower coverage → lower grade. */
  assert.equal(gradeFor(0, 0, 95), 'A+');
  assert.equal(gradeFor(0, 0, 85), 'A');
  assert.equal(gradeFor(0, 0, 75), 'B');
  assert.equal(gradeFor(0, 0, 60), 'C');
});

t('F3-b · gradeFor coverage-blind (null) keeps grade purely violation-driven', () => {
  /* Synthetic / corpora w/o __declared signal should still get a fair
   * grade; coverage null = no penalty. */
  assert.equal(gradeFor(0, 0, null), 'A+');
  assert.equal(gradeFor(0, 2, null), 'A');
  assert.equal(gradeFor(0, 5, null), 'B');
});

t('F3-b · gddMatrixSignal returns expected shape for a known slug', () => {
  const slug = 'cash-eruption-foundry-gdd';
  const dir = join(REPO, 'dist', 'real-games', slug);
  if (!existsSync(dir)) {
    console.log(`    skip — ${slug} not built`);
    return;
  }
  const sig = gddMatrixSignal(slug);
  assert(sig !== null, 'signal must not be null for known slug');
  assert(typeof sig.declaredKeys === 'number');
  assert(typeof sig.inferredKeys === 'number');
  assert(typeof sig.activeFeatures === 'number');
  /* coveragePct should be 0..100 when totalKeys > 0. */
  if (sig.coveragePct !== null) {
    assert(sig.coveragePct >= 0 && sig.coveragePct <= 100,
      `coverage ${sig.coveragePct} out of [0,100]`);
  }
});

t('F3-b · scoreSlug end-to-end produces valid grade for one baseline', () => {
  const slug = 'cash-eruption-foundry-gdd';
  if (!existsSync(join(REPO, 'dist', 'real-games', slug))) {
    console.log(`    skip — ${slug} not built`);
    return;
  }
  const card = scoreSlug(slug);
  assert.equal(card.slug, slug);
  assert(typeof card.totalHardHits === 'number');
  assert(typeof card.totalSoftHits === 'number');
  assert(['A+', 'A', 'B', 'C', 'D', 'F'].includes(card.grade), `bad grade ${card.grade}`);
  assert(typeof card.cleanPct === 'number' && card.cleanPct >= 0 && card.cleanPct <= 100);
  assert(card.breakdown && card.breakdown.v10 && card.breakdown.v11 && card.breakdown.v12 && card.breakdown.v14,
    'breakdown missing one of v10/v11/v12/v14');
});

/* ─────────────────────────────────────────────────────────────────────── */
/* F4-a · mutator family + corpus seed contract                            */
/* ─────────────────────────────────────────────────────────────────────── */

t('F4-a · 6 mutator families exposed', () => {
  const names = MUTATORS.map((m) => m.name).sort();
  assert.deepEqual(names, [
    'duplicate', 'interleave_garbage', 'proto_pollution',
    'table_shuffle', 'truncate', 'unicode_attack',
  ]);
});

t('F4-a · mulberry32 is deterministic for fixed seed', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 10; i++) assert.equal(a(), b());
});

t('F4-a · pickSeedCorpus returns ≥ 1 non-empty GDD', () => {
  const corpus = pickSeedCorpus();
  assert(corpus.length >= 1, 'corpus must have ≥ 1 GDD');
  for (const seed of corpus) {
    assert(typeof seed.name === 'string' && seed.name.length > 0);
    assert(typeof seed.text === 'string' && seed.text.length > 500);
  }
});

t('F4-a · mutators do not throw on tiny + huge inputs', () => {
  const rnd = mulberry32(123);
  const tiny = '# Tiny GDD\n\n| a | b |\n| - | - |\n| 1 | 2 |\n';
  const huge = '# Huge GDD\n\n' + 'x'.repeat(100_000);
  for (const m of MUTATORS) {
    /* Each mutator must accept both ends of the size spectrum. */
    assert.doesNotThrow(() => m.fn(rnd, tiny), `${m.name} threw on tiny`);
    assert.doesNotThrow(() => m.fn(rnd, huge), `${m.name} threw on huge`);
  }
});

t('F4-a · CLI smoke (50 iter, seed 7) exits 0 with passRate ≥ 99 %', () => {
  /* Runs the CLI as a child process for true end-to-end verification.
   * 50 iter keeps test wallclock < 1 s on local Chromium-free machines. */
  const r = spawnSync('node', [
    join(REPO, 'tools', 'f4-a-adversarial-fuzz.mjs'),
    '--iter', '50',
    '--seed', '7',
    '--json',
  ], { cwd: REPO, encoding: 'utf-8' });
  assert.equal(r.status, 0, `fuzz exit ${r.status}: ${r.stderr.slice(0, 200)}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert(out.summary.passRate >= 99.0, `passRate ${out.summary.passRate} < 99`);
  assert.equal(out.summary.crashes, 0);
  assert.equal(out.summary.timeouts, 0);
  assert.equal(out.summary.polluted, 0);
});

/* ─────────────────────────────────────────────────────────────────────── */
/* F5-c · verify-pr-summary renderer                                       */
/* ─────────────────────────────────────────────────────────────────────── */

t('F5-c · renderSummary handles all-pass input', () => {
  const verify = {
    runAt: '2026-06-27T18:00:00Z',
    overall: 'pass',
    results: [
      { label: 'step A', ok: true, exit: 0, durationS: 0.5 },
      { label: 'step B', ok: true, exit: 0, durationS: 1.2 },
    ],
  };
  const md = renderPrSummary(verify);
  assert(md.includes('## ✅ verify gate · PASS'));
  assert(md.includes('| total steps | 2 |'));
  assert(md.includes('| ✅ passed   | 2 |'));
  assert(md.includes('| ❌ failed   | 0 |'));
  assert(!md.includes('### ❌ failed steps'));
});

t('F5-c · renderSummary surfaces failed step with tails', () => {
  const verify = {
    runAt: '2026-06-27T18:00:00Z',
    overall: 'fail',
    results: [
      { label: 'step A', ok: true, exit: 0, durationS: 0.5 },
      { label: 'step BAD', ok: false, exit: 1, durationS: 2.0,
        stderr: 'line1\nline2\nERROR DEEP\nfatal',
        stdout: 'progress 1\nprogress 2' },
    ],
  };
  const md = renderPrSummary(verify);
  assert(md.includes('## ❌ verify gate · FAIL'));
  assert(md.includes('### ❌ failed steps'));
  assert(md.includes('`step BAD`'));
  assert(md.includes('ERROR DEEP'));
  assert(md.includes('progress 1'));
});

t('F5-c · renderSummary classifies skipped steps separately', () => {
  const verify = {
    overall: 'pass',
    results: [
      { label: 'step A', ok: true, exit: 0, durationS: 0.1 },
      { label: 'step SKIP', ok: false, exit: -1, durationS: 0, skipped: true,
        stderr: 'SKIPPED — dependency failed' },
    ],
  };
  const md = renderPrSummary(verify);
  assert(md.includes('| ⏭ skipped   | 1 |'));
  assert(md.includes('| ❌ failed   | 0 |'),
    'skipped must not count toward failed');
});

t('F5-c · renderSummary escapes pipe characters in step labels', () => {
  const verify = {
    overall: 'pass',
    results: [{ label: 'foo | bar', ok: true, exit: 0, durationS: 0.1 }],
  };
  const md = renderPrSummary(verify);
  assert(md.includes('foo \\| bar'), 'pipe must be backslash-escaped to keep tables valid');
});

t('F5-c · renderSummary tags itself for marker-based PR comment updates', () => {
  const md = renderPrSummary({ overall: 'pass', results: [] });
  assert(md.includes('tools/_verify-pr-summary.mjs'),
    'footer must self-identify so reviewers know which tool produced the comment');
});

/* ─────────────────────────────────────────────────────────────────────── */
/* Summary                                                                 */
/* ─────────────────────────────────────────────────────────────────────── */

console.log(`\nResult: ${passed} passed · ${failed} failed`);
if (failed > 0) process.exit(1);
