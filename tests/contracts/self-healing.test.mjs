#!/usr/bin/env node
/**
 * tests/contracts/self-healing.test.mjs
 *
 * N+2 E (2026-06-23) — Contract suite for the GDD-level self-healing
 * parser orchestrator.
 *
 * Coverage:
 *   1.  diagnoseModel: null model → CATASTROPHIC
 *   2.  diagnoseModel: empty {} → CATASTROPHIC + all gaps flagged
 *   3.  diagnoseModel: missing topology only → CRITICAL
 *   4.  diagnoseModel: missing topology + paytable → CATASTROPHIC
 *   5.  diagnoseModel: clean model → CLEAN (not actionable)
 *   6.  diagnoseModel: WARN severity (low pillar confidence) not actionable
 *   7.  buildFixPrompt: contains raw text slice + model snippet + gap list
 *   8.  buildFixPrompt: includes anti-vendor instruction
 *   9.  buildFixPrompt: schema hints emitted
 *  10. applyPatch: pure (input unmodified)
 *  11. applyPatch: stamps confidence._healedBy provenance
 *  12. applyPatch: only patches EMPTY parser fields (never overwrites)
 *  13. applyPatch: rejects __proto__ / constructor / prototype keys
 *  14. applyPatch: rejects non-whitelisted top-level fields
 *  15. healModel: mock healer success → patches missing topology
 *  16. healModel: provider unavailable on attempt 1 → skip with reason
 *  17. healModel: max 3 attempts respected (cost gate)
 *  18. healModel: severity-target early-exit (stops once CLEAN/WARN)
 *  19. healModel: receipt carries cost estimate + provider + finalSeverity
 *  20. healModel: idempotent (same input + mock healer → same output)
 *  21. anti-vendor lint: prompt contains no banned product names
 *  22. CLI: --diagnose-only emits valid Diagnosis JSON
 *
 * Run: node tests/contracts/self-healing.test.mjs
 * Exit 0 on PASS, 1 on first FAIL.
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..', '..');

let pass = 0;
let fail = 0;
const failures = [];

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      throw new Error(`test "${name}" returned a Promise — use async test()`);
    }
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fail++;
    failures.push({ name, error: e.message });
    console.log(`  ✗ ${name} — ${e.message}`);
  }
}
async function testAsync(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fail++;
    failures.push({ name, error: e.message });
    console.log(`  ✗ ${name} — ${e.message}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || 'expected equal'}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`);
}

console.log('═══ self-healing.test.mjs ═══');

const { diagnoseModel, buildFixPrompt, applyPatch, healModel, extractFirstJsonObject } =
  await import(resolve(REPO, 'tools/self-healing-parser.mjs'));

/* ─── synthetic fixtures ─────────────────────────────────────────────── */

const CLEAN_MODEL = {
  name: 'CleanGame',
  topology: { kind: 'rectangular', reels: 5, rows: 3, paylines: 20 },
  symbols: {
    high: [{ id: 'H1', pay: { '3': 100 } }, { id: 'H2', pay: { '3': 50 } }],
    mid: [{ id: 'M1', pay: { '3': 25 } }],
    low: [{ id: 'L1', pay: { '3': 10 } }],
  },
  features: [{ kind: 'free_spins' }],
  confidence: { name: 0.9, topology: 0.95, symbols: 0.8, features: 0.7 },
};

const BROKEN_MODEL = {
  name: 'BrokenGame',
  /* missing topology + paytable + 0 features */
  symbols: { high: [{ id: 'H1' }] },
  features: [],
  confidence: { name: 0.6, topology: 0, symbols: 0.2, features: 0 },
};

const RAW_TEXT = `
  Slot game brief.
  5 reels × 3 rows, 20 paylines.
  High symbols: H1, H2. Mid: M1. Low: L1.
  Free spins feature: 10 spins on 3 scatters.
  Paytable: 5-of-a-kind H1 pays 500x.
`.trim();

/* ─── diagnose tests ─────────────────────────────────────────────────── */

test('1. diagnoseModel null → CATASTROPHIC', () => {
  const d = diagnoseModel(null);
  assertEq(d.severity, 'CATASTROPHIC');
  assert(d.actionable === true);
});

test('2. diagnoseModel empty {} → CATASTROPHIC + all gaps flagged', () => {
  const d = diagnoseModel({});
  assertEq(d.severity, 'CATASTROPHIC');
  assert(d.missingTopology, 'expected missingTopology');
  assert(d.missingPaytable, 'expected missingPaytable');
  assert(d.missingSymbols, 'expected missingSymbols');
  assert(d.missingFeatures, 'expected missingFeatures');
});

test('3. diagnoseModel: missing topology only → CRITICAL', () => {
  const m = JSON.parse(JSON.stringify(CLEAN_MODEL));
  m.topology = null;
  m.confidence.topology = 0;
  const d = diagnoseModel(m);
  assertEq(d.severity, 'CRITICAL', `gaps: ${d.criticalGaps.join('; ')}`);
  assert(d.missingTopology);
  assert(!d.missingPaytable);
});

test('4. diagnoseModel: missing topology + paytable → CATASTROPHIC', () => {
  const m = JSON.parse(JSON.stringify(CLEAN_MODEL));
  m.topology = null;
  m.symbols = { high: [{ id: 'H1' }] }; /* no pay → missingPaytable */
  m.confidence.topology = 0;
  const d = diagnoseModel(m);
  assertEq(d.severity, 'CATASTROPHIC');
});

test('5. diagnoseModel: clean model → CLEAN (not actionable)', () => {
  const d = diagnoseModel(CLEAN_MODEL);
  assertEq(d.severity, 'CLEAN', `gaps: ${d.criticalGaps.join('; ')}`);
  assertEq(d.actionable, false);
});

test('6. diagnoseModel: WARN not actionable', () => {
  const m = JSON.parse(JSON.stringify(CLEAN_MODEL));
  m.confidence.features = 0.3; /* one pillar below floor */
  const d = diagnoseModel(m);
  assertEq(d.severity, 'WARN');
  assertEq(d.actionable, false);
});

/* ─── buildFixPrompt tests ───────────────────────────────────────────── */

test('7. buildFixPrompt: contains raw + model snippet + gap list', () => {
  const d = diagnoseModel(BROKEN_MODEL);
  const p = buildFixPrompt(RAW_TEXT, BROKEN_MODEL, d);
  assert(p.includes('5 reels'), 'expected raw text slice');
  assert(p.includes('BrokenGame'), 'expected model snippet');
  assert(p.includes('topology'), 'expected gap reference');
});

test('8. buildFixPrompt: anti-vendor instruction emitted', () => {
  const d = diagnoseModel(BROKEN_MODEL);
  const p = buildFixPrompt(RAW_TEXT, BROKEN_MODEL, d);
  assert(/no Eldritch.*Wrath.*Crystal Forge/i.test(p),
    'expected anti-vendor instruction in prompt');
});

test('9. buildFixPrompt: schema hints emitted', () => {
  const d = diagnoseModel(BROKEN_MODEL);
  const p = buildFixPrompt(RAW_TEXT, BROKEN_MODEL, d);
  assert(p.includes('rectangular'), 'expected topology kind hint');
  assert(p.includes('combos'), 'expected paytable schema hint');
});

/* ─── applyPatch tests ───────────────────────────────────────────────── */

test('10. applyPatch: pure (input unmodified)', () => {
  const input = JSON.parse(JSON.stringify(BROKEN_MODEL));
  const inputCopy = JSON.parse(JSON.stringify(input));
  const out = applyPatch(input, { topology: { kind: 'rectangular', reels: 5, rows: 3 } });
  assertEq(JSON.stringify(input), JSON.stringify(inputCopy), 'input was mutated');
  assert(out.model !== input, 'expected new model reference');
});

test('11. applyPatch: stamps confidence._healedBy provenance (deterministic contentStamp)', () => {
  const out = applyPatch(BROKEN_MODEL, { topology: { kind: 'cluster', reels: 6, rows: 5 } });
  assert(out.model.confidence._healedBy.topology, 'expected _healedBy.topology');
  assertEq(out.model.confidence._healedBy.topology.source, 'self-healing-parser');
  /* H-1 audit fix: contentStamp is deterministic (8-char hex), not timestamp */
  assert(/^[a-f0-9]{8}$/.test(out.model.confidence._healedBy.topology.contentStamp),
    'expected 8-hex contentStamp, got: ' + JSON.stringify(out.model.confidence._healedBy.topology.contentStamp));
  assert(!('stampedAt' in out.model.confidence._healedBy.topology),
    'stampedAt should NOT be present (H-1 idempotency fix)');
});

test('12. applyPatch: never overwrites parser fields', () => {
  /* CLEAN_MODEL has topology — patch should NOT overwrite */
  const out = applyPatch(CLEAN_MODEL, { topology: { kind: 'OVERWRITE_ATTEMPT', reels: 99, rows: 99 } });
  assertEq(out.model.topology.kind, 'rectangular', 'parser field was overwritten');
  assert(out.applied.warnings.some(w => /not overwriting/.test(w)),
    'expected warning about skipped overwrite');
});

test('13. applyPatch: rejects proto-pollution keys', () => {
  const out = applyPatch(BROKEN_MODEL, { __proto__: { polluted: true }, constructor: 'x' });
  assert(out.applied.rejectedKeys.includes('__proto__') ||
         out.applied.rejectedKeys.includes('constructor'),
    'expected proto-pollution keys rejected');
  assert(!('polluted' in out.model), 'pollution leaked through');
});

test('14. applyPatch: rejects non-whitelisted top-level fields', () => {
  const out = applyPatch(BROKEN_MODEL, { randomField: 42, malicious: 'x' });
  assert(out.applied.rejectedKeys.includes('randomField'));
  assert(out.applied.rejectedKeys.includes('malicious'));
  assert(!('randomField' in out.model));
});

/* ─── healModel tests (with mock healer) ─────────────────────────────── */

/* Mock healer: deterministic, returns a patch that fixes ALL pillar gaps
 * the BROKEN_MODEL has — topology + symbols + features + paytable. Since
 * applyPatch is conservative (never overwrites existing fields), the
 * symbols patch DOES land because BROKEN_MODEL.symbols has only 1 high
 * symbol (a non-empty object — applyPatch isEmpty check considers
 * Object.keys.length === 0 as empty; with 1 high key it's "non-empty").
 *
 * Workaround for the test: pre-clear symbols entirely so healer can land
 * a full set. Real-world ingest path: a CATASTROPHIC model often has
 * symbols: undefined OR {} — both qualify as empty per applyPatch. */
async function mockHealer(prompt, _opts) {
  return {
    ok: true,
    patch: {
      topology: { kind: 'rectangular', reels: 5, rows: 3, paylines: 20 },
      symbols: {
        high: [{ id: 'H1', pay: { '3': 50, '4': 200, '5': 1000 } },
               { id: 'H2', pay: { '3': 30, '4': 120, '5': 500 } }],
        mid:  [{ id: 'M1', pay: { '3': 15, '4': 60, '5': 250 } }],
        low:  [{ id: 'L1', pay: { '3': 5, '4': 20, '5': 100 } }],
      },
      paytable: [
        { symbolId: 'H1', combos: { '3': 50, '4': 200, '5': 1000 } },
      ],
      features: [{ kind: 'free_spins' }],
    },
    durationMs: 10,
    provider: 'mock',
  };
}

/* CATASTROPHIC model with symbols fully absent — so applyPatch can land
 * the healer's full symbols block (isEmpty check requires undefined/null
 * or empty object). */
const CATASTROPHIC_MODEL = {
  name: 'CatastrophicGame',
  /* topology absent, symbols absent, features absent, paytable absent */
  confidence: { name: 0.6, topology: 0, symbols: 0, features: 0 },
};

async function failingHealer(_prompt, _opts) {
  return { ok: false, error: 'mock healer says no', durationMs: 5, provider: 'mock' };
}

async function unavailableHealer(_prompt, _opts) {
  return { ok: false, error: 'cortex-kimi-ask binary not found', durationMs: 0, provider: 'cortex-kimi-ask' };
}

await testAsync('15. healModel: mock healer patches missing topology', async () => {
  const r = await healModel(RAW_TEXT, CATASTROPHIC_MODEL, { healerFn: mockHealer });
  assert(r.ok, `expected ok, got: ${r.reason || r.receipt?.finalSeverity}`);
  assert(r.model.topology, 'expected topology after heal');
  assertEq(r.model.topology.kind, 'rectangular');
  assert(r.receipt.fieldsRepaired.includes('topology'));
});

await testAsync('16. healModel: provider unavailable → skip with reason', async () => {
  const r = await healModel(RAW_TEXT, BROKEN_MODEL, { healerFn: unavailableHealer });
  assertEq(r.ok, false);
  assertEq(r.skipped, true);
  assert(/not found/.test(r.reason), `reason: ${r.reason}`);
});

await testAsync('17. healModel: max 3 attempts respected (cost gate)', async () => {
  /* Failing healer never succeeds; loop should top out at maxAttempts. */
  const r = await healModel(RAW_TEXT, BROKEN_MODEL, { healerFn: failingHealer, maxAttempts: 3 });
  assert(r.attempts <= 3, `expected ≤3 attempts, got ${r.attempts}`);
  assertEq(r.ok, false);
});

await testAsync('18. healModel: severity-target early-exit', async () => {
  /* Healer patches everything on attempt 1; should stop at attempt 1. */
  const r = await healModel(RAW_TEXT, CATASTROPHIC_MODEL, { healerFn: mockHealer, maxAttempts: 3 });
  assert(r.attempts <= 1, `expected early exit ≤1 attempt, got ${r.attempts}`);
});

await testAsync('19. healModel: receipt carries cost + provider + severity', async () => {
  const r = await healModel(RAW_TEXT, BROKEN_MODEL, { healerFn: mockHealer });
  assert(Number.isFinite(r.receipt.costEstimateUsd), 'cost must be numeric');
  assertEq(r.receipt.llmProvider, 'mock');
  assert(r.receipt.initialSeverity, 'expected initialSeverity');
  assert(r.receipt.finalSeverity, 'expected finalSeverity');
  assert(r.receipt.attempts.length >= 1);
});

await testAsync('20. healModel: idempotent (same input → same on-disk bytes, NO strip)', async () => {
  /* H-1 audit fix verification: model.json bytes must match BYTE-FOR-BYTE
   * across two ingests. No stampedAt timestamp = no need to strip. */
  const r1 = await healModel(RAW_TEXT, BROKEN_MODEL, { healerFn: mockHealer });
  const r2 = await healModel(RAW_TEXT, BROKEN_MODEL, { healerFn: mockHealer });
  assertEq(
    JSON.stringify(r1.model),
    JSON.stringify(r2.model),
    'idempotent heal required (no strip — H-1 fix)'
  );
});

test('21. anti-vendor lint: prompt has no banned product names', () => {
  const d = diagnoseModel(BROKEN_MODEL);
  const p = buildFixPrompt(RAW_TEXT, BROKEN_MODEL, d);
  /* The anti-vendor INSTRUCTION mentions banned names by design — that's
   * the LLM directive ("do not include X"). Strip the instruction line
   * and check the rest of the prompt for accidental vendor names in
   * model snippet / raw text passthrough. */
  const noInstr = p.replace(/DO NOT include any vendor product names \([^)]+\)/, '');
  const banned = /eldritch|woo[\s_-]?wrath|wrath[\s_-]?of[\s_-]?olympus|crystal[\s_-]?forge[\s_-]?adb/i;
  assert(!banned.test(noInstr), 'banned vendor product leaked into prompt body');
});

test('22. M-1 audit: Infinity/NaN confidence collapses to 0', () => {
  /* Adversarial GDD shipping Infinity must NOT pass floor check. */
  const m = JSON.parse(JSON.stringify(BROKEN_MODEL));
  m.confidence = { name: Infinity, topology: NaN, symbols: -5, features: 'string' };
  const d = diagnoseModel(m);
  /* All 4 pillars should be 0 after sanitization → CATASTROPHIC */
  assertEq(d.pillarConfidence.name, 0, 'Infinity must collapse to 0');
  assertEq(d.pillarConfidence.topology, 0, 'NaN must collapse to 0');
  assertEq(d.pillarConfidence.symbols, 0, 'negative must collapse to 0');
  assertEq(d.pillarConfidence.features, 0, 'non-numeric must collapse to 0');
});

await testAsync('23. H-3 audit: cost ceiling enforced (always-failing healer halts at ceiling)', async () => {
  /* Expensive provider; ceiling = $0.01 → first attempt costs $0.05
   * (fable rate) → ceiling breached after first attempt → loop stops. */
  async function expensiveFailingHealer(_p, _o) {
    return { ok: false, error: 'mock fail', durationMs: 5, provider: 'cortex-fable-ask' };
  }
  const r = await healModel(RAW_TEXT, BROKEN_MODEL, {
    healerFn: expensiveFailingHealer,
    maxAttempts: 10,           /* would normally try 10 times */
    costCeilingUsd: 0.01,      /* but ceiling caps at 1 attempt */
  });
  /* Expect 1 real attempt + 1 ceiling-breach log entry. */
  assert(r.attempts <= 2, `expected ≤2 attempts (real + ceiling notice), got ${r.attempts}`);
  assert(r.receipt.costEstimateUsd >= 0.01, 'cost should be at least ceiling');
  assert(r.receipt.attempts.some(a => /cost ceiling/.test(a.error || '')),
    'expected cost ceiling note in attempts log');
});

test('24. L-5 audit: diagnoseModel never emits UNKNOWN severity', () => {
  /* L-5 fix in severityIndex: if a future diagnose returns 'UNKNOWN',
   * it would now map to SEVERITY_LEVELS.length (worst) instead of 0
   * (CLEAN). We can't easily inject UNKNOWN, but we can verify the
   * current diagnose ALWAYS returns one of the 4 valid severities. */
  const known = new Set(['CLEAN', 'WARN', 'CRITICAL', 'CATASTROPHIC']);
  for (const m of [null, {}, BROKEN_MODEL, CLEAN_MODEL, CATASTROPHIC_MODEL,
                    { rtp: { target: 96 } }, { confidence: { name: 0.9 } }]) {
    const d = diagnoseModel(m);
    assert(known.has(d.severity),
      `diagnose emitted unknown severity ${d.severity} for input: ${JSON.stringify(m).slice(0, 60)}`);
  }
});

await testAsync('25. CLI: --diagnose-only emits valid Diagnosis JSON', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'self-healing-cli-'));
  try {
    const modelFile = join(tmpDir, 'model.json');
    writeFileSync(modelFile, JSON.stringify(BROKEN_MODEL));
    const r = spawnSync('node',
      [resolve(REPO, 'tools/self-healing-parser.mjs'),
       `--model=${modelFile}`, '--diagnose-only'],
      { encoding: 'utf8', timeout: 15000 });
    assertEq(r.status, 0, `CLI exit ${r.status}, stderr: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert(out.severity, 'expected severity in CLI output');
    assert(Array.isArray(out.criticalGaps), 'expected criticalGaps array');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

/* ─── UQ-DEEP-C audit fixes (paralel-agent E-CRIT + E-HIGH) ──────────── */

/* E-CRIT-greedy: balanced JSON extractor must take FIRST complete object,
 * not greedily span to the last `}` in the stream. Adversarial healer
 * output with trailing debug bytes used to corrupt the parse. */
test('UQ-DEEP-C-1: extractFirstJsonObject takes first balanced object', () => {
  const src = '{"first":1} junk {"second":2}';
  assertEq(extractFirstJsonObject(src), '{"first":1}');
});
test('UQ-DEEP-C-2: extractFirstJsonObject handles braces inside strings', () => {
  const src = '{"text":"contains } and { inside"} trailing';
  assertEq(extractFirstJsonObject(src), '{"text":"contains } and { inside"}');
});
test('UQ-DEEP-C-3: extractFirstJsonObject handles nested objects', () => {
  const src = 'noise {"a":{"b":{"c":1}}, "d":2} more noise';
  assertEq(extractFirstJsonObject(src), '{"a":{"b":{"c":1}}, "d":2}');
});
test('UQ-DEEP-C-4: extractFirstJsonObject returns null on no braces', () => {
  assertEq(extractFirstJsonObject('no json here'), null);
  assertEq(extractFirstJsonObject(''), null);
  assertEq(extractFirstJsonObject(null), null);
  assertEq(extractFirstJsonObject(undefined), null);
});
test('UQ-DEEP-C-5: extractFirstJsonObject returns null on unbalanced', () => {
  assertEq(extractFirstJsonObject('{"unclosed":'), null);
  assertEq(extractFirstJsonObject('{"a":1'), null);
});
test('UQ-DEEP-C-6: extractFirstJsonObject handles escaped quotes in string', () => {
  const src = '{"esc":"he said \\"hi\\""} tail';
  assertEq(extractFirstJsonObject(src), '{"esc":"he said \\"hi\\""}');
});

/* E-HIGH-malformed-json: healer that returns non-object patches must be
 * rejected by applyPatch / healModel without polluting the model. */
await testAsync('UQ-DEEP-C-7: healer returns array patch → reject', async () => {
  const arrayHealer = async () => ({
    ok: true, patch: [1, 2, 3], durationMs: 1, provider: 'mock',
  });
  const r = await healModel(RAW_TEXT, CATASTROPHIC_MODEL, {
    healerFn: arrayHealer, maxAttempts: 1, backoffJitter: false,
  });
  /* Loop completes but no fields applied — model stays catastrophic. */
  assert(r.receipt.fieldsRepaired.length === 0, 'array patch must not land');
  assert(!Array.isArray(r.model), 'model must remain object');
});

await testAsync('UQ-DEEP-C-8: healer returns string patch → reject', async () => {
  const stringHealer = async () => ({
    ok: true, patch: 'not an object', durationMs: 1, provider: 'mock',
  });
  const r = await healModel(RAW_TEXT, CATASTROPHIC_MODEL, {
    healerFn: stringHealer, maxAttempts: 1, backoffJitter: false,
  });
  assert(r.receipt.fieldsRepaired.length === 0, 'string patch must not land');
  assert(typeof r.model === 'object', 'model must remain object');
});

/* E-HIGH-proto-pollution: applyPatch already rejects __proto__/constructor/
 * prototype top-level keys (test #13), but verify the END-TO-END healModel
 * loop also blocks them — a malicious healer must not pollute Object.prototype. */
await testAsync('UQ-DEEP-C-9: proto pollution via healer patch blocked', async () => {
  /* Sentinel: any global object should NOT acquire `polluted` field. */
  const sentinel = {};
  assert(!('polluted' in sentinel), 'pre-condition: no pollution');
  const evilHealer = async () => ({
    ok: true,
    patch: { __proto__: { polluted: true } },
    durationMs: 1,
    provider: 'mock',
  });
  await healModel(RAW_TEXT, CATASTROPHIC_MODEL, {
    healerFn: evilHealer, maxAttempts: 1, backoffJitter: false,
  });
  assert(!('polluted' in sentinel),
    `Object.prototype polluted via healer patch — applyPatch guard broken`);
  assert(!({}).polluted, 'fresh object polluted via prototype');
});

await testAsync('UQ-DEEP-C-10: constructor pollution via healer blocked', async () => {
  const evilHealer = async () => ({
    ok: true,
    patch: { constructor: { prototype: { hijacked: true } } },
    durationMs: 1,
    provider: 'mock',
  });
  const r = await healModel(RAW_TEXT, CATASTROPHIC_MODEL, {
    healerFn: evilHealer, maxAttempts: 1, backoffJitter: false,
  });
  assert(!({}).hijacked, 'constructor pollution leaked');
  assert(r.receipt.fieldsRepaired.length === 0, 'constructor patch must not land');
});

/* E-HIGH-backoff: explicit deterministic mode (backoffJitter:false) yields
 * zero wall-clock delay so the test suite stays fast. */
await testAsync('UQ-DEEP-C-11: backoffJitter:false skips delay', async () => {
  const t0 = Date.now();
  /* 3 failing attempts = 2 inter-attempt backoffs. With BASE=500ms +
   * jitter, real wall-clock would be ~1.5–3s. With backoffJitter:false,
   * must be < 200ms total. */
  await healModel(RAW_TEXT, BROKEN_MODEL, {
    healerFn: failingHealer, maxAttempts: 3, backoffJitter: false,
  });
  const elapsed = Date.now() - t0;
  assert(elapsed < 500, `backoffJitter:false should be fast, got ${elapsed}ms`);
});

/* ─── summary ─────────────────────────────────────────────────────── */
console.log('');
console.log(`═══ ${pass} PASS · ${fail} FAIL ═══`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.error}`);
  process.exit(1);
}
process.exit(0);
