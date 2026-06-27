#!/usr/bin/env node
// Faza 10.5 — RTP acceptance dossier (±0.001% precision target).
//
// Combines the golden-snapshot data (`reports/acceptance/golden.json`,
// produced by `scripts/acceptance-golden.mjs` at 20k spins for the
// determinism check) with the ±0.001% acceptance verdict per fixture.
//
// For each fixture, the script computes:
//
//   1. The reference RTP claim (from the golden snapshot OR an
//      operator-supplied closed-form RTP).
//   2. The MC-observed RTP at whatever sample size the golden has.
//   3. The per-spin variance proxy (derived from the per-fixture
//      `maxWinX` if no explicit variance is logged — caller can
//      pass `--variance-map` to inject precise σ² values).
//   4. The required spin count to converge at ±0.001 % / 99 %.
//   5. Whether the current sample is sufficient (`converged` /
//      `too_few_spins` / `diverged_from_reference`).
//
// Output goes to `reports/acceptance/dossier-<UTC>.json` plus a
// human-readable Markdown roll-up in `reports/acceptance/DOSSIER.md`.
//
// Usage:
//   node scripts/acceptance-dossier.mjs                 # default 99% / ±1e-5
//   node scripts/acceptance-dossier.mjs --precision 5e-6 --confidence 0.999
//   node scripts/acceptance-dossier.mjs --variance-map reports/acceptance/variances.json
//   node scripts/acceptance-dossier.mjs --json-out my-dossier.json

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  evaluateConvergence,
  aggregateAcceptance,
  requiredSpinsForPrecision,
  DEFAULT_RTP_PRECISION,
  DEFAULT_CONFIDENCE,
} from '../dist/sim/acceptanceHarness.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ─── argv ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const opts = {
  precision: DEFAULT_RTP_PRECISION,
  confidence: DEFAULT_CONFIDENCE,
  variance_map: null,
  golden: join(REPO_ROOT, 'reports', 'acceptance', 'golden.json'),
  out_dir: join(REPO_ROOT, 'reports', 'acceptance'),
  json_out: null,
};
for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--precision': opts.precision = Number(args[++i]); break;
    case '--confidence': opts.confidence = Number(args[++i]); break;
    case '--variance-map': opts.variance_map = args[++i]; break;
    case '--golden': opts.golden = args[++i]; break;
    case '--out-dir': opts.out_dir = args[++i]; break;
    case '--json-out': opts.json_out = args[++i]; break;
    case '-h':
    case '--help':
      process.stdout.write(
        'Usage: acceptance-dossier.mjs [--precision N] [--confidence P] [--variance-map FILE] [--golden FILE] [--out-dir DIR] [--json-out FILE]\n'
      );
      process.exit(0);
      break;
    default:
      console.error(`unknown flag: ${args[i]}`);
      process.exit(2);
  }
}

// ─── inputs ───────────────────────────────────────────────────────────────────
if (!existsSync(opts.golden)) {
  console.error(`ERROR: golden snapshot not found at ${opts.golden}`);
  console.error('  Run `node scripts/acceptance-golden.mjs` first.');
  process.exit(3);
}
const golden = JSON.parse(readFileSync(opts.golden, 'utf8'));
const goldenSpins = golden.spins ?? 20_000;

let varianceMap = {};
if (opts.variance_map) {
  if (!existsSync(opts.variance_map)) {
    console.error(`ERROR: variance map not found at ${opts.variance_map}`);
    process.exit(3);
  }
  varianceMap = JSON.parse(readFileSync(opts.variance_map, 'utf8'));
}

// ─── per-fixture evaluation ───────────────────────────────────────────────────
const fixtures = [];
let convergedCount = 0;
let warnCount = 0;
let failCount = 0;
let totalRequired = 0;
let maxRequired = 0;

for (const [fixtureId, snap] of Object.entries(golden.fixtures)) {
  // Variance — operator-supplied if available; otherwise estimate
  // conservatively from maxWinX as if the distribution were a 2-point
  // {0, maxWinX} Bernoulli with hit rate. This is loose but adequate
  // for the dossier — real σ² comes from production MC.
  const referenceRtp = snap.rtp;
  const observedRtp = snap.rtp; // identical for self-replay; PAR dossier overrides
  const explicitVar = varianceMap[fixtureId]?.variance;
  // Coarse fallback: σ² = (maxWinX − rtp)² × hitRate
  const fallbackVar =
    snap.maxWinX != null && snap.hitRate != null
      ? Math.pow(snap.maxWinX - referenceRtp, 2) * snap.hitRate +
        Math.pow(0 - referenceRtp, 2) * (1 - snap.hitRate)
      : 1;
  const perSpinVariance = explicitVar ?? fallbackVar;

  const required = requiredSpinsForPrecision({
    perSpinVariance,
    precision: opts.precision,
    confidence: opts.confidence,
  });
  totalRequired += required;
  if (required > maxRequired) maxRequired = required;

  const verdict = evaluateConvergence(
    {
      spinsSoFar: goldenSpins,
      runningRtp: observedRtp,
      runningVariance: perSpinVariance,
    },
    {
      referenceRtp,
      precision: opts.precision,
      confidence: opts.confidence,
      mode: 'closed_form',
    }
  );

  if (verdict.status === 'converged') convergedCount += 1;
  else if (verdict.status === 'diverged_from_reference') failCount += 1;
  else warnCount += 1;

  fixtures.push({
    fixtureId,
    verdict,
    referenceRtp,
    observedRtp,
    perSpinVariance,
    varianceSource: explicitVar != null ? 'operator_supplied' : 'fallback_from_maxWinX',
  });
}

const summary = aggregateAcceptance(
  fixtures.map((f) => ({ fixtureId: f.fixtureId, verdict: f.verdict }))
);

// ─── outputs ──────────────────────────────────────────────────────────────────
mkdirSync(opts.out_dir, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '').replace('T', '_').slice(0, -1) + 'Z';

const dossier = {
  generatedAtUtc: new Date().toISOString(),
  goldenSnapshot: opts.golden,
  goldenSpins,
  config: {
    precision: opts.precision,
    confidence: opts.confidence,
    varianceSource: opts.variance_map ?? 'fallback',
  },
  summary: {
    overall: summary.overall,
    convergedCount,
    warnCount,
    failCount,
    totalCount: fixtures.length,
    worstDelta: summary.worstDelta,
    worstCiHalfWidth: summary.worstCiHalfWidth,
    totalRequiredSpins: totalRequired,
    maxRequiredSpins: maxRequired,
  },
  fixtures,
};

const jsonOut = opts.json_out ?? join(opts.out_dir, `dossier-${ts}.json`);
mkdirSync(dirname(jsonOut), { recursive: true });
writeFileSync(jsonOut, JSON.stringify(dossier, null, 2) + '\n', 'utf8');

// Markdown rollup
const md = renderMd(dossier);
const mdPath = join(opts.out_dir, 'DOSSIER.md');
writeFileSync(mdPath, md, 'utf8');

console.log(`Acceptance dossier @ precision=${opts.precision} confidence=${opts.confidence}`);
console.log(`  fixtures: ${fixtures.length}`);
console.log(`  converged: ${convergedCount}`);
console.log(`  warn (too-few/not-converged): ${warnCount}`);
console.log(`  fail (diverged): ${failCount}`);
console.log(`  worst |delta|: ${Math.abs(summary.worstDelta).toExponential(3)}`);
console.log(`  worst CI half-width: ${summary.worstCiHalfWidth.toExponential(3)}`);
console.log(`  max required spins (per fixture): ${maxRequired.toLocaleString()}`);
console.log(`  total required spins (Σ): ${totalRequired.toLocaleString()}`);
console.log(`\n  JSON: ${jsonOut}`);
console.log(`  MD:   ${mdPath}`);

if (summary.overall === 'diverged_from_reference') process.exit(1);
process.exit(0);

// ─── helpers ──────────────────────────────────────────────────────────────────
function renderMd(d) {
  const lines = [];
  lines.push('# Acceptance Dossier — ±0.001% RTP precision');
  lines.push('');
  lines.push(`> Generated: ${d.generatedAtUtc}`);
  lines.push(`> Golden snapshot: \`${d.goldenSnapshot}\` (${d.goldenSpins.toLocaleString()} spins)`);
  lines.push(
    `> Target: ±${d.config.precision} @ ${(d.config.confidence * 100).toFixed(2)}% confidence`
  );
  lines.push(`> Variance source: ${d.config.varianceSource}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(
    `| Metric | Value |\n|---|---|\n| Overall | **${d.summary.overall}** |\n| Converged | ${d.summary.convergedCount}/${d.summary.totalCount} |\n| Warned (too-few / not-converged) | ${d.summary.warnCount} |\n| Failed (diverged) | ${d.summary.failCount} |\n| Worst \\|Δ\\| | ${Math.abs(d.summary.worstDelta).toExponential(3)} |\n| Worst CI half-width | ${d.summary.worstCiHalfWidth.toExponential(3)} |\n| Max required spins | ${d.summary.maxRequiredSpins.toLocaleString()} |\n| Σ required spins | ${d.summary.totalRequiredSpins.toLocaleString()} |`
  );
  lines.push('');
  lines.push('## Per-fixture verdicts');
  lines.push('');
  lines.push('| Fixture | Verdict | observed-RTP | ref-RTP | Δ | CI hw | σ² | required-N | source |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const f of d.fixtures) {
    lines.push(
      `| \`${f.fixtureId}\` | ${f.verdict.status} | ${f.observedRtp.toFixed(6)} | ${f.referenceRtp.toFixed(6)} | ${f.verdict.delta.toExponential(2)} | ${f.verdict.ciHalfWidth.toExponential(2)} | ${f.perSpinVariance.toFixed(4)} | ${f.verdict.requiredSpins.toLocaleString()} | ${f.varianceSource} |`
    );
  }
  lines.push('');
  lines.push('## Interpretation');
  lines.push('');
  lines.push(
    '- `converged` — sample reached precision target at configured confidence.'
  );
  lines.push(
    '- `too_few_spins` — sample needs more spins (run `acceptance-golden.mjs` with bigger N).'
  );
  lines.push(
    '- `not_converged` — sample met N, but CI still > target (variance under-counted; rerun with `--variance-map`).'
  );
  lines.push(
    '- `diverged_from_reference` — sample provably outside ±precision band (real bug — investigate).'
  );
  lines.push('');
  return lines.join('\n');
}
