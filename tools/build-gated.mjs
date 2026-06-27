#!/usr/bin/env node
/**
 * tools/build-gated.mjs
 *
 * BLOCK-1-d (Boki direktiva 2026-06-27) — "ja zelim da simulator radi sve
 * dok ne izadje sve savrseno za igru i ne izgradi se slot."
 *
 * CLI entrypoint koji integriše:
 *
 *   GDD + xlsx
 *      │
 *      ▼
 *   par-sheet-pipeline.mjs  (INGEST → CLASSIFY → AUTO-TUNE)
 *      │
 *      ▼
 *   par-sheet-block-until-perfect.mjs  (CONVERGENCE LOOP)
 *      │
 *      ├─ verdict=PASS → enforceBuildGate prolazi → buildSlotHTML → slot.html ✅
 *      │
 *      └─ verdict=FAIL/NON_CONVERGENT → enforceBuildGate baca BuildGateError
 *           → exit 1, dist/ingest/<slug>/slot.html NIJE generisan ❌
 *
 * # USAGE
 *
 *   # Standard E2E (real Rust kernel, real spinovi):
 *   node tools/build-gated.mjs --gdd path/to/gdd.md --xlsx path/to/par.xlsx
 *
 *   # Već-ingestovan slug — preskoči pipeline ingest:
 *   node tools/build-gated.mjs --slug cash-eruption
 *
 *   # Samo gate check (bez build-a):
 *   node tools/build-gated.mjs --slug X --check
 *
 *   # Mock oracle (za testove/CI bez sister kernel-a):
 *   node tools/build-gated.mjs --slug X --mock
 *
 * # OUTPUT
 *
 *   dist/par-sheet-real-games/<slug>/         — model.json + manifest.json
 *   reports/par-block-until-perfect/<slug>.json — convergence verdict
 *   dist/build-gated/<slug>/slot.html         — playable slot HTML (ako PASS)
 *   reports/build-gated/<slug>.json           — end-to-end audit receipt
 *
 * # ANTI-PATTERN GUARDS
 *
 *   - Ako gate FAIL, slot.html se NIKAD ne emit-uje (atomic — nema delete
 *     postojećeg fajla, samo se ne piše).
 *   - Audit receipt uvek emit-uje, čak i kad fail, sa explicit reason-om.
 *   - SLOT_BUILD_REQUIRE_CONVERGENCE env je SET pre buildSlotHTML — gate
 *     u src/buildSlotHTML.mjs je defense in depth.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, basename, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { argv, exit } from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  tryConvergencePass,
  BuildGateError,
  normalizeSlug,
} from '../src/blockBuildGate.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = resolve(__dirname, '..');

/* ─── CLI parsing ───────────────────────────────────────────────────── */

function parseArgs(args) {
  const out = {
    gdd: null,
    xlsx: null,
    slug: null,
    check: false,
    mock: false,
    maxTier: '10B',
    autoTune: true,
    skipPipeline: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--gdd') out.gdd = args[++i];
    else if (a === '--xlsx') out.xlsx = args[++i];
    else if (a === '--slug') out.slug = args[++i];
    else if (a === '--check') out.check = true;
    else if (a === '--mock') out.mock = true;
    else if (a === '--max-tier') out.maxTier = args[++i];
    else if (a === '--no-auto-tune') out.autoTune = false;
    else if (a === '--skip-pipeline') out.skipPipeline = true;
    else if (a === '--help' || a === '-h') {
      printHelp();
      exit(0);
    }
  }
  return out;
}

function printHelp() {
  console.log(`
build-gated — GDD + par sheet → convergence loop → slot.html ako PASS.

USAGE
  node tools/build-gated.mjs --gdd <md> --xlsx <xlsx>     E2E
  node tools/build-gated.mjs --slug <name>                already-ingested slug
  node tools/build-gated.mjs --slug <name> --check        gate-only check
  node tools/build-gated.mjs --slug <name> --mock         mock oracle (test/CI)

OPTIONS
  --gdd <path>        GDD markdown ulaz (TODO: parser wire @ E2E mode)
  --xlsx <path>       PAR sheet ulaz (run kroz pipeline ingest)
  --slug <name>       Pretpostavlja ingest već gotov, ulazi pravo u convergence
  --check             Samo proveri postojeći receipt, ne pokreće loop ni build
  --mock              Koristi mock oracle umesto real Rust kernel-a
  --max-tier <lbl>    5M | 50M | 100M | 500M | 1B | 5B | 10B (default 10B)
  --no-auto-tune      Skip auto-tune nudge između iteracija
  --skip-pipeline     Skip ingest/classify/tune stages

EXIT CODES
  0  PASS — slot.html emit-ovan
  1  FAIL — gate blocked, slot.html NIJE emit-ovan
  2  Bad CLI usage / ingest error
`);
}

/* ─── Subprocess helpers ────────────────────────────────────────────── */

function runChild(cmd, args, opts = {}) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(cmd, args, { stdio: 'inherit', ...opts });
    child.on('error', rejectP);
    child.on('exit', (code) => {
      if (code === 0) resolveP({ code });
      else rejectP(new Error(`${basename(args[0] || cmd)} exited ${code}`));
    });
  });
}

async function runPipelineIngest({ xlsx, slug }) {
  const tool = join(REPO_ROOT, 'tools', 'par-sheet-pipeline.mjs');
  const args = [tool, '--no-converge'];
  if (xlsx) args.push('--xlsx', xlsx);
  else if (slug) args.push('--slug', slug);
  await runChild(process.execPath, args);
}

async function runConvergenceLoop({ slug, maxTier, mock, autoTune }) {
  const tool = join(REPO_ROOT, 'tools', 'par-sheet-block-until-perfect.mjs');
  const args = [tool, '--slug', slug, '--max-tier', maxTier];
  if (mock) args.push('--mock');
  if (!autoTune) args.push('--no-auto-tune');
  try {
    await runChild(process.execPath, args);
    return { ok: true };
  } catch (err) {
    /* Loop exit 1 = NON_CONVERGENT or FAIL — to očekujemo i hendlujemo. */
    return { ok: false, error: err.message };
  }
}

/* ─── Slot HTML build (in-process) ──────────────────────────────────── */

async function buildSlotHtmlForSlug(slug, outDir) {
  const modelPath = join(
    REPO_ROOT,
    'dist',
    'par-sheet-real-games',
    slug,
    'model.json',
  );
  if (!existsSync(modelPath)) {
    throw new Error(`model.json not found for slug "${slug}": ${modelPath}`);
  }
  const model = JSON.parse(readFileSync(modelPath, 'utf8'));
  /* Stamp slug + require flag tako da enforceBuildGate radi. */
  model.__slug = slug;
  model.__require_convergence__ = true;

  /* Set env defense-in-depth — buildSlotHTML provera oba. */
  process.env.SLOT_BUILD_REQUIRE_CONVERGENCE = '1';

  const { buildSlotHTML } = await import('../src/buildSlotHTML.mjs');

  let html;
  try {
    html = buildSlotHTML(model);
  } catch (err) {
    if (err instanceof BuildGateError) throw err;
    throw new Error(`buildSlotHTML failed: ${err.message}`);
  }
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'slot.html');
  writeFileSync(outPath, html);
  return { outPath, bytes: Buffer.byteLength(html) };
}

/* ─── Audit receipt emit ────────────────────────────────────────────── */

function writeBuildReceipt(slug, payload) {
  const dir = join(REPO_ROOT, 'reports', 'build-gated');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${slug}.json`);
  const receipt = {
    slug,
    ...payload,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(path, JSON.stringify(receipt, null, 2));
  return path;
}

/* ─── Main ──────────────────────────────────────────────────────────── */

async function main() {
  const opts = parseArgs(argv.slice(2));

  /* Determine slug: explicit --slug, or derive from --xlsx file name. */
  let slug = opts.slug ? normalizeSlug(opts.slug) : null;
  if (!slug && opts.xlsx) {
    slug = normalizeSlug(basename(opts.xlsx, extname(opts.xlsx)));
  }
  if (!slug) {
    console.error('error: --slug or --xlsx required');
    printHelp();
    exit(2);
  }

  console.log(`▸ build-gated · slug=${slug}`);

  /* ─── CHECK MODE — just inspect existing receipt ─────────────────── */
  if (opts.check) {
    const verdict = tryConvergencePass(slug, { repoRoot: REPO_ROOT });
    console.log(`  verdict: ${verdict.allowed ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`  reason : ${verdict.reason}`);
    writeBuildReceipt(slug, {
      mode: 'check',
      gateAllowed: verdict.allowed,
      gateReason: verdict.reason,
      buildEmitted: false,
    });
    exit(verdict.allowed ? 0 : 1);
  }

  /* ─── PIPELINE INGEST (optional) ──────────────────────────────────── */
  if (!opts.skipPipeline && opts.xlsx) {
    console.log(`▸ stage 1: pipeline ingest (xlsx → model.json + auto-tune)`);
    try {
      await runPipelineIngest({ xlsx: opts.xlsx });
    } catch (err) {
      console.error(`✗ pipeline ingest failed: ${err.message}`);
      writeBuildReceipt(slug, {
        mode: 'e2e',
        stage: 'ingest',
        error: err.message,
        buildEmitted: false,
      });
      exit(2);
    }
  }

  /* ─── CONVERGENCE LOOP ───────────────────────────────────────────── */
  console.log(`▸ stage 2: convergence loop (max-tier=${opts.maxTier}, mock=${opts.mock})`);
  const loop = await runConvergenceLoop({
    slug,
    maxTier: opts.maxTier,
    mock: opts.mock,
    autoTune: opts.autoTune,
  });

  /* Reload + check verdict regardless of loop exit code (defense in depth). */
  const verdict = tryConvergencePass(slug, { repoRoot: REPO_ROOT });

  if (!verdict.allowed) {
    console.error(`\n❌ BUILD BLOKIRAN — slot "${slug}" NIJE generisan.`);
    console.error(`   reason: ${verdict.reason}`);
    if (verdict.receipt && verdict.receipt.diagnosis) {
      console.error(`   diagnosis: ${verdict.receipt.diagnosis.hint}`);
    }
    writeBuildReceipt(slug, {
      mode: 'e2e',
      stage: 'convergence',
      loopOk: loop.ok,
      gateAllowed: false,
      gateReason: verdict.reason,
      finalDeltaPP: verdict.receipt?.finalDeltaPP ?? null,
      finalTier: verdict.receipt?.finalTier ?? null,
      buildEmitted: false,
    });
    exit(1);
  }

  /* ─── BUILD slot.html ─────────────────────────────────────────────── */
  console.log(`\n✅ converged — building slot.html`);
  const outDir = join(REPO_ROOT, 'dist', 'build-gated', slug);
  let buildResult;
  try {
    buildResult = await buildSlotHtmlForSlug(slug, outDir);
  } catch (err) {
    console.error(`✗ build failed: ${err.message}`);
    writeBuildReceipt(slug, {
      mode: 'e2e',
      stage: 'build',
      gateAllowed: true,
      buildEmitted: false,
      buildError: err.message,
    });
    exit(2);
  }
  console.log(`  emitted: ${buildResult.outPath} (${buildResult.bytes.toLocaleString()} bytes)`);

  const receiptPath = writeBuildReceipt(slug, {
    mode: 'e2e',
    stage: 'build',
    gateAllowed: true,
    gateReason: verdict.reason,
    finalDeltaPP: verdict.receipt?.finalDeltaPP ?? null,
    finalTier: verdict.receipt?.finalTier ?? null,
    buildEmitted: true,
    htmlPath: buildResult.outPath,
    htmlBytes: buildResult.bytes,
  });
  console.log(`  receipt: ${receiptPath}`);
  exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('fatal:', err.stack || err.message);
    exit(2);
  });
}
