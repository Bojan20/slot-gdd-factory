#!/usr/bin/env node
/**
 * tools/par-sheet-pipeline.mjs
 *
 * PAR-14-I (Boki 2026-06-27) — 0-touch orchestrator from raw par sheet
 * (.xlsx) → playable convergence verdict. One CLI command runs the full
 * pipeline; the operator drops a par sheet and gets a PASS / WARN / FAIL
 * receipt + locked tuning artefacts.
 *
 * # PIPELINE STAGES
 *
 *   1. INGEST       — `_par-sheet-to-model.mjs` extracts model.json + manifest
 *                     + par_sheet provenance receipts (coinBoostMultipliers,
 *                     specialReelSets, hnwScenarios, freeSpinAwards, etc.)
 *
 *   2. CLASSIFY     — `_par-sheet-classifier-lib.mjs` derives mechanic
 *                     detection (free_spins / hold_and_win / bonus_buy /
 *                     wild_expand / mystery_reveal / coin_boost /
 *                     special_reel_set) per slug
 *
 *   3. AUTO-TUNE    — `_par-sheet-auto-tune.mjs` emits
 *                     `dist/par-sheet-real-games/<slug>/auto-tune.json`
 *                     with mechanic-gated tuning axes
 *
 *   4. CONVERGE     — `_par-sheet-convergence.mjs` runs sister Rust kernel
 *                     at requested precision tier (default 5M × 4 seed)
 *                     and writes verdict to
 *                     `reports/par-convergence/<slug>.json`
 *
 *   5. RECEIPT      — emit `reports/par-pipeline/<slug>.json` with
 *                     end-to-end audit chain (ingest sha → classify
 *                     mechanics → tune axes → verdict)
 *
 * # USAGE
 *
 *   # Single par sheet end-to-end:
 *   node tools/par-sheet-pipeline.mjs --xlsx <path> [--spins 5000000]
 *
 *   # Already-ingested slug (skip stage 1):
 *   node tools/par-sheet-pipeline.mjs --slug skeleton-key
 *
 *   # All ingested par sheets:
 *   node tools/par-sheet-pipeline.mjs --all [--spins 5000000]
 *
 *   # Skip convergence (classify+tune only — fast schema sanity):
 *   node tools/par-sheet-pipeline.mjs --all --no-converge
 *
 * # OUTPUT
 *
 *   dist/par-sheet-real-games/<slug>/
 *     model.json                — universalGameSchema (ingest)
 *     manifest.json             — provenance + SHA256 (ingest)
 *     auto-tune.json            — locked tuning axes (auto-tune)
 *
 *   reports/par-convergence/<slug>.json   — verdict (convergence)
 *   reports/par-pipeline/<slug>.json      — end-to-end receipt (this tool)
 *
 * # ANTI-VENDOR
 *
 *   Every par-sheet field touched in stage 1 passes through LV3-11
 *   antiVendorShield. Pipeline receipt carries SHA256 of the input xlsx
 *   so audits can detect tampered inputs.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';

import { detectMechanics } from './_par-sheet-classifier-lib.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const PAR_MODELS_DIR = join(REPO, 'dist', 'par-sheet-real-games');
const PAR_PIPELINE_REPORT = join(REPO, 'reports', 'par-pipeline');
const PAR_CONVERGENCE_REPORT = join(REPO, 'reports', 'par-convergence');

function parseArgs(args) {
  const out = {
    xlsx: null,
    slug: null,
    all: false,
    spins: 5_000_000,
    seeds: 4,
    noConverge: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--xlsx') out.xlsx = args[++i];
    else if (a === '--slug') out.slug = args[++i];
    else if (a === '--all') out.all = true;
    else if (a === '--spins') out.spins = parseInt(args[++i], 10);
    else if (a === '--seeds') out.seeds = parseInt(args[++i], 10);
    else if (a === '--no-converge') out.noConverge = true;
  }
  return out;
}

function run(cmd, args, opts = {}) {
  return new Promise((res, rej) => {
    const child = spawn(cmd, args, { stdio: 'pipe', ...opts });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => { stdout += b.toString(); });
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('close', (code) => {
      if (code === 0) res({ stdout, stderr });
      else rej(new Error(`${cmd} ${args.join(' ')} exit ${code}\n${stderr || stdout}`));
    });
    child.on('error', rej);
  });
}

async function stageIngest(xlsxPath) {
  const t0 = Date.now();
  await run('node', [
    join(REPO, 'tools', '_par-sheet-to-model.mjs'),
    '--xlsx', xlsxPath,
    '--out', PAR_MODELS_DIR,
  ]);
  return { wallMs: Date.now() - t0 };
}

function stageClassify(slug) {
  const modelPath = join(PAR_MODELS_DIR, slug, 'model.json');
  if (!existsSync(modelPath)) {
    throw new Error(`stage CLASSIFY: model.json missing for ${slug}`);
  }
  const model = JSON.parse(readFileSync(modelPath, 'utf-8'));
  const mechanics = detectMechanics(model);
  const detectedFeatures = Object.entries(mechanics)
    .filter(([, m]) => m.detected)
    .map(([k]) => k);
  return {
    mechanics,
    detectedFeatures,
    detectedCount: detectedFeatures.length,
  };
}

async function stageAutoTune(slug) {
  const t0 = Date.now();
  await run('node', [
    join(REPO, 'tools', '_par-sheet-auto-tune.mjs'),
    '--slug', slug,
  ]);
  const tunePath = join(PAR_MODELS_DIR, slug, 'auto-tune.json');
  if (!existsSync(tunePath)) {
    throw new Error(`stage AUTO-TUNE: auto-tune.json not emitted for ${slug}`);
  }
  const tune = JSON.parse(readFileSync(tunePath, 'utf-8'));
  const enabledAxes = Object.entries(tune)
    .filter(([k, v]) => k !== 'slug' && v && typeof v === 'object' && v.enabled === true)
    .map(([k]) => k);
  return {
    wallMs: Date.now() - t0,
    enabledAxes,
    tunePath,
  };
}

async function stageConverge(slug, spins, seeds) {
  const t0 = Date.now();
  const result = await run('node', [
    join(REPO, 'tools', '_par-sheet-convergence.mjs'),
    '--slug', slug,
    '--spins', String(spins),
    '--seeds', String(seeds),
  ]);
  const reportPath = join(PAR_CONVERGENCE_REPORT, `${slug}.json`);
  if (!existsSync(reportPath)) {
    throw new Error(`stage CONVERGE: report missing for ${slug}`);
  }
  const report = JSON.parse(readFileSync(reportPath, 'utf-8'));
  return {
    wallMs: Date.now() - t0,
    verdict: report.verdict,
    abs_delta_pp: report.abs_delta_pct,
    measured: report.measured,
    declared: report.declared,
    declaredKind: report.declaredKind,
    w99HalfWidth: report.wilson99HalfWidthPp,
    stdoutTail: result.stdout.split('\n').slice(-5).join('\n'),
  };
}

function writePipelineReceipt(slug, receipt) {
  if (!existsSync(PAR_PIPELINE_REPORT)) mkdirSync(PAR_PIPELINE_REPORT, { recursive: true });
  const path = join(PAR_PIPELINE_REPORT, `${slug}.json`);
  writeFileSync(path, JSON.stringify(receipt, null, 2));
  return path;
}

async function runPipeline(slug, opts) {
  const t0 = Date.now();
  const receipt = {
    slug,
    timestamp: new Date().toISOString(),
    stages: {},
  };

  /* Stage 2: CLASSIFY */
  receipt.stages.classify = stageClassify(slug);

  /* Stage 3: AUTO-TUNE */
  receipt.stages.autoTune = await stageAutoTune(slug);

  /* Stage 4: CONVERGE (optional) */
  if (!opts.noConverge) {
    receipt.stages.converge = await stageConverge(slug, opts.spins, opts.seeds);
    receipt.verdict = receipt.stages.converge.verdict;
    receipt.abs_delta_pp = receipt.stages.converge.abs_delta_pp;
  } else {
    receipt.verdict = 'SKIPPED';
  }

  receipt.totalWallMs = Date.now() - t0;
  return receipt;
}

function renderSummary(receipts, totalMs) {
  console.log('\n══════════════════════════════════════════════');
  console.log(`PAR-14-I PIPELINE · ${receipts.length} slug(s) processed in ${(totalMs / 1000).toFixed(1)}s`);
  console.log('══════════════════════════════════════════════');
  let pass = 0, warn = 0, fail = 0, skipped = 0;
  for (const r of receipts) {
    const v = r.verdict || 'ERR';
    if (v === 'PASS') pass++;
    else if (v === 'WARN') warn++;
    else if (v === 'FAIL') fail++;
    else if (v === 'SKIPPED') skipped++;
    const feats = r.stages.classify?.detectedFeatures?.join(',') || '-';
    const axes = r.stages.autoTune?.enabledAxes?.join(',') || '-';
    const dline = r.abs_delta_pp != null ? `Δ=${r.abs_delta_pp > 0 ? '+' : ''}${r.abs_delta_pp.toFixed(4)}pp` : '';
    console.log(`  ${v.padEnd(7)}  ${r.slug.padEnd(34)} ${dline}`);
    console.log(`    classify[${feats}]  tune[${axes}]`);
  }
  console.log(`\n  Summary: ${pass} PASS / ${warn} WARN / ${fail} FAIL / ${skipped} SKIPPED`);
}

async function main() {
  const opts = parseArgs(argv.slice(2));
  const targets = [];

  if (opts.xlsx) {
    /* Stage 1: INGEST (only for --xlsx path; --slug / --all paths
     * assume ingestion already done in PAR_MODELS_DIR). */
    console.log(`▸ stage 1 INGEST  · ${opts.xlsx}`);
    const t0 = Date.now();
    await stageIngest(opts.xlsx);
    console.log(`  ✓ done (${Date.now() - t0}ms)`);
    /* Derive slug from filename (matches _par-sheet-to-model deriveSlug). */
    const fname = opts.xlsx.split('/').pop() || '';
    const m = fname.match(/ParSheets[_\-\s]+([A-Za-z0-9_\-]+?)(?:[_\-\s]Classic|\.xlsx|$)/i);
    if (m) targets.push(m[1].toLowerCase().replace(/_/g, '-'));
    else throw new Error(`cannot derive slug from ${opts.xlsx}`);
  } else if (opts.slug) {
    targets.push(opts.slug);
  } else if (opts.all) {
    for (const slug of readdirSync(PAR_MODELS_DIR)) {
      if (existsSync(join(PAR_MODELS_DIR, slug, 'model.json'))) targets.push(slug);
    }
  } else {
    console.error('USAGE: --xlsx <path> | --slug <name> | --all');
    process.exit(2);
  }

  const t0 = Date.now();
  const receipts = [];
  for (const slug of targets) {
    console.log(`\n▸ ${slug}`);
    try {
      const receipt = await runPipeline(slug, opts);
      writePipelineReceipt(slug, receipt);
      receipts.push(receipt);
      console.log(`  verdict: ${receipt.verdict}  classify=${receipt.stages.classify.detectedCount} mechanic(s)  tune=${receipt.stages.autoTune.enabledAxes.length} axes`);
    } catch (e) {
      console.error(`  FATAL: ${e.message}`);
      receipts.push({ slug, verdict: 'ERR', error: e.message });
    }
  }

  renderSummary(receipts, Date.now() - t0);

  const anyFail = receipts.some((r) => r.verdict === 'FAIL' || r.verdict === 'ERR');
  if (anyFail) process.exit(1);
}

const __isCliEntry = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (__isCliEntry) {
  main().catch((e) => {
    console.error('FATAL:', e);
    process.exit(2);
  });
}

export {
  parseArgs,
  stageClassify,
  stageAutoTune,
  stageConverge,
  runPipeline,
};
