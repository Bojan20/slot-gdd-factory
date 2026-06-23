#!/usr/bin/env node
/**
 * tools/kernel-applicability-matrix.mjs
 *
 * Cross-game kernel applicability matrix.
 *
 * For N games × 22 kernels, emit a 2-D matrix showing which kernels
 * apply to which games (via topology + features dispatch), plus row
 * totals (kernels per game) and column totals (games per kernel).
 *
 * Why
 *   Operators want a single visual: "across our portfolio, which math
 *   kernels are touched and by how many games?" Helps prioritize
 *   kernel hardening, identify underused kernels, and spot games with
 *   abnormally low/high kernel coverage.
 *
 * USAGE
 *   node tools/kernel-applicability-matrix.mjs                # 5 baselines
 *   node tools/kernel-applicability-matrix.mjs --all          # all dist/real-games
 *   node tools/kernel-applicability-matrix.mjs --json         # emit JSON only
 *
 * OUTPUT
 *   stdout: ASCII matrix (games × kernels) + summary
 *   reports/kernel-applicability-matrix.json (always)
 *
 * EXIT
 *   0 — matrix built
 *   2 — missing dist/real-games
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { listKernels } from '../src/blocks/featureSimPlugins/kernelRegistry.mjs';
import { applicableKernels } from './per-game-kernel-coverage.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');
const REAL_GAMES = join(REPO, 'dist/real-games');
const OUT_DIR    = join(REPO, 'reports');

const BASELINE_SLUGS = [
  'cash-eruption-foundry-gdd',
  'huff-n-more-puff-gdd',
  'starlight-travellers-gdd',
  'wrath-of-olympus-gdd',
  'gates-of-olympus-1000-gdd',
];

const args = process.argv.slice(2);
const useAll  = args.includes('--all');
const jsonOnly = args.includes('--json');

/* ── Matrix builder ──────────────────────────────────────────────────── */

function buildMatrix(slugs) {
  const allKernels = listKernels().map(k => k.name);
  /* games[slug] = Set of applicable kernel names. */
  const games = {};
  const skipped = [];
  for (const slug of slugs) {
    const modelPath = join(REAL_GAMES, slug, 'model.json');
    if (!existsSync(modelPath)) {
      skipped.push(slug);
      continue;
    }
    try {
      const model = JSON.parse(readFileSync(modelPath, 'utf8'));
      const apps  = applicableKernels(model).map(k => k.name);
      games[slug] = new Set(apps);
    } catch (e) {
      skipped.push(`${slug} (parse error: ${e.message})`);
    }
  }
  /* Column totals: how many games each kernel applies to. */
  const colTotals = {};
  for (const k of allKernels) {
    colTotals[k] = 0;
    for (const slug of Object.keys(games)) {
      if (games[slug].has(k)) colTotals[k]++;
    }
  }
  /* Row totals: kernels per game. */
  const rowTotals = {};
  for (const slug of Object.keys(games)) {
    rowTotals[slug] = games[slug].size;
  }
  return { allKernels, games, colTotals, rowTotals, skipped };
}

/* ── ASCII renderer (compact, box-drawing) ───────────────────────────── */

function renderMatrix(m) {
  const slugs = Object.keys(m.games).sort();
  const kernels = m.allKernels.slice().sort();
  /* Truncate slug to 24 chars for table width sanity. */
  const slugCol = 26;
  const lines = [];
  /* Header. */
  lines.push(`Cross-game kernel applicability matrix (${slugs.length} games × ${kernels.length} kernels)`);
  lines.push('');
  /* Each kernel gets a 3-char column (number 1..22). Print legend. */
  lines.push('  Kernel index legend:');
  for (let i = 0; i < kernels.length; i++) {
    const usageBadge = m.colTotals[kernels[i]] === slugs.length
      ? 'ALL'
      : m.colTotals[kernels[i]] === 0
        ? '—'
        : `${m.colTotals[kernels[i]]}/${slugs.length}`;
    lines.push(`    ${(i + 1).toString().padStart(2)}. ${kernels[i].padEnd(28)} (${usageBadge})`);
  }
  lines.push('');
  /* Matrix header. */
  const idxHeader = kernels.map((_, i) => (i + 1).toString().padStart(2)).join(' ');
  lines.push('  ' + 'Game'.padEnd(slugCol) + ' │ ' + idxHeader + ' │ Total');
  lines.push('  ' + '─'.repeat(slugCol) + '─┼─' + '─'.repeat(idxHeader.length) + '─┼──────');
  /* Rows. */
  for (const slug of slugs) {
    const row = kernels.map(k => m.games[slug].has(k) ? ' ✓' : ' ·').join(' ');
    const total = m.rowTotals[slug].toString().padStart(3);
    const display = slug.length > slugCol ? slug.slice(0, slugCol - 1) + '…' : slug.padEnd(slugCol);
    lines.push(`  ${display} │ ${row} │ ${total}/${kernels.length}`);
  }
  /* Col totals footer. */
  lines.push('  ' + '─'.repeat(slugCol) + '─┼─' + '─'.repeat(idxHeader.length) + '─┼──────');
  const colTotalsRow = kernels.map(k => m.colTotals[k].toString().padStart(2)).join(' ');
  lines.push(`  ${'Σ games-per-kernel'.padEnd(slugCol)} │ ${colTotalsRow} │`);
  /* Summary. */
  lines.push('');
  const totalApplications = Object.values(m.rowTotals).reduce((s, v) => s + v, 0);
  const avgPerGame = slugs.length > 0
    ? (totalApplications / slugs.length).toFixed(2)
    : '0';
  const dormantKernels = kernels.filter(k => m.colTotals[k] === 0);
  const universalKernels = kernels.filter(k => m.colTotals[k] === slugs.length);
  lines.push(`  Total applications: ${totalApplications}`);
  lines.push(`  Avg kernels/game:   ${avgPerGame}`);
  lines.push(`  Universal kernels (every game): ${universalKernels.length} (${universalKernels.join(', ') || '—'})`);
  lines.push(`  Dormant kernels (0 games):       ${dormantKernels.length} (${dormantKernels.join(', ') || '—'})`);
  if (m.skipped.length > 0) {
    lines.push('');
    lines.push(`  Skipped: ${m.skipped.length}`);
    for (const s of m.skipped) lines.push(`    · ${s}`);
  }
  return lines.join('\n');
}

/* ── CLI ──────────────────────────────────────────────────────────────── */

if (process.argv[1]?.endsWith('kernel-applicability-matrix.mjs')) {
  if (!existsSync(REAL_GAMES)) {
    console.error(`▸ ${REAL_GAMES} missing — run parse-real-pdfs.mjs first`);
    process.exit(2);
  }
  let slugs;
  if (useAll) {
    slugs = readdirSync(REAL_GAMES).filter(d => {
      const p = join(REAL_GAMES, d, 'model.json');
      return existsSync(p);
    });
  } else {
    slugs = BASELINE_SLUGS;
  }
  const matrix = buildMatrix(slugs);
  if (!jsonOnly) {
    console.log(renderMatrix(matrix));
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const out = {
    generatedAt: new Date().toISOString(),
    tool: 'tools/kernel-applicability-matrix.mjs',
    gamesProbed: Object.keys(matrix.games).length,
    kernels: matrix.allKernels.length,
    skipped: matrix.skipped,
    perGame: Object.fromEntries(
      Object.entries(matrix.games).map(([slug, set]) => [slug, Array.from(set).sort()]),
    ),
    perKernelUsage: matrix.colTotals,
  };
  const outPath = join(OUT_DIR, 'kernel-applicability-matrix.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  if (jsonOnly) console.log(JSON.stringify(out, null, 2));
  else console.log(`\nReport: ${outPath}`);
  process.exit(0);
}

export { buildMatrix, renderMatrix };
