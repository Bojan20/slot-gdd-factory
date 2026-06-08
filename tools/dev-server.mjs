#!/usr/bin/env node
/**
 * tools/dev-server.mjs
 *
 * Wave P8 — local dev server with hot-reload SSE (replaces
 * `python3 -m http.server` for the dev iteration loop).
 *
 * Surface (single Node process, zero external deps):
 *
 *   • Static file serving (anything below the repo root).
 *   • SSE endpoint  /__dev/events
 *       Streams `{type, category, path, text?, ext?}` events for every
 *       relevant on-disk change.
 *   • Watch tree    samples/  src/  app.js  index.html  blocks/
 *       Recursive `fs.watch` with debounce coalescing.
 *   • Sample GDD reader  /__dev/gdd?path=samples%2FCRYSTAL_FORGE_GAME_GDD.md
 *       Lets the page request the latest text content of any sample
 *       fixture for the in-page re-parse fast path.
 *
 * Categories (consumed by src/blocks/hotReload.mjs):
 *
 *   gdd          — samples/*.md / samples/*.json — fast in-page re-parse
 *   block        — src/blocks/*.mjs              — full reload
 *   orchestrator — src/buildSlotHTML.mjs         — full reload
 *   runtime      — src/runtime/*.mjs             — full reload
 *   parser       — src/parser.mjs                — full reload (fallback)
 *   sample       — anything else under samples/  — fast re-parse (same as gdd)
 *   asset        — anything else                  — full reload
 *
 * Cache headers:
 *
 *   Cache-Control: no-store on every static response. This is a DEV
 *   server — staleness costs more than network bytes.
 *
 * Usage:
 *
 *   npm run dev                    → listens on http://localhost:5180
 *   PORT=8080 npm run dev          → custom port
 *   npm run dev -- --silent        → suppress per-request log line
 *
 * Senior-grade rule (rule_senior_grade_code):
 *   • Single responsibility — static + SSE + watch, nothing else.
 *   • 0 external deps — pure Node 22+ (http, fs, path, url).
 *   • Defensive — file path normalization prevents .. traversal.
 *   • Idempotent — SIGINT closes server cleanly.
 *   • Vendor-neutral — no game / studio strings anywhere.
 *
 * Boki rule (08.06.2026, Pre-Math Roadmap, Faza 2 · P8):
 *   *"dinamicki uvek responzivno na svaki gdd moguci"* — this is the
 *   server side of the hot-reload loop; src/blocks/hotReload.mjs is
 *   the client side.
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const PORT = Number(process.env.PORT || 5180);
const HOST = process.env.HOST || '127.0.0.1';
const SILENT = process.argv.includes('--silent');

/* ─── mime ────────────────────────────────────────────────────────── */

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.htm':  'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.cjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md':   'text/markdown; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.wasm': 'application/wasm',
  '.map':  'application/json; charset=utf-8',
  '.pdf':  'application/pdf',
});

const DEFAULT_MIME = 'application/octet-stream';

/* ─── path safety ────────────────────────────────────────────────── */

/**
 * Resolve a URL path → on-disk absolute path under ROOT, or null if the
 * request would traverse outside ROOT. URL-decode first; reject NUL.
 */
export function safeResolve(urlPath, root = ROOT) {
  if (typeof urlPath !== 'string') return null;
  if (urlPath.indexOf('\0') >= 0) return null;
  let decoded;
  try { decoded = decodeURIComponent(urlPath); }
  catch (e) { return null; }
  /* strip query string just in case */
  const q = decoded.indexOf('?');
  if (q >= 0) decoded = decoded.slice(0, q);
  /* drop leading slash for join */
  while (decoded.startsWith('/')) decoded = decoded.slice(1);
  const resolved = path.resolve(root, decoded || 'index.html');
  if (!resolved.startsWith(root + path.sep) && resolved !== root) return null;
  return resolved;
}

/* ─── categorization ─────────────────────────────────────────────── */

/**
 * Classify a changed file path into a hot-reload category. Pure function;
 * unit-tested separately.
 */
export function categorize(relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) return 'asset';
  const p = relPath.replace(/\\/g, '/');
  if (p.startsWith('samples/')) {
    if (/\.(md|json|txt)$/i.test(p)) return 'gdd';
    return 'sample';
  }
  if (p === 'src/parser.mjs') return 'parser';
  if (p === 'src/buildSlotHTML.mjs') return 'orchestrator';
  if (p.startsWith('src/runtime/')) return 'runtime';
  if (p.startsWith('src/blocks/')) return 'block';
  if (p === 'app.js' || p === 'index.html') return 'orchestrator';
  return 'asset';
}

/* ─── SSE bus ────────────────────────────────────────────────────── */

const clients = new Set();

function sseBroadcast(event) {
  const payload = JSON.stringify(event);
  const frame = `data: ${payload}\n\n`;
  for (const res of clients) {
    try { res.write(frame); }
    catch (e) { /* dead socket — onclose will reap */ }
  }
}

function sseKeepalive() {
  sseBroadcast({ type: 'ping', at: Date.now() });
}

/* ─── watcher ────────────────────────────────────────────────────── */

const WATCH_TARGETS = [
  'samples',
  'src',
  'app.js',
  'index.html',
  'blocks',
];

const WATCH_DEBOUNCE_MS = 60;
const recentByPath = new Map();

async function readIfExists(absPath) {
  try { return await fsp.readFile(absPath, 'utf8'); }
  catch (e) { return null; }
}

async function handleChange(relPath) {
  const now = Date.now();
  const last = recentByPath.get(relPath) || 0;
  if (now - last < WATCH_DEBOUNCE_MS) return;
  recentByPath.set(relPath, now);
  const category = categorize(relPath);
  const ext = path.extname(relPath).slice(1).toLowerCase();
  const event = { type: 'change', category, path: relPath, ext, at: now };
  if (category === 'gdd' || category === 'sample') {
    const abs = path.join(ROOT, relPath);
    const text = await readIfExists(abs);
    if (text != null) event.text = text;
  }
  sseBroadcast(event);
  if (!SILENT) {
    console.log(`[dev] change · ${category.padEnd(12)} · ${relPath}`);
  }
}

function startWatcher() {
  for (const target of WATCH_TARGETS) {
    const abs = path.join(ROOT, target);
    if (!fs.existsSync(abs)) continue;
    try {
      const stat = fs.statSync(abs);
      const opts = stat.isDirectory() ? { recursive: true, persistent: true } : { persistent: true };
      fs.watch(abs, opts, (_event, filename) => {
        if (!filename) return;
        const rel = stat.isDirectory()
          ? path.join(target, String(filename)).replace(/\\/g, '/')
          : target;
        handleChange(rel).catch((e) => {
          if (!SILENT) console.error('[dev] watch error', e.message);
        });
      });
      if (!SILENT) console.log(`[dev] watching ${target}`);
    } catch (err) {
      console.error(`[dev] failed to watch ${target}:`, err.message);
    }
  }
}

/* ─── server ─────────────────────────────────────────────────────── */

async function serveStatic(req, res, urlPath) {
  const abs = safeResolve(urlPath);
  if (!abs) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('400 bad path');
    return;
  }
  let target = abs;
  try {
    const stat = await fsp.stat(abs);
    if (stat.isDirectory()) {
      target = path.join(abs, 'index.html');
    }
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    res.end('404 not found');
    return;
  }
  try {
    const data = await fsp.readFile(target);
    const ext = path.extname(target).toLowerCase();
    const mime = MIME[ext] || DEFAULT_MIME;
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-store',
      'X-Dev-Server': 'slot-gdd-factory/p8',
    });
    res.end(data);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('500 ' + err.message);
  }
}

function handleSSE(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 2000\n\n`);
  res.write(`data: ${JSON.stringify({ type: 'hello', at: Date.now() })}\n\n`);
  clients.add(res);
  const reap = () => { clients.delete(res); };
  req.on('close', reap);
  req.on('end', reap);
}

async function handleGddFetch(req, res, urlObj) {
  const reqPath = urlObj.searchParams.get('path');
  if (!reqPath || !reqPath.startsWith('samples/')) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'path must start with samples/' }));
    return;
  }
  const abs = safeResolve(reqPath);
  if (!abs) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unsafe path' }));
    return;
  }
  try {
    const text = await fsp.readFile(abs, 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ path: reqPath, text, at: Date.now() }));
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  }
}

function handleHealth(_req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({
    ok: true,
    clients: clients.size,
    at: Date.now(),
    root: ROOT,
  }));
}

export function createDevServer() {
  return http.createServer(async (req, res) => {
    const urlObj = new URL(req.url, `http://${req.headers.host || HOST}`);
    const p = urlObj.pathname;
    if (!SILENT) console.log(`[dev] ${req.method} ${p}`);
    if (p === '/__dev/events') return handleSSE(req, res);
    if (p === '/__dev/gdd') return handleGddFetch(req, res, urlObj);
    if (p === '/__dev/health') return handleHealth(req, res);
    return serveStatic(req, res, p);
  });
}

/* ─── entry point ────────────────────────────────────────────────── */

function isDirectInvocation() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch (e) {
    return false;
  }
}

if (isDirectInvocation()) {
  const server = createDevServer();
  server.listen(PORT, HOST, () => {
    console.log(`[dev] slot-gdd-factory dev server`);
    console.log(`[dev]   → http://${HOST}:${PORT}/`);
    console.log(`[dev]   → SSE  http://${HOST}:${PORT}/__dev/events`);
    console.log(`[dev]   → GDD  http://${HOST}:${PORT}/__dev/gdd?path=samples/...`);
  });
  startWatcher();
  const ka = setInterval(sseKeepalive, 25000);
  const shutdown = (sig) => {
    if (!SILENT) console.log(`[dev] ${sig} — closing`);
    clearInterval(ka);
    for (const res of clients) { try { res.end(); } catch (e) {} }
    clients.clear();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
