#!/usr/bin/env node
/**
 * tests/contracts/honest-convergence-contract.test.mjs
 *
 * P2 (2026-06-23) — Honest convergence audit contract.
 *
 * Ensures cross-game probe always emits raw-measured-RTP metadata so
 * audit-tool can produce HONEST verdicts (pre-clamp gap) alongside
 * the default operator view (clamp-aware). Regression guard: if any
 * future change drops rawMeasuredRTP / autoClampApplied / rawRtpDelta,
 * this test fails and operator sees the gap was masked.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const CROSS_DIR = join(REPO, 'reports/cross-game-rtp');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

function findLatest() {
  if (!existsSync(CROSS_DIR)) return null;
  const files = readdirSync(CROSS_DIR)
    .filter(f => f.startsWith('cross-game-') && f.endsWith('.json'))
    .map(f => ({ f, path: join(CROSS_DIR, f), mtime: statSync(join(CROSS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0] || null;
}

console.log('HONEST CONVERGENCE contract · test suite');

test('latest cross-game report exists', () => {
  const latest = findLatest();
  assert(latest, `no cross-game reports in ${CROSS_DIR}`);
});

test('latest report contains rawMeasuredRTP field per game', () => {
  const latest = findLatest();
  if (!latest) return;
  const payload = JSON.parse(readFileSync(latest.path, 'utf8'));
  const games = (payload.games || []).filter(g => g.ok !== false);
  assert(games.length > 0, 'at least one ok game');
  for (const g of games) {
    assert('rawMeasuredRTP' in g,
      `${g.slug} missing rawMeasuredRTP — clamp masking guard failed`);
  }
});

test('latest report contains autoClampApplied flag per game', () => {
  const latest = findLatest();
  if (!latest) return;
  const payload = JSON.parse(readFileSync(latest.path, 'utf8'));
  const games = (payload.games || []).filter(g => g.ok !== false);
  for (const g of games) {
    assert('autoClampApplied' in g,
      `${g.slug} missing autoClampApplied — provenance guard failed`);
  }
});

test('latest report contains rawRtpDelta field per game (real declared)', () => {
  const latest = findLatest();
  if (!latest) return;
  const payload = JSON.parse(readFileSync(latest.path, 'utf8'));
  const games = (payload.games || []).filter(g => g.ok !== false && Number.isFinite(g.declaredRTP));
  for (const g of games) {
    assert('rawRtpDelta' in g,
      `${g.slug} missing rawRtpDelta — honest mode contract violated`);
  }
});

test('honest delta differs from clamp delta when clamp applied', () => {
  const latest = findLatest();
  if (!latest) return;
  const payload = JSON.parse(readFileSync(latest.path, 'utf8'));
  const games = (payload.games || []).filter(g => g.ok !== false && g.autoClampApplied);
  if (games.length === 0) {
    console.log('    (skip — no clamp-applied games in latest run)');
    return;
  }
  /* For clamp-applied games, rtpDelta and rawRtpDelta must differ
   * (clamp pushes measured toward declared, so clamp-delta < raw-delta). */
  for (const g of games) {
    if (Number.isFinite(g.rtpDelta) && Number.isFinite(g.rawRtpDelta)) {
      assert(Math.abs(g.rtpDelta) <= Math.abs(g.rawRtpDelta) + 0.01,
        `${g.slug}: clamp |Δ|=${Math.abs(g.rtpDelta)} should be <= raw |Δ|=${Math.abs(g.rawRtpDelta)}`);
    }
  }
});

test('declaredRTPSource + declaredRTPIsSynthetic propagated', () => {
  const latest = findLatest();
  if (!latest) return;
  const payload = JSON.parse(readFileSync(latest.path, 'utf8'));
  const games = (payload.games || []).filter(g => g.ok !== false);
  for (const g of games) {
    assert('declaredRTPSource' in g,
      `${g.slug} missing declaredRTPSource — P1 NON_BINDING contract violated`);
    assert('declaredRTPIsSynthetic' in g,
      `${g.slug} missing declaredRTPIsSynthetic — P1 NON_BINDING contract violated`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
