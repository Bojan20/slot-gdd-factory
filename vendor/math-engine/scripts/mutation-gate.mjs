#!/usr/bin/env node
//
// W152 Wave 34 — Kimi K6: Mutation-score CI gate.
//
// Closes Kimi deep-audit K6 ("cargo-mutants gate in CI — enforce mutation
// coverage >90% on math kernel files; block PRs that introduce unkilled
// mutants"). Two-mode operation:
//
//   --regression (default)  Compare current SUMMARY.json to baseline.json.
//                           Exit non-zero ONLY if any score declined below
//                           baseline (per-runtime / per-crate / per-file).
//                           This is the always-on CI gate — prevents the
//                           team from sliding backwards while leaving room
//                           to incrementally hit promotion targets.
//
//   --strict                Apply explicit per-runtime threshold (default
//                           0.90). Exit non-zero if any runtime / crate is
//                           below threshold. This is the promotion gate —
//                           run after Stryker baseline raises to certify
//                           we crossed 90%.
//
//   --update-baseline       Treat current SUMMARY.json as new baseline
//                           (writes reports/mutation/baseline.json).
//                           Operator-initiated. Should be on the SAME
//                           commit that landed the score improvement.
//
// Required input: reports/mutation/SUMMARY.json (regenerated via
//                 `npm run mutation-summary`).
//
// Exit codes:
//   0  pass
//   1  regression detected (or strict threshold violation)
//   2  setup error (missing SUMMARY, malformed baseline)

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const SUMMARY_PATH = join(REPO_ROOT, 'reports', 'mutation', 'SUMMARY.json');
const BASELINE_PATH = join(REPO_ROOT, 'reports', 'mutation', 'baseline.json');

// ── CLI ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const MODE_STRICT = argv.includes('--strict');
const MODE_UPDATE = argv.includes('--update-baseline');
const STRICT_THRESHOLD = (() => {
  const i = argv.indexOf('--threshold');
  if (i >= 0 && argv[i + 1]) return Number(argv[i + 1]);
  return 0.90;
})();
const TOL = 1e-6; // float-eq slack so equal scores don't trigger regression

// ── Helpers ────────────────────────────────────────────────────────────────

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    console.error(`✗ Failed to parse ${path}: ${e.message}`);
    process.exit(2);
  }
}

function pct(x) {
  return Number.isFinite(x) ? `${(x * 100).toFixed(2)}%` : 'n/a';
}

/**
 * Reduce SUMMARY.json into a flat lookup table:
 *   { 'ts': score, 'rust:evaluator': score, 'rust:rng': score, ... }
 */
function flatten(summary) {
  const out = {};
  if (summary?.typescript) {
    out['ts'] = summary.typescript.scoreStrict;
    if (Array.isArray(summary.typescript.perFile)) {
      for (const pf of summary.typescript.perFile) {
        out[`ts:${pf.file}`] = pf.scoreStrict;
      }
    }
  }
  if (Array.isArray(summary?.rust)) {
    for (const r of summary.rust) {
      out[`rust:${r.crate}`] = r.scoreStrict;
    }
  }
  return out;
}

// ── Main ────────────────────────────────────────────────────────────────────

const summary = readJson(SUMMARY_PATH);
if (!summary) {
  console.error(`✗ Missing ${SUMMARY_PATH}`);
  console.error(`  Run \`npm run mutation-summary\` first.`);
  process.exit(2);
}
const current = flatten(summary);

// ── --update-baseline ────────────────────────────────────────────────────
if (MODE_UPDATE) {
  const baseline = {
    schema: 'mutation-gate-baseline/v1',
    updatedAtUtc: new Date().toISOString(),
    sourceSummaryGeneratedAt: summary.generatedAtUtc,
    scores: current,
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2));
  console.log(`✅ Baseline updated: ${BASELINE_PATH}`);
  console.log(`   Tracking ${Object.keys(current).length} score keys.`);
  process.exit(0);
}

// ── --strict mode ────────────────────────────────────────────────────────
if (MODE_STRICT) {
  console.log(`Mutation gate: STRICT mode (threshold ${pct(STRICT_THRESHOLD)})`);
  console.log();
  let failures = 0;
  // Strict mode applies threshold ONLY to runtime/crate-level keys (not per-file)
  // because per-file targets vary by responsibility (e.g. analyzer.ts may
  // have lower target than rng kernel).
  const runtimeKeys = Object.keys(current).filter(
    (k) => k === 'ts' || (k.startsWith('rust:') && !k.includes(':src/')),
  );
  for (const k of runtimeKeys) {
    const score = current[k];
    const ok = score >= STRICT_THRESHOLD - TOL;
    const flag = ok ? '✅' : '❌';
    console.log(`  ${flag} ${k.padEnd(20)} ${pct(score)} (threshold ${pct(STRICT_THRESHOLD)})`);
    if (!ok) failures++;
  }
  console.log();
  if (failures > 0) {
    console.log(`✗ STRICT gate FAILED — ${failures} runtime(s) below threshold`);
    process.exit(1);
  }
  console.log(`✅ STRICT gate PASS — all runtimes ≥ ${pct(STRICT_THRESHOLD)}`);
  process.exit(0);
}

// ── --regression (default) ───────────────────────────────────────────────
const baseline = readJson(BASELINE_PATH);
if (!baseline) {
  console.error(`✗ Missing baseline: ${BASELINE_PATH}`);
  console.error(`  Bootstrap with: node scripts/mutation-gate.mjs --update-baseline`);
  process.exit(2);
}
console.log(`Mutation gate: REGRESSION mode`);
console.log(`  Baseline: ${baseline.updatedAtUtc} (from ${baseline.sourceSummaryGeneratedAt})`);
console.log(`  Current:  ${summary.generatedAtUtc}`);
console.log();

const baselineScores = baseline.scores ?? {};
let regressions = 0;
let improvements = 0;
let unchanged = 0;
let newKeys = 0;
const droppedKeys = [];

const allKeys = new Set([...Object.keys(baselineScores), ...Object.keys(current)]);
const sortedKeys = [...allKeys].sort();

for (const k of sortedKeys) {
  const b = baselineScores[k];
  const c = current[k];
  if (b === undefined && c !== undefined) {
    console.log(`  ➕ ${k.padEnd(40)} new key (${pct(c)})`);
    newKeys++;
    continue;
  }
  if (c === undefined && b !== undefined) {
    console.log(`  ⚠  ${k.padEnd(40)} dropped (was ${pct(b)})`);
    droppedKeys.push(k);
    continue;
  }
  const delta = c - b;
  if (delta < -TOL) {
    console.log(`  ❌ ${k.padEnd(40)} ${pct(b)} → ${pct(c)} (Δ ${(delta * 100).toFixed(2)}pp) REGRESSION`);
    regressions++;
  } else if (delta > TOL) {
    console.log(`  ✅ ${k.padEnd(40)} ${pct(b)} → ${pct(c)} (Δ +${(delta * 100).toFixed(2)}pp) improved`);
    improvements++;
  } else {
    unchanged++;
  }
}

console.log();
console.log(
  `Summary: ${regressions} regression(s) · ${improvements} improvement(s) · ${unchanged} unchanged · ${newKeys} new · ${droppedKeys.length} dropped`,
);

if (droppedKeys.length > 0) {
  console.log();
  console.log('Note: dropped keys are NOT a regression by themselves (file may');
  console.log('      have been removed or refactored). Review manually if unexpected.');
}

if (regressions > 0) {
  console.log();
  console.log(`✗ REGRESSION gate FAILED — ${regressions} score(s) below baseline`);
  console.log(`  Either fix the surviving mutants OR run --update-baseline if`);
  console.log(`  the regression is intentional (e.g. major refactor that adds`);
  console.log(`  new mutants). Bumping baseline must be on the same commit.`);
  process.exit(1);
}

console.log();
console.log(`✅ REGRESSION gate PASS — no decline from baseline`);
process.exit(0);
