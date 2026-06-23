#!/usr/bin/env node
/**
 * tools/audit-summary.mjs
 *
 * ONE-COMMAND TOTAL AUDIT rollup. Programatski poziva sve postojeće
 * operator-facing audit alate (per-game-coverage + applicability-matrix
 * + portfolio-report + declared-vs-measured-audit) i agregira u jedan
 * ASCII rollup output.
 *
 * Why
 *   Operator/regulator hoće JEDNU komandu koja odgovara "kakvo je stanje
 *   celog slot-portfolija upravo sada?" — bez čitanja 4 separate JSON-a
 *   ili pokretanja 4 različitih tool-ova. Ovaj rollup je single-pane-of-
 *   glass production status view.
 *
 * USAGE
 *   node tools/audit-summary.mjs                 # default 5 baselines
 *   node tools/audit-summary.mjs --json          # JSON only
 *   node tools/audit-summary.mjs --strict        # exit 1 if any DIVERGED
 *
 * OUTPUT
 *   stdout: ASCII rollup (5 sections + verdict)
 *   reports/audit-summary.json
 *
 * EXIT
 *   0 — rollup produced
 *   1 — --strict + verdict !== CONVERGED
 *   2 — missing dependencies
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkGame } from './per-game-kernel-coverage.mjs';
import { buildMatrix } from './kernel-applicability-matrix.mjs';
import { buildPortfolio } from './portfolio-report.mjs';
import { buildAudit, findLatestReport } from './declared-vs-measured-audit.mjs';

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
const jsonOnly = args.includes('--json');
const strict   = args.includes('--strict');

/* ── Section builders ────────────────────────────────────────────────── */

async function buildSection_coverage(slugs) {
  const results = [];
  for (const slug of slugs) {
    const r = await walkGame(slug);
    results.push(r);
  }
  return {
    label: 'PER-GAME KERNEL COVERAGE',
    gamesWalked: results.length,
    gamesOk: results.filter(r => r.ok).length,
    totalKernelsApplicable: results.reduce((s, r) => s + (r.kernelsApplicable || 0), 0),
    totalKernelsOk: results.reduce((s, r) => s + (r.kernelsOk || 0), 0),
    perGame: results.map(r => ({
      slug: r.slug, ok: r.ok,
      topology: r.topology, declaredRTP: r.declaredRTP,
      kernelsApplicable: r.kernelsApplicable, kernelsOk: r.kernelsOk,
    })),
  };
}

function buildSection_matrix(slugs) {
  const m = buildMatrix(slugs);
  const kernels = m.allKernels;
  const universal = kernels.filter(k => m.colTotals[k] === Object.keys(m.games).length);
  const dormant = kernels.filter(k => m.colTotals[k] === 0);
  return {
    label: 'KERNEL APPLICABILITY MATRIX',
    games: Object.keys(m.games).length,
    kernels: kernels.length,
    universalKernels: universal,
    dormantKernels: dormant,
    totalApplications: Object.values(m.rowTotals).reduce((s, v) => s + v, 0),
  };
}

async function buildSection_portfolio(slugs) {
  const rows = await buildPortfolio(slugs);
  const okRows = rows.filter(r => r.ok);
  const declared = okRows.map(r => r.declaredRTP).filter(v => Number.isFinite(v));
  return {
    label: 'PORTFOLIO REPORT',
    games: rows.length,
    gamesOk: okRows.length,
    avgDeclaredRTP: declared.length > 0
      ? +(declared.reduce((s, v) => s + v, 0) / declared.length).toFixed(2)
      : null,
    totalAnalyticalSumXBet: +okRows.reduce((s, r) => s + (r.totalAnalyticalSumXBet || 0), 0).toFixed(4),
    topologies: okRows.reduce((acc, r) => {
      acc[r.topology] = (acc[r.topology] || 0) + 1;
      return acc;
    }, {}),
  };
}

function buildSection_verdict() {
  const latest = findLatestReport();
  if (!latest) {
    return { label: 'DECLARED-VS-MEASURED AUDIT', ok: false, error: 'no cross-game report' };
  }
  try {
    const payload = JSON.parse(readFileSync(latest.path, 'utf8'));
    const a = buildAudit(payload, latest.file);
    return {
      label: 'DECLARED-VS-MEASURED AUDIT',
      ok: true,
      sourceReport: latest.file,
      portfolioVerdict: a.portfolioVerdict,
      verdictCounts: a.verdictCounts,
      rows: a.rows.map(r => ({
        slug: r.slug, verdict: r.verdict, rtpDelta: r.rtpDelta,
      })),
    };
  } catch (e) {
    return { label: 'DECLARED-VS-MEASURED AUDIT', ok: false, error: e.message };
  }
}

/* ── Aggregate ───────────────────────────────────────────────────────── */

async function buildAuditSummary(slugs = BASELINE_SLUGS) {
  const coverage  = await buildSection_coverage(slugs);
  const matrix    = buildSection_matrix(slugs);
  const portfolio = await buildSection_portfolio(slugs);
  const verdict   = buildSection_verdict();
  /* Overall PRODUCTION verdict: GREEN (all converged or non-binding +
   * 100% coverage ok), AMBER (close/unknown OR partial coverage), RED
   * (any DIVERGED). NON_BINDING games (synthetic-fallback declared) do
   * NOT escalate verdict — they're audit-only since PDF lacked RTP. */
  const overallVerdict = (() => {
    if (verdict.ok && verdict.portfolioVerdict === 'DIVERGED') return 'RED';
    if (coverage.gamesOk < coverage.gamesWalked) return 'AMBER';
    if (!verdict.ok) return 'AMBER';
    if (verdict.portfolioVerdict === 'CONVERGED') return 'GREEN';
    return 'AMBER';
  })();
  return {
    generatedAt: new Date().toISOString(),
    tool: 'tools/audit-summary.mjs',
    slugs,
    overallVerdict,
    sections: { coverage, matrix, portfolio, verdict },
  };
}

/* ── ASCII renderer ──────────────────────────────────────────────────── */

const VERDICT_BADGE = { GREEN: '🟢', AMBER: '🟡', RED: '🔴' };

function renderAuditSummary(summary) {
  const lines = [];
  const s = summary.sections;
  lines.push(`════════════════════════════════════════════════════════════════════`);
  lines.push(`  SLOT-GDD-FACTORY · TOTAL AUDIT ROLLUP`);
  lines.push(`  generated: ${summary.generatedAt}`);
  lines.push(`  overall verdict: ${VERDICT_BADGE[summary.overallVerdict] || '?'} ${summary.overallVerdict}`);
  lines.push(`════════════════════════════════════════════════════════════════════`);
  /* Section 1: coverage. */
  lines.push('');
  lines.push(`  [1] ${s.coverage.label}`);
  lines.push(`      games walked:       ${s.coverage.gamesWalked} (${s.coverage.gamesOk} ok)`);
  lines.push(`      kernels applic.:    ${s.coverage.totalKernelsApplicable}`);
  lines.push(`      kernels ok:         ${s.coverage.totalKernelsOk}` +
             ` (${s.coverage.totalKernelsApplicable > 0
                  ? ((s.coverage.totalKernelsOk / s.coverage.totalKernelsApplicable) * 100).toFixed(1)
                  : '0'}%)`);
  /* Section 2: matrix. */
  lines.push('');
  lines.push(`  [2] ${s.matrix.label}`);
  lines.push(`      games × kernels:    ${s.matrix.games} × ${s.matrix.kernels}`);
  lines.push(`      total applications: ${s.matrix.totalApplications}`);
  lines.push(`      universal kernels:  ${s.matrix.universalKernels.length}` +
             ` (${s.matrix.universalKernels.slice(0, 3).join(', ')}${s.matrix.universalKernels.length > 3 ? ', …' : ''})`);
  lines.push(`      dormant kernels:    ${s.matrix.dormantKernels.length}` +
             ` (${s.matrix.dormantKernels.join(', ') || '—'})`);
  /* Section 3: portfolio. */
  lines.push('');
  lines.push(`  [3] ${s.portfolio.label}`);
  lines.push(`      games:              ${s.portfolio.games} (${s.portfolio.gamesOk} ok)`);
  lines.push(`      avg declared RTP:   ${s.portfolio.avgDeclaredRTP ?? '—'}%`);
  lines.push(`      Σ analytical:       ${s.portfolio.totalAnalyticalSumXBet}× bet`);
  const topoLine = Object.entries(s.portfolio.topologies)
    .sort((a, b) => b[1] - a[1])
    .map(([t, c]) => `${t}=${c}`)
    .join(', ');
  lines.push(`      topology mix:       ${topoLine}`);
  /* Section 4: verdict. */
  lines.push('');
  lines.push(`  [4] ${s.verdict.label}`);
  if (!s.verdict.ok) {
    lines.push(`      status: ERROR — ${s.verdict.error}`);
  } else {
    lines.push(`      portfolio verdict:  ${s.verdict.portfolioVerdict}`);
    lines.push(`      converged / total:  ${s.verdict.verdictCounts.CONVERGED} / ${s.verdict.rows.length}`);
    if (s.verdict.verdictCounts.CLOSE > 0)    lines.push(`      close:              ${s.verdict.verdictCounts.CLOSE}`);
    if (s.verdict.verdictCounts.DIVERGED > 0) lines.push(`      diverged:           ${s.verdict.verdictCounts.DIVERGED}`);
    if (s.verdict.verdictCounts.UNKNOWN > 0)  lines.push(`      unknown:            ${s.verdict.verdictCounts.UNKNOWN}`);
    lines.push(`      source report:      ${s.verdict.sourceReport}`);
  }
  lines.push('');
  lines.push(`════════════════════════════════════════════════════════════════════`);
  return lines.join('\n');
}

/* ── CLI ──────────────────────────────────────────────────────────────── */

if (process.argv[1]?.endsWith('audit-summary.mjs')) {
  if (!existsSync(REAL_GAMES)) {
    console.error(`▸ ${REAL_GAMES} missing — run parse-real-pdfs.mjs first`);
    process.exit(2);
  }
  const summary = await buildAuditSummary(BASELINE_SLUGS);
  if (!jsonOnly) {
    console.log(renderAuditSummary(summary));
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, 'audit-summary.json');
  writeFileSync(outPath, JSON.stringify(summary, null, 2));
  if (jsonOnly) console.log(JSON.stringify(summary, null, 2));
  else console.log(`\nReport: ${outPath}`);
  if (strict && summary.overallVerdict !== 'GREEN') {
    console.error(`▸ STRICT FAIL: overall verdict = ${summary.overallVerdict}`);
    process.exit(1);
  }
  process.exit(0);
}

export { buildAuditSummary, renderAuditSummary };
