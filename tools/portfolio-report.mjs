#!/usr/bin/env node
/**
 * tools/portfolio-report.mjs
 *
 * Operator dashboard — single-view portfolio status across all baseline
 * games. Aggregates per-game kernel coverage + applicability matrix +
 * declared RTP + topology into one ASCII table.
 *
 * Why
 *   Operators want ONE command that answers: "what does our slot
 *   portfolio look like right now?" — declared RTP per game, topology,
 *   kernel coverage stats, top RTP-contributing kernels, anomalies.
 *   Faster than reading 5 separate JSON reports + matrix file.
 *
 * USAGE
 *   node tools/portfolio-report.mjs                 # 5 baselines
 *   node tools/portfolio-report.mjs --all           # all dist/real-games
 *   node tools/portfolio-report.mjs --json          # JSON only
 *   node tools/portfolio-report.mjs --refresh       # regenerate coverage first
 *
 * OUTPUT
 *   stdout: ASCII portfolio table + summary
 *   reports/portfolio-report.json
 *
 * EXIT
 *   0 — report built
 *   2 — missing dist/real-games or no baselines found
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkGame } from './per-game-kernel-coverage.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');
const REAL_GAMES = join(REPO, 'dist/real-games');
const COVERAGE_DIR = join(REPO, 'reports/per-game-kernel-coverage');
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
const refresh = args.includes('--refresh');

/* ── Portfolio builder ───────────────────────────────────────────────── */

async function buildPortfolio(slugs) {
  const rows = [];
  for (const slug of slugs) {
    /* Try cached coverage first; fall back to live walk. */
    const cachedPath = join(COVERAGE_DIR, `${slug}.json`);
    let coverage;
    if (existsSync(cachedPath) && !refresh) {
      try {
        coverage = JSON.parse(readFileSync(cachedPath, 'utf8'));
      } catch { coverage = null; }
    }
    if (!coverage) {
      coverage = await walkGame(slug);
    }
    if (!coverage.ok) {
      rows.push({ slug, ok: false, error: coverage.error });
      continue;
    }
    /* Top 3 kernels by RTP contribution (forward-rtp + composite only). */
    const topKernels = (coverage.kernels || [])
      .filter(k => k.ok && Number.isFinite(k.rtpContribution) && k.rtpContribution > 0)
      .sort((a, b) => b.rtpContribution - a.rtpContribution)
      .slice(0, 3)
      .map(k => ({ name: k.name, rtp: +k.rtpContribution.toFixed(4) }));
    rows.push({
      slug,
      ok: true,
      topology: coverage.topology || 'unknown',
      declaredRTP: coverage.declaredRTP,
      kernelsOk: coverage.kernelsOk,
      kernelsApplicable: coverage.kernelsApplicable,
      totalAnalyticalSumXBet: coverage.totalAnalyticalSumXBet,
      topKernels,
    });
  }
  return rows;
}

/* ── ASCII renderer ──────────────────────────────────────────────────── */

function renderPortfolio(rows) {
  const lines = [];
  lines.push(`Slot-GDD-Factory portfolio report (${rows.length} games)`);
  lines.push('');
  /* Per-game ASCII table. */
  const slugCol = 28;
  lines.push('  ' + 'Game'.padEnd(slugCol) + ' │ ' + 'Topology'.padEnd(13) +
             ' │ Declared │ Kernels │ Σ analytical');
  lines.push('  ' + '─'.repeat(slugCol) + '─┼─' + '─'.repeat(13) +
             '─┼──────────┼─────────┼──────────────');
  for (const r of rows) {
    if (!r.ok) {
      lines.push(`  ${r.slug.padEnd(slugCol)} │ ${'ERROR'.padEnd(13)} │ ${r.error}`);
      continue;
    }
    const slug = r.slug.length > slugCol ? r.slug.slice(0, slugCol - 1) + '…' : r.slug.padEnd(slugCol);
    const topo = (r.topology || 'unknown').slice(0, 13).padEnd(13);
    const decl = (r.declaredRTP != null ? `${r.declaredRTP.toFixed(1)}%` : '—').padStart(8);
    const kern = `${r.kernelsOk}/${r.kernelsApplicable}`.padStart(7);
    const sum  = `${r.totalAnalyticalSumXBet.toFixed(4)}× bet`.padStart(13);
    lines.push(`  ${slug} │ ${topo} │ ${decl} │ ${kern} │ ${sum}`);
  }
  /* Top kernels per game (separate section for readability). */
  lines.push('');
  lines.push('  Top RTP-contributing kernels per game:');
  for (const r of rows) {
    if (!r.ok || r.topKernels.length === 0) continue;
    const tops = r.topKernels.map(k => `${k.name}=${k.rtp.toFixed(2)}×`).join(', ');
    lines.push(`    ${r.slug.padEnd(slugCol)}  ${tops}`);
  }
  /* Aggregate summary. */
  const okRows = rows.filter(r => r.ok);
  const totalKernelsOk = okRows.reduce((s, r) => s + r.kernelsOk, 0);
  const totalKernelsApplicable = okRows.reduce((s, r) => s + r.kernelsApplicable, 0);
  const totalAnalytical = okRows.reduce((s, r) => s + r.totalAnalyticalSumXBet, 0);
  const avgDeclared = (() => {
    const declared = okRows.map(r => r.declaredRTP).filter(v => Number.isFinite(v));
    return declared.length > 0
      ? (declared.reduce((s, v) => s + v, 0) / declared.length).toFixed(2)
      : '—';
  })();
  lines.push('');
  lines.push('  PORTFOLIO SUMMARY');
  lines.push(`    Games:                 ${rows.length} (${okRows.length} ok, ${rows.length - okRows.length} error)`);
  lines.push(`    Avg declared RTP:      ${avgDeclared}%`);
  lines.push(`    Kernels ok / applic.:  ${totalKernelsOk}/${totalKernelsApplicable}` +
             ` (${totalKernelsApplicable > 0 ? ((totalKernelsOk / totalKernelsApplicable) * 100).toFixed(1) : '0'}%)`);
  lines.push(`    Σ analytical (all):    ${totalAnalytical.toFixed(4)}× bet`);
  /* Topology distribution. */
  const topologies = {};
  for (const r of okRows) {
    const t = r.topology || 'unknown';
    topologies[t] = (topologies[t] || 0) + 1;
  }
  const topoLine = Object.entries(topologies)
    .sort((a, b) => b[1] - a[1])
    .map(([t, c]) => `${t}=${c}`)
    .join(', ');
  lines.push(`    Topology breakdown:    ${topoLine}`);
  return lines.join('\n');
}

/* ── CLI ──────────────────────────────────────────────────────────────── */

if (process.argv[1]?.endsWith('portfolio-report.mjs')) {
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
  if (slugs.length === 0) {
    console.error(`▸ no games found in ${REAL_GAMES}`);
    process.exit(2);
  }
  /* Refresh coverage cache if requested. */
  if (refresh) {
    console.error('Refreshing coverage cache via per-game-kernel-coverage.mjs…');
    spawnSync('node', [join(REPO, 'tools/per-game-kernel-coverage.mjs')], {
      stdio: 'inherit', cwd: REPO,
    });
  }
  const rows = await buildPortfolio(slugs);
  if (!jsonOnly) {
    console.log(renderPortfolio(rows));
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const out = {
    generatedAt: new Date().toISOString(),
    tool: 'tools/portfolio-report.mjs',
    rows,
  };
  const outPath = join(OUT_DIR, 'portfolio-report.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  if (jsonOnly) console.log(JSON.stringify(out, null, 2));
  else console.log(`\nReport: ${outPath}`);
  process.exit(0);
}

export { buildPortfolio, renderPortfolio };
