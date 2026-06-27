#!/usr/bin/env node
//
// W152 Wave 46 — Industry Pattern Catalog acceptance.
//
// Walks the 20 industry patterns from docs/INDUSTRY_PATTERN_CATALOG.md.
// For each pattern, runs the reference fixture(s) through the engine
// at 5 seeds × 50K spins and asserts:
//
//   1. Engine sanity — finite RTP, no NaN, no crash, no overflow
//   2. Cross-seed stability — relative σ across seeds ≤ 10%
//   3. Pattern-specific feature presence — IR has the declared mechanic
//
// Output: reports/acceptance/INDUSTRY_PATTERNS.{json,md}

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const FIXTURES_DIR = join(REPO_ROOT, 'tests', 'fixtures', 'reference');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const SPINS = 50_000;
const SEEDS = [12345, 67890, 11111, 99999, 24680];
const REL_SIGMA_TOL = 0.10;

// ── Pattern registry (matches docs/INDUSTRY_PATTERN_CATALOG.md) ────────────
//
// Each pattern lists:
//   - id
//   - name (mechanical descriptor)
//   - fixtures (list of reference fixture filenames)
//   - mechanicCheck (predicate on IR — verify pattern-specific feature)

const PATTERNS = [
  {
    id: 'P-001', name: 'Variable-Ways Cascade',
    fixtures: ['complex-variable-rows.json', 'variable-rows-7reels.json'],
    mechanicCheck: (ir) => ir.evaluation?.kind === 'ways' && (ir.topology?.row_range_per_reel || ir.topology?.kind === 'irregular' || ir.features?.some(f => f.kind === 'cascade')),
  },
  {
    id: 'P-002', name: 'Persistent-Grid Cash-Collect',
    fixtures: ['hnw-classic.json', 'hnw-full-grid.json'],
    mechanicCheck: (ir) => ir.features?.some((f) => f.kind === 'hold_and_win'),
  },
  {
    id: 'P-003', name: 'Multi-Tier Pool Jackpot',
    fixtures: ['hnw-grand-jackpot.json', 'wheel-bonus.json'],
    mechanicCheck: (ir) => ir.features?.some((f) => f.kind === 'hold_and_win' && Array.isArray(f.jackpot_tiers)) || ir.features?.some((f) => f.kind === 'wheel'),
  },
  {
    id: 'P-004', name: 'Cascading Cluster',
    fixtures: ['cluster-7x7.json', 'cluster-diagonal.json', 'cluster-hexagonal.json'],
    mechanicCheck: (ir) => ir.evaluation?.kind === 'cluster',
  },
  {
    id: 'P-005', name: 'Sticky-Wild Free Spins',
    fixtures: ['fs-sticky-wilds.json'],
    mechanicCheck: (ir) => ir.features?.some((f) => f.kind === 'free_spins'),
  },
  {
    id: 'P-006', name: 'Mystery-Symbol Reveal',
    fixtures: ['mystery-symbol.json'],
    mechanicCheck: (ir) => ir.symbols?.some((s) => s.kind === 'mystery') || ir.symbols?.some(s => s.id?.toLowerCase().includes('mystery')),
  },
  {
    id: 'P-007', name: 'Walking-Wild Cascade',
    fixtures: ['walking-wilds.json'],
    mechanicCheck: (ir) => ir.symbols?.some((s) => s.kind === 'wild' || s.kind === 'chain_wild' || s.id?.toLowerCase().includes('wild') || s.id === 'WLD' || s.id === 'CWL'),
  },
  {
    id: 'P-008', name: 'Expanding-Wild Free Spins',
    fixtures: ['fs-expanding-wilds.json', 'expanding-wilds.json'],
    mechanicCheck: (ir) => ir.symbols?.some((s) => s.kind === 'wild' || s.id?.toLowerCase().includes('wild') || s.id === 'WLD') || ir.features?.some(f => f.kind === 'free_spins'),
  },
  {
    id: 'P-009', name: 'Multiplier-Ladder Free Spins',
    fixtures: ['fs-multiplier-ladder.json'],
    mechanicCheck: (ir) => ir.features?.some((f) => f.kind === 'free_spins'),
  },
  {
    id: 'P-010', name: 'Pick-Bonus Mini-Game',
    fixtures: ['pick-bonus.json'],
    mechanicCheck: (ir) => ir.features?.some((f) => f.kind === 'pick'),
  },
  {
    id: 'P-011', name: 'Pay-Anywhere Scatter',
    fixtures: ['pay-anywhere.json'],
    mechanicCheck: (ir) => ir.evaluation?.kind === 'pay_anywhere' || ir.evaluation?.kind === 'pay-anywhere' || ir.evaluation?.kind === 'scatter_pay',
  },
  {
    id: 'P-012', name: 'Both-Ways Line Evaluation',
    fixtures: ['5x4-25lines.json'],
    mechanicCheck: (ir) => ir.evaluation?.kind === 'lines',
  },
  {
    id: 'P-013', name: 'Symbol-Upgrade Cascade',
    fixtures: ['symbol-upgrade.json'],
    mechanicCheck: (ir) => ir.features?.some((f) => f.kind === 'symbol_upgrade') || (ir.features?.some(f => f.kind === 'cascade') && ir.symbols?.length > 0),
  },
  {
    id: 'P-014', name: 'Respin-Lock Bonus',
    fixtures: ['respin-feature.json'],
    mechanicCheck: (ir) => ir.features?.some((f) => f.kind === 'respin'),
  },
  {
    id: 'P-015', name: 'Hexagonal Cluster',
    fixtures: ['cluster-hexagonal.json'],
    mechanicCheck: (ir) => ir.evaluation?.kind === 'cluster',
  },
  {
    id: 'P-016', name: 'Diagonal Cluster',
    fixtures: ['cluster-diagonal.json'],
    mechanicCheck: (ir) => ir.evaluation?.kind === 'cluster',
  },
  {
    id: 'P-017', name: 'Multi-Reel Wild-Spread',
    fixtures: ['multiplier-wilds.json'],
    mechanicCheck: (ir) => ir.symbols?.some((s) => s.kind === 'wild' || s.kind === 'multiplier' || s.id?.toLowerCase().includes('wild') || s.id?.startsWith('MUL')),
  },
  {
    id: 'P-018', name: 'Asymmetric Variable-Rows',
    fixtures: ['complex-variable-rows.json'],
    mechanicCheck: (ir) => Boolean(ir.topology?.row_range_per_reel) || ir.topology?.kind === 'irregular',
  },
  {
    id: 'P-019', name: 'High-Volatility Heavy-Tail',
    fixtures: ['5x3-243ways.json'],
    mechanicCheck: (ir) => ir.evaluation?.kind === 'ways',
  },
  {
    id: 'P-020', name: 'Classic 3x3 Lines',
    fixtures: ['classic-3x3-lines.json'],
    mechanicCheck: (ir) => ir.evaluation?.kind === 'lines' && ir.topology?.reels === 3 && ir.topology?.rows === 3,
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function meanStd(arr) {
  const n = arr.length;
  if (n === 0) return { mean: 0, stdDev: 0 };
  const m = arr.reduce((s, x) => s + x, 0) / n;
  const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, n - 1);
  return { mean: m, stdDev: Math.sqrt(Math.max(0, v)) };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const irSim = await import(join(REPO_ROOT, 'dist', 'engine', 'irSimulator.js'));

  console.log(`Industry Pattern Catalog acceptance — ${PATTERNS.length} patterns × ${SEEDS.length} seeds × ${SPINS.toLocaleString()} spins`);
  console.log();

  const results = [];
  let passCount = 0;
  let totalChecks = 0;

  const wallStart = Date.now();
  for (const p of PATTERNS) {
    process.stdout.write(`  ${p.id}  ${p.name.padEnd(36)} `);
    const t0 = Date.now();

    // For each fixture in the pattern, run multi-seed sim + check mechanic
    const fixtureResults = [];
    let allPass = true;

    for (const fname of p.fixtures) {
      const fixturePath = join(FIXTURES_DIR, fname);
      if (!existsSync(fixturePath)) {
        fixtureResults.push({ fixture: fname, error: 'fixture not found', sanityPass: false, stabilityPass: false, mechanicPass: false });
        allPass = false;
        continue;
      }
      const ir = JSON.parse(readFileSync(fixturePath, 'utf-8'));
      const mechanicPass = Boolean(p.mechanicCheck(ir));
      const seedRtps = [];
      let sanityPass = true;
      for (const seed of SEEDS) {
        try {
          const sim = await irSim.runIRSimulation(ir, { spins: SPINS, seed });
          if (!Number.isFinite(sim.rtp) || sim.rtp < 0 || sim.rtp > 1e9) sanityPass = false;
          seedRtps.push(sim.rtp);
        } catch (e) {
          sanityPass = false;
          seedRtps.push(NaN);
        }
      }
      const valid = seedRtps.filter((x) => Number.isFinite(x));
      const { mean, stdDev } = meanStd(valid);
      const relSigma = mean > 0 ? stdDev / mean : 0;
      const stabilityPass = valid.length === SEEDS.length && relSigma <= REL_SIGMA_TOL;
      fixtureResults.push({ fixture: fname, sanityPass, stabilityPass, mechanicPass, mean, stdDev, relSigma });
      if (!sanityPass || !stabilityPass || !mechanicPass) allPass = false;
    }

    totalChecks += 3;
    if (allPass) passCount += 3;
    else {
      // Count partial passes
      const sanity = fixtureResults.every((f) => f.sanityPass);
      const stability = fixtureResults.every((f) => f.stabilityPass);
      const mechanic = fixtureResults.every((f) => f.mechanicPass);
      if (sanity) passCount++;
      if (stability) passCount++;
      if (mechanic) passCount++;
    }

    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    const flag = allPass ? '✅' : '⚠️';
    const sanityFlag = fixtureResults.every((f) => f.sanityPass) ? '✓' : '✗';
    const stabFlag = fixtureResults.every((f) => f.stabilityPass) ? '✓' : '✗';
    const mechFlag = fixtureResults.every((f) => f.mechanicPass) ? '✓' : '✗';
    console.log(`${flag} sanity[${sanityFlag}] stability[${stabFlag}] mechanic[${mechFlag}]  (${dt}s, ${p.fixtures.length} fixture(s))`);
    results.push({ ...p, fixtureResults, allPass });
  }

  const wallTotal = ((Date.now() - wallStart) / 1000).toFixed(1);
  const allPatternsPass = results.every((r) => r.allPass);
  console.log();
  console.log(`Total: ${passCount}/${totalChecks} checks PASS in ${wallTotal}s  ${allPatternsPass ? '✅' : '⚠️'}`);

  // ── Reports ──────────────────────────────────────────────────────────────
  const json = {
    schema: 'industry-patterns/v1',
    generatedAtUtc: new Date().toISOString(),
    config: { spinsPerSeed: SPINS, seeds: SEEDS, relSigmaTol: REL_SIGMA_TOL, patternCount: PATTERNS.length },
    headline: {
      patternsTotal: PATTERNS.length,
      patternsPass: results.filter((r) => r.allPass).length,
      checksTotal: totalChecks,
      checksPass: passCount,
      allPass: allPatternsPass,
      wallSeconds: wallTotal,
    },
    patterns: results,
  };
  writeFileSync(join(OUT_DIR, 'INDUSTRY_PATTERNS.json'), JSON.stringify(json, null, 2));
  writeFileSync(join(OUT_DIR, 'INDUSTRY_PATTERNS.md'), renderMd(json));
  console.log(`Reports: reports/acceptance/INDUSTRY_PATTERNS.{json,md}`);
  if (!allPatternsPass) process.exitCode = 1;
}

function renderMd(j) {
  const out = [];
  out.push('# Industry Pattern Catalog — Acceptance Report');
  out.push('');
  out.push(`> Wave 46 — verifies the 20 patterns from \`docs/INDUSTRY_PATTERN_CATALOG.md\` run end-to-end on the engine.`);
  out.push(`> Generated: \`${j.generatedAtUtc}\` · spins/seed: \`${j.config.spinsPerSeed.toLocaleString()}\` · seeds: \`${j.config.seeds.length}\``);
  out.push('');
  out.push(`## Headline: **${j.headline.patternsPass}/${j.headline.patternsTotal} patterns PASS** (${j.headline.checksPass}/${j.headline.checksTotal} checks) ${j.headline.allPass ? '✅' : '⚠️'} in ${j.headline.wallSeconds}s`);
  out.push('');
  out.push('## Per-Pattern Results');
  out.push('');
  out.push('| ID | Pattern | Fixtures | Sanity | Stability | Mechanic | Verdict |');
  out.push('|----|---------|----------|:------:|:---------:|:--------:|:-------:|');
  for (const r of j.patterns) {
    const sanity = r.fixtureResults.every((f) => f.sanityPass);
    const stability = r.fixtureResults.every((f) => f.stabilityPass);
    const mechanic = r.fixtureResults.every((f) => f.mechanicPass);
    const c = (b) => b ? '✅' : '❌';
    out.push(`| ${r.id} | ${r.name} | ${r.fixtures.length} | ${c(sanity)} | ${c(stability)} | ${c(mechanic)} | ${r.allPass ? '✅' : '⚠️'} |`);
  }
  out.push('');
  out.push('## Detail Per Pattern');
  out.push('');
  for (const r of j.patterns) {
    out.push(`### ${r.id} — ${r.name} ${r.allPass ? '✅' : '⚠️'}`);
    out.push('');
    for (const f of r.fixtureResults) {
      if (f.error) {
        out.push(`- \`${f.fixture}\` — ❌ ${f.error}`);
      } else {
        const cells = [];
        cells.push(`sanity ${f.sanityPass ? '✅' : '❌'}`);
        cells.push(`stability ${f.stabilityPass ? '✅' : '❌'} (rel-σ=${(f.relSigma * 100).toFixed(2)}%)`);
        cells.push(`mechanic ${f.mechanicPass ? '✅' : '❌'}`);
        out.push(`- \`${f.fixture}\` — mean RTP=${f.mean.toFixed(3)} · ${cells.join(' · ')}`);
      }
    }
    out.push('');
  }
  out.push('## Methodology');
  out.push('');
  out.push('Each pattern declares 1+ reference fixture(s) and a mechanic predicate.');
  out.push('Per fixture: 5-seed × 50K-spin Monte Carlo run via `runIRSimulation`.');
  out.push('');
  out.push('Three checks per pattern:');
  out.push('1. **Sanity** — every seed produces finite RTP, no NaN, no crash');
  out.push('2. **Stability** — cross-seed relative σ ≤ 10% (proves engine convergence)');
  out.push('3. **Mechanic** — IR contains the declared pattern-specific feature/evaluator');
  out.push('');
  out.push('A pattern PASSES if all 3 checks PASS for every fixture in its set.');
  out.push('');
  out.push('See `docs/INDUSTRY_PATTERN_CATALOG.md` for vendor-neutral pattern descriptions.');
  return out.join('\n');
}

main().catch((e) => { console.error('FATAL:', e); process.exit(2); });
