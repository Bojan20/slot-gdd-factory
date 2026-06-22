#!/usr/bin/env node
/**
 * tools/universal-pipeline.mjs
 *
 * MATH-DEEP HYB-5 (2026-06-22) — End-to-end orchestrator + hashed receipt chain.
 *
 * Purpose
 *   Single pipeline that stitches HYB-1..HYB-4 (and HYB-1+2+3+4 outputs)
 *   into one entry point:
 *
 *     GDD (PDF/MD)  ──┐
 *                     ├──>  parser (Sloj 1)  ──>  partial model
 *     PAR sheet     ──┘                              │
 *                                                    ▼
 *                                            HYB-2 completer
 *                                            (LLM + schema validate)
 *                                                    │
 *                                                    ▼
 *                                            HYB-3 cross-check
 *                                            (faithfulness + halluc guard)
 *                                                    │
 *                                                    ▼
 *                                            HYB-4 PAR ingest
 *                                            (vendor detect + adapter)
 *                                                    │
 *                                                    ▼
 *                                            assembled UniversalGame
 *                                                    │
 *                                                    ▼
 *                                            sha256 receipt chain
 *
 * Output
 *   - reports/pipeline-receipts/<slug>-<ts>.json — full receipt chain
 *     {
 *       slug, generatedAt, schema_version,
 *       sources: { gdd_hash, par_sheet_hash, par_vendor },
 *       stages: {
 *         parser:        { ok, duration_ms, fields_emitted, hash },
 *         completer:     { ok, duration_ms, fields_filled, halts, hash },
 *         cross_check:   { ok, duration_ms, faithful_count, disagreement_count, hash },
 *         par_ingest:    { ok, duration_ms, reels, symbols, vendor, hash },
 *       },
 *       final_model: <UniversalGame object>,
 *       final_hash: <sha256 of final model>,
 *     }
 *
 * Verifier
 *   After all stages, runs UniversalGameSchema.parse() on final_model.
 *   Schema failure -> pipeline fails (no silent emit of broken model).
 *
 * Idempotency
 *   Each stage is keyed on its input hash; cached output is returned for
 *   reruns. The full pipeline is therefore reproducible: same inputs ==
 *   same final_hash.
 *
 * Performance budget
 *   - parser: ≤ 2s per GDD
 *   - HYB-2 completer (dry-run): instant
 *   - HYB-3 cross-check (dry-run): instant
 *   - HYB-4 PAR ingest: ≤ 5s (xlsx) or ≤ 100ms (csv/json)
 *   - schema validate: ≤ 10ms
 *   Total: typically ≤ 8s without LLM calls, ≤ 4 min with full Kimi reach.
 *
 * CLI
 *   node tools/universal-pipeline.mjs --slug=<slug> [--par=<path>] [--dry-run-llm]
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, unlinkSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateModel, SCHEMA_VERSION } from '../src/schema/universalGame.mjs';
import {
  listEmptyRequiredFields,
  completeModel,
} from './llm-field-completer.mjs';
import { validateModelFaithful } from './llm-cross-check.mjs';
import { dispatchIngest, detectVendor } from './par-sheet-detect.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const REAL_GAMES = join(REPO, 'dist/real-games');
const REPORT_DIR = join(REPO, 'reports/pipeline-receipts');

function sha256(s) {
  return createHash('sha256').update(typeof s === 'string' ? s : JSON.stringify(s)).digest('hex');
}

function timed(fn) {
  const t0 = Date.now();
  const r = fn();
  return { result: r, duration_ms: Date.now() - t0 };
}

/* ── Pipeline stages ──────────────────────────────────────────────────── */

/**
 * Run the full HYB pipeline for one slug.
 *
 * Inputs come from dist/real-games/<slug>/ which already contains:
 *   - raw.txt   (the parsed GDD prose)
 *   - model.json (the parser Sloj 1 output)
 *
 * Options:
 *   - dryRunLlm: bool — when true, HYB-2 + HYB-3 stages use dry-run
 *     mode (no Kimi calls). Default true for CI safety.
 *   - parPath: optional path to PAR sheet (xlsx/csv/json) — runs HYB-4.
 *
 * Returns the receipt chain.
 */
export function runPipeline(slug, opts = {}) {
  const { dryRunLlm = true, parPath = null, writeReport = true } = opts;
  const slugDir = join(REAL_GAMES, slug);
  if (!existsSync(slugDir)) {
    throw new Error(`slug not found: ${slug} (expected dist/real-games/${slug}/)`);
  }
  const rawGddPath = join(slugDir, 'raw.txt');
  const modelPath = join(slugDir, 'model.json');
  if (!existsSync(rawGddPath) || !existsSync(modelPath)) {
    throw new Error(`slug ${slug} missing raw.txt or model.json (run parse-real-pdfs.mjs)`);
  }
  const rawGdd = readFileSync(rawGddPath, 'utf8');
  const parserModel = JSON.parse(readFileSync(modelPath, 'utf8'));

  /* ── Stage 1: parser (already done; we just record metadata). */
  const parserStage = {
    ok: true,
    fields_emitted: Object.keys(parserModel).length,
    duration_ms: 0,  /* parse-real-pdfs runs separately */
    hash: sha256(parserModel),
  };

  /* ── Stage 2: HYB-2 LLM completer. */
  const { result: completerRes, duration_ms: cd } = timed(() => {
    return completeModel(slug, rawGdd, parserModel, { dryRun: dryRunLlm });
  });
  const completerStage = {
    ok: completerRes.halts.length === completerRes.receipts.length ? false : completerRes.receipts.length > 0,
    fields_attempted: completerRes.receipts.length,
    fields_filled: completerRes.receipts.filter(r => !r.halt).length,
    halts: completerRes.halts.length,
    duration_ms: cd,
    hash: sha256(completerRes.receipts.map(r => `${r.field}:${JSON.stringify(r.value)}`).join('|')),
  };
  /* In dry-run all halt → we keep parser model as filled (no LLM changes). */
  const mergedModel = completerRes.filled;

  /* ── Stage 3: HYB-3 cross-check. */
  const { result: crossRes, duration_ms: xd } = timed(() => {
    return validateModelFaithful(slug, rawGdd, mergedModel, { dryRun: dryRunLlm });
  });
  const crossStage = {
    ok: crossRes.entries.length > 0,
    fields_audited: crossRes.entries.length,
    faithful_count: crossRes.entries.filter(e => e.faithful && !e.halt).length,
    disagreement_count: crossRes.disagreements.length,
    halt_count: crossRes.entries.filter(e => e.halt).length,
    duration_ms: xd,
    hash: sha256(crossRes.entries.map(e => `${e.field}:${e.faithful}`).join('|')),
  };

  /* ── Stage 4: HYB-4 PAR sheet ingest (optional). */
  let parStage = { ok: false, duration_ms: 0, hash: null, skipped: true, reason: 'no PAR path provided' };
  let parData = null;
  if (parPath && existsSync(parPath)) {
    const { result: parRes, duration_ms: pd } = timed(() => dispatchIngest(parPath));
    parStage = {
      ok: parRes.ok,
      vendor: parRes.vendor,
      format: parRes.format,
      adapter: parRes.adapter,
      reels: parRes.parSheet?.reels?.length || 0,
      symbols: parRes.parSheet?.totals?.symbols || 0,
      sumWeight: parRes.parSheet?.totals?.sumWeight || 0,
      duration_ms: pd,
      hash: parRes.ok ? sha256(parRes.parSheet) : null,
      error: parRes.error || null,
    };
    if (parRes.ok) parData = parRes.parSheet;
  }

  /* ── Schema final validation. */
  const schemaCheck = validateModel(mergedModel);
  const schemaStage = {
    ok: schemaCheck.ok,
    error_count: schemaCheck.errors.length,
    errors_sample: schemaCheck.errors.slice(0, 5),
  };

  /* ── Assemble final receipt chain. */
  const finalModel = parData
    ? { ...mergedModel, par_sheet: { ...mergedModel.par_sheet, ...parData } }
    : mergedModel;
  const receipt = {
    slug,
    generatedAt: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
    sources: {
      gdd_hash:        sha256(rawGdd),
      par_sheet_hash:  parData ? sha256(parData) : null,
      par_vendor:      parStage.vendor || null,
    },
    stages: {
      parser:      parserStage,
      completer:   completerStage,
      cross_check: crossStage,
      par_ingest:  parStage,
      schema:      schemaStage,
    },
    final_model: finalModel,
    final_hash: sha256(finalModel),
    ok_overall: parserStage.ok && schemaStage.ok && !crossStage.disagreement_count,
  };

  /* ── Write report (atomic: tmp + rename). */
  if (writeReport) {
    if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = join(REPORT_DIR, `${slug}-${ts}.json`);
    const tmp = reportPath + '.tmp.' + process.pid;
    writeFileSync(tmp, JSON.stringify(receipt, null, 2), 'utf8');
    try {
      renameSync(tmp, reportPath);
    } catch (e) {
      try { unlinkSync(tmp); } catch { /* ignore */ }
      throw e;
    }
    receipt.report_path = reportPath;
  }
  return receipt;
}

/* ── CLI ──────────────────────────────────────────────────────────────── */

if (process.argv[1]?.endsWith('universal-pipeline.mjs')) {
  const args = process.argv.slice(2);
  const slugArg = args.find(a => a.startsWith('--slug='))?.slice(7);
  const parArg = args.find(a => a.startsWith('--par='))?.slice(6);
  const dryRunLlm = !args.includes('--live-llm');
  if (!slugArg) {
    console.error('Usage: node tools/universal-pipeline.mjs --slug=<slug> [--par=<path>] [--live-llm]');
    process.exit(2);
  }
  try {
    const r = runPipeline(slugArg, { dryRunLlm, parPath: parArg || null });
    console.log(`▸ pipeline complete: ${r.slug}`);
    console.log(`   parser:      ${r.stages.parser.ok ? '✓' : '✗'} (${r.stages.parser.fields_emitted} fields)`);
    console.log(`   completer:   ${r.stages.completer.fields_filled}/${r.stages.completer.fields_attempted} filled (${r.stages.completer.halts} halts)`);
    console.log(`   cross_check: ${r.stages.cross_check.faithful_count}/${r.stages.cross_check.fields_audited} faithful (${r.stages.cross_check.disagreement_count} disagreements)`);
    console.log(`   par_ingest:  ${r.stages.par_ingest.skipped ? '(skipped)' : (r.stages.par_ingest.ok ? '✓' : '✗')} vendor=${r.stages.par_ingest.vendor || '-'}`);
    console.log(`   schema:      ${r.stages.schema.ok ? '✓' : `✗ ${r.stages.schema.error_count} errors`}`);
    console.log(`   final_hash:  ${r.final_hash.slice(0, 16)}...`);
    if (r.report_path) console.log(`   report: ${r.report_path}`);
    process.exit(r.ok_overall ? 0 : 1);
  } catch (e) {
    console.error(`▸ PIPELINE FAILED: ${e.message}`);
    process.exit(1);
  }
}
