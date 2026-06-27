#!/usr/bin/env node
/**
 * W214 Faza 1100.0 — Pricing Calculator (Vendor perspective).
 *
 * Complements the W211 ROI calculator (which is Operator perspective).
 * This calculator answers: "What price band should we anchor at for an
 * Operator with these characteristics, and what does the deal economy
 * look like over 5 years from our side?"
 *
 * Inputs:
 *   --operator-tier=1|2|3
 *   --games-per-year=N      (default 30)
 *   --jurisdictions=N       (default 3)
 *   --support-level=basic|standard|premium  (default standard)
 *   --format=table|json|html (default table)
 *
 * Outputs: recommended Tier-A band, Tier-B revenue share, ARR forecast,
 * gross margin, and a head-to-head with the do-nothing alternative.
 *
 * Pure Node built-ins; no third-party deps.
 */

export const DEFAULT_INPUTS = Object.freeze({
  operatorTier: 1,
  gamesPerYear: 30,
  jurisdictions: 3,
  supportLevel: 'standard',
});

export const SUPPORT_PREMIUM = Object.freeze({
  basic: 0.85,
  standard: 1.0,
  premium: 1.4,
});

export const SUPPORT_COST_TO_SERVE = Object.freeze({
  basic: 0.08,    // 8% of upfront/yr
  standard: 0.12, // 12%
  premium: 0.22,  // 22%
});

/** Parse CLI args. */
export function parseArgs(argv) {
  const out = { ...DEFAULT_INPUTS, format: 'table' };
  for (const raw of argv.slice(2)) {
    const m = /^--([a-z-]+)=(.+)$/.exec(raw);
    if (!m) continue;
    const [, key, value] = m;
    switch (key) {
      case 'operator-tier':
        out.operatorTier = parseInt(value, 10);
        break;
      case 'games-per-year':
        out.gamesPerYear = parseInt(value, 10);
        break;
      case 'jurisdictions':
        out.jurisdictions = parseInt(value, 10);
        break;
      case 'support-level':
        out.supportLevel = value;
        break;
      case 'format':
        out.format = value;
        break;
      default:
        break;
    }
  }
  return out;
}

/** Validate parsed inputs; clamp to sane ranges. */
export function validateInputs(inp) {
  if (![1, 2, 3].includes(inp.operatorTier)) {
    throw new Error(`operator-tier must be 1, 2, or 3 (got ${inp.operatorTier})`);
  }
  if (!(inp.gamesPerYear >= 1 && inp.gamesPerYear <= 500)) {
    throw new Error(`games-per-year out of range (got ${inp.gamesPerYear})`);
  }
  if (!(inp.jurisdictions >= 1 && inp.jurisdictions <= 25)) {
    throw new Error(`jurisdictions out of range (got ${inp.jurisdictions})`);
  }
  if (!Object.prototype.hasOwnProperty.call(SUPPORT_PREMIUM, inp.supportLevel)) {
    throw new Error(`support-level must be basic|standard|premium`);
  }
  return inp;
}

/** Compute Tier-A pricing band centered on operator tier + activity. */
export function computeTierABand(inp) {
  // Base bands: T1=$850K, T2=$400K, T3=$200K
  const baseUpfront = { 1: 850_000, 2: 400_000, 3: 200_000 }[inp.operatorTier];
  // Activity multiplier: 1.0 @ 30 games/yr; +/- 1.5% per delta-game
  const activityMult = 1 + (inp.gamesPerYear - 30) * 0.015;
  // Jurisdiction multiplier: +5% per jurisdiction beyond 3
  const jurMult = 1 + Math.max(0, inp.jurisdictions - 3) * 0.05;
  // Support multiplier
  const supportMult = SUPPORT_PREMIUM[inp.supportLevel];

  const mid = Math.max(
    150_000,
    Math.round(baseUpfront * activityMult * jurMult * supportMult),
  );
  const low = Math.round(mid * 0.7);
  const high = Math.round(mid * 1.4);
  const annualMaintenance = Math.round(mid * 0.2);
  return { low, mid, high, annualMaintenance };
}

/** Compute Tier-B revenue-share band. */
export function computeTierBBand(inp) {
  // Base revenue share: T1=4%, T2=3.5%, T3=3%
  const baseShare = { 1: 4.0, 2: 3.5, 3: 3.0 }[inp.operatorTier];
  // Light support reduces share by 0.25pp; premium increases by 0.5pp
  const supportDelta = { basic: -0.25, standard: 0, premium: 0.5 }[inp.supportLevel];
  const sharePct = Math.max(2.5, Math.min(6.0, baseShare + supportDelta));
  // Upfront B = 17% of Tier A mid
  const upfrontB = Math.round(computeTierABand(inp).mid * 0.17);
  const minAnnual = Math.max(upfrontB, 50_000);
  return {
    sharePct: Number(sharePct.toFixed(2)),
    upfrontUSD: upfrontB,
    minAnnualUSD: minAnnual,
  };
}

/** Project 5-year ARR for both tiers from Vendor perspective. */
export function projectArrFiveYear(inp) {
  const a = computeTierABand(inp);
  const b = computeTierBBand(inp);

  // Tier-A ARR pattern: year 1 = upfront + maintenance; years 2-5 maintenance only
  const tierAByYear = [
    a.mid + a.annualMaintenance,
    a.annualMaintenance,
    a.annualMaintenance,
    a.annualMaintenance,
    a.annualMaintenance,
  ];
  const tierATotalARR = tierAByYear.reduce((s, v) => s + v, 0);

  // Tier-B ARR pattern: avg game gross ~ $1.2M/yr per game (industry SAW),
  // ramp 40% / 70% / 90% / 100% / 100%
  const avgGameGrossUSD = 1_200_000;
  const totalAnnualGameGross = avgGameGrossUSD * inp.gamesPerYear;
  const ramp = [0.4, 0.7, 0.9, 1.0, 1.0];
  const tierBByYear = ramp.map((r, idx) => {
    const royalty = totalAnnualGameGross * r * (b.sharePct / 100);
    const upfrontComponent = idx === 0 ? b.upfrontUSD : 0;
    return Math.max(b.minAnnualUSD, Math.round(royalty)) + upfrontComponent;
  });
  const tierBTotalARR = tierBByYear.reduce((s, v) => s + v, 0);

  return {
    tierA: { byYear: tierAByYear, total: tierATotalARR, mid: a.mid },
    tierB: { byYear: tierBByYear, total: tierBTotalARR, sharePct: b.sharePct },
  };
}

/** Compute Vendor cost-to-serve + gross margin per tier. */
export function computeMarginAnalysis(inp) {
  const proj = projectArrFiveYear(inp);
  const costFactor = SUPPORT_COST_TO_SERVE[inp.supportLevel];

  // Cost-to-serve scales with maintenance revenue / Tier-A; ~ avg of upfront
  const tierAYearlyCost = Math.round((proj.tierA.mid * costFactor) / 5 + 80_000);
  const tierAFiveYrCost = tierAYearlyCost * 5;
  const tierAGM = (proj.tierA.total - tierAFiveYrCost) / proj.tierA.total;

  // Tier-B cost-to-serve higher due to royalty audits + multi-year support
  const tierBYearlyCost = Math.round(tierAYearlyCost * 1.15);
  const tierBFiveYrCost = tierBYearlyCost * 5;
  const tierBGM = (proj.tierB.total - tierBFiveYrCost) / proj.tierB.total;

  return {
    tierA: {
      fiveYearRevenueUSD: proj.tierA.total,
      fiveYearCostUSD: tierAFiveYrCost,
      grossMarginPct: Number((tierAGM * 100).toFixed(1)),
    },
    tierB: {
      fiveYearRevenueUSD: proj.tierB.total,
      fiveYearCostUSD: tierBFiveYrCost,
      grossMarginPct: Number((tierBGM * 100).toFixed(1)),
    },
  };
}

/** Compare to "do-nothing" alternative for the operator. */
export function compareToCurrentBusiness(inp) {
  // Assume operator's status-quo cost is $X per game in math+cert delays.
  // Tier-1 = $300K loss/game; Tier-2 = $180K; Tier-3 = $90K. Engine cuts that
  // by ~70% (per pilot dossiers).
  const lossPerGame = { 1: 300_000, 2: 180_000, 3: 90_000 }[inp.operatorTier];
  const operatorStatusQuoCost = lossPerGame * inp.gamesPerYear * 5;
  const operatorEngineCost = computeTierABand(inp).mid + computeTierABand(inp).annualMaintenance * 4;
  const operatorSavingsUSD = operatorStatusQuoCost - operatorEngineCost;
  return {
    operatorStatusQuoCost5yrUSD: operatorStatusQuoCost,
    operatorEngineCost5yrUSD: operatorEngineCost,
    operatorSavings5yrUSD: operatorSavingsUSD,
    operatorReturnMultiple: Number(
      (operatorStatusQuoCost / Math.max(1, operatorEngineCost)).toFixed(2),
    ),
  };
}

/** Master calculator function. */
export function calculate(inputs) {
  const inp = validateInputs({ ...DEFAULT_INPUTS, ...inputs });
  const tierA = computeTierABand(inp);
  const tierB = computeTierBBand(inp);
  const projection = projectArrFiveYear(inp);
  const margin = computeMarginAnalysis(inp);
  const compareCurrent = compareToCurrentBusiness(inp);
  return {
    inputs: inp,
    tierA,
    tierB,
    projection,
    margin,
    compareCurrent,
  };
}

/** Format as console table. */
export function formatTable(result) {
  const lines = [];
  lines.push('=== Vendor Pricing Calculator (W214) ===');
  lines.push('');
  lines.push('Inputs:');
  lines.push(`  operator-tier:   ${result.inputs.operatorTier}`);
  lines.push(`  games/year:      ${result.inputs.gamesPerYear}`);
  lines.push(`  jurisdictions:   ${result.inputs.jurisdictions}`);
  lines.push(`  support-level:   ${result.inputs.supportLevel}`);
  lines.push('');
  lines.push('Tier-A (Perpetual License + Maintenance) — recommended band:');
  lines.push(`  Low:     $${result.tierA.low.toLocaleString()}`);
  lines.push(`  Mid:     $${result.tierA.mid.toLocaleString()} (anchor)`);
  lines.push(`  High:    $${result.tierA.high.toLocaleString()}`);
  lines.push(`  Annual maint.: $${result.tierA.annualMaintenance.toLocaleString()}`);
  lines.push('');
  lines.push('Tier-B (Revenue Share) — recommended band:');
  lines.push(`  Upfront:        $${result.tierB.upfrontUSD.toLocaleString()}`);
  lines.push(`  Revenue share:  ${result.tierB.sharePct.toFixed(2)}%`);
  lines.push(`  Min annual:     $${result.tierB.minAnnualUSD.toLocaleString()}`);
  lines.push('');
  lines.push('5-Year ARR projection (Vendor revenue):');
  lines.push(`  Tier A total:   $${result.projection.tierA.total.toLocaleString()}`);
  lines.push(`  Tier B total:   $${result.projection.tierB.total.toLocaleString()}`);
  lines.push('');
  lines.push('Margin analysis (5yr):');
  lines.push(`  Tier A GM%:     ${result.margin.tierA.grossMarginPct}%`);
  lines.push(`  Tier B GM%:     ${result.margin.tierB.grossMarginPct}%`);
  lines.push('');
  lines.push('Operator-side comparison vs do-nothing (status quo math+cert costs):');
  lines.push(`  Status quo 5yr cost:   $${result.compareCurrent.operatorStatusQuoCost5yrUSD.toLocaleString()}`);
  lines.push(`  Engine 5yr cost:       $${result.compareCurrent.operatorEngineCost5yrUSD.toLocaleString()}`);
  lines.push(`  Savings (5yr):         $${result.compareCurrent.operatorSavings5yrUSD.toLocaleString()}`);
  lines.push(`  Return multiple:       ${result.compareCurrent.operatorReturnMultiple}×`);
  return lines.join('\n');
}

/** Format as JSON. */
export function formatJson(result) {
  return JSON.stringify(result, null, 2);
}

/** Format as standalone HTML. */
export function formatHtml(result) {
  return [
    '<!DOCTYPE html>',
    '<html lang="en"><head><meta charset="utf-8"><title>Vendor Pricing Calculator</title>',
    '<style>body{font:14px/1.5 -apple-system, system-ui, sans-serif;max-width:760px;margin:2em auto;padding:0 1em;}',
    'table{border-collapse:collapse;width:100%;margin-bottom:1em;}td,th{border:1px solid #ddd;padding:6px 10px;}th{background:#f6f8fa;text-align:left;}',
    '</style></head><body>',
    '<h1>Vendor Pricing Calculator (W214)</h1>',
    '<h2>Inputs</h2><pre>' + JSON.stringify(result.inputs, null, 2) + '</pre>',
    '<h2>Tier-A band (USD)</h2>',
    `<table><tr><th>Low</th><th>Mid (anchor)</th><th>High</th><th>Annual maint.</th></tr>`,
    `<tr><td>$${result.tierA.low.toLocaleString()}</td><td>$${result.tierA.mid.toLocaleString()}</td><td>$${result.tierA.high.toLocaleString()}</td><td>$${result.tierA.annualMaintenance.toLocaleString()}</td></tr></table>`,
    '<h2>Tier-B band</h2>',
    `<table><tr><th>Upfront</th><th>Revenue share %</th><th>Min annual</th></tr>`,
    `<tr><td>$${result.tierB.upfrontUSD.toLocaleString()}</td><td>${result.tierB.sharePct}%</td><td>$${result.tierB.minAnnualUSD.toLocaleString()}</td></tr></table>`,
    '<h2>5-Year totals</h2>',
    `<p>Tier A: $${result.projection.tierA.total.toLocaleString()} (GM ${result.margin.tierA.grossMarginPct}%)</p>`,
    `<p>Tier B: $${result.projection.tierB.total.toLocaleString()} (GM ${result.margin.tierB.grossMarginPct}%)</p>`,
    '<h2>Operator status-quo comparison</h2>',
    `<p>Status-quo 5yr cost: $${result.compareCurrent.operatorStatusQuoCost5yrUSD.toLocaleString()}</p>`,
    `<p>Engine 5yr cost: $${result.compareCurrent.operatorEngineCost5yrUSD.toLocaleString()}</p>`,
    `<p>Savings: $${result.compareCurrent.operatorSavings5yrUSD.toLocaleString()} (${result.compareCurrent.operatorReturnMultiple}×)</p>`,
    '</body></html>',
  ].join('\n');
}

// CLI entry
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('pricing-calculator.mjs');
if (isMain) {
  const args = parseArgs(process.argv);
  try {
    const result = calculate(args);
    const fmt = args.format || 'table';
    if (fmt === 'json') process.stdout.write(formatJson(result) + '\n');
    else if (fmt === 'html') process.stdout.write(formatHtml(result) + '\n');
    else process.stdout.write(formatTable(result) + '\n');
  } catch (err) {
    process.stderr.write(`pricing calculator failed: ${err.message}\n`);
    process.exit(1);
  }
}
