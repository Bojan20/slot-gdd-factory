/* eslint-disable no-console */
/**
 * Wave P8 — dev-server pure-function unit tests.
 *
 * Coverage:
 *   • safeResolve — strips query, rejects ..-traversal, rejects NUL,
 *     rejects http URLs as paths, defaults to index.html for root.
 *   • categorize — maps every relevant repo path to the right SSE
 *     category (gdd / parser / orchestrator / block / runtime / asset).
 *
 * The HTTP + SSE + watcher surface is exercised by the live probe
 * tools/_p8-hot-reload-probe.mjs (spawns server, opens client, asserts
 * end-to-end event flow). This file is the FAST suite — pure functions
 * only, no I/O, runs in milliseconds.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeResolve, categorize } from '../tools/dev-server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); console.log('  ✓', n); pass++; }
  catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; }
};
const eq = (a, b, m = '') => {
  if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`);
};
const ok = (c, m = '') => { if (!c) throw new Error(`expected truthy — ${m}`); };

console.log('— tools/dev-server.mjs (pure fns) —');

/* ── safeResolve ───────────────────────────────────────────────── */

t('safeResolve: / defaults to index.html under ROOT', () => {
  const out = safeResolve('/');
  eq(out, path.join(ROOT, 'index.html'));
});

t('safeResolve: empty path defaults to index.html', () => {
  const out = safeResolve('');
  eq(out, path.join(ROOT, 'index.html'));
});

t('safeResolve: normal path under root resolves', () => {
  const out = safeResolve('/src/parser.mjs');
  eq(out, path.join(ROOT, 'src', 'parser.mjs'));
});

t('safeResolve: strips query string before resolving', () => {
  const out = safeResolve('/src/parser.mjs?v=1234');
  eq(out, path.join(ROOT, 'src', 'parser.mjs'));
});

t('safeResolve: ..-traversal rejected', () => {
  eq(safeResolve('/../etc/passwd'), null);
  eq(safeResolve('/../../etc/passwd'), null);
  eq(safeResolve('/src/../../etc/passwd'), null);
});

t('safeResolve: NUL byte rejected', () => {
  eq(safeResolve('/src/parser.mjs\0.txt'), null);
});

t('safeResolve: encoded ..-traversal still rejected', () => {
  eq(safeResolve('/%2e%2e/etc/passwd'), null);
});

t('safeResolve: non-string returns null', () => {
  eq(safeResolve(null), null);
  eq(safeResolve(undefined), null);
  eq(safeResolve(42), null);
});

t('safeResolve: invalid % encoding returns null', () => {
  /* `%E0%A4` is incomplete; decodeURIComponent throws */
  eq(safeResolve('/foo%E0'), null);
});

/* ── categorize ────────────────────────────────────────────────── */

t('categorize: samples/*.md → gdd', () => {
  eq(categorize('samples/CRYSTAL_FORGE_GAME_GDD.md'), 'gdd');
  eq(categorize('samples/foo.json'), 'gdd');
  eq(categorize('samples/bar.txt'), 'gdd');
});

t('categorize: samples/* non-text → sample', () => {
  eq(categorize('samples/grids/foo.png'), 'sample');
});

t('categorize: parser path → parser', () => {
  eq(categorize('src/parser.mjs'), 'parser');
});

t('categorize: orchestrator paths → orchestrator', () => {
  eq(categorize('src/buildSlotHTML.mjs'), 'orchestrator');
  eq(categorize('app.js'), 'orchestrator');
  eq(categorize('index.html'), 'orchestrator');
});

t('categorize: runtime files → runtime', () => {
  eq(categorize('src/runtime/gridRenderer.mjs'), 'runtime');
  eq(categorize('src/runtime/devForceButtons.mjs'), 'runtime');
});

t('categorize: block files → block', () => {
  eq(categorize('src/blocks/hookBus.mjs'), 'block');
  eq(categorize('src/blocks/hotReload.mjs'), 'block');
});

t('categorize: anything else → asset', () => {
  eq(categorize('dist/foo.html'), 'asset');
  eq(categorize('tools/dev-server.mjs'), 'asset');
});

t('categorize: defensive on bad input', () => {
  eq(categorize(''), 'asset');
  eq(categorize(null), 'asset');
  eq(categorize(123), 'asset');
});

t('categorize: windows-style backslash paths normalized', () => {
  eq(categorize('src\\blocks\\hookBus.mjs'), 'block');
});

console.log(`\n${pass} pass · ${fail} fail`);
if (fail > 0) process.exit(1);
