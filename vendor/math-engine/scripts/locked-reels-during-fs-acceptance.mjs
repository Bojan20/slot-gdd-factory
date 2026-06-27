#!/usr/bin/env node
//
// W152 Wave 137 — Locked/Held Reels During FS Analyzer acceptance (Wave 136).
//
// 6 PAR-style configs × 50K episodes each = 300K total MC episodes (~2-4M
// FS spins sumarno).
//
// Operator deliverable: `reports/acceptance/LOCKED_REELS_FS.{json,md}`.
//
// UKGC RTS 14 + MGA PPD §11.f compliance: retrigger frequency disclosure
// za lock-and-spin tokom FS mehaniku.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const EPISODES = 50_000;
const SEED = 0xCAFE0136;
const TOL_RETRIG_ABS = 0.05;  // E[retriggers] abs
const TOL_ANY_ABS    = 0.02;  // P(any retrigger) abs
const TOL_FRESH_REL  = 0.05;  // fresh scatters per spin rel

const CONFIGS = [
  {
    name: 'A_pragmatic_wolf_gold_5reel_3held',
    description: 'Pragmatic Wolf Gold: 5-reel sa 3 held + 8 FS, q=0.20',
    cfg: {
      totalReels: 5,
      heldReels: 3,
      freeSpins: 8,
      freshScatterProbabilityPerReel: 0.20,
      retriggerScatterThreshold: 5,
    },
  },
  {
    name: 'B_buffalo_king_6reel_4held',
    description: 'Buffalo King: 6-reel sa 4 held + 10 FS, q=0.18',
    cfg: {
      totalReels: 6,
      heldReels: 4,
      freeSpins: 10,
      freshScatterProbabilityPerReel: 0.18,
      retriggerScatterThreshold: 5,
    },
  },
  {
    name: 'C_john_hunter_tomb_6reel_long_fs',
    description: 'John Hunter Tomb: 6-reel 4-held + 15 FS, q=0.12',
    cfg: {
      totalReels: 6,
      heldReels: 4,
      freeSpins: 15,
      freshScatterProbabilityPerReel: 0.12,
      retriggerScatterThreshold: 6,
    },
  },
  {
    name: 'D_high_threshold_rare_retrigger',
    description: 'Rare retrigger: T=N (need full reel scatter), low q',
    cfg: {
      totalReels: 5,
      heldReels: 2,
      freeSpins: 10,
      freshScatterProbabilityPerReel: 0.08,
      retriggerScatterThreshold: 5,
    },
  },
  {
    name: 'E_corner_held_already_at_threshold',
    description: 'Corner: held = T → every spin retriggers (P_re=1)',
    cfg: {
      totalReels: 5,
      heldReels: 5,
      freeSpins: 5,
      freshScatterProbabilityPerReel: 0.20,
      retriggerScatterThreshold: 5,
    },
  },
  {
    name: 'F_corner_impossible_threshold',
    description: 'Corner: T > N (impossible retrigger, P_re=0)',
    cfg: {
      totalReels: 5,
      heldReels: 1,
      freeSpins: 10,
      freshScatterProbabilityPerReel: 0.10,
      retriggerScatterThreshold: 5,
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solveLockedReelsDuringFs, simulateLockedReelsDuringFs } = await import(
    join(REPO_ROOT, 'dist', 'features', 'lockedReelsDuringFs.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Locked/Held Reels During FS configs @ ${EPISODES} episodes each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveLockedReelsDuringFs(c.cfg);
    const mc = simulateLockedReelsDuringFs(c.cfg, EPISODES, SEED);

    const retrigAbs = Math.abs(cf.expectedRetriggersAcrossFs - mc.observedMeanRetriggersPerEpisode);
    const anyAbs = Math.abs(cf.probAnyRetriggerAcrossFs - mc.observedAnyRetriggerFraction);
    const freshRel = cf.expectedFreshScattersPerSpin > 1e-9
      ? relErr(cf.expectedFreshScattersPerSpin, mc.observedMeanFreshScattersPerSpin)
      : Math.abs(cf.expectedFreshScattersPerSpin - mc.observedMeanFreshScattersPerSpin);

    const checks = {
      retrig_abs: retrigAbs,
      any_abs: anyAbs,
      fresh_rel: freshRel,
    };
    const pass =
      retrigAbs <= TOL_RETRIG_ABS &&
      anyAbs <= TOL_ANY_ABS &&
      freshRel <= TOL_FRESH_REL;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(38)} ${pass ? '✅' : '❌'}  ` +
        `P_re=${(cf.probRetriggerPerSpin * 100).toFixed(3)}%  ` +
        `E[retrig]_CF=${cf.expectedRetriggersAcrossFs.toFixed(4)} MC=${mc.observedMeanRetriggersPerEpisode.toFixed(4)}  ` +
        `P(any)=${(cf.probAnyRetriggerAcrossFs * 100).toFixed(2)}%/${(mc.observedAnyRetriggerFraction * 100).toFixed(2)}%  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: c.cfg,
      closed_form: {
        totalReels: cf.totalReels,
        heldReels: cf.heldReels,
        freeSpins: cf.freeSpins,
        retriggerScatterThreshold: cf.retriggerScatterThreshold,
        probRetriggerPerSpin: cf.probRetriggerPerSpin,
        expectedFreshScattersPerSpin: cf.expectedFreshScattersPerSpin,
        expectedTotalScattersPerSpin: cf.expectedTotalScattersPerSpin,
        expectedRetriggersAcrossFs: cf.expectedRetriggersAcrossFs,
        probAnyRetriggerAcrossFs: cf.probAnyRetriggerAcrossFs,
        varianceRetriggers: cf.varianceRetriggers,
        expectedTimeToFirstRetrigger: cf.expectedTimeToFirstRetrigger,
      },
      monte_carlo: {
        episodes: EPISODES,
        observedMeanRetriggersPerEpisode: mc.observedMeanRetriggersPerEpisode,
        observedAnyRetriggerFraction: mc.observedAnyRetriggerFraction,
        observedMeanFreshScattersPerSpin: mc.observedMeanFreshScattersPerSpin,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'LOCKED_REELS_FS',
    generated_utc: new Date().toISOString(),
    episodes_per_config: EPISODES,
    seed: SEED,
    tolerances: {
      retrig_abs: TOL_RETRIG_ABS,
      any_abs: TOL_ANY_ABS,
      fresh_rel: TOL_FRESH_REL,
    },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };
  writeFileSync(join(OUT_DIR, 'LOCKED_REELS_FS.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# LOCKED_REELS_FS — Locked/Held Reels During FS Analyzer Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${EPISODES} episodes each = ${(CONFIGS.length * EPISODES / 1e3).toFixed(0)}K total MC episodes.`);
  md.push('');
  md.push('Closes Faza 4.3 ext (post-W100): ✅ "Locked/Held Reels During FS Analyzer" (Wave 136).');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form retrigger conditional analyzer:');
  md.push('  - K trigger reels held kroz M FS spins (locked scatter visible)');
  md.push('  - Per non-held reel: fresh scatter Bernoulli(q), independent');
  md.push('  - **P_re = P(Bin(N−K, q) ≥ T−K)** Binomial tail');
  md.push('  - E[retriggers across FS] = M·P_re');
  md.push('  - P(any retrigger) = 1−(1−P_re)^M');
  md.push('  - E[time-to-first] = (1−(1−P_re)^M)/P_re (truncated by M)');
  md.push('');
  md.push('MC: 50K episodes per config, mulberry32 RNG, per-FS-spin Binomial scatter sampling.');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | P_re | E[retrig] | P(any) | E[T_first] |');
  md.push('|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ` +
        `${(r.closed_form.probRetriggerPerSpin * 100).toFixed(3)}% | ` +
        `${r.closed_form.expectedRetriggersAcrossFs.toFixed(4)} | ` +
        `${(r.closed_form.probAnyRetriggerAcrossFs * 100).toFixed(2)}% | ` +
        `${r.closed_form.expectedTimeToFirstRetrigger.toFixed(2)} |`,
    );
  }
  md.push('');
  md.push('## Compliance context');
  md.push('');
  md.push('- **UKGC RTS 14** — retrigger frequency disclosure');
  md.push('- **MGA PPD §11.f** — operator-facing held-reel retrigger rate');
  md.push('- **eCOGRA Generic Slots Audit** — verifies retrigger probability matches engine');
  md.push('- Industry use: Pragmatic Wolf Gold / Buffalo King / John Hunter Tomb, Push Mount');
  md.push('  Magmas / Yggdrasil Vault of Anubis lock-and-spin FS variants.');

  writeFileSync(join(OUT_DIR, 'LOCKED_REELS_FS.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/LOCKED_REELS_FS.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
