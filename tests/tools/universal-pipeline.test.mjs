#!/usr/bin/env node
/**
 * tests/tools/universal-pipeline.test.mjs
 *
 * MATH-DEEP HYB-5 test suite — E2E orchestrator + hashed receipt chain.
 *
 * Coverage
 *   - runPipeline() walks all stages for a real baseline GDD
 *   - Receipt chain has all required sections
 *   - sha256 hashes are deterministic across runs (idempotent)
 *   - Schema stage gates final emit
 *   - Cross-check stage flags faithful/halt correctly
 *   - Dry-run mode produces no LLM disagreements
 *   - Missing slug -> throw
 *   - Optional PAR sheet ingestion attached when present
 */

import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runPipeline } from '../../tools/universal-pipeline.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');

let passed = 0, failed = 0;
const tmpRoot = mkdtempSync(join(tmpdir(), 'hyb5-test-'));

function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('HYB-5 Universal Pipeline · test suite');

const BASELINE_SLUG = 'cash-eruption-foundry-gdd';

/* ── (1) Pipeline runs end-to-end on Cash Eruption ────────────────────── */

test('runPipeline executes all stages for baseline GDD', () => {
  const r = runPipeline(BASELINE_SLUG, { dryRunLlm: true, writeReport: false });
  assert(r.slug === BASELINE_SLUG, `slug: ${r.slug}`);
  assert(r.schema_version, 'schema_version present');
  assert(r.sources?.gdd_hash, 'gdd_hash present');
  assert(r.final_model, 'final_model present');
  assert(typeof r.final_hash === 'string' && r.final_hash.length === 64, 'final_hash is sha256');
});

/* ── (2) All 5 stages execute ─────────────────────────────────────────── */

test('Receipt has all 5 stages (parser, completer, cross_check, par_ingest, schema)', () => {
  const r = runPipeline(BASELINE_SLUG, { dryRunLlm: true, writeReport: false });
  const required = ['parser', 'completer', 'cross_check', 'par_ingest', 'schema'];
  for (const s of required) {
    assert(s in r.stages, `missing stage: ${s}`);
  }
});

/* ── (3) Parser stage reports field count ─────────────────────────────── */

test('Parser stage reports non-zero fields_emitted', () => {
  const r = runPipeline(BASELINE_SLUG, { dryRunLlm: true, writeReport: false });
  assert(r.stages.parser.fields_emitted > 5,
    `expected >5 fields, got ${r.stages.parser.fields_emitted}`);
  assert(r.stages.parser.ok === true, 'parser ok');
});

/* ── (4) Completer stage reports halt count in dry-run ────────────────── */

test('Completer stage all halts in dry-run mode', () => {
  const r = runPipeline(BASELINE_SLUG, { dryRunLlm: true, writeReport: false });
  assert(r.stages.completer.fields_filled === 0,
    `dry-run should fill 0, got ${r.stages.completer.fields_filled}`);
  assert(r.stages.completer.halts >= 0, 'halts >= 0');
});

/* ── (5) Cross-check stage audits populated fields ────────────────────── */

test('Cross-check stage audits populated audit fields', () => {
  const r = runPipeline(BASELINE_SLUG, { dryRunLlm: true, writeReport: false });
  assert(r.stages.cross_check.fields_audited > 5,
    `expected >5 audited, got ${r.stages.cross_check.fields_audited}`);
  /* In dry-run, all entries halt, so disagreement_count should be 0. */
  assert(r.stages.cross_check.disagreement_count === 0,
    `dry-run should have 0 disagreements, got ${r.stages.cross_check.disagreement_count}`);
});

/* ── (6) PAR stage is skipped when no parPath provided ────────────────── */

test('PAR ingest stage skipped when parPath null', () => {
  const r = runPipeline(BASELINE_SLUG, { dryRunLlm: true, writeReport: false });
  assert(r.stages.par_ingest.skipped === true, 'par_ingest skipped');
});

/* ── (7) PAR stage runs when parPath provided ─────────────────────────── */

test('PAR ingest stage runs with inline JSON adapter', () => {
  const parPath = join(tmpRoot, 'test-par.json');
  writeFileSync(parPath, JSON.stringify({
    vendor: 'generic',
    reels: [['R7', 'BL']],
    paytable: [{ symbolId: 'R7', combos: { '3': 100 } }],
    totals: { reels: 1, symbols: 2, sumWeight: 2 },
  }), 'utf8');
  const r = runPipeline(BASELINE_SLUG, {
    dryRunLlm: true, parPath, writeReport: false,
  });
  assert(r.stages.par_ingest.ok === true, `par ingest failed: ${r.stages.par_ingest.error}`);
  assert(r.stages.par_ingest.vendor === 'generic', `vendor: ${r.stages.par_ingest.vendor}`);
  assert(r.sources.par_sheet_hash, 'par_sheet_hash present');
});

/* ── (8) Schema stage validates final model ───────────────────────────── */

test('Schema stage validates final model against UniversalGameSchema', () => {
  const r = runPipeline(BASELINE_SLUG, { dryRunLlm: true, writeReport: false });
  assert(r.stages.schema.ok === true, `schema fail: ${(r.stages.schema.errors_sample || []).join(' | ')}`);
  assert(r.stages.schema.error_count === 0, 'no schema errors');
});

/* ── (9) Idempotent: same input -> same final_hash ────────────────────── */

test('Pipeline is idempotent (same final_hash on rerun)', () => {
  const r1 = runPipeline(BASELINE_SLUG, { dryRunLlm: true, writeReport: false });
  const r2 = runPipeline(BASELINE_SLUG, { dryRunLlm: true, writeReport: false });
  assert(r1.final_hash === r2.final_hash,
    `final_hash differs: ${r1.final_hash} != ${r2.final_hash}`);
});

/* ── (10) Missing slug throws ─────────────────────────────────────────── */

test('Missing slug throws clear error', () => {
  let threw = false;
  try { runPipeline('__no-such-slug-zzz__', { writeReport: false }); }
  catch (e) { threw = e.message.includes('not found'); }
  assert(threw, 'should throw on missing slug');
});

/* ── (11) ok_overall set correctly ────────────────────────────────────── */

test('ok_overall=true for baseline GDD in dry-run', () => {
  const r = runPipeline(BASELINE_SLUG, { dryRunLlm: true, writeReport: false });
  /* parser ok + schema ok + no cross-check disagreements (dry-run halts). */
  assert(r.ok_overall === true, `ok_overall: ${r.ok_overall}`);
});

/* ── Cleanup ──────────────────────────────────────────────────────────── */

try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
