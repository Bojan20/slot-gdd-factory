#!/usr/bin/env node
/**
 * tools/static-server.mjs
 *
 * W47.S5 — minimal Node static server that replaces `python3 -m http.server`
 * in the `npm run serve` script.
 *
 * Why
 * ---
 * The previous `serve` used `python3 -m http.server 5180`. Two problems:
 *
 *   1. Single-threaded Python http.server flakes under any concurrent
 *      fetch storm (Playwright, multiple browser tabs, parallel curl).
 *      We saw 25% of fixtures hit ERR_CONNECTION_REFUSED in W47.S2 inside
 *      `cortex-eyes-ultimate-qa.mjs` until we switched that runner to a
 *      Node http.Server in W47.S3. The same fix belongs here.
 *
 *   2. The Python server has no path-traversal guard — a malicious
 *      relative URL could read above the repo root if exposed. The
 *      Python `SimpleHTTPRequestHandler` documents this caveat. Our
 *      server resolves every URL through path.resolve + asserts the
 *      result stays inside REPO.
 *
 * The full `tools/dev-server.mjs` (Wave P8) does this + adds SSE + watch
 * + GDD reader. That's the right tool for the dev iteration loop
 * (`npm run dev`); but for a plain "serve the repo for one quick smoke",
 * it's overkill. This file is the lean Node ≈ `python3 -m http.server`
 * replacement: 0 deps, same surface, same default port (5180).
 *
 * Usage
 * -----
 *   npm run serve                    → listens on http://localhost:5180
 *   PORT=8080 node tools/static-server.mjs    → custom port
 *   node tools/static-server.mjs --root <dir> → serve a different root
 *
 * Senior-grade rule (rule_senior_grade_code):
 *   • Single responsibility — static file serving, nothing else.
 *   • 0 external deps — pure Node 22+ (http, fs, path, url).
 *   • Defensive — path traversal blocked, directory listing forbidden.
 *   • Idempotent — SIGINT closes server cleanly.
 *   • Vendor-neutral — no game / studio strings.
 */
import { createServer } from 'node:http';
import { promises as fsp, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DEFAULT = path.resolve(__dirname, '..');
const PORT = parseInt(process.env.PORT || '5180', 10);

/* Tiny extension → MIME map. Anything not listed serves as octet-stream
 * (Playwright + Chromium handle that fine for HTML; the page-level
 * <script type="module"> still works because it's the .mjs extension that
 * triggers the application/javascript content type below.) */
const MIME = {
  '.html':  'text/html; charset=utf-8',
  '.htm':   'text/html; charset=utf-8',
  '.js':    'application/javascript; charset=utf-8',
  '.mjs':   'application/javascript; charset=utf-8',
  '.css':   'text/css; charset=utf-8',
  '.json':  'application/json; charset=utf-8',
  '.svg':   'image/svg+xml',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.jpeg':  'image/jpeg',
  '.gif':   'image/gif',
  '.webp':  'image/webp',
  '.ico':   'image/x-icon',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':   'font/ttf',
  '.otf':   'font/otf',
  '.txt':   'text/plain; charset=utf-8',
  '.md':    'text/markdown; charset=utf-8',
  '.map':   'application/json; charset=utf-8',
  '.wasm':  'application/wasm',
};

let ROOT = REPO_DEFAULT;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--root' && argv[i + 1]) {
    ROOT = path.resolve(argv[i + 1]);
    i++;
  }
}

const server = createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    let filePath = decodeURIComponent(url.pathname);
    if (filePath === '/' || filePath === '') filePath = '/index.html';

    /* Resolve absolute and check it stays inside ROOT. Without this,
     * `GET /../../etc/passwd` could exfiltrate files above the repo. */
    const abs = path.resolve(ROOT, '.' + filePath);
    if (!abs.startsWith(ROOT + path.sep) && abs !== ROOT) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('forbidden: path escape blocked');
      return;
    }

    fsp.stat(abs).then((s) => {
      if (s.isDirectory()) {
        /* Try index.html inside the directory. If absent, 403 (do NOT
         * list — that's the dev-server's job and even there we don't). */
        const indexAbs = path.join(abs, 'index.html');
        return fsp.stat(indexAbs).then(() => {
          serveFile(indexAbs, res);
        }).catch(() => {
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          res.end('directory listing not allowed');
        });
      }
      serveFile(abs, res, s.size);
    }).catch(() => {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    });
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('server error: ' + err.message);
  }
});

function serveFile(abs, res, size) {
  const ext = path.extname(abs).toLowerCase();
  const ct = MIME[ext] || 'application/octet-stream';
  const headers = {
    'Content-Type': ct,
    'Cache-Control': 'no-store',
  };
  if (typeof size === 'number') headers['Content-Length'] = size;
  res.writeHead(200, headers);
  createReadStream(abs).pipe(res);
}

server.listen(PORT, () => {
  /* Match Python's startup line shape so any tooling that greps for
   * "serving" or the port stays happy. */
  console.log(`Serving HTTP on 0.0.0.0 port ${PORT} (http://127.0.0.1:${PORT}/) [Node static-server]`);
});

/* Idempotent shutdown — SIGINT (Ctrl-C) + SIGTERM both close cleanly so
 * the next process can bind PORT without TIME_WAIT. */
const shutdown = (signal) => {
  console.error(`\n${signal} received — closing server …`);
  server.closeAllConnections?.();
  server.close(() => process.exit(0));
};
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
