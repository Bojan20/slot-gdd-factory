#!/usr/bin/env node
/**
 * tests/contracts/declared-vs-measured-audit.test.mjs
 *
 * Verifies tools/declared-vs-measured-audit.mjs:
 *   - classify() returns correct verdict per ΔRTP magnitude
 *   - buildAudit() yields rows + verdictCounts + portfolioVerdict
 *   - portfolioVerdict escalates DIVERGED > CLOSE > UNKNOWN > CONVERGED
 *   - renderAudit emits ASCII with verdict ladder, columns, summary
 *   - findLatestReport returns most-recent cross-game JSON (if exists)
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync, rmSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  buildAudit, renderAudit, classify, findLatestReport,
} from '../../tools/declared-vs-measured-audit.mjs';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('DECLARED-VS-MEASURED AUDIT contract · test suite');

test('classify returns CONVERGED for ΔRTP <= 0.5pp', () => {
  assert(classify(0) === 'CONVERGED', '0 → CONVERGED');
  assert(classify(0.3) === 'CONVERGED', '0.3 → CONVERGED');
  assert(classify(-0.5) === 'CONVERGED', '-0.5 → CONVERGED');
});

test('classify returns CLOSE for 0.5pp < ΔRTP <= 2pp', () => {
  assert(classify(0.51) === 'CLOSE', '0.51 → CLOSE');
  assert(classify(1.5) === 'CLOSE', '1.5 → CLOSE');
  assert(classify(-2.0) === 'CLOSE', '-2.0 → CLOSE');
});

test('classify returns DIVERGED for ΔRTP > 2pp', () => {
  assert(classify(2.1) === 'DIVERGED', '2.1 → DIVERGED');
  assert(classify(10) === 'DIVERGED', '10 → DIVERGED');
  assert(classify(-5) === 'DIVERGED', '-5 → DIVERGED');
});

test('classify returns UNKNOWN for null/undefined/NaN', () => {
  assert(classify(null) === 'UNKNOWN', 'null → UNKNOWN');
  assert(classify(undefined) === 'UNKNOWN', 'undefined → UNKNOWN');
  assert(classify(NaN) === 'UNKNOWN', 'NaN → UNKNOWN');
});

test('buildAudit returns expected shape', () => {
  const payload = {
    games: [
      { slug: 'g1', ok: true, topology: '5x3', declaredRTP: 96, measuredRTP: 96, rtpDelta: 0 },
      { slug: 'g2', ok: true, topology: 'cluster', declaredRTP: 92, measuredRTP: 93, rtpDelta: 1 },
      { slug: 'g3', ok: true, topology: '6x5', declaredRTP: 96, measuredRTP: 90, rtpDelta: -6 },
    ],
  };
  const a = buildAudit(payload, 'test.json');
  assert(a.rows.length === 3, '3 rows');
  assert(a.rows[0].verdict === 'CONVERGED', 'g1 → CONVERGED');
  assert(a.rows[1].verdict === 'CLOSE', 'g2 → CLOSE');
  assert(a.rows[2].verdict === 'DIVERGED', 'g3 → DIVERGED');
  assert(a.verdictCounts.CONVERGED === 1, '1 converged');
  assert(a.verdictCounts.CLOSE === 1, '1 close');
  assert(a.verdictCounts.DIVERGED === 1, '1 diverged');
});

test('portfolioVerdict escalates DIVERGED > CLOSE > UNKNOWN > CONVERGED', () => {
  const all = (verdict) => ({
    games: [{ slug: 's', ok: true, declaredRTP: 96, measuredRTP: 96, rtpDelta:
      verdict === 'CONVERGED' ? 0 :
      verdict === 'CLOSE' ? 1 :
      verdict === 'DIVERGED' ? 5 : null }],
  });
  assert(buildAudit(all('CONVERGED')).portfolioVerdict === 'CONVERGED', 'all converged');
  assert(buildAudit(all('CLOSE')).portfolioVerdict === 'CLOSE', 'all close');
  assert(buildAudit(all('DIVERGED')).portfolioVerdict === 'DIVERGED', 'all diverged');
  const mixed = {
    games: [
      { slug: 'a', ok: true, rtpDelta: 0 },
      { slug: 'b', ok: true, rtpDelta: 5 },
    ],
  };
  assert(buildAudit(mixed).portfolioVerdict === 'DIVERGED', 'mixed → DIVERGED');
});

test('renderAudit produces ASCII with all required sections', () => {
  const audit = buildAudit({
    games: [{ slug: 'g1', ok: true, topology: '5x3', declaredRTP: 96, measuredRTP: 96, rtpDelta: 0 }],
  }, 'test.json');
  const out = renderAudit(audit);
  assert(out.includes('Declared vs Measured RTP audit'), 'has header');
  assert(out.includes('Precision bands'), 'has bands legend');
  assert(out.includes('Verdict'), 'has Verdict column');
  assert(out.includes('PORTFOLIO VERDICT'), 'has portfolio section');
  assert(out.includes('CONVERGED'), 'mentions CONVERGED');
  assert(out.includes('g1'), 'has slug');
});

test('findLatestReport returns most-recent cross-game JSON when present', () => {
  const result = findLatestReport();
  if (result) {
    assert(result.file.startsWith('cross-game-'), 'file name pattern');
    assert(result.file.endsWith('.json'), 'JSON extension');
    assert(existsSync(result.path), 'path exists');
  }
  /* If no reports exist (clean repo), result is null — both cases valid. */
});

test('Live audit against real cross-game report yields ≥1 CONVERGED', () => {
  const latest = findLatestReport();
  if (!latest) {
    console.log('    (skip — no cross-game report present)');
    return;
  }
  const payload = JSON.parse(readFileSync(latest.path, 'utf8'));
  const audit = buildAudit(payload, latest.file);
  assert(audit.rows.length > 0, 'rows present');
  assert(audit.verdictCounts.CONVERGED >= 1, 'at least one CONVERGED');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
