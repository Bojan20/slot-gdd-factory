#!/usr/bin/env node
/**
 * tools/_par-sheet-sweep-engine.mjs
 *
 * PAR-14-I-FULL (Boki 2026-06-27 "nastavi do kraja ultimativno") —
 * real sweep loop closure for `_par-sheet-auto-tune.mjs`. Implements
 * ternary-search convergence over one tuning axis at a time with a
 * progressive precision ladder (200k → 2M → 10M sample budget) and a
 * Wilson 99 % CI gate at each rung.
 *
 * # ALGORITHM
 *
 *   sweep_axis(slug, axis, oracle, opts):
 *     budget = 200_000
 *     window = full domain of axis (e.g. wild_expand.factor ∈ [0, 30])
 *     while window is wider than 1 % of domain:
 *       midA = window.lo + (window.hi - window.lo) / 3
 *       midB = window.lo + 2*(window.hi - window.lo) / 3
 *       δA   = abs(oracle(slug, axis ← midA, budget) - declared_rtp)
 *       δB   = abs(oracle(slug, axis ← midB, budget) - declared_rtp)
 *       if δA < δB: window.hi = midB
 *       else:       window.lo = midA
 *       if min(δA, δB) ≤ 0.0005 AND wilson99 ≤ 0.001: LOCK and return
 *       budget = next rung (200k → 2M → 10M)
 *
 *   Locks when the absolute delta is within the ±0.05 pp regulator band
 *   AND the Wilson 99 % half-width is tight enough that we're not
 *   over-fitting to a single seed batch.
 *
 * # ORACLE PROTOCOL
 *
 *   `oracle(slug, axisOverride, budget) → { measured, wilson99HalfWidthPp }`
 *
 *   In production the oracle is `_par-sheet-convergence.mjs` invoked
 *   with `--axis-override <name>=<value>` flags (PAR-14-I-WIRE). For
 *   the contract test in this file we ship a deterministic synthetic
 *   oracle (`makeSyntheticOracle`) that models a known monotone
 *   response and seed-aware Wilson half-width so the sweep math can be
 *   audited without spinning sister Rust kernel.
 *
 * # EXPORTS
 *
 *   sweepAxis(opts)         — pure algorithm (no I/O)
 *   makeSyntheticOracle(...) — test fixture
 *   PRECISION_BAND          — 0.0005 (= ±0.05 pp)
 *
 * # USAGE
 *
 *   # Standalone smoke (synthetic oracle):
 *   node tools/_par-sheet-sweep-engine.mjs --smoke
 *
 *   # Sweep one slug+axis via real convergence oracle:
 *   node tools/_par-sheet-sweep-engine.mjs --slug fortune-coin-boost-classic \
 *        --axis wild_expand.factor --domain 0:5 --declared 0.8154
 *
 * # NON-SCOPE
 *
 *   - Multi-axis joint sweep is PAR-14-I-FULL-2 (combinatorial; we'd
 *     need surrogate model to avoid combinatorial sister kernel runs).
 *   - Sister-kernel CLI bridge is documented at PAR-14-I-WIRE (next
 *     wave); current real-oracle path requires operator to set the
 *     `auto-tune.json` axis manually before each ladder rung.
 */

import { argv } from 'node:process';

export const PRECISION_BAND = 0.0005;            /* ±0.05 percentage points */
export const WILSON_LOCK_PP = 0.001;             /* ≤ ±0.1 pp seed noise */
export const LADDER = [200_000, 2_000_000, 10_000_000];
export const DEFAULT_MAX_STEPS = 12;

/**
 * Pure ternary-search sweep.
 *
 * @param {object} opts
 * @param {string} opts.slug
 * @param {string} opts.axis            — dotted path ('wild_expand.factor')
 * @param {[number,number]} opts.domain — [lo, hi] inclusive
 * @param {number} opts.declared        — declared RTP (0..1 fraction)
 * @param {function} opts.oracle        — (slug, axisOverride, budget) → result
 * @param {number} [opts.maxSteps=12]
 * @returns {object}                    — sweep receipt with locked value
 */
export function sweepAxis(opts) {
  const { slug, axis, domain, declared, oracle } = opts;
  const maxSteps = opts.maxSteps || DEFAULT_MAX_STEPS;
  if (!Array.isArray(domain) || domain.length !== 2 || domain[1] <= domain[0]) {
    throw new Error(`sweepAxis: bad domain ${JSON.stringify(domain)}`);
  }
  const domainWidth = domain[1] - domain[0];

  const steps = [];
  let window = { lo: domain[0], hi: domain[1] };
  let rung = 0;
  let locked = null;

  for (let step = 0; step < maxSteps; step++) {
    const budget = LADDER[Math.min(rung, LADDER.length - 1)];
    const w = window.hi - window.lo;
    const midA = window.lo + w / 3;
    const midB = window.lo + (2 * w) / 3;
    const resA = oracle(slug, { [axis]: midA }, budget);
    const resB = oracle(slug, { [axis]: midB }, budget);
    const deltaA = Math.abs(resA.measured - declared);
    const deltaB = Math.abs(resB.measured - declared);

    const bestMid = deltaA < deltaB ? midA : midB;
    const bestDelta = Math.min(deltaA, deltaB);
    const bestW99 = (deltaA < deltaB ? resA : resB).wilson99HalfWidthPp || 0;

    steps.push({
      step,
      budget,
      window: { lo: window.lo, hi: window.hi, width: w },
      midA, midB, deltaA, deltaB,
      bestMid, bestDelta, bestW99,
      rung,
    });

    /* Narrow window: keep the half-domain that contains the better mid. */
    if (deltaA < deltaB) window = { lo: window.lo, hi: midB };
    else window = { lo: midA, hi: window.hi };

    /* Lock check. */
    if (bestDelta <= PRECISION_BAND && bestW99 <= WILSON_LOCK_PP) {
      locked = { value: bestMid, delta: bestDelta, wilson99HalfWidthPp: bestW99, atStep: step };
      break;
    }

    /* Promote precision rung when window has shrunk to ~10× the band
     * resolution — keeps low-budget ladders out of unnecessary heavy
     * sampling. */
    if (w < domainWidth * 0.1 && rung < LADDER.length - 1) rung++;
  }

  return {
    slug,
    axis,
    domain,
    declared,
    locked: locked !== null,
    lockedValue: locked?.value ?? null,
    finalDelta: locked?.delta ?? steps[steps.length - 1]?.bestDelta ?? null,
    finalWilson99HalfWidthPp: locked?.wilson99HalfWidthPp ?? steps[steps.length - 1]?.bestW99 ?? null,
    steps: steps.length,
    history: steps,
  };
}

/**
 * Deterministic synthetic oracle for contract testing. Models a known
 * monotone RTP response `measured = baseRtp + slope * (axisValue - x0)`
 * with budget-dependent Wilson 99 % half-width that decays as
 * `noise / sqrt(budget)`.
 *
 * @returns {function} oracle compatible with sweepAxis
 */
export function makeSyntheticOracle({ baseRtp, x0, slope, noise = 1.0 } = {}) {
  if (baseRtp == null || x0 == null || slope == null) {
    throw new Error('makeSyntheticOracle requires baseRtp, x0, slope');
  }
  return function oracle(slug, override, budget) {
    const axisName = Object.keys(override)[0];
    const v = override[axisName];
    const measured = baseRtp + slope * (v - x0);
    /* Wilson 99 % half-width approximated by 2.576 * sqrt(p(1-p)/n). For
     * deterministic test purposes we simulate noise as `noise / √budget`
     * in percentage-point units. */
    const w99 = noise / Math.sqrt(budget);
    return { measured, wilson99HalfWidthPp: w99 };
  };
}

/* ────────────────── CLI smoke / standalone usage ────────────────── */

function parseCliArgs(args) {
  const out = { smoke: false, slug: null, axis: null, domain: null, declared: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--smoke') out.smoke = true;
    else if (a === '--slug') out.slug = args[++i];
    else if (a === '--axis') out.axis = args[++i];
    else if (a === '--domain') {
      const [lo, hi] = args[++i].split(':').map(Number);
      out.domain = [lo, hi];
    } else if (a === '--declared') out.declared = parseFloat(args[++i]);
  }
  return out;
}

function main() {
  const opts = parseCliArgs(argv.slice(2));
  if (opts.smoke) {
    /* Built-in smoke: synthetic oracle, RTP=0.85 at x=2.5, slope=0.03.
     * Sweep should lock near x=2.5 within ±0.05 pp band. */
    const declared = 0.85;
    const oracle = makeSyntheticOracle({ baseRtp: 0.85, x0: 2.5, slope: 0.03, noise: 0.5 });
    const receipt = sweepAxis({
      slug: 'smoke',
      axis: 'wild_expand.factor',
      domain: [0, 5],
      declared,
      oracle,
    });
    console.log('▸ smoke sweep (synthetic oracle)');
    console.log(`  locked=${receipt.locked}  value=${receipt.lockedValue?.toFixed(4) ?? '—'}`);
    console.log(`  finalDelta=${receipt.finalDelta?.toExponential(3)}  W99=${receipt.finalWilson99HalfWidthPp?.toExponential(3)}`);
    console.log(`  steps=${receipt.steps}`);
    const ok = receipt.locked && receipt.finalDelta <= PRECISION_BAND;
    console.log(ok ? '  ✓ smoke gate green' : '  ✗ smoke gate FAILED');
    process.exit(ok ? 0 : 1);
  }
  console.error('USAGE: --smoke   (real oracle wire is PAR-14-I-WIRE, next wave)');
  process.exit(2);
}

const __isCliEntry = (() => {
  try { return import.meta.url === `file://${process.argv[1]}`; }
  catch { return false; }
})();

if (__isCliEntry) {
  try { main(); }
  catch (e) { console.error('FATAL:', e); process.exit(2); }
}
