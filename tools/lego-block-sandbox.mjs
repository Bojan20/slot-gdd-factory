#!/usr/bin/env node
/**
 * tools/lego-block-sandbox.mjs
 *
 * Boki 2026-06-20: "Zelim da svaki blok iststiras, na primer uzmi
 * rectangular ili napravi novi slot gde mogu da menjam bilo koje blokove,
 * sve koji postoje, i onda da vidim kako koji s kojim radi i ako ima
 * bugova, da ih tu prvo resavas i onda da ih ukljucimo u svaki gdd"
 *
 * Interaktivni LEGO sandbox:
 *
 *   • Base model: rectangular 5×3, neutralan tema, 0 features enabled (clean canvas)
 *   • 3-panel UI: [block toggles] | [live preview iframe] | [console log]
 *   • Toggle block ON/OFF → 250ms debounce → re-build slot HTML → iframe reload (SSE push)
 *   • Console panel feed-uje real-time HookBus emit + page-err per combo
 *   • Preset combos: Empty, Olympus Lite, Cluster Tumble, Hold & Win Burst, Wheel Bonus, Free Spins
 *   • State preserved in localStorage — refresh ne briše izbore
 *   • Bind: 127.0.0.1:5151 (dev-only, samo lokalno)
 *
 * Usage:
 *   node tools/lego-block-sandbox.mjs [--port 5151]
 *
 * Stack:
 *   • Zero-dep: Node http + fs (no Express, no SSE library)
 *   • SSE push on rebuild_done / block_toggled / page_error
 */

import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseGDD } from '../src/parser.mjs';
import { buildSlotHTML } from '../src/buildSlotHTML.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const MANIFEST_PATH = resolve(REPO, 'blocks/_manifest.json');

const PORT = (function () {
  const idx = process.argv.indexOf('--port');
  if (idx > 0 && process.argv[idx + 1]) return parseInt(process.argv[idx + 1], 10) || 5151;
  return 5151;
})();

const C = {
  green: s => `\x1b[32m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
};

/* ─────────────────────── BASE RECTANGULAR MODEL ─────────────────────── */
const BASE_MODEL = {
  name: 'LEGO Sandbox Slot',
  theme: { tags: ['neutral'], palette: { primary: '#2a3142', accent: '#c9a227' }, mood: 'neutral' },
  topology: { kind: 'rectangular', reels: 5, rows: 3, paylines: 20 },
  symbols: {
    high: [
      { id: 'H1', name: 'Diamond' },
      { id: 'H2', name: 'Ruby' },
      { id: 'H3', name: 'Emerald' },
    ],
    mid: [
      { id: 'M1', name: 'A' },
      { id: 'M2', name: 'K' },
    ],
    low: [
      { id: 'L1', name: 'Q' },
      { id: 'L2', name: 'J' },
      { id: 'L3', name: '10' },
    ],
    specials: [
      { id: 'W', name: 'Wild' },
      { id: 'S', name: 'Scatter' },
    ],
  },
  features: [],
  confidence: { name: 1, topology: 1, symbols: 1, features: 1, _failures: [] },
};

/* ─────────────────────── PRESET COMBOS ─────────────────────── */
const PRESETS = {
  empty: { label: 'Empty (base only)', features: [] },
  olympus_lite: {
    label: 'Olympus Lite (FS + Multiplier + Cascade)',
    features: [
      { kind: 'free_spins', label: 'Free Spins' },
      { kind: 'multiplier', label: 'Multiplier' },
      { kind: 'cascade', label: 'Cascade / Tumble' },
    ],
  },
  cluster_tumble: {
    label: 'Cluster Tumble (Cluster Pays + Cascade)',
    features: [
      { kind: 'cluster_pays', label: 'Cluster Pays' },
      { kind: 'cascade', label: 'Cascade / Tumble' },
    ],
  },
  hold_and_win: {
    label: 'Hold & Win Burst (FS + H&W + Jackpot)',
    features: [
      { kind: 'free_spins', label: 'Free Spins' },
      { kind: 'hold_and_win', label: 'Hold & Win' },
      { kind: 'jackpot', label: 'Jackpot' },
    ],
  },
  wheel_bonus: {
    label: 'Wheel Bonus (FS + Wheel + Bonus Buy)',
    features: [
      { kind: 'free_spins', label: 'Free Spins' },
      { kind: 'wheel_bonus', label: 'Wheel Bonus' },
      { kind: 'bonus_buy', label: 'Bonus Buy' },
    ],
  },
  free_spins: {
    label: 'Free Spins only',
    features: [{ kind: 'free_spins', label: 'Free Spins' }],
  },
};

/* ─────────────────────── STATE ─────────────────────── */
let manifest = null;
try {
  manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
} catch (e) {
  console.error('FATAL: cannot read blocks/_manifest.json', e.message);
  process.exit(1);
}

/* Current state: feature kinds + per-block toggle overrides. */
const state = {
  features: [],                     // [{kind, label}, …]
  blockOverrides: new Map(),        // blockName → true/false (override default enabled)
  buildTs: 0,
  buildHtml: '',
  buildError: null,
};

const sseClients = new Set();
function sseBroadcast(eventName, dataObj) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(dataObj)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch (_) { sseClients.delete(res); }
  }
}

/* ─────────────────────── BUILD PIPELINE ─────────────────────── */
function currentModel() {
  const m = JSON.parse(JSON.stringify(BASE_MODEL));
  m.features = state.features.slice();
  /* Per-block toggle overrides: set model[blockName] = { enabled: bool } */
  for (const [blockName, on] of state.blockOverrides) {
    m[blockName] = { enabled: !!on };
  }
  return m;
}

let buildTimer = null;
function scheduleRebuild(reason) {
  if (buildTimer) clearTimeout(buildTimer);
  buildTimer = setTimeout(() => doBuild(reason), 250);
}

function doBuild(reason) {
  const t0 = Date.now();
  const model = currentModel();
  try {
    const html = buildSlotHTML(model);
    state.buildHtml = html;
    state.buildError = null;
    state.buildTs = Date.now();
    const ms = Date.now() - t0;
    console.log(C.green('  ✓ rebuild') + C.dim(` (${reason}, ${ms}ms, ${html.length} bytes)`));
    sseBroadcast('rebuild_done', { ts: state.buildTs, ms, bytes: html.length, reason });
  } catch (e) {
    state.buildError = String(e.message || e);
    console.error('  ✗ rebuild FAILED:', state.buildError.slice(0, 200));
    sseBroadcast('rebuild_failed', { error: state.buildError });
  }
}

/* Initial build. */
doBuild('boot');

/* ─────────────────────── BLOCK CATEGORIZATION ─────────────────────── */
function categorize(b) {
  const n = b.name.toLowerCase();
  const desc = (b.description || '').toLowerCase();
  if (b.category && b.category !== 'uncategorised') return b.category;
  if (/multipl|mult|orb|ladder/.test(n)) return 'multiplier';
  if (/win|payline|cluster|ways|payout|highlight/.test(n)) return 'win-presentation';
  if (/free|fs|spin/.test(n)) return 'free-spins';
  if (/wild|sticky|mystery|expand|walk/.test(n)) return 'wild';
  if (/hold|hnw/.test(n)) return 'hold-and-win';
  if (/wheel|gamble|jackpot|bonus/.test(n)) return 'bonus';
  if (/touch|tap|swipe|haptic|key/.test(n)) return 'input';
  if (/audio|sound/.test(n)) return 'audio';
  if (/scatter|anticipation|trigger/.test(n)) return 'scatter-fs';
  if (/big|tier|celebration|rollup|skip/.test(n)) return 'celebration';
  if (/auto|autoplay|turbo|quick|slam/.test(n)) return 'control';
  if (/cascade|tumble|gravity|drop|refill/.test(n)) return 'cascade';
  if (/reel|symbol|engine/.test(n)) return 'engine';
  if (/regulator|jurisdiction|reality|session|self/.test(n)) return 'regulatory';
  if (/theme|css|font|color|palette/.test(n)) return 'theming';
  if (/hub|hud|bet|balance|panel|button|btn/.test(n)) return 'hud';
  if (/lego|globals|hook|orchestr/.test(n)) return 'infrastructure';
  return 'other';
}

const blocksByCategory = new Map();
for (const b of manifest.blocks) {
  const cat = categorize(b);
  if (!blocksByCategory.has(cat)) blocksByCategory.set(cat, []);
  blocksByCategory.get(cat).push({
    name: b.name,
    desc: (b.description || '').replace(/\s+/g, ' ').slice(0, 120),
    defaultEnabled: !!(b.defaultConfig && b.defaultConfig.enabled === true),
    hooks: b.lifecycleHooks || [],
  });
}

/* ─────────────────────── UI HTML ─────────────────────── */
function uiHtml() {
  const categoryOrder = [
    'win-presentation', 'multiplier', 'free-spins', 'scatter-fs', 'celebration',
    'wild', 'hold-and-win', 'bonus', 'cascade', 'engine',
    'control', 'input', 'audio', 'hud', 'theming',
    'regulatory', 'infrastructure', 'other',
  ];
  const cats = categoryOrder
    .filter(c => blocksByCategory.has(c))
    .map(c => ({ cat: c, blocks: blocksByCategory.get(c).sort((a, b) => a.name.localeCompare(b.name)) }));

  const presetButtons = Object.entries(PRESETS)
    .map(([id, p]) => `<button data-preset="${id}" class="preset-btn">${p.label}</button>`)
    .join('');

  const blockList = cats.map(({ cat, blocks }) => `
    <details open class="cat" data-cat="${cat}">
      <summary>${cat} <span class="count">${blocks.length}</span></summary>
      <div class="blocks">
        ${blocks.map(b => `
          <label class="block-row" data-name="${b.name}">
            <input type="checkbox" data-block="${b.name}" ${b.defaultEnabled ? 'checked' : ''} />
            <span class="bname">${b.name}</span>
            ${b.defaultEnabled ? '<span class="badge def">def</span>' : ''}
            ${b.hooks.length ? `<span class="badge hook">${b.hooks.length}</span>` : ''}
            <span class="desc" title="${b.desc.replace(/"/g, '&quot;')}">${b.desc}</span>
          </label>
        `).join('')}
      </div>
    </details>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>LEGO Block Sandbox</title>
<style>
  :root {
    --bg: #0e1116; --panel: #181c24; --line: #2a3142; --accent: #c9a227;
    --green: #66cc88; --red: #ff5566; --dim: #8a93a6; --txt: #e6e8ec;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--txt); font: 13px/1.4 system-ui, -apple-system, Segoe UI; }
  .layout { display: grid; grid-template-columns: 360px 1fr 380px; height: 100vh; }
  header { grid-column: 1/-1; background: var(--panel); padding: 8px 14px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid var(--line); }
  header h1 { margin: 0; font: 600 14px/1 system-ui; color: var(--accent); }
  header .stat { color: var(--dim); font: 11px monospace; }
  .layout { grid-template-rows: 44px 1fr; }

  /* LEFT — block toggles */
  aside.left { background: var(--panel); border-right: 1px solid var(--line); overflow-y: auto; }
  .search-row { padding: 10px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--panel); z-index: 5; }
  .search-row input { width: 100%; background: #0a0d12; border: 1px solid var(--line); color: var(--txt); padding: 6px 10px; border-radius: 4px; font: 12px monospace; }
  .preset-row { padding: 6px 10px; border-bottom: 1px solid var(--line); display: flex; flex-wrap: wrap; gap: 4px; }
  .preset-btn { background: #1f2632; border: 1px solid var(--line); color: var(--txt); font-size: 10px; padding: 4px 8px; border-radius: 3px; cursor: pointer; }
  .preset-btn:hover { background: #2a3242; border-color: var(--accent); }
  details.cat { border-bottom: 1px solid #1a1f28; }
  details.cat summary { padding: 8px 12px; cursor: pointer; font-weight: 600; text-transform: uppercase; font-size: 11px; color: var(--accent); user-select: none; }
  details.cat summary .count { color: var(--dim); margin-left: 6px; font-weight: 400; }
  .blocks { padding: 4px 0; }
  .block-row { display: grid; grid-template-columns: 24px 1fr; padding: 4px 12px; gap: 6px; cursor: pointer; align-items: center; border-radius: 3px; line-height: 1.3; }
  .block-row:hover { background: #1f2632; }
  .block-row input { width: 16px; height: 16px; accent-color: var(--accent); cursor: pointer; }
  .block-row .bname { font: 600 12px monospace; color: var(--txt); grid-column: 2; }
  .block-row .badge { font: 9px monospace; padding: 1px 5px; border-radius: 2px; margin-left: 4px; }
  .badge.def { background: #2a3a52; color: #88aacc; }
  .badge.hook { background: #2a4a2a; color: #88cc88; }
  .block-row .desc { grid-column: 2; font-size: 11px; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .block-row.hidden { display: none; }

  /* CENTER — preview */
  main.center { display: flex; flex-direction: column; background: #0a0d12; }
  .toolbar { padding: 6px 14px; background: var(--panel); border-bottom: 1px solid var(--line); display: flex; gap: 8px; align-items: center; }
  .toolbar button { background: #1f2632; border: 1px solid var(--line); color: var(--txt); font-size: 11px; padding: 4px 10px; border-radius: 3px; cursor: pointer; }
  .toolbar button:hover { background: #2a3242; }
  .toolbar .build-status { margin-left: auto; font: 11px monospace; color: var(--green); }
  .toolbar .build-status.fail { color: var(--red); }
  iframe { flex: 1; border: 0; background: white; }

  /* RIGHT — console + hookbus */
  aside.right { background: var(--panel); border-left: 1px solid var(--line); display: flex; flex-direction: column; }
  .tab-row { display: flex; border-bottom: 1px solid var(--line); }
  .tab-row button { flex: 1; background: #181c24; border: 0; color: var(--dim); font: 600 11px system-ui; padding: 8px; cursor: pointer; }
  .tab-row button.active { color: var(--accent); border-bottom: 2px solid var(--accent); }
  .panel { flex: 1; overflow-y: auto; padding: 8px 10px; font: 11px monospace; }
  .panel.hidden { display: none; }
  .log-line { padding: 2px 0; border-bottom: 1px solid #181c24; word-break: break-all; }
  .log-line.error { color: var(--red); }
  .log-line.event { color: #88aacc; }
  .log-line.info { color: var(--dim); }
  .clear-btn { background: #1f2632; border: 1px solid var(--line); color: var(--txt); padding: 4px 8px; font-size: 10px; cursor: pointer; }
</style>
</head>
<body>
  <div class="layout">
    <header>
      <h1>🧩 LEGO Block Sandbox</h1>
      <span class="stat" id="statBlocks">${manifest.blocks.length} blokova</span>
      <span class="stat" id="statActive">0 enabled</span>
      <span class="stat" id="statTopology">5×3 rectangular</span>
      <span class="stat" id="statBuild" style="margin-left:auto;color:#66cc88">building…</span>
    </header>

    <aside class="left">
      <div class="search-row">
        <input id="search" type="text" placeholder="Search 184 blocks (name, desc, hook)…" />
      </div>
      <div class="preset-row">${presetButtons}</div>
      <div id="blockList">${blockList}</div>
    </aside>

    <main class="center">
      <div class="toolbar">
        <button id="reloadBtn">🔄 Reload preview</button>
        <button id="downloadBtn">⬇ Download HTML</button>
        <button id="resetBtn">🗑 Reset all</button>
        <span class="build-status" id="buildStatus">idle</span>
      </div>
      <iframe id="preview" src="/preview"></iframe>
    </main>

    <aside class="right">
      <div class="tab-row">
        <button class="active" data-tab="events">HookBus</button>
        <button data-tab="errors">Errors</button>
        <button data-tab="state">State</button>
      </div>
      <div class="panel" id="panel-events"></div>
      <div class="panel hidden" id="panel-errors"></div>
      <div class="panel hidden" id="panel-state"></div>
    </aside>
  </div>

<script>
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const STORAGE_KEY = 'lego-sandbox-state-v1';

/* ───── SSE ───── */
const es = new EventSource('/events');
es.addEventListener('rebuild_done', e => {
  const d = JSON.parse(e.data);
  $('#buildStatus').textContent = '✓ built ' + d.bytes.toLocaleString() + 'B in ' + d.ms + 'ms';
  $('#buildStatus').classList.remove('fail');
  $('#preview').src = '/preview?ts=' + d.ts;
});
es.addEventListener('rebuild_failed', e => {
  const d = JSON.parse(e.data);
  $('#buildStatus').textContent = '✗ FAIL — ' + d.error.slice(0, 80);
  $('#buildStatus').classList.add('fail');
  log('error', '[BUILD FAIL] ' + d.error);
});

/* ───── State save/restore ───── */
function saveState() {
  const blocks = {};
  $$('input[data-block]').forEach(cb => {
    blocks[cb.dataset.block] = cb.checked;
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ blocks, features: currentFeatures }));
}
function restoreState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (s.blocks) for (const [name, on] of Object.entries(s.blocks)) {
      const cb = document.querySelector('input[data-block="' + name + '"]');
      if (cb) cb.checked = on;
    }
    if (Array.isArray(s.features)) currentFeatures = s.features.slice();
  } catch (_) {}
}

/* ───── Feature kinds (extracted from preset buttons) ───── */
let currentFeatures = [];

/* ───── Toggle handler ───── */
async function pushState() {
  const blocks = {};
  $$('input[data-block]').forEach(cb => {
    if (!cb.matches(':indeterminate')) blocks[cb.dataset.block] = cb.checked;
  });
  saveState();
  await fetch('/state', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ blocks, features: currentFeatures }),
  });
  $('#statActive').textContent = Object.values(blocks).filter(Boolean).length + ' enabled';
}

document.addEventListener('change', e => {
  if (e.target.matches('input[data-block]')) {
    log('info', '[toggle] ' + e.target.dataset.block + ' = ' + e.target.checked);
    pushState();
  }
});

/* ───── Preset ───── */
document.addEventListener('click', e => {
  if (e.target.matches('.preset-btn')) {
    const id = e.target.dataset.preset;
    fetch('/preset?id=' + id, { method: 'POST' })
      .then(r => r.json())
      .then(d => {
        currentFeatures = d.features || [];
        log('info', '[preset] ' + id + ' → ' + currentFeatures.length + ' features');
        $('#statTopology').textContent = '5×3 rectangular · ' + currentFeatures.map(f => f.kind).join(', ');
        saveState();
      });
  }
});

/* ───── Search ───── */
$('#search').addEventListener('input', e => {
  const q = e.target.value.toLowerCase().trim();
  $$('.block-row').forEach(row => {
    const txt = row.dataset.name.toLowerCase() + ' ' + (row.querySelector('.desc')?.textContent || '').toLowerCase();
    row.classList.toggle('hidden', q && !txt.includes(q));
  });
});

/* ───── Console panel ───── */
const panels = { events: $('#panel-events'), errors: $('#panel-errors'), state: $('#panel-state') };
function log(kind, msg) {
  const panel = kind === 'error' ? panels.errors : panels.events;
  const line = document.createElement('div');
  line.className = 'log-line ' + kind;
  line.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
  panel.appendChild(line);
  panel.scrollTop = panel.scrollHeight;
  while (panel.children.length > 500) panel.removeChild(panel.firstChild);
}

$$('.tab-row button').forEach(btn => btn.addEventListener('click', () => {
  $$('.tab-row button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  Object.entries(panels).forEach(([k, p]) => p.classList.toggle('hidden', k !== btn.dataset.tab));
}));

/* ───── Toolbar ───── */
$('#reloadBtn').addEventListener('click', () => { $('#preview').src = '/preview?ts=' + Date.now(); });
$('#resetBtn').addEventListener('click', () => {
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
});
$('#downloadBtn').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = '/preview';
  a.download = 'lego-sandbox-slot.html';
  a.click();
});

/* ───── Cross-frame HookBus emit listener ───── */
window.addEventListener('message', e => {
  if (!e.data || typeof e.data !== 'object') return;
  if (e.data.kind === 'hookbus') log('event', e.data.event + ' ' + JSON.stringify(e.data.payload || {}).slice(0, 140));
  if (e.data.kind === 'error') log('error', e.data.msg);
});

/* ───── State panel ───── */
function refreshStatePanel() {
  fetch('/state').then(r => r.json()).then(s => {
    panels.state.innerHTML = '<pre style="margin:0;white-space:pre-wrap;color:#88aacc;font-size:11px">' +
      JSON.stringify(s, null, 2).replace(/</g, '&lt;') + '</pre>';
  });
}
setInterval(refreshStatePanel, 2000);

/* Initial restore. */
restoreState();
pushState();
log('info', 'Sandbox ready. Toggle blocks left, preview center, events right.');
</script>
</body>
</html>`;
}

/* ─────────────────────── HTTP HANDLERS ─────────────────────── */
function parseBody(req) {
  return new Promise((res, rej) => {
    let chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { res(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { rej(e); }
    });
    req.on('error', rej);
  });
}

/* Inject parent.postMessage forwarder into preview HTML so iframe HookBus
   emits stream back to sandbox event panel. */
function injectForwarder(html) {
  const forwarder = `
<script>
(function () {
  if (!window.parent || window.parent === window) return;
  window.addEventListener('error', e => {
    try { window.parent.postMessage({ kind: 'error', msg: (e.message || 'err') + ' @ ' + (e.filename || '?') + ':' + (e.lineno || 0) }, '*'); } catch (_) {}
  });
  function hook() {
    if (!window.HookBus || !window.HookBus.emit) { setTimeout(hook, 200); return; }
    const orig = window.HookBus.emit;
    window.HookBus.emit = function (name, payload) {
      try { window.parent.postMessage({ kind: 'hookbus', event: name, payload: payload }, '*'); } catch (_) {}
      return orig.apply(this, arguments);
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook);
  else hook();
})();
</script>`;
  return html.replace('</body>', forwarder + '</body>');
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(uiHtml());
    return;
  }

  if (url.pathname === '/preview' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (state.buildError) {
      res.end(`<pre style="color:#ff5566;padding:20px;font:13px monospace;background:#0e1116">BUILD ERROR:\n${state.buildError}</pre>`);
    } else {
      res.end(injectForwarder(state.buildHtml));
    }
    return;
  }

  if (url.pathname === '/state' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      features: state.features,
      blockOverrides: Object.fromEntries(state.blockOverrides),
      buildTs: state.buildTs,
      buildOk: !state.buildError,
      buildError: state.buildError,
    }, null, 2));
    return;
  }

  if (url.pathname === '/state' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      if (body.blocks && typeof body.blocks === 'object') {
        state.blockOverrides.clear();
        for (const [name, on] of Object.entries(body.blocks)) {
          state.blockOverrides.set(name, !!on);
        }
      }
      if (Array.isArray(body.features)) state.features = body.features.slice();
      scheduleRebuild('state-update');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  }

  if (url.pathname === '/preset' && req.method === 'POST') {
    const id = url.searchParams.get('id');
    const preset = PRESETS[id];
    if (!preset) {
      res.writeHead(404);
      res.end(JSON.stringify({ ok: false, error: 'unknown preset' }));
      return;
    }
    state.features = preset.features.slice();
    scheduleRebuild('preset-' + id);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, features: state.features }));
    return;
  }

  if (url.pathname === '/events' && req.method === 'GET') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'connection': 'keep-alive',
    });
    res.write(': sandbox-sse ready\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(C.bold(C.cyan(`\n🧩 LEGO Block Sandbox`)));
  console.log(C.green(`  http://127.0.0.1:${PORT}`));
  console.log(C.dim(`  ${manifest.blocks.length} blokova grupisanih u ${blocksByCategory.size} kategorija`));
  console.log(C.dim(`  Presets: ${Object.keys(PRESETS).join(', ')}`));
  console.log(C.dim(`  Otvori URL u browseru — left panel = toggle blokove · center = live preview · right = HookBus events\n`));
});
