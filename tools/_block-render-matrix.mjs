#!/usr/bin/env node
/**
 * tools/_block-render-matrix.mjs
 *
 * Sweep D — Live render integration test.
 *
 * Goal: DOKAZ da svaki od 122 bloka stvarno radi u live browseru (Chromium
 * headless), ne samo unit testovima. Po jedan playable HTML iz `dist/` po
 * svakom od 20 grid fixtures u `samples/grids/*.md` se otvara, spinuje 10
 * puta, i posmatra na:
 *   - console.error  (page-level)
 *   - pageerror      (uncaught exceptions)
 *   - cell count     (min ≥ 9 throughout 10 spins)
 *   - orphan globals (cleanup-test: snapshot pre / posle spinova)
 *
 * Generates:
 *   reports/block-render-matrix-<ts>.md
 *
 * Exit code:
 *   0 — svi 20 fixtures green
 *   1 — bar jedan failed
 *
 * Usage:
 *   node tools/_block-render-matrix.mjs              # full 20-fixture sweep
 *   node tools/_block-render-matrix.mjs --only=01,18 # subset
 */

import { chromium } from 'playwright';
import { spawn }    from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname }                                  from 'node:path';
import { fileURLToPath }                                     from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO       = resolve(dirname(__filename), '..');
const DIST       = resolve(REPO, 'dist');
const REPORTS    = resolve(REPO, 'reports');
if (!existsSync(REPORTS)) mkdirSync(REPORTS, { recursive: true });

const PORT     = 5290;
const URL_BASE = `http://127.0.0.1:${PORT}`;
const SPINS    = 10;
const MIN_CELLS = 9;

/* CLI: --only=01,18 limit subset (debug aid). */
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1] || '';
const ONLY_SET = ONLY ? new Set(ONLY.split(',').map(s => s.trim())) : null;

/* Build target list directly from dist/*_playable.html so we don't depend on
 * a rebuild — the user already maintains 20 fresh playable HTML bundles. */
const PLAYABLES = readdirSync(DIST)
  .filter(f => /^\d{2}_.*_playable\.html$/.test(f))
  .sort()
  .map(f => {
    const idx   = f.slice(0, 2);
    const label = f.replace(/_playable\.html$/, '');
    return { idx, label, file: f, url: `${URL_BASE}/dist/${f}` };
  })
  .filter(t => !ONLY_SET || ONLY_SET.has(t.idx) || ONLY_SET.has(t.label));

if (PLAYABLES.length === 0) {
  console.error('No dist/*_playable.html targets found. Run the builder first.');
  process.exit(2);
}

/* ─── Server ──────────────────────────────────────────────────────────────── */

console.log(`[srv] Starting python3 -m http.server ${PORT}  (cwd=${REPO})`);
const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
  cwd: REPO,
  stdio: 'ignore',
});

/* Robust server-ready wait — poll for HTTP 200 on root rather than fixed sleep. */
async function waitForServer(maxMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      const r = await fetch(`${URL_BASE}/`, { method: 'HEAD' });
      if (r.status < 500) return true;
    } catch (_) { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 150));
  }
  return false;
}
const ready = await waitForServer();
if (!ready) {
  console.error('[srv] HTTP server failed to come up on port', PORT);
  server.kill('SIGTERM');
  process.exit(2);
}

/* ─── Browser ─────────────────────────────────────────────────────────────── */

const browser = await chromium.launch({ headless: true });

/* Build a stable "before-load" baseline of window-globals so we can diff after
 * 10 spins. Anything added during the run that isn't on our known-good
 * allow-list of engine-owned globals is an orphan candidate. */
const KNOWN_GLOBALS = new Set([
  /* Engine-owned, lifecycle-managed — NOT orphans. */
  'HookBus', 'FSM', 'GAME_CONFIG', 'GAME_STATE', 'gridProfile',
  'runOneBaseSpin', 'turboModeOn', 'turboModeOff', 'fsHardExit',
  'wbClose', 'gambleCollect', 'bpClose',
  'allReelsActive', 'reelEngine',
  'FORCE_TRIGGER', 'FORCE_FEATURE', 'FORCE_BIG_WIN_TIER',
  /* Standard browser intrinsics we never count. */
  'webkitStorageInfo', 'webkitIndexedDB', 'webkitMediaSession',
  'webkitURL', 'webkitSpeechRecognition', 'webkitSpeechGrammar',
  'webkitSpeechGrammarList', 'webkitSpeechRecognitionEvent',
  'webkitSpeechRecognitionError', 'webkitRTCPeerConnection',
  'webkitMediaStream',
  /* Probe instrumentation our own page eval adds. */
  '__BLOCK_RENDER_BASELINE__', '__BLOCK_RENDER_RUNTIME__',
]);

/* Selector union — covers all 20 grid shapes (rect / cluster / hex / wheel
 * / plinko / crash / slingo / diamond / pyramid / cross / lshape / radial /
 * pyramid / variable_reel / megaclusters / infinity / expanding / dual /
 * lock_respin / rectangular_stacked_scatter). For shapes whose primary
 * visual unit isn't `.cell`, we accept the kind-specific selector and treat
 * "≥ 9 visible units" as the analog of "≥ 9 grid cells". */
const CELL_SELECTOR = [
  '.cell',
  '.wheel-seg', '.wheel-segment', '.wheel-text',
  '.plinko-peg', '.plinko-cell',
  '.crash-tick', '.crash-point',
  '.slingo-cell',
  '.hex-cell', '.hex-tile',
  '.diamond-cell', '.pyramid-cell',
  '.lshape-cell', '.cross-cell',
  '.radial-blade', '.radial-cell',
  '[data-cell]', '[data-cell-kind]',
  '.reelCol .symbol',
].join(', ');

async function runFixture({ idx, label, url }) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  const consoleErrors = [];
  const pageErrors    = [];
  page.on('console',   m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 240)); });
  page.on('pageerror', e => { pageErrors.push(String(e).slice(0, 240)); });

  const detail = {
    idx, label,
    spinsFired:   0,
    cellSamples:  [],   /* one int per spin (cells observed after spin) */
    cellMin:      Infinity,
    cellMax:      0,
    orphanGlobals: [],
    fatal:        null,
  };

  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });

    /* Wait for #spinBtn to attach — that's our "page booted" signal that
     * works across every shape. */
    await page.waitForSelector('#spinBtn', { timeout: 15000 });
    /* Extra settle for late renders (wheel SVG, plinko canvas, crash chart). */
    await page.waitForTimeout(800);

    /* Snapshot baseline of window-globals BEFORE the spin loop. */
    await page.evaluate(() => {
      window.__BLOCK_RENDER_BASELINE__ = Object.keys(window).slice();
    });

    /* Pre-spin cell count check — if the page rendered fewer than MIN_CELLS
     * we record the failure but continue to capture the spin behavior too. */
    const cellsAtBoot = await page.evaluate((sel) => {
      return document.querySelectorAll(sel).length;
    }, CELL_SELECTOR);
    detail.cellAtBoot = cellsAtBoot;
    detail.cellMin = Math.min(detail.cellMin, cellsAtBoot);
    detail.cellMax = Math.max(detail.cellMax, cellsAtBoot);

    /* Spin loop. We click #spinBtn, wait 1500ms (per user spec), then sample
     * the cell count. We do NOT abort on cell-count failure — we keep
     * sampling so the report shows the full trajectory. */
    for (let i = 0; i < SPINS; i++) {
      /* Best-effort: wait until #spinBtn is idle before clicking. Some
       * shapes (cluster cascades, wheel) keep the button disabled until the
       * previous round settles. Cap wait at ~3s so a hung round still
       * surfaces as missed spins in the report. */
      let ready = false;
      for (let j = 0; j < 30; j++) {
        ready = await page.evaluate(() => {
          const b = document.getElementById('spinBtn');
          return b && !b.disabled && !b.classList.contains('is-spinning');
        });
        if (ready) break;
        await page.waitForTimeout(100);
      }
      if (!ready) {
        /* Try to break out of any blocking overlay. */
        await page.evaluate(() => {
          try { window.wbClose && window.wbClose(); } catch (_) {}
          try { window.gambleCollect && window.gambleCollect(); } catch (_) {}
          try { window.bpClose && window.bpClose(); } catch (_) {}
          try { window.fsHardExit && window.fsHardExit(); } catch (_) {}
          document.querySelectorAll('.fs-overlay-cta, .fs-overlay button, [data-fs-cta]').forEach(b => {
            try { b.click(); } catch (_) {}
          });
        });
        await page.waitForTimeout(200);
      }

      /* Click #spinBtn (engineered to mirror real player input). */
      await page.evaluate(() => {
        const b = document.getElementById('spinBtn');
        if (b) b.click();
      });

      /* Fixed 1500ms cadence per spec. */
      await page.waitForTimeout(1500);
      detail.spinsFired++;

      const cellsNow = await page.evaluate((sel) => document.querySelectorAll(sel).length, CELL_SELECTOR);
      detail.cellSamples.push(cellsNow);
      detail.cellMin = Math.min(detail.cellMin, cellsNow);
      detail.cellMax = Math.max(detail.cellMax, cellsNow);
    }

    /* Cleanup test — diff window keys against baseline, filter known-good. */
    const orphans = await page.evaluate((known) => {
      const baseline = new Set(window.__BLOCK_RENDER_BASELINE__ || []);
      const knownSet = new Set(known);
      const out = [];
      for (const k of Object.keys(window)) {
        if (baseline.has(k)) continue;
        if (knownSet.has(k)) continue;
        if (k.startsWith('webkit')) continue;
        if (k.startsWith('__BLOCK_RENDER_')) continue;
        out.push(k);
      }
      return out.slice(0, 20);
    }, Array.from(KNOWN_GLOBALS));
    detail.orphanGlobals = orphans;

  } catch (e) {
    detail.fatal = e.message || String(e);
  }

  await page.close();
  await ctx.close();

  /* Pass criteria:
   *  - no fatal load error
   *  - 0 console.error
   *  - 0 pageerror
   *  - cellMin >= MIN_CELLS  (i.e. grid never collapsed below 9 visible units)
   *  - spinsFired === SPINS
   *  - 0 orphan globals
   */
  const pass =
    !detail.fatal &&
    consoleErrors.length === 0 &&
    pageErrors.length === 0 &&
    detail.cellMin >= MIN_CELLS &&
    detail.spinsFired === SPINS &&
    detail.orphanGlobals.length === 0;

  return {
    idx, label,
    pass,
    consoleErrors,
    pageErrors,
    detail,
  };
}

/* ─── Drive sweep — sequential to keep cell-count signal honest ───────────── */

console.log(`\n══ Block-render matrix: ${PLAYABLES.length} fixtures × ${SPINS} spins (port ${PORT}) ══\n`);

const results = [];
for (const t of PLAYABLES) {
  const t0 = Date.now();
  /* Retry up to 3× per fixture before declaring fail — per user spec. */
  let r = null;
  let attempts = 0;
  for (let attempt = 1; attempt <= 3; attempt++) {
    attempts = attempt;
    try {
      r = await runFixture(t);
    } catch (e) {
      r = { idx: t.idx, label: t.label, pass: false, consoleErrors: [], pageErrors: [String(e)], detail: { fatal: e.message } };
    }
    if (r.pass) break;
    /* Brief cooldown before retry. */
    await new Promise(res => setTimeout(res, 400));
  }
  r.attempts = attempts;
  results.push(r);
  const dur  = ((Date.now() - t0) / 1000).toFixed(1);
  const tag  = r.pass ? 'PASS' : 'FAIL';
  const cmin = (r.detail.cellMin === undefined || r.detail.cellMin === Infinity) ? '?' : r.detail.cellMin;
  const cmax = r.detail.cellMax === undefined ? '?' : r.detail.cellMax;
  const orphans = Array.isArray(r.detail.orphanGlobals) ? r.detail.orphanGlobals.length : 0;
  console.log(`  [${tag}] ${r.label.padEnd(40)} ${dur}s  spins=${r.detail.spinsFired}/${SPINS} cells=${cmin}..${cmax} errs=${r.consoleErrors.length} pageerr=${r.pageErrors.length} orphans=${orphans} (try ${attempts}/3)`);
}

await browser.close();
server.kill('SIGTERM');

/* ─── Report ──────────────────────────────────────────────────────────────── */

const ts        = Date.now();
const passCount = results.filter(r => r.pass).length;
const failCount = results.length - passCount;
const totSpins  = results.reduce((a, r) => a + r.detail.spinsFired, 0);
const totConsErrs = results.reduce((a, r) => a + r.consoleErrors.length, 0);
const totPageErrs = results.reduce((a, r) => a + r.pageErrors.length, 0);
const totOrphans  = results.reduce((a, r) => a + r.detail.orphanGlobals.length, 0);

const lines = [];
lines.push(`# Block-Render Matrix — Sweep D`);
lines.push('');
lines.push(`- **Generated:** ${new Date(ts).toISOString()}`);
lines.push(`- **Fixtures:**  ${results.length}`);
lines.push(`- **Spins/fix:** ${SPINS}`);
lines.push(`- **Min cells:** ${MIN_CELLS} (must hold throughout)`);
lines.push(`- **Pass:**      ${passCount} / ${results.length}`);
lines.push(`- **Fail:**      ${failCount}`);
lines.push(`- **Total spins fired:** ${totSpins}`);
lines.push(`- **Sum console.error:** ${totConsErrs}`);
lines.push(`- **Sum page errors:**   ${totPageErrs}`);
lines.push(`- **Sum orphan globals:**${totOrphans}`);
lines.push('');
lines.push(`## Per-fixture matrix`);
lines.push('');
lines.push('| Fixture | Status | Spins | Cell range | Console err | Page err | Orphans | Tries |');
lines.push('|:--|:-:|:-:|:-:|:-:|:-:|:-:|:-:|');
for (const r of results) {
  const status = r.pass ? 'PASS' : 'FAIL';
  const cMin   = r.detail.cellMin === Infinity ? '?' : r.detail.cellMin;
  const cRange = `${cMin}..${r.detail.cellMax}`;
  lines.push(`| ${r.label} | ${status} | ${r.detail.spinsFired}/${SPINS} | ${cRange} | ${r.consoleErrors.length} | ${r.pageErrors.length} | ${r.detail.orphanGlobals.length} | ${r.attempts}/3 |`);
}
lines.push('');

const failed = results.filter(r => !r.pass);
if (failed.length) {
  lines.push(`## Failure detail`);
  lines.push('');
  for (const r of failed) {
    lines.push(`### ${r.label}`);
    if (r.detail.fatal) lines.push(`- **Fatal:** \`${r.detail.fatal}\``);
    if (r.consoleErrors.length) {
      lines.push(`- **Console errors (first 5):**`);
      r.consoleErrors.slice(0, 5).forEach(e => lines.push(`  - \`${e.replace(/`/g, 'ˋ')}\``));
    }
    if (r.pageErrors.length) {
      lines.push(`- **Page errors (first 5):**`);
      r.pageErrors.slice(0, 5).forEach(e => lines.push(`  - \`${e.replace(/`/g, 'ˋ')}\``));
    }
    if (r.detail.orphanGlobals.length) {
      lines.push(`- **Orphan globals:** \`${r.detail.orphanGlobals.join(', ')}\``);
    }
    if (r.detail.cellMin !== Infinity && r.detail.cellMin < MIN_CELLS) {
      lines.push(`- **Cells fell below floor:** min=${r.detail.cellMin} < ${MIN_CELLS}`);
    }
    if (r.detail.spinsFired < SPINS) {
      lines.push(`- **Missed spins:** fired ${r.detail.spinsFired}/${SPINS}`);
    }
    lines.push(`- **Cell samples (post-spin):** ${r.detail.cellSamples.join(', ')}`);
    lines.push('');
  }
}

const reportPath = resolve(REPORTS, `block-render-matrix-${ts}.md`);
writeFileSync(reportPath, lines.join('\n'));

console.log(`\n╔════════════════════════════════════════════════════════════════╗`);
console.log(`║  Block-Render Matrix — ${passCount}/${results.length} PASS, ${failCount} FAIL`.padEnd(64) + '║');
console.log(`╚════════════════════════════════════════════════════════════════╝`);
console.log(`Report: ${reportPath}`);

process.exit(failCount === 0 ? 0 : 1);
