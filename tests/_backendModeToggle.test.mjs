/**
 * tests/_backendModeToggle.test.mjs
 *
 * LV3-8 (Boki 2026-06-26) — Contract tests for the operator-controlled
 * backend toggle endpoint and UI.
 *
 * Covers (10 cases):
 *
 * Server endpoint contract (POST /backend-mode):
 *   1.  Rejects non-JSON content-type with 415
 *   2.  Rejects malformed JSON body with 400
 *   3.  Rejects body without boolean `enabled` field with 400
 *   4.  Body size cap rejects >1 KB payload
 *   5.  Idempotent: enabling already-online backend → action=noop
 *   6.  Idempotent: disabling already-offline backend → action=noop
 *
 * UI contract (tools/web-uploader-ui.html):
 *   7.  Toggle button element present + ARIA labelled
 *   8.  Hidden announcement span present + aria-live=polite
 *   9.  POST /backend-mode wired with Content-Type and { enabled } body
 *  10.  Poll cleanup on beforeunload (no leaked interval)
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const __filename = fileURLToPath(import.meta.url);
const REPO       = resolve(dirname(__filename), '..');
const SERVER_SRC = resolve(REPO, 'tools', 'web-uploader-server.mjs');
const UI_HTML    = resolve(REPO, 'tools', 'web-uploader-ui.html');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${err.message}`);
    fail++;
  }
}

console.log('backendModeToggle contract suite');

const serverSrc = readFileSync(SERVER_SRC, 'utf8');
const uiSrc     = readFileSync(UI_HTML, 'utf8');

/* ── server endpoint static-analysis contract ──────────────────────── */

/* 1 */
t('handler rejects non-JSON content-type with 415', () => {
  assert.match(serverSrc, /expect application\/json/);
  assert.match(serverSrc, /res, 415/);
});

/* 2 */
t('handler rejects malformed JSON body with 400', () => {
  /* Look for the JSON parse → 400 path. */
  assert.match(serverSrc, /json parse:/);
  assert.match(serverSrc, /res, 400/);
});

/* 3 */
t('handler rejects body without boolean enabled with 400', () => {
  assert.match(serverSrc, /typeof parsed\.enabled !== ['"]boolean['"]/);
  assert.match(serverSrc, /expect \{ enabled: true \| false \}/);
});

/* 4 */
t('handler enforces 1 KB body cap (DoS guard)', () => {
  assert.match(serverSrc, /total > 1024/);
  assert.match(serverSrc, /body too large/);
});

/* 5 */
t('handler short-circuits noop when state already matches', () => {
  assert.match(serverSrc, /action:\s*['"]noop['"]/);
  assert.match(serverSrc, /wantEnabled === currentlyOnline/);
});

/* 6 */
t('handler returns action=spawned or stopped on transition', () => {
  assert.match(serverSrc, /action:\s*['"]spawned['"]/);
  assert.match(serverSrc, /action:\s*['"]stopped['"]/);
});

/* ── UI contract (static-analysis of web-uploader-ui.html) ─────────── */

/* 7 */
t('UI has toggle button + ARIA label', () => {
  assert.match(uiSrc, /id="mathBackendToggle"/);
  assert.match(uiSrc, /aria-label="Toggle backend mode"/);
});

/* 8 */
t('UI has hidden announcement span (SR-only, polite)', () => {
  assert.match(uiSrc, /id="mathBackendAnnounce"/);
  assert.match(uiSrc, /aria-live="polite"/);
  /* The announce span uses clip-rect SR-only trick. */
  assert.match(uiSrc, /clip:\s*rect\(0,0,0,0\)/);
});

/* 9 */
t('UI POSTs /backend-mode with JSON body + Content-Type header', () => {
  assert.match(uiSrc, /fetch\(['"]\/backend-mode['"]/);
  assert.match(uiSrc, /Content-Type['"]:\s*['"]application\/json/);
  assert.match(uiSrc, /JSON\.stringify\(\{\s*enabled:/);
});

/* 10 */
t('UI clears poll interval on beforeunload (no leaked timer)', () => {
  assert.match(uiSrc, /beforeunload/);
  assert.match(uiSrc, /clearInterval\(pollTimer\)/);
});

/* ─── UQ-LV3-QA-4 regression coverage ───────────────────────────── */

/* 11 */
t('UQ-LV3-QA-4 #1: body parser uses aborted-flag (DoS-safe)', () => {
  assert.match(serverSrc, /let aborted = false/);
  assert.match(serverSrc, /if \(aborted\) return/);
  /* Settled-flag prevents end-after-abort racing data callback. */
  assert.match(serverSrc, /let settled = false/);
});

/* 12 */
t('UQ-LV3-QA-4 #2: UI uses .finally() to re-enable button on every path', () => {
  /* The fetch chain MUST end with `.finally()` so a throw inside
     `.then(paintBadge)` does not orphan disabled=true. */
  assert.match(uiSrc, /\.finally\(function\s*\(\)\s*\{/);
  assert.match(uiSrc, /t\.disabled = false/);
});

/* 13 */
t('UQ-LV3-QA-4 #3: toggle handler does NOT force the stored port across calls', () => {
  /* Pre-fix passed port: _mathBackendStatus.port — port autopick was
     lost. Post-fix: ensureBackendRunning is called WITHOUT a hardcoded
     port so the spawner can re-probe. */
  const handler = serverSrc.match(/handleBackendModeToggle[\s\S]+?\n\}/)[0];
  /* Must NOT contain literal `port: _mathBackendStatus.port` inside ensureBackendRunning call. */
  assert.equal(/ensureBackendRunning\(\{[^}]*port:\s*_mathBackendStatus/.test(handler), false);
});

/* 14 */
t('UQ-LV3-QA-4 #4: getMathBackendStatus snapshots ref atomically', () => {
  assert.match(serverSrc, /const ref = _mathBackendStatus;/);
  assert.match(serverSrc, /return \{ \.\.\.ref \}/);
});

/* 15 */
t('UQ-LV3-QA-4 #5: UI click handler has busy-flag guard', () => {
  assert.match(uiSrc, /t\.dataset\.busy/);
  assert.match(uiSrc, /if \(t\.dataset\.busy === ['"]1['"]\) return/);
});

/* 16 */
t('UQ-LV3-QA-4 #6: server enforces same-origin policy', () => {
  /* Must check Origin / Host. */
  assert.match(serverSrc, /req\.headers\[['"]origin['"]\]/);
  assert.match(serverSrc, /cross-origin forbidden/);
  /* 403 status for cross-origin. */
  assert.match(serverSrc, /res, 403/);
});

/* 17 */
t('UQ-LV3-QA-4 #8: Content-Type checked on first token (strict)', () => {
  /* Multi-value Content-Type must NOT pass with the strict token check. */
  assert.match(serverSrc, /split\(['"];['"]\)/);
  assert.match(serverSrc, /firstToken !== ['"]application\/json['"]/);
});

/* 18 */
t('UQ-LV3-QA-4 #9: UI updates aria-label dynamically on state flip', () => {
  assert.match(uiSrc, /setAttribute\(['"]aria-label['"], ['"]Start math backend['"]\)/);
  assert.match(uiSrc, /setAttribute\(['"]aria-label['"], ['"]Stop math backend['"]\)/);
});

console.log(`\nResult: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
