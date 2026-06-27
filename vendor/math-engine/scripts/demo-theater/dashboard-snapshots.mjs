/**
 * W211 Faza 700.0 — Demo Theater dashboard-snapshot generator.
 *
 * Renders HTML snapshots of the 6 W210 Grafana-style dashboards at key
 * pilot moments. Each snapshot is a self-contained .html page with the
 * panel data baked in — no external CSS or JS needed.
 *
 * Snapshot moments: Day 0 / 7 / 14 / 21 / 30 (5 cuts).
 * Dashboards: spins · latency · canary · cert · roi · alerts (6).
 * Total: ~30 .html files per run. Each rendered page is ≲ 8 KB.
 *
 * Usage:
 *   node scripts/demo-theater/dashboard-snapshots.mjs --seed=42 --outDir=...
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateTimeline, canaryStage, labStage } from './events.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const DEFAULT_OUT = resolve(REPO_ROOT, 'dist', 'demo-theater', 'snapshots');

const SNAPSHOT_DAYS = [0, 7, 14, 21, 30];
const DASHBOARDS = ['spins', 'latency', 'canary', 'cert', 'roi', 'alerts'];

const STYLES = `
  body{font:14px -apple-system,Segoe UI,sans-serif;background:#0e1116;color:#e4e6eb;margin:0;padding:24px;}
  h1{font-size:18px;margin:0 0 6px;color:#9bd6ff;}
  h2{font-size:13px;font-weight:600;margin:18px 0 6px;color:#7aa7d0;text-transform:uppercase;letter-spacing:.05em;}
  .panel{background:#1a2030;border:1px solid #2a3550;border-radius:8px;padding:14px 16px;margin-bottom:10px;}
  table{width:100%;border-collapse:collapse;}
  td,th{padding:6px 8px;border-bottom:1px solid #232a3c;text-align:left;font-size:13px;}
  th{color:#9bd6ff;font-weight:500;}
  .kpi{display:flex;gap:18px;}
  .kpi div{flex:1;}
  .kpi b{display:block;font-size:22px;color:#9bd6ff;}
  .kpi span{font-size:11px;color:#8b94aa;text-transform:uppercase;letter-spacing:.05em;}
  .ok{color:#7ddb9b;} .warn{color:#f5c269;} .err{color:#ff7d7d;}
  .bar{height:8px;background:#22293a;border-radius:4px;overflow:hidden;}
  .bar > i{display:block;height:100%;background:#9bd6ff;}
  footer{margin-top:24px;color:#5b6378;font-size:11px;}
`;

function bucket(events) {
  const out = new Map();
  for (const e of events) {
    if (!out.has(e.day)) out.set(e.day, []);
    out.get(e.day).push(e);
  }
  return out;
}

function panel(title, body) {
  return `<div class="panel"><h2>${title}</h2>${body}</div>`;
}

function renderSpins(day, events) {
  const spins = events.filter((e) => e.type === 'spin');
  const rtpAvg = spins.length
    ? spins.reduce((s, x) => s + x.payload.rtp_running, 0) / spins.length
    : 0;
  const latAvg = spins.length
    ? spins.reduce((s, x) => s + x.payload.latency_ms, 0) / spins.length
    : 0;
  return panel(
    `Spins · Day ${day}`,
    `<div class="kpi">
      <div><b>${spins.length}</b><span>sample spins</span></div>
      <div><b>${rtpAvg.toFixed(3)}</b><span>rtp_running avg</span></div>
      <div><b>${latAvg.toFixed(1)}ms</b><span>latency avg</span></div>
    </div>`
  );
}

function renderLatency(day, events) {
  const spins = events.filter((e) => e.type === 'spin');
  if (spins.length === 0) {
    return panel(`Latency · Day ${day}`, `<p class="warn">No spin samples — pre-canary.</p>`);
  }
  const sorted = [...spins.map((s) => s.payload.latency_ms)].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
  return panel(
    `Latency · Day ${day}`,
    `<div class="kpi">
      <div><b>${p50.toFixed(1)}ms</b><span>p50</span></div>
      <div><b>${p99.toFixed(1)}ms</b><span>p99</span></div>
      <div><b>${spins.length}</b><span>samples</span></div>
    </div>
    <div class="bar"><i style="width:${Math.min(100, p99).toFixed(0)}%"></i></div>`
  );
}

function renderCanary(day, events) {
  const stage = canaryStage(day);
  const c = events.find((e) => e.type === 'canary')?.payload ?? { health_score: 0, gates_passed: 0 };
  return panel(
    `Canary · Day ${day}`,
    `<div class="kpi">
      <div><b>s${stage.stage}</b><span>stage</span></div>
      <div><b>${stage.rolloutPercent}%</b><span>rollout</span></div>
      <div><b class="ok">${c.health_score.toFixed(3)}</b><span>health</span></div>
      <div><b class="ok">${c.gates_passed}/4</b><span>gates</span></div>
    </div>`
  );
}

function renderCert(day, events) {
  const lab = labStage(day);
  const labEv = events.find((e) => e.type === 'lab')?.payload ?? { stage: lab.stage, days_in_stage: lab.daysInStage };
  return panel(
    `Cert pipeline · Day ${day}`,
    `<table>
      <tr><th>field</th><th>value</th></tr>
      <tr><td>stage</td><td>${labEv.stage}</td></tr>
      <tr><td>days in stage</td><td>${labEv.days_in_stage}</td></tr>
      <tr><td>lab</td><td>${labEv.lab_name ?? 'GLI'}</td></tr>
    </table>`
  );
}

function renderRoi(day) {
  const roi = day < 12 ? -8000 + day * 1200 : day * 2500 - 12000;
  const cls = roi >= 0 ? 'ok' : 'warn';
  return panel(
    `ROI · Day ${day}`,
    `<div class="kpi">
      <div><b class="${cls}">€${roi.toLocaleString()}</b><span>cumulative</span></div>
      <div><b>${day < 12 ? 'pre' : 'post'}</b><span>break-even</span></div>
    </div>`
  );
}

function renderAlerts(day, events) {
  const anomalies = events.filter((e) => e.type === 'anomaly');
  if (anomalies.length === 0) {
    return panel(`Alerts · Day ${day}`, `<p class="ok">No active alerts.</p>`);
  }
  const rows = anomalies
    .map(
      (a) =>
        `<tr><td class="warn">${a.payload.type}</td><td>${a.payload.severity}</td><td>${a.payload.message}</td></tr>`
    )
    .join('');
  return panel(
    `Alerts · Day ${day}`,
    `<table><tr><th>type</th><th>severity</th><th>message</th></tr>${rows}</table>`
  );
}

const RENDERERS = {
  spins: renderSpins,
  latency: renderLatency,
  canary: renderCanary,
  cert: renderCert,
  roi: renderRoi,
  alerts: renderAlerts,
};

function wrap(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${STYLES}</style></head><body><h1>${title}</h1>${body}<footer>Generated by W211 Demo Theater · slot-math-engine-template</footer></body></html>`;
}

/**
 * Build all 30 snapshot HTML files for a timeline.
 *
 * Returns metadata: { outDir, files: [{day, dashboard, path, bytes}] }
 */
export function buildSnapshots(opts = {}) {
  const seed = opts.seed ?? 42;
  const outDir = opts.outDir ?? DEFAULT_OUT;
  mkdirSync(outDir, { recursive: true });
  const timeline = generateTimeline({ seed, days: 30 });
  const buckets = bucket(timeline.events);

  const files = [];
  for (const d of SNAPSHOT_DAYS) {
    const dayEvents = buckets.get(d) ?? [];
    for (const dash of DASHBOARDS) {
      const r = RENDERERS[dash];
      const body = r(d, dayEvents);
      const html = wrap(`${dash} · Day ${d}`, body);
      const file = resolve(outDir, `day-${String(d).padStart(2, '0')}-${dash}.html`);
      writeFileSync(file, html);
      files.push({ day: d, dashboard: dash, path: file, bytes: html.length });
    }
  }
  // Index page
  const indexBody = files
    .map(
      (f) =>
        `<li><a href="./${f.path.split('/').pop()}">${f.dashboard} · Day ${f.day}</a> · ${f.bytes}B</li>`
    )
    .join('');
  const indexPath = resolve(outDir, 'index.html');
  writeFileSync(indexPath, wrap('Demo Theater Snapshots', `<ul>${indexBody}</ul>`));

  return { outDir, files, indexPath, days: SNAPSHOT_DAYS, dashboards: DASHBOARDS };
}

// CLI
const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq >= 0) args[a.slice(2, eq)] = a.slice(eq + 1);
    else args[a.slice(2)] = true;
  }
  const r = buildSnapshots({ seed: Number(args.seed ?? 42), outDir: args.outDir });
  // eslint-disable-next-line no-console
  console.log(`snapshots: ${r.files.length} files in ${r.outDir}`);
}
