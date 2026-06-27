#!/usr/bin/env node
// FULL Pattern-WO MC against the runtime.js math, headless.
//
// Imports the EXACT algorithm shape from web/studio/public/runner/runtime.js
// (drawGrid, evalBase, runFreeSpinsHeadless, runHoldAndWinHeadless, lightning)
// and runs N spins against the canonical Wrath IR on the desktop.
//
// Tolerance target: industry ±0.05pp.  10M spins ⇒ stderr ≈ 0.32pp ⇒ CI95
// ≈ ±0.65pp.  We bump to N=10M as a baseline; to truly hit ±0.05pp at 95%
// confidence we'd need 1B+ spins (canonical Wrath did 5B).  But ±0.5pp
// already exposes algorithm bugs that the previous ±5pp band hid.
//
// Output: tabular RTP / hit / σ / FS / H&W / Lightning rates and per-bucket
// breakdown, plus delta vs canonical rtp_allocation.

import { readFileSync } from 'node:fs';

const IR = JSON.parse(readFileSync(`${process.env.HOME}/Desktop/wrath-of-olympus.ir.json`, 'utf8'));
const SPINS = Number(process.argv[2]) || 10_000_000;
const SEED = Number(process.argv[3]) || 12345;

const REELS = IR.topology.reels;
const ROWS  = IR.topology.rows;
const SYM_BY_ID = Object.fromEntries((IR.symbols || []).map((s) => [s.id, s]));
const PAYLINES  = (IR.evaluation && IR.evaluation.paylines) || [];
const MIN_MATCH = (IR.evaluation && IR.evaluation.min_match) || 3;
const WILD_SUB  = !!(IR.evaluation && IR.evaluation.wild_substitution && IR.evaluation.wild_substitution.enabled);
const WIN_CAP   = (IR.limits && IR.limits.max_win_x) || Infinity;
const F_FS      = (IR.features || []).find((f) => f.kind === 'free_spins') || null;
const F_HNW     = (IR.features || []).find((f) => f.kind === 'hold_and_win') || null;
const F_MUL     = (IR.features || []).find((f) => f.kind === 'multiplier') || null;

function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildReels(reelMaps) {
  if (!Array.isArray(reelMaps)) return null;
  return reelMaps.map((m) => {
    const entries = Object.entries(m || {});
    const cum = new Float64Array(entries.length);
    const syms = new Array(entries.length);
    let acc = 0;
    for (let i = 0; i < entries.length; i++) {
      const [id, w] = entries[i];
      acc += Math.max(0.0001, Number(w));
      cum[i] = acc;
      syms[i] = id;
    }
    return { cum, syms, total: acc };
  });
}
const BASE_REELS = buildReels((IR.reels && IR.reels.base) || []);
const FS_REELS   = buildReels((IR.reels && IR.reels.free_spins) || []);

function drawSymbol(rng, reelIdx, reels) {
  const r = reels[reelIdx] || reels[reels.length - 1];
  const x = rng() * r.total;
  let lo = 0, hi = r.cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (x <= r.cum[mid]) hi = mid;
    else lo = mid + 1;
  }
  return r.syms[lo];
}

const SCAT_PREV = (IR.reels && IR.reels.scatter_prevention) || null;
function scatterId() { const s = (IR.symbols || []).find((x) => x.kind === 'scatter'); return s ? s.id : null; }
function bonusId()   { const s = (IR.symbols || []).find((x) => x.kind === 'bonus');   return s ? s.id : null; }
const SC_ID = scatterId();
const BN_ID = bonusId();

function applyScatterPrevention(grid) {
  if (!SCAT_PREV || !SCAT_PREV.enabled || !SC_ID) return grid;
  const maxPer = SCAT_PREV.max_scatters_per_reel || 1;
  const replace = SCAT_PREV.replacement_symbol;
  if (!replace) return grid;
  for (let r = 0; r < REELS; r++) {
    let scSeen = 0;
    for (let y = 0; y < ROWS; y++) {
      if (grid[r][y] === SC_ID) {
        if (scSeen >= maxPer) grid[r][y] = replace;
        else scSeen++;
      }
    }
  }
  return grid;
}

function drawGrid(rng, reels) {
  const grid = [];
  for (let r = 0; r < REELS; r++) {
    const col = [];
    for (let y = 0; y < ROWS; y++) col.push(drawSymbol(rng, r, reels));
    grid.push(col);
  }
  return applyScatterPrevention(grid);
}

function isWild(id)  { return SYM_BY_ID[id] && SYM_BY_ID[id].kind === 'wild'; }
function payAt(symId, count) {
  const pt = IR.paytable || {};
  const e = pt[symId];
  if (!e) return 0;
  return Number(e[String(count)] ?? e['x' + count] ?? 0);
}

function evalBase(grid) {
  let lineTotal = 0;
  const wildSym = ((IR.symbols || []).find((x) => x.kind === 'wild') || {}).id;
  for (let li = 0; li < PAYLINES.length; li++) {
    const line = PAYLINES[li];
    const first = grid[0][line[0] ?? 0];
    const candidates = [];
    if (WILD_SUB && isWild(first)) {
      for (let c = 1; c < REELS; c++) {
        const s = grid[c][line[c] ?? 0];
        if (!isWild(s)) { candidates.push(s); break; }
      }
    } else if (first) {
      candidates.push(first);
    }
    if (WILD_SUB && wildSym && !candidates.includes(wildSym)) {
      candidates.push(wildSym);
    }
    let bestPay = 0;
    for (const target of candidates) {
      let runLen = 0;
      for (let c = 0; c < REELS; c++) {
        const s = grid[c][line[c] ?? 0];
        if (s === target || (WILD_SUB && isWild(s))) runLen++;
        else break;
      }
      if (runLen < MIN_MATCH) continue;
      const p = payAt(target, Math.min(runLen, 5));
      if (p > bestPay) bestPay = p;
    }
    if (bestPay > 0) lineTotal += bestPay;
  }
  let scCount = 0, scatterPay = 0;
  if (SC_ID) {
    for (let r = 0; r < REELS; r++)
      for (let y = 0; y < ROWS; y++)
        if (grid[r][y] === SC_ID) scCount++;
    if (scCount >= 3) {
      scatterPay = payAt(SC_ID, Math.min(scCount, 5));
      if (scatterPay === 0 && F_FS && F_FS.scatter_pays) {
        const k = String(Math.min(scCount, 5));
        const v = F_FS.scatter_pays[k] ?? F_FS.scatter_pays[Math.min(scCount, 5)];
        scatterPay = Number(v) || 0;
      }
    }
  }
  let bonusCount = 0;
  if (BN_ID) {
    for (let r = 0; r < REELS; r++)
      for (let y = 0; y < ROWS; y++)
        if (grid[r][y] === BN_ID) bonusCount++;
  }
  return { lineTotal, scatterPay, scCount, bonusCount, baseWin: lineTotal + scatterPay };
}

function pickWeighted(rng, list) {
  let total = 0;
  for (const e of list) total += Math.max(0, e.weight);
  let x = rng() * total;
  for (const e of list) {
    x -= Math.max(0, e.weight);
    if (x <= 0) return e.value;
  }
  return list[list.length - 1].value;
}

function awardFsSpins(scCount) {
  if (!F_FS || !F_FS.trigger || !F_FS.trigger.thresholds) return 0;
  let best = 0;
  for (const [k, v] of Object.entries(F_FS.trigger.thresholds)) {
    const n = parseInt(k, 10);
    if (n <= scCount && v > best) best = v;
  }
  return best;
}
function awardFsRetrigger(scCount) {
  if (!F_FS || !F_FS.retrigger || !F_FS.retrigger.enabled) return 0;
  const t = F_FS.retrigger.thresholds || (F_FS.trigger && F_FS.trigger.thresholds) || {};
  let best = 0;
  for (const [k, v] of Object.entries(t)) {
    const n = parseInt(k, 10);
    if (n <= scCount && v > best) best = v;
  }
  return best;
}

function rollLightning(rng) {
  if (!F_MUL) return 1;
  if (F_MUL.scope && F_MUL.scope !== 'base_game_only') return 1;
  const prob = (F_MUL.trigger && F_MUL.trigger.probability) || 0;
  if (rng() >= prob) return 1;
  const dist = F_MUL.distribution || [];
  if (!dist.length) return 1;
  return pickWeighted(rng, dist);
}

function runFreeSpinsHeadless(rng, initialScCount) {
  if (!F_FS) return 0;
  const fsReels = (F_FS.reels_override === 'free_spins' && FS_REELS) ? FS_REELS : BASE_REELS;
  let remaining = awardFsSpins(initialScCount);
  if (remaining <= 0) return 0;
  let total = 0;
  let mult = (F_FS.progressive_multiplier && F_FS.progressive_multiplier.start) || 1;
  const incr = (F_FS.progressive_multiplier && F_FS.progressive_multiplier.increment) || 0;
  const maxMult = (F_FS.progressive_multiplier && F_FS.progressive_multiplier.max) || Infinity;
  const incrOn = (F_FS.progressive_multiplier && F_FS.progressive_multiplier.increments_on) || 'each_winning_fs_spin';
  const fsCap = (F_FS.retrigger && F_FS.retrigger.max_total) || Infinity;
  let totalAwarded = remaining;
  while (remaining > 0) {
    remaining--;
    const grid = drawGrid(rng, fsReels);
    const r = evalBase(grid);
    let win = r.baseWin;
    if (win > 0) {
      win *= mult;
      if (incrOn === 'each_winning_fs_spin' && mult < maxMult) mult = Math.min(maxMult, mult + incr);
    }
    if (incrOn === 'each_fs_spin' && mult < maxMult) mult = Math.min(maxMult, mult + incr);
    total += win;
    if (r.scCount >= 3 && totalAwarded < fsCap) {
      const add = awardFsRetrigger(r.scCount);
      if (add > 0) { remaining += add; totalAwarded += add; }
    }
  }
  return total;
}

function runHoldAndWinHeadless(rng, initialOrbCount) {
  if (!F_HNW) return 0;
  const respinsInitial = F_HNW.respins_initial || 3;
  const orbLandBase = F_HNW.orb_land_chance_base || 0.04;
  const orbLandFill = F_HNW.orb_land_chance_fill_bonus || 0;
  const fullGridBonus = F_HNW.full_grid_bonus_x || 0;
  const cashDist = F_HNW.cash_value_distribution || [{ value: 1, weight: 1 }];
  const jackpots = F_HNW.jackpot_tiers || [];
  const unifiedPool = [
    ...cashDist.map((c) => ({ value: c.value, weight: Math.max(0, c.weight) })),
    ...jackpots.map((j) => ({ value: j.multiplier, weight: Math.max(0, j.weight) })),
  ];
  const totalCells = REELS * ROWS;
  let filled = Math.min(initialOrbCount, totalCells);
  let total = 0;
  for (let i = 0; i < filled; i++) total += pickWeighted(rng, unifiedPool);
  let respins = respinsInitial;
  while (respins > 0 && filled < totalCells) {
    let landed = 0;
    const free = totalCells - filled;
    const filledFrac = filled / totalCells;
    const p = orbLandBase + orbLandFill * filledFrac;
    for (let c = 0; c < free; c++) {
      if (rng() < p) { total += pickWeighted(rng, unifiedPool); landed++; }
    }
    filled += landed;
    if (landed > 0 && F_HNW.respin_reset_on_new) respins = respinsInitial;
    else respins--;
  }
  if (filled >= totalCells && fullGridBonus > 0) total += fullGridBonus;
  return total;
}

// ────────────────────────────────────────────────────────────────────────
//  Main MC loop
// ────────────────────────────────────────────────────────────────────────

const rng = makeRng(SEED);
let totalWagered = 0, totalWon = 0, hits = 0, maxWin = 0;
let baseSum = 0, scatterSum = 0, lightningSum = 0, fsSum = 0, hnwSum = 0;
let fsTriggers = 0, hnwTriggers = 0, lightningHits = 0;
let mean = 0, m2 = 0, k = 0;
const t0 = performance.now();

for (let i = 0; i < SPINS; i++) {
  totalWagered += 1;
  const grid = drawGrid(rng, BASE_REELS);
  const result = evalBase(grid);
  baseSum += result.lineTotal;              // pure line wins bucket
  scatterSum += result.scatterPay;          // scatter pay bucket
  let lineWin = result.lineTotal;           // 1 unit of bet
  let lightning = 1;
  if ((lineWin > 0 || result.scatterPay > 0) && F_MUL) {
    lightning = rollLightning(rng);
    if (lightning > 1) {
      const uplift = lineWin * (lightning - 1);  // uplift on line wins only
      lineWin = lineWin * lightning;
      lightningSum += uplift;
      lightningHits++;
    }
  }
  let spinWin = lineWin + result.scatterPay;
  let fsWin = 0;
  if (F_FS && result.scCount >= 3) {
    fsWin = runFreeSpinsHeadless(rng, result.scCount);
    spinWin += fsWin;
    fsSum += fsWin;
    fsTriggers++;
  }
  let hnwWin = 0;
  if (F_HNW && result.bonusCount >= (F_HNW.trigger?.min || 6)) {
    hnwWin = runHoldAndWinHeadless(rng, result.bonusCount);
    spinWin += hnwWin;
    hnwSum += hnwWin;
    hnwTriggers++;
  }
  if (spinWin > WIN_CAP) spinWin = WIN_CAP;
  totalWon += spinWin;
  if (spinWin > 0) hits++;
  if (spinWin > maxWin) maxWin = spinWin;
  k++;
  const delta = spinWin - mean;
  mean += delta / k;
  m2 += delta * (spinWin - mean);
}
const dt = (performance.now() - t0) / 1000;
const rtp = totalWon / totalWagered;
const sigma = Math.sqrt(m2 / (k - 1));
const stderrRtp = sigma / Math.sqrt(k);

const target = IR.validated_metrics;
const alloc = IR.rtp_allocation;

console.log(`\n  Pattern-WO — runtime.js algorithm headless MC`);
console.log(`  ────────────────────────────────────────────────────────`);
console.log(`  Spins:               ${SPINS.toLocaleString()}  (${(SPINS / dt / 1e6).toFixed(2)} M/sec, ${dt.toFixed(2)}s wall)`);
console.log(`  Seed:                ${SEED}`);
console.log(``);
console.log(`  ┌─────────────────────────────────────────────────────────┐`);
console.log(`  │                Measured        Target        Delta      │`);
console.log(`  ├─────────────────────────────────────────────────────────┤`);
const fmt = (m, t, unit = 'pp') => {
  const d = m - t;
  const sign = d >= 0 ? '+' : '';
  return `${m.toFixed(4)}%   ${t.toFixed(4)}%   ${sign}${d.toFixed(4)}${unit}`;
};
console.log(`  │ RTP             ${fmt(rtp * 100, target.rtp)} │`);
console.log(`  │ Hit             ${fmt((hits / SPINS) * 100, target.hit_rate)} │`);
console.log(`  │ σ                 ${sigma.toFixed(4)}        ${target.volatility_index.toFixed(4)}      ${(sigma - target.volatility_index >= 0 ? '+' : '') + (sigma - target.volatility_index).toFixed(4)}     │`);
const fsFreq = fsTriggers > 0 ? SPINS / fsTriggers : Infinity;
const hnwFreq = hnwTriggers > 0 ? SPINS / hnwTriggers : Infinity;
console.log(`  │ FS  freq        1-in-${fsFreq.toFixed(2).padStart(7)}  1-in-${target.fs_frequency.toFixed(2).padStart(7)}    delta ${(fsFreq - target.fs_frequency).toFixed(2).padStart(7)} │`);
console.log(`  │ H&W freq        1-in-${hnwFreq.toFixed(2).padStart(7)}  1-in-${target.hnw_frequency.toFixed(2).padStart(7)}    delta ${(hnwFreq - target.hnw_frequency).toFixed(2).padStart(7)} │`);
console.log(`  └─────────────────────────────────────────────────────────┘`);
console.log(``);
console.log(`  Statistical confidence:`);
console.log(`    σ                  ${sigma.toFixed(4)}    (per-spin payout in bet units)`);
console.log(`    stderr(RTP)        ${(stderrRtp * 100).toFixed(4)}pp`);
console.log(`    CI95(RTP)          ${((rtp - 1.96 * stderrRtp) * 100).toFixed(4)}%  …  ${((rtp + 1.96 * stderrRtp) * 100).toFixed(4)}%`);
console.log(`    max-win observed   ${maxWin.toFixed(2)}×  (cap ${WIN_CAP}×)`);
console.log(``);
console.log(`  Per-bucket RTP allocation (vs IR.rtp_allocation):`);
const baseLineRtp = baseSum / totalWagered;
const scatterRtp = scatterSum / totalWagered;
const lightningRtp = lightningSum / totalWagered;
const fsRtp = fsSum / totalWagered;
const hnwRtp = hnwSum / totalWagered;
const sumRtp = baseLineRtp + scatterRtp + lightningRtp + fsRtp + hnwRtp;
const fmtBucket = (label, m, t) => {
  const d = (m - t) * 100;
  return `    ${label.padEnd(22)} ${(m * 100).toFixed(4)}%    target ${(t * 100).toFixed(4)}%    delta ${d >= 0 ? '+' : ''}${d.toFixed(4)}pp`;
};
console.log(fmtBucket('base_line_wins',    baseLineRtp,  alloc.base_line_wins));
console.log(fmtBucket('scatter_pays',      scatterRtp,   alloc.scatter_pays));
console.log(fmtBucket('lightning_uplift',  lightningRtp, alloc.lightning_uplift));
console.log(fmtBucket('free_spins',        fsRtp,        alloc.free_spins));
console.log(fmtBucket('hold_and_win',      hnwRtp,       alloc.hold_and_win));
console.log(`    ──────────────────────────────────────────────────────────────────────`);
console.log(`    TOTAL                 ${(sumRtp * 100).toFixed(4)}%    target ${(alloc.total_cf * 100).toFixed(4)}%    delta ${(sumRtp - alloc.total_cf) * 100 >= 0 ? '+' : ''}${((sumRtp - alloc.total_cf) * 100).toFixed(4)}pp`);
console.log(``);
console.log(`  Industry tolerance ±0.05pp on total RTP — ${Math.abs(rtp * 100 - target.rtp) < 0.05 ? '✓ PASS' : '✗ FAIL'}`);
console.log(`  Loose tolerance    ±0.50pp on total RTP — ${Math.abs(rtp * 100 - target.rtp) < 0.50 ? '✓ PASS' : '✗ FAIL'}`);
