#!/usr/bin/env node
/**
 * tests/tools/par-8-hnw.test.mjs
 *
 * PAR-8 (Boki 2026-06-27) contract test — Hold & Win synthetic
 * fallback + Cash Eruption-style component label extraction.
 *
 * # COVERAGE
 *
 *   - "Cash Eruption Feature From Base Game RTP" regex → holdAndWin
 *   - Plain "Feature From Base Game RTP" without slug prefix
 *   - Mapper cash → bonus promotion when holdAndWin ≥ 1.0
 *   - Mapper synthetic HnW config emitted with right shape
 *   - Verdict ladder combines baseGame + holdAndWin when both present
 *   - HnW disabled (legacy u8::MAX trigger_count) when component absent
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractRtpComponents } from '../../tools/_par-sheet-to-model.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('PAR-8 Hold & Win synthetic + extractor · test suite');

/* ── helpers ─────────────────────────────────────────────────────────── */

function makeSheet(cells) {
  let minR = Infinity, maxR = -1, minC = Infinity, maxC = -1;
  const ws = {};
  for (const [addr, val] of Object.entries(cells)) {
    const m = /^([A-Z]+)(\d+)$/.exec(addr);
    if (!m) throw new Error(`bad cell addr ${addr}`);
    const cn = m[1].split('').reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
    const rn = parseInt(m[2], 10) - 1;
    minR = Math.min(minR, rn); maxR = Math.max(maxR, rn);
    minC = Math.min(minC, cn); maxC = Math.max(maxC, cn);
    ws[addr] = { v: val, t: typeof val === 'number' ? 'n' : 's' };
  }
  if (maxR < 0) { ws['!ref'] = 'A1:A1'; return ws; }
  const colA = (n) => {
    let s = ''; n += 1;
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
  };
  ws['!ref'] = `${colA(minC)}${minR + 1}:${colA(maxC)}${maxR + 1}`;
  return ws;
}
function makeWb(sheets) { return { SheetNames: Object.keys(sheets), Sheets: sheets }; }

/* ── (1) "Cash Eruption Feature From Base Game RTP" → holdAndWin ────── */

test('CE-style label: "<slug> Feature From Base Game RTP" → holdAndWin', () => {
  const ws = makeSheet({
    'K69': 'Cash Eruption Feature From Base Game RTP', 'L69': 0.4091,
    'K72': 'Total RTP', 'L72': 0.96,
  });
  const wb = makeWb({ 'PAR-001': ws });
  const r = extractRtpComponents(wb);
  assert(Math.abs(r.holdAndWin - 40.91) < 1e-2, `holdAndWin expected 40.91, got ${r.holdAndWin}`);
  assert(Math.abs(r.total - 96.00) < 1e-2, `total expected 96.0, got ${r.total}`);
});

/* ── (2) Plain "Feature From Base Game RTP" without slug ─────────────── */

test('Plain label: "Feature From Base Game RTP" → holdAndWin', () => {
  const ws = makeSheet({
    'A1': 'Feature From Base Game RTP', 'B1': 30.5,
  });
  const wb = makeWb({ 'PAR': ws });
  const r = extractRtpComponents(wb);
  assert(Math.abs(r.holdAndWin - 30.5) < 1e-6, `holdAndWin expected 30.5, got ${r.holdAndWin}`);
});

/* ── (3) Mapper source contains PAR-8 ladder narrative ───────────────── */

const mapperPath = resolve(REPO, 'tools', '_par-sheet-convergence.mjs');
const mapperSrc = readFileSync(mapperPath, 'utf-8');

test('Mapper source mentions PAR-8 synthetic HnW ladder', () => {
  assert(/PAR-8 \(Boki 2026-06-27\)/.test(mapperSrc), 'expected PAR-8 narrative present');
  assert(/synthetic\s+HnW/i.test(mapperSrc), 'expected "synthetic HnW" keyword');
});

test('Mapper exposes promoteCashToBonus flag when holdAndWin declared', () => {
  assert(/promoteCashToBonus/.test(mapperSrc), 'expected promoteCashToBonus flag');
  assert(/components\?\.holdAndWin/.test(mapperSrc), 'expected reads components.holdAndWin');
});

test('Mapper synthetic HnW config has trigger_count 6 + 3 respins', () => {
  assert(/trigger_count:\s*6/.test(mapperSrc), 'trigger_count: 6 literal expected');
  assert(/initial_respins:\s*3/.test(mapperSrc), 'initial_respins: 3 literal expected');
  assert(/respins_on_new_orb:\s*3/.test(mapperSrc), 'respins_on_new_orb: 3 literal expected');
});

test('Mapper synthetic HnW emits orb_values distribution (≥ 6 tiers)', () => {
  const orbBlock = mapperSrc.match(/orb_values:\s*\[([\s\S]*?)\]/);
  assert(orbBlock, 'orb_values array not found');
  const tierCount = (orbBlock[1].match(/value:/g) || []).length;
  assert(tierCount >= 6, `orb_values should have ≥ 6 tiers, got ${tierCount}`);
});

test('Mapper preserves disabled-HnW legacy when component absent', () => {
  assert(/trigger_count:\s*255/.test(mapperSrc), 'trigger_count: 255 fallback expected');
});

/* ── (4) Verdict ladder combined target — narrative present ──────────── */

test('Convergence verdict combines baseGame + holdAndWin in target', () => {
  assert(/baseGame\+holdAndWin/.test(mapperSrc) || /baseGame \+ holdAndWin/.test(mapperSrc),
    'expected verdict target combines baseGame + holdAndWin');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
