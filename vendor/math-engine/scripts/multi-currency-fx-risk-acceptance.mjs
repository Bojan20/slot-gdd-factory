#!/usr/bin/env node
//
// W232 — Multi-Currency FX Settlement Risk Analyzer acceptance.
//
// 6 multi-currency operator configs × 3K MC T-day correlated P&L paths.
// Markowitz portfolio variance closed-form cross-validated against MC sa
// Cholesky-correlated normal draws.
//
// Operator deliverable: `reports/acceptance/MULTI_CURRENCY_FX_RISK.{json,md}`.
//
// Compliance: UKGC RTS 16 + MGA Treasury Standards §30 + EU EBA FX Risk
// Reporting 2024 Annex X + AU NCPF Schedule 13 + IFRS 7 §31-42 + Basel III FRTB.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const EPISODES = 3_000;
const SEED = 0xCAFE0232;

const TOL_STD_REL = 0.10;
const TOL_VAR_FACTOR = 1.5;

const CONFIGS = [
  {
    name: 'A_uk_operator_GBP_EUR_USD',
    description: 'UK operator: £1M/€600K/$400K daily volumes, moderate correlations',
    cfg: {
      currencies: ['GBP', 'EUR', 'USD'],
      dailyVolumes: [1_000_000, 600_000, 400_000],
      dailyVolatilities: [0.005, 0.006, 0.007],
      correlationMatrix: [[1.0, 0.6, 0.5], [0.6, 1.0, 0.7], [0.5, 0.7, 1.0]],
      varConfidenceLevel: 0.99,
      varHorizonDays: 10,
      hedgeRatios: [0.3, 0.5, 0.4],
      basisRisk: 0.10,
      hedgingCostPerAnnum: 0.001,
      operatorOwnFunds: 10_000_000,
    },
    regime: 'UK_BASELINE',
  },
  {
    name: 'B_eu_5_currencies_diversified',
    description: 'EU diversified: 5 currencies, moderate hedging, EU EBA reporting',
    cfg: {
      currencies: ['EUR', 'GBP', 'USD', 'CHF', 'SEK'],
      dailyVolumes: [800_000, 500_000, 400_000, 200_000, 100_000],
      dailyVolatilities: [0.005, 0.005, 0.006, 0.004, 0.006],
      correlationMatrix: [
        [1.0, 0.7, 0.6, 0.5, 0.4],
        [0.7, 1.0, 0.6, 0.4, 0.3],
        [0.6, 0.6, 1.0, 0.4, 0.3],
        [0.5, 0.4, 0.4, 1.0, 0.5],
        [0.4, 0.3, 0.3, 0.5, 1.0],
      ],
      varConfidenceLevel: 0.99,
      varHorizonDays: 10,
      hedgeRatios: [0.5, 0.5, 0.5, 0.4, 0.3],
      basisRisk: 0.10,
      hedgingCostPerAnnum: 0.0012,
      operatorOwnFunds: 50_000_000,
    },
    regime: 'EU_DIVERSIFIED',
  },
  {
    name: 'C_au_AUD_NZD_exotic_basket',
    description: 'AU operator: AUD-anchored sa NZD + Asian exotics (THB, IDR)',
    cfg: {
      currencies: ['AUD', 'NZD', 'THB', 'IDR'],
      dailyVolumes: [600_000, 200_000, 100_000, 80_000],
      dailyVolatilities: [0.007, 0.008, 0.012, 0.015],
      correlationMatrix: [
        [1.0, 0.8, 0.3, 0.2],
        [0.8, 1.0, 0.3, 0.2],
        [0.3, 0.3, 1.0, 0.4],
        [0.2, 0.2, 0.4, 1.0],
      ],
      varConfidenceLevel: 0.99,
      varHorizonDays: 10,
      hedgeRatios: [0.4, 0.4, 0.2, 0.2],
      basisRisk: 0.15,
      hedgingCostPerAnnum: 0.0015,
      operatorOwnFunds: 8_000_000,
    },
    regime: 'AU_EXOTIC',
  },
  {
    name: 'D_global_high_concentration_single_USD',
    description: 'Corner: USD-dominant (HHI > 0.7) — concentration compliance fail',
    cfg: {
      currencies: ['USD', 'GBP', 'EUR'],
      dailyVolumes: [9_000_000, 500_000, 500_000],
      dailyVolatilities: [0.006, 0.005, 0.006],
      correlationMatrix: [[1.0, 0.5, 0.6], [0.5, 1.0, 0.7], [0.6, 0.7, 1.0]],
      varConfidenceLevel: 0.99,
      varHorizonDays: 10,
      hedgeRatios: [0.5, 0.5, 0.5],
      basisRisk: 0.10,
      hedgingCostPerAnnum: 0.001,
      operatorOwnFunds: 50_000_000,
    },
    regime: 'CORNER_CONCENTRATION',
  },
  {
    name: 'E_crypto_exposure_high_vol',
    description: 'Crypto operator: 30% BTC/ETH exposure sa 2-4% daily σ',
    cfg: {
      currencies: ['USD', 'BTC', 'ETH'],
      dailyVolumes: [500_000, 300_000, 200_000],
      dailyVolatilities: [0.006, 0.04, 0.05],
      correlationMatrix: [[1.0, 0.1, 0.1], [0.1, 1.0, 0.85], [0.1, 0.85, 1.0]],
      varConfidenceLevel: 0.99,
      varHorizonDays: 10,
      hedgeRatios: [0.5, 0.3, 0.3],
      basisRisk: 0.20,
      hedgingCostPerAnnum: 0.003,
      operatorOwnFunds: 20_000_000,
    },
    regime: 'CRYPTO_HEAVY',
  },
  {
    name: 'F_corner_full_hedging_zero_risk',
    description: 'Corner: full hedging (h=1) sa basisRisk=0.02 — near-zero VaR',
    cfg: {
      currencies: ['GBP', 'EUR', 'USD'],
      dailyVolumes: [1_000_000, 600_000, 400_000],
      dailyVolatilities: [0.005, 0.006, 0.007],
      correlationMatrix: [[1.0, 0.6, 0.5], [0.6, 1.0, 0.7], [0.5, 0.7, 1.0]],
      varConfidenceLevel: 0.99,
      varHorizonDays: 10,
      hedgeRatios: [1.0, 1.0, 1.0],
      basisRisk: 0.02,
      hedgingCostPerAnnum: 0.003,
      operatorOwnFunds: 10_000_000,
    },
    regime: 'CORNER_FULL_HEDGE',
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1);
}

async function main() {
  const { solveMultiCurrencyFxRisk, simulateMultiCurrencyFxRisk } = await import(
    join(REPO_ROOT, 'dist', 'features', 'multiCurrencyFxRisk.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} FX risk configs @ ${EPISODES} MC T-day paths each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveMultiCurrencyFxRisk(c.cfg);
    const mc = simulateMultiCurrencyFxRisk(c.cfg, SEED, EPISODES);

    const cfHedgedStd = Math.sqrt(cf.hedgedPortfolioVariance);
    const stdRel = cfHedgedStd > 1 ? relErr(cfHedgedStd, mc.observedPortfolioStd) : 0;
    const varRatio =
      cf.varAlphaTHorizonHedged > 1
        ? mc.observedVarAlphaTHorizon / cf.varAlphaTHorizonHedged
        : 1;
    const varOK = varRatio >= 1 / TOL_VAR_FACTOR && varRatio <= TOL_VAR_FACTOR;

    const checks = {
      std_rel: stdRel,
      var_ratio: varRatio,
    };

    const pass = stdRel <= TOL_STD_REL && varOK;
    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;

    console.log(
      `  ${c.name.padEnd(40)} ${pass ? '✅' : '❌'}  ` +
        `${c.regime.padEnd(20)} N=${c.cfg.currencies.length} V=£${(cf.totalPortfolioValue / 1000).toFixed(0)}K  ` +
        `unhedged_VaR=£${cf.varAlphaTHorizonUnhedged.toFixed(0)} hedged_VaR=£${cf.varAlphaTHorizonHedged.toFixed(0)}  ` +
        `HHI=${cf.concentrationIndex.toFixed(2)}  ` +
        `hedge_cost=£${cf.totalAnnualHedgingCost.toFixed(0)}/y  ` +
        `comply=${cf.isCompliantUkgcRts16}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      regime: c.regime,
      cfg: c.cfg,
      closed_form: {
        totalPortfolioValue: cf.totalPortfolioValue,
        portfolioVariance: cf.portfolioVariance,
        portfolioStd: cf.portfolioStd,
        hedgedPortfolioVariance: cf.hedgedPortfolioVariance,
        zScoreForVar: cf.zScoreForVar,
        varAlphaTHorizonUnhedged: cf.varAlphaTHorizonUnhedged,
        varAlphaTHorizonHedged: cf.varAlphaTHorizonHedged,
        expectedShortfallAlphaTHorizon: cf.expectedShortfallAlphaTHorizon,
        totalAnnualHedgingCost: cf.totalAnnualHedgingCost,
        concentrationIndex: cf.concentrationIndex,
        ifrs7SensitivityShock10pct: cf.ifrs7SensitivityShock10pct,
        optimalHedgeRatios: cf.optimalHedgeRatios,
        isCompliantUkgcRts16: cf.isCompliantUkgcRts16,
      },
      monte_carlo: {
        episodes: EPISODES,
        observedPortfolioStd: mc.observedPortfolioStd,
        observedVarAlphaTHorizon: mc.observedVarAlphaTHorizon,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'MULTI_CURRENCY_FX_RISK',
    generated_utc: new Date().toISOString(),
    episodes_per_config: EPISODES,
    seed: SEED,
    tolerances: { std_rel: TOL_STD_REL, var_factor: TOL_VAR_FACTOR },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(
    join(OUT_DIR, 'MULTI_CURRENCY_FX_RISK.json'),
    JSON.stringify(summary, null, 2),
  );

  const md = [];
  md.push('# MULTI_CURRENCY_FX_RISK — Multi-Currency FX Settlement Risk Analyzer Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${EPISODES} MC T-day correlated P&L paths each.`);
  md.push('');
  md.push('Closes W232 — **89. closed-form solver, first TREASURY/FX RISK kernel** u portfolio (UKGC RTS 16 + MGA Treasury §30 + EU EBA FX 2024 Annex X + AU NCPF Sch.13 + IFRS 7 §31-42 + Basel III FRTB).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Markowitz mean-variance portfolio:');
  md.push('  - **Var[ΔV] = Σ_i Σ_j V_i · V_j · σ_i · σ_j · ρ_{ij}** (quadratic form)');
  md.push('');
  md.push('Basel III T-day VaR:');
  md.push('  - **VaR_α(T) = z_α · √T · √Var[ΔV]**');
  md.push('  - z_α via Beasley-Springer-Moro (1e-9 accuracy)');
  md.push('');
  md.push('Expected Shortfall (CVaR, coherent):');
  md.push('  - **ES_α = √T · √Var · φ(z_α) / (1 − α) ≥ VaR_α**');
  md.push('');
  md.push('Hedging:');
  md.push('  - σ_effective = σ · (1 − h + h · basisRisk)');
  md.push('  - hedgingCost = c · |V| · h annualized');
  md.push('');
  md.push('IFRS 7 §40 sensitivity disclosure: 10% per-currency shock.');
  md.push('');
  md.push('Herfindahl-Hirschman concentration: HHI = Σ (V_i/V_total)².');
  md.push('');
  md.push('UKGC RTS 16: VaR < 50% ownFunds ∧ HHI < 0.7.');
  md.push('');
  md.push('MC: 3K T-day P&L paths × Cholesky-correlated Normal draws.');
  md.push('');
  md.push('## Results');
  md.push('');
  md.push('| config | regime | N | portfolio | unhedged VaR | hedged VaR | HHI | hedge cost/y | comply | pass |');
  md.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.regime} | ${r.cfg.currencies.length} | ${r.closed_form.totalPortfolioValue.toFixed(0)} | ${r.closed_form.varAlphaTHorizonUnhedged.toFixed(0)} | ${r.closed_form.varAlphaTHorizonHedged.toFixed(0)} | ${r.closed_form.concentrationIndex.toFixed(2)} | ${r.closed_form.totalAnnualHedgingCost.toFixed(0)} | ${r.closed_form.isCompliantUkgcRts16 ? '✅' : '❌'} | ${r.pass ? '✅' : '❌'} |`,
    );
  }
  md.push('');
  md.push('## Tolerance bands');
  md.push('');
  md.push('| metric | tolerance |');
  md.push('|---|---|');
  md.push(`| hedged portfolioStd rel CF vs MC | ≤ ${TOL_STD_REL} |`);
  md.push(`| VaR ratio CF vs MC | factor ${TOL_VAR_FACTOR} (empirical quantile variance) |`);
  md.push('');
  md.push('## Conclusion');
  md.push('');
  md.push(`**Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}**`);
  md.push('');
  md.push('Engine ships closed-form multi-currency FX VaR kernel ready for UKGC RTS 16 + MGA Treasury + EU EBA FX Risk Reporting + AU NCPF + IFRS 7 + Basel III FRTB audit submission. **89. solver — first TREASURY/FX RISK kernel** u portfolio. Komplementarno sa W227 (single-currency GGR VaR) — ovaj proširuje na multi-currency treasury-side FX exposure sa Markowitz covariance + hedging optimization + IFRS 7 disclosure.');

  writeFileSync(join(OUT_DIR, 'MULTI_CURRENCY_FX_RISK.md'), md.join('\n'));

  console.log('');
  console.log(`${allOK ? '✅' : '❌'} ${summary.configs_passed}/${summary.configs_total} configs PASS  →  reports/acceptance/MULTI_CURRENCY_FX_RISK.{json,md}`);

  process.exit(allOK ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
