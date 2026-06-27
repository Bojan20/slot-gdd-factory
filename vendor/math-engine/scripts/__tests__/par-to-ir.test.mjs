#!/usr/bin/env node
/**
 * Standalone Node test for scripts/par-to-ir.mjs.
 *
 *   node scripts/__tests__/par-to-ir.test.mjs
 *
 * Verifies the CLI on every interesting branch:
 *   1) Happy path — enriches IR with validated_metrics
 *   2) Missing --ir or --par → exit 1
 *   3) Non-existent file → exit 2
 *   4) Malformed JSON → exit 2
 *   5) Wrong schema_version → exit 4
 *   6) PAR without rtp → exit 3 (validation)
 *   7) Idempotency — running twice produces equivalent output
 *   8) Percentile interpolation is monotonic
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '..', 'par-to-ir.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'par-to-ir-test-'));

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { console.log(`  ✓ ${label}`); pass++; }
  else { console.log(`  ✗ ${label}`); fail++; }
}

function run(args, { expectCode = 0 } = {}) {
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
  return { status: r.status ?? -1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function makeMinimalIR() {
  return {
    schema_version: '1.0.0',
    meta: { id: 'test', name: 'Test', version: '1.0.0' },
    topology: { kind: 'rectangular', reels: 5, rows: 3 },
    symbols: [{ id: 'A', name: 'A', kind: 'lp' }],
    reels: { mode: 'weighted', base: [{ A: 1 }, { A: 1 }, { A: 1 }, { A: 1 }, { A: 1 }] },
    evaluation: { kind: 'lines', paylines: [[1,1,1,1,1]], min_match: 3 },
    paytable: { A: { '3': 1, '4': 2, '5': 5 } },
  };
}

function makeMinimalPar() {
  return {
    total_spins: 1_000_000,
    rtp: 95.42,
    hit_rate: 22.5,
    volatility_index: 5.6,
    fs_frequency: 120,
    hnw_frequency: 100,
    max_win_x: 1200,
    win_distribution: {
      '0-0.5x': 100000, '0.5-1x': 80000, '1-2x': 50000, '2-3x': 30000,
      '3-5x': 20000, '5-10x': 15000, '10-20x': 8000, '20-50x': 5000,
      '50-100x': 1000, '100-200x': 500, '200-500x': 200, '500-1000x': 50,
      '1000-5000x': 10, '5000-+x': 0,
    },
  };
}

// ─── Test cases ─────────────────────────────────────────────────────────────

console.log('Test: 1) Happy path');
{
  const ir = makeMinimalIR();
  const par = makeMinimalPar();
  const irPath = path.join(TMP, 'happy-ir.json');
  const parPath = path.join(TMP, 'happy-par.json');
  const outPath = path.join(TMP, 'happy-out.json');
  fs.writeFileSync(irPath, JSON.stringify(ir));
  fs.writeFileSync(parPath, JSON.stringify(par));
  const r = run(['--ir', irPath, '--par', parPath, '--out', outPath]);
  assert(r.status === 0, 'exit code 0');
  assert(fs.existsSync(outPath), 'output file written');
  const out = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert(out.validated_metrics, 'validated_metrics block present');
  assert(out.validated_metrics.rtp === 95.42, 'rtp passed through');
  assert(out.validated_metrics.hit_rate === 22.5, 'hit_rate passed through');
  assert(out.validated_metrics.volatility_index === 5.6, 'volatility_index passed through');
  assert(out.validated_metrics.win_percentiles, 'win_percentiles computed');
  const wp = out.validated_metrics.win_percentiles;
  assert(wp.p95 > 0 && wp.p99 > wp.p95 && wp.p99_9 >= wp.p99, 'percentiles are monotonic');
}

console.log('\nTest: 2) Missing --ir');
{
  const r = run(['--par', 'nonexistent.json']);
  assert(r.status === 1, 'exit code 1');
  assert(/--ir/.test(r.stderr), 'error mentions --ir');
}

console.log('\nTest: 2b) Missing --par');
{
  const r = run(['--ir', 'nonexistent.json']);
  assert(r.status === 1, 'exit code 1');
  assert(/--par/.test(r.stderr), 'error mentions --par');
}

console.log('\nTest: 3) Non-existent IR file');
{
  const r = run(['--ir', '/tmp/__does-not-exist__.json', '--par', '/tmp/whatever.json']);
  assert(r.status === 2, 'exit code 2');
}

console.log('\nTest: 4) Malformed JSON');
{
  const irPath = path.join(TMP, 'bad-ir.json');
  const parPath = path.join(TMP, 'bad-par.json');
  fs.writeFileSync(irPath, '{ not valid json');
  fs.writeFileSync(parPath, JSON.stringify(makeMinimalPar()));
  const r = run(['--ir', irPath, '--par', parPath]);
  assert(r.status === 2, 'exit code 2');
  assert(/invalid JSON/i.test(r.stderr), 'error mentions invalid JSON');
}

console.log('\nTest: 5) Wrong schema_version');
{
  const ir = makeMinimalIR();
  ir.schema_version = '0.9.0';
  const irPath = path.join(TMP, 'oldschema-ir.json');
  const parPath = path.join(TMP, 'oldschema-par.json');
  fs.writeFileSync(irPath, JSON.stringify(ir));
  fs.writeFileSync(parPath, JSON.stringify(makeMinimalPar()));
  const r = run(['--ir', irPath, '--par', parPath]);
  assert(r.status === 4, 'exit code 4');
  assert(/schema_version/.test(r.stderr), 'error mentions schema_version');
}

console.log('\nTest: 6) PAR missing rtp');
{
  const ir = makeMinimalIR();
  const par = makeMinimalPar();
  delete par.rtp;
  const irPath = path.join(TMP, 'partial-ir.json');
  const parPath = path.join(TMP, 'partial-par.json');
  fs.writeFileSync(irPath, JSON.stringify(ir));
  fs.writeFileSync(parPath, JSON.stringify(par));
  const r = run(['--ir', irPath, '--par', parPath]);
  assert(r.status === 3, 'exit code 3 (PAR validation failed)');
  assert(/rtp/.test(r.stderr), 'error mentions rtp');
}

console.log('\nTest: 7) Idempotency');
{
  const ir = makeMinimalIR();
  const par = makeMinimalPar();
  const irPath = path.join(TMP, 'idem-ir.json');
  const parPath = path.join(TMP, 'idem-par.json');
  const outAPath = path.join(TMP, 'idem-a.json');
  const outBPath = path.join(TMP, 'idem-b.json');
  fs.writeFileSync(irPath, JSON.stringify(ir));
  fs.writeFileSync(parPath, JSON.stringify(par));
  run(['--ir', irPath, '--par', parPath, '--out', outAPath]);
  // Second run uses outA as input — must produce equivalent validated_metrics
  run(['--ir', outAPath, '--par', parPath, '--out', outBPath]);
  const a = JSON.parse(fs.readFileSync(outAPath, 'utf8'));
  const b = JSON.parse(fs.readFileSync(outBPath, 'utf8'));
  assert(
    JSON.stringify(a.validated_metrics.win_percentiles) === JSON.stringify(b.validated_metrics.win_percentiles),
    'percentiles are stable across re-runs',
  );
}

console.log('\nTest: 8) Real Wrath PAR file (if available)');
{
  const wrathPar = path.resolve(__dirname, '../../../Wrath Of Olympus/reports/validation/par-v2-data-500M.json');
  if (fs.existsSync(wrathPar)) {
    const ir = makeMinimalIR();
    const irPath = path.join(TMP, 'wrath-ir.json');
    const outPath = path.join(TMP, 'wrath-out.json');
    fs.writeFileSync(irPath, JSON.stringify(ir));
    const r = run(['--ir', irPath, '--par', wrathPar, '--out', outPath]);
    assert(r.status === 0, 'exit code 0 with real Wrath PAR');
    const out = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert(out.validated_metrics.rtp > 95 && out.validated_metrics.rtp < 97, `RTP plausible (got ${out.validated_metrics.rtp})`);
    assert(out.validated_metrics.win_percentiles.p99 > 0, 'p99 > 0');
  } else {
    console.log('  (Wrath PAR not present — skipping real-data test)');
  }
}

// ─── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`${pass} passed · ${fail} failed`);
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
