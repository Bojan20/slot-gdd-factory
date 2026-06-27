#!/usr/bin/env node
/**
 * W215 Faza 600.4 — Fuzz harness v2 (Discovery Run capable).
 *
 * Extends `_lib.mjs` with:
 *   - Adaptive seed library (interesting seeds persisted to disk)
 *   - Iteration budget control (synthetic / discovery / exhaustive)
 *   - Optimal shrinking (descent-style, not greedy halving)
 *   - Simple coverage instrumentation via a branch-hit counter
 *   - Crash deduplication (sha256(kernel + stack-top-3))
 *   - Resume support (last-seed checkpoint)
 *   - Per-run statistics
 *
 * The v1 harness in `_lib.mjs` continues to work — v2 is opt-in via
 * `runFuzzV2` and is fully backwards-compatible with the existing
 * targets that import primitives directly.
 */

import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { FuzzRng, gen, runFuzz as runFuzzV1 } from './_lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, '..', '..');
export const REPORT_DIR = join(ROOT, 'reports', 'fuzz');
export const SEED_CORPUS_DIR = join(REPORT_DIR, 'seed-corpus');
export const CHECKPOINT_DIR = join(REPORT_DIR, 'checkpoints');

export const BUDGETS = Object.freeze({
  synthetic: 10_000,
  discovery: 1_000_000,
  exhaustive: 100_000_000,
});

// ---------------------------------------------------------------------------
// Iteration-budget control
// ---------------------------------------------------------------------------

/**
 * Resolve an iteration budget from a string mode or numeric override.
 * @param {string|number|undefined} modeOrCount
 * @returns {number}
 */
export function resolveBudget(modeOrCount) {
  if (typeof modeOrCount === 'number' && Number.isFinite(modeOrCount) && modeOrCount > 0) {
    return Math.floor(modeOrCount);
  }
  if (typeof modeOrCount === 'string' && Object.prototype.hasOwnProperty.call(BUDGETS, modeOrCount)) {
    return BUDGETS[modeOrCount];
  }
  return BUDGETS.synthetic;
}

// ---------------------------------------------------------------------------
// Optimal shrinker — descent style (binary search toward minimum)
// ---------------------------------------------------------------------------

/**
 * Shrink an input down to the minimum that still reproduces a throw.
 *
 * For strings/arrays we binary-search the length: we keep the largest
 * prefix that still fails (or equivalently the smallest substring).
 * For objects we drop one key at a time.
 *
 * Worst case O(log²n) probes — far better than the greedy halve in v1.
 *
 * @template T
 * @param {T} input
 * @param {(v:T)=>void} fn
 * @param {number} [maxRounds]
 * @returns {T}
 */
export function shrinkOptimal(input, fn, maxRounds = 64) {
  let cur = input;
  let round = 0;
  while (round < maxRounds) {
    round += 1;
    const next = shrinkStep(cur, fn);
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

function shrinkStep(value, fn) {
  if (typeof value === 'string') {
    return shrinkSequence(value, fn, (s, n) => s.slice(0, n));
  }
  if (Array.isArray(value)) {
    return shrinkSequence(value, fn, (a, n) => a.slice(0, n));
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    for (let i = keys.length - 1; i >= 0; i--) {
      const k = keys[i];
      const trimmed = { ...value };
      delete trimmed[k];
      if (stillFails(trimmed, fn)) return trimmed;
    }
  }
  return value;
}

/**
 * Binary-search the smallest prefix length n such that fn(slice(v,n))
 * still throws. Falls back to the original value if no smaller prefix
 * fails.
 */
function shrinkSequence(value, fn, slice) {
  const len = value.length;
  if (len <= 1) return value;
  // Find the smallest n in [0..len) such that slice(value,n) still fails.
  let lo = 0;
  let hi = len;
  let best = value;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const candidate = slice(value, mid);
    if (stillFails(candidate, fn)) {
      best = candidate;
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return best;
}

function stillFails(candidate, fn) {
  try {
    fn(candidate);
    return false;
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Coverage instrumentation — simple branch-hit counter exposed via mark()
// ---------------------------------------------------------------------------

export class CoverageMap {
  constructor() {
    /** @type {Map<string, number>} */
    this.hits = new Map();
  }
  /** @param {string} branch */
  mark(branch) {
    this.hits.set(branch, (this.hits.get(branch) ?? 0) + 1);
  }
  size() { return this.hits.size; }
  toJSON() {
    return Object.fromEntries([...this.hits.entries()].sort());
  }
}

/**
 * Wrap a body function with a coverage proxy. The wrapped body sees a
 * `cov` parameter on which it can call `cov.mark('label')` at every
 * interesting branch. Unique label count = branches discovered.
 *
 * @template T
 * @param {(input:T, cov:CoverageMap)=>void} bodyWithCov
 * @returns {{ body: (input:T)=>void, cov: CoverageMap }}
 */
export function instrument(bodyWithCov) {
  const cov = new CoverageMap();
  return {
    body: (input) => bodyWithCov(input, cov),
    cov,
  };
}

// ---------------------------------------------------------------------------
// Crash deduplication
// ---------------------------------------------------------------------------

/**
 * Compute a dedup key for a crash record. Uses kernel/harness name
 * plus the first three stack frames.
 */
export function dedupKey(kernel, stack) {
  const top = String(stack ?? '').split('\n').slice(0, 3).join('\n');
  return createHash('sha256').update(`${kernel}\n${top}`).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Seed corpus / checkpoint helpers
// ---------------------------------------------------------------------------

function ensureDir(d) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

export function loadSeedCorpus(name) {
  const dir = join(SEED_CORPUS_DIR, name);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(readFileSync(join(dir, file), 'utf8')));
    } catch { /* ignore corrupt */ }
  }
  return out;
}

export function saveInterestingSeed(name, seed, label) {
  ensureDir(join(SEED_CORPUS_DIR, name));
  const fname = `${String(seed).padStart(10, '0')}-${label.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 32)}.json`;
  writeFileSync(join(SEED_CORPUS_DIR, name, fname), JSON.stringify({ seed, label, at: new Date().toISOString() }, null, 2));
}

export function loadCheckpoint(name) {
  const f = join(CHECKPOINT_DIR, `${name}.json`);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch { return null; }
}

export function saveCheckpoint(name, state) {
  ensureDir(CHECKPOINT_DIR);
  writeFileSync(join(CHECKPOINT_DIR, `${name}.json`), JSON.stringify(state, null, 2));
}

export function clearCheckpoint(name) {
  // Best-effort delete — leave file if FS errors; harmless on next run.
  try {
    const f = join(CHECKPOINT_DIR, `${name}.json`);
    if (existsSync(f)) writeFileSync(f, JSON.stringify({ cleared: true, at: new Date().toISOString() }));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Discovery-mode runner
// ---------------------------------------------------------------------------

/**
 * @template T
 * @param {object} opts
 * @param {string} opts.name
 * @param {(rng:FuzzRng)=>T} opts.makeInput
 * @param {(input:T, cov:CoverageMap)=>void} opts.body
 * @param {string|number} [opts.budget]   'synthetic' (default) | 'discovery' | 'exhaustive' | numeric
 * @param {number} [opts.seedStart]
 * @param {boolean} [opts.resume]         If true and a checkpoint exists, resume after the last seed.
 * @param {number} [opts.maxWallMs]       Stop after this many ms even if iterations remain.
 * @param {(report:any)=>void} [opts.onProgress]
 */
export function runFuzzV2(opts) {
  const total = resolveBudget(opts.budget);
  const seedStart = opts.seedStart ?? 1;
  let startIter = 0;
  if (opts.resume) {
    const ck = loadCheckpoint(opts.name);
    if (ck && typeof ck.lastIter === 'number' && ck.lastIter < total) {
      startIter = ck.lastIter + 1;
    }
  }
  const cov = new CoverageMap();
  const crashes = [];
  /** @type {Map<string, { count:number, sample:any }>} */
  const dedup = new Map();
  const start = Date.now();
  let lastCheckpoint = start;
  const maxWallMs = opts.maxWallMs ?? Infinity;
  let i = startIter;

  for (; i < total; i++) {
    if (Date.now() - start > maxWallMs) break;
    const rng = new FuzzRng(seedStart + i);
    let input;
    try {
      input = opts.makeInput(rng);
    } catch (err) {
      pushCrash(crashes, dedup, opts.name, i, seedStart + i, 'makeInput', err, undefined);
      continue;
    }
    const branchesBefore = cov.size();
    try {
      opts.body(input, cov);
    } catch (err) {
      // Shrink against the original body (re-instrumented coverage is fine to discard).
      const fnNoCov = (v) => opts.body(v, new CoverageMap());
      const minimal = shrinkOptimal(input, fnNoCov);
      pushCrash(crashes, dedup, opts.name, i, seedStart + i, 'body', err, minimal);
    }
    // Promote inputs that grew coverage to the seed corpus.
    if (cov.size() > branchesBefore) {
      try { saveInterestingSeed(opts.name, seedStart + i, `cov+${cov.size() - branchesBefore}`); }
      catch { /* ignore */ }
    }
    if (Date.now() - lastCheckpoint > 2000) {
      lastCheckpoint = Date.now();
      saveCheckpoint(opts.name, { lastIter: i, crashes: dedup.size, branches: cov.size() });
      if (opts.onProgress) opts.onProgress({ iter: i, crashes: dedup.size, branches: cov.size() });
    }
  }

  const durationMs = Math.max(1, Date.now() - start);
  saveCheckpoint(opts.name, { lastIter: i, completed: i >= total, branches: cov.size(), crashes: dedup.size });
  return {
    name: opts.name,
    iterations: i - startIter,
    iterFrom: startIter,
    iterTo: i,
    seedStart,
    durationMs,
    iterPerSec: Math.round(((i - startIter) / durationMs) * 1000),
    crashes,
    uniqueCrashes: dedup.size,
    branches: cov.size(),
    coverage: cov.toJSON(),
  };
}

function pushCrash(crashes, dedup, kernel, iter, seed, phase, err, minimal) {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? (err.stack ?? '').split('\n').slice(0, 6).join('\n') : '';
  const key = dedupKey(kernel, stack || message);
  const sample = safeSample(minimal);
  const existing = dedup.get(key);
  if (existing) {
    existing.count += 1;
    return;
  }
  const record = { iter, seed, phase, message, stack, key, sample };
  dedup.set(key, { count: 1, sample });
  crashes.push(record);
}

function safeSample(v) {
  try {
    if (v === undefined) return null;
    const s = JSON.stringify(v);
    if (!s) return null;
    return s.length > 2000 ? s.slice(0, 2000) + '…' : JSON.parse(s);
  } catch {
    return String(v).slice(0, 200);
  }
}

// ---------------------------------------------------------------------------
// Re-export v1 primitives so v2 modules can import from a single file.
// ---------------------------------------------------------------------------

export { FuzzRng, gen, runFuzzV1 };
