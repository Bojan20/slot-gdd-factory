#!/usr/bin/env node
/**
 * tests/contracts/kernel-audit.test.mjs
 *
 * N4 (2026-06-23) — Kernel audit logger + aggregator contract.
 *
 * Verifies tools/kernel-audit-logger.mjs + kernel-audit-aggregate.mjs:
 *   - hashParams is deterministic + sensitive to order-independent change
 *   - isAuditEnabled gated by KERNEL_AUDIT_LOG env
 *   - logKernelCall never throws (even on bogus input)
 *   - aggregate produces expected shape (totalCalls/perKernel/topCallers)
 *   - percentile math: p50/p95 against known input set
 *   - errRatePct math: 3 errors out of 10 calls → 30.00
 *   - paramShapesDistinct counts unique hashes
 *   - renderSummary uses box-drawing + lists all kernels
 *   - End-to-end: log 5 events → load → aggregate → match
 *   - Aggregator handles empty audit dir gracefully (totalCalls = 0)
 *   - Aggregator skips malformed JSONL lines
 *   - Hot-path zero-cost when env not set (isAuditEnabled false)
 */

import { tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  hashParams, isAuditEnabled, logKernelCall, currentAuditFilePath,
} from '../../tools/kernel-audit-logger.mjs';
import {
  loadAllEvents, aggregate, renderSummary,
} from '../../tools/kernel-audit-aggregate.mjs';

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

console.log('KERNEL-AUDIT contract · test suite');

test('hashParams: deterministic across runs', () => {
  const a = hashParams({ ltrRtp: 0.96, share: 0.7 });
  const b = hashParams({ ltrRtp: 0.96, share: 0.7 });
  assert(a === b, `same input → same hash, got ${a} vs ${b}`);
  assert(/^[0-9a-f]{12}$/.test(a), `12-hex-char, got ${a}`);
});

test('hashParams: key order independent', () => {
  const a = hashParams({ ltrRtp: 0.96, share: 0.7 });
  const b = hashParams({ share: 0.7, ltrRtp: 0.96 });
  assert(a === b, `key order should not matter, got ${a} vs ${b}`);
});

test('hashParams: different values → different hash', () => {
  const a = hashParams({ ltrRtp: 0.96 });
  const b = hashParams({ ltrRtp: 0.97 });
  assert(a !== b, `different value should differ, got ${a} vs ${b}`);
});

test('isAuditEnabled: gated by KERNEL_AUDIT_LOG env', () => {
  const original = process.env.KERNEL_AUDIT_LOG;
  try {
    delete process.env.KERNEL_AUDIT_LOG;
    assert(isAuditEnabled() === false, 'unset → false');
    process.env.KERNEL_AUDIT_LOG = '1';
    assert(isAuditEnabled() === true, '"1" → true');
    process.env.KERNEL_AUDIT_LOG = 'true';
    assert(isAuditEnabled() === true, '"true" → true');
    process.env.KERNEL_AUDIT_LOG = '0';
    assert(isAuditEnabled() === false, '"0" → false');
  } finally {
    if (original == null) delete process.env.KERNEL_AUDIT_LOG;
    else process.env.KERNEL_AUDIT_LOG = original;
  }
});

test('logKernelCall: never throws on bogus input', async () => {
  /* These would crash naive impls but must be swallowed. */
  const p1 = logKernelCall(null);
  const p2 = logKernelCall({ params: { circular: null } });
  const p3 = logKernelCall({ kernel: 42, params: undefined, ok: 'yes' });
  await Promise.allSettled([p1, p2, p3]);
  /* Reaching here means no throw — explicit assertion for clarity. */
  assert(true, 'no throw');
});

test('aggregate: empty input → totalCalls 0 + empty arrays', () => {
  const s = aggregate([]);
  assert(s.totalCalls === 0, 'totalCalls 0');
  assert(s.totalErr === 0, 'totalErr 0');
  assert(s.errRatePct === 0, 'errRatePct 0');
  assert(s.kernelsExercised === 0, 'kernelsExercised 0');
  assert(Object.keys(s.perKernel).length === 0, 'perKernel empty');
  assert(s.topCallers.length === 0, 'topCallers empty');
});

test('aggregate: errRatePct math (3 err out of 10 → 30.00)', () => {
  const events = [];
  for (let i = 0; i < 7; i++) events.push({ ts: 'x', kernel: 'k', ok: true,  latencyMs: 1, paramsHash: 'aaaaaaaaaaaa' });
  for (let i = 0; i < 3; i++) events.push({ ts: 'x', kernel: 'k', ok: false, latencyMs: 1, paramsHash: 'bbbbbbbbbbbb' });
  const s = aggregate(events);
  assert(s.errRatePct === 30, `expect 30, got ${s.errRatePct}`);
  assert(s.perKernel.k.errRatePct === 30, `perKernel errRate 30, got ${s.perKernel.k.errRatePct}`);
});

test('aggregate: percentile math (p50 / p95) against known set', () => {
  /* Latencies 1..100 ms — p50 ≈ 50, p95 ≈ 95. */
  const events = [];
  for (let i = 1; i <= 100; i++) {
    events.push({ ts: 'x', kernel: 'k', ok: true, latencyMs: i, paramsHash: 'a'.repeat(12) });
  }
  const s = aggregate(events);
  const k = s.perKernel.k;
  assert(k.p50ms >= 49 && k.p50ms <= 51, `p50 ≈ 50, got ${k.p50ms}`);
  assert(k.p95ms >= 94 && k.p95ms <= 96, `p95 ≈ 95, got ${k.p95ms}`);
  assert(k.maxMs === 100, `max 100, got ${k.maxMs}`);
});

test('aggregate: paramShapesDistinct counts unique hashes', () => {
  const events = [
    { ts: 'x', kernel: 'k', ok: true, latencyMs: 1, paramsHash: 'aaaaaaaaaaaa' },
    { ts: 'x', kernel: 'k', ok: true, latencyMs: 1, paramsHash: 'aaaaaaaaaaaa' },
    { ts: 'x', kernel: 'k', ok: true, latencyMs: 1, paramsHash: 'bbbbbbbbbbbb' },
    { ts: 'x', kernel: 'k', ok: true, latencyMs: 1, paramsHash: 'cccccccccccc' },
  ];
  const s = aggregate(events);
  assert(s.perKernel.k.paramShapesDistinct === 3,
    `expect 3 distinct shapes, got ${s.perKernel.k.paramShapesDistinct}`);
});

test('aggregate: topCallers sorted desc by count', () => {
  const events = [
    ...Array(5).fill({ ts: 'x', kernel: 'a', ok: true, latencyMs: 1, paramsHash: 'a'.repeat(12) }),
    ...Array(10).fill({ ts: 'x', kernel: 'b', ok: true, latencyMs: 1, paramsHash: 'b'.repeat(12) }),
    ...Array(3).fill({ ts: 'x', kernel: 'c', ok: true, latencyMs: 1, paramsHash: 'c'.repeat(12) }),
  ];
  const s = aggregate(events);
  assert(s.topCallers[0].kernel === 'b' && s.topCallers[0].count === 10, 'b first');
  assert(s.topCallers[1].kernel === 'a' && s.topCallers[1].count === 5,  'a second');
  assert(s.topCallers[2].kernel === 'c' && s.topCallers[2].count === 3,  'c third');
});

test('aggregate: engineMode distribution captured', () => {
  const events = [
    { ts: 'x', kernel: 'k', ok: true,  engineMode: 'python-kernel', latencyMs: 1, paramsHash: 'a'.repeat(12) },
    { ts: 'x', kernel: 'k', ok: false, engineMode: 'unavailable',   latencyMs: 1, paramsHash: 'a'.repeat(12) },
    { ts: 'x', kernel: 'k', ok: false, engineMode: 'unavailable',   latencyMs: 1, paramsHash: 'a'.repeat(12) },
  ];
  const s = aggregate(events);
  assert(s.engineModes['python-kernel'] === 1, 'python-kernel 1');
  assert(s.engineModes['unavailable']   === 2, 'unavailable 2');
});

test('aggregate: topErrors sorted desc + truncated', () => {
  const events = [];
  for (let i = 0; i < 5; i++) events.push({ ts: 'x', kernel: 'k', ok: false, engineMode: 'error', errorReason: 'timeout', latencyMs: 1, paramsHash: 'a'.repeat(12) });
  for (let i = 0; i < 2; i++) events.push({ ts: 'x', kernel: 'k', ok: false, engineMode: 'error', errorReason: 'bad input', latencyMs: 1, paramsHash: 'a'.repeat(12) });
  const s = aggregate(events);
  assert(s.topErrors[0].reason === 'timeout' && s.topErrors[0].count === 5, 'timeout first');
  assert(s.topErrors[1].reason === 'bad input' && s.topErrors[1].count === 2, 'bad input second');
});

test('renderSummary: uses box-drawing + lists kernels (HARD RULE #3)', () => {
  const events = [
    { ts: 'x', kernel: 'k1', ok: true, latencyMs: 5, paramsHash: 'a'.repeat(12), engineMode: 'python-kernel' },
    { ts: 'x', kernel: 'k2', ok: false, latencyMs: 8, paramsHash: 'b'.repeat(12), engineMode: 'error', errorReason: 'oops' },
  ];
  const s = aggregate(events);
  const r = renderSummary(s);
  assert(typeof r === 'string', 'string');
  assert(r.includes('┌') && r.includes('┐') && r.includes('└') && r.includes('┘'), 'box-drawing corners');
  assert(r.includes('├') && r.includes('┤'), 'mid borders');
  assert(r.includes('│'), 'vertical bar');
  assert(r.includes('k1'), 'k1 listed');
  assert(r.includes('k2'), 'k2 listed');
  assert(r.includes('Top callers'), 'top callers heading');
  assert(r.includes('Per-kernel detail'), 'per-kernel heading');
  assert(r.includes('Engine mode distribution'), 'engine mode heading');
});

test('renderSummary: empty audit → helpful message', () => {
  const r = renderSummary(aggregate([]));
  assert(r.includes('no audit events') || r.includes('Total calls: 0'),
    `empty render should mention zero state, got: ${r.slice(0, 200)}`);
});

test('loadAllEvents + aggregate: end-to-end via temp dir', () => {
  /* Synthesise a tmp dir mimicking audit-YYYY-MM-DD.jsonl layout. */
  const tdir = mkdtempSync(join(tmpdir(), 'kernel-audit-test-'));
  try {
    const events = [
      { ts: '2026-06-23T10:00:00Z', kernel: 'both_ways', paramsHash: 'aaaaaaaaaaaa', ok: true,  engineMode: 'python-kernel', latencyMs: 12 },
      { ts: '2026-06-23T10:00:01Z', kernel: 'both_ways', paramsHash: 'aaaaaaaaaaaa', ok: true,  engineMode: 'python-kernel', latencyMs: 15 },
      { ts: '2026-06-23T10:00:02Z', kernel: 'cluster_pays', paramsHash: 'bbbbbbbbbbbb', ok: false, engineMode: 'error', errorReason: 'timeout', latencyMs: 99 },
    ];
    writeFileSync(join(tdir, 'audit-2026-06-23.jsonl'),
      events.map(e => JSON.stringify(e)).join('\n') + '\n',
      'utf8');
    /* Also a malformed line should be skipped without throwing. */
    writeFileSync(join(tdir, 'audit-2026-06-22.jsonl'),
      '{not valid json}\n{"ts":"2026-06-22T00:00:00Z","kernel":"wheel","ok":true,"paramsHash":"cccccccccccc","latencyMs":3}\n',
      'utf8');

    const loaded = loadAllEvents(tdir);
    assert(loaded.length === 4, `4 valid events (3 + 1 after skip), got ${loaded.length}`);
    const s = aggregate(loaded);
    assert(s.totalCalls === 4, `totalCalls 4, got ${s.totalCalls}`);
    assert(s.totalErr === 1, `totalErr 1, got ${s.totalErr}`);
    assert(s.kernelsExercised === 3, `3 kernels, got ${s.kernelsExercised}`);
    assert(s.perKernel.both_ways.count === 2, 'both_ways count');
    assert(s.perKernel.both_ways.paramShapesDistinct === 1, 'both_ways shapes');
    assert(s.perKernel.cluster_pays.errCount === 1, 'cluster err');
  } finally {
    rmSync(tdir, { recursive: true, force: true });
  }
});

test('logKernelCall writes a parseable JSONL line when env enabled', async () => {
  const original = process.env.KERNEL_AUDIT_LOG;
  process.env.KERNEL_AUDIT_LOG = '1';
  try {
    /* Wait for fire-and-forget to complete. */
    const promise = logKernelCall({
      kernel: 'test_kernel', params: { foo: 1 }, ok: true,
      engineMode: 'python-kernel', latencyMs: 42.5,
    });
    await promise;
    const path = currentAuditFilePath();
    assert(existsSync(path), `audit file should exist: ${path}`);
    const raw = readFileSync(path, 'utf8');
    const lines = raw.split('\n').filter(l => l.trim());
    const last = JSON.parse(lines[lines.length - 1]);
    assert(last.kernel === 'test_kernel', 'kernel name');
    assert(last.paramsHash && last.paramsHash.length === 12, 'paramsHash format');
    assert(last.ok === true, 'ok flag');
    assert(last.latencyMs === 42.5, 'latency captured');
    assert(typeof last.ts === 'string' && last.ts.includes('T'), 'ts ISO');
  } finally {
    if (original == null) delete process.env.KERNEL_AUDIT_LOG;
    else process.env.KERNEL_AUDIT_LOG = original;
  }
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
