#!/usr/bin/env node
//
// W152 Wave 128 — Anticipation/Tease Reel Probability Tracker acceptance (Wave 127).
//
// 6 PAR-style configs × 100K spins each = 600K total MC.
//
// Operator deliverable: `reports/acceptance/ANTICIPATION_REEL_TEASE.{json,md}`.
//
// UKGC RTS 8 §3.5 "false anticipation" prohibition compliance + MGA PPD §11.f
// anticipation disclosure.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const SPINS = 100_000;
const SEED = 0xCAFE0127;
const TOL_TRIG_ABS  = 0.01;   // P(trigger per spin) abs
const TOL_ANTIC_ABS = 0.01;   // P(anticipation per spin) abs
const TOL_FALSE_ABS = 0.02;   // false anticipation rate abs

const CONFIGS = [
  {
    name: 'A_pragmatic_5reel_K3_classic',
    description: 'Pragmatic 5-reel classic K=3 scatters, q=0.2, threshold=0.5',
    cfg: {
      reelCount: 5,
      scatterProbabilityPerReel: 0.20,
      triggerScatterCount: 3,
      anticipationThreshold: 0.5,
    },
  },
  {
    name: 'B_btg_megaways_6reel_K4',
    description: 'BTG Megaways tease 6-reel, K=4 scatters, q=0.15',
    cfg: {
      reelCount: 6,
      scatterProbabilityPerReel: 0.15,
      triggerScatterCount: 4,
      anticipationThreshold: 0.5,
    },
  },
  {
    name: 'C_netent_suspense_5reel_lowT',
    description: 'Vendor D suspense style: low threshold 0.3 (early UX activation)',
    cfg: {
      reelCount: 5,
      scatterProbabilityPerReel: 0.25,
      triggerScatterCount: 3,
      anticipationThreshold: 0.3,
    },
  },
  {
    name: 'D_high_freq_low_K',
    description: 'High-frequency q=0.4, low K=2 (easy trigger)',
    cfg: {
      reelCount: 5,
      scatterProbabilityPerReel: 0.40,
      triggerScatterCount: 2,
      anticipationThreshold: 0.5,
    },
  },
  {
    name: 'E_ukgc_strict_bayesian_T1',
    description: 'UKGC RTS 8 §3.5 strict-Bayesian: threshold=1.0 (zero false anticipation)',
    cfg: {
      reelCount: 5,
      scatterProbabilityPerReel: 0.20,
      triggerScatterCount: 3,
      anticipationThreshold: 1.0,
    },
  },
  {
    name: 'F_rare_trigger_long_tease',
    description: 'Rare trigger q=0.10 K=4, low threshold 0.2 → long-tease scenario',
    cfg: {
      reelCount: 5,
      scatterProbabilityPerReel: 0.10,
      triggerScatterCount: 4,
      anticipationThreshold: 0.2,
    },
  },
];

async function main() {
  const { solveAnticipationReelTease, simulateAnticipationReelTease } = await import(
    join(REPO_ROOT, 'dist', 'features', 'anticipationReelTease.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Anticipation/Tease Reel configs @ ${SPINS} spins each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveAnticipationReelTease(c.cfg);
    const mc = simulateAnticipationReelTease(c.cfg, SPINS, SEED);

    const trigAbs = Math.abs(cf.probBonusTriggerPerSpin - mc.observedBonusTriggersPerSpin);
    const anticAbs = Math.abs(cf.probAnticipationPerSpin - mc.observedAnticipationActivationsPerSpin);
    const falseAbs = Math.abs(cf.falseAnticipationRate - mc.observedFalseAnticipationFraction);

    const checks = {
      trig_abs: trigAbs,
      antic_abs: anticAbs,
      false_abs: falseAbs,
    };
    const pass =
      trigAbs <= TOL_TRIG_ABS &&
      anticAbs <= TOL_ANTIC_ABS &&
      falseAbs <= TOL_FALSE_ABS;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(36)} ${pass ? '✅' : '❌'}  ` +
        `P(trig)_CF=${(cf.probBonusTriggerPerSpin * 100).toFixed(3)}% MC=${(mc.observedBonusTriggersPerSpin * 100).toFixed(3)}%  ` +
        `P(antic)_CF=${(cf.probAnticipationPerSpin * 100).toFixed(3)}% MC=${(mc.observedAnticipationActivationsPerSpin * 100).toFixed(3)}%  ` +
        `falseRate=${(cf.falseAnticipationRate * 100).toFixed(2)}%/${(mc.observedFalseAnticipationFraction * 100).toFixed(2)}%  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        reelCount: cf.reelCount,
        scatterProbabilityPerReel: cf.scatterProbabilityPerReel,
        triggerScatterCount: cf.triggerScatterCount,
        anticipationThreshold: cf.anticipationThreshold,
        probAnticipationPerSpin: cf.probAnticipationPerSpin,
        expectedAnticipationDuration: cf.expectedAnticipationDuration,
        probBonusTriggerPerSpin: cf.probBonusTriggerPerSpin,
        probAnticipationButNoTrigger: cf.probAnticipationButNoTrigger,
        falseAnticipationRate: cf.falseAnticipationRate,
        perReel: cf.perReel,
      },
      monte_carlo: {
        spins: SPINS,
        observedAnticipationActivationsPerSpin: mc.observedAnticipationActivationsPerSpin,
        observedBonusTriggersPerSpin: mc.observedBonusTriggersPerSpin,
        observedFalseAnticipationFraction: mc.observedFalseAnticipationFraction,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'ANTICIPATION_REEL_TEASE',
    generated_utc: new Date().toISOString(),
    spins_per_config: SPINS,
    seed: SEED,
    tolerances: {
      trig_abs: TOL_TRIG_ABS,
      antic_abs: TOL_ANTIC_ABS,
      false_abs: TOL_FALSE_ABS,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'ANTICIPATION_REEL_TEASE.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# ANTICIPATION_REEL_TEASE — Bayesian Anticipation/Tease Tracker Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${SPINS} spins each = ${(CONFIGS.length * SPINS / 1e3).toFixed(0)}K total MC.`);
  md.push('');
  md.push('Closes Faza 12 ext (post-W100): ✅ "Anticipation/Tease Reel Probability Tracker" (Wave 127).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form Bayesian conditional:');
  md.push('  - N reels independent Bernoulli scatter (per-reel prob q)');
  md.push('  - Bonus trigger requires K total scatters');
  md.push('  - **P(trigger | m, i) = Σ_{j=K-m}^{N-i} C(N-i,j)·q^j·(1-q)^(N-i-j)**');
  md.push('  - Anticipation activated kada conditional ≥ threshold T (UX/cinematic)');
  md.push('  - Forward state propagation za exact P(any antic per spin)');
  md.push('  - **falseAnticipationRate = P(no trigger | activated)** UKGC RTS 8 §3.5 metric');
  md.push('');
  md.push('MC: 100K spins per config, mulberry32 RNG, per-reel scatter sampling.');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | N/K | q | T | P(trig) | P(antic) | False% |');
  md.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ` +
        `${r.closed_form.reelCount}/${r.closed_form.triggerScatterCount} | ` +
        `${r.closed_form.scatterProbabilityPerReel} | ` +
        `${r.closed_form.anticipationThreshold} | ` +
        `${(r.closed_form.probBonusTriggerPerSpin * 100).toFixed(3)}% | ` +
        `${(r.closed_form.probAnticipationPerSpin * 100).toFixed(3)}% | ` +
        `${(r.closed_form.falseAnticipationRate * 100).toFixed(2)}% |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 8 §3.5** — "false anticipation" prohibition (compliant if threshold=1.0)');
  md.push('- **MGA PPD §11.f** — anticipation rate operator-facing disclosure');
  md.push('- **eCOGRA Generic Slots Audit** — verifies anticipation matches Bayesian conditional');
  md.push('- Industry use: BTG Megaways tease reels, Pragmatic anticipation reels,');
  md.push('  Vendor D suspense reels, branded slot-game UX patterns.');

  writeFileSync(join(OUT_DIR, 'ANTICIPATION_REEL_TEASE.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/ANTICIPATION_REEL_TEASE.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
