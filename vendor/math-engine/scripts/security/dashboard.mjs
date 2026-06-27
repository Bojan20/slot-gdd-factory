#!/usr/bin/env node
/**
 * W214 Faza 600.3 — Security regression dashboard.
 *
 * Aggregates the last 30 days of daily audit results (`audit.json`
 * snapshots stored in `reports/security/history/`) and renders three
 * outputs:
 *
 *   - reports/security/SECURITY_DASHBOARD.json — raw data
 *   - reports/security/SECURITY_DASHBOARD.md   — text summary
 *   - reports/security/SECURITY_DASHBOARD.html — SVG line charts
 *
 * Identifies regressions: any audit category that flipped PASS → WARN
 * (or worse) in the last 7 days.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const HISTORY_DIR = join(ROOT, 'reports', 'security', 'history');
const OUT_DIR = join(ROOT, 'reports', 'security');

export const WINDOW_DAYS = 30;
export const REGRESSION_WINDOW_DAYS = 7;
const RANK = { pass: 0, warn: 1, fail: 2 };

/**
 * Read every snapshot in `reports/security/history/`. Each snapshot
 * is a JSON object shaped like the `audit.json` output:
 *   { takenAt, categories: [ { id, verdict, summary } ] }
 */
export function loadHistory(dir = HISTORY_DIR) {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const snapshots = [];
  for (const f of files) {
    try {
      const raw = readFileSync(join(dir, f), 'utf8');
      const j = JSON.parse(raw);
      if (j && Array.isArray(j.categories)) snapshots.push({ file: f, ...j });
    } catch {
      /* skip malformed snapshot */
    }
  }
  return snapshots;
}

export function windowSnapshots(snapshots, windowDays = WINDOW_DAYS, now = Date.now()) {
  const cutoff = now - windowDays * 24 * 60 * 60 * 1000;
  return snapshots.filter((s) => {
    const t = Date.parse(s.takenAt ?? '');
    return Number.isFinite(t) && t >= cutoff;
  });
}

export function summariseCategories(snapshots) {
  const byCategory = new Map();
  for (const s of snapshots) {
    for (const c of s.categories ?? []) {
      const arr = byCategory.get(c.id) ?? [];
      arr.push({ takenAt: s.takenAt, verdict: c.verdict, summary: c.summary });
      byCategory.set(c.id, arr);
    }
  }
  return byCategory;
}

export function detectRegressions(snapshots, windowDays = REGRESSION_WINDOW_DAYS, now = Date.now()) {
  const recent = windowSnapshots(snapshots, windowDays, now);
  if (recent.length < 2) return [];
  const byCat = summariseCategories(recent);
  const regressions = [];
  for (const [id, entries] of byCat) {
    if (entries.length < 2) continue;
    const first = entries[0];
    const last = entries[entries.length - 1];
    if (!first || !last) continue;
    const a = RANK[first.verdict] ?? 0;
    const b = RANK[last.verdict] ?? 0;
    if (b > a) {
      regressions.push({
        category: id,
        from: first.verdict,
        to: last.verdict,
        firstAt: first.takenAt,
        lastAt: last.takenAt,
      });
    }
  }
  return regressions;
}

export function trendCounts(snapshots) {
  // Returns one entry per snapshot: { takenAt, pass, warn, fail }.
  return snapshots.map((s) => {
    const counts = { pass: 0, warn: 0, fail: 0 };
    for (const c of s.categories ?? []) {
      if (c.verdict in counts) counts[c.verdict]++;
    }
    return { takenAt: s.takenAt, ...counts };
  });
}

export function buildDashboard(snapshots, now = Date.now()) {
  const inWindow = windowSnapshots(snapshots, WINDOW_DAYS, now);
  const trend = trendCounts(inWindow);
  const regressions = detectRegressions(snapshots, REGRESSION_WINDOW_DAYS, now);
  const last = inWindow.length > 0 ? inWindow[inWindow.length - 1] : null;
  return {
    generatedAt: new Date(now).toISOString(),
    windowDays: WINDOW_DAYS,
    snapshotsInWindow: inWindow.length,
    latest: last ? {
      takenAt: last.takenAt,
      categories: (last.categories ?? []).map((c) => ({ id: c.id, verdict: c.verdict })),
    } : null,
    regressions,
    trend,
  };
}

export function renderMarkdown(dash) {
  const lines = [
    `# Security Dashboard`,
    '',
    `Generated: \`${dash.generatedAt}\``,
    `Window: last ${dash.windowDays} days, ${dash.snapshotsInWindow} snapshots.`,
    '',
    '## Latest snapshot',
    '',
  ];
  if (dash.latest) {
    lines.push(`Taken: \`${dash.latest.takenAt}\``);
    lines.push('');
    lines.push('| Category | Verdict |');
    lines.push('|---|---|');
    for (const c of dash.latest.categories) {
      lines.push(`| ${c.id} | **${c.verdict.toUpperCase()}** |`);
    }
  } else {
    lines.push('_(no snapshots in window)_');
  }
  lines.push('');
  lines.push(`## Regressions (last ${REGRESSION_WINDOW_DAYS} days)`);
  lines.push('');
  if (dash.regressions.length === 0) {
    lines.push('_(none)_');
  } else {
    for (const r of dash.regressions) {
      lines.push(`- **${r.category}**: ${r.from} → ${r.to} (${r.firstAt} → ${r.lastAt})`);
    }
  }
  lines.push('');
  lines.push('## Trend (pass / warn / fail counts)');
  lines.push('');
  lines.push('| Taken | PASS | WARN | FAIL |');
  lines.push('|---|---:|---:|---:|');
  for (const t of dash.trend) {
    lines.push(`| ${t.takenAt} | ${t.pass} | ${t.warn} | ${t.fail} |`);
  }
  lines.push('');
  return lines.join('\n');
}

export function renderHtml(dash) {
  const pts = dash.trend;
  const width = 720;
  const height = 200;
  const pad = 36;
  const maxY = Math.max(1, ...pts.flatMap((p) => [p.pass, p.warn, p.fail]));
  function xy(i, v) {
    const x = pad + (i / Math.max(1, pts.length - 1)) * (width - 2 * pad);
    const y = height - pad - (v / maxY) * (height - 2 * pad);
    return [x.toFixed(1), y.toFixed(1)];
  }
  function polyline(key, color) {
    if (pts.length === 0) return '';
    const d = pts.map((p, i) => xy(i, p[key]).join(',')).join(' ');
    return `<polyline fill="none" stroke="${color}" stroke-width="2" points="${d}"/>`;
  }
  const regs = dash.regressions
    .map((r) => `<li><b>${r.category}</b>: ${r.from} → ${r.to}</li>`).join('') || '<li>(none)</li>';
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Security Dashboard</title>
<style>
  body { font: 14px -apple-system, system-ui, sans-serif; max-width: 880px; margin: 2em auto; color:#222; }
  h1, h2 { color:#0d62b0; }
  .legend span { display:inline-block; padding:2px 8px; margin-right:6px; border-radius:3px; color:#fff; }
  .legend .pass { background:#0a8c2c; } .legend .warn { background:#d18b00; } .legend .fail { background:#cc2222; }
  svg { background:#fafafa; border:1px solid #ddd; }
  table { border-collapse: collapse; font-size:12px; }
  td, th { border:1px solid #ccc; padding:3px 7px; }
</style></head>
<body>
<h1>Security Dashboard</h1>
<p>Generated: <code>${dash.generatedAt}</code> · ${dash.snapshotsInWindow} snapshots over last ${dash.windowDays} days.</p>
<h2>Trend (pass/warn/fail count over time)</h2>
<div class="legend"><span class="pass">PASS</span><span class="warn">WARN</span><span class="fail">FAIL</span></div>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect x="0" y="0" width="${width}" height="${height}" fill="#fff"/>
  <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="#999"/>
  <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" stroke="#999"/>
  ${polyline('pass', '#0a8c2c')}
  ${polyline('warn', '#d18b00')}
  ${polyline('fail', '#cc2222')}
</svg>
<h2>Regressions (last ${REGRESSION_WINDOW_DAYS}d)</h2>
<ul>${regs}</ul>
</body></html>`;
}

export function writeArtifacts(dash, outDir = OUT_DIR) {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'SECURITY_DASHBOARD.json'), JSON.stringify(dash, null, 2));
  writeFileSync(join(outDir, 'SECURITY_DASHBOARD.md'), renderMarkdown(dash));
  writeFileSync(join(outDir, 'SECURITY_DASHBOARD.html'), renderHtml(dash));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const snaps = loadHistory();
  const dash = buildDashboard(snaps);
  writeArtifacts(dash);
  console.log(`dashboard written: ${dash.snapshotsInWindow} snapshots, ${dash.regressions.length} regressions`);
}
