#!/usr/bin/env node
// FAST Wrath MC — same math as runtime.js, but with:
//   • Symbols pre-mapped to small integers (Uint8 grid)
//   • Reel cumulative weights stored as Float64Array (already)
//   • Paylines as Uint8Array (5 cells each)
//   • No string ID comparisons in the hot loop
//   • Inline binary search
//
// Output JSON to stdout so a parallel aggregator can merge runs.
//
// Usage: node scripts/wrath-runtime-mc-fast.mjs <SPINS> <SEED>

import { readFileSync } from 'node:fs';

const IR = JSON.parse(readFileSync(`${process.env.HOME}/Desktop/wrath-of-olympus.ir.json`, 'utf8'));
const SPINS = Number(process.argv[2]) || 1_000_000;
const SEED  = Number(process.argv[3]) || 12345;

// ── Pre-compile IR into integer-keyed structures ────────────────────────────
const SYMBOLS = IR.symbols || [];
const SYM_ID2INT = {};
SYMBOLS.forEach((s, i) => { SYM_ID2INT[s.id] = i; });
const SYM_KIND = new Uint8Array(SYMBOLS.length);
SYMBOLS.forEach((s, i) => {
  SYM_KIND[i] = s.kind === 'wild' ? 1 : s.kind === 'scatter' ? 2 : s.kind === 'bonus' ? 3 : 0;
});
const WILD_INT     = SYMBOLS.findIndex((s) => s.kind === 'wild');
const SCATTER_INT  = SYMBOLS.findIndex((s) => s.kind === 'scatter');
const BONUS_INT    = SYMBOLS.findIndex((s) => s.kind === 'bonus');

const REELS = IR.topology.reels;
const ROWS  = IR.topology.rows;
const TOTAL_CELLS = REELS * ROWS;
const PAYLINES_RAW = (IR.evaluation && IR.evaluation.paylines) || [];
const NLINES = PAYLINES_RAW.length;
// Flatten paylines: one Uint8Array of NLINES * REELS
const PAYLINES = new Uint8Array(NLINES * REELS);
for (let i = 0; i < NLINES; i++) {
  for (let c = 0; c < REELS; c++) PAYLINES[i * REELS + c] = PAYLINES_RAW[i][c] ?? 0;
}
const MIN_MATCH = (IR.evaluation && IR.evaluation.min_match) || 3;
const WILD_SUB  = !!(IR.evaluation && IR.evaluation.wild_substitution && IR.evaluation.wild_substitution.enabled);
const WIN_CAP   = (IR.limits && IR.limits.max_win_x) || Infinity;
const F_FS  = (IR.features || []).find((f) => f.kind === 'free_spins') || null;
const F_HNW = (IR.features || []).find((f) => f.kind === 'hold_and_win') || null;
const F_MUL = (IR.features || []).find((f) => f.kind === 'multiplier') || null;

// Build reels: per-reel cumulative weight + parallel integer-symbol array
function buildReels(reelMaps) {
  if (!Array.isArray(reelMaps)) return null;
  return reelMaps.map((m) => {
    const entries = Object.entries(m || {});
    const cum = new Float64Array(entries.length);
    const syms = new Int16Array(entries.length);
    let acc = 0;
    for (let i = 0; i < entries.length; i++) {
      const [id, w] = entries[i];
      acc += Math.max(0.0001, Number(w));
      cum[i] = acc;
      syms[i] = SYM_ID2INT[id];
    }
    return { cum, syms, total: acc, n: entries.length };
  });
}
const BASE_REELS = buildReels((IR.reels && IR.reels.base) || []);
const FS_REELS   = buildReels((IR.reels && IR.reels.free_spins) || []);

// Paytable as { symbolInt: [pay3, pay4, pay5] }
const PAYTABLE = new Float64Array(SYMBOLS.length * 6);  // [count 0..5] for each symbol
for (const [id, cells] of Object.entries(IR.paytable || {})) {
  const idx = SYM_ID2INT[id];
  if (idx == null) continue;
  for (const [k, v] of Object.entries(cells)) {
    const c = parseInt(k, 10);
    if (c >= 0 && c <= 5) PAYTABLE[idx * 6 + c] = Number(v);
  }
}
// Scatter-pays fallback table from F_FS.scatter_pays
const SCATTER_PAYS_FS = new Float64Array(6);
if (F_FS && F_FS.scatter_pays) {
  for (const [k, v] of Object.entries(F_FS.scatter_pays)) {
    const c = parseInt(k, 10);
    if (c >= 0 && c <= 5) SCATTER_PAYS_FS[c] = Number(v);
  }
}

// Scatter prevention
const SCAT_PREV = (IR.reels && IR.reels.scatter_prevention) || null;
const SCAT_PREV_REPLACE = SCAT_PREV && SCAT_PREV.replacement_symbol ? SYM_ID2INT[SCAT_PREV.replacement_symbol] : -1;
const SCAT_PREV_MAX = SCAT_PREV ? (SCAT_PREV.max_scatters_per_reel || 1) : 0;
const SCAT_PREV_ON = !!(SCAT_PREV && SCAT_PREV.enabled && SCATTER_INT >= 0 && SCAT_PREV_REPLACE >= 0);

// RNG — switchable.  Env `MC_RNG=mulberry32|pcg64|xoshiro128pp` (default xoshiro128pp).
// W218 (2026-05-20): default switched mulberry32 → xoshiro128pp to match
// updated runtime.js + oracle.js (mulberry32 had +0.06% H&W upward bias).
const RNG_KIND = process.env.MC_RNG || 'xoshiro128pp';
let rng;
if (RNG_KIND === 'pcg64') {
  // Canonical PCG64 (PCG-XSL-RR-128/64) — bit-identical to Wrath src/rng.ts
  const PCG_MULT = 0x2360ED051FC65DA44385DF649FCCF645n;
  const MASK_128 = (1n << 128n) - 1n;
  const MASK_64  = (1n << 64n) - 1n;
  const POW_2_53 = 9007199254740992;
  const seedB = BigInt(SEED >>> 0) & MASK_128;
  const streamB = 0n;
  let inc = ((streamB << 1n) | 1n) & MASK_128;
  let state = 0n;
  state = (state * PCG_MULT + inc) & MASK_128;
  state = (state + seedB) & MASK_128;
  state = (state * PCG_MULT + inc) & MASK_128;
  rng = function () {
    const old = state;
    state = (state * PCG_MULT + inc) & MASK_128;
    const xorshifted = ((old >> 64n) ^ old) & MASK_64;
    const rot = Number((old >> 122n) & 63n);
    const out = ((xorshifted >> BigInt(rot)) | (xorshifted << BigInt((64 - rot) & 63))) & MASK_64;
    return Number(out >> 11n) / POW_2_53;
  };
} else if (RNG_KIND === 'mulberry32') {
  let RNG_STATE = (SEED >>> 0) || 1;
  rng = function () {
    RNG_STATE = (RNG_STATE + 0x6D2B79F5) >>> 0;
    let t = RNG_STATE;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
} else {
  // xoshiro128** (Blackman/Vigna 2018) — Number-only, BIT-IDENTICAL to
  // runtime.js + oracle.js makeRng() under W218.
  let z = (SEED >>> 0) || 0x9E3779B9;
  const sm32 = function () {
    z = (z + 0x9E3779B9) >>> 0;
    let x = z;
    x = Math.imul(x ^ (x >>> 16), 0x85EBCA6B) >>> 0;
    x = Math.imul(x ^ (x >>> 13), 0xC2B2AE35) >>> 0;
    return (x ^ (x >>> 16)) >>> 0;
  };
  let s0 = sm32(), s1 = sm32(), s2 = sm32(), s3 = sm32();
  if ((s0 | s1 | s2 | s3) === 0) s0 = 1;
  rng = function () {
    const m = Math.imul(s1, 5) >>> 0;
    const r = ((m << 7) | (m >>> 25)) >>> 0;
    const result = Math.imul(r, 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 = (s2 ^ s0) >>> 0;
    s3 = (s3 ^ s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ t) >>> 0;
    s3 = ((s3 << 11) | (s3 >>> 21)) >>> 0;
    return result / 4294967296;
  };
}

// Grid buffer reused
const GRID = new Int16Array(TOTAL_CELLS);

function drawSymbol(reelIdx, reels) {
  const r = reels[reelIdx] || reels[reels.length - 1];
  const x = rng() * r.total;
  // Inline binary search
  let lo = 0, hi = r.n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (x <= r.cum[mid]) hi = mid;
    else lo = mid + 1;
  }
  return r.syms[lo];
}

function drawGrid(reels) {
  for (let r = 0; r < REELS; r++) {
    for (let y = 0; y < ROWS; y++) {
      GRID[r * ROWS + y] = drawSymbol(r, reels);
    }
  }
  if (SCAT_PREV_ON) {
    for (let r = 0; r < REELS; r++) {
      let scSeen = 0;
      for (let y = 0; y < ROWS; y++) {
        const idx = r * ROWS + y;
        if (GRID[idx] === SCATTER_INT) {
          if (scSeen >= SCAT_PREV_MAX) GRID[idx] = SCAT_PREV_REPLACE;
          else scSeen++;
        }
      }
    }
  }
}

function payAt(symInt, count) {
  if (symInt < 0 || count < 0 || count > 5) return 0;
  return PAYTABLE[symInt * 6 + count];
}

// EvalBase — returns {lineTotal, scatterPay, scCount, bonusCount}
function evalBase() {
  let lineTotal = 0;
  for (let li = 0; li < NLINES; li++) {
    const base = li * REELS;
    const r0 = 0 * ROWS + PAYLINES[base];
    const first = GRID[r0];
    // candidates: [non-wild from chain, WILD]
    let candA = -1;
    if (WILD_SUB && first === WILD_INT) {
      for (let c = 1; c < REELS; c++) {
        const s = GRID[c * ROWS + PAYLINES[base + c]];
        if (s !== WILD_INT) { candA = s; break; }
      }
    } else {
      candA = first;
    }
    const candB = (WILD_SUB && WILD_INT >= 0 && candA !== WILD_INT) ? WILD_INT : -1;

    let bestPay = 0;
    for (let cc = 0; cc < 2; cc++) {
      const target = cc === 0 ? candA : candB;
      if (target < 0) continue;
      let runLen = 0;
      for (let c = 0; c < REELS; c++) {
        const s = GRID[c * ROWS + PAYLINES[base + c]];
        if (s === target || (WILD_SUB && s === WILD_INT)) runLen++;
        else break;
      }
      if (runLen < MIN_MATCH) continue;
      const p = payAt(target, runLen > 5 ? 5 : runLen);
      if (p > bestPay) bestPay = p;
    }
    lineTotal += bestPay;
  }

  let scCount = 0, bonusCount = 0;
  if (SCATTER_INT >= 0) {
    for (let i = 0; i < TOTAL_CELLS; i++) if (GRID[i] === SCATTER_INT) scCount++;
  }
  if (BONUS_INT >= 0) {
    for (let i = 0; i < TOTAL_CELLS; i++) if (GRID[i] === BONUS_INT) bonusCount++;
  }
  let scatterPay = 0;
  if (scCount >= 3 && SCATTER_INT >= 0) {
    const k = scCount > 5 ? 5 : scCount;
    scatterPay = payAt(SCATTER_INT, k);
    if (scatterPay === 0) scatterPay = SCATTER_PAYS_FS[k];
  }
  return { lineTotal, scatterPay, scCount, bonusCount };
}

// Pre-flatten F_MUL distribution
let MUL_PROB = 0, MUL_DIST = null, MUL_TOT = 0;
if (F_MUL && F_MUL.scope !== 'free_spins_only') {
  MUL_PROB = (F_MUL.trigger && F_MUL.trigger.probability) || 0;
  const dist = F_MUL.distribution || [];
  MUL_DIST = new Float64Array(dist.length * 2);
  let acc = 0;
  for (let i = 0; i < dist.length; i++) {
    acc += Math.max(0, dist[i].weight);
    MUL_DIST[i * 2] = acc;
    MUL_DIST[i * 2 + 1] = dist[i].value;
  }
  MUL_TOT = acc;
}

function rollLightning() {
  if (!F_MUL || MUL_PROB === 0) return 1;
  if (rng() >= MUL_PROB) return 1;
  const x = rng() * MUL_TOT;
  for (let i = 0; i < MUL_DIST.length; i += 2) {
    if (x <= MUL_DIST[i]) return MUL_DIST[i + 1];
  }
  return MUL_DIST[MUL_DIST.length - 1];
}

// FS award lookup
const FS_AWARD = new Int32Array(6);
if (F_FS && F_FS.trigger && F_FS.trigger.thresholds) {
  let best = 0;
  for (let k = 0; k <= 5; k++) {
    for (const [t, v] of Object.entries(F_FS.trigger.thresholds)) {
      const tn = parseInt(t, 10);
      if (tn <= k && v > best) best = v;
    }
    FS_AWARD[k] = best;
  }
}
const FS_RETRIG = new Int32Array(6);
if (F_FS && F_FS.retrigger && F_FS.retrigger.enabled) {
  const tt = F_FS.retrigger.thresholds || (F_FS.trigger && F_FS.trigger.thresholds) || {};
  let best = 0;
  for (let k = 0; k <= 5; k++) {
    for (const [t, v] of Object.entries(tt)) {
      const tn = parseInt(t, 10);
      if (tn <= k && v > best) best = v;
    }
    FS_RETRIG[k] = best;
  }
}
const FS_MULT_START = (F_FS && F_FS.progressive_multiplier && F_FS.progressive_multiplier.start) || 1;
const FS_MULT_INCR  = (F_FS && F_FS.progressive_multiplier && F_FS.progressive_multiplier.increment) || 0;
const FS_MULT_MAX   = (F_FS && F_FS.progressive_multiplier && F_FS.progressive_multiplier.max) || Infinity;
const FS_CAP        = (F_FS && F_FS.retrigger && F_FS.retrigger.max_total) || Infinity;
const FS_REELS_USE  = (F_FS && F_FS.reels_override === 'free_spins' && FS_REELS) ? FS_REELS : BASE_REELS;

function runFreeSpinsHeadless(initialScCount) {
  if (!F_FS) return 0;
  let remaining = FS_AWARD[initialScCount > 5 ? 5 : initialScCount];
  if (remaining <= 0) return 0;
  let total = 0;
  let mult = FS_MULT_START;
  let totalAwarded = remaining;
  while (remaining > 0) {
    remaining--;
    drawGrid(FS_REELS_USE);
    const r = evalBase();
    let win = r.lineTotal + r.scatterPay;
    if (win > 0) {
      win *= mult;
      if (mult < FS_MULT_MAX) mult = Math.min(FS_MULT_MAX, mult + FS_MULT_INCR);
    }
    total += win;
    if (r.scCount >= 3 && totalAwarded < FS_CAP) {
      const add = FS_RETRIG[r.scCount > 5 ? 5 : r.scCount];
      if (add > 0) { remaining += add; totalAwarded += add; }
    }
  }
  return total;
}

// H&W
let HNW_RESPINS_INIT = 3, HNW_BASE = 0.04, HNW_FILL = 0, HNW_FULL_BONUS = 0;
let HNW_POOL = null, HNW_POOL_TOT = 0, HNW_RESET = true, HNW_TRIG_MIN = 6;
if (F_HNW) {
  HNW_RESPINS_INIT = F_HNW.respins_initial || 3;
  HNW_BASE = F_HNW.orb_land_chance_base || 0.04;
  HNW_FILL = F_HNW.orb_land_chance_fill_bonus || 0;
  HNW_FULL_BONUS = F_HNW.full_grid_bonus_x || 0;
  HNW_RESET = F_HNW.respin_reset_on_new !== false;
  HNW_TRIG_MIN = (F_HNW.trigger && F_HNW.trigger.min) || 6;
  const cash = F_HNW.cash_value_distribution || [];
  const jp = F_HNW.jackpot_tiers || [];
  const total = cash.length + jp.length;
  HNW_POOL = new Float64Array(total * 2);
  let acc = 0;
  let i = 0;
  for (const c of cash) {
    acc += Math.max(0, c.weight);
    HNW_POOL[i * 2] = acc;
    HNW_POOL[i * 2 + 1] = c.value;
    i++;
  }
  for (const j of jp) {
    acc += Math.max(0, j.weight);
    HNW_POOL[i * 2] = acc;
    HNW_POOL[i * 2 + 1] = j.multiplier;
    i++;
  }
  HNW_POOL_TOT = acc;
}

function pickOrb() {
  const x = rng() * HNW_POOL_TOT;
  for (let i = 0; i < HNW_POOL.length; i += 2) {
    if (x <= HNW_POOL[i]) return HNW_POOL[i + 1];
  }
  return HNW_POOL[HNW_POOL.length - 1];
}

function runHoldAndWinHeadless(initialOrbCount) {
  if (!F_HNW) return 0;
  let filled = initialOrbCount > TOTAL_CELLS ? TOTAL_CELLS : initialOrbCount;
  let total = 0;
  for (let i = 0; i < filled; i++) total += pickOrb();
  let respins = HNW_RESPINS_INIT;
  while (respins > 0 && filled < TOTAL_CELLS) {
    let landed = 0;
    const free = TOTAL_CELLS - filled;
    const p = HNW_BASE + HNW_FILL * (filled / TOTAL_CELLS);
    for (let c = 0; c < free; c++) {
      if (rng() < p) { total += pickOrb(); landed++; }
    }
    filled += landed;
    if (landed > 0 && HNW_RESET) respins = HNW_RESPINS_INIT;
    else respins--;
  }
  if (filled >= TOTAL_CELLS && HNW_FULL_BONUS > 0) total += HNW_FULL_BONUS;
  return total;
}

// ── Main MC loop ────────────────────────────────────────────────────────────
let totalWagered = 0, totalWon = 0, hits = 0, maxWin = 0;
let baseSum = 0, scatterSum = 0, lightningSum = 0, fsSum = 0, hnwSum = 0;
let fsTrig = 0, hnwTrig = 0, lightTrig = 0;
const t0 = performance.now();
const REPORT_INTERVAL = Math.max(1, Math.floor(SPINS / 20));  // 5% steps

for (let i = 0; i < SPINS; i++) {
  totalWagered += 1;
  drawGrid(BASE_REELS);
  const r = evalBase();
  baseSum += r.lineTotal;
  scatterSum += r.scatterPay;
  let lineWin = r.lineTotal;
  let lightning = 1;
  if ((lineWin > 0 || r.scatterPay > 0) && F_MUL) {
    lightning = rollLightning();
    if (lightning > 1) {
      const uplift = lineWin * (lightning - 1);
      lineWin *= lightning;
      lightningSum += uplift;
      lightTrig++;
    }
  }
  let spinWin = lineWin + r.scatterPay;
  if (F_FS && r.scCount >= 3) {
    const w = runFreeSpinsHeadless(r.scCount);
    spinWin += w;
    fsSum += w;
    fsTrig++;
  }
  if (F_HNW && r.bonusCount >= HNW_TRIG_MIN) {
    const w = runHoldAndWinHeadless(r.bonusCount);
    spinWin += w;
    hnwSum += w;
    hnwTrig++;
  }
  if (spinWin > WIN_CAP) spinWin = WIN_CAP;
  totalWon += spinWin;
  if (spinWin > 0) hits++;
  if (spinWin > maxWin) maxWin = spinWin;
  if ((i + 1) % REPORT_INTERVAL === 0) {
    const dt = (performance.now() - t0) / 1000;
    const rate = (i + 1) / dt;
    process.stderr.write(`[seed=${SEED}] ${((i + 1) / 1e6).toFixed(1)}M / ${(SPINS / 1e6).toFixed(0)}M  RTP=${(100 * totalWon / totalWagered).toFixed(4)}%  ${(rate / 1e6).toFixed(2)} M/s  eta=${((SPINS - i - 1) / rate).toFixed(0)}s\n`);
  }
}

const dt = (performance.now() - t0) / 1000;
const result = {
  seed: SEED, spins: SPINS, durationSec: dt, rate: SPINS / dt,
  totalWagered, totalWon, hits, maxWin,
  rtpPct: (totalWon / totalWagered) * 100,
  buckets: {
    baseLineWins: baseSum / totalWagered,
    scatterPays: scatterSum / totalWagered,
    lightningUplift: lightningSum / totalWagered,
    freeSpins: fsSum / totalWagered,
    holdAndWin: hnwSum / totalWagered,
  },
  triggers: { fs: fsTrig, hnw: hnwTrig, lightning: lightTrig },
};
console.log(JSON.stringify(result));
