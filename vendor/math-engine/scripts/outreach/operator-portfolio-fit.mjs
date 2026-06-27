#!/usr/bin/env node
/**
 * W215 — Per-operator Portfolio Fit Calculator.
 *
 * For a given operator, computes:
 *   - weighted coverage % (mechanic-mix weighted)
 *   - per-title savings $
 *   - portfolio velocity uplift
 *   - 5yr NPV ballpark
 *   - payback months
 *
 * Pre-seeded mechanic-mix + portfolio size for all 8 tier-2 operators.
 * Inputs can be overridden via CLI flags (--portfolio-size, --per-title-saving).
 *
 * Outputs (default):
 *   - reports/outreach/PORTFOLIO_FIT_<operator>.json
 *   - reports/outreach/PORTFOLIO_FIT_<operator>.md
 *
 * CLI:
 *   node scripts/outreach/operator-portfolio-fit.mjs --operator aristocrat
 *   node scripts/outreach/operator-portfolio-fit.mjs --operator igt --json
 *   node scripts/outreach/operator-portfolio-fit.mjs --operator konami --portfolio-size 400
 *
 * Pure ESM, no external deps, fully deterministic.
 */

import { promises as fs } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  OPERATORS, MECHANICS, getCell, operatorCoveragePct,
} from './tier2-coverage-matrix.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const REPORTS_DIR = resolve(REPO_ROOT, 'reports', 'outreach');

/**
 * Pre-seeded operator metadata.
 * Mechanic-mix weights sum to 1.0 per operator and reflect the rough
 * proportion of titles in that operator's catalogue that lean on the
 * mechanic as the primary math driver.
 */
export const OPERATOR_SEEDS = {
  aristocrat: {
    portfolioSize: 1200,
    annualShipsPre: 40,
    annualShipsPost: 110,
    perTitleSavingUsd: 220_000,
    mechanicMix: {
      cascade: 0.02, respin: 0.18, hold_and_win: 0.20, cluster: 0.00,
      ways: 0.16, megaways: 0.04, ante_bet: 0.02, buy_feature: 0.00,
      pick_bonus: 0.06, wheel_bonus: 0.08, mystery: 0.10, jackpot: 0.14,
    },
    region: 'AU+NA', priority: 'P0',
  },
  igt: {
    portfolioSize: 900,
    annualShipsPre: 35,
    annualShipsPost: 95,
    perTitleSavingUsd: 210_000,
    mechanicMix: {
      cascade: 0.08, respin: 0.10, hold_and_win: 0.10, cluster: 0.00,
      ways: 0.10, megaways: 0.04, ante_bet: 0.04, buy_feature: 0.05,
      pick_bonus: 0.08, wheel_bonus: 0.20, mystery: 0.08, jackpot: 0.13,
    },
    region: 'NA+EU', priority: 'P0',
  },
  konami: {
    portfolioSize: 330,
    annualShipsPre: 18,
    annualShipsPost: 48,
    perTitleSavingUsd: 185_000,
    mechanicMix: {
      cascade: 0.00, respin: 0.16, hold_and_win: 0.18, cluster: 0.00,
      ways: 0.20, megaways: 0.00, ante_bet: 0.00, buy_feature: 0.06,
      pick_bonus: 0.08, wheel_bonus: 0.08, mystery: 0.12, jackpot: 0.12,
    },
    region: 'NA+APAC', priority: 'P1',
  },
  novomatic: {
    portfolioSize: 850,
    annualShipsPre: 50,
    annualShipsPost: 135,
    perTitleSavingUsd: 190_000,
    mechanicMix: {
      cascade: 0.02, respin: 0.10, hold_and_win: 0.08, cluster: 0.00,
      ways: 0.10, megaways: 0.04, ante_bet: 0.06, buy_feature: 0.12,
      pick_bonus: 0.06, wheel_bonus: 0.04, mystery: 0.22, jackpot: 0.16,
    },
    region: 'EU+CEE', priority: 'P1',
  },
  playtech: {
    portfolioSize: 1000,
    annualShipsPre: 60,
    annualShipsPost: 155,
    perTitleSavingUsd: 185_000,
    mechanicMix: {
      cascade: 0.12, respin: 0.08, hold_and_win: 0.08, cluster: 0.04,
      ways: 0.14, megaways: 0.08, ante_bet: 0.04, buy_feature: 0.10,
      pick_bonus: 0.08, wheel_bonus: 0.06, mystery: 0.06, jackpot: 0.12,
    },
    region: 'EU+UK', priority: 'P1',
  },
  everi: {
    portfolioSize: 280,
    annualShipsPre: 22,
    annualShipsPost: 55,
    perTitleSavingUsd: 160_000,
    mechanicMix: {
      cascade: 0.00, respin: 0.16, hold_and_win: 0.18, cluster: 0.00,
      ways: 0.12, megaways: 0.00, ante_bet: 0.00, buy_feature: 0.00,
      pick_bonus: 0.10, wheel_bonus: 0.12, mystery: 0.16, jackpot: 0.16,
    },
    region: 'NA', priority: 'P2',
  },
  ainsworth: {
    portfolioSize: 220,
    annualShipsPre: 14,
    annualShipsPost: 38,
    perTitleSavingUsd: 140_000,
    mechanicMix: {
      cascade: 0.00, respin: 0.20, hold_and_win: 0.22, cluster: 0.00,
      ways: 0.18, megaways: 0.00, ante_bet: 0.00, buy_feature: 0.00,
      pick_bonus: 0.10, wheel_bonus: 0.10, mystery: 0.10, jackpot: 0.10,
    },
    region: 'AU+NA', priority: 'P2',
  },
  ags: {
    portfolioSize: 180,
    annualShipsPre: 12,
    annualShipsPost: 32,
    perTitleSavingUsd: 150_000,
    mechanicMix: {
      cascade: 0.00, respin: 0.18, hold_and_win: 0.20, cluster: 0.00,
      ways: 0.12, megaways: 0.00, ante_bet: 0.00, buy_feature: 0.00,
      pick_bonus: 0.14, wheel_bonus: 0.10, mystery: 0.12, jackpot: 0.14,
    },
    region: 'NA', priority: 'P2',
  },
};

/** 5yr NPV at discount rate r. Annual savings flow assumed constant. */
export function npvFiveYear(annualSavings, discountRate = 0.10) {
  let npv = 0;
  for (let year = 1; year <= 5; year++) {
    npv += annualSavings / Math.pow(1 + discountRate, year);
  }
  return npv;
}

/** Compute portfolio fit for a given operator with optional overrides. */
export function computePortfolioFit(operator, overrides = {}) {
  const seed = OPERATOR_SEEDS[operator];
  if (!seed) throw new Error(`unknown operator: ${operator}`);

  const portfolioSize = overrides.portfolioSize ?? seed.portfolioSize;
  const perTitleSaving = overrides.perTitleSavingUsd ?? seed.perTitleSavingUsd;
  const annualShipsPre = overrides.annualShipsPre ?? seed.annualShipsPre;
  const annualShipsPost = overrides.annualShipsPost ?? seed.annualShipsPost;
  const discountRate = overrides.discountRate ?? 0.10;

  // Validate mechanic-mix sums to ~1.0
  const mixTotal = Object.values(seed.mechanicMix).reduce((a, b) => a + b, 0);
  if (Math.abs(mixTotal - 1.0) > 0.01) {
    throw new Error(`mechanic-mix for ${operator} sums to ${mixTotal}, expected 1.0`);
  }

  // Weighted coverage: sum over mechanics of (covered ? 1 : 0) * weight
  let weightedCoverage = 0;
  const mechanicBreakdown = {};
  for (const mech of MECHANICS) {
    const cell = getCell(operator, mech);
    const weight = seed.mechanicMix[mech] ?? 0;
    const contribution = cell.covered ? weight : 0;
    weightedCoverage += contribution;
    mechanicBreakdown[mech] = {
      weight,
      covered: cell.covered,
      confidence: cell.confidence,
      contribution,
    };
  }

  // Annual title throughput attributable to engine
  const velocityUpliftFactor = annualShipsPost / annualShipsPre;
  const annualTitlesCovered = annualShipsPost * weightedCoverage;
  const annualSavings = annualTitlesCovered * perTitleSaving;

  const npv5yr = npvFiveYear(annualSavings, discountRate);

  // Estimate upfront license tier cost based on portfolio scale
  const upfrontLicenseUsd = Math.round(portfolioSize * 1500 + 250_000);

  // Payback months: months until cumulative savings exceed upfront
  const monthlySavings = annualSavings / 12;
  const paybackMonths = monthlySavings > 0
    ? Math.ceil(upfrontLicenseUsd / monthlySavings)
    : Number.POSITIVE_INFINITY;

  return {
    operator,
    region: seed.region,
    priority: seed.priority,
    inputs: {
      portfolioSize,
      annualShipsPre,
      annualShipsPost,
      perTitleSavingUsd: perTitleSaving,
      discountRate,
    },
    weightedCoveragePct: weightedCoverage,
    unweightedCoveragePct: operatorCoveragePct(operator),
    velocityUpliftFactor,
    annualTitlesCovered: Math.round(annualTitlesCovered * 100) / 100,
    annualSavingsUsd: Math.round(annualSavings),
    fiveYearNpvUsd: Math.round(npv5yr),
    upfrontLicenseUsd,
    paybackMonths,
    mechanicBreakdown,
  };
}

/** Render the fit report as Markdown. */
export function renderFitMarkdown(fit) {
  const lines = [];
  lines.push(`# Portfolio Fit — ${fit.operator}`);
  lines.push('');
  lines.push(`> Auto-generated by \`scripts/outreach/operator-portfolio-fit.mjs --operator ${fit.operator}\``);
  lines.push('> Deterministic; no clock/RNG.');
  lines.push('');
  lines.push(`- **Region**: ${fit.region}`);
  lines.push(`- **Priority**: ${fit.priority}`);
  lines.push('');
  lines.push('## Inputs');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|---|---|');
  lines.push(`| Portfolio size (titles) | ${fit.inputs.portfolioSize} |`);
  lines.push(`| Annual ships (pre-engine) | ${fit.inputs.annualShipsPre} |`);
  lines.push(`| Annual ships (post-engine) | ${fit.inputs.annualShipsPost} |`);
  lines.push(`| Per-title cert+math saving (USD) | $${fit.inputs.perTitleSavingUsd.toLocaleString('en-US')} |`);
  lines.push(`| Discount rate (NPV) | ${(fit.inputs.discountRate * 100).toFixed(1)}% |`);
  lines.push('');
  lines.push('## Headline');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|---|---|');
  lines.push(`| Weighted coverage % | ${(fit.weightedCoveragePct * 100).toFixed(1)}% |`);
  lines.push(`| Unweighted (mechanic-count) coverage % | ${(fit.unweightedCoveragePct * 100).toFixed(1)}% |`);
  lines.push(`| Velocity uplift factor | ${fit.velocityUpliftFactor.toFixed(2)}x |`);
  lines.push(`| Annual titles covered | ${fit.annualTitlesCovered} |`);
  lines.push(`| Annual savings (USD) | $${fit.annualSavingsUsd.toLocaleString('en-US')} |`);
  lines.push(`| 5yr NPV (USD) | $${fit.fiveYearNpvUsd.toLocaleString('en-US')} |`);
  lines.push(`| Upfront license tier (USD) | $${fit.upfrontLicenseUsd.toLocaleString('en-US')} |`);
  lines.push(`| Payback (months) | ${fit.paybackMonths} |`);
  lines.push('');
  lines.push('## Mechanic-by-mechanic breakdown');
  lines.push('');
  lines.push('| Mechanic | Weight | Covered | Confidence | Contribution |');
  lines.push('|---|---|---|---|---|');
  for (const [mech, m] of Object.entries(fit.mechanicBreakdown)) {
    const w = (m.weight * 100).toFixed(1) + '%';
    const c = (m.contribution * 100).toFixed(1) + '%';
    lines.push(`| ${mech} | ${w} | ${m.covered ? 'Y' : 'n'} | ${m.confidence} | ${c} |`);
  }
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- Weighted coverage % uses operator-specific mechanic-mix weights from `OPERATOR_SEEDS`.');
  lines.push('- Annual savings = annualShipsPost * weightedCoverage * perTitleSavingUsd.');
  lines.push('- 5yr NPV uses constant-annuity discounting at the supplied rate (default 10%).');
  lines.push('- Payback months = upfrontLicenseUsd / monthlySavings, rounded up.');
  lines.push('- Numbers are deterministic given identical inputs — re-running produces byte-identical output.');
  return lines.join('\n') + '\n';
}

/** Parse CLI args. */
export function parseArgs(argv) {
  const args = {
    operator: null,
    json: false,
    portfolioSize: null,
    perTitleSavingUsd: null,
    annualShipsPre: null,
    annualShipsPost: null,
    discountRate: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--json') args.json = true;
    else if (a === '--operator' && argv[i + 1]) args.operator = next();
    else if (a.startsWith('--operator=')) args.operator = a.slice('--operator='.length);
    else if (a === '--portfolio-size' && argv[i + 1]) args.portfolioSize = Number(next());
    else if (a.startsWith('--portfolio-size=')) args.portfolioSize = Number(a.slice('--portfolio-size='.length));
    else if (a === '--per-title-saving' && argv[i + 1]) args.perTitleSavingUsd = Number(next());
    else if (a.startsWith('--per-title-saving=')) args.perTitleSavingUsd = Number(a.slice('--per-title-saving='.length));
    else if (a === '--annual-ships-pre' && argv[i + 1]) args.annualShipsPre = Number(next());
    else if (a.startsWith('--annual-ships-pre=')) args.annualShipsPre = Number(a.slice('--annual-ships-pre='.length));
    else if (a === '--annual-ships-post' && argv[i + 1]) args.annualShipsPost = Number(next());
    else if (a.startsWith('--annual-ships-post=')) args.annualShipsPost = Number(a.slice('--annual-ships-post='.length));
    else if (a === '--discount-rate' && argv[i + 1]) args.discountRate = Number(next());
    else if (a.startsWith('--discount-rate=')) args.discountRate = Number(a.slice('--discount-rate='.length));
  }
  return args;
}

export async function main(argv = process.argv) {
  const args = parseArgs(argv);
  if (!args.operator) {
    throw new Error('--operator <slug> required. Known: ' + OPERATORS.join(', '));
  }
  if (!OPERATORS.includes(args.operator)) {
    throw new Error('unknown operator: ' + args.operator + '. Known: ' + OPERATORS.join(', '));
  }

  const overrides = {};
  if (args.portfolioSize != null) overrides.portfolioSize = args.portfolioSize;
  if (args.perTitleSavingUsd != null) overrides.perTitleSavingUsd = args.perTitleSavingUsd;
  if (args.annualShipsPre != null) overrides.annualShipsPre = args.annualShipsPre;
  if (args.annualShipsPost != null) overrides.annualShipsPost = args.annualShipsPost;
  if (args.discountRate != null) overrides.discountRate = args.discountRate;

  const fit = computePortfolioFit(args.operator, overrides);

  if (args.json) {
    process.stdout.write(JSON.stringify(fit, null, 2) + '\n');
    return fit;
  }

  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const md = renderFitMarkdown(fit);
  const jsonPath = resolve(REPORTS_DIR, `PORTFOLIO_FIT_${args.operator}.json`);
  const mdPath = resolve(REPORTS_DIR, `PORTFOLIO_FIT_${args.operator}.md`);
  await fs.writeFile(jsonPath, JSON.stringify(fit, null, 2) + '\n', 'utf8');
  await fs.writeFile(mdPath, md, 'utf8');
  process.stdout.write(`[portfolio-fit] ${args.operator}: weighted=${(fit.weightedCoveragePct * 100).toFixed(1)}% npv5yr=$${fit.fiveYearNpvUsd.toLocaleString('en-US')} payback=${fit.paybackMonths}mo\n`);
  process.stdout.write(`[portfolio-fit] json -> ${jsonPath}\n`);
  process.stdout.write(`[portfolio-fit] md   -> ${mdPath}\n`);
  return fit;
}

const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();
if (isMain) {
  main(process.argv).catch((err) => {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(1);
  });
}
