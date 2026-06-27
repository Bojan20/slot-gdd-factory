#!/usr/bin/env node
//
// W152 Wave 135 — Hold-and-Win Multi-Tier Value-Based Jackpot acceptance (Wave 134).
//
// 6 PAR-style configs × 30K episodes each = 180K total MC episodes.
// Each episode runs Markov respin chain → ~5-50 spins → ~5-9M MC spins total.
//
// Operator deliverable: `reports/acceptance/HOLD_WIN_VALUE_JACKPOT.{json,md}`.
//
// UKGC RTS 14 + MGA PPD §11.f compliance: per-tier hit probability + value
// disclosure za Vendor C Pattern-LL / Buffalo Link / Vendor A Hold & Win.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const EPISODES = 30_000;
const SEED = 0xCAFE0134;
const TOL_FILLED_ABS   = 0.3;    // E[F] abs
const TOL_VALUE_REL    = 0.10;   // E[V_total] rel
const TOL_TIER_ABS     = 0.05;   // tier hit rate abs
const TOL_FULLGRID_ABS = 0.05;   // P(full grid) abs

const CONFIGS = [
  {
    name: 'A_lightning_link_15cell_classic',
    description: 'Vendor C Pattern-LL: 15-cell, 6-trigger, 3 respins, MMM+Grand',
    cfg: {
      gridCells: 15,
      initialFilledCells: 6,
      landingProbabilityPerCell: 0.05,
      maxRespins: 3,
      valuePmf: [
        { value: 1,   probability: 0.55 },
        { value: 2,   probability: 0.20 },
        { value: 5,   probability: 0.12 },
        { value: 10,  probability: 0.08 },
        { value: 50,  probability: 0.04 },
        { value: 200, probability: 0.01 },
      ],
      tiers: [
        { label: 'mini',  thresholdX: 30,  bonusPayoutX: 50 },
        { label: 'minor', thresholdX: 100, bonusPayoutX: 250 },
        { label: 'major', thresholdX: 300, bonusPayoutX: 1000 },
      ],
      fullGridBonusX: 10000,
    },
  },
  {
    name: 'B_igt_hold_win_12cell',
    description: 'Vendor A Hold & Win: 12-cell, 5-trigger, 3 respins',
    cfg: {
      gridCells: 12,
      initialFilledCells: 5,
      landingProbabilityPerCell: 0.08,
      maxRespins: 3,
      valuePmf: [
        { value: 2,  probability: 0.60 },
        { value: 10, probability: 0.30 },
        { value: 50, probability: 0.10 },
      ],
      tiers: [
        { label: 'jp', thresholdX: 100, bonusPayoutX: 500 },
      ],
    },
  },
  {
    name: 'C_buffalo_link_dense_grid',
    description: 'Buffalo Link 4×5=20 cell aggressive landing',
    cfg: {
      gridCells: 20,
      initialFilledCells: 6,
      landingProbabilityPerCell: 0.10,
      maxRespins: 3,
      valuePmf: [
        { value: 1,    probability: 0.55 },
        { value: 5,    probability: 0.25 },
        { value: 25,   probability: 0.15 },
        { value: 100,  probability: 0.04 },
        { value: 1000, probability: 0.01 },
      ],
      tiers: [
        { label: 'mini',  thresholdX: 50,   bonusPayoutX: 100 },
        { label: 'major', thresholdX: 250,  bonusPayoutX: 1000 },
        { label: 'mega',  thresholdX: 1000, bonusPayoutX: 10000 },
      ],
      fullGridBonusX: 25000,
    },
  },
  {
    name: 'D_pragmatic_big_bass_hold_spin',
    description: 'Pragmatic Big Bass Hold & Spin small 9-cell grid',
    cfg: {
      gridCells: 9,
      initialFilledCells: 3,
      landingProbabilityPerCell: 0.12,
      maxRespins: 2,
      valuePmf: [
        { value: 2,   probability: 0.50 },
        { value: 5,   probability: 0.30 },
        { value: 25,  probability: 0.15 },
        { value: 100, probability: 0.05 },
      ],
      tiers: [
        { label: 'jackpot', thresholdX: 100, bonusPayoutX: 500 },
      ],
    },
  },
  {
    name: 'E_high_freq_short_respins',
    description: 'High-freq landing q=0.20, short respins=2, tiny grid',
    cfg: {
      gridCells: 8,
      initialFilledCells: 2,
      landingProbabilityPerCell: 0.20,
      maxRespins: 2,
      valuePmf: [
        { value: 1,  probability: 0.7 },
        { value: 5,  probability: 0.3 },
      ],
      tiers: [
        { label: 'jp', thresholdX: 10, bonusPayoutX: 50 },
      ],
    },
  },
  {
    name: 'F_corner_trigger_equals_grid',
    description: 'Corner: initialFilled = gridCells (game starts full)',
    cfg: {
      gridCells: 9,
      initialFilledCells: 9,
      landingProbabilityPerCell: 0.10,
      maxRespins: 2,
      valuePmf: [{ value: 10, probability: 1 }],
      tiers: [{ label: 'always', thresholdX: 0, bonusPayoutX: 100 }],
      fullGridBonusX: 5000,
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solveHoldWinValueJackpot, simulateHoldWinValueJackpot } = await import(
    join(REPO_ROOT, 'dist', 'features', 'holdWinValueJackpot.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Hold-and-Win Value-Based configs @ ${EPISODES} episodes each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveHoldWinValueJackpot(c.cfg);
    const mc = simulateHoldWinValueJackpot(c.cfg, EPISODES, SEED);

    const filledAbs = Math.abs(cf.expectedFilledCount - mc.observedMeanFilledCount);
    const valueRel = cf.expectedTotalValue > 1e-9
      ? relErr(cf.expectedTotalValue, mc.observedMeanTotalValue)
      : Math.abs(cf.expectedTotalValue - mc.observedMeanTotalValue);
    const fullGridAbs = Math.abs(cf.probFullGridReached - mc.observedFullGridFraction);

    let maxTierAbs = 0;
    for (const t of cf.perTier) {
      const mcRate = (mc.observedTierHits[t.label] ?? 0) / mc.episodes;
      const abs = Math.abs(t.probReachTier - mcRate);
      if (abs > maxTierAbs) maxTierAbs = abs;
    }

    const checks = {
      filled_abs: filledAbs,
      value_rel: valueRel,
      max_tier_abs: maxTierAbs,
      fullgrid_abs: fullGridAbs,
    };
    const pass =
      filledAbs <= TOL_FILLED_ABS &&
      valueRel <= TOL_VALUE_REL &&
      maxTierAbs <= TOL_TIER_ABS &&
      fullGridAbs <= TOL_FULLGRID_ABS;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(38)} ${pass ? '✅' : '❌'}  ` +
        `E[F]_CF=${cf.expectedFilledCount.toFixed(2)} MC=${mc.observedMeanFilledCount.toFixed(2)}  ` +
        `E[V]_CF=${cf.expectedTotalValue.toFixed(2)} MC=${mc.observedMeanTotalValue.toFixed(2)} (rel=${(valueRel * 100).toFixed(1)}%)  ` +
        `fullGrid=${(cf.probFullGridReached * 100).toFixed(2)}%/${(mc.observedFullGridFraction * 100).toFixed(2)}%  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        gridCells: cf.gridCells,
        initialFilledCells: cf.initialFilledCells,
        maxRespins: cf.maxRespins,
        expectedFilledCount: cf.expectedFilledCount,
        probFullGridReached: cf.probFullGridReached,
        expectedTotalValue: cf.expectedTotalValue,
        perTier: cf.perTier,
        probAnyTierReached: cf.probAnyTierReached,
        expectedJackpotPayout: cf.expectedJackpotPayout,
      },
      monte_carlo: {
        episodes: EPISODES,
        observedMeanFilledCount: mc.observedMeanFilledCount,
        observedMeanTotalValue: mc.observedMeanTotalValue,
        observedTierHits: mc.observedTierHits,
        observedFullGridFraction: mc.observedFullGridFraction,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'HOLD_WIN_VALUE_JACKPOT',
    generated_utc: new Date().toISOString(),
    episodes_per_config: EPISODES,
    seed: SEED,
    tolerances: {
      filled_abs: TOL_FILLED_ABS,
      value_rel: TOL_VALUE_REL,
      max_tier_abs: TOL_TIER_ABS,
      fullgrid_abs: TOL_FULLGRID_ABS,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'HOLD_WIN_VALUE_JACKPOT.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# HOLD_WIN_VALUE_JACKPOT — Hold-and-Win Multi-Tier Value-Based Jackpot Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${EPISODES} episodes each = ${(CONFIGS.length * EPISODES / 1e3).toFixed(0)}K total MC episodes.`);
  md.push('');
  md.push('Closes Faza 5 ext (post-W100): ✅ "Hold-and-Win Multi-Tier Value-Based Jackpot" (Wave 134).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form four-step pipeline:');
  md.push('  1. Markov chain (filled, respinsRemaining) → P(F_final = k)');
  md.push('  2. k-fold convolution valuePmf → V_total | F_final=k');
  md.push('  3. P(tier reached) = Σ_k P(F=k) · P(V_total ≥ T_t | F=k)');
  md.push('  4. **E[V_total] = (E[F] − F_init) · E[V]** (industry semantics)');
  md.push('');
  md.push('MC: 30K episodes per config, mulberry32 RNG, episode-driven respin loop sa reset.');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | E[F] | E[V] | P(fullGrid) | P(anyTier) |');
  md.push('|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ` +
        `${r.closed_form.expectedFilledCount.toFixed(2)} | ` +
        `${r.closed_form.expectedTotalValue.toFixed(2)} | ` +
        `${(r.closed_form.probFullGridReached * 100).toFixed(2)}% | ` +
        `${(r.closed_form.probAnyTierReached * 100).toFixed(2)}% |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14** — per-tier hit probability + variance disclosure');
  md.push('- **MGA PPD §11.f** — operator-facing jackpot hit rate');
  md.push('- **eCOGRA Generic Slots Audit** — verifies tier probs match engine');
  md.push('- Industry use: Vendor C Pattern-LL / Buffalo Link, Vendor A Hold & Win,');
  md.push('  SG Money Burst, Pragmatic Big Bass Hold & Spin family.');

  writeFileSync(join(OUT_DIR, 'HOLD_WIN_VALUE_JACKPOT.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/HOLD_WIN_VALUE_JACKPOT.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
