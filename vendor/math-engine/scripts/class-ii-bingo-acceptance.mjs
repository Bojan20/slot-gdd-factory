#!/usr/bin/env node
//
// W152 Wave 59 — Class-II Bingo coordinator acceptance.
//
// 6 synthetic configs × 50K MC games = 300K total. NIGC Class-II compliance
// math regime (predetermined-outcome bingo + cosmetic slot UI overlay).

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

const GAMES = 50_000;
const SEED = 12345;
const TOL_HIT_REL = 0.05;
const TOL_PER_PATTERN_ABS = 0.01;
const TOL_EY_REL = 0.05;

function buildStandardCard() {
  return [
    3, 7, 12, 14, 5,
    16, 19, 22, 25, 28,
    31, 35, 42, 45,
    46, 49, 53, 55, 58,
    61, 65, 67, 71, 73,
  ];
}

function buildPatterns(card, kinds = ['rows', 'cols', 'diags']) {
  const out = [];
  if (kinds.includes('rows')) {
    for (let r = 0; r < 5; r++) {
      const cells = [0 + r, 5 + r, r < 2 ? 10 + r : (r > 2 ? 9 + r : -1), 14 + r, 19 + r];
      const required = cells.filter((c) => c >= 0).map((c) => card[c]);
      out.push({ id: `ROW_${r}`, requiredNumbers: required, payoutX: 10 });
    }
  }
  if (kinds.includes('cols')) {
    out.push({ id: 'COL_B', requiredNumbers: card.slice(0, 5), payoutX: 10 });
    out.push({ id: 'COL_I', requiredNumbers: card.slice(5, 10), payoutX: 10 });
    out.push({ id: 'COL_N', requiredNumbers: card.slice(10, 14), payoutX: 10 });
    out.push({ id: 'COL_G', requiredNumbers: card.slice(14, 19), payoutX: 10 });
    out.push({ id: 'COL_O', requiredNumbers: card.slice(19, 24), payoutX: 10 });
  }
  if (kinds.includes('diags')) {
    out.push({ id: 'DIAG_TL_BR', requiredNumbers: [card[0], card[6], card[17], card[23]], payoutX: 20 });
    out.push({ id: 'DIAG_TR_BL', requiredNumbers: [card[19], card[15], card[8], card[4]], payoutX: 20 });
  }
  return out;
}

const card = buildStandardCard();

const CONFIGS = [
  {
    name: 'A_50balls_5rows_all_match',
    description: '50 balls, 5 row patterns, all_matches',
    cfg: {
      ballPoolSize: 75,
      cardNumbers: card,
      patterns: buildPatterns(card, ['rows']),
      totalBallsDrawn: 50,
      prizeMode: 'all_matches',
    },
  },
  {
    name: 'B_50balls_12patterns_all',
    description: '50 balls, 12 standard patterns (rows+cols+diags), all_matches',
    cfg: {
      ballPoolSize: 75,
      cardNumbers: card,
      patterns: buildPatterns(card, ['rows', 'cols', 'diags']),
      totalBallsDrawn: 50,
      prizeMode: 'all_matches',
    },
  },
  {
    name: 'C_30balls_rare_hits',
    description: '30 balls (rare hits regime), 12 patterns, all_matches',
    cfg: {
      ballPoolSize: 75,
      cardNumbers: card,
      patterns: buildPatterns(card, ['rows', 'cols', 'diags']),
      totalBallsDrawn: 30,
      prizeMode: 'all_matches',
    },
  },
  {
    name: 'D_60balls_dense_hits',
    description: '60 balls (most patterns hit), 12 patterns, all_matches',
    cfg: {
      ballPoolSize: 75,
      cardNumbers: card,
      patterns: buildPatterns(card, ['rows', 'cols', 'diags']),
      totalBallsDrawn: 60,
      prizeMode: 'all_matches',
    },
  },
  {
    name: 'E_90ball_pool',
    description: '90-ball pool (90 numbers, draw 60), 5 row patterns, all_matches',
    cfg: {
      ballPoolSize: 90,
      cardNumbers: [...card, 76, 78, 80, 82, 84, 86, 88, 89],
      patterns: buildPatterns([...card, 76, 78, 80, 82, 84, 86, 88, 89], ['rows']),
      totalBallsDrawn: 60,
      prizeMode: 'all_matches',
    },
  },
  {
    name: 'F_50balls_highest_match',
    description: '50 balls, 12 patterns, highest_match (only top-payout matched pattern pays)',
    cfg: {
      ballPoolSize: 75,
      cardNumbers: card,
      patterns: buildPatterns(card, ['rows', 'cols', 'diags']),
      totalBallsDrawn: 50,
      prizeMode: 'highest_match',
    },
  },
];

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);
}

async function main() {
  const { solveClassIIBingo, simulateClassIIBingo } = await import(
    join(REPO_ROOT, 'dist', 'features', 'classIIBingoCoordinator.js')
  );
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Validating ${CONFIGS.length} Class-II bingo configs @ ${GAMES} games each…`);

  const results = [];
  let allOK = true;

  for (const c of CONFIGS) {
    const t0 = Date.now();
    const cf = solveClassIIBingo(c.cfg);
    const mc = simulateClassIIBingo(c.cfg, GAMES, SEED);

    const checks = {
      hit_rel: relErr(cf.hitRate, mc.observedHitRate),
      ey_rel: relErr(cf.expectedPayoutPerGame, mc.observedMeanPayout),
      max_pattern_abs: 0,
    };
    for (const p of cf.patternResults) {
      const mcHit = mc.observedPatternHits[p.id] ?? 0;
      const abs = Math.abs(p.hitProbability - mcHit);
      if (abs > checks.max_pattern_abs) checks.max_pattern_abs = abs;
    }
    const pass =
      checks.hit_rel <= TOL_HIT_REL &&
      checks.ey_rel <= TOL_EY_REL &&
      checks.max_pattern_abs <= TOL_PER_PATTERN_ABS;

    if (!pass) allOK = false;
    const elapsedMs = Date.now() - t0;
    console.log(
      `  ${c.name.padEnd(34)} ${pass ? '✅' : '❌'}  ` +
        `hit_CF=${cf.hitRate.toFixed(4)} hit_MC=${mc.observedHitRate.toFixed(4)}  ` +
        `E[Y]_CF=${cf.expectedPayoutPerGame.toFixed(3)} E[Y]_MC=${mc.observedMeanPayout.toFixed(3)}  ` +
        `t=${elapsedMs}ms`,
    );

    results.push({
      name: c.name,
      description: c.description,
      cfg: { ...c.cfg, patterns_count: c.cfg.patterns.length },
      closed_form: {
        hitRate: cf.hitRate,
        probAnyMatch: cf.probAnyMatch,
        expectedPayoutPerGame: cf.expectedPayoutPerGame,
        patternResults: cf.patternResults,
      },
      monte_carlo: {
        observedHitRate: mc.observedHitRate,
        observedMeanPayout: mc.observedMeanPayout,
        observedPatternHits: mc.observedPatternHits,
        games: GAMES,
      },
      checks,
      pass,
      elapsed_ms: elapsedMs,
    });
  }

  const summary = {
    schema_version: '1.0.0',
    report_id: 'CLASS_II_BINGO',
    generated_utc: new Date().toISOString(),
    games_per_config: GAMES,
    seed: SEED,
    tolerances: { hit_rel: TOL_HIT_REL, per_pattern_abs: TOL_PER_PATTERN_ABS, ey_rel: TOL_EY_REL },
    overall_pass: allOK,
    configs_total: CONFIGS.length,
    configs_passed: results.filter((r) => r.pass).length,
    configs: results,
  };

  writeFileSync(join(OUT_DIR, 'CLASS_II_BINGO.json'), JSON.stringify(summary, null, 2));

  const md = [];
  md.push('# CLASS_II_BINGO — Class-II Bingo Coordinator Acceptance');
  md.push('');
  md.push(`Generated: \`${summary.generated_utc}\``);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`**${summary.configs_passed}/${summary.configs_total} configs PASS** at ${GAMES} MC games each.`);
  md.push('');
  md.push('Closes Faza 12 scenario: ⚠️→✅ "Class-II bingo coordinator mode".');
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('Closed-form: hypergeometric `P(pattern hit) = C(N − |P|, k − |P|) / C(N, k)`.');
  md.push('Multi-pattern P(any match) via inclusion-exclusion over 2^|patterns| subsets (≤ 16 patterns).');
  md.push('E[balls to first match] = (N+1)/(s+1) (negative-hypergeometric mean).');
  md.push('MC verified against closed-form at 50K games per config.');
  md.push('');
  md.push('## Configs');
  md.push('');
  md.push('| Config | Pass | CF hit | MC hit | hit rel | CF E[Y] | MC E[Y] | max pattern abs |');
  md.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.closed_form.hitRate.toFixed(4)} | ` +
        `${r.monte_carlo.observedHitRate.toFixed(4)} | ${(r.checks.hit_rel*100).toFixed(2)}% | ` +
        `${r.closed_form.expectedPayoutPerGame.toFixed(3)} | ${r.monte_carlo.observedMeanPayout.toFixed(3)} | ` +
        `${r.checks.max_pattern_abs.toFixed(4)} |`,
    );
  }
  md.push('');
  md.push('## NIGC compliance context');
  md.push('');
  md.push('- **NIGC 25 CFR Part 502** — defines Class II (bingo, player-vs-player) vs Class III (slots)');
  md.push('- Slot UI is cosmetic; underlying math is bingo coordinator-driven');
  md.push('- Cabot & Hannum 2002 ch. 13 — bingo math fundamentals reference');

  writeFileSync(join(OUT_DIR, 'CLASS_II_BINGO.md'), md.join('\n'));

  console.log('');
  console.log(`Overall: ${allOK ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: reports/acceptance/CLASS_II_BINGO.{json,md}`);
  if (!allOK) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
