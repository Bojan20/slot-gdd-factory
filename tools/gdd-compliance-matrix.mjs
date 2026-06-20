#!/usr/bin/env node
/**
 * tools/gdd-compliance-matrix.mjs · D-18
 *
 * GDD truth-vs-build compliance scorecard.
 *
 * Walks `dist/real-games/<game>/model.json` for every parsed game and
 * emits a per-game compliance.json plus an aggregate matrix.md table.
 *
 * Uses the canonical signals published by the parser:
 *   model.__declared          { [key]: 'declared' | 'inferred' | 'default' }
 *   model.__activeFeatures__  Array<{ kind, source, hasContent }>
 *   model.__parserDiagnostics__ { totalKeys, declaredCount, ... }
 *
 * Outputs:
 *   dist/real-games/<game>/gdd-compliance.json
 *   dist/gdd-compliance-matrix.md
 *
 * Boki imperative (2026-06-20): "ono što piše u GDD bilo koji bude u
 * slotu koji se izgradi sa forsovima samo koji postoje u toj igri".
 * This scorecard is the audit layer — it does NOT change behavior, it
 * surfaces drift so we can correct the upstream parser/UFP/orchestrator.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const DIST = resolve(REPO, 'dist/real-games');
const OUT_MATRIX = resolve(REPO, 'dist/gdd-compliance-matrix.md');

function loadModel(gamePath) {
  const modelPath = resolve(gamePath, 'model.json');
  if (!existsSync(modelPath)) return null;
  try { return JSON.parse(readFileSync(modelPath, 'utf-8')); }
  catch (e) { console.warn('  ⚠ failed to parse', modelPath, e.message); return null; }
}

function computePerGameCompliance(model) {
  const declared = model.__declared || {};
  const active   = Array.isArray(model.__activeFeatures__) ? model.__activeFeatures__ : [];
  const diag     = model.__parserDiagnostics__ || {};

  const declaredKeys = Object.entries(declared)
    .filter(([_k, src]) => src === 'declared')
    .map(([k]) => k);
  const inferredKeys = Object.entries(declared)
    .filter(([_k, src]) => src === 'inferred')
    .map(([k]) => k);
  const defaultKeys = Object.entries(declared)
    .filter(([_k, src]) => src === 'default')
    .map(([k]) => k);

  const total = Object.keys(declared).length;
  const declaredPct = total > 0 ? declaredKeys.length / total : 0;
  const activeWithContent = active.filter(a => a.hasContent === true).length;
  const activeWithoutContent = active.filter(a => a.hasContent === false).length;

  /* Force chips that would render (mirrors UFP selectKinds logic without
   * importing the block — just the canonical declared-feature kinds). */
  const featureKeyToChipKind = {
    freeSpins: 'free_spins', bonusBuy: 'bonus_buy', holdAndWin: 'hold_and_win',
    bonusPick: 'bonus_pick', wheelBonus: 'wheel_bonus',
    multiplierOrb: 'multiplier_orb', persistentMultiplier: 'persistent_multiplier',
    tumble: 'cascade', clusterPaysEval: 'cluster_pays', waysEval: 'ways',
    payAnywhereEval: 'pay_anywhere', expandingWild: 'expanding_wild',
    walkingWild: 'walking_wild', stickyWild: 'sticky_wild',
    mysterySymbol: 'mystery_symbol', scatterCelebration: 'scatter_pay',
    lightning: 'lightning', randomLightningMultiplier: 'lightning',
    respin: 'respin', wildReel: 'wild_reel', gamble: 'gamble',
    anteBet: 'ante_bet', superSymbol: 'super_symbol', jackpot: 'jackpot',
    bigWinTier: 'big_win',
  };
  const chipKindSet = new Set();
  for (const f of active) {
    const ck = featureKeyToChipKind[f.kind];
    if (ck) chipKindSet.add(ck);
    /* Also accept raw kind labels if they're chip-like */
    if (typeof f.kind === 'string' && /^[a-z_]+$/.test(f.kind)) {
      chipKindSet.add(f.kind);
    }
  }
  /* Strip evaluator-only mechanics (UFP NON_FORCEABLE_MECHANIC_KINDS) */
  ['ways','cluster_pays','pay_anywhere','scatter_pay','cascade'].forEach(k => chipKindSet.delete(k));
  const forceChipsRendered = chipKindSet.size;

  return {
    game: basename(dirname(model.__path__ || '')) || model.name || 'unknown',
    name: model.name || '(unnamed)',
    topology: (model.topology && model.topology.kind) || 'unknown',
    totals: {
      totalKeys: total,
      declaredCount: declaredKeys.length,
      inferredCount: inferredKeys.length,
      defaultCount: defaultKeys.length,
      emptyCount: diag.emptyCount || 0,
      parserFailures: diag.failuresCount || 0,
    },
    coverage: {
      declaredRatio: Number(declaredPct.toFixed(4)),
      activeWithContent,
      activeWithoutContent,
      activeFeatures: active.length,
    },
    forceChips: {
      rendered: forceChipsRendered,
      kinds: Array.from(chipKindSet).sort(),
    },
    declared: declaredKeys.sort(),
    inferred: inferredKeys.sort(),
    default: defaultKeys.sort(),
  };
}

function emitPerGameJson(gamePath, compliance) {
  const out = resolve(gamePath, 'gdd-compliance.json');
  writeFileSync(out, JSON.stringify(compliance, null, 2));
  return out;
}

function emitMatrixMd(allCompliance) {
  const lines = [];
  lines.push('# GDD Compliance Matrix · D-18');
  lines.push('');
  lines.push('Auto-generated by `tools/gdd-compliance-matrix.mjs` from each ' +
             '`dist/real-games/<game>/model.json`. Compares parser-declared ' +
             'features against rendered force chips per game.');
  lines.push('');
  lines.push('```');
  lines.push('┌──────────────────────────────────────────────────────────────────────────────────────┐');
  lines.push('│ GDD COMPLIANCE MATRIX  ·  per-game declared / inferred / default + force chip count   │');
  lines.push('├──────────────────────────────────┬──────┬──────────┬─────────┬─────────┬────────────┤');
  lines.push('│ Game                              │ Keys │ Declared │ Inferr. │ Default │ ForceChips │');
  lines.push('├──────────────────────────────────┼──────┼──────────┼─────────┼─────────┼────────────┤');
  for (const c of allCompliance) {
    const game = (c.game || '').padEnd(33).slice(0, 33);
    const t = c.totals;
    const cov = c.coverage;
    const fc = c.forceChips;
    lines.push(`│ ${game} │ ${String(t.totalKeys).padStart(4)} │ ${String(t.declaredCount).padStart(8)} │ ${String(t.inferredCount).padStart(7)} │ ${String(t.defaultCount).padStart(7)} │ ${String(fc.rendered).padStart(10)} │`);
  }
  lines.push('└──────────────────────────────────┴──────┴──────────┴─────────┴─────────┴────────────┘');
  lines.push('```');
  lines.push('');
  lines.push('## Per-game detail');
  lines.push('');
  for (const c of allCompliance) {
    lines.push(`### ${c.name} (\`${c.game}\`)`);
    lines.push('');
    lines.push('```');
    lines.push(`Topology              ${c.topology}`);
    lines.push(`Total feature keys    ${c.totals.totalKeys}`);
    lines.push(`  declared            ${c.totals.declaredCount}`);
    lines.push(`  inferred            ${c.totals.inferredCount}`);
    lines.push(`  default (smart)     ${c.totals.defaultCount}`);
    lines.push(`  parser failures     ${c.totals.parserFailures}`);
    lines.push(`Active features       ${c.coverage.activeFeatures} (${c.coverage.activeWithContent} with content)`);
    lines.push(`Force chips rendered  ${c.forceChips.rendered}`);
    lines.push(`  kinds: ${c.forceChips.kinds.join(', ')}`);
    lines.push('```');
    lines.push('');
  }
  writeFileSync(OUT_MATRIX, lines.join('\n'));
  return OUT_MATRIX;
}

function main() {
  if (!existsSync(DIST)) {
    console.error('dist/real-games not found. Run `npm run test:parse:real-pdfs` first.');
    process.exit(2);
  }
  const games = readdirSync(DIST)
    .map(name => resolve(DIST, name))
    .filter(p => statSync(p).isDirectory());

  const allCompliance = [];
  for (const gamePath of games) {
    const model = loadModel(gamePath);
    if (!model) continue;
    /* annotate model with __path__ so per-game emitter can read game id */
    model.__path__ = gamePath;
    const compliance = computePerGameCompliance(model);
    compliance.game = basename(gamePath);
    const out = emitPerGameJson(gamePath, compliance);
    console.log(`  ✓ ${compliance.game.padEnd(40)} → ${out}`);
    allCompliance.push(compliance);
  }

  if (allCompliance.length === 0) {
    console.error('No games found in', DIST);
    process.exit(2);
  }

  const matrixPath = emitMatrixMd(allCompliance);
  console.log('');
  console.log('📊 Aggregate matrix →', matrixPath);
  console.log('');
  console.log(`Σ ${allCompliance.length} games scored · ` +
    `${allCompliance.reduce((s, c) => s + c.totals.declaredCount, 0)} declared / ` +
    `${allCompliance.reduce((s, c) => s + c.totals.inferredCount, 0)} inferred / ` +
    `${allCompliance.reduce((s, c) => s + c.totals.defaultCount, 0)} default`);
}

main();
