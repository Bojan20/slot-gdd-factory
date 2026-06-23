#!/usr/bin/env node
/**
 * tests/contracts/audit-summary.test.mjs
 *
 * Verifies tools/audit-summary.mjs:
 *   - buildAuditSummary() aggregates all 4 sections (coverage, matrix,
 *     portfolio, verdict) into one rollup
 *   - overallVerdict ladder: GREEN (all converged + full coverage),
 *     AMBER (close/unknown/partial), RED (any DIVERGED)
 *   - renderAuditSummary emits 4 numbered sections + verdict banner
 *   - All 5 baselines produce ok coverage rows
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildAuditSummary, renderAuditSummary,
} from '../../tools/audit-summary.mjs';

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

console.log('AUDIT SUMMARY contract · test suite');

test('buildAuditSummary returns expected top-level shape', async () => {
  const s = await buildAuditSummary(BASELINES);
  assert(typeof s.generatedAt === 'string', 'generatedAt string');
  assert(s.tool === 'tools/audit-summary.mjs', 'tool name');
  assert(Array.isArray(s.slugs), 'slugs array');
  assert(['GREEN', 'AMBER', 'RED'].includes(s.overallVerdict),
    `overallVerdict ladder, got ${s.overallVerdict}`);
  assert(typeof s.sections === 'object', 'sections object');
});

test('Section 1 (coverage) has all required fields', async () => {
  const s = await buildAuditSummary(BASELINES);
  const c = s.sections.coverage;
  assert(c.label === 'PER-GAME KERNEL COVERAGE', 'label');
  assert(c.gamesWalked === 5, `5 walked, got ${c.gamesWalked}`);
  assert(c.gamesOk === 5, `5 ok, got ${c.gamesOk}`);
  assert(c.totalKernelsApplicable > 0, 'kernels applicable > 0');
  assert(c.totalKernelsOk > 0, 'kernels ok > 0');
  assert(Array.isArray(c.perGame), 'perGame array');
});

test('Section 2 (matrix) has all required fields', async () => {
  const s = await buildAuditSummary(BASELINES);
  const m = s.sections.matrix;
  assert(m.label === 'KERNEL APPLICABILITY MATRIX', 'label');
  assert(m.games === 5, `5 games, got ${m.games}`);
  assert(m.kernels === 22, `22 kernels, got ${m.kernels}`);
  assert(Array.isArray(m.universalKernels), 'universal array');
  assert(Array.isArray(m.dormantKernels), 'dormant array');
  assert(m.totalApplications > 0, 'applications > 0');
});

test('Section 3 (portfolio) has all required fields', async () => {
  const s = await buildAuditSummary(BASELINES);
  const p = s.sections.portfolio;
  assert(p.label === 'PORTFOLIO REPORT', 'label');
  assert(p.games === 5, `5 games, got ${p.games}`);
  assert(p.gamesOk === 5, `5 ok, got ${p.gamesOk}`);
  assert(Number.isFinite(p.avgDeclaredRTP), 'avgDeclaredRTP number');
  assert(typeof p.topologies === 'object', 'topologies object');
});

test('Section 4 (verdict) is ok and reports portfolio verdict', async () => {
  const s = await buildAuditSummary(BASELINES);
  const v = s.sections.verdict;
  assert(v.label === 'DECLARED-VS-MEASURED AUDIT', 'label');
  if (v.ok) {
    assert(typeof v.portfolioVerdict === 'string', 'portfolioVerdict string');
    assert(['CONVERGED', 'CLOSE', 'DIVERGED', 'UNKNOWN'].includes(v.portfolioVerdict),
      `verdict ladder, got ${v.portfolioVerdict}`);
    assert(Array.isArray(v.rows), 'rows array');
  } else {
    /* If no cross-game report present, verdict.ok=false is acceptable. */
    assert(typeof v.error === 'string', 'error message present');
  }
});

test('Overall verdict GREEN only when all sections clean', async () => {
  const s = await buildAuditSummary(BASELINES);
  const v = s.sections.verdict;
  if (s.overallVerdict === 'GREEN') {
    /* GREEN requires: 100% coverage + verdict ok + portfolioVerdict=CONVERGED. */
    assert(s.sections.coverage.gamesOk === s.sections.coverage.gamesWalked,
      'GREEN should have 100% coverage');
    assert(v.ok === true, 'GREEN should have verdict section ok');
    assert(v.portfolioVerdict === 'CONVERGED',
      `GREEN requires CONVERGED, got ${v.portfolioVerdict}`);
  }
  if (s.overallVerdict === 'RED') {
    /* RED requires: verdict ok + DIVERGED. */
    assert(v.ok === true && v.portfolioVerdict === 'DIVERGED',
      'RED only when DIVERGED');
  }
});

test('renderAuditSummary emits 4 numbered sections + verdict banner', async () => {
  const s = await buildAuditSummary(BASELINES);
  const out = renderAuditSummary(s);
  assert(typeof out === 'string', 'output is string');
  assert(out.includes('TOTAL AUDIT ROLLUP'), 'has banner');
  assert(out.includes('overall verdict'), 'has verdict line');
  assert(out.includes('[1]'), 'section 1');
  assert(out.includes('[2]'), 'section 2');
  assert(out.includes('[3]'), 'section 3');
  assert(out.includes('[4]'), 'section 4');
  assert(out.includes('PER-GAME KERNEL COVERAGE'), 'coverage label');
  assert(out.includes('KERNEL APPLICABILITY MATRIX'), 'matrix label');
  assert(out.includes('PORTFOLIO REPORT'), 'portfolio label');
  assert(out.includes('DECLARED-VS-MEASURED AUDIT'), 'verdict label');
});

test('All 5 baselines walk successfully in summary', async () => {
  const s = await buildAuditSummary(BASELINES);
  for (const row of s.sections.coverage.perGame) {
    assert(row.ok === true, `${row.slug} should be ok`);
    assert(row.kernelsOk > 0, `${row.slug} kernelsOk > 0`);
  }
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
