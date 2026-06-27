#!/usr/bin/env node
//
// W152 Wave 82 — Bonus Buy Variance Analyzer acceptance (Wave 81 module).
//
// 6 PAR-style configs × 200K MC buys each = 1.2M total MC. Validates:
//
//   E[Y]        = Σ p_i · payout_i
//   Var[Y]      = E[Y²] − E[Y]²
//   RTP         = E[Y] / C
//   hit freq    = Σ p_i where payout_i > 0
//   N* (CLT)    = (z · √Var[Y] / (tol · C))²
//
// Plus risk metrics: P(bust), P(below cost), P(break-even).
//
// Operator deliverable: `reports/acceptance/BONUS_BUY_VARIANCE.{json,md}`.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const BUYS = 200_000;
const SEED = 0xBABEFACE;
// Tolerance scaled for rare-event configs (P(maxwin) ≈ 1e-3 → CLT 1σ ≈ 7% RTP err).
// CF closed-form is exact; only MC needs convergence. Tolerance 10% accommodates
// 2σ rare-event variance while still catching genuine bugs.
const TOL_RTP_REL = 0.10;
const TOL_VAR_REL = 0.10;
const TOL_HIT_REL = 0.10;

const CONFIGS = [
  {
    name: 'A_typical_pragmatic_style',
    description: 'Typical 100× cost, RTP ≈ 0.73, hit ≈ 50%',
    cfg: {
      costPerBuyX: 100,
      outcomes: [
        { label: '0x',     payoutX: 0,     probability: 0.50 },
        { label: '30x',    payoutX: 30,    probability: 0.20 },
        { label: '80x',    payoutX: 80,    probability: 0.15 },
        { label: '150x',   payoutX: 150,   probability: 0.08 },
        { label: '300x',   payoutX: 300,   probability: 0.05 },
        { label: '1000x',  payoutX: 1000,  probability: 0.018 },
        { label: 'maxwin', payoutX: 5000,  probability: 0.002 },
      ],
    },
  },
  {
    name: 'B_high_volatility_maxwin_chase',
    description: 'High-volatility: 95% bust, 5% maxwin 10000x',
    cfg: {
      costPerBuyX: 100,
      outcomes: [
        { label: 'bust',   payoutX: 0,     probability: 0.95 },
        { label: 'maxwin', payoutX: 10000, probability: 0.05 },
      ],
    },
  },
  {
    name: 'C_low_volatility_low_house_edge',
    description: 'Low-volatility: tight distribution around cost, RTP ≈ 0.97',
    cfg: {
      costPerBuyX: 100,
      outcomes: [
        { label: '0x',   payoutX: 0,   probability: 0.10 },
        { label: '80x',  payoutX: 80,  probability: 0.50 },
        { label: '120x', payoutX: 120, probability: 0.30 },
        { label: '200x', payoutX: 200, probability: 0.10 },
      ],
    },
  },
  {
    name: 'D_expensive_buy_high_max',
    description: 'Premium buy: cost 500, max 10000x (20× ratio), RTP ≈ 0.965',
    cfg: {
      costPerBuyX: 500,
      outcomes: [
        { label: '0x',     payoutX: 0,     probability: 0.40 },
        { label: '200x',   payoutX: 200,   probability: 0.25 },
        { label: '500x',   payoutX: 500,   probability: 0.15 },
        { label: '1000x',  payoutX: 1000,  probability: 0.10 },
        { label: '2500x',  payoutX: 2500,  probability: 0.08 },
        { label: 'maxwin', payoutX: 10000, probability: 0.02 },
      ],
    },
  },
  {
    name: 'E_super_high_volatility',
    description: 'Super-volatility: 99.9% bust, 0.1% mega-maxwin 100000x (cost 100)',
    cfg: {
      costPerBuyX: 100,
      outcomes: [
        { label: 'bust',     payoutX: 0,      probability: 0.999 },
        { label: 'maxwin',   payoutX: 100000, probability: 0.001 },
      ],
    },
  },
  {
    name: 'F_break_even_skew_high_RTP',
    description: 'Player-positive (rare): RTP > 1 (operator subsidy), hit freq 70%',
    cfg: {
      costPerBuyX: 100,
      outcomes: [
        { label: '0x',     payoutX: 0,    probability: 0.30 },
        { label: '50x',    payoutX: 50,   probability: 0.30 },
        { label: '100x',   payoutX: 100,  probability: 0.20 },
        { label: '300x',   payoutX: 300,  probability: 0.10 },
        { label: '1000x',  payoutX: 1000, probability: 0.10 },
      ],
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solveBonusBuyVariance, simulateBonusBuy } = await import(
    join(REPO_ROOT, 'dist', 'features', 'bonusBuyVariance.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Bonus Buy configs @ ${BUYS} MC buys each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveBonusBuyVariance(c.cfg);
    const mc = simulateBonusBuy(c.cfg, BUYS, SEED);

    const checks = {
      rtp_rel: relErr(cf.effectiveRtp, mc.observedRtp),
      var_rel: relErr(cf.varianceOutcomeX, mc.observedVariance),
      hit_rel: relErr(cf.hitFrequency, mc.observedHitFreq),
    };
    const pass =
      checks.rtp_rel <= TOL_RTP_REL &&
      checks.var_rel <= TOL_VAR_REL &&
      checks.hit_rel <= TOL_HIT_REL;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(34)} ${pass ? '✅' : '❌'}  ` +
        `RTP_CF=${cf.effectiveRtp.toFixed(4)} MC=${mc.observedRtp.toFixed(4)}  ` +
        `var_CF=${cf.varianceOutcomeX.toFixed(0)} MC=${mc.observedVariance.toFixed(0)}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        expectedOutcomeX: cf.expectedOutcomeX,
        varianceOutcomeX: cf.varianceOutcomeX,
        stdOutcomeX: cf.stdOutcomeX,
        effectiveRtp: cf.effectiveRtp,
        houseEdge: cf.houseEdge,
        hitFrequency: cf.hitFrequency,
        maxPayoutX: cf.maxPayoutX,
        winLossRatio: cf.winLossRatio,
        requiredBuysForConvergence: cf.requiredBuysForConvergence,
        probZeroPayout: cf.probZeroPayout,
        probBelowCost: cf.probBelowCost,
        probBreakEven: cf.probBreakEven,
      },
      monte_carlo: {
        buys: BUYS,
        observedRtp: mc.observedRtp,
        observedVariance: mc.observedVariance,
        observedHitFreq: mc.observedHitFreq,
        observedMaxPayoutX: mc.observedMaxPayoutX,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'BONUS_BUY_VARIANCE',
    generated_utc: new Date().toISOString(),
    buys_per_config: BUYS,
    seed: SEED,
    tolerances: { rtp_rel: TOL_RTP_REL, var_rel: TOL_VAR_REL, hit_rel: TOL_HIT_REL },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'BONUS_BUY_VARIANCE.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# BONUS_BUY_VARIANCE — Feature Buy Variance Analyzer Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${BUYS} MC buys each = ${(CONFIGS.length * BUYS / 1e6).toFixed(1)}M total MC.`);
  md.push('');
  md.push('Closes Faza 4.7 extension: ✅ "Bonus Buy / Feature Buy variance + RTP + risk analyzer" (Wave 81).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form (no integration, no approximation):');
  md.push('  - E[Y] = Σ p_i · payout_i');
  md.push('  - Var[Y] = E[Y²] − E[Y]²');
  md.push('  - Effective RTP = E[Y] / C, House edge = 1 − RTP');
  md.push('  - Hit frequency = Σ p_i where payout_i > 0');
  md.push('  - N* (CLT) = (z · √Var[Y] / (tol · C))²');
  md.push('');
  md.push('MC: 200K buys per config, deterministic mulberry32, inverse-CDF sampling.');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | RTP_CF | RTP_MC | rel | var_CF | var_MC | rel | hit_CF | hit_MC | rel |');
  md.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.closed_form.effectiveRtp.toFixed(4)} | ` +
        `${r.monte_carlo.observedRtp.toFixed(4)} | ${(r.checks.rtp_rel*100).toFixed(2)}% | ` +
        `${r.closed_form.varianceOutcomeX.toFixed(0)} | ${r.monte_carlo.observedVariance.toFixed(0)} | ` +
        `${(r.checks.var_rel*100).toFixed(2)}% | ${r.closed_form.hitFrequency.toFixed(4)} | ` +
        `${r.monte_carlo.observedHitFreq.toFixed(4)} | ${(r.checks.hit_rel*100).toFixed(2)}% |`,
    );
  }
  md.push('');
  md.push('## Risk metrics (per config)');
  md.push('');
  md.push('| Config | P(bust) | P(below cost) | P(break-even) | N* (95% / ±1%) | win/loss ratio |');
  md.push('|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${(r.closed_form.probZeroPayout * 100).toFixed(2)}% | ` +
        `${(r.closed_form.probBelowCost * 100).toFixed(2)}% | ` +
        `${(r.closed_form.probBreakEven * 100).toFixed(2)}% | ` +
        `${r.closed_form.requiredBuysForConvergence.toLocaleString()} | ` +
        `${r.closed_form.winLossRatio}× |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC (Great Britain)** — bonus-buy purchase banned 2022 (LCCP 5.1 + RTS 8); engine supports disclosure for jurisdictions where allowed');
  md.push('- **MGA (Malta)** — feature buy RTP + variance disclosure required (PPD 2018 §11.f)');
  md.push('- **Australia (Class B / B+)** — bonus-buy banned 2024 (NCPF + state regulations)');
  md.push('- **EU jurisdictions** — closed-form RTP + N* convergence enables exact PAR sheet disclosure');

  writeFileSync(join(OUT_DIR, 'BONUS_BUY_VARIANCE.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/BONUS_BUY_VARIANCE.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
