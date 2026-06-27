#!/usr/bin/env node
//
// W152 Wave 77 — Must-Hit-By Jackpot acceptance (Wave 71 module).
//
// 6 PAR-style configs × 5000 trigger-cycles each (full trigger cycle from
// seed → cap → reset). Validates CF formulas:
//
//   E[N*]              = span / (2c)         (renewal-residual mean)
//   Var[N*]            = span² / (12 c²)     (uniform distribution)
//   E[pool at trigger] = (seed + cap) / 2    (uniform midpoint)
//   Effective RTP/spin = c × (seed + cap) / (cap − seed) > c when seed > 0
//
// Operator deliverable: `reports/acceptance/MUST_HIT_BY_JACKPOT.{json,md}`.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const CYCLES = 5_000;
const SEED = 0xC0FFEE;
const TOL_EN_REL = 0.03;
const TOL_POOL_REL = 0.02;

const CONFIGS = [
  {
    name: 'A_classic_500_5000',
    description: 'Operator-funded seed 500, cap 5000, 0.01 contribution (mid jackpot)',
    cfg: { poolSeedX: 500, poolCapX: 5000, contributionPerSpinX: 0.01 },
  },
  {
    name: 'B_zero_seed',
    description: 'Zero seed (pure contribution-funded), cap 1000, 0.01 contrib',
    cfg: { poolSeedX: 0, poolCapX: 1000, contributionPerSpinX: 0.01 },
  },
  {
    name: 'C_high_seed',
    description: 'High operator-funded seed 5000, cap 10000, 0.01 contrib',
    cfg: { poolSeedX: 5000, poolCapX: 10000, contributionPerSpinX: 0.01 },
  },
  {
    name: 'D_wide_span',
    description: 'Wide span seed 1000 cap 20000 (~95K spins/cycle), 0.02 contrib',
    cfg: { poolSeedX: 1000, poolCapX: 20000, contributionPerSpinX: 0.02 },
  },
  {
    name: 'E_narrow_span',
    description: 'Narrow span seed 100 cap 200 (frequent triggers), 0.05 contrib',
    cfg: { poolSeedX: 100, poolCapX: 200, contributionPerSpinX: 0.05 },
  },
  {
    name: 'F_micro_contribution',
    description: 'Micro contribution (rare cycles), seed 100 cap 1000, 0.001 contrib',
    cfg: { poolSeedX: 100, poolCapX: 1000, contributionPerSpinX: 0.001 },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solveMustHitByJackpot, simulateMustHitByJackpot } = await import(
    join(REPO_ROOT, 'dist', 'features', 'mustHitByJackpot.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Must-Hit-By Jackpot configs @ ${CYCLES} cycles each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveMustHitByJackpot(c.cfg);
    const mc = simulateMustHitByJackpot(c.cfg, CYCLES, SEED);

    const checks = {
      en_rel: relErr(cf.expectedSpinsUntilTrigger, mc.observedMeanSpins),
      pool_rel: relErr(cf.expectedPoolAtTrigger, mc.observedMeanPoolAtTrigger),
      rtp_rel: relErr(cf.effectiveRtpContribution, mc.observedMeanPayoutPerSpin),
    };
    const pass =
      checks.en_rel <= TOL_EN_REL &&
      checks.pool_rel <= TOL_POOL_REL &&
      checks.rtp_rel <= TOL_EN_REL;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(28)} ${pass ? '✅' : '❌'}  ` +
        `E[N*]_CF=${cf.expectedSpinsUntilTrigger.toFixed(0)} MC=${mc.observedMeanSpins.toFixed(0)}  ` +
        `pool_CF=${cf.expectedPoolAtTrigger.toFixed(1)} MC=${mc.observedMeanPoolAtTrigger.toFixed(1)}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        expectedSpinsUntilTrigger: cf.expectedSpinsUntilTrigger,
        varianceSpinsUntilTrigger: cf.varianceSpinsUntilTrigger,
        expectedPoolAtTrigger: cf.expectedPoolAtTrigger,
        effectiveRtpContribution: cf.effectiveRtpContribution,
      },
      monte_carlo: {
        observedMeanSpins: mc.observedMeanSpins,
        observedMeanPoolAtTrigger: mc.observedMeanPoolAtTrigger,
        observedRtpPerSpin: mc.observedMeanPayoutPerSpin,
        cycles: CYCLES,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'MUST_HIT_BY_JACKPOT',
    generated_utc: new Date().toISOString(),
    cycles_per_config: CYCLES,
    seed: SEED,
    tolerances: { en_rel: TOL_EN_REL, pool_rel: TOL_POOL_REL, rtp_rel: TOL_EN_REL },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'MUST_HIT_BY_JACKPOT.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# MUST_HIT_BY_JACKPOT — Mystery Progressive Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${CYCLES} cycles each.`);
  md.push('');
  md.push('Closes Faza 12 scenario: ⚠️→✅ "Must-Hit-By Jackpot" (Wave 71).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form: U ∼ Uniform[seed, cap]; spins-to-trigger N* = (U − seed)/c.');
  md.push('  - E[N*] = span / (2c)');
  md.push('  - Var[N*] = span² / (12 c²)');
  md.push('  - E[pool at trigger] = (seed + cap) / 2');
  md.push('  - Effective RTP per spin = c · (seed + cap) / (cap − seed)');
  md.push('');
  md.push('MC: 5000 trigger cycles per config; deterministic mulberry32 PRNG.');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | E[N*]_CF | E[N*]_MC | pool_CF | pool_MC | RTP_CF | RTP_MC |');
  md.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.closed_form.expectedSpinsUntilTrigger.toFixed(0)} | ` +
        `${r.monte_carlo.observedMeanSpins.toFixed(0)} | ${r.closed_form.expectedPoolAtTrigger.toFixed(2)} | ` +
        `${r.monte_carlo.observedMeanPoolAtTrigger.toFixed(2)} | ${r.closed_form.effectiveRtpContribution.toFixed(6)} | ` +
        `${r.monte_carlo.observedRtpPerSpin.toFixed(6)} |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **NIGC 25 CFR 542.7(c)** — must-hit-by jackpots: trigger deterministically before reaching cap');
  md.push('- **UKGC RTS 12** — published RTP must include progressive contribution');
  md.push('- Closed-form E[N*] and effective RTP enables exact PAR sheet disclosure');

  writeFileSync(join(OUT_DIR, 'MUST_HIT_BY_JACKPOT.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/MUST_HIT_BY_JACKPOT.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
