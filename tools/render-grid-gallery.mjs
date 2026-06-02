#!/usr/bin/env node
/**
 * Render every grid fixture into dist/gallery/ and build a single
 * index.html that lets Boki click-through all of them in one tab.
 *
 * Usage: node tools/render-grid-gallery.mjs
 */

import { parseGDD } from '../src/parser.mjs';
import { buildSlotHTML } from '../src/buildSlotHTML.mjs';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const OUT_DIR = resolve(REPO, 'dist/gallery');
const SAMPLES = [
  resolve(REPO, 'samples'),
  resolve(REPO, 'samples/grids'),
];

if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const entries = [];

for (const dir of SAMPLES) {
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    const md = readFileSync(resolve(dir, f), 'utf8');
    const model = parseGDD(md);
    const html = buildSlotHTML(model);
    const slug = basename(f, '.md').toLowerCase();
    const outFile = resolve(OUT_DIR, `${slug}.html`);
    writeFileSync(outFile, html);
    entries.push({
      slug,
      file: `${slug}.html`,
      title: model.title || f,
      shape: model.shape?.kind || 'unknown',
      cols: model.shape?.cols ?? model.shape?.totalCells ?? '?',
      rows: model.shape?.rows ?? '',
      features: (model.features || []).length,
    });
  }
}

entries.sort((a, b) => a.slug.localeCompare(b.slug));

const idx = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Slot GDD Factory — Grid Gallery (${entries.length})</title>
<style>
  :root {
    --bg: #0a0e1a;
    --bg2: #131a2e;
    --fg: #e6ecff;
    --muted: #8a93b0;
    --accent: #ffd24a;
    --border: #2a3454;
  }
  * { box-sizing: border-box }
  html, body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.45 -apple-system, "SF Pro Text", system-ui, sans-serif; }
  header { padding: 28px 32px 18px; border-bottom: 1px solid var(--border); background: linear-gradient(180deg,#0e1428,#0a0e1a); }
  h1 { margin: 0 0 4px; font-size: 22px; letter-spacing: .3px }
  header p { margin: 0; color: var(--muted) }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; padding: 22px 28px 60px; }
  .card { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; transition: transform .15s, border-color .15s; }
  .card:hover { transform: translateY(-2px); border-color: var(--accent); }
  .card a { display: block; padding: 16px 18px; text-decoration: none; color: var(--fg); }
  .card .ttl { font-weight: 600; font-size: 14.5px; margin-bottom: 6px }
  .meta { display: flex; gap: 10px; flex-wrap: wrap; color: var(--muted); font-size: 12px; }
  .pill { background: rgba(255,210,74,.08); border: 1px solid rgba(255,210,74,.22); color: var(--accent); padding: 2px 8px; border-radius: 999px; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
</style>
</head>
<body>
  <header>
    <h1>Slot GDD Factory — Grid Gallery</h1>
    <p>${entries.length} pre-rendered playable templates. Click any card to open.</p>
  </header>
  <section class="grid">
${entries.map(e => `    <div class="card"><a href="./${e.file}" target="_blank">
      <div class="ttl">${e.title}</div>
      <div class="meta">
        <span class="pill">${e.shape}</span>
        <span>${e.rows ? `${e.cols}×${e.rows}` : e.cols + ' cells'}</span>
        <span>${e.features} features</span>
      </div>
    </a></div>`).join('\n')}
  </section>
</body>
</html>`;

writeFileSync(resolve(OUT_DIR, 'index.html'), idx);

console.log(`✓ Rendered ${entries.length} grids → dist/gallery/`);
console.log(`  open: http://localhost:5180/dist/gallery/`);
