#!/usr/bin/env node
/**
 * tools/uq-dash-generate.mjs
 *
 * UQ-DASH (MASTER_TODO P1) — Telemetry dashboard generator.
 *
 * Reads three rolling-window series files and emits a single static
 * HTML dashboard (zero JS deps, inline SVG sparklines) showing:
 *
 *   • Agent calibration trainer accuracy per lane over time
 *   • Orchestrator E2E run-to-run agent value-add
 *   • UQ-COVER force coverage (missing + phantom counts)
 *
 * USAGE
 *   node tools/uq-dash-generate.mjs                    # writes dist/uq-dash/index.html
 *   node tools/uq-dash-generate.mjs --open             # + macOS open
 *
 * No external libs — everything inlined.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const OUT  = resolve(REPO, 'dist/uq-dash');
mkdirSync(OUT, { recursive: true });

const CALIB   = resolve(REPO, 'reports/calibration-history.json');
const E2E     = resolve(REPO, 'reports/orchestrator-e2e-series.json');
const COVER   = resolve(REPO, 'reports/uq-cover-series.json');

function load(path) {
  if (!existsSync(path)) return [];
  try {
    const j = JSON.parse(readFileSync(path, 'utf-8'));
    return Array.isArray(j) ? j : (j.runs || j.history || []);
  } catch { return []; }
}

const calib = load(CALIB);
const e2e   = load(E2E);
const cover = load(COVER);

/* Build SVG sparkline from numeric series. Output is a self-contained
 * <svg> string that scales to its CSS box. */
function spark(values, opts = {}) {
  const w = opts.w || 280;
  const h = opts.h || 60;
  const pad = 4;
  if (!values.length) return `<svg width="${w}" height="${h}"><text x="${w/2}" y="${h/2}" text-anchor="middle" fill="#666">no data</text></svg>`;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i / Math.max(1, values.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((v - min) / range) * (h - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `
<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${w}" height="${h}" fill="#0d1117"/>
  <polyline points="${pts}" stroke="#c9a227" stroke-width="2" fill="none"/>
  <text x="${w - pad}" y="${pad + 10}" text-anchor="end" fill="#888" font-size="10">${max.toFixed(2)}</text>
  <text x="${w - pad}" y="${h - pad}" text-anchor="end" fill="#888" font-size="10">${min.toFixed(2)}</text>
</svg>`;
}

/* Pull lane accuracy from calibration history. Each run row may have
 * `accuracyByLane: {V1, V2, V3, V4, V5}` or `lanes: [{name, accuracy}]`. */
function lanesSeries(runs, lane) {
  return runs.map(r => {
    /* Run shape supports both flat object (r.accuracyByLane) and nested
     * lanes map (r.lanes[V1] = { accuracy: 100, ... }) and the old array
     * variant (r.lanes = [{lane, accuracy}, ...]). */
    if (r.accuracyByLane && typeof r.accuracyByLane[lane] === 'number') {
      return r.accuracyByLane[lane];
    }
    if (r.lanes) {
      if (Array.isArray(r.lanes)) {
        const hit = r.lanes.find(l => (l.lane || l.name) === lane);
        if (hit && typeof hit.accuracy === 'number') return hit.accuracy;
      } else if (typeof r.lanes === 'object') {
        const slot = r.lanes[lane];
        if (slot && typeof slot.accuracy === 'number') return slot.accuracy;
      }
    }
    return null;
  }).filter(v => v !== null);
}

function e2eSeries(runs, key) {
  return runs.map(r => r[key]).filter(v => typeof v === 'number');
}

function coverSeries(runs, key) {
  return runs.map(r => r[key]).filter(v => typeof v === 'number');
}

const html = `<!doctype html>
<html lang="sr">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>UQ-DASH · slot-gdd-factory telemetry</title>
<style>
  :root { color-scheme: dark; }
  body { font: 13px/1.45 -apple-system, BlinkMacSystemFont, sans-serif; background: #05070c; color: #f0f0f0; margin: 0; padding: 20px; }
  h1 { font-size: 18px; margin: 0 0 6px; }
  h2 { font-size: 13px; color: #888; text-transform: uppercase; letter-spacing: .08em; margin: 24px 0 10px; }
  .meta { color: #888; font-size: 11px; margin-bottom: 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); gap: 16px; }
  .card { background: #0b0f16; border: 1px solid #1a2030; border-radius: 8px; padding: 14px; }
  .card h3 { margin: 0 0 8px; font-size: 13px; color: #c9a227; }
  .card .latest { font-size: 22px; font-weight: 600; }
  .card .latest small { font-size: 11px; color: #888; font-weight: 400; margin-left: 6px; }
  .card .runs { color: #666; font-size: 10px; margin-top: 4px; }
  svg { display: block; max-width: 100%; }
</style>
</head>
<body>
  <h1>UQ-DASH · slot-gdd-factory telemetry</h1>
  <div class="meta">Generated ${new Date().toISOString()} · ${calib.length} calibration runs · ${e2e.length} E2E runs · ${cover.length} UQ-COVER runs</div>

  <h2>Agent calibration trainer · accuracy per lane</h2>
  <div class="grid">
${['V1', 'V2', 'V3', 'V4', 'V5'].map(lane => {
  const series = lanesSeries(calib, lane);
  const latest = series[series.length - 1];
  return `    <div class="card">
      <h3>${lane}</h3>
      <div class="latest">${latest != null ? (latest * 100).toFixed(0) + '%' : '—'} <small>latest</small></div>
      ${spark(series.map(v => v * 100))}
      <div class="runs">${series.length} run(s)</div>
    </div>`;
}).join('\n')}
  </div>

  <h2>Orchestrator E2E · agent value-add</h2>
  <div class="grid">
    <div class="card">
      <h3>Avg V6 declared</h3>
      <div class="latest">${e2eSeries(e2e, 'avgV6Declared').slice(-1)[0]?.toFixed(1) || '—'} <small>fields</small></div>
      ${spark(e2eSeries(e2e, 'avgV6Declared'))}
      <div class="runs">${e2e.length} run(s)</div>
    </div>
    <div class="card">
      <h3>Avg parser declared</h3>
      <div class="latest">${e2eSeries(e2e, 'avgParserDeclared').slice(-1)[0]?.toFixed(1) || '—'} <small>fields</small></div>
      ${spark(e2eSeries(e2e, 'avgParserDeclared'))}
      <div class="runs">${e2e.length} run(s)</div>
    </div>
    <div class="card">
      <h3>HTML bytes produced</h3>
      <div class="latest">${(e2eSeries(e2e, 'htmlBytesKB').slice(-1)[0] || 0).toFixed(0)} <small>KB</small></div>
      ${spark(e2eSeries(e2e, 'htmlBytesKB'))}
      <div class="runs">${e2e.length} run(s)</div>
    </div>
  </div>

  <h2>UQ-COVER · force-coverage drift</h2>
  <div class="grid">
    <div class="card">
      <h3>Missing forces</h3>
      <div class="latest">${coverSeries(cover, 'missingCount').slice(-1)[0] ?? '—'}</div>
      ${spark(coverSeries(cover, 'missingCount'))}
      <div class="runs">${cover.length} run(s)</div>
    </div>
    <div class="card">
      <h3>Phantom forces</h3>
      <div class="latest">${coverSeries(cover, 'phantomCount').slice(-1)[0] ?? '—'}</div>
      ${spark(coverSeries(cover, 'phantomCount'))}
      <div class="runs">${cover.length} run(s)</div>
    </div>
    <div class="card">
      <h3>Present forces</h3>
      <div class="latest">${coverSeries(cover, 'presentCount').slice(-1)[0] ?? '—'}</div>
      ${spark(coverSeries(cover, 'presentCount'))}
      <div class="runs">${cover.length} run(s)</div>
    </div>
  </div>
</body>
</html>`;

const outPath = resolve(OUT, 'index.html');
writeFileSync(outPath, html);
console.log(`✓ UQ-DASH generated → ${outPath}`);
console.log(`  Series tracked: ${calib.length} calib · ${e2e.length} E2E · ${cover.length} UQ-COVER`);

if (process.argv.includes('--open') && process.platform === 'darwin') {
  spawn('open', [outPath], { stdio: 'ignore', detached: true }).unref();
}
