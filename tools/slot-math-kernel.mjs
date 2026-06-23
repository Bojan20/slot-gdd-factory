#!/usr/bin/env node
/**
 * tools/slot-math-kernel.mjs
 *
 * Operator-facing CLI for sister-repo math kernels.
 *
 * Subcommands
 *   list [category]              — list all kernels (filter by category)
 *   info <kernel>                — show metadata for one kernel
 *   call <kernel> <params.json>  — invoke kernel bridge with JSON params
 *   solve <kernel> <target.json> — invert: target RTP → solved param
 *   solve-nd <kernel> <target.json> — N-D inverse: multi-target → multi-param
 *
 * USAGE
 *   node tools/slot-math-kernel.mjs list
 *   node tools/slot-math-kernel.mjs list inverse-solver
 *   node tools/slot-math-kernel.mjs info hold_and_win
 *   node tools/slot-math-kernel.mjs call cluster_pays /tmp/cluster.json
 *   node tools/slot-math-kernel.mjs solve money_collect /tmp/solve.json
 *
 * EXIT
 *   0 — success
 *   1 — bad subcommand / unknown kernel
 *   2 — kernel call / solver failure
 *
 * EXAMPLES
 *   # See all forward-rtp kernels
 *   node tools/slot-math-kernel.mjs list forward-rtp
 *
 *   # Call cluster_pays with custom distribution
 *   echo '{"clusterCountDistribution": {"A":{"5":0.05}}, "payTable": {"A":{"5":5}}}' > /tmp/c.json
 *   node tools/slot-math-kernel.mjs call cluster_pays /tmp/c.json
 *
 *   # Inverse solve: target H&W RTP 0.40 → required p_per_cell
 *   echo '{"solveFor":"p_per_cell","targetRtp":0.40,"paramLo":0.001,"paramHi":0.5,"method":"bisection","fixed":{"n_cells":15,"trigger_count_min":6,"value_table":{"1":0.5,"5":0.3,"10":0.15,"50":0.05},"respins_reset":3}}' > /tmp/s.json
 *   node tools/slot-math-kernel.mjs solve money_collect /tmp/s.json
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  KERNEL_REGISTRY,
  listKernels,
  getKernelMetadata,
} from '../src/blocks/featureSimPlugins/kernelRegistry.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');

const args = process.argv.slice(2);
const sub = args[0];

if (!sub || sub === '--help' || sub === '-h') {
  console.log(`slot-math-kernel — operator CLI for ${Object.keys(KERNEL_REGISTRY).length} sister-repo kernels

SUBCOMMANDS
  list [category]              List kernels (filter by forward-rtp / composite /
                               inverse-solver / audit)
  info <kernel>                Show metadata
  call <kernel> <params.json>  Invoke kernel bridge with JSON params
  solve <kernel> <cfg.json>    1D inverse: target RTP → solved param
  solve-nd <kernel> <cfg.json> N-D inverse: target vector → param vector

EXAMPLES
  node tools/slot-math-kernel.mjs list
  node tools/slot-math-kernel.mjs info hold_and_win
  node tools/slot-math-kernel.mjs call cluster_pays /tmp/c.json
  node tools/slot-math-kernel.mjs solve money_collect /tmp/s.json
`);
  process.exit(sub ? 0 : 1);
}

/* ── list ─────────────────────────────────────────────────────────────── */
if (sub === 'list') {
  const cat = args[1];
  const ks = listKernels(cat);
  if (ks.length === 0) {
    console.log(`No kernels in category: ${cat}`);
    process.exit(0);
  }
  console.log(`${ks.length} kernels${cat ? ' in category ' + cat : ''}:\n`);
  console.log('  KERNEL                       CATEGORY        FEATURE');
  console.log('  ──────────────────────────── ─────────────── ──────────────────────────────────');
  for (const k of ks) {
    console.log(`  ${k.name.padEnd(28)} ${k.category.padEnd(15)} ${k.feature}`);
  }
  process.exit(0);
}

/* ── info ─────────────────────────────────────────────────────────────── */
if (sub === 'info') {
  const name = args[1];
  if (!name) { console.error('Usage: info <kernel>'); process.exit(1); }
  const m = getKernelMetadata(name);
  if (!m) {
    console.error(`Unknown kernel: ${name}. Try 'list' to see available.`);
    process.exit(1);
  }
  console.log(`Kernel: ${name}\n`);
  console.log(`  Category:           ${m.category}`);
  console.log(`  Topology:           ${m.topology.join(', ')}`);
  console.log(`  Feature:            ${m.feature}`);
  console.log(`  Bridge function:    ${m.bridgeFunction}`);
  console.log(`  Bridge module:      src/blocks/featureSimPlugins/${m.bridgeModule}`);
  console.log(`  Sister-repo:        ${m.sisterRepoModule}`);
  console.log(`  Params shape:       ${m.paramsShape}`);
  process.exit(0);
}

/* ── call ─────────────────────────────────────────────────────────────── */
if (sub === 'call') {
  const name = args[1];
  const cfgPath = args[2];
  if (!name || !cfgPath) { console.error('Usage: call <kernel> <params.json>'); process.exit(1); }
  const m = getKernelMetadata(name);
  if (!m) { console.error(`Unknown kernel: ${name}`); process.exit(1); }
  if (!existsSync(cfgPath)) { console.error(`Config not found: ${cfgPath}`); process.exit(1); }
  const opts = JSON.parse(readFileSync(cfgPath, 'utf8'));
  /* Dynamic import of the correct bridge module + function. */
  const bridgePath = `../src/blocks/featureSimPlugins/${m.bridgeModule}`;
  const mod = await import(bridgePath);
  const fn = mod[m.bridgeFunction];
  if (typeof fn !== 'function') {
    console.error(`Bridge function ${m.bridgeFunction} not exported from ${m.bridgeModule}`);
    process.exit(2);
  }
  /* H&W + cluster bridges take (model, opts); extra bridges take opts only. */
  const result = m.bridgeModule === 'extraKernelBridges.mjs'
    ? await fn(opts)
    : await fn(opts, opts.options || {});
  if (!result.ok) {
    console.error(JSON.stringify({ error: result.reason || 'kernel call failed' }, null, 2));
    process.exit(2);
  }
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

/* ── solve (1D) ──────────────────────────────────────────────────────── */
if (sub === 'solve') {
  const kernelName = args[1];
  const cfgPath = args[2];
  if (!kernelName || !cfgPath) { console.error('Usage: solve <kernel> <cfg.json>'); process.exit(1); }
  if (!existsSync(cfgPath)) { console.error(`Config not found: ${cfgPath}`); process.exit(1); }
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  const { solveForParam } = await import('../src/blocks/featureSimPlugins/extraKernelBridges.mjs');
  const r = await solveForParam({ kernel: kernelName, ...cfg });
  if (!r.ok) {
    console.error(JSON.stringify({ error: r.reason }, null, 2));
    process.exit(2);
  }
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
}

/* ── solve-nd ────────────────────────────────────────────────────────── */
if (sub === 'solve-nd') {
  const kernelName = args[1];
  const cfgPath = args[2];
  if (!kernelName || !cfgPath) { console.error('Usage: solve-nd <kernel> <cfg.json>'); process.exit(1); }
  if (!existsSync(cfgPath)) { console.error(`Config not found: ${cfgPath}`); process.exit(1); }
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  const { solveMultiDim } = await import('../src/blocks/featureSimPlugins/extraKernelBridges.mjs');
  const r = await solveMultiDim({ kernel: kernelName, ...cfg });
  if (!r.ok) {
    console.error(JSON.stringify({ error: r.reason }, null, 2));
    process.exit(2);
  }
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
}

console.error(`Unknown subcommand: ${sub}. Try --help.`);
process.exit(1);
