#!/usr/bin/env node
//
// W152 Wave 189 — Random Feature-Injection During FS Aggregator acceptance
// (70. solver, Vendor B M12 P1 GAP CLOSURE — Wizard of Oz Munchkinland +
// WMS sub-feature library).

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const FS_RUNS = 30_000;
const SEED = 0xCAFE0189;

const TOL_PAYOUT_REL = 0.07;
const TOL_INJ_REL = 0.05;
const TOL_PROB_ABS = 0.03;

const CONFIGS = [
  {
    name: "A_wizard_of_oz_munchkinland_classic",
    description: "Vendor B WMS Wizard of Oz Munchkinland (2014, defining title) — 15 FS sa 18% Munchkin injection rate, sub-feature 12× avg.",
    cfg: { numFreeSpins: 15, baseFsWinMean: 1.2, baseFsWinVar: 1, probInjectionPerFsSpin: 0.18, subFeatureMean: 12, subFeatureVar: 4, topTierSubFeatureShare: 0.05 },
  },
  {
    name: "B_wms_sub_feature_lib_high_inject",
    description: "WMS sub-feature library variant — 10 FS sa 30% inject rate.",
    cfg: { numFreeSpins: 10, baseFsWinMean: 1.0, baseFsWinVar: 0.5, probInjectionPerFsSpin: 0.30, subFeatureMean: 6, subFeatureVar: 2 },
  },
  {
    name: "C_long_fs_rare_injection",
    description: "Long 30-FS bonus sa rare 5% injection rate — high P(at least one).",
    cfg: { numFreeSpins: 30, baseFsWinMean: 0.8, baseFsWinVar: 0.25, probInjectionPerFsSpin: 0.05, subFeatureMean: 20, subFeatureVar: 4 },
  },
  {
    name: "D_short_fs_high_inject_payout",
    description: "Short 5-FS bonus sa 25% injection sa large payout.",
    cfg: { numFreeSpins: 5, baseFsWinMean: 2.0, baseFsWinVar: 1, probInjectionPerFsSpin: 0.25, subFeatureMean: 15, subFeatureVar: 4 },
  },
  {
    name: "E_corner_zero_base_full_injection_driven",
    description: "Corner: zero base FS win, injection-only payout (degenerate share=1).",
    cfg: { numFreeSpins: 12, baseFsWinMean: 0, baseFsWinVar: 0, probInjectionPerFsSpin: 0.20, subFeatureMean: 10, subFeatureVar: 1 },
  },
  {
    name: "F_corner_N1_single_fs_spin",
    description: "Corner: N=1 single FS spin (degenerate to base + Bernoulli injection).",
    cfg: { numFreeSpins: 1, baseFsWinMean: 5, baseFsWinVar: 0.25, probInjectionPerFsSpin: 0.20, subFeatureMean: 20, subFeatureVar: 1 },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);
}

async function main() {
  const { analyzeRandomFeatureInjectionDuringFs, simulateRandomFeatureInjectionDuringFs } =
    await import(join(REPO_ROOT, 'dist', 'features', 'randomFeatureInjectionDuringFs.js'));
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Random Feature-Injection FS configs @ ${FS_RUNS} MC FS-bonuses each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = analyzeRandomFeatureInjectionDuringFs(c.cfg);
    const mc = simulateRandomFeatureInjectionDuringFs(c.cfg, FS_RUNS, SEED);

    const payoutRel = cf.expectedTotalFsPayout > 0.001
      ? relErr(cf.expectedTotalFsPayout, mc.meanTotalFsPayout)
      : Math.abs(cf.expectedTotalFsPayout - mc.meanTotalFsPayout);
    const injRel = cf.expectedInjectionsPerFsBonus > 0.001
      ? relErr(cf.expectedInjectionsPerFsBonus, mc.meanInjectionsPerBonus)
      : Math.abs(cf.expectedInjectionsPerFsBonus - mc.meanInjectionsPerBonus);
    const probAbs = Math.abs(cf.probAtLeastOneInjection - mc.observedProbAtLeastOneInjection);

    const checks = { payout_rel: payoutRel, inj_rel: injRel, prob_abs: probAbs };
    const pass = payoutRel <= TOL_PAYOUT_REL && injRel <= TOL_INJ_REL && probAbs <= TOL_PROB_ABS;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(46)} ${pass ? '✅' : '❌'}  ` +
        `N=${c.cfg.numFreeSpins} p=${c.cfg.probInjectionPerFsSpin}  ` +
        `E[S]=${cf.expectedTotalFsPayout.toFixed(2)}/${mc.meanTotalFsPayout.toFixed(2)}  ` +
        `E[inj]=${cf.expectedInjectionsPerFsBonus.toFixed(2)}/${mc.meanInjectionsPerBonus.toFixed(2)}  ` +
        `P(≥1)=${(cf.probAtLeastOneInjection * 100).toFixed(1)}%/${(mc.observedProbAtLeastOneInjection * 100).toFixed(1)}%  ` +
        `uplift=${cf.commercialUpliftVsBaseFs.toFixed(2)}×  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name, description: c.description, cfg: c.cfg,
      closed_form: cf, monte_carlo: { ...mc, fs_runs: FS_RUNS },
      checks, pass, elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0', report_id: 'RANDOM_FEATURE_INJECTION_DURING_FS',
    generated_utc: new Date().toISOString(), fs_runs_per_config: FS_RUNS, seed: SEED,
    tolerances: { payout_rel: TOL_PAYOUT_REL, inj_rel: TOL_INJ_REL, prob_abs: TOL_PROB_ABS },
    overall_pass: allOK, configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length, configs: results,
  };
  writeFileSync(join(OUT_DIR, 'RANDOM_FEATURE_INJECTION_DURING_FS.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# RANDOM_FEATURE_INJECTION_DURING_FS — Random Feature-Injection During FS Aggregator Acceptance (W189, 70. solver, Vendor B M12 P1 GAP CLOSURE)');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** @ ${FS_RUNS} MC FS-bonus runs each.`);
  md.push('');
  md.push("Closes Vendor B M12 GAP — Wizard of Oz Munchkinland + WMS sub-feature library.");
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Compound per-FS-spin Bernoulli injection: per spin k, base Y_k + I_k·V_k where I_k~Bernoulli(p_inject), V_k iid.');
  md.push('  - **E[S] = N·μ_Y + N·p·μ_V**');
  md.push('  - **Var[S] = N·σ²_Y + N·p·σ²_V + N·p(1-p)·μ²_V**');
  md.push('  - **P(at least one inject) = 1 − (1−p)^N**');
  md.push('');
  md.push('## Configs');
  md.push('| Config | Pass | N | p | E[S] CF/MC | E[inj] CF/MC | P(≥1) |');
  md.push('|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(`| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.cfg.numFreeSpins} | ${r.cfg.probInjectionPerFsSpin} | ${r.closed_form.expectedTotalFsPayout.toFixed(2)}/${r.monte_carlo.meanTotalFsPayout.toFixed(2)} | ${r.closed_form.expectedInjectionsPerFsBonus.toFixed(2)}/${r.monte_carlo.meanInjectionsPerBonus.toFixed(2)} | ${(r.closed_form.probAtLeastOneInjection*100).toFixed(1)}%/${(r.monte_carlo.observedProbAtLeastOneInjection*100).toFixed(1)}% |`);
  }
  md.push('');
  md.push('## Compliance: UKGC RTS-14 FS sub-feature disclosure / MGA PPD §11 / eCOGRA / EU GA 2024.');
  md.push('');
  md.push("Industry: Wizard of Oz Munchkinland (2014) + WMS sub-feature library variants.");
  writeFileSync(join(OUT_DIR, 'RANDOM_FEATURE_INJECTION_DURING_FS.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
