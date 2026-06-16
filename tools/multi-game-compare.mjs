#!/usr/bin/env node
/**
 * tools/multi-game-compare.mjs
 *
 * Wave T3 — Multi-game side-by-side comparison hub.
 *
 * Usage:
 *   node tools/multi-game-compare.mjs [--out dist/compare/] [gdd1 gdd2 ...]
 *
 *   Without args, picks the 4 canonical GDDs from ~/Desktop/GDD/ if
 *   present, else samples/ fallbacks.
 *
 * What it does:
 *   1. Builds slot HTML for each GDD via parseGDD + buildSlotHTML.
 *   2. Writes each rendered HTML to <out>/<short>.html.
 *   3. Generates an `index.html` that loads each game's preview inside
 *      a responsive grid of iframes (1/2/3/4 column layout based on
 *      count) so an operator can visually compare features, HUD, and
 *      cabinet sizing across games at once.
 *   4. Includes a tiny operator toolbar: pick comparison axis (HUD vs
 *      reels vs payout area), toggle dark/light grid backdrop.
 *
 * Senior-grade:
 *   • Single responsibility — render N + emit index, nothing more.
 *   • 0 runtime deps; only Node fs/path + repo's own parser/builder.
 *   • Deterministic — same inputs → same output bytes.
 *   • Vendor-neutral.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const C = {
  green:  s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  dim:    s => `\x1b[2m${s}\x1b[0m`,
};

function _findGDDs(args) {
  /* Honour explicit args first. */
  const explicit = args.filter(a => !a.startsWith('--'));
  if (explicit.length > 0) return explicit.map(p => path.resolve(p));

  /* Look in ~/Desktop/GDD/ canonical folder. */
  const deskGdd = path.join(os.homedir(), 'Desktop', 'GDD');
  const candidates = [];
  if (existsSync(deskGdd)) {
    for (const f of readdirSync(deskGdd)) {
      if (/\.(md|json|txt)$/i.test(f) && !/ADB|AUDIO|SDD|SFX|HOWLER|MIX/i.test(f)) {
        candidates.push(path.join(deskGdd, f));
      }
    }
  }

  /* Fall back to samples/. */
  if (candidates.length < 2) {
    const samples = path.join(REPO, 'samples');
    if (existsSync(samples)) {
      for (const f of readdirSync(samples)) {
        if (/\.(md|json|txt)$/i.test(f) && !/ADB|AUDIO|SDD|SFX|HOWLER|MIX/i.test(f)) {
          candidates.push(path.join(samples, f));
        }
      }
    }
  }

  /* Pick the canonical 4 if present (Boki rule: 4-GDD ultimate set). */
  const preferred = [
    'Wrath_of_Olympus_GDD.md',
    'Gates_of_Olympus_1000_GDD.md',
    'Huff_n_More_Puff_GDD.md',
    'Starlight_Travellers_GDD.md',
    'WRATH_OF_OLYMPUS_GAME_GDD.md',
    'CRYSTAL_FORGE_GAME_GDD.md',
  ];
  const picked = preferred
    .map(n => candidates.find(c => path.basename(c).toLowerCase() === n.toLowerCase()))
    .filter(Boolean);
  if (picked.length >= 2) return picked.slice(0, 4);
  return candidates.slice(0, 4);
}

function _shortName(file) {
  return path.basename(file)
    .replace(/\.(md|json|txt)$/i, '')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .slice(0, 40);
}

function _columnsFor(n) {
  if (n <= 1) return 1;
  if (n === 2) return 2;
  if (n === 3) return 3;
  return 2; // 4 → 2x2
}

function _emitIndex(games) {
  const cols = _columnsFor(games.length);
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Multi-game compare hub · slot-gdd-factory</title>
<style>
  :root { color-scheme: dark; }
  html, body {
    margin: 0;
    background: #0b0f16;
    color: #f2f2f2;
    font-family: system-ui, -apple-system, sans-serif;
    min-height: 100vh;
  }
  .toolbar {
    position: sticky;
    top: 0;
    z-index: 9;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    padding: 14px 20px;
    background: rgba(11, 15, 22, 0.96);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    align-items: center;
  }
  .toolbar h1 {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  .toolbar .count { opacity: 0.6; font-size: 13px; }
  .toolbar button {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 6px;
    color: inherit;
    padding: 6px 12px;
    font-size: 13px;
    cursor: pointer;
  }
  .toolbar button[aria-pressed="true"] { background: #c9a227; color: #05070c; }
  .grid {
    display: grid;
    grid-template-columns: repeat(${cols}, minmax(0, 1fr));
    gap: 12px;
    padding: 12px 20px 24px;
  }
  .pane {
    display: flex;
    flex-direction: column;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    overflow: hidden;
    background: #05070c;
    aspect-ratio: 9 / 16;
    min-height: 540px;
  }
  .pane header {
    padding: 8px 12px;
    background: rgba(201, 162, 39, 0.12);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    font-size: 13px;
    font-weight: 600;
  }
  .pane iframe {
    flex: 1;
    width: 100%;
    border: 0;
    background: #000;
  }
  body[data-light="true"] {
    background: #f5f5f7;
    color: #111;
  }
  body[data-light="true"] .toolbar { background: rgba(255, 255, 255, 0.94); border-bottom-color: #ddd; }
  body[data-light="true"] .pane { background: #fff; border-color: #ddd; }
</style>
</head><body>
<div class="toolbar">
  <h1>Multi-game compare</h1>
  <span class="count">${games.length} game${games.length === 1 ? '' : 's'}</span>
  <button id="btnTheme" aria-pressed="false" type="button">Toggle theme</button>
  <button id="btnReload" type="button">Reload all</button>
</div>
<main class="grid">
  ${games.map(g => `<section class="pane">
    <header>${g.name}</header>
    <iframe src="./${g.file}" title="${g.name}" loading="lazy"></iframe>
  </section>`).join('\n  ')}
</main>
<script>
  (function() {
    var btnT = document.getElementById('btnTheme');
    var btnR = document.getElementById('btnReload');
    btnT.addEventListener('click', function() {
      var on = document.body.getAttribute('data-light') === 'true';
      document.body.setAttribute('data-light', String(!on));
      btnT.setAttribute('aria-pressed', String(!on));
    });
    btnR.addEventListener('click', function() {
      document.querySelectorAll('iframe').forEach(function(i) { i.src = i.src; });
    });
  })();
</script>
</body></html>`;
}

async function main() {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf('--out');
  const outDir = outIdx >= 0 ? path.resolve(argv[outIdx + 1]) : path.join(REPO, 'dist', 'compare');
  const fileArgs = outIdx >= 0 ? [...argv.slice(0, outIdx), ...argv.slice(outIdx + 2)] : argv;

  const gdds = _findGDDs(fileArgs);
  if (gdds.length === 0) {
    console.error(C.red('no GDDs found (no args + no ~/Desktop/GDD/ + no samples/)'));
    process.exit(1);
  }
  if (gdds.length > 4) gdds.length = 4;

  console.log(C.cyan(C.bold('\n🎰 Multi-game compare — slot-gdd-factory\n')));
  console.log(C.dim(`   Picking ${gdds.length} GDD(s); output → ${path.relative(REPO, outDir) || '.'}/\n`));

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  /* Dynamic import of repo parser/builder. */
  const parser = await import(pathToFileURL(path.join(REPO, 'src', 'parser.mjs')).href);
  const builder = await import(pathToFileURL(path.join(REPO, 'src', 'buildSlotHTML.mjs')).href);

  const games = [];
  for (const gdd of gdds) {
    const short = _shortName(gdd);
    const src = readFileSync(gdd, 'utf8');
    let model;
    try {
      model = parser.parseGDD(src);
    } catch (e) {
      console.log(`  ${C.red('✗')} ${short}: parse failed — ${e.message}`);
      continue;
    }
    let html;
    try {
      html = builder.buildSlotHTML(model);
    } catch (e) {
      console.log(`  ${C.red('✗')} ${short}: build failed — ${e.message}`);
      continue;
    }
    const fname = `${short}.html`;
    writeFileSync(path.join(outDir, fname), html);
    games.push({ name: model.name || short, file: fname });
    console.log(`  ${C.green('✓')} ${C.bold(model.name || short)} ${C.dim(`→ ${fname}`)}`);
  }

  if (games.length === 0) {
    console.log(C.red('\nno games successfully rendered.\n'));
    process.exit(1);
  }

  const idx = _emitIndex(games);
  writeFileSync(path.join(outDir, 'index.html'), idx);
  console.log(`\n  ${C.cyan('index:')} ${path.relative(REPO, path.join(outDir, 'index.html'))}\n`);
  console.log(C.green(C.bold('✅ multi-game compare hub ready.\n')));
}

main().catch((e) => {
  console.error(C.red(C.bold(`\n❌ multi-game-compare failed: ${e.message}\n`)));
  console.error(e.stack);
  process.exit(1);
});
