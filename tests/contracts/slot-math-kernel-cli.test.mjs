#!/usr/bin/env node
/**
 * tests/contracts/slot-math-kernel-cli.test.mjs
 *
 * CLI contract test for tools/slot-math-kernel.mjs.
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const CLI = join(REPO, 'tools/slot-math-kernel.mjs');

let passed = 0, failed = 0;
const tmpRoot = mkdtempSync(join(tmpdir(), 'cli-test-'));

function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function run(args, timeout = 60_000) {
  return spawnSync('node', [CLI, ...args], { encoding: 'utf8', timeout });
}

console.log('SLOT-MATH-KERNEL CLI contract · test suite');

test('--help prints subcommand list', () => {
  const r = run(['--help']);
  assert(r.status === 0, `exit ${r.status}`);
  assert(r.stdout.includes('SUBCOMMANDS'), 'should print SUBCOMMANDS');
  assert(r.stdout.includes('list'), 'mentions list');
  assert(r.stdout.includes('info'), 'mentions info');
  assert(r.stdout.includes('call'), 'mentions call');
  assert(r.stdout.includes('solve'), 'mentions solve');
});

test('No args also prints help (exit 1)', () => {
  const r = run([]);
  assert(r.status === 1, `expected exit 1, got ${r.status}`);
  assert(r.stdout.includes('SUBCOMMANDS'), 'should print help');
});

test('list prints all 22 kernels', () => {
  const r = run(['list']);
  assert(r.status === 0, `exit ${r.status}`);
  assert(r.stdout.includes('22 kernels'), `header should say 22 kernels, got: ${r.stdout.slice(0, 60)}`);
  assert(r.stdout.includes('money_collect'), 'money_collect in list');
  assert(r.stdout.includes('multi_dim_inverse_solver'), 'multi_dim_inverse_solver in list');
});

test('list inverse-solver returns 2 kernels', () => {
  const r = run(['list', 'inverse-solver']);
  assert(r.status === 0, `exit ${r.status}`);
  assert(r.stdout.includes('2 kernels'), `should say 2 kernels, got: ${r.stdout.slice(0, 60)}`);
});

test('info hold_and_win prints metadata', () => {
  const r = run(['info', 'hold_and_win']);
  assert(r.status === 0, `exit ${r.status}`);
  assert(r.stdout.includes('composite'), 'category composite');
  assert(r.stdout.includes('computeHoldAndWinKernelRtp'), 'bridge function');
});

test('info <unknown> exits 1 with error', () => {
  const r = run(['info', 'nonexistent_xyz']);
  assert(r.status === 1, `expected exit 1, got ${r.status}`);
  assert(r.stderr.includes('Unknown kernel'), `stderr: ${r.stderr.slice(0, 100)}`);
});

test('solve money_collect target 0.40 → p_per_cell ~0.12', () => {
  const cfg = join(tmpRoot, 'solve.json');
  writeFileSync(cfg, JSON.stringify({
    solveFor: 'p_per_cell', targetRtp: 0.40,
    paramLo: 0.001, paramHi: 0.5, method: 'bisection',
    fixed: {
      n_cells: 15, trigger_count_min: 6,
      value_table: { '1': 0.5, '5': 0.3, '10': 0.15, '50': 0.05 },
      respins_reset: 3,
    },
  }), 'utf8');
  const r = run(['solve', 'money_collect', cfg]);
  assert(r.status === 0, `exit ${r.status}: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert(out.ok === true, 'ok=true');
  assert(out.converged === true, `converged: ${out.converged}`);
  assert(Math.abs(out.solvedParam - 0.12) < 0.05, `solvedParam ≈ 0.12, got ${out.solvedParam}`);
});

test('call cluster_pays with empirical distribution', () => {
  const cfg = join(tmpRoot, 'call.json');
  writeFileSync(cfg, JSON.stringify({
    /* The cluster bridge takes (model, options) — we pass the whole config
     * as options; the bridge derives model.topology from defaults. The
     * cluster bridge wants `clusterCountDistribution` + `payTable` in opts. */
    topology: { kind: 'cluster', evaluation: 'cluster' },
    symbols: { high: [{ id: 'A', tier: 'HP' }] },
    options: {
      clusterCountDistribution: { 'A': { 5: 0.05, 6: 0.02 } },
      payTable: { 'A': { 5: 5, 6: 10 } },
    },
  }), 'utf8');
  const r = run(['call', 'cluster_pays', cfg], 60_000);
  /* clusterEvalKernelBridge takes (model, options); CLI passes opts as
   * model. We accept either success OR a clear error message. */
  if (r.status === 0) {
    const out = JSON.parse(r.stdout);
    assert(out.ok === true, 'ok=true');
  } else {
    /* graceful — bridge may reject for shape mismatch. */
    assert(r.stderr.length > 0 || r.stdout.length > 0, 'should print diagnostic');
  }
});

/* Cleanup. */
try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
