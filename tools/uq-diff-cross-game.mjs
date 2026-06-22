#!/usr/bin/env node
/**
 * tools/uq-diff-cross-game.mjs
 *
 * UQ-DIFF (MASTER_TODO P2) — Cross-GDD diff tool.
 *
 * Takes two real-game slug names and produces a static HTML side-by-side
 * highlighting differences in topology, features, declared symbols,
 * jurisdictions, and force chip surface. Useful for QA "how does
 * Game-A differ from Game-B?" sessions.
 *
 * USAGE
 *   node tools/uq-diff-cross-game.mjs <slug-a> <slug-b>
 *   node tools/uq-diff-cross-game.mjs --baseline   # default Game-A vs Game-B
 *
 * OUTPUT
 *   dist/uq-diff/<slug-a>__vs__<slug-b>.html
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const DIST = resolve(REPO, 'dist/real-games');
const OUT  = resolve(REPO, 'dist/uq-diff');
mkdirSync(OUT, { recursive: true });

const args = process.argv.slice(2);
let slugA, slugB;
if (args.includes('--baseline')) {
  slugA = 'gates-of-olympus-1000-gdd';
  slugB = 'wrath-of-olympus-gdd';
} else if (args.length >= 2) {
  [slugA, slugB] = args;
} else {
  console.error('USAGE: node tools/uq-diff-cross-game.mjs <slug-a> <slug-b>');
  process.exit(2);
}

function loadModel(slug) {
  const p = join(DIST, slug, 'model.json');
  if (!existsSync(p)) {
    console.error(`▸ model.json missing for slug: ${slug}`);
    process.exit(2);
  }
  return JSON.parse(readFileSync(p, 'utf-8'));
}

const a = loadModel(slugA);
const b = loadModel(slugB);

const featA = new Set((a.features || []).map(f => f.kind || f).filter(Boolean));
const featB = new Set((b.features || []).map(f => f.kind || f).filter(Boolean));
const activeA = new Set((a.__activeFeatures__ || []).map(f => f.kind));
const activeB = new Set((b.__activeFeatures__ || []).map(f => f.kind));
const jurA = new Set(Array.isArray(a.compliance) ? a.compliance.map(j => typeof j === 'string' ? j : j.code || j.name) : []);
const jurB = new Set(Array.isArray(b.compliance) ? b.compliance.map(j => typeof j === 'string' ? j : j.code || j.name) : []);
const allFeats = [...new Set([...featA, ...featB])].sort();
const allActive = [...new Set([...activeA, ...activeB])].sort();
const allJur = [...new Set([...jurA, ...jurB])].sort();

function diffRow(label, valA, valB) {
  const same = JSON.stringify(valA) === JSON.stringify(valB);
  return `<tr class="${same ? '' : 'diff'}">
    <th>${label}</th>
    <td>${valA ?? '—'}</td>
    <td>${valB ?? '—'}</td>
  </tr>`;
}

function checkRow(label, items, setA, setB) {
  const rows = items.map(it => {
    const inA = setA.has(it), inB = setB.has(it);
    const both = inA && inB;
    return `<tr class="${both ? '' : 'diff'}">
      <th>${it}</th>
      <td>${inA ? '✓' : '·'}</td>
      <td>${inB ? '✓' : '·'}</td>
    </tr>`;
  }).join('\n');
  return rows || `<tr><td colspan="3" class="empty">—</td></tr>`;
}

const html = `<!doctype html>
<html lang="sr">
<head>
<meta charset="utf-8"/>
<title>UQ-DIFF · ${slugA} vs ${slugB}</title>
<style>
  :root { color-scheme: dark; }
  body { font: 13px/1.5 -apple-system, BlinkMacSystemFont, sans-serif; background: #05070c; color: #f0f0f0; margin: 0; padding: 20px; }
  h1 { font-size: 18px; margin: 0 0 6px; }
  h2 { font-size: 13px; color: #888; text-transform: uppercase; letter-spacing: .08em; margin: 22px 0 10px; }
  .meta { color: #888; font-size: 11px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; background: #0b0f16; margin-bottom: 16px; border: 1px solid #1a2030; border-radius: 8px; overflow: hidden; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #11161f; vertical-align: top; }
  th { color: #c9a227; font-weight: 600; width: 26%; }
  thead th { background: #0d1117; color: #888; text-transform: uppercase; font-size: 10px; letter-spacing: .06em; }
  tr.diff { background: rgba(249, 188, 96, 0.08); }
  tr.diff th { color: #f2c14e; }
  td.empty { color: #555; text-align: center; padding: 24px; }
  .legend { font-size: 11px; color: #888; margin-bottom: 8px; }
</style>
</head>
<body>
  <h1>UQ-DIFF · ${slugA} vs ${slugB}</h1>
  <div class="meta">Generated ${new Date().toISOString()} · gold-highlighted rows differ.</div>

  <h2>Topology</h2>
  <table>
    <thead><tr><th>Field</th><th>${slugA}</th><th>${slugB}</th></tr></thead>
    ${diffRow('Reels', a.topology?.reels, b.topology?.reels)}
    ${diffRow('Rows', a.topology?.rows, b.topology?.rows)}
    ${diffRow('Paylines', a.topology?.paylines, b.topology?.paylines)}
    ${diffRow('Evaluation', a.topology?.evaluation, b.topology?.evaluation)}
    ${diffRow('Kind', a.topology?.kind, b.topology?.kind)}
    ${diffRow('Cluster min size', a.topology?.cluster_min_size, b.topology?.cluster_min_size)}
    ${diffRow('Ways count', a.topology?.ways_count, b.topology?.ways_count)}
    ${diffRow('Cascade', a.topology?.cascade?.enabled, b.topology?.cascade?.enabled)}
  </table>

  <h2>features[] · canonical declared kinds</h2>
  <table>
    <thead><tr><th>Kind</th><th>${slugA}</th><th>${slugB}</th></tr></thead>
    ${checkRow('feat', allFeats, featA, featB)}
  </table>

  <h2>__activeFeatures__ · runtime active</h2>
  <table>
    <thead><tr><th>Kind</th><th>${slugA}</th><th>${slugB}</th></tr></thead>
    ${checkRow('active', allActive, activeA, activeB)}
  </table>

  <h2>Compliance · jurisdictions</h2>
  <table>
    <thead><tr><th>Jurisdiction</th><th>${slugA}</th><th>${slugB}</th></tr></thead>
    ${checkRow('jur', allJur, jurA, jurB)}
  </table>

  <h2>Symbols + Paytable</h2>
  <table>
    <thead><tr><th>Field</th><th>${slugA}</th><th>${slugB}</th></tr></thead>
    ${diffRow('Symbol count (specials)', a.symbols?.specials?.length, b.symbols?.specials?.length)}
    ${diffRow('Paytable rows', Array.isArray(a.paytable) ? a.paytable.length : '—', Array.isArray(b.paytable) ? b.paytable.length : '—')}
  </table>

  <h2>Payback hints</h2>
  <table>
    <thead><tr><th>Field</th><th>${slugA}</th><th>${slugB}</th></tr></thead>
    ${diffRow('Hit frequency', a.payback?.hitFrequency, b.payback?.hitFrequency)}
    ${diffRow('Max win × bet', a.payback?.maxWinX, b.payback?.maxWinX)}
    ${diffRow('RTP', a.rtp, b.rtp)}
  </table>
</body>
</html>`;

const outPath = join(OUT, `${slugA}__vs__${slugB}.html`);
writeFileSync(outPath, html);
console.log(`✓ UQ-DIFF generated → ${outPath}`);
if (args.includes('--open') && process.platform === 'darwin') {
  spawn('open', [outPath], { stdio: 'ignore', detached: true }).unref();
}
