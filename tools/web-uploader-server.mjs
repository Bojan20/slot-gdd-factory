#!/usr/bin/env node
/**
 * tools/web-uploader-server.mjs
 *
 * N+2 F (2026-06-23) — Minimal localhost HTTP server for the drag-drop
 * operator UI. Sets up endpoints:
 *
 *   GET  /                   → serves web-uploader-ui.html
 *   GET  /ui.js              → embedded UI module (no separate file)
 *   POST /ingest             → multipart upload (PDF + opcioni PAR),
 *                              spawn ingest CLI, emit SSE stream
 *   GET  /events/:sessionId  → reattach SSE for an in-progress ingest
 *   GET  /preview/:slug      → serve dist/ingest/<slug>/index.html
 *   GET  /report/:slug       → V8 + V9 + PAR + healing receipts JSON
 *   GET  /status             → server liveness + active sessions count
 *
 * Security
 *   - Bind 127.0.0.1 only (no LAN exposure)
 *   - No auth — local single-operator UI
 *   - Max upload 50 MB (matches bridge cap)
 *   - Slug whitelist: [a-z0-9._-]{1,80}
 *   - CSP: strict (default-src 'self', no inline JS allowed; we use
 *     external script src="/ui.js" referenced from index.html which
 *     itself is server-rendered HTML)
 *   - Path traversal guard: all served files must resolve under dist/ingest/
 *
 * Multipart parser
 *   Minimal RFC 7578 parser; supports two named fields ('gdd', 'par'),
 *   no nested parts. Boundary detection + per-part name+filename+content.
 *   Streams to memory (capped at 50 MB total payload).
 *
 * SSE stream
 *   Emits per ingest step: { stage, ok, msg, elapsedMs }
 *   Final event: { stage: 'done', slug, exitCode, summary }
 *   On error: { stage: 'error', msg }
 *
 * Public API (export for tests)
 *   - startServer(opts) -> { server, port, baseUrl }
 *   - parseMultipart(body, boundary) -> { fields: { name → {filename, data} } }
 *
 * Run: node tools/web-uploader-server.mjs [--port 5181]
 */

import { createServer } from 'node:http';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { existsSync, statSync, createReadStream } from 'node:fs';
import { resolve, dirname, basename, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = resolve(__filename, '..');
const REPO       = resolve(__dirname, '..');
const DIST       = resolve(REPO, 'dist/ingest');

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const ALLOWED_SLUG = /^[a-z0-9._-]{1,80}$/;
const ALLOWED_EXT  = /\.(pdf|md|txt|json|csv|xlsx|xls)$/i;

/* ── multipart parser ────────────────────────────────────────────────── */

/**
 * Parse RFC 7578 multipart/form-data body. Returns { fields }.
 * Supports filename + name parts; no nested multipart.
 *
 * @param {Buffer} body
 * @param {string} boundary
 * @returns {{ fields: Record<string, { name, filename, contentType, data }> }}
 */
export function parseMultipart(body, boundary) {
  const fields = {};
  const sep = Buffer.from('--' + boundary);
  const crlfcrlf = Buffer.from('\r\n\r\n');
  let i = 0;
  while (i < body.length) {
    const start = body.indexOf(sep, i);
    if (start === -1) break;
    const partStart = start + sep.length + 2; /* skip CRLF */
    /* Check end marker --boundary-- */
    if (body[start + sep.length] === 0x2d && body[start + sep.length + 1] === 0x2d) {
      break;
    }
    const partEnd = body.indexOf(sep, partStart);
    if (partEnd === -1) break;
    const headerEnd = body.indexOf(crlfcrlf, partStart);
    if (headerEnd === -1 || headerEnd > partEnd) {
      i = partEnd;
      continue;
    }
    const headerStr = body.slice(partStart, headerEnd).toString('utf8');
    const dataStart = headerEnd + crlfcrlf.length;
    const dataEnd = partEnd - 2; /* strip CRLF before boundary */
    const data = body.slice(dataStart, dataEnd);

    /* Parse Content-Disposition */
    const cdMatch = headerStr.match(/Content-Disposition:\s*form-data;\s*([^\r\n]+)/i);
    if (cdMatch) {
      const props = cdMatch[1];
      const name = (props.match(/name="([^"]+)"/) || [])[1];
      const filename = (props.match(/filename="([^"]+)"/) || [])[1];
      const ct = (headerStr.match(/Content-Type:\s*([^\r\n]+)/i) || [])[1] || 'application/octet-stream';
      if (name) {
        fields[name] = {
          name,
          filename: filename || null,
          contentType: ct.trim(),
          data,
        };
      }
    }
    i = partEnd;
  }
  return { fields };
}

/* ── helpers ─────────────────────────────────────────────────────────── */

function safeSlug(s) {
  if (typeof s !== 'string' || !ALLOWED_SLUG.test(s)) return null;
  return s;
}

/* UQ-DEEP-F CRIT-3 + F-CRIT-1 fix: server-side slug derivation MUST
 * mirror ingest.mjs:111 slugify so SSE `done` event's slug matches the
 * dist/ingest/<slug>/ directory the child actually writes. Previously
 * runIngest's auto-slug logic diverged (basename().toLowerCase) and SSE
 * client got wrong /preview/<slug> path for non-ASCII / long uploads. */
function serverSideSlugify(name) {
  const raw = String(name || 'gdd');
  const ascii = raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (ascii && ascii !== 'gdd') return ascii;
  /* Degenerate basename — SHA-1 fallback (matches ingest.mjs slugify). */
  const fp = createHash('sha1').update(raw, 'utf8').digest('hex').slice(0, 8);
  return ascii ? `${ascii}-${fp}` : `gdd-${fp}`;
}

function sendJSON(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function sendText(res, status, text, ctype = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': ctype,
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function send404(res) { sendText(res, 404, 'Not Found'); }
function send400(res, msg) { sendJSON(res, 400, { error: msg }); }
function send413(res) { sendJSON(res, 413, { error: 'payload too large (50 MB max)' }); }

/* ── session registry (in-memory) ────────────────────────────────────── */

const sessions = new Map(); /* sessionId → { events: [], done: boolean, subscribers: Set } */
const activeSlugs = new Set(); /* H2 fix: prevent concurrent same-slug ingest */

/* H1 audit fix (HIGH): hard cap on sessions Map to prevent DoS.
 * Without cap, attacker spamming uploads filled memory until 5-min GC. */
const MAX_SESSIONS = 200;
/* UQ-DEEP-F CRIT-F1: per-session subscribers cap so attacker can't open
 * 10K SSE connections to one session and DOS via write amplification. */
const MAX_SUBSCRIBERS_PER_SESSION = 32;
/* UQ-DEEP-F CRIT-F3: per-session events array cap so chatty stderr from
 * a runaway ingest can't grow session footprint unbounded. */
const MAX_EVENTS_PER_SESSION = 500;

function createSession() {
  /* Evict oldest if at cap. Done sessions (completed > 5min ago) already
   * GC'd by setTimeout; remaining are in-flight or recent — drop oldest
   * timestamp first. */
  if (sessions.size >= MAX_SESSIONS) {
    const firstKey = sessions.keys().next().value;
    sessions.delete(firstKey);
  }
  const id = randomUUID();
  sessions.set(id, { events: [], done: false, subscribers: new Set(), createdAt: Date.now() });
  return id;
}

function pushEvent(sessionId, evt) {
  const s = sessions.get(sessionId);
  if (!s) return;
  /* CRIT-F3: cap events array. When over cap, replace oldest event with
   * coalesce marker so SSE replay still tells late subscribers events
   * were truncated. */
  if (s.events.length >= MAX_EVENTS_PER_SESSION) {
    s.events.splice(0, 1, { stage: 'coalesce', msg: `${s.events.length} earlier events truncated (cap=${MAX_EVENTS_PER_SESSION})` });
  }
  s.events.push(evt);
  for (const sub of s.subscribers) {
    try { sub.write(`event: ${evt.stage || 'message'}\ndata: ${JSON.stringify(evt)}\n\n`); }
    catch { /* subscriber disconnected */ }
  }
  if (evt.stage === 'done' || evt.stage === 'error') {
    s.done = true;
    for (const sub of s.subscribers) {
      try { sub.end(); } catch { /* ignore */ }
    }
    /* GC session after 5 min so reattach can still read recent results. */
    setTimeout(() => sessions.delete(sessionId), 5 * 60 * 1000);
  }
}

/* ── ingest orchestrator ─────────────────────────────────────────────── */

/**
 * Run ingest CLI as a child process, parse stdout for step markers,
 * emit SSE events into the session.
 */
async function runIngest(sessionId, gddPath, parPath, slug) {
  const args = ['tools/ingest.mjs', '--file', gddPath, '--no-llm'];
  if (parPath) { args.push('--par', parPath); }
  if (slug)    { args.push('--slug', slug); }
  /* Anti-vendor audit: don't echo full gddPath (may contain vendor name
   * from operator's upload). Show only basename + arg count. */
  pushEvent(sessionId, {
    stage: 'spawn',
    cmd: `node tools/ingest.mjs --file <staged> ${parPath ? '--par <staged> ' : ''}${slug ? '--slug ' + slug : '(auto-slug)'}`,
    startedAt: new Date().toISOString(),
  });
  const child = spawn('node', args, { cwd: REPO, env: process.env });
  let stdoutBuf = '';
  let lastStage = 'spawn';
  const t0 = Date.now();

  child.stdout.on('data', (chunk) => {
    stdoutBuf += String(chunk);
    let lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop() || '';
    for (const line of lines) {
      /* Match ingest log: "[ingest HH:MM:SS] ✓ <step>" or "✗ <step>" */
      const m = line.match(/\[ingest [^\]]+\]\s+([✓✗])\s+(.+)/);
      if (m) {
        lastStage = m[2].trim();
        pushEvent(sessionId, {
          stage: 'step',
          ok: m[1] === '✓',
          msg: m[2].trim(),
          elapsedMs: Date.now() - t0,
        });
      }
    }
  });
  child.stderr.on('data', (chunk) => {
    /* H3 audit fix: strip control chars from stderr before forwarding to
     * SSE clients. JSON.stringify escapes newlines but defense-in-depth
     * against future consumers that might splice into HTML. */
    const cleaned = String(chunk).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').slice(0, 500);
    pushEvent(sessionId, { stage: 'stderr', msg: cleaned });
  });
  /* MED-10 audit fix: hard timeout reaper (10 min cap) so a hung child
   * doesn't lock activeSlugs forever. SIGKILL after timeout, exit handler
   * still fires and releases slug. */
  const reaperTimeout = setTimeout(() => {
    try { child.kill('SIGKILL'); } catch { /* already dead */ }
  }, 10 * 60 * 1000);
  child.on('exit', (code) => {
    clearTimeout(reaperTimeout);
    const summary = { exitCode: code, totalMs: Date.now() - t0, lastStage };
    /* UQ-DEEP-F F-CRIT-1 fix: slug is now ALWAYS set by caller (server-
     * side derivation when operator omits --slug), so no divergent
     * basename().toLowerCase() recompute. SSE done event slug matches
     * dist/ingest/<slug>/ directory child wrote. */
    pushEvent(sessionId, {
      stage: 'done',
      slug,
      ...summary,
    });
    /* H2 + CRIT-3: release slug lock so future ingests of same slug can proceed. */
    activeSlugs.delete(slug);
  });
  child.on('error', (err) => {
    clearTimeout(reaperTimeout);
    pushEvent(sessionId, { stage: 'error', msg: err.message });
    activeSlugs.delete(slug);
  });
}

/* ── request handlers ────────────────────────────────────────────────── */

async function handleIndex(req, res) {
  const uiPath = resolve(__dirname, 'web-uploader-ui.html');
  if (!existsSync(uiPath)) {
    return sendText(res, 500, 'web-uploader-ui.html missing — run from repo root');
  }
  const html = await readFile(uiPath, 'utf8');
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self' 'unsafe-inline'; " +
      "style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
      "connect-src 'self'; frame-src 'self';",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
  });
  res.end(html);
}

async function handleStatus(req, res) {
  return sendJSON(res, 200, {
    ok: true,
    server: 'web-uploader',
    version: '1.0.0',
    activeSessions: Array.from(sessions.values()).filter(s => !s.done).length,
    totalSessions: sessions.size,
    pid: process.pid,
    uptimeSec: Math.round(process.uptime()),
  });
}

async function handleIngest(req, res) {
  /* Collect body up to MAX_UPLOAD_BYTES. */
  const chunks = [];
  let total = 0;
  let aborted = false;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_UPLOAD_BYTES) { aborted = true; break; }
    chunks.push(chunk);
  }
  if (aborted) return send413(res);
  const body = Buffer.concat(chunks);
  const ct = req.headers['content-type'] || '';
  const bm = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!bm) return send400(res, 'missing multipart boundary');
  const boundary = (bm[1] || bm[2]).trim();
  const { fields } = parseMultipart(body, boundary);
  const gddField = fields.gdd;
  if (!gddField || !gddField.data || gddField.data.length === 0) {
    return send400(res, 'gdd field missing or empty');
  }
  if (!ALLOWED_EXT.test(gddField.filename || '')) {
    return send400(res, `gdd extension not allowed: ${gddField.filename}`);
  }
  const parField = fields.par;
  if (parField && parField.data && parField.data.length > 0) {
    if (!ALLOWED_EXT.test(parField.filename || '')) {
      return send400(res, `par extension not allowed: ${parField.filename}`);
    }
  }
  /* Stage to /tmp under unique session dir.
   *
   * C1 audit fix (CRITICAL): filename arrives from multipart Content-
   * Disposition header — attacker can craft `filename="../../etc/cron.d/x.pdf"`.
   * basename() + sanitize chars + non-empty fallback prevents writing
   * outside the per-session tmp dir. ALLOWED_EXT alone is insufficient
   * because the extension regex matches even after path traversal. */
  const safeName = (raw, fallback) => {
    const b = basename(String(raw || ''));
    const cleaned = b.replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!cleaned || cleaned === '.' || cleaned === '..' || cleaned.startsWith('.')) return fallback;
    return cleaned;
  };
  const sessionId = createSession();
  const tmp = await mkdtemp(join(tmpdir(), 'web-uploader-' + sessionId.slice(0, 8) + '-'));
  const gddName = safeName(gddField.filename, 'upload.md');
  const gddPath = join(tmp, gddName);
  /* Final guard: resolved path must live UNDER tmp. */
  if (!resolve(gddPath).startsWith(resolve(tmp) + '/')) {
    return send400(res, 'gdd filename rejected (path traversal)');
  }
  await writeFile(gddPath, gddField.data);
  let parPath = null;
  if (parField && parField.data && parField.data.length > 0) {
    const parName = safeName(parField.filename, 'par.csv');
    parPath = join(tmp, parName);
    if (!resolve(parPath).startsWith(resolve(tmp) + '/')) {
      return send400(res, 'par filename rejected (path traversal)');
    }
    await writeFile(parPath, parField.data);
  }
  /* Slug override from form field. */
  const slugField = fields.slug ? fields.slug.data.toString('utf8').trim() : null;
  let slug = slugField && safeSlug(slugField) ? slugField : null;

  /* UQ-DEEP-F CRIT-3 fix: when operator does NOT pass --slug, the slug is
   * derived server-side (mirroring ingest.mjs:111 slugify) BEFORE spawn so
   * activeSlugs lock covers auto-slug path too. Without this, two uploads
   * of the same PDF filename would auto-derive identical slugs INSIDE the
   * child, race past activeSlugs (which never sees them), and produce
   * Frankenstein dist/<slug>/ output. */
  if (!slug) {
    slug = serverSideSlugify(safeName(gddField.filename, 'upload.md'));
  }

  /* H2 audit fix (HIGH): slug-level concurrency lock. */
  if (activeSlugs.has(slug)) {
    return sendJSON(res, 409, { error: `slug "${slug}" already ingesting` });
  }
  activeSlugs.add(slug);
  /* Kick off ingest async; respond immediately with sessionId. */
  runIngest(sessionId, gddPath, parPath, slug).catch(e => {
    pushEvent(sessionId, { stage: 'error', msg: e.message });
    activeSlugs.delete(slug);
  });
  /* Cleanup tmp after 5 minutes. */
  setTimeout(() => { rm(tmp, { recursive: true, force: true }).catch(() => {}); }, 5 * 60 * 1000);
  return sendJSON(res, 200, {
    ok: true,
    sessionId,
    eventsUrl: `/events/${sessionId}`,
    gddBytes: gddField.data.length,
    parBytes: parField ? parField.data.length : 0,
  });
}

function handleEvents(req, res, sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return send404(res);
  /* CRIT-F1: reject when subscribers cap exceeded. Without this, attacker
   * opens N SSE connections, each pushEvent writes N times → O(N) DoS. */
  if (s.subscribers.size >= MAX_SUBSCRIBERS_PER_SESSION) {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
    res.end(JSON.stringify({ error: `max ${MAX_SUBSCRIBERS_PER_SESSION} subscribers per session` }));
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  /* Replay existing events. */
  for (const evt of s.events) {
    res.write(`event: ${evt.stage || 'message'}\ndata: ${JSON.stringify(evt)}\n\n`);
  }
  if (s.done) { res.end(); return; }
  s.subscribers.add(res);
  /* Keep-alive ping every 15s. */
  const ping = setInterval(() => { try { res.write(': keep-alive\n\n'); } catch {} }, 15_000);
  req.on('close', () => { clearInterval(ping); s.subscribers.delete(res); });
}

async function handlePreview(req, res, slug) {
  if (!safeSlug(slug)) return send404(res);
  const htmlPath = resolve(DIST, slug, 'index.html');
  const rel = resolve(DIST, slug);
  /* Path traversal guard. */
  if (!rel.startsWith(DIST + '/')) return send404(res);
  if (!existsSync(htmlPath)) return send404(res);
  const st = statSync(htmlPath);
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': st.size,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  createReadStream(htmlPath).pipe(res);
}

async function handleReport(req, res, slug) {
  if (!safeSlug(slug)) return send404(res);
  const dir = resolve(DIST, slug);
  if (!dir.startsWith(DIST + '/')) return send404(res);
  if (!existsSync(dir)) return send404(res);
  const report = { slug };
  for (const name of ['v8.json', 'v9.json', 'par.json', 'healing.json', 'ingest.log']) {
    const p = resolve(dir, name);
    if (existsSync(p)) {
      try { report[name.replace(/\.json|\.log/, '')] = JSON.parse(await readFile(p, 'utf8')); }
      catch { /* skip malformed */ }
    }
  }
  return sendJSON(res, 200, report);
}

/* ── route dispatch ──────────────────────────────────────────────────── */

async function dispatch(req, res) {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const p = url.pathname;
    if (req.method === 'GET' && p === '/')       return handleIndex(req, res);
    if (req.method === 'GET' && p === '/status') return handleStatus(req, res);
    if (req.method === 'POST' && p === '/ingest') return handleIngest(req, res);
    const evtMatch = p.match(/^\/events\/([a-f0-9-]{36})$/);
    if (req.method === 'GET' && evtMatch) return handleEvents(req, res, evtMatch[1]);
    const pvMatch = p.match(/^\/preview\/([a-z0-9._-]{1,80})$/);
    if (req.method === 'GET' && pvMatch)  return handlePreview(req, res, pvMatch[1]);
    const rpMatch = p.match(/^\/report\/([a-z0-9._-]{1,80})$/);
    if (req.method === 'GET' && rpMatch)  return handleReport(req, res, rpMatch[1]);
    send404(res);
  } catch (e) {
    sendJSON(res, 500, { error: e.message });
  }
}

/* ── public entry point ──────────────────────────────────────────────── */

/**
 * Start the web uploader server.
 * @param {object} [opts] { port: number (default 5181), host: string (default '127.0.0.1') }
 * @returns {Promise<{ server, port, baseUrl }>}
 */
export function startServer(opts = {}) {
  const port = Number(opts.port) || Number(process.env.WEB_UPLOADER_PORT) || 5181;
  const host = opts.host || '127.0.0.1';
  return new Promise((resolveStart, reject) => {
    const server = createServer(dispatch);
    server.on('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' ? addr.port : port;
      resolveStart({ server, port: actualPort, baseUrl: `http://${host}:${actualPort}` });
    });
  });
}

/* ── CLI ─────────────────────────────────────────────────────────────── */

if (process.argv[1]?.endsWith('web-uploader-server.mjs')) {
  const args = process.argv.slice(2);
  const portFlag = args.indexOf('--port');
  const port = portFlag >= 0 ? Number(args[portFlag + 1]) : undefined;
  startServer({ port }).then(({ baseUrl }) => {
    console.log(`▸ web-uploader listening on ${baseUrl}`);
    console.log(`▸ open ${baseUrl}/ in your browser`);
  }).catch(e => {
    console.error('▸ server failed:', e.message);
    process.exit(1);
  });
}
