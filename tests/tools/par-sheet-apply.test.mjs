#!/usr/bin/env node
/**
 * tests/tools/par-sheet-apply.test.mjs
 *
 * MATH-PRECISION-4 — par-sheet-apply node tool self-test.
 *
 * Asertuje:
 *   1. Tool runs and writes model.reelStrips.par_sheet_weights
 *   2. 5 reel keys (reel0..reel4) present, each sa per-symbol weights
 *   3. Paytable struct present with at least Red7/Bell/Blue7 (Cash Eruption industry-ref)
 *   4. Source metadata (xlsx path + SWID + sheet) recorded
 *   5. Determinism: re-apply = identical model
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const TOOL = join(REPO, 'tools/par-sheet-apply.mjs');
const INGEST = join(REPO, 'reports/par-sheet-ingested/cash-eruption-foundry-gdd.json');
const MODEL = join(REPO, 'dist/real-games/cash-eruption-foundry-gdd/model.json');

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

try {
  /* Skip gracefully if ingest is not present — it requires xlsx + python3
   * which may not be available in CI. Local dev expectation: ingest is
   * baked when xlsx is present. */
  if (!existsSync(INGEST)) {
    console.log('⚠ par sheet ingest not present (skipping — needs python3 + openpyxl + xlsx)');
    process.exit(0);
  }

  /* Apply par sheet to model */
  const r = spawnSync('node', [TOOL, '--slug', 'cash-eruption-foundry-gdd'],
    { cwd: REPO, encoding: 'utf8' });
  assert(r.status === 0, `apply tool exit ${r.status}: ${r.stderr}`);

  const m = JSON.parse(readFileSync(MODEL, 'utf8'));
  const rs = m.reelStrips || {};

  /* (1) Per-reel weights */
  assert(rs.par_sheet_weights, `par_sheet_weights missing in model`);
  for (const rk of ['reel0', 'reel1', 'reel2', 'reel3', 'reel4']) {
    const w = rs.par_sheet_weights[rk];
    assert(w && typeof w === 'object', `${rk} missing in par_sheet_weights`);
    const symCount = Object.keys(w).length;
    assert(symCount >= 10, `${rk} expected ≥ 10 symbols, got ${symCount}`);
  }

  /* (2) Paytable */
  assert(rs.par_sheet_paytable, `par_sheet_paytable missing`);
  for (const sym of ['Red7', 'Bell', 'Blue7']) {
    assert(rs.par_sheet_paytable[sym], `paytable[${sym}] missing`);
    assert(rs.par_sheet_paytable[sym]['5'], `paytable[${sym}]['5'] (5OAK) missing`);
  }

  /* (3) Source metadata */
  assert(rs.par_sheet_source, `par_sheet_source metadata missing`);
  assert(rs.par_sheet_source.xlsx, `xlsx path missing in source`);
  assert(rs.par_sheet_source.swid, `swid missing in source`);
  assert(rs.par_sheet_source.sheet === 'PAR-001',
    `sheet expected PAR-001, got ${rs.par_sheet_source.sheet}`);

  /* (4) Symbols list present */
  assert(Array.isArray(rs.par_sheet_symbols) && rs.par_sheet_symbols.length >= 10,
    `par_sheet_symbols list missing or too short`);
  for (const expectedSym of ['Wild', 'Red7', 'Volcano', 'Fireball']) {
    assert(rs.par_sheet_symbols.includes(expectedSym),
      `expected symbol ${expectedSym} not in par_sheet_symbols`);
  }

  /* (5) Determinism */
  const r2 = spawnSync('node', [TOOL, '--slug', 'cash-eruption-foundry-gdd'],
    { cwd: REPO, encoding: 'utf8' });
  assert(r2.status === 0);
  const m2 = JSON.parse(readFileSync(MODEL, 'utf8'));
  assert(JSON.stringify(m2.reelStrips.par_sheet_weights)
       === JSON.stringify(m.reelStrips.par_sheet_weights),
    `non-deterministic weights`);

  console.log(`✓ par-sheet-apply.test.mjs — ${rs.par_sheet_symbols.length} symbols × 5 reels weights + paytable + SWID ${rs.par_sheet_source.swid}, deterministic`);
} catch (e) {
  console.error('✗ par-sheet-apply.test.mjs:', e.message);
  process.exit(1);
}
