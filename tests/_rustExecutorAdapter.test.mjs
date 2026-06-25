/**
 * tests/_rustExecutorAdapter.test.mjs
 *
 * P3-P3 contract tests for the N-tier Rust executor adapter.
 *
 * Covers (12 cases):
 *   1. FEATURE_KINDS frozen + has expected entries
 *   2. resolveExecutor returns {available:false} when binary absent
 *   3. resolveExecutor honors SLOT_RUST_BIN env override
 *   4. resolveExecutor rejects world-writable binary
 *   5. resolveExecutor rejects binary outside allowed roots
 *   6. resolveExecutor rejects directory passed as binary
 *   7. buildPayloadForTests: defaults spins to 250_000
 *   8. buildPayloadForTests: clamps non-int spins to default
 *   9. buildPayloadForTests: throws on unknown feature kind
 *  10. parseStdoutForTests: extracts SUMMARY|key=value pairs
 *  11. parseStdoutForTests: returns ok:false on no SUMMARY
 *  12. executeFeature: SKIP verdict + reason when binary missing
 */

import { strict as assert } from 'node:assert';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FEATURE_KINDS,
  resolveExecutor,
  executeFeature,
  buildPayloadForTests,
  parseStdoutForTests,
} from '../src/registry/rustExecutorAdapter.mjs';

let pass = 0;
let fail = 0;
function t(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${err.message}`);
    fail++;
  }
}

console.log('rustExecutorAdapter contract suite');

/* 1 */
t('FEATURE_KINDS is frozen + includes core feature shapes', () => {
  assert.ok(Object.isFrozen(FEATURE_KINDS));
  assert.ok(FEATURE_KINDS.includes('baseline'));
  assert.ok(FEATURE_KINDS.includes('cascade'));
  assert.ok(FEATURE_KINDS.includes('hold_and_win'));
  assert.ok(FEATURE_KINDS.includes('free_spins'));
  assert.ok(FEATURE_KINDS.includes('bonus_buy'));
  assert.ok(FEATURE_KINDS.includes('wheel'));
});

/* 2 — covers "binary not built yet" case (most CI runners, fresh dev box) */
t('resolveExecutor: unavailable when binary missing', () => {
  const prev = process.env.SLOT_RUST_BIN;
  process.env.SLOT_RUST_BIN = '/nonexistent/path/slot_sim';
  try {
    const r = resolveExecutor();
    assert.equal(r.available, false);
    assert.match(r.reason, /missing|stat failed/);
  } finally {
    if (prev === undefined) delete process.env.SLOT_RUST_BIN;
    else process.env.SLOT_RUST_BIN = prev;
  }
});

/* 3 — env override exercised end-to-end */
t('resolveExecutor: honors SLOT_RUST_BIN env override', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rustExec-'));
  const fake = join(dir, 'slot_sim');
  writeFileSync(fake, '#!/bin/sh\necho SUMMARY\n', { mode: 0o755 });
  const prev = process.env.SLOT_RUST_BIN;
  process.env.SLOT_RUST_BIN = fake;
  try {
    const r = resolveExecutor();
    assert.equal(r.available, true, `expected available, got ${JSON.stringify(r)}`);
    assert.equal(r.binary, fake);
  } finally {
    if (prev === undefined) delete process.env.SLOT_RUST_BIN;
    else process.env.SLOT_RUST_BIN = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

/* 4 — security: world-writable binary refused */
t('resolveExecutor: rejects world-writable binary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rustExec-'));
  const fake = join(dir, 'slot_sim');
  writeFileSync(fake, 'binary', { mode: 0o755 });
  chmodSync(fake, 0o777); // world-writable
  const prev = process.env.SLOT_RUST_BIN;
  process.env.SLOT_RUST_BIN = fake;
  try {
    const r = resolveExecutor();
    assert.equal(r.available, false);
    assert.match(r.reason, /world-writable/);
  } finally {
    if (prev === undefined) delete process.env.SLOT_RUST_BIN;
    else process.env.SLOT_RUST_BIN = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

/* 5 — security: binary outside allowed roots refused */
t('resolveExecutor: rejects binary outside allowed roots', () => {
  /* /tmp on macOS resolves to /private/tmp (which IS allowed via tmpdir()),
     so use /etc/hostname (definitely outside allowed roots).
     /etc/hostname exists on Linux but not macOS; pick something allowed
     to be a file but outside roots. Use /var/log/system.log on macOS,
     fall back to /etc/hosts on Linux. */
  const candidate = ['/etc/hosts', '/var/log/system.log'].find((p) => {
    try {
      const { statSync } = require('node:fs');
      return statSync(p).isFile();
    } catch (_) {
      return false;
    }
  }) || '/etc/hosts'; // best-effort
  const prev = process.env.SLOT_RUST_BIN;
  process.env.SLOT_RUST_BIN = candidate;
  try {
    const r = resolveExecutor();
    /* /etc is not in [HOME/Projects, /usr/local/bin, /opt, tmpdir] */
    assert.equal(r.available, false);
    assert.match(r.reason, /outside allowed roots|world-writable|not a regular file/);
  } finally {
    if (prev === undefined) delete process.env.SLOT_RUST_BIN;
    else process.env.SLOT_RUST_BIN = prev;
  }
});

/* 6 — directory passed as binary refused */
t('resolveExecutor: rejects directory passed as binary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rustExec-'));
  const prev = process.env.SLOT_RUST_BIN;
  process.env.SLOT_RUST_BIN = dir;
  try {
    const r = resolveExecutor();
    assert.equal(r.available, false);
    assert.match(r.reason, /not a regular file/);
  } finally {
    if (prev === undefined) delete process.env.SLOT_RUST_BIN;
    else process.env.SLOT_RUST_BIN = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

/* 7 */
t('buildPayloadForTests: defaults spins to 250_000', () => {
  const p = buildPayloadForTests({ name: 'X' }, 'baseline', {});
  assert.equal(p.spins, 250_000);
  assert.equal(p.featureKind, 'baseline');
  assert.equal(p.name, 'X');
  assert.equal(p.seed, 1);
});

/* 8 */
t('buildPayloadForTests: clamps non-int / negative spins to default', () => {
  assert.equal(buildPayloadForTests({}, 'cascade', { spins: -1 }).spins, 250_000);
  assert.equal(buildPayloadForTests({}, 'cascade', { spins: 'lots' }).spins, 250_000);
  assert.equal(buildPayloadForTests({}, 'cascade', { spins: 1.5 }).spins, 250_000);
  assert.equal(buildPayloadForTests({}, 'cascade', { spins: 1000 }).spins, 1000);
});

/* 9 */
t('buildPayloadForTests: throws on unknown feature kind', () => {
  assert.throws(
    () => buildPayloadForTests({}, 'magic_dragons', {}),
    /unknown kind/,
  );
});

/* 10 */
t('parseStdoutForTests: extracts SUMMARY pipe-delimited key=value', () => {
  const stdout = [
    'tick=1 spins=10000',
    'tick=2 spins=20000',
    'SUMMARY|rtp=0.9612|hits=187432|spins=250000',
  ].join('\n');
  const r = parseStdoutForTests(stdout);
  assert.equal(r.ok, true);
  assert.equal(r.summary.rtp, 0.9612);
  assert.equal(r.summary.hits, 187432);
  assert.equal(r.summary.spins, 250000);
});

/* 11 */
t('parseStdoutForTests: ok=false when no SUMMARY line', () => {
  const r = parseStdoutForTests('tick=1\ntick=2\nDONE\n');
  assert.equal(r.ok, false);
  assert.ok(typeof r.raw === 'string');
});

/* 12 — executeFeature surfaces SKIP cleanly when binary absent */
t('executeFeature: SKIP verdict + reason when binary missing', () => {
  const prev = process.env.SLOT_RUST_BIN;
  process.env.SLOT_RUST_BIN = '/nonexistent/path/slot_sim';
  try {
    const r = executeFeature({ name: 'X' }, 'baseline', {});
    assert.equal(r.ok, false);
    assert.equal(r.verdict, 'SKIP');
    assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
    assert.equal(typeof r.latencyMs, 'number');
  } finally {
    if (prev === undefined) delete process.env.SLOT_RUST_BIN;
    else process.env.SLOT_RUST_BIN = prev;
  }
});

console.log(`\nResult: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
