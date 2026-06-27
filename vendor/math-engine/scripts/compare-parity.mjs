#!/usr/bin/env node
// Differential TS↔Rust parity comparator — Faza 0.1 / 10.3 acceptance gate.
//
// Both binaries (TS `node dist/index.js` and Rust `slot_sim`) emit a JSON
// report in --analytical mode. This script verifies they match bit-for-bit
// on every field the engine claims is deterministic.
//
// Field tolerance is **zero** for analytical mode — analytical RTP is a
// closed-form rational number; if it differs at all, one side has a math
// bug and CI must fail loudly.
//
// MC-mode parity (variance ∝ 1/√N) gets a separate comparator in Faza 10
// with an epsilon tied to the 99.99% CI for that N.

import { readFileSync } from 'node:fs';
import { argv, exit } from 'node:process';

const [, , tsPath, rustPath] = argv;
if (!tsPath || !rustPath) {
  console.error('usage: compare-parity.mjs <ts.json> <rust.json>');
  exit(2);
}

const ts = JSON.parse(readFileSync(tsPath, 'utf-8'));
const rust = JSON.parse(readFileSync(rustPath, 'utf-8'));

// Fields that MUST match bit-for-bit in analytical mode.
// Each entry: [json path, comparator]. Numbers compared as strings to
// dodge IEEE-754 representation differences between Rust f64 and JS Number.
const checks = [
  ['mode', strict],
  ['rtp.total', numEq],
  ['rtp.base_game', numEq],
  ['rtp.free_spins', numEq],
  ['rtp.hold_and_win', numEq],
  ['rtp.jackpot', numEq],
  ['hit_rate', numEq],
  ['volatility.std_dev', numEq],
  ['volatility.classification', strict],
  ['max_win_multiplier', numEq],
  ['fs_trigger_rate', numEq],
  ['hnw_trigger_rate', numEq],
];

let failures = 0;
for (const [path, cmp] of checks) {
  const a = pluck(ts, path);
  const b = pluck(rust, path);
  if (a === undefined && b === undefined) continue; // field absent on both sides — skip
  if (!cmp(a, b)) {
    console.error(`MISMATCH ${path}: ts=${stringify(a)} rust=${stringify(b)}`);
    failures++;
  }
}

if (failures > 0) {
  console.error(`\n${failures} parity mismatch${failures === 1 ? '' : 'es'} — engines drifted`);
  exit(1);
}
console.log('parity: TS == Rust on every checked field');

function pluck(o, path) {
  return path.split('.').reduce((cur, k) => (cur == null ? undefined : cur[k]), o);
}
function strict(a, b) {
  return a === b;
}
function numEq(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') return false;
  return Object.is(a, b) || a.toString() === b.toString();
}
function stringify(v) {
  return JSON.stringify(v);
}
