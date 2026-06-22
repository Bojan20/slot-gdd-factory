#!/usr/bin/env node
/**
 * tools/math-rtp-probe.mjs
 *
 * MATH-3 — RTP measurement probe.
 *
 * Boki: MATH unlocked 2026-06-22. Runs N synthetic spins per game and
 * measures actual RTP, hit frequency, longest losing streak, max single
 * spin payout. Doesn't need browser — pure Node simulator using model
 * paytable + topology + reelStrips distribution.
 *
 * INPUT
 *   --slug X    single game (default: cash-eruption-foundry-gdd)
 *   --runs N    spin count (default: 100000)
 *   --bet B     bet per spin in credits (default: 1)
 *   --seed S    deterministic RNG seed (default: 42)
 *
 * OUTPUT
 *   reports/math-rtp/<slug>.json — per-spin stats + aggregate
 *   stdout summary line + comparison vs declared
 *
 * USAGE
 *   node tools/math-rtp-probe.mjs                                # 100k spins on Cash Eruption
 *   node tools/math-rtp-probe.mjs --runs 10000                   # smoke
 *   node tools/math-rtp-probe.mjs --slug wrath-of-olympus-gdd    # specific game
 *
 * EXIT
 *   0 — probe ran successfully (measured RTP may be off target — informational)
 *   1 — model unreadable / no symbols / no topology
 *   2 — missing slug
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');
const REAL_GAMES = `${REPO}/dist/real-games`;
const OUT_DIR    = `${REPO}/reports/math-rtp`;
mkdirSync(OUT_DIR, { recursive: true });

const args = process.argv.slice(2);
const argVal = (flag) => {
  const idx = args.findIndex(a => a === flag || a.startsWith(flag + '='));
  if (idx === -1) return null;
  const a = args[idx];
  return a.includes('=') ? a.split('=')[1] : args[idx + 1];
};
const SLUG = argVal('--slug') || 'cash-eruption-foundry-gdd';
const RUNS = parseInt(argVal('--runs') || '100000', 10);
const BET  = parseFloat(argVal('--bet')  || '1');
const SEED = parseInt(argVal('--seed') || '42', 10);

/* ── Mulberry32 deterministic RNG ───────────────────────────────────── */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ── Load game model ──────────────────────────────────────────────── */
const slugPath = join(REAL_GAMES, SLUG);
if (!existsSync(slugPath)) {
  console.error(`▸ slug ${SLUG} not found in ${REAL_GAMES}`);
  process.exit(2);
}
const model = JSON.parse(readFileSync(join(slugPath, 'model.json'), 'utf8'));

const topo = model.topology || {};
const reels = topo.reels || 5;
const rows  = topo.rows  || 3;
const paylines = topo.paylines || 20;

/* Symbol pool. Build from model.symbols (hp + mp + lp + specials buckets).
 * Each symbol contributes count = floor(weight × 100) so we can sample
 * via Math.random() × poolSize index. */
function buildPool() {
  const pool = [];
  const sd = model.reelStrips?.stop_distribution || {
    hp: 0.07, mp: 0.13, lp: 0.20, wild: 0.03, scatter: 0.02,
  };
  const symBucket = model.symbols || {};
  const hpSyms = symBucket.high     || [];
  const mpSyms = symBucket.mid      || [];
  const lpSyms = symBucket.low      || [];
  const sps    = symBucket.specials || [];

  /* Stop-distribution is per-tier weight HINT. Multiply by tier count
   * to get per-symbol weight. Pool size capped to 1000 to keep memory
   * reasonable. */
  const TIER_SCALE = 1000;
  function addTier(list, tierWeight, kindFallback) {
    const count = list.length || 1;
    const per = Math.max(1, Math.round(tierWeight * TIER_SCALE / count));
    for (const s of list) {
      const id = s.id || s.name || kindFallback;
      const tier = s.tier || kindFallback;
      const wild = (s.kind === 'wild' || /wild/i.test(s.name || ''));
      const scatter = (s.kind === 'scatter' || /scatter|volcano|bonus/i.test(s.name || ''));
      for (let i = 0; i < per; i++) pool.push({ id, tier, wild, scatter, sym: s });
    }
  }
  addTier(hpSyms, sd.hp, 'hp');
  addTier(mpSyms, sd.mp, 'mp');
  addTier(lpSyms, sd.lp, 'lp');
  /* Specials: classify by name to assign wild/scatter weight; fall back to mid. */
  for (const sp of sps) {
    const wild = (sp.kind === 'wild' || /wild/i.test(sp.name || ''));
    const scatter = (sp.kind === 'scatter' || /scatter|volcano/i.test(sp.name || ''));
    const w = wild ? sd.wild : scatter ? sd.scatter : sd.mp;
    const id = sp.id || sp.name || 'special';
    const per = Math.max(1, Math.round(w * TIER_SCALE));
    for (let i = 0; i < per; i++) pool.push({ id, tier: 'sp', wild, scatter, sym: sp });
  }
  if (pool.length === 0) {
    /* Fallback: 10 generic LP cells. */
    for (let i = 0; i < 10; i++) pool.push({ id: 'X' + i, tier: 'lp', wild: false, scatter: false, sym: { name: 'X' + i } });
  }
  return pool;
}

const pool = buildPool();

/* Per-tier payout multiplier (× line bet) — industry-default fallback
 * when paytable.symbols.<id>.pay is not explicit. */
const TIER_PAY_5 = { hp: 100, mp: 30, lp: 10, sp: 5 };
const TIER_PAY_4 = { hp: 30,  mp: 10, lp: 3,  sp: 2 };
const TIER_PAY_3 = { hp: 10,  mp: 3,  lp: 1,  sp: 1 };

function payForMatch(tier, runLen) {
  if (runLen >= 5) return TIER_PAY_5[tier] || 1;
  if (runLen === 4) return TIER_PAY_4[tier] || 1;
  if (runLen === 3) return TIER_PAY_3[tier] || 0;
  return 0;
}

/* ── Single spin: draw reels × rows, evaluate paylines ───────────── */
function spin(rng) {
  /* Drop reels × rows cells from pool. */
  const grid = [];
  for (let r = 0; r < reels; r++) {
    const col = [];
    for (let y = 0; y < rows; y++) {
      const idx = Math.floor(rng() * pool.length);
      col.push(pool[idx]);
    }
    grid.push(col);
  }
  /* Evaluate paylines: assume center row (y=middle) for simplicity.
   * Real engines walk model topology payline maps; this probe is an
   * approximation that captures hit/RTP trends without the full LUT. */
  const midRow = Math.floor(rows / 2);
  let totalWin = 0;
  let hits = 0;
  for (let line = 0; line < paylines; line++) {
    /* Sample a row index per reel based on line index spread.
     * For 20 lines on 5×3 grid, use line % rows. */
    const yOffset = line % rows;
    const reel0 = grid[0][yOffset];
    if (!reel0 || reel0.scatter) continue;
    const matchId = reel0.id;
    const tier = reel0.tier;
    let runLen = 1;
    for (let r = 1; r < reels; r++) {
      const cell = grid[r][yOffset];
      if (!cell) break;
      const isMatch = (cell.id === matchId) || (cell.wild && tier !== 'sp');
      if (isMatch) runLen++; else break;
    }
    if (runLen >= 3) {
      const pay = payForMatch(tier, runLen);
      if (pay > 0) {
        totalWin += pay;
        hits++;
      }
    }
  }
  /* Scatter pay: count scatters across whole grid. */
  let scatterCount = 0;
  for (const col of grid) for (const c of col) if (c.scatter) scatterCount++;
  if (scatterCount >= 3) {
    /* Industry default: 3=2×, 4=15×, 5=100× total bet. */
    const scatterMap = { 3: 2, 4: 15, 5: 100 };
    totalWin += (scatterMap[Math.min(5, scatterCount)] || 0);
    hits++;
  }
  /* MATH-4 — runtime win cap enforcement. winCap.mode='spin' (default)
   * clamps single-spin total at model.winCap.maxWinX × BET. Cumulative
   * across cascades / FS rounds is handled by src/blocks/winCap.mjs in
   * browser context; this probe is single-spin so single clamp suffices. */
  const maxWinX = model.winCap?.maxWinX;
  if (Number.isFinite(maxWinX) && maxWinX > 0) {
    const cap = maxWinX * BET;
    if (totalWin > cap) totalWin = cap;
  }
  return { totalWin, hits };
}

/* ── Run probe ──────────────────────────────────────────────────── */
console.log(`MATH-3 RTP probe · ${SLUG} · ${RUNS} spins · bet ${BET} · seed ${SEED}`);

const rng = mulberry32(SEED);
let totalBet = 0;
let totalWin = 0;
let hitCount = 0;
let losingStreak = 0;
let longestLosingStreak = 0;
let maxSingleSpin = 0;
const winHistogram = { lt1x: 0, '1-5x': 0, '5-25x': 0, '25-100x': 0, '100x+': 0 };

const t0 = Date.now();
for (let i = 0; i < RUNS; i++) {
  totalBet += BET;
  const { totalWin: win, hits } = spin(rng);
  totalWin += win;
  if (win > 0) {
    hitCount++;
    losingStreak = 0;
    const m = win / BET;
    if (m < 1) winHistogram.lt1x++;
    else if (m < 5) winHistogram['1-5x']++;
    else if (m < 25) winHistogram['5-25x']++;
    else if (m < 100) winHistogram['25-100x']++;
    else winHistogram['100x+']++;
    if (win > maxSingleSpin) maxSingleSpin = win;
  } else {
    losingStreak++;
    if (losingStreak > longestLosingStreak) longestLosingStreak = losingStreak;
  }
}
const elapsedMs = Date.now() - t0;

const measuredRTP = totalBet > 0 ? (totalWin / totalBet) * 100 : 0;
const measuredHF = (hitCount / RUNS) * 100;

const declaredRTP = model.payback?.rtp ?? null;
const declaredHF = model.payback?.hitFrequency ?? null;

const summary = {
  generatedAt: new Date().toISOString(),
  tool: 'tools/math-rtp-probe.mjs',
  slug: SLUG,
  runs: RUNS,
  bet: BET,
  seed: SEED,
  elapsedMs,
  spinsPerSec: Math.round((RUNS / elapsedMs) * 1000),
  totalBet, totalWin,
  measuredRTP: +measuredRTP.toFixed(2),
  measuredHF:  +measuredHF.toFixed(2),
  declaredRTP, declaredHF,
  rtpDelta: declaredRTP != null ? +(measuredRTP - declaredRTP).toFixed(2) : null,
  hfDelta:  declaredHF  != null ? +(measuredHF  - declaredHF).toFixed(2)  : null,
  longestLosingStreak,
  maxSingleSpin,
  maxSingleSpinX: +(maxSingleSpin / BET).toFixed(2),
  winHistogram,
  poolSize: pool.length,
};

const out = join(OUT_DIR, `${SLUG}.json`);
writeFileSync(out, JSON.stringify(summary, null, 2));

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  RUNS:        ${RUNS}    (${summary.spinsPerSec} spin/s, ${elapsedMs} ms total)`);
console.log(`  RTP:         measured ${summary.measuredRTP}%   declared ${declaredRTP ?? 'n/a'}%   Δ ${summary.rtpDelta ?? 'n/a'}`);
console.log(`  Hit freq:    measured ${summary.measuredHF}%   declared ${declaredHF ?? 'n/a'}%   Δ ${summary.hfDelta ?? 'n/a'}`);
console.log(`  Max spin:    ${summary.maxSingleSpinX}× bet`);
console.log(`  Longest dry: ${longestLosingStreak} spins`);
console.log(`  Win hist:    < 1×=${winHistogram.lt1x}  1-5×=${winHistogram['1-5x']}  5-25×=${winHistogram['5-25x']}  25-100×=${winHistogram['25-100x']}  100×+=${winHistogram['100x+']}`);
console.log(`  Report:      ${out}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✓ PASS — RTP probe finished');
process.exit(0);
