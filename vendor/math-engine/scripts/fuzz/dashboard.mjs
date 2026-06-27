#!/usr/bin/env node
/**
 * W215 Faza 600.4 — Fuzz dashboard.
 *
 * Aggregates the most recent N discovery runs into a trend dashboard.
 *
 *   reports/fuzz/FUZZ_DASHBOARD.json
 *   reports/fuzz/FUZZ_DASHBOARD.md
 *   reports/fuzz/FUZZ_DASHBOARD.html  (zero-dep, inline SVG sparklines)
 *
 * Tracks per-week:
 *   - total iterations
 *   - unique crashes
 *   - branch coverage (sum across harnesses)
 *   - per-harness crash counts (for hot-spot identification)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const DISCOVERY_DIR = join(ROOT, 'reports', 'fuzz', 'discovery');
const REPORT_DIR = join(ROOT, 'reports', 'fuzz');

export function loadRuns(maxWeeks = 4) {
  if (!existsSync(DISCOVERY_DIR)) return [];
  const subs = readdirSync(DISCOVERY_DIR)
    .filter((d) => existsSync(join(DISCOVERY_DIR, d, 'summary.json')))
    .sort()
    .slice(-maxWeeks);
  return subs.map((s) => {
    try {
      const summary = JSON.parse(readFileSync(join(DISCOVERY_DIR, s, 'summary.json'), 'utf8'));
      return { dir: s, ...summary };
    } catch { return null; }
  }).filter(Boolean);
}

export function aggregate(runs) {
  const harnessIds = new Set();
  for (const r of runs) for (const h of r.harnesses ?? []) harnessIds.add(h.id);
  const ids = [...harnessIds].sort();
  return {
    runCount: runs.length,
    runs: runs.map((r) => ({
      at: r.at,
      mode: r.mode,
      totalIter: (r.harnesses ?? []).reduce((a, h) => a + (h.iterations || 0), 0),
      totalUniqueCrashes: r.totalUniqueCrashes ?? 0,
      totalBranches: r.totalBranches ?? 0,
    })),
    harnesses: ids.map((id) => ({
      id,
      crashHistory: runs.map((r) => {
        const h = (r.harnesses ?? []).find((x) => x.id === id);
        return h ? h.uniqueCrashes : 0;
      }),
      branchHistory: runs.map((r) => {
        const h = (r.harnesses ?? []).find((x) => x.id === id);
        return h ? h.branches : 0;
      }),
    })),
  };
}

function sparkline(values) {
  // Render an inline SVG of width 120, height 24.
  if (!values || values.length === 0) return '';
  const max = Math.max(1, ...values);
  const w = 120;
  const h = 24;
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 2) - 1).toFixed(1)}`).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><polyline fill="none" stroke="#2563eb" stroke-width="1.5" points="${pts}"/></svg>`;
}

export function renderMarkdown(agg) {
  const lines = [];
  lines.push(`# Fuzz Dashboard`);
  lines.push('');
  lines.push(`Aggregated last **${agg.runCount}** discovery runs.`);
  lines.push('');
  lines.push('## Run timeline');
  lines.push('');
  lines.push('| At | Mode | Total iter | Unique crashes | Branches |');
  lines.push('| --- | --- | ---: | ---: | ---: |');
  for (const r of agg.runs) {
    lines.push(`| ${r.at} | ${r.mode} | ${r.totalIter} | ${r.totalUniqueCrashes} | ${r.totalBranches} |`);
  }
  lines.push('');
  lines.push('## Per-harness crash history');
  lines.push('');
  lines.push('| Harness | Crashes per run | Branches per run |');
  lines.push('| --- | --- | --- |');
  for (const h of agg.harnesses) {
    lines.push(`| ${h.id} | ${h.crashHistory.join(', ')} | ${h.branchHistory.join(', ')} |`);
  }
  lines.push('');
  return lines.join('\n');
}

export function renderHtml(agg) {
  const rows = agg.harnesses.map((h) =>
    `<tr><td>${h.id}</td><td>${sparkline(h.crashHistory)}</td><td>${h.crashHistory.join(', ')}</td><td>${sparkline(h.branchHistory)}</td><td>${h.branchHistory.join(', ')}</td></tr>`
  ).join('\n');
  const runRows = agg.runs.map((r) =>
    `<tr><td>${r.at}</td><td>${r.mode}</td><td>${r.totalIter}</td><td>${r.totalUniqueCrashes}</td><td>${r.totalBranches}</td></tr>`
  ).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Fuzz Dashboard</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; padding: 24px; max-width: 1000px; margin: auto; color: #111827; }
  h1 { color: #1f2937; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 32px; }
  th, td { border: 1px solid #e5e7eb; padding: 8px 12px; text-align: left; font-size: 14px; }
  th { background: #f3f4f6; }
  svg { display: inline-block; vertical-align: middle; }
</style>
</head>
<body>
<h1>Fuzz Dashboard</h1>
<p>Aggregated last <strong>${agg.runCount}</strong> discovery runs.</p>
<h2>Run timeline</h2>
<table>
<thead><tr><th>At</th><th>Mode</th><th>Total iter</th><th>Unique crashes</th><th>Branches</th></tr></thead>
<tbody>
${runRows}
</tbody>
</table>
<h2>Per-harness crash & coverage history</h2>
<table>
<thead><tr><th>Harness</th><th>Crashes (spark)</th><th>Crashes (raw)</th><th>Branches (spark)</th><th>Branches (raw)</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</body>
</html>
`;
}

export function writeDashboard(maxWeeks = 4) {
  const runs = loadRuns(maxWeeks);
  const agg = aggregate(runs);
  if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(join(REPORT_DIR, 'FUZZ_DASHBOARD.json'), JSON.stringify(agg, null, 2));
  writeFileSync(join(REPORT_DIR, 'FUZZ_DASHBOARD.md'), renderMarkdown(agg));
  writeFileSync(join(REPORT_DIR, 'FUZZ_DASHBOARD.html'), renderHtml(agg));
  return agg;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const agg = writeDashboard();
  console.log(`Dashboard updated · ${agg.runCount} runs · ${agg.harnesses.length} harnesses`);
}
