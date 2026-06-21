#!/usr/bin/env node
/**
 * tools/gen-archetype-docs.mjs
 *
 * Wave UQ-15 (2026-06-21) — Live archetype docs site.
 *
 * Generates a single static HTML page from src/registry/featureArchetypes.mjs
 * — one card per archetype with purpose / hooks / examples / forceFlag /
 * windowFlag / regex / state shape, plus a search filter and a dark mode.
 * Also lists ARCHETYPE_ALIASES + NON_ARCHETYPE_KINDS in their own sections.
 *
 * Output:
 *   dist/docs/archetypes.html       — single-file HTML, zero deps
 *   dist/docs/archetypes-meta.json  — machine-readable mirror
 *
 * CLI
 *   node tools/gen-archetype-docs.mjs
 *   node tools/gen-archetype-docs.mjs --open
 *
 * INVARIANTS
 *   · Vendor-neutral: docs site shows ONLY catalog content,
 *     no vendor names or trademark phrases
 *   · Self-contained: inline CSS + JS, no CDN, opens offline
 *   · Determinstic: stable card order = ARCHETYPES order
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ARCHETYPES,
  ARCHETYPE_ALIASES,
  NON_ARCHETYPE_KINDS,
  ARCHETYPE_COUNT,
} from '../src/registry/featureArchetypes.mjs';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const REPO = resolve(__dirname, '..');
const OUT_DIR = resolve(REPO, 'dist/docs');

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderCard(a) {
  const examples = a.examples.map(e => `<code class="ex">${escapeHtml(e)}</code>`).join(' ');
  const hooks    = a.hooks.map(h => `<code class="hook">${escapeHtml(h)}</code>`).join(' ');
  const aliases  = Object.entries(ARCHETYPE_ALIASES)
    .filter(([, target]) => target === a.id)
    .map(([k]) => `<code class="alias">${escapeHtml(k)}</code>`)
    .join(' ');
  const state = JSON.stringify(a.stateShape, null, 2);
  const regex = a.intentRegex.toString();
  return `<article class="card" data-id="${escapeHtml(a.id)}" data-search="${escapeHtml((a.id + ' ' + a.purpose + ' ' + a.examples.join(' ') + ' ' + (aliases || '')).toLowerCase())}">
  <header class="card-head">
    <h2><span class="badge">#${ARCHETYPES.indexOf(a) + 1}</span> <code class="id">${escapeHtml(a.id)}</code></h2>
    <p class="purpose">${escapeHtml(a.purpose)}</p>
  </header>
  <dl class="card-body">
    <dt>Force flag</dt>      <dd><code>${escapeHtml(a.forceFlag)}</code></dd>
    <dt>Window flag</dt>     <dd><code>${escapeHtml(a.windowFlag)}</code></dd>
    <dt>HookBus events</dt>  <dd>${hooks}</dd>
    <dt>Examples</dt>        <dd>${examples}</dd>
    ${aliases ? `<dt>Aliases</dt>          <dd>${aliases}</dd>` : ''}
    <dt>Intent regex</dt>    <dd><code class="regex">${escapeHtml(regex)}</code></dd>
    <dt>State shape</dt>     <dd><pre class="state">${escapeHtml(state)}</pre></dd>
  </dl>
</article>`;
}

const cards = ARCHETYPES.map(renderCard).join('\n');

const aliasRows = Object.entries(ARCHETYPE_ALIASES)
  .sort()
  .map(([k, v]) => `<tr><td><code>${escapeHtml(k)}</code></td><td>→</td><td><code>${escapeHtml(v)}</code></td></tr>`)
  .join('\n');

const nonArchList = [...NON_ARCHETYPE_KINDS].sort()
  .map(k => `<code>${escapeHtml(k)}</code>`)
  .join(' ');

const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>Feature Archetype Catalog · slot-gdd-factory</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root {
    --bg: #fafbfc; --fg: #18181b; --card: #ffffff; --border: #e4e4e7;
    --muted: #71717a; --accent: #4f46e5; --code-bg: #f4f4f5;
  }
  [data-theme="dark"] {
    --bg: #09090b; --fg: #fafafa; --card: #18181b; --border: #27272a;
    --muted: #a1a1aa; --accent: #818cf8; --code-bg: #1f1f23;
  }
  * { box-sizing: border-box; }
  body { font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         background: var(--bg); color: var(--fg); margin: 0; padding: 0;
         transition: background 120ms, color 120ms; }
  header.top { position: sticky; top: 0; background: var(--bg); border-bottom: 1px solid var(--border);
               padding: 12px 24px; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; z-index: 10; }
  header.top h1 { font-size: 18px; margin: 0; font-weight: 600; }
  header.top .count { color: var(--muted); }
  header.top input { flex: 1; min-width: 200px; padding: 8px 12px; border: 1px solid var(--border);
                     border-radius: 6px; background: var(--card); color: var(--fg); font: inherit; }
  header.top button { padding: 8px 14px; border: 1px solid var(--border); border-radius: 6px;
                      background: var(--card); color: var(--fg); cursor: pointer; font: inherit; }
  main { max-width: 1200px; margin: 0 auto; padding: 24px; }
  .cards { display: grid; gap: 16px; grid-template-columns: 1fr; }
  @media (min-width: 800px)  { .cards { grid-template-columns: 1fr 1fr; } }
  @media (min-width: 1100px) { .cards { grid-template-columns: 1fr 1fr 1fr; } }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 10px;
          padding: 16px; transition: border-color 120ms; }
  .card.hidden { display: none; }
  .card:hover { border-color: var(--accent); }
  .card h2 { margin: 0 0 6px; font-size: 16px; display: flex; align-items: center; gap: 8px; }
  .badge { background: var(--accent); color: #fff; font-size: 11px; padding: 2px 6px; border-radius: 4px; font-weight: 600; }
  .id { font-size: 14px; color: var(--accent); background: none; padding: 0; }
  .purpose { color: var(--muted); margin: 0 0 12px; font-size: 13px; }
  dl { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: 6px 12px; font-size: 12px; }
  dt { color: var(--muted); font-weight: 500; }
  dd { margin: 0; word-break: break-word; }
  code { font: 11px/1.4 ui-monospace, "SF Mono", Menlo, monospace; background: var(--code-bg);
         padding: 1px 4px; border-radius: 3px; }
  .ex, .hook, .alias { display: inline-block; margin: 1px 1px; }
  .alias { background: rgba(79, 70, 229, 0.12); color: var(--accent); }
  .regex { font-size: 10px; word-break: break-all; }
  pre.state { background: var(--code-bg); padding: 8px; border-radius: 4px; margin: 4px 0 0;
              font-size: 11px; overflow-x: auto; }
  section.aux { margin-top: 32px; background: var(--card); border: 1px solid var(--border);
                border-radius: 10px; padding: 16px; }
  section.aux h2 { margin: 0 0 12px; font-size: 16px; }
  table.aliases { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.aliases td { padding: 4px 8px; border-bottom: 1px solid var(--border); }
  .nonarch { display: flex; flex-wrap: wrap; gap: 4px; }
  footer { padding: 24px; text-align: center; color: var(--muted); font-size: 12px; }
</style>
</head><body data-theme="light">
<header class="top">
  <h1>Feature Archetype Catalog <span class="count">· ${ARCHETYPE_COUNT} archetypes</span></h1>
  <input id="q" type="search" placeholder="filter by id, purpose, example, alias…" aria-label="Filter archetypes">
  <button id="theme" type="button" aria-label="Toggle theme">🌓</button>
</header>
<main>
  <section class="cards" id="cards">
${cards}
  </section>

  <section class="aux">
    <h2>Aliases (${Object.keys(ARCHETYPE_ALIASES).length} synonym mappings → archetype)</h2>
    <table class="aliases">${aliasRows}</table>
  </section>

  <section class="aux">
    <h2>Non-archetype kinds (${NON_ARCHETYPE_KINDS.size} routed to null)</h2>
    <p style="color: var(--muted); font-size: 12px;">Eval engines, win presentation, regulator gates, UI plumbing —
    not feature archetypes. <code>suggestArchetype()</code> returns <code>null</code> for these.</p>
    <div class="nonarch">${nonArchList}</div>
  </section>
</main>
<footer>
  Generated by <code>tools/gen-archetype-docs.mjs</code> · vendor-neutral · zero deps
</footer>
<script>
  const q = document.getElementById('q');
  const cards = [...document.querySelectorAll('.card')];
  q.addEventListener('input', () => {
    const v = q.value.trim().toLowerCase();
    for (const c of cards) {
      const hay = c.dataset.search || '';
      c.classList.toggle('hidden', v && !hay.includes(v));
    }
  });
  /* UQ-AUDIT fix: namespace localStorage key under the repo name so
     hosting alongside sibling doc sites can't collide. */
  const _LS_KEY = 'slot-gdd-factory/archetype-docs-theme';
  const btn = document.getElementById('theme');
  btn.addEventListener('click', () => {
    const cur = document.body.dataset.theme;
    document.body.dataset.theme = cur === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(_LS_KEY, document.body.dataset.theme); } catch(_){}
  });
  try {
    const saved = localStorage.getItem(_LS_KEY);
    if (saved) document.body.dataset.theme = saved;
  } catch(_){}
</script>
</body></html>`;

const meta = {
  generatedAt: new Date().toISOString(),
  archetypeCount: ARCHETYPE_COUNT,
  aliases: Object.fromEntries(Object.entries(ARCHETYPE_ALIASES)),
  nonArchetypeKinds: [...NON_ARCHETYPE_KINDS].sort(),
  archetypes: ARCHETYPES.map(a => ({
    id: a.id, purpose: a.purpose,
    forceFlag: a.forceFlag, windowFlag: a.windowFlag,
    hooks: a.hooks, examples: a.examples,
    stateShape: a.stateShape,
    intentRegex: a.intentRegex.toString(),
  })),
};

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const htmlPath = resolve(OUT_DIR, 'archetypes.html');
  const metaPath = resolve(OUT_DIR, 'archetypes-meta.json');
  await writeFile(htmlPath, html, 'utf8');
  await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
  console.log(`✓ archetype docs site generated`);
  console.log(`  ${ARCHETYPE_COUNT} archetype cards + ${Object.keys(ARCHETYPE_ALIASES).length} aliases + ${NON_ARCHETYPE_KINDS.size} non-archetype`);
  console.log(`  → ${htmlPath} (${(html.length / 1024).toFixed(1)} KB)`);
  console.log(`  → ${metaPath}`);
  if (process.argv.includes('--open')) {
    spawn('open', [htmlPath], { detached: true, stdio: 'ignore' }).unref();
    console.log('  opened in browser');
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
