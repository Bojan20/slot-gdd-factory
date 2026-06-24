#!/usr/bin/env node
/**
 * tests/contracts/anticipation-gate-deep-y.test.mjs
 *
 * UQ-DEEP-Y (Boki 2026-06-24, laser fix): anticipation gate threshold.
 *
 * Pre fix-a: `Math.max(1, threshold - remaining)`. Sa 4 reels spinning +
 * threshold=3 → gate=max(1,-1)=1 → glow startuje na PRVOM scatter-u.
 * Boki: "Mora 2+ scatter simbola da bi se uklucila anticipacija ako gdd
 * zahteva 3+ scatter za bonus".
 *
 * Posle fix-a: `Math.max(1, threshold - 1)`. Anticipacija je "još jedan i
 * imamo bonus" suspense — startuje samo kad ima threshold-1 scatter-a već.
 *
 * Exit 0 PASS, 1 FAIL.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');

let pass = 0, fail = 0;
const failures = [];

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

async function test(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; failures.push({ name, error: e.message }); console.log(`  ✗ ${name} — ${e.message}`); }
}

console.log('═══ anticipation-gate-deep-y.test.mjs ═══');

await test('SOURCE: anticipationGate formula = max(1, threshold - 1) not (threshold - remaining)', async () => {
  const src = readFileSync(resolve(REPO, 'src/blocks/anticipation.mjs'), 'utf8');
  /* Strip comments — the doc preserves the old formula in explanation. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert(!/anticipationGate = Math\.max\(1, trg\.threshold - remaining\)/.test(code),
    'old broken formula `threshold - remaining` still present in code');
  assert(/anticipationGate = Math\.max\(1, trg\.threshold - 1\)/.test(code),
    'new fixed formula `threshold - 1` missing');
});

/* Pure-logic test: reproduce the gate eval to prove fix semantics. */
function reproduceGate(threshold, remaining, scattersSoFar, topRung) {
  const anticipationGate = Math.max(1, threshold - 1);
  return (scattersSoFar >= anticipationGate) &&
         (scattersSoFar + remaining >= threshold) &&
         (scattersSoFar < topRung);
}

await test('LOGIC: threshold=3, 1 scatter, 4 spinning → NO anticipation (was YES)', async () => {
  assert(reproduceGate(3, 4, 1, 5) === false,
    'should NOT anticipate on first scatter when threshold=3');
});

await test('LOGIC: threshold=3, 2 scatters, 3 spinning → YES anticipation', async () => {
  assert(reproduceGate(3, 3, 2, 5) === true,
    'should anticipate when 2 scatters landed (one short of 3)');
});

await test('LOGIC: threshold=3, 2 scatters, 0 spinning → NO (already settled, mathematically over)', async () => {
  assert(reproduceGate(3, 0, 2, 5) === false,
    'should NOT anticipate when no reels remain');
});

await test('LOGIC: threshold=4, 1 scatter, 4 spinning → NO', async () => {
  assert(reproduceGate(4, 4, 1, 5) === false,
    'should NOT anticipate on first scatter when threshold=4');
});

await test('LOGIC: threshold=4, 2 scatters, 3 spinning → NO (still 2 short)', async () => {
  assert(reproduceGate(4, 3, 2, 5) === false,
    'should NOT anticipate when 2 scatters landed for threshold=4');
});

await test('LOGIC: threshold=4, 3 scatters, 2 spinning → YES (one short)', async () => {
  assert(reproduceGate(4, 2, 3, 5) === true,
    'should anticipate when 3 scatters landed for threshold=4');
});

await test('LOGIC: threshold=2 (low-bar), 1 scatter, 4 spinning → YES (legitimate one-short)', async () => {
  assert(reproduceGate(2, 4, 1, 5) === true,
    'should anticipate on first scatter when threshold=2 (one short)');
});

await test('LOGIC: threshold=1 (silly), 0 scatters, 5 spinning → NO (gate clamps to 1)', async () => {
  assert(reproduceGate(1, 5, 0, 3) === false,
    'gate clamps to 1; 0 scatters fails (>= 1 check)');
});

await test('LOGIC: at topRung already (e.g. 5/3 for threshold=3 ladder) → NO', async () => {
  assert(reproduceGate(3, 1, 5, 5) === false,
    'topRung reached, no further anticipation');
});

await test('LOGIC: mathematically impossible (1 scatter + 1 remaining + threshold 3) → NO', async () => {
  assert(reproduceGate(3, 1, 1, 5) === false,
    'should NOT anticipate when math says impossible');
});

/* ────────────────────────────────────────────────────────────────────── */
/* E2E: rebuilt slot HTML contains the new formula in runtime. */

await test('E2E: Cash Eruption rebuilt HTML uses `threshold - 1` gate', async () => {
  const distPath = resolve(REPO, 'dist/ingest/cash-eruption-foundry-gdd/index.html');
  if (!existsSync(distPath)) throw new Error('dist not built — run ingest');
  const html = readFileSync(distPath, 'utf8');
  /* Look for the inline runtime gate expression — slot.html embeds the
   * anticipation runtime string verbatim. */
  assert(html.includes('Math.max(1, trg.threshold - 1)'),
    'fixed gate not yet propagated to live slot HTML — needs rebuild');
});

/* ────────────────────────────────────────────────────────────────────── */

console.log('');
console.log(`═══ ${pass} PASS · ${fail} FAIL ═══`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.error}`);
  process.exit(1);
}
process.exit(0);
