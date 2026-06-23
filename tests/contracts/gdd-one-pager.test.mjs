#!/usr/bin/env node
/**
 * tests/contracts/gdd-one-pager.test.mjs
 *
 * N1 (2026-06-23) — Per-game compliance one-pager contract.
 *
 * Verifies tools/gdd-one-pager.mjs:
 *   - buildOnePager(slug) returns expected shape
 *   - All 5 baselines produce ok one-pagers
 *   - renderMarkdown emits all 6 sections + verdict modes
 *   - Convergence section shows both operator + honest verdicts
 *   - Synthetic-RTP games include the audit-only warning
 *   - Error rows render gracefully
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildOnePager, renderMarkdown,
} from '../../tools/gdd-one-pager.mjs';

let passed = 0, failed = 0;
const pending = [];
function test(name, fn) {
  const p = (async () => {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
  })();
  pending.push(p);
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const BASELINES = [
  'cash-eruption-foundry-gdd',
  'huff-n-more-puff-gdd',
  'starlight-travellers-gdd',
  'wrath-of-olympus-gdd',
  'gates-of-olympus-1000-gdd',
];

console.log('GDD ONE-PAGER contract · test suite');

test('buildOnePager returns expected top-level shape', async () => {
  const r = await buildOnePager('starlight-travellers-gdd');
  assert(r.ok === true, 'ok');
  assert(r.slug === 'starlight-travellers-gdd', 'slug');
  assert(typeof r.generatedAt === 'string', 'generatedAt');
  assert(typeof r.basics === 'object', 'basics object');
  assert(typeof r.symbols === 'object', 'symbols object');
  assert(Array.isArray(r.features), 'features array');
  assert(typeof r.kernels === 'object', 'kernels object');
  assert(typeof r.convergence === 'object', 'convergence object');
  assert(typeof r.compliance === 'object', 'compliance object');
});

test('All 5 baselines produce ok one-pagers', async () => {
  for (const slug of BASELINES) {
    const r = await buildOnePager(slug);
    assert(r.ok === true, `${slug} should be ok, got: ${r.error}`);
    assert(r.basics.topology !== 'unknown' || slug === 'wrath-of-olympus-gdd',
      `${slug} should have known topology`);
  }
});

test('starlight basics include cluster topology + 92.5% declared', async () => {
  const r = await buildOnePager('starlight-travellers-gdd');
  assert(r.basics.topology === 'cluster', `topology cluster, got ${r.basics.topology}`);
  assert(r.basics.declaredRTP === 92.5, `92.5%, got ${r.basics.declaredRTP}`);
});

test('Kernel coverage shows top 3 sorted desc by rtpContribution', async () => {
  const r = await buildOnePager('starlight-travellers-gdd');
  assert(r.kernels.applicable > 0, 'applicable > 0');
  assert(r.kernels.ok > 0, 'ok > 0');
  assert(r.kernels.top3.length <= 3, 'top3 cap');
  for (let i = 1; i < r.kernels.top3.length; i++) {
    assert(r.kernels.top3[i - 1].rtpContribution >= r.kernels.top3[i].rtpContribution,
      `top kernels desc sorted at idx ${i}`);
  }
  /* cluster_pays should be top for starlight. */
  assert(r.kernels.top3[0].name === 'cluster_pays',
    `starlight top should be cluster_pays, got ${r.kernels.top3[0].name}`);
});

test('Convergence section has both operator + honest verdicts', async () => {
  const r = await buildOnePager('starlight-travellers-gdd');
  assert(typeof r.convergence.verdict === 'string', 'operator verdict');
  assert(typeof r.convergence.honestVerdict === 'string', 'honest verdict');
  assert(['CONVERGED','CLOSE','DIVERGED','NON_BINDING','UNKNOWN']
    .includes(r.convergence.verdict), `verdict ladder, got ${r.convergence.verdict}`);
  assert(['CONVERGED','CLOSE','DIVERGED','NON_BINDING','UNKNOWN']
    .includes(r.convergence.honestVerdict), `honest ladder, got ${r.convergence.honestVerdict}`);
});

test('renderMarkdown emits all 6 sections', async () => {
  const r = await buildOnePager('starlight-travellers-gdd');
  const md = renderMarkdown(r);
  assert(typeof md === 'string', 'md is string');
  assert(md.includes('## 1. Game basics'), 'section 1');
  assert(md.includes('## 2. Symbols'), 'section 2');
  assert(md.includes('## 3. Features'), 'section 3');
  assert(md.includes('## 4. Math kernel coverage'), 'section 4');
  assert(md.includes('## 5. RTP convergence'), 'section 5');
  assert(md.includes('## 6. Compliance'), 'section 6');
  assert(md.includes('Operator (clamp-aware)'), 'operator row');
  assert(md.includes('Honest (pre-clamp)'), 'honest row');
});

test('Wrath one-pager flags synthetic-RTP warning', async () => {
  const r = await buildOnePager('wrath-of-olympus-gdd');
  assert(r.ok === true, 'ok');
  /* Wrath PDF lacks explicit RTP — should be flagged synthetic. */
  if (r.convergence.isSynthetic) {
    const md = renderMarkdown(r);
    assert(md.includes('audit-only') || md.includes('synthetic-fallback'),
      'should mention synthetic-fallback');
  }
});

test('Error one-pager renders MD with error block', async () => {
  const r = await buildOnePager('nonexistent-slug-xyz');
  assert(r.ok === false, 'ok=false');
  const md = renderMarkdown(r);
  assert(md.includes('ERROR'), 'error header');
  assert(md.includes('nonexistent-slug-xyz'), 'slug in error');
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
