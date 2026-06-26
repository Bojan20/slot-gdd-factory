/**
 * tests/_lv3Wave4.test.mjs
 *
 * UQ-LV3-QA-6 Wave 4 (Boki 2026-06-26) — Regression coverage for
 * the 2 CRITICAL + 8 P1 fixes from the 3-paralel post-Wave-3 audit.
 *
 * Covers (14 cases):
 *
 * CRITICAL #5 — __BACKEND_TOTAL_SPINS__ increment:
 *   1.  backendSpinEngine increments __BACKEND_TOTAL_SPINS__ per spin
 *   2.  increment happens BEFORE roundId compute
 *
 * P1 #1 — liveRtpHud roundId fallback stability:
 *   3.  Time-window dedup (16ms heuristic) when no rid source available
 *   4.  Fallback chain: meta.roundId → __ROUND_ID__ → __BACKEND_TOTAL_SPINS__ → time-window
 *
 * CRITICAL #3 + #4 — shutdown chain:
 *   5.  Second-signal escape hatch (Ctrl-C twice → exit)
 *   6.  finally{} resets state + clears hard-kill timer
 *   7.  uncaughtException uses 2-second hard-kill timer
 *   8.  Signal exit codes: SIGINT=130, SIGTERM=143, SIGHUP=129, SIGQUIT=131
 *   9.  stdout drain before exit (writes shutdown msg)
 *
 * P1 #2 + #5 — cert-pack rate limit + Origin check:
 *  10.  Concurrency cap (_CERT_PACK_MAX_INFLIGHT = 4)
 *  11.  Origin same-origin check rejects cross-origin
 *  12.  429 response when in-flight cap reached
 *
 * Doc warning:
 *  13.  Architecture doc has OPERATOR NOTICE warning about __SOLVER_STATE__
 *  14.  Architecture doc has end-to-end demo flow status table
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

console.log('LV3 Wave 4 regression suite');

const backendSrc  = readFileSync(resolve(REPO, 'src/blocks/backendSpinEngine.mjs'), 'utf8');
const liveRtpSrc  = readFileSync(resolve(REPO, 'src/blocks/liveRtpHud.mjs'), 'utf8');
const uploaderSrc = readFileSync(resolve(REPO, 'tools/web-uploader-server.mjs'), 'utf8');
const archDoc     = readFileSync(resolve(REPO, 'docs/math-lv3-architecture.md'), 'utf8');

/* ── CRITICAL #5: __BACKEND_TOTAL_SPINS__ increment ──────────────── */

t('#1 backendSpinEngine increments __BACKEND_TOTAL_SPINS__ per spin', () => {
  assert.match(backendSrc, /window\.__BACKEND_TOTAL_SPINS__\s*=\s*\(window\.__BACKEND_TOTAL_SPINS__\s*\|\|\s*0\)\s*\+\s*1/);
});

t('#2 increment happens BEFORE roundId compute', () => {
  /* The increment line must appear earlier in the source than the
     roundId read of __BACKEND_TOTAL_SPINS__. */
  const incIdx = backendSrc.indexOf('window.__BACKEND_TOTAL_SPINS__ = (window.__BACKEND_TOTAL_SPINS__');
  const readIdx = backendSrc.indexOf(': (window.__BACKEND_TOTAL_SPINS__');
  assert.ok(incIdx > 0, 'increment present');
  assert.ok(readIdx > incIdx, 'increment precedes read');
});

/* ── P1 #1: liveRtpHud roundId fallback stability ─────────────────── */

t('#3 liveRtpHud time-window dedup (16ms heuristic)', () => {
  assert.match(liveRtpSrc, /nowTs - lastRecordTs < 16/);
  assert.match(liveRtpSrc, /lastRecordTs\s*=\s*nowTs/);
});

t('#4 fallback chain order: meta.roundId → __ROUND_ID__ → __BACKEND_TOTAL_SPINS__ → time-window', () => {
  /* All three checks must be present in the rid resolution branch. */
  const recordSpinIdx = liveRtpSrc.indexOf('function recordSpin');
  const tail = liveRtpSrc.slice(recordSpinIdx, recordSpinIdx + 1500);
  assert.match(tail, /meta\.roundId/);
  assert.match(tail, /window\.__ROUND_ID__/);
  assert.match(tail, /window\.__BACKEND_TOTAL_SPINS__/);
  assert.match(tail, /lastRecordTs/);
});

/* ── CRITICAL #3 + #4: shutdown chain ─────────────────────────────── */

t('#5 second-signal escape hatch', () => {
  assert.match(uploaderSrc, /second shutdown signal — forcing exit/);
});

t('#6 finally{} resets state + clears hard-kill timer', () => {
  assert.match(uploaderSrc, /} finally \{[\s\S]*?if \(hardKillTimer\) clearTimeout/);
});

t('#7 uncaughtException uses 2-second hard-kill timer', () => {
  assert.match(uploaderSrc, /_gracefulShutdown\(['"]uncaughtException['"],\s*1,\s*2000\)/);
  assert.match(uploaderSrc, /_gracefulShutdown\(['"]unhandledRejection['"],\s*1,\s*2000\)/);
  /* The hard-kill timer fires process.exit on timeout. */
  assert.match(uploaderSrc, /hard-kill timer fired/);
});

t('#8 signal exit codes follow 128+signum convention', () => {
  assert.match(uploaderSrc, /SIGNAL_TO_EXIT_CODE\s*=\s*\{[^}]*SIGINT:\s*130/);
  assert.match(uploaderSrc, /SIGTERM:\s*143/);
  assert.match(uploaderSrc, /SIGHUP:\s*129/);
  assert.match(uploaderSrc, /SIGQUIT:\s*131/);
});

t('#9 stdout drain before exit', () => {
  /* The shutdown message routes through process.stdout.write with
     callback so the kernel buffer flushes before process.exit. */
  assert.match(uploaderSrc, /process\.stdout\.write\(msg,\s*\(\)\s*=>\s*process\.exit/);
});

/* ── P1 #2 + #5: cert-pack rate limit + Origin check ─────────────── */

t('#10 cert-pack concurrency cap _CERT_PACK_MAX_INFLIGHT=4', () => {
  assert.match(uploaderSrc, /_CERT_PACK_MAX_INFLIGHT\s*=\s*4/);
  assert.match(uploaderSrc, /_certPackInFlight\s*\+\+/);
  assert.match(uploaderSrc, /_certPackInFlight\s*--/);
});

t('#11 cert-pack Origin same-origin check', () => {
  /* Look inside handleCertPackDownload for origin guard. */
  const handlerIdx = uploaderSrc.indexOf('async function handleCertPackDownload');
  const handler = uploaderSrc.slice(handlerIdx, handlerIdx + 3000);
  assert.match(handler, /req\.headers\[['"]origin['"]\]/);
  assert.match(handler, /cross-origin forbidden/);
});

t('#12 429 response when in-flight cap reached', () => {
  assert.match(uploaderSrc, /res\.writeHead\(429/);
  assert.match(uploaderSrc, /cert-pack concurrency cap reached/);
  assert.match(uploaderSrc, /['"]Retry-After['"]:\s*['"]2['"]/);
});

/* ── Doc warning ─────────────────────────────────────────────────── */

t('#13 architecture doc has OPERATOR NOTICE about __SOLVER_STATE__', () => {
  assert.match(archDoc, /OPERATOR NOTICE/);
  assert.match(archDoc, /producer for `__SOLVER_STATE__` is NOT WIRED/);
  assert.match(archDoc, /convergenceHud.*will display.*IDLE/i);
});

t('#14 architecture doc has end-to-end demo flow status table', () => {
  assert.match(archDoc, /End-to-end demo flow status/);
  /* Table must contain at least 6 of the 12 rows. */
  assert.match(archDoc, /Backend auto-spawn/);
  assert.match(archDoc, /Cert-pack ZIP download/);
  assert.match(archDoc, /rng_sample.bin regulator-binding/);
  assert.match(archDoc, /solverIterCount populated/);
});

console.log(`\nResult: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
