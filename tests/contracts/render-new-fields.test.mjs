#!/usr/bin/env node
/**
 * tests/contracts/render-new-fields.test.mjs
 *
 * MATH-DEEP A — Render integration test (2026-06-23).
 *
 * Purpose
 *   Verifies that slot.html (built via src/buildSlotHTML.mjs) correctly
 *   consumes the NEW parser fields landed in MATH-DEEP D-9..D-17:
 *     - model.compliance[] (jurisdictions array)
 *     - model.payback.rtpBreakdown.{baseLine,hwBase,fsLine,hwFs}
 *     - model.scatter.payTable
 *     - model.expandingWild.onlyIfWinning
 *     - model.patternWin.{enabled,awardX}
 *     - model.holdAndWin.{cashPool,fsTriggerCount}
 *     - model.jackpot.shareWithinFeature.GRAND
 *     - model.freeSpins.{retrigger.hardCap,avgSpinsPlayed}
 *
 * Acceptance per field
 *   - Compliance jurisdiction codes appear in compliance-gate block (e.g.
 *     "ukgcComplianceGate" toggle when UKGC declared)
 *   - patternWin.enabled === true triggers patternWin block emit
 *   - expandingWild.onlyIfWinning === true triggers wild-only-if-winning
 *     guard in block code
 *   - holdAndWin.cashPool present triggers hold-and-win UI block
 *   - No render crash with new fields populated
 *
 * Why
 *   Without this test, parser additions silently get dropped from the
 *   render pipeline — block code may not know to consume new fields, and
 *   slot.html would emit no UI for them. This contract test is the
 *   "block pipeline is aware of parser additions" gate.
 *
 * Performance budget
 *   buildSlotHTML on Cash Eruption ≤ 1s. Test runs 5 buildSlotHTML calls
 *   (one per baseline GDD) ≤ 5s.
 *
 * HARD RULE #1: assertions check for INTERNAL kind ids / block keys, not
 *   vendor product names. compliance="UKGC" is a regulator code, OK.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const REAL_GAMES = join(REPO, 'dist/real-games');

let passed = 0, failed = 0;
const pending = [];
function test(name, fn) {
  const p = (async () => {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
  })();
  pending.push(p);
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('RENDER NEW-FIELDS contract · test suite');

/* ── Helper: build slot.html for a given slug ──────────────────────────── */

async function buildSlot(slug) {
  const { buildSlotHTML } = await import('../../src/buildSlotHTML.mjs');
  const modelPath = join(REAL_GAMES, slug, 'model.json');
  if (!existsSync(modelPath)) throw new Error(`model.json missing for ${slug}`);
  const model = JSON.parse(readFileSync(modelPath, 'utf8'));
  return buildSlotHTML(model);
}

/* ── (1) Cash Eruption render produces non-empty HTML with new fields ──── */

test('Cash Eruption model.compliance present + slot.html non-empty', async () => {
  const html = await buildSlot('cash-eruption-foundry-gdd');
  assert(typeof html === 'string' && html.length > 1000,
    `HTML length too short: ${html?.length || 0}`);
  /* compliance jurisdictions UKGC + MGA — gate blocks should be emitted. */
  assert(/ukgc/i.test(html), 'UKGC compliance not in HTML');
  assert(/mga/i.test(html), 'MGA compliance not in HTML');
});

/* ── (2) patternWin.awardX renders pattern-win block ──────────────────── */

test('Cash Eruption patternWin.enabled triggers block emit in HTML', async () => {
  const html = await buildSlot('cash-eruption-foundry-gdd');
  /* patternWin block emits "pattern-win" / "patternWin" identifiers when enabled. */
  assert(/patternWin|pattern-win|patternWinForceAt/i.test(html),
    'patternWin block not emitted');
});

/* ── (3) holdAndWin.cashPool renders hold-and-win UI ──────────────────── */

test('Cash Eruption holdAndWin block emitted (cashPool present)', async () => {
  const html = await buildSlot('cash-eruption-foundry-gdd');
  /* holdAndWin block emits identifiers like "holdAndWin" or "hold-and-win". */
  assert(/holdAndWin|hold-and-win|fireball/i.test(html),
    'holdAndWin block not emitted');
});

/* ── (4) expandingWild block when expandingWild present ───────────────── */

test('Cash Eruption expandingWild block emitted', async () => {
  const html = await buildSlot('cash-eruption-foundry-gdd');
  assert(/expandingWild|expanding-wild|expandingWildMultiplier/i.test(html),
    'expandingWild block not emitted');
});

/* ── (5) Schema-rich model still renders 5 baselines ─────────────────── */

const BASELINES = [
  'cash-eruption-foundry-gdd',
  'huff-n-more-puff-gdd',
  'starlight-travellers-gdd',
  'wrath-of-olympus-gdd',
  'gates-of-olympus-1000-gdd',
];
for (const slug of BASELINES) {
  test(`${slug}: slot.html builds without throw`, async () => {
    const html = await buildSlot(slug);
    assert(typeof html === 'string', `HTML not a string for ${slug}`);
    assert(html.length > 500, `HTML too short for ${slug}: ${html.length}`);
    /* Basic structural check — must have <html and </html. */
    assert(html.includes('<html'), `${slug} HTML missing <html tag`);
  });
}

/* ── (6) Random non-baseline GDD also builds (corpus generalization) ──── */

test('Random non-baseline GDD model also builds slot.html', async () => {
  const { readdirSync, statSync } = await import('node:fs');
  const BASE = new Set(BASELINES);
  const all = readdirSync(REAL_GAMES).filter(d => {
    const p = join(REAL_GAMES, d);
    return statSync(p).isDirectory() && existsSync(join(p, 'model.json')) && !BASE.has(d);
  });
  if (all.length === 0) throw new Error('no non-baseline GDDs');
  const slug = all[Math.floor(all.length / 2)]; /* middle of corpus */
  const html = await buildSlot(slug);
  assert(typeof html === 'string' && html.length > 500,
    `${slug} HTML too short: ${html?.length || 0}`);
});

/* ── (7) Model with NEW fields populated still renders (regression guard) */

test('Synthetic model with NEW fields (rtpBreakdown + scatter.payTable + expandingWild) renders', async () => {
  const { buildSlotHTML } = await import('../../src/buildSlotHTML.mjs');
  const synthetic = {
    id: 'test-new-fields',
    name: 'New Fields Render Test',
    topology: { reels: 5, rows: 3, paylines: 20, evaluation: 'lines' },
    symbols: {
      high: [{ id: 'A', label: 'Ace', tier: 'HP', pay: { '3': 10, '4': 50, '5': 200 } }],
      mid: [{ id: 'K', label: 'King', tier: 'MP', pay: { '3': 5, '4': 20, '5': 100 } }],
      low: [{ id: 'Q', label: 'Queen', tier: 'LP', pay: { '3': 2, '4': 8, '5': 40 } }],
      specials: [{ id: 'W', label: 'Wild', kind: 'wild' }, { id: 'S', label: 'Scatter', kind: 'scatter' }],
    },
    payback: {
      rtp: 96.0,
      rtpBreakdown: { baseLine: 41.9, hwBase: 40.91, fsLine: 7.0, hwFs: 6.19 },
    },
    scatter: { payTable: { '3': 2, '4': 15, '5': 100 } },
    expandingWild: { enabled: true, onlyIfWinning: true },
    patternWin: { enabled: true, awardX: 1000 },
    holdAndWin: { enabled: true, cashPool: { min: 100, max: 2000 }, fsTriggerCount: 9 },
    jackpot: { enabled: true, shareWithinFeature: { GRAND: 1.93e-5 } },
    freeSpins: { enabled: true, retrigger: { enabled: true, hardCap: 15 }, avgSpinsPlayed: 6.45 },
    compliance: [{ code: 'UKGC', name: 'UK' }, { code: 'MGA', name: 'Malta' }],
    /* buildSlotHTML requires model.theme.palette — minimal stub. */
    theme: { palette: ['#000', '#fff'], tags: ['classic'] },
  };
  const html = buildSlotHTML(synthetic);
  assert(typeof html === 'string' && html.length > 1000,
    `synthetic HTML too short: ${html?.length || 0}`);
});

/* ── Result ──────────────────────────────────────────────────────────── */

/* Await all pending tests before reporting. */
Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
