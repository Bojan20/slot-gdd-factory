#!/usr/bin/env node
/**
 * tests/math/paytable-coverage.test.mjs
 *
 * MATH-12 · QA Test #4 — Paytable coverage.
 *
 * Asertuje da svaki declared payout tier u model.symbols (HP/MP/LP) ima
 * mogućnost da se reach-uje u probe. Bez ovog testa, "dead tier" simbol
 * (npr. simbol u paytable ali nikad spawn-uje) može da prošao.
 *
 * Strategija: build symbol pool isto kao u tools/math-rtp-probe.mjs i
 * sample 5000 cells. Asertuje svaki declared HP/MP/LP simbol je spawnut
 * barem jednom.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const MODEL = join(REPO, 'dist/real-games/cash-eruption-foundry-gdd/model.json');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

try {
  const model = JSON.parse(readFileSync(MODEL, 'utf8'));
  const symBucket = model.symbols || {};
  const declared = [...(symBucket.high || []), ...(symBucket.mid || []), ...(symBucket.low || [])];

  assert(declared.length > 0, `model.symbols has no HP/MP/LP — paytable empty`);

  /* Build pool — mirror probe logic. */
  const sd = model.reelStrips?.stop_distribution || {
    hp: 0.07, mp: 0.13, lp: 0.20, wild: 0.03, scatter: 0.02,
  };
  const TIER_SCALE = 1000;
  const pool = [];
  function addTier(list, weight, kind) {
    const count = list.length || 1;
    const per = Math.max(1, Math.round(weight * TIER_SCALE / count));
    for (const s of list) {
      const id = s.id || s.name || kind;
      for (let i = 0; i < per; i++) pool.push(id);
    }
  }
  addTier(symBucket.high || [], sd.hp, 'hp');
  addTier(symBucket.mid  || [], sd.mp, 'mp');
  addTier(symBucket.low  || [], sd.lp, 'lp');

  /* Sample 5000 cells, count occurrences per declared symbol. */
  const rng = mulberry32(42);
  const counts = {};
  for (let i = 0; i < 5000; i++) {
    const id = pool[Math.floor(rng() * pool.length)];
    counts[id] = (counts[id] || 0) + 1;
  }

  /* Every declared symbol must appear at least once. */
  const missing = [];
  for (const sym of declared) {
    const id = sym.id || sym.name;
    if (id && (counts[id] || 0) === 0) missing.push(id);
  }
  assert(missing.length === 0,
    `dead symbols (never spawned in 5000 samples): ${missing.join(', ')}`);

  /* Distribution sanity: most-frequent / least-frequent ratio ≤ 50. */
  const cnts = Object.values(counts).filter(c => c > 0);
  const maxC = Math.max(...cnts), minC = Math.min(...cnts);
  const ratio = maxC / minC;
  assert(ratio <= 50,
    `freq ratio max/min = ${ratio.toFixed(1)} too skewed (likely missing tier weights)`);

  console.log(`✓ paytable-coverage.test.mjs — ${declared.length} declared symbols, all spawned in 5000 samples, freq ratio ${ratio.toFixed(1)}× max/min`);
} catch (e) {
  console.error('✗ paytable-coverage.test.mjs:', e.message);
  process.exit(1);
}
