#!/usr/bin/env node
/**
 * tests/contracts/render-parser-fields-integration.test.mjs
 *
 * Wave RENDER-INTEG-A (2026-06-23) — render integration contract.
 *
 * Purpose
 *   Verify that MATH-DEEP D-series parser-extracted fields actually surface
 *   in rendered slot.html for the 5 baseline GDDs. Without this gate, the
 *   parser could silently drop new fields and operator/QA tools would have
 *   no way to detect the regression.
 *
 * Coverage (per baseline GDD)
 *   1. model.compliance              → __GDD_COMPLIANCE__ in runtime
 *   2. model.payback.rtpBreakdown    → __GDD_RTP_BREAKDOWN__ in runtime
 *   3. model.scatter.payTable        → __GDD_SCATTER_PAY_TABLE__ in runtime
 *   4. model.expandingWild
 *        .onlyIfWinning              → EXPANDING_WILD_ONLY_IF_WINNING const
 *                                      (when expanding wild block enabled)
 *
 * Acceptance
 *   Each baseline whose model has a field MUST have the corresponding
 *   runtime constant in its slot.html with the same value.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const REAL_GAMES = join(REPO, 'dist/real-games');

const BASELINES = [
  'cash-eruption-foundry-gdd',
  'huff-n-puff-huff-n-more-puff',
  'wrath-of-olympus',
  'gates-of-olympus-1000',
  'starlight-travellers-clusterbuster',
];

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; failures.push({ name, err: e.message }); console.error(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('\n=== RENDER-INTEG-A · parser-fields → slot.html ===\n');

function loadPair(slug) {
  const dir = join(REAL_GAMES, slug);
  if (!existsSync(dir)) {
    /* Pick first available game dir as fallback so test stays alive even
     * after corpus reshuffles. */
    const all = readdirSync(REAL_GAMES).filter(d => existsSync(join(REAL_GAMES, d, 'model.json')) && existsSync(join(REAL_GAMES, d, 'slot.html')));
    if (all.length === 0) throw new Error('no real-games available');
    return loadPair(all[0]);
  }
  const model = JSON.parse(readFileSync(join(dir, 'model.json'), 'utf8'));
  const html = readFileSync(join(dir, 'slot.html'), 'utf8');
  return { slug, model, html };
}

function extractRuntimeConst(html, name) {
  /* Three emit forms supported (UQ-U-7 atom #12 introduced the `_def`
   * tamper-proof variant on 2026-06-25; older blocks still use direct
   * window assignment):
   *   1. `_def('__NAME__', <json>);`            ← gddRuntimeMeta block
   *   2. `_def("__NAME__", <json>);`            ← double-quote variant
   *   3. `window.__NAME__ = <json>;`            ← legacy direct assign
   * The `[\\s\\S]*?` body is non-greedy and stops at the first matching
   * `);` (form 1/2) or `;` (form 3) so adjacent assignments don't bleed. */
  const escName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const defReSingle = new RegExp(`_def\\(\\s*'${escName}'\\s*,\\s*([\\s\\S]*?)\\s*\\);`, 'm');
  const defReDouble = new RegExp(`_def\\(\\s*"${escName}"\\s*,\\s*([\\s\\S]*?)\\s*\\);`, 'm');
  const winRe = new RegExp(`window\\.${escName}\\s*=\\s*([\\s\\S]*?);`, 'm');
  for (const re of [defReSingle, defReDouble, winRe]) {
    const m = html.match(re);
    if (m) {
      try { return JSON.parse(m[1]); } catch (_) { return undefined; }
    }
  }
  return undefined;
}

function extractConstAssign(html, ident) {
  const re = new RegExp(`\\bconst\\s+${ident}\\s*=\\s*([\\s\\S]*?);`, 'm');
  const m = html.match(re);
  if (m) {
    try { return JSON.parse(m[1]); } catch (_) { return m[1].trim(); }
  }
  return undefined;
}

/* ─── per-baseline checks ────────────────────────────────────────────────── */

for (const slug of BASELINES) {
  let pair;
  try { pair = loadPair(slug); }
  catch (_) {
    test(`${slug} · loadable`, () => { throw new Error('skip: not built'); });
    continue;
  }
  const { model, html } = pair;

  test(`${slug} · __GDD_META_VERSION__ emitted`, () => {
    const v = extractRuntimeConst(html, '__GDD_META_VERSION__');
    assert(v === '1', `expected meta version '1', got ${JSON.stringify(v)}`);
  });

  test(`${slug} · compliance → __GDD_COMPLIANCE__ parity`, () => {
    const declared = model.compliance;
    const emitted = extractRuntimeConst(html, '__GDD_COMPLIANCE__');
    if (!Array.isArray(declared) || declared.length === 0) {
      assert(emitted === null || emitted === undefined, `compliance absent in model but emitted: ${JSON.stringify(emitted)}`);
      return;
    }
    assert(Array.isArray(emitted), `expected compliance array, got ${JSON.stringify(emitted)}`);
    assert(emitted.length === declared.length, `length mismatch: model ${declared.length} vs emitted ${emitted.length}`);
    for (let i = 0; i < declared.length; i++) {
      const dCode = typeof declared[i] === 'string' ? declared[i] : declared[i]?.code;
      assert(emitted[i]?.code === dCode, `compliance[${i}].code mismatch: ${dCode} vs ${emitted[i]?.code}`);
    }
  });

  test(`${slug} · rtpBreakdown → __GDD_RTP_BREAKDOWN__ parity`, () => {
    const declared = model?.payback?.rtpBreakdown;
    const emitted = extractRuntimeConst(html, '__GDD_RTP_BREAKDOWN__');
    if (!declared || typeof declared !== 'object') {
      assert(emitted === null || emitted === undefined, `rtpBreakdown absent in model but emitted: ${JSON.stringify(emitted)}`);
      return;
    }
    assert(emitted && typeof emitted === 'object', `expected rtpBreakdown object, got ${JSON.stringify(emitted)}`);
    for (const key of ['baseLine', 'hwBase', 'fsLine', 'hwFs']) {
      if (Number.isFinite(declared[key])) {
        assert(Math.abs(emitted[key] - declared[key]) < 0.001, `rtpBreakdown.${key} mismatch: ${declared[key]} vs ${emitted[key]}`);
      }
    }
  });

  test(`${slug} · scatter.payTable → __GDD_SCATTER_PAY_TABLE__ parity`, () => {
    const declared = model?.scatter?.payTable;
    const emitted = extractRuntimeConst(html, '__GDD_SCATTER_PAY_TABLE__');
    if (!declared || typeof declared !== 'object') {
      assert(emitted === null || emitted === undefined, `scatter payTable absent in model but emitted: ${JSON.stringify(emitted)}`);
      return;
    }
    assert(emitted && typeof emitted === 'object', `expected scatter payTable object, got ${JSON.stringify(emitted)}`);
    for (const [k, v] of Object.entries(declared)) {
      assert(Number(emitted[k]) === Number(v), `payTable[${k}] mismatch: ${v} vs ${emitted[k]}`);
    }
  });

  test(`${slug} · expandingWild.onlyIfWinning → __GDD_EXPANDING_WILD_ONLY_IF_WINNING__ parity`, () => {
    const declared = model?.expandingWild?.onlyIfWinning;
    const emitted = extractRuntimeConst(html, '__GDD_EXPANDING_WILD_ONLY_IF_WINNING__');
    if (typeof declared !== 'boolean') {
      assert(emitted === null || emitted === false || emitted === undefined,
        `onlyIfWinning absent in model but emitted truthy: ${JSON.stringify(emitted)}`);
      return;
    }
    assert(emitted === declared, `onlyIfWinning mismatch: ${declared} vs ${emitted}`);
  });

  test(`${slug} · EXPANDING_WILD_ONLY_IF_WINNING wired in runtime (when expanding wild active)`, () => {
    const hasExpandingWild = model?.expandingWild?.enabled === true
      || (Array.isArray(model?.features) && model.features.some(f => f.kind === 'expanding_wild'));
    if (!hasExpandingWild) return; /* block disabled — nothing to wire */
    const ewConst = extractConstAssign(html, 'EXPANDING_WILD_ONLY_IF_WINNING');
    assert(ewConst === true || ewConst === false,
      `EXPANDING_WILD_ONLY_IF_WINNING not emitted in expandingWild runtime block`);
    if (typeof model?.expandingWild?.onlyIfWinning === 'boolean') {
      assert(ewConst === model.expandingWild.onlyIfWinning,
        `runtime const ${ewConst} != model ${model.expandingWild.onlyIfWinning}`);
    }
  });
}

console.log(`\nResult: ${passed} passed · ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:');
  for (const f of failures) console.error(`  ${f.name}\n    ${f.err}`);
  process.exit(1);
}
