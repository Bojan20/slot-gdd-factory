#!/usr/bin/env node
/**
 * tools/live-gdd-editor.mjs
 *
 * Wave T2 — Live GDD editor with instant render preview.
 *
 * Usage:
 *   node tools/live-gdd-editor.mjs [--port 4321] [--gdd path/to.md]
 *
 * What it does:
 *   Spawns a tiny zero-dep HTTP server. The page is split:
 *     • Left:  editable <textarea> seeded with the GDD content.
 *     • Right: <iframe> showing the rendered slot.
 *
 *   Edits in the textarea trigger a debounced POST /render which
 *   parses + rebuilds the HTML and pushes back via SSE → iframe
 *   reloads with the new build. No browser refresh, no manual save.
 *
 *   Status pill shows parse / build state (idle / parsing / built /
 *   error) so operators see fast feedback.
 *
 * Senior-grade:
 *   • Single responsibility — editor server, no auth / persistence.
 *   • 0 external deps (Node 22+ http + fs).
 *   • Vendor-neutral — no studio/IP names in served HTML.
 *   • DEV-ONLY — bind to 127.0.0.1, never 0.0.0.0.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const C = {
  green:  s => `\x1b[32m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  dim:    s => `\x1b[2m${s}\x1b[0m`,
};

function _arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const PORT = Number(_arg('--port', '4321'));
const GDD  = path.resolve(_arg('--gdd', path.join(REPO, 'samples', 'WRATH_OF_OLYMPUS_GAME_GDD.md')));

if (!existsSync(GDD)) {
  console.error(C.red(`GDD not found: ${GDD}`));
  process.exit(1);
}

const initialGdd = readFileSync(GDD, 'utf8');

/* Lazy import of parser + builder — keeps server cold-start fast. */
const [parser, builder] = await Promise.all([
  import(pathToFileURL(path.join(REPO, 'src', 'parser.mjs')).href),
  import(pathToFileURL(path.join(REPO, 'src', 'buildSlotHTML.mjs')).href),
]);

let currentHTML = '';
try {
  currentHTML = builder.buildSlotHTML(parser.parseGDD(initialGdd));
} catch (e) {
  console.warn(C.red(`initial build failed: ${e.message} — editor will start with empty preview`));
}

const sseClients = new Set();

function _broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch (_) { sseClients.delete(res); }
  }
}

function _editorPage() {
  const gddEsc = initialGdd.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Live GDD editor · slot-gdd-factory</title>
<style>
  :root { color-scheme: dark; }
  html, body { margin: 0; height: 100%; background: #0b0f16; color: #f2f2f2;
               font-family: ui-monospace, monospace; }
  .root { display: grid; grid-template-columns: 1fr 1fr; height: 100vh; gap: 1px; background: #1a1f2c; }
  .pane { display: flex; flex-direction: column; min-height: 0; background: #0b0f16; }
  .pane header { padding: 8px 12px; background: rgba(201, 162, 39, 0.12); font-size: 13px; }
  .pane header .status { float: right; padding: 2px 8px; border-radius: 4px; font-size: 11px;
                         background: #2a3041; }
  .pane header .status[data-state="parsing"] { background: #2a4a3a; }
  .pane header .status[data-state="built"]   { background: #2a4a3a; color: #6cf18b; }
  .pane header .status[data-state="error"]   { background: #4a2a2a; color: #f56565; }
  textarea { flex: 1; width: 100%; background: #05070c; color: #f2f2f2;
             border: 0; outline: 0; padding: 10px 14px; font-family: inherit;
             font-size: 13px; line-height: 1.5; resize: none; }
  iframe { flex: 1; width: 100%; border: 0; background: #000; }
  .err { color: #f56565; padding: 8px 14px; font-size: 12px; }
  @media (max-width: 760px) { .root { grid-template-columns: 1fr; grid-template-rows: 1fr 1fr; } }
</style>
</head><body>
<div class="root">
  <div class="pane">
    <header>GDD source <span id="status" class="status" data-state="idle">idle</span></header>
    <textarea id="src" spellcheck="false">${gddEsc}</textarea>
    <div id="err" class="err"></div>
  </div>
  <div class="pane">
    <header>Live preview</header>
    <iframe id="prev" src="/preview"></iframe>
  </div>
</div>
<script>
(function() {
  var src = document.getElementById('src');
  var prev = document.getElementById('prev');
  var status = document.getElementById('status');
  var errEl = document.getElementById('err');
  var debounce = null;

  /* SSE — server tells us when a fresh build is ready. */
  var es = new EventSource('/events');
  es.addEventListener('built', function() {
    status.dataset.state = 'built';
    status.textContent = 'built ✓';
    errEl.textContent = '';
    prev.src = '/preview?v=' + Date.now();
  });
  es.addEventListener('error', function() {
    /* SSE 'error' event — could be parse fail OR transport error.
     * Distinguish via the lastEventId / data. */
  });
  es.addEventListener('builderror', function(e) {
    status.dataset.state = 'error';
    status.textContent = 'error';
    try { errEl.textContent = JSON.parse(e.data).message; } catch (_) {}
  });

  src.addEventListener('input', function() {
    clearTimeout(debounce);
    status.dataset.state = 'parsing';
    status.textContent = 'parsing…';
    debounce = setTimeout(function() {
      fetch('/render', { method: 'POST', body: src.value }).catch(function() {
        status.dataset.state = 'error';
        status.textContent = 'transport';
      });
    }, 200);
  });
})();
</script>
</body></html>`;
}

const server = createServer((req, res) => {
  const url = req.url || '/';

  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(_editorPage());
    return;
  }

  if (url.startsWith('/preview')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(currentHTML || '<html><body style="background:#000;color:#888;font-family:monospace;padding:20px">Awaiting first build…</body></html>');
    return;
  }

  if (url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write('retry: 2000\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (url === '/render' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += String(chunk); if (body.length > 4_000_000) req.destroy(); });
    req.on('end', () => {
      try {
        const model = parser.parseGDD(body);
        currentHTML = builder.buildSlotHTML(model);
        _broadcast('built', { ok: true });
        res.writeHead(204);
        res.end();
      } catch (e) {
        _broadcast('builderror', { message: e.message });
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(C.cyan(C.bold('\n📝 Live GDD editor — slot-gdd-factory\n')));
  console.log(C.dim(`   bound to 127.0.0.1:${PORT} (dev-only, never 0.0.0.0)`));
  console.log(C.dim(`   initial GDD: ${path.relative(REPO, GDD) || GDD}\n`));
  console.log(C.green(C.bold(`✅ open http://127.0.0.1:${PORT}/ in your browser.\n`)));
});
