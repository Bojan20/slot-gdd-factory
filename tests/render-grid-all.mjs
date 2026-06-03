#!/usr/bin/env node
/**
 * Render-all-grids QA harness.
 *
 * For every fixture in samples/grids/, this:
 *   1. Parses GDD → model via src/parser.mjs.
 *   2. Builds grid shape descriptor via src/gridShape.mjs.
 *   3. Asserts shape.kind matches the expected kind from the filename prefix.
 *   4. Validates structural invariants (column count, cell count, mask logic, etc).
 *   5. Generates a markdown report with PASS/FAIL per fixture.
 *
 * Exits non-zero on any failure. No browser, no math — pure structure tests.
 */

import { parseGDD } from '../src/parser.mjs';
import { buildGridShape } from '../src/gridShape.mjs';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const FIXTURE_DIR = resolve(REPO, 'samples/grids');
const REPORT_DIR = resolve(REPO, 'reports');

if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });

/* ─── Expected kind ← filename prefix ─────────────────────── */
const EXPECT = {
  '01_rectangular_5x3': 'rectangular',
  '02_rectangular_6x4': 'rectangular',
  '03_cluster_7x7':     'cluster',
  '04_variable_reel':   'variable_reel',
  '05_megaclusters':    'megaclusters',
  '06_hexagonal':       'hexagonal',
  '07_diamond':         'diamond',
  '08_pyramid':         'pyramid',
  '09_cross':           'cross',
  '10_lshape':          'l_shape',
  '11_radial':          'radial',
  '12_infinity':        'infinity',
  '13_expanding':       'expanding',
  '14_dual_colossal':   'dual',
  '15_slingo':          'slingo',
  '16_plinko':          'plinko',
  '17_crash':           'crash',
  '18_wheel':           'wheel',
  '19_lock_respin':     'lock_respin',
  '20_rectangular_stacked_scatter': 'rectangular',
};

/* ─── Per-kind structural invariants ──────────────────────── */
function invariantsForKind(shape, name, errors) {
  const k = shape.kind;
  const ASSERT = (cond, msg) => { if (!cond) errors.push(`[${name}] ${msg}`); };

  // Every kind: columns and cells defined, totalCells matches cell array length
  ASSERT(Array.isArray(shape.columns) && shape.columns.length > 0, `columns missing`);
  ASSERT(Array.isArray(shape.cells), `cells missing`);
  ASSERT(shape.totalCells === shape.cells.length, `totalCells (${shape.totalCells}) ≠ cells.length (${shape.cells.length})`);
  ASSERT(shape.shapeNote && typeof shape.shapeNote === 'string', `shapeNote missing`);

  switch (k) {
    case 'rectangular':
    case 'cluster':
    case 'lock_respin':
    case 'infinity':
    case 'expanding': {
      ASSERT(shape.totalCells === shape.reels * shape.rows,
        `expected ${shape.reels}×${shape.rows}=${shape.reels * shape.rows} cells, got ${shape.totalCells}`);
      ASSERT(shape.columns.length === shape.reels, `column count ${shape.columns.length} ≠ reels ${shape.reels}`);
      for (const col of shape.columns) ASSERT(col.rows === shape.rows, `column row count mismatch`);
      break;
    }
    case 'variable_reel':
    case 'diamond':
    case 'pyramid': {
      ASSERT(shape.columns.length === shape.reels, `variable cols ${shape.columns.length} ≠ reels ${shape.reels}`);
      const sum = shape.columns.reduce((s, c) => s + c.rows, 0);
      ASSERT(sum === shape.totalCells, `sum of column rows ${sum} ≠ totalCells ${shape.totalCells}`);
      const minR = Math.min(...shape.columns.map(c => c.rows));
      const maxR = Math.max(...shape.columns.map(c => c.rows));
      ASSERT(minR !== maxR, `expected variable rows, got uniform ${minR}`);
      break;
    }
    case 'cross':
    case 'l_shape': {
      ASSERT(shape.columns.every(c => c.mask && c.mask.length === shape.rows), `mask required for every column`);
      const enabledCells = shape.columns.reduce((s, c) => s + c.mask.filter(Boolean).length, 0);
      ASSERT(enabledCells === shape.totalCells, `mask-enabled count ${enabledCells} ≠ totalCells ${shape.totalCells}`);
      ASSERT(enabledCells < shape.reels * shape.rows, `masked grid should have fewer cells than rect ${shape.reels * shape.rows}`);
      break;
    }
    case 'hexagonal': {
      // hex cells must carry hex.q/hex.r
      ASSERT(shape.cells.every(c => c.hex && typeof c.hex.q === 'number' && typeof c.hex.r === 'number'),
        `hex cells missing q/r`);
      // ring 3 → 1+6+12+18 = 37 cells
      ASSERT(shape.totalCells === 37, `hex ring=3 should have 37 cells, got ${shape.totalCells}`);
      break;
    }
    case 'radial':
    case 'wheel': {
      ASSERT(shape.cells.length > 0, `wheel/radial empty`);
      ASSERT(shape.cells.length === shape.columns[0].rows, `cell count must match segment/spoke count`);
      break;
    }
    case 'plinko': {
      // row n has n+1 pegs
      for (let i = 0; i < shape.columns.length; i++) {
        ASSERT(shape.columns[i].rows === i + 1, `plinko row ${i} should have ${i+1} pegs, got ${shape.columns[i].rows}`);
      }
      // total = triangular number
      const n = shape.columns.length;
      ASSERT(shape.totalCells === n * (n + 1) / 2, `plinko total ${shape.totalCells} ≠ triangle ${n*(n+1)/2}`);
      break;
    }
    case 'crash': {
      ASSERT(shape.totalCells === 1, `crash should be 1-cell placeholder, got ${shape.totalCells}`);
      ASSERT(shape.cells[0].multiplier === true, `crash cell missing multiplier flag`);
      break;
    }
    case 'slingo': {
      ASSERT(shape.totalCells === 25, `slingo board should have 25 cells, got ${shape.totalCells}`);
      ASSERT(Array.isArray(shape.subgrids) && shape.subgrids.length === 1, `slingo missing strip subgrid`);
      ASSERT(shape.subgrids[0].totalCells === 5, `slingo strip should have 5 cells, got ${shape.subgrids[0].totalCells}`);
      break;
    }
    case 'megaclusters': {
      // base = min(reels, rows), squared
      const base = Math.min(shape.reels, shape.rows);
      ASSERT(shape.totalCells === base * base, `megaclusters base ${base}² = ${base*base}, got ${shape.totalCells}`);
      break;
    }
    case 'dual': {
      ASSERT(Array.isArray(shape.subgrids) && shape.subgrids.length >= 1, `dual missing secondary subgrid`);
      break;
    }
  }
}

/* ─── Per-fixture run ─────────────────────────────────────── */
const files = readdirSync(FIXTURE_DIR).filter(f => f.endsWith('.md')).sort();
const results = [];
const errors = [];
let allBatchErrors = 0;

for (const f of files) {
  const text = readFileSync(`${FIXTURE_DIR}/${f}`, 'utf-8');
  const t0 = performance.now();
  const model = parseGDD(text, 'md');
  const shape = buildGridShape(model);
  const t1 = performance.now();
  const prefix = f.replace(/_GAME_GDD\.md$/, '');
  const expected = EXPECT[prefix];
  const before = errors.length;

  if (!expected) {
    errors.push(`[${f}] no EXPECT entry for prefix=${prefix}`);
  } else if (shape.kind !== expected) {
    errors.push(`[${f}] expected kind=${expected}, got kind=${shape.kind}`);
  }
  invariantsForKind(shape, f, errors);

  const failed = errors.length - before;
  if (failed > 0) allBatchErrors += failed;
  results.push({
    file: f,
    name: model.name,
    expected,
    actual: shape.kind,
    reels: shape.reels,
    rows: shape.rows,
    totalCells: shape.totalCells,
    columns: shape.columns.length,
    subgrids: shape.subgrids ? shape.subgrids.length : 0,
    shapeNote: shape.shapeNote,
    confidence: model.confidence.topology,
    features: model.features.length,
    parseMs: (t1 - t0).toFixed(1),
    failed,
  });
}

/* ─── Markdown report ─────────────────────────────────────── */
const okCount = results.filter(r => r.failed === 0).length;
const failCount = results.length - okCount;
const passRate = ((okCount / results.length) * 100).toFixed(1);

const lines = [];
lines.push(`# Render-all-grids QA report`);
lines.push(``);
lines.push(`**Generated**: ${new Date().toISOString()}`);
lines.push(`**Fixtures**: ${results.length} · **PASS**: ${okCount} · **FAIL**: ${failCount} · **Rate**: ${passRate}%`);
lines.push(``);
lines.push(`## Summary table`);
lines.push(``);
lines.push(`| # | Fixture | Expected | Actual | R×R | Cells | Cols | Sub | Conf | Parse ms | Status |`);
lines.push(`|--:|---|---|---|---|--:|--:|--:|--:|--:|:--:|`);
results.forEach((r, i) => {
  const status = r.failed === 0 ? '✅' : `❌ ${r.failed}`;
  const match = r.expected === r.actual ? r.actual : `**${r.actual}** (≠ ${r.expected})`;
  lines.push(`| ${i + 1} | \`${r.file}\` | ${r.expected || '?'} | ${match} | ${r.reels}×${r.rows} | ${r.totalCells} | ${r.columns} | ${r.subgrids} | ${(r.confidence * 100).toFixed(0)}% | ${r.parseMs} | ${status} |`);
});
lines.push(``);
lines.push(`## Shape notes`);
lines.push(``);
lines.push(`| Fixture | shapeNote |`);
lines.push(`|---|---|`);
results.forEach(r => lines.push(`| \`${r.file}\` | ${r.shapeNote} |`));

if (errors.length > 0) {
  lines.push(``);
  lines.push(`## ❌ Errors (${errors.length})`);
  lines.push(``);
  for (const e of errors) lines.push(`- ${e}`);
}

const reportPath = `${REPORT_DIR}/grid-coverage-${Date.now()}.md`;
writeFileSync(reportPath, lines.join('\n'));
writeFileSync(`${REPORT_DIR}/grid-coverage-latest.md`, lines.join('\n'));

console.log(lines.join('\n'));
console.log(`\nReport saved: ${reportPath}`);

if (allBatchErrors > 0) {
  console.error(`\n❌ ${allBatchErrors} error(s) — see report above`);
  process.exit(1);
}
console.log(`\n✅ All ${results.length} fixtures pass`);
