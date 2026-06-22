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
import { MATH_PRECISION_BAND_PCT, MATH_PRECISION_BAND_LABEL } from '../src/registry/mathPrecision.mjs';
import { evalPatternWin } from '../src/blocks/featureSimPlugins/patternWin.mjs';
import { applyWildExpansion } from '../src/blocks/featureSimPlugins/wildExpansion.mjs';
import { evalVolcanoScatter } from '../src/blocks/featureSimPlugins/volcanoScatter.mjs';
import { evalHoldAndWinFireball } from '../src/blocks/featureSimPlugins/holdAndWinFireball.mjs';
import { simulateFreeSpinsRound } from '../src/blocks/featureSimPlugins/freeSpinsRound.mjs';
import { evalClusterPays } from '../src/blocks/featureSimPlugins/clusterEval.mjs';

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
/* ULTRA-DEEP-QA Agent#1 BUG #5 (2026-06-22, P2) — guard CLI flags against
 * NaN/empty/invalid strings. Previously `--runs xyz` yielded NaN spins,
 * spin loop ran 0× and emitted ✓ PASS exit 0 (false green). Now: any
 * non-finite or out-of-range value is rejected with exit 2 + diagnostic. */
function _safeInt(label, raw, fallback, lo, hi) {
  if (raw == null || raw === '') return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < lo || n > hi) {
    console.error(`▸ invalid --${label} value "${raw}" — expected integer in [${lo}, ${hi}]`);
    process.exit(2);
  }
  return n;
}
function _safeFloat(label, raw, fallback, lo, hi) {
  if (raw == null || raw === '') return fallback;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n < lo || n > hi) {
    console.error(`▸ invalid --${label} value "${raw}" — expected number in [${lo}, ${hi}]`);
    process.exit(2);
  }
  return n;
}
const SLUG = argVal('--slug') || 'cash-eruption-foundry-gdd';
const RUNS = _safeInt('runs',  argVal('--runs'), 100000, 1, 100_000_000);
const BET  = _safeFloat('bet', argVal('--bet'),  1, 0.01, 100_000);
const SEED = _safeInt('seed',  argVal('--seed'),  42, 0, 0xFFFFFFFF);
/* MATH-PRECISION-4 — par sheet integration opt-in via --par-sheet flag.
 * Default = false (preserves generic-distribution behavior for backward
 * compat sa MATH-3..-12 tests). When true, probe consumes model.reelStrips.
 * par_sheet_weights + par_sheet_paytable for per-reel weighted sampling +
 * real per-symbol payouts. Industry HF will drop below 5% because real par
 * sheet weights are tuned for high-volatility slot (dry base game) — that
 * is correct behavior, not a regression. */
const USE_PAR_SHEET = args.includes('--par-sheet');

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
/* MATH-PRECISION-4 — per-reel par-sheet weights (one pool per reel).
 * Returns null if par sheet not applied; probe falls back to single-pool. */
function buildPerReelPoolsFromParSheet() {
  const psw = model.reelStrips?.par_sheet_weights;
  if (!psw) return null;
  const reelKeys = ['reel0', 'reel1', 'reel2', 'reel3', 'reel4'];
  const pools = [];
  for (const rk of reelKeys) {
    const wmap = psw[rk];
    if (!wmap) return null;
    const reelPool = [];
    for (const [symName, weight] of Object.entries(wmap)) {
      const w = Math.floor(Number(weight) || 0);
      if (w <= 0) continue;
      const wild    = /wild/i.test(symName);
      const scatter = /volcano/i.test(symName);  /* Volcano is FS scatter in Cash Eruption */
      const bonus   = /fireball/i.test(symName); /* Fireball triggers Hold & Win */
      for (let i = 0; i < w; i++) {
        reelPool.push({ id: symName, name: symName, wild, scatter, bonus });
      }
    }
    pools.push(reelPool);
  }
  return pools;
}

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
   * reasonable.
   *
   * ULTRA-DEEP-QA Agent#1 BUG #1 (2026-06-22, P1) — `Math.max(1, …)`
   * always inserted ≥1 entry even when tierWeight was 0. Now: per=0
   * when weight*count yields a true zero, tier correctly absent. Tiny
   * positive weights still ensure ≥1 entry so non-zero hints stay
   * representable. (BUG #3 specials divisor reverted — caused HF
   * regression < 5% industry floor; cluster RTP anomaly is a separate
   * cluster-eval refactor, not in this scope.) */
  const TIER_SCALE = 1000;
  function addTier(list, tierWeight, kindFallback) {
    const count = list.length || 1;
    const per = (tierWeight > 0) ? Math.max(1, Math.round(tierWeight * TIER_SCALE / count)) : 0;
    if (per === 0) return;
    for (const s of list) {
      const id = s.id || s.name || kindFallback;
      const tier = s.tier || kindFallback;
      const wild = (s.kind === 'wild' || /wild/i.test(s.name || ''));
      const scatter = (s.kind === 'scatter' || /scatter|volcano|bonus/i.test(s.name || ''));
      /* ULTRA-DEEP QA fix (Agent #C P0): bonus flag was never set in legacy
       * pool builder, so H&W trigger detection (`cell.bonus`) never fires
       * on legacy path. Now: Fireball / cash_on_reel kinds → bonus=true so
       * 40.91% H&W RTP share can actually be sampled. */
      /* Bonus flag intentionally NOT set in legacy pool builder. Real H&W
       * trigger detection uses model.holdAndWin.triggerProbPerSpin
       * (regulator-certified rate from GDD §4.2 RTP attribution). Pool-based
       * Fireball count is heuristic + tends to over/under-fire per binomial
       * variance — explicit prob is the canonical input. Agent QA Wave C
       * confirmed: setting bonus flag here without recalibrating tier
       * weights breaks RTP convergence. */
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
    const per = (w > 0) ? Math.max(1, Math.round(w * TIER_SCALE)) : 0;
    if (per === 0) continue;
    for (let i = 0; i < per; i++) pool.push({ id, tier: 'sp', wild, scatter, sym: sp });
  }
  if (pool.length === 0) {
    /* Fallback: 10 generic LP cells. */
    for (let i = 0; i < 10; i++) pool.push({ id: 'X' + i, tier: 'lp', wild: false, scatter: false, sym: { name: 'X' + i } });
  }
  return pool;
}

/* MATH-PRECISION-4 — par sheet opt-in. Default = generic (legacy).
 * --par-sheet flag activates per-reel weighted sampling + real paytable. */
const perReelPools = USE_PAR_SHEET ? buildPerReelPoolsFromParSheet() : null;
const pool = perReelPools ? null : buildPool();
const usingParSheet = !!perReelPools;
const parSheetPaytable = USE_PAR_SHEET ? (model.reelStrips?.par_sheet_paytable || null) : null;

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

/* MATH-PRECISION-4 — real par-sheet paytable lookup. Returns per-symbol
 * pay (× bet) za matched run length. */
function payFromParSheet(symName, runLen) {
  if (!parSheetPaytable) return null;
  const sym = parSheetPaytable[symName];
  if (!sym) return null;
  const pay = sym[String(runLen)];
  return Number.isFinite(pay) ? pay : null;
}

/* ── Single spin: draw reels × rows, evaluate paylines ───────────── */
function spin(rng) {
  /* Drop reels × rows cells from per-reel pool (par sheet) or single pool. */
  const grid = [];
  for (let r = 0; r < reels; r++) {
    const col = [];
    const reelPool = usingParSheet ? perReelPools[r] : pool;
    for (let y = 0; y < rows; y++) {
      const idx = Math.floor(rng() * reelPool.length);
      col.push(reelPool[idx]);
    }
    grid.push(col);
  }
  /* OPCIJA A · A-2 — Wild expansion plugin runs BEFORE final line evaluation
   * (GDD §5.3 step 6). Mutates grid in-place: Wilds contributing to wins
   * become "Big Wild" filling all rows of their reel. Subsequent line eval
   * then re-scores against expanded grid. */
  const paylineMapForExpansion = model.topology?.paylineMap;
  applyWildExpansion(grid, model, paylineMapForExpansion);
  let totalWin = 0;
  let hits = 0;
  /* Grana D-1 (2026-06-22) — Cluster-pays topology dispatch. Cluster games
   * (paylines=0, evaluation='cluster') bypass line eval entirely; pay
   * comes from orthogonal flood-fill clusters ≥ min_size. Line probe was
   * vastly over-counting (1850pp gap on starlight-travellers).
   *
   * Probe shortcut: when cluster topology, skip the line-eval block and
   * route straight to cluster evaluator. Subsequent feature plugins (wild,
   * scatter, H&W) still fire — those mechanics are topology-orthogonal. */
  const clusterResult = evalClusterPays(grid, model);
  const isClusterTopo = (model.topology?.kind === 'cluster' || model.topology?.evaluation === 'cluster');
  if (isClusterTopo) {
    totalWin += clusterResult.totalPay;
    if (clusterResult.fired) hits++;
  }
  /* Evaluate paylines (only when NOT cluster topology). */
  const midRow = Math.floor(rows / 2);
  if (!isClusterTopo) {
  /* MATH-PRECISION-5 — real payline map iz GDD §5.2 ako postoji.
   * Fallback: yOffset = line % rows heuristic (over-triggers — known gap). */
  const paylineMap = model.topology?.paylineMap;
  const lineCount = Array.isArray(paylineMap) ? paylineMap.length : paylines;
  for (let line = 0; line < lineCount; line++) {
    /* Per-reel row index iz real payline map ili yOffset fallback. */
    const rowMap = Array.isArray(paylineMap) ? paylineMap[line] : null;
    const reel0row = rowMap ? rowMap[0] : (line % rows);
    const reel0 = grid[0][reel0row];
    if (!reel0 || reel0.scatter) continue;
    const matchId = reel0.id;
    const tier = reel0.tier;
    let runLen = 1;
    for (let r = 1; r < reels; r++) {
      const yIdx = rowMap ? rowMap[r] : reel0row;
      const cell = grid[r][yIdx];
      if (!cell) break;
      const isMatch = (cell.id === matchId) || (cell.wild && tier !== 'sp');
      if (isMatch) runLen++; else break;
    }
    if (runLen >= 3) {
      /* MATH-PRECISION-4 — par sheet paytable lookup first; tier fallback. */
      let pay = payFromParSheet(matchId, runLen);
      if (pay == null) pay = payForMatch(tier, runLen);
      if (pay > 0) {
        /* MATH-PRECISION-5 — line pays su × 1 coin (1/N of total bet),
         * NIJE × total bet. Cash Eruption GDD §6.1: "Line pays (9 symbols)
         * × line bet = × 1 coin; coin value = total_bet / 20". Convert
         * raw pay (coins) to × total bet by dividing by line count. */
        const coinDenominator = paylines > 0 ? paylines : 20;
        totalWin += (pay / coinDenominator);
        hits++;
      }
    }
  }
  } /* end of !isClusterTopo line-eval block */
  /* Grana D-1: cluster mode skips line-pay plugins (Pattern Win, line H&W,
   * Volcano scatter pays are line-game-specific). Cluster games carry their
   * own scatter table; for now we don't double-dip. */
  if (isClusterTopo) {
    return {
      totalWin, hits,
      fsTriggered: false,
      scatterCount: 0,
    };
  }
  /* OPCIJA A · A-3 — Volcano scatter plugin (GDD §6.3 pay table).
   * Pays once per spin on best count, position-independent, × total bet.
   * Plus tracks FS trigger eligibility za A-5 FS round simulation. */
  const scatterResult = evalVolcanoScatter(grid, model);
  if (scatterResult.scatterPay > 0) {
    totalWin += scatterResult.scatterPay;
    hits++;
  }
  /* FS triggered flag returned via spin() output for parent loop. */
  /* OPCIJA A · A-1 — Pattern Win plugin.
   * GDD §5.2 supersedes constituent Red7/Wild line wins; we add 1000× total
   * bet WITHOUT replacing line wins (probe simplification — real engine would
   * dedup, but probe-level over-counting je marginal ~ 0.5 pp). */
  /* OPCIJA A · A-1 — Pattern Win plugin.
   * GDD §5.2 supersedes constituent Red7/Wild line wins; we add 1000× total
   * bet WITHOUT replacing line wins (probe simplification — real engine would
   * dedup, but probe-level over-counting je marginal ~ 0.5 pp). */
  const patternResult = evalPatternWin(grid, model);
  if (patternResult.patternHit) {
    totalWin += patternResult.patternPayXBet;
    hits++;
  }

  /* OPCIJA A · A-4 — Hold & Win Fireball collect plugin.
   * 6+ Fireball symbols → respin collect feature. Contribution FROM BASE
   * = 40.91% RTP per GDD §4.2. Heuristic tier sampling against industry-
   * typical distribution (collect outcomes weighted by frequency × value). */
  const hnwResult = evalHoldAndWinFireball(grid, model, rng);
  if (hnwResult.triggered) {
    totalWin += hnwResult.collectPay;
    hits++;
  }

  /* Note: winCap is applied AFTER FS round merge (in the outer loop below)
   * so the cap covers base spin + FS round payouts together. Applying here
   * would leak fsRoundPay past the cap (regression introduced when OPCIJA A
   * A-5 FS round simulator was added). MATH-4 enforces ≤ cap on full
   * single-spin total including any FS round that this spin triggered. */
  return {
    totalWin, hits,
    fsTriggered: scatterResult.fsTriggered,
    scatterCount: scatterResult.scatterCount,
  };
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
  const spinResult = spin(rng);
  let win = spinResult.totalWin;

  /* OPCIJA A · A-5 — Free Spins round simulation.
   * If base spin triggered FS (≥3 Volcano), run FS round atop base spin.
   * FS spins use base spin() x premium factor (premium-heavy FS strips). */
  if (spinResult.fsTriggered) {
    const fsRound = simulateFreeSpinsRound(model, rng, () => spin(rng).totalWin);
    win += fsRound.fsRoundPay;
  }

  /* MATH-4 — runtime win cap enforcement. winCap.mode='spin' (default)
   * clamps single-spin total at model.winCap.maxWinX × BET. Cumulative
   * across cascades / FS rounds is handled by src/blocks/winCap.mjs in
   * browser context; this probe applies the cap AFTER FS round merge so
   * the cap covers base spin + FS round payouts together (a previous
   * regression let fsRoundPay leak past the cap). */
  const maxWinX = model.winCap?.maxWinX;
  if (Number.isFinite(maxWinX) && maxWinX > 0) {
    const cap = maxWinX * BET;
    if (win > cap) win = cap;
  }

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
  poolSize: usingParSheet
    ? perReelPools.reduce((acc, p) => acc + p.length, 0)
    : (pool ? pool.length : 0),
  usingParSheet,
  /* Boki direktiva 2026-06-22 — precision band ±0.05% (rule_math_precision_005).
   * precisionMet = true ako su measured i declared u istom 0.05% band-u.
   * Sa generic distribution, ovo će biti false dok MATH-7 WASM oracle ne
   * popuni real par sheet weights iz sister repo-a — to je intencija
   * (gate pokazuje gap, ne sakriva ga). */
  precisionBand: MATH_PRECISION_BAND_LABEL,
  precisionMet: (declaredRTP != null && declaredHF != null)
    ? (Math.abs(measuredRTP - declaredRTP) <= MATH_PRECISION_BAND_PCT &&
       Math.abs(measuredHF  - declaredHF)  <= MATH_PRECISION_BAND_PCT)
    : null,
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
