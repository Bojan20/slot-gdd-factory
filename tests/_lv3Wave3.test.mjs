/**
 * tests/_lv3Wave3.test.mjs
 *
 * UQ-LV3-QA-5 Wave 3 (Boki 2026-06-26) — Regression coverage for
 * the round-trip + lifecycle hardening landed in this commit.
 *
 * Covers (10 cases):
 *
 * roundId dedup:
 *   1.  backendSpinEngine passes {roundId} to __LIVE_RTP_RECORD__
 *   2.  Falls back to __BACKEND_TOTAL_SPINS__ when __ROUND_ID__ absent
 *
 * uploader-server lifecycle:
 *   3.  SIGHUP + SIGQUIT signal handlers wired
 *   4.  uncaughtException handler wired + stopBackend called
 *   5.  unhandledRejection handler wired + stopBackend called
 *   6.  _shutdownInFlight guard prevents double-shutdown
 *
 * UI cert-pack download:
 *   7.  #certPackDownload anchor present + ARIA labelled
 *   8.  href reset between ingest runs (no stale ZIP leak)
 *   9.  href wired to /cert-pack/<encoded-slug> on finish
 *
 * Doc sync:
 *  10.  docs/math-lv3-architecture.md mentions "14 work items" + Wave 3
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO       = resolve(dirname(__filename), '..');

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

console.log('LV3 Wave 3 contract suite');

const backendSrc  = readFileSync(resolve(REPO, 'src/blocks/backendSpinEngine.mjs'), 'utf8');
const uploaderSrc = readFileSync(resolve(REPO, 'tools/web-uploader-server.mjs'), 'utf8');
const uiSrc       = readFileSync(resolve(REPO, 'tools/web-uploader-ui.html'), 'utf8');
const archDoc     = readFileSync(resolve(REPO, 'docs/math-lv3-architecture.md'), 'utf8');

/* ── #1 + #2 roundId dedup ─────────────────────────────────────────── */

t('#1 backendSpinEngine passes {roundId} to __LIVE_RTP_RECORD__', () => {
  assert.match(backendSrc, /__LIVE_RTP_RECORD__\(j\.payX,\s*\{\s*roundId:\s*roundId\s*\}\)/);
});

t('#2 falls back to __BACKEND_TOTAL_SPINS__ when __ROUND_ID__ absent', () => {
  /* The ternary should reach __BACKEND_TOTAL_SPINS__ as the second branch. */
  assert.match(backendSrc, /window\.__ROUND_ID__[\s\S]{0,200}window\.__BACKEND_TOTAL_SPINS__/);
});

/* ── #3-#6 uploader-server lifecycle ──────────────────────────────── */

t('#3 SIGHUP + SIGQUIT signal handlers wired', () => {
  /* The forEach array literal must include both signals. */
  assert.match(uploaderSrc, /\[['"]SIGINT['"][^\]]*['"]SIGHUP['"][^\]]*['"]SIGQUIT['"]\]/);
});

t('#4 uncaughtException handler wired + stopBackend called', () => {
  assert.match(uploaderSrc, /process\.on\(['"]uncaughtException['"]/);
  /* The handler routes to _gracefulShutdown which calls stopBackend. */
  assert.match(uploaderSrc, /_gracefulShutdown\(['"]uncaughtException['"]/);
});

t('#5 unhandledRejection handler wired + stopBackend called', () => {
  assert.match(uploaderSrc, /process\.on\(['"]unhandledRejection['"]/);
  assert.match(uploaderSrc, /_gracefulShutdown\(['"]unhandledRejection['"]/);
});

t('#6 _shutdownInFlight guard (Wave 4 added escape hatch — still gates)', () => {
  assert.match(uploaderSrc, /_shutdownInFlight/);
  /* Wave 4 evolved this — now: second signal escape-hatches (Ctrl-C
     twice forces exit) instead of silently returning. The guard
     still gates the first shutdown via the `if (_shutdownInFlight)`
     check at the top of _gracefulShutdown. */
  assert.match(uploaderSrc, /if \(_shutdownInFlight\)\s*\{/);
  assert.match(uploaderSrc, /_shutdownInFlight\s*=\s*true/);
});

/* ── #7-#9 UI cert-pack download ──────────────────────────────────── */

t('#7 #certPackDownload anchor present + ARIA labelled', () => {
  assert.match(uiSrc, /id="certPackDownload"/);
  assert.match(uiSrc, /aria-label="Download GLI-16 cert pack ZIP"/);
});

t('#8 button state reset between ingest runs (no stale ZIP leak)', () => {
  /* UQ-LV3-QA-7 Wave 5 (2026-06-26): cert-pack changed from <a> to
     <button>, so the reset path no longer touches `href` — it must
     clear `data-slug`, force `disabled=false`, drop the busy flag, and
     hide. All four invariants must coexist in the reset block. */
  assert.match(uiSrc, /var certReset = document\.getElementById\(['"]certPackDownload['"]\)/);
  assert.match(uiSrc, /certReset\.removeAttribute\(['"]data-slug['"]\)/);
  assert.match(uiSrc, /certReset\.disabled\s*=\s*false/);
  assert.match(uiSrc, /delete certReset\.dataset\.busy/);
  assert.match(uiSrc, /certReset\.style\.display\s*=\s*['"]none['"]/);
});

t('#9 button wired to /cert-pack/<encoded-slug> via fetch handler', () => {
  /* UQ-LV3-QA-7 Wave 5: contract evolved from <a href=…> navigation
     to a real JS fetch handler. Two invariants now hold:
       (a) The "load receipts" path stores the slug on data-slug
           instead of writing href.
       (b) The click handler fetches GET /cert-pack/<encoded-slug>. */
  assert.match(uiSrc, /certBtn\.dataset\.slug\s*=\s*slug/);
  assert.match(uiSrc, /fetch\(['"]\/cert-pack\/['"]\s*\+\s*encodeURIComponent\(slug\)/);
});

/* ── #10 doc sync ─────────────────────────────────────────────────── */

t('#10 architecture doc updated: 14 work items + Wave 3 mention', () => {
  assert.match(archDoc, /14 work items/);
  assert.match(archDoc, /Wave 3/);
  assert.match(archDoc, /\/cert-pack\/<slug>/);
  /* __SOLVER_STATE__ contract documented. */
  assert.match(archDoc, /__SOLVER_STATE__/);
});

console.log(`\nResult: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
