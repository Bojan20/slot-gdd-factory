#!/usr/bin/env node
//
// W152 Wave 187 — Deterministic Explosion Multiplier-Drop Aggregator acceptance
// (68. solver, Vendor B M4 P1 GAP CLOSURE — Dancing Drums Explosion + Revolution).
//
// 6 industry configs × 100K MC spins = 600K total spin sims sa Bernoulli-trigger
// + iid discrete multiplier draws MC vs exact CF.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const SPINS = 100_000;
const SEED = 0xCAFE0187;

const TOL_PAYOUT_REL = 0.10;
const TOL_TRIGGER_ABS = 0.01;
const TOL_MULT_VALUE_REL = 0.05;

const CONFIGS = [
  {
    name: "A_dancing_drums_explosion_classic_5pos",
    description: "Vendor B Vendor H Dancing Drums Explosion (2020) — 5 positions, 2×/3×/5× distribution, p_trigger=3%, base value 8.",
    cfg: {
      probTriggerPerSpin: 0.03,
      numExplodingPositions: 5,
      multiplierValueDistribution: [
        { value: 2, probability: 0.6 },
        { value: 3, probability: 0.3 },
        { value: 5, probability: 0.1 },
      ],
      freePositionBaseValue: 8,
    },
  },
  {
    name: "B_dancing_drums_revolution_8pos_extended",
    description: "Dancing Drums Revolution (2025 LightWave) — 8 positions, extended 2×/3×/5×/10×/25× sa rare 25× top.",
    cfg: {
      probTriggerPerSpin: 0.02,
      numExplodingPositions: 8,
      multiplierValueDistribution: [
        { value: 2, probability: 0.45 },
        { value: 3, probability: 0.3 },
        { value: 5, probability: 0.15 },
        { value: 10, probability: 0.07 },
        { value: 25, probability: 0.03 },
      ],
      freePositionBaseValue: 10,
    },
  },
  {
    name: "C_explosion_high_frequency_low_max",
    description: "High-frequency explosion (10%) sa low-vol distribution 1×/2×/3×.",
    cfg: {
      probTriggerPerSpin: 0.10,
      numExplodingPositions: 6,
      multiplierValueDistribution: [
        { value: 1, probability: 0.5 },
        { value: 2, probability: 0.35 },
        { value: 3, probability: 0.15 },
      ],
      freePositionBaseValue: 5,
    },
  },
  {
    name: "D_explosion_jackpot_skewed_to_top",
    description: "Jackpot-skewed: rare 1% trigger sa 50× top tier @ 5% probability — heavy-tail commercial.",
    cfg: {
      probTriggerPerSpin: 0.01,
      numExplodingPositions: 5,
      multiplierValueDistribution: [
        { value: 2, probability: 0.6 },
        { value: 5, probability: 0.25 },
        { value: 10, probability: 0.10 },
        { value: 50, probability: 0.05 },
      ],
      freePositionBaseValue: 12,
    },
  },
  {
    name: "E_corner_single_value_deterministic_mult",
    description: "Corner: degenerate single-value PMF — V = 3× constant (zero variance per position).",
    cfg: {
      probTriggerPerSpin: 0.05,
      numExplodingPositions: 4,
      multiplierValueDistribution: [{ value: 3, probability: 1 }],
      freePositionBaseValue: 10,
    },
  },
  {
    name: "F_corner_single_position_K1",
    description: "Corner: K=1 (single position explosion) — validate K=1 degenerate to single-V draw.",
    cfg: {
      probTriggerPerSpin: 0.08,
      numExplodingPositions: 1,
      multiplierValueDistribution: [
        { value: 2, probability: 0.5 },
        { value: 5, probability: 0.4 },
        { value: 10, probability: 0.1 },
      ],
      freePositionBaseValue: 20,
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);
}

async function main() {
  const { analyzeDeterministicExplosion, simulateDeterministicExplosion } = await import(
    join(REPO_ROOT, 'dist', 'features', 'deterministicExplosionMultiplierDrop.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(
    `Validating ${CONFIGS.length} Deterministic Explosion configs @ ${SPINS} MC spins each…`,
  );

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = analyzeDeterministicExplosion(c.cfg);
    const mc = simulateDeterministicExplosion(c.cfg, SPINS, SEED);

    const payoutRel =
      cf.expectedPayoutPerSpin > 0.001
        ? relErr(cf.expectedPayoutPerSpin, mc.meanPayoutPerSpin)
        : Math.abs(cf.expectedPayoutPerSpin - mc.meanPayoutPerSpin);
    const triggerAbs = Math.abs(c.cfg.probTriggerPerSpin - mc.observedTriggerRate);
    const multValueRel =
      cf.expectedMultiplierValue > 0.001 && mc.meanMultiplierValueAcrossPositions > 0.001
        ? relErr(cf.expectedMultiplierValue, mc.meanMultiplierValueAcrossPositions)
        : 0;

    const checks = {
      payout_rel: payoutRel,
      trigger_abs: triggerAbs,
      mult_value_rel: multValueRel,
    };
    const pass =
      payoutRel <= TOL_PAYOUT_REL &&
      triggerAbs <= TOL_TRIGGER_ABS &&
      multValueRel <= TOL_MULT_VALUE_REL;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(48)} ${pass ? '✅' : '❌'}  ` +
        `p=${c.cfg.probTriggerPerSpin} K=${c.cfg.numExplodingPositions}  ` +
        `E[V]=${cf.expectedMultiplierValue.toFixed(2)}/${mc.meanMultiplierValueAcrossPositions.toFixed(2)}  ` +
        `E[Y]=${cf.expectedPayoutPerSpin.toFixed(3)}/${mc.meanPayoutPerSpin.toFixed(3)}  ` +
        `1in${cf.oneInNSpinsAllMaxExplosion === Infinity ? '∞' : cf.oneInNSpinsAllMaxExplosion.toFixed(0)} all-max  ` +
        `trig=${(mc.observedTriggerRate*100).toFixed(2)}%  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        expectedMultiplierValue: cf.expectedMultiplierValue,
        varianceMultiplierValue: cf.varianceMultiplierValue,
        expectedTotalPayoutGivenTrigger: cf.expectedTotalPayoutGivenTrigger,
        varianceTotalPayoutGivenTrigger: cf.varianceTotalPayoutGivenTrigger,
        expectedPayoutPerSpin: cf.expectedPayoutPerSpin,
        variancePayoutPerSpin: cf.variancePayoutPerSpin,
        stdDevPayoutPerSpin: cf.stdDevPayoutPerSpin,
        maxTotalMultiplierAchievable: cf.maxTotalMultiplierAchievable,
        probAllPositionsHitMaxGivenTrigger: cf.probAllPositionsHitMaxGivenTrigger,
        probAllPositionsHitMaxPerSpin: cf.probAllPositionsHitMaxPerSpin,
        oneInNSpinsAllMaxExplosion: cf.oneInNSpinsAllMaxExplosion,
        perValueDisclosure: cf.perValueDisclosure,
        commercialUpliftVsFlatBaseline: cf.commercialUpliftVsFlatBaseline,
        topTierRtpContribution: cf.topTierRtpContribution,
      },
      monte_carlo: {
        spins: SPINS,
        meanPayoutPerSpin: mc.meanPayoutPerSpin,
        stdDevPayoutPerSpin: mc.stdDevPayoutPerSpin,
        observedTriggerRate: mc.observedTriggerRate,
        meanMultiplierValueAcrossPositions: mc.meanMultiplierValueAcrossPositions,
        observedProbAllMaxPerSpin: mc.observedProbAllMaxPerSpin,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'DETERMINISTIC_EXPLOSION_MULTIPLIER_DROP',
    generated_utc: new Date().toISOString(),
    spins_per_config: SPINS,
    seed: SEED,
    tolerances: {
      payout_rel: TOL_PAYOUT_REL,
      trigger_abs: TOL_TRIGGER_ABS,
      mult_value_rel: TOL_MULT_VALUE_REL,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(
    join(OUT_DIR, 'DETERMINISTIC_EXPLOSION_MULTIPLIER_DROP.json'),
    JSON.stringify(summary, null, 2),
  );

  const md = [];
  md.push('# DETERMINISTIC_EXPLOSION_MULTIPLIER_DROP — Deterministic Explosion Multiplier-Drop Aggregator Acceptance (W187, 68. solver, Vendor B M4 P1 GAP CLOSURE)');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${SPINS} MC spins each = ${(CONFIGS.length * SPINS / 1e3).toFixed(0)}K total spin sims.`);
  md.push('');
  md.push("Closes Faza 12 ext (post-W100): ✅ \"Deterministic Explosion Multiplier-Drop Aggregator\" (Wave 187 — 68. closed-form solver, Vendor B M4 P1 GAP CLOSED — Dancing Drums Explosion + Revolution).");
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Trigger-gated compound sum:');
  md.push('  - Per spin: T ~ Bernoulli(p_trigger)');
  md.push('  - Conditional on trigger: K predetermined positions explode, each gets V_k iid iz discrete PMF {(v_l, π_l)}');
  md.push('  - **E[Y per spin] = p_trigger · K · c · E[V]**');
  md.push('  - **Var[Y per spin]** via law of total variance: p·K·c²·Var[V] + p·(1−p)·(K·c·E[V])²');
  md.push('  - **P(all K hit v_max | trigger) = π_max^K**');
  md.push('  - **oneInNSpinsAllMaxExplosion = 1 / (p_trigger · π_max^K)**');
  md.push('  - Per-value disclosure: 1−(1−π_l)^K za P(at least one position hits v_l)');
  md.push('');
  md.push('MC: per-spin Bernoulli trigger + K iid multiplier draws iz cumulative PMF.');
  md.push('');
  md.push('## Configs — Deterministic Explosion operator disclosure table');
  md.push('');
  md.push('| Config | Pass | p_trig | K | E[V] CF/MC | E[Y/spin] CF/MC | maxMult | 1-in-N all-max |');
  md.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const cf = r.closed_form;
    const mc = r.monte_carlo;
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.cfg.probTriggerPerSpin} | ${r.cfg.numExplodingPositions} | ${cf.expectedMultiplierValue.toFixed(2)}/${mc.meanMultiplierValueAcrossPositions.toFixed(2)} | ${cf.expectedPayoutPerSpin.toFixed(3)}/${mc.meanPayoutPerSpin.toFixed(3)} | ${cf.maxTotalMultiplierAchievable} | ${cf.oneInNSpinsAllMaxExplosion === Infinity ? '∞' : cf.oneInNSpinsAllMaxExplosion.toFixed(0)} |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS-14** — max-win mandatory disclosure (per-position multiplier × max value tracking).');
  md.push('- **MGA PPD §11** — explosion-mechanic transparency.');
  md.push('- **eCOGRA Generic Slots Audit** — deterministic-position mechanic audit.');
  md.push('- **EU GA 2024** — cross-jurisdiction baseline.');
  md.push('');
  md.push('Industry use: Vendor B M4 gap — Vendor B Vendor H Dancing Drums Explosion (2020, defining title), Dancing Drums Revolution (2025 LightWave cabinet extended 8-position).');

  writeFileSync(join(OUT_DIR, 'DETERMINISTIC_EXPLOSION_MULTIPLIER_DROP.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/DETERMINISTIC_EXPLOSION_MULTIPLIER_DROP.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
