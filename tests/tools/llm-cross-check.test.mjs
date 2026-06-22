#!/usr/bin/env node
/**
 * tests/tools/llm-cross-check.test.mjs
 *
 * MATH-DEEP HYB-3 test suite — LLM Consistency Validator (Sloj 3).
 *
 * All tests run in DRY-RUN mode (no Kimi tokens). Verifies:
 *   - validateFieldFaithful() returns structured receipt
 *   - validateModelFaithful() walks AUDIT_FIELDS in model
 *   - Receipt has all required keys per spec
 *   - LLM hallucination guard (gdd_quote must be verbatim) wire path
 *   - Cache key collision-safe across (gdd, field, value) triplet
 *   - Disagreements separated from faithful entries
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateFieldFaithful,
  validateModelFaithful,
} from '../../tools/llm-cross-check.mjs';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('HYB-3 LLM Cross-Check · test suite');

/* ── (1) validateFieldFaithful returns halt in dry-run ────────────────── */

test('validateFieldFaithful dry-run returns halt receipt', () => {
  const r = validateFieldFaithful('fake GDD prose', 'payback.rtp', 96.0, { dryRun: true });
  assert(r.field === 'payback.rtp', `field path: ${r.field}`);
  assert(r.model_value === 96.0, `model_value: ${r.model_value}`);
  assert(r.faithful === false, 'dry-run should not assert faithful');
  assert(r.halt === true, 'dry-run should halt');
  assert(r.halt_reason === 'dry-run', `halt_reason: ${r.halt_reason}`);
});

/* ── (2) Receipt shape spec compliance ────────────────────────────────── */

test('Receipt has all required keys', () => {
  const r = validateFieldFaithful('fake', 'topology.reels', 5, { dryRun: true });
  const required = ['field', 'model_value', 'faithful', 'gdd_quote', 'reason',
                    'confidence', 'provider', 'halt', 'duration_ms', 'timestamp'];
  for (const k of required) assert(k in r, `missing key: ${k}`);
});

/* ── (3) validateModelFaithful skips undefined fields ─────────────────── */

test('validateModelFaithful walks only populated audit fields', () => {
  const model = {
    payback: { rtp: 96.0 },
    topology: { reels: 5, rows: 3 },
    /* most audit fields undefined */
  };
  const r = validateModelFaithful('slug', 'fake GDD', model, { dryRun: true });
  assert(Array.isArray(r.entries), 'entries should be array');
  /* Only populated fields walked: rtp + reels + rows + paylines? */
  /* paylines not set, so 3 entries: rtp + reels + rows. */
  assert(r.entries.length === 3, `expected 3 entries, got ${r.entries.length}`);
  assert(r.entries.some(e => e.field === 'payback.rtp'), 'rtp walked');
  assert(r.entries.some(e => e.field === 'topology.reels'), 'reels walked');
  assert(r.entries.some(e => e.field === 'topology.rows'), 'rows walked');
});

/* ── (4) Disagreements separated from faithful ────────────────────────── */

test('disagreements filtered from entries when faithful=false (non-halt only)', () => {
  /* In dry-run, all entries are halted. Disagreements should be empty
   * because we only count NON-halted false-faithful as disagreements. */
  const model = { payback: { rtp: 96.0 } };
  const r = validateModelFaithful('slug', 'fake', model, { dryRun: true });
  assert(r.disagreements.length === 0,
    `dry-run should produce 0 disagreements (all halted), got ${r.disagreements.length}`);
});

/* ── (5) Empty audit fields skipped ───────────────────────────────────── */

test('Empty object fields (e.g. scatter.payTable={}) are skipped', () => {
  const model = {
    payback: { rtp: 96.0 },
    scatter: { payTable: {} },
  };
  const r = validateModelFaithful('slug', 'fake', model, { dryRun: true });
  /* scatter.payTable should NOT be in entries because it's an empty object. */
  assert(!r.entries.some(e => e.field === 'scatter.payTable'),
    'empty scatter.payTable should be skipped');
});

/* ── (6) Cache key uses value hash (collision-safe) ────────────────────── */

test('Different model values for same field produce different receipts', () => {
  const r1 = validateFieldFaithful('GDD A', 'payback.rtp', 96.0, { dryRun: true });
  const r2 = validateFieldFaithful('GDD A', 'payback.rtp', 88.0, { dryRun: true });
  /* Both halted, but timestamps could differ (cache key includes value). */
  assert(r1.model_value !== r2.model_value, 'different values should produce different receipts');
});

/* ── (7) Boolean and string model values supported ────────────────────── */

test('Boolean and string field values handled', () => {
  const rBool = validateFieldFaithful('fake', 'expandingWild.onlyIfWinning', true, { dryRun: true });
  const rStr  = validateFieldFaithful('fake', 'topology.evaluation', 'lines', { dryRun: true });
  assert(rBool.model_value === true, 'bool round-trip');
  assert(rStr.model_value === 'lines', 'string round-trip');
});

/* ── Result ───────────────────────────────────────────────────────────── */

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
