#!/usr/bin/env node
/**
 * tools/uq-webui-server.mjs
 *
 * UQ-WEBUI (MASTER_TODO P1) — Drag-drop ingest web UI.
 *
 * Spins up a tiny localhost server that serves a drop-target page;
 * dropped PDF/MD/JSON files are forwarded to `tools/ingest.mjs` and
 * the resulting slot.html shown in an embedded iframe.
 *
 * USAGE
 *   node tools/uq-webui-server.mjs                # default port 5500
 *   node tools/uq-webui-server.mjs --port 8080
 *
 * No external libs — pure node http + multipart parsing (small body
 * limit, just for GDDs ≤ 2 MB).
 */

import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');

const args = process.argv.slice(2);
const argVal = (flag) => {
  const a = args.find(x => x === flag || x.startsWith(flag + '='));
  return a ? (a.includes('=') ? a.split('=')[1] : args[args.indexOf(a) + 1]) : null;
};
const PORT = parseInt(argVal('--port') || '5500', 10);

const INDEX_HTML = `<!doctype html>
<html lang="sr">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>UQ-WEBUI · slot-gdd-factory ingest</title>
<style>
  :root { color-scheme: dark; }
  body { font: 13px/1.5 -apple-system, BlinkMacSystemFont, sans-serif; background: #05070c; color: #f0f0f0; margin: 0; padding: 20px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #888; font-size: 11px; margin-bottom: 20px; }
  .drop {
    border: 2px dashed #c9a227; border-radius: 12px; padding: 60px 20px;
    text-align: center; cursor: pointer; transition: background .15s;
    background: #0b0f16;
  }
  .drop.over { background: #1a1208; border-color: #f2c14e; }
  .drop p { margin: 8px 0; color: #888; }
  .drop p.big { font-size: 22px; color: #f2c14e; }
  .status { margin-top: 14px; padding: 10px 14px; background: #0d1117; border-radius: 8px; min-height: 30px; }
  iframe { width: 100%; height: 750px; border: 1px solid #1a2030; border-radius: 8px; margin-top: 14px; background: #fff; }
  .err { color: #ff6b6b; }
  .ok  { color: #4caf50; }
</style>
</head>
<body>
  <h1>UQ-WEBUI · slot-gdd-factory ingest</h1>
  <div class="meta">Drop GDD (.pdf / .md / .json / .txt) → playable slot HTML preview.</div>

  <div class="drop" id="drop">
    <p class="big">⤓ drag GDD ovde</p>
    <p>ili klikni da izabereš fajl</p>
    <input type="file" id="file" hidden accept=".pdf,.md,.json,.txt"/>
  </div>

  <div class="status" id="status">spreman</div>
  <iframe id="preview" srcdoc="<body style='font:14px sans-serif;color:#888;text-align:center;padding:60px'>preview after ingest</body>"></iframe>

<script>
  const drop = document.getElementById('drop');
  const fileInput = document.getElementById('file');
  const status = document.getElementById('status');
  const preview = document.getElementById('preview');

  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', e => {
    if (e.target.files[0]) upload(e.target.files[0]);
  });

  async function upload(file) {
    status.textContent = 'uploading ' + file.name + ' (' + (file.size/1024).toFixed(1) + ' KB) …';
    status.className = 'status';
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch('/ingest', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.ok) {
        status.innerHTML = '<span class="ok">✓ ingested</span> · ' +
          'features: ' + (data.features?.join(', ') || '—') + ' · ' +
          'topology: ' + (data.topology || '—') + ' · ' +
          'bytes: ' + (data.htmlBytes || 0);
        preview.src = data.slotUrl;
      } else {
        status.innerHTML = '<span class="err">✗ ' + (data.error || 'ingest failed') + '</span>';
      }
    } catch (e) {
      status.innerHTML = '<span class="err">✗ ' + e.message + '</span>';
    }
  }
</script>
</body>
</html>`;

/* Multipart parser — tiny, sufficient for single-file uploads. */
function parseMultipart(buf, boundary) {
  const bnd = Buffer.from('--' + boundary);
  const end = Buffer.from('--' + boundary + '--');
  const parts = [];
  let i = buf.indexOf(bnd);
  while (i !== -1) {
    const next = buf.indexOf(bnd, i + bnd.length);
    if (next === -1) break;
    let chunk = buf.slice(i + bnd.length, next);
    if (chunk[0] === 0x0d) chunk = chunk.slice(2);
    if (chunk[chunk.length - 1] === 0x0a) chunk = chunk.slice(0, -2);
    const hdrEnd = chunk.indexOf(Buffer.from('\r\n\r\n'));
    if (hdrEnd === -1) { i = next; continue; }
    const headers = chunk.slice(0, hdrEnd).toString('utf-8');
    const body = chunk.slice(hdrEnd + 4);
    const fnameMatch = headers.match(/filename="([^"]+)"/);
    if (fnameMatch) parts.push({ filename: fnameMatch[1], data: body });
    i = next;
  }
  return parts;
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(INDEX_HTML);
    return;
  }
  if (req.method === 'GET' && req.url.startsWith('/preview/')) {
    const path = decodeURIComponent(req.url.slice(9));
    if (!path.startsWith('/tmp/uq-webui-')) { res.statusCode = 403; res.end(); return; }
    if (!existsSync(path)) { res.statusCode = 404; res.end(); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(readFileSync(path));
    return;
  }
  if (req.method === 'POST' && req.url === '/ingest') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      const ctype = req.headers['content-type'] || '';
      const bnd = ctype.match(/boundary=([^;]+)/)?.[1];
      if (!bnd) { res.statusCode = 400; return res.end(JSON.stringify({ ok: false, error: 'no boundary' })); }
      const parts = parseMultipart(buf, bnd);
      if (!parts.length) { res.statusCode = 400; return res.end(JSON.stringify({ ok: false, error: 'no file' })); }
      const fp = parts[0];
      const tmpDir = mkdtempSync(join(tmpdir(), 'uq-webui-'));
      const inPath = join(tmpDir, fp.filename);
      writeFileSync(inPath, fp.data);

      /* Invoke tools/ingest.mjs synchronously. */
      const r = spawnSync('node', ['tools/ingest.mjs', '--file', inPath, '--out', tmpDir, '--no-llm'],
                          { cwd: REPO, encoding: 'utf-8' });
      if (r.status !== 0) {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ ok: false, error: 'ingest failed: ' + r.stderr.slice(-300) }));
      }
      const slotFile = readdirSync(tmpDir).find(f => f === 'slot.html');
      const modelFile = readdirSync(tmpDir).find(f => f === 'model.json');
      if (!slotFile) {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ ok: false, error: 'no slot.html produced' }));
      }
      const slotPath = join(tmpDir, slotFile);
      const htmlBytes = statSync(slotPath).size;
      let features = [], topology = '?';
      if (modelFile) {
        try {
          const m = JSON.parse(readFileSync(join(tmpDir, modelFile), 'utf-8'));
          features = (m.features || []).map(f => f.kind || f).filter(Boolean).slice(0, 8);
          topology = `${m.topology?.reels}×${m.topology?.rows} ${m.topology?.evaluation}`;
        } catch {}
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        ok: true, slotUrl: '/preview' + slotPath, features, topology, htmlBytes,
      }));
    });
    return;
  }
  res.statusCode = 404;
  res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`✓ UQ-WEBUI listening on http://127.0.0.1:${PORT}`);
  console.log('  Press Ctrl-C to stop.');
});
