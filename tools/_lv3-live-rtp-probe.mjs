#!/usr/bin/env node
/**
 * tools/_lv3-live-rtp-probe.mjs
 *
 * MATH-INTEGRATION-LV3 atom #10 (Boki 2026-06-26) — E2E live RTP
 * convergence probe. Headless Chromium booots a built slot.html,
 * spins it N times (default 1000), and verifies that
 * `window.__MEASURED_RTP__` converges to the GDD-declared target
 * within ±0.5%.
 *
 * # WHY
 *
 * Acceptance criterion #3 in `docs/math-lv3-architecture.md`:
 * "Player vidi live RTP HUD koji konvergira ka declared targetu."
 * LV3-4 (liveRtpHud) is the block; this probe is the LIVE check that
 * the block actually works against a built game + a running backend.
 *
 * # FLOW
 *
 *   1. Validate inputs (slug exists, slot.html built, model.json
 *      readable, declared RTP present).
 *   2. Optional: spawn the math-backend via tools/math-backend-spawner
 *      if --backend flag is set. Otherwise assume operator already
 *      started it (or the slot will fall back to JS RNG).
 *   3. Launch chromium headless, navigate to file://<slot.html>.
 *   4. Click the spin button N times. Each click pumps the spin
 *      pipeline; postSpin updates window.__MEASURED_RTP__.
 *   5. After every checkpoint (every 100 spins by default), record
 *      the measured RTP + spin count + drift band.
 *   6. After N spins, assert |measured - declared| <= toleranceBps
 *      (default 50 bps = ±0.5%).
 *   7. Emit a JSON report to reports/lv3-live-rtp-<ts>.json + a
 *      human-readable summary to stdout.
 *
 * # USAGE
 *
 *   node tools/_lv3-live-rtp-probe.mjs --slug=<slug>
 *   node tools/_lv3-live-rtp-probe.mjs --slug=<slug> --spins=2000
 *   node tools/_lv3-live-rtp-probe.mjs --slug=<slug> --tolerance-bps=100
 *   node tools/_lv3-live-rtp-probe.mjs --slug=<slug> --backend
 *   node tools/_lv3-live-rtp-probe.mjs --slug=<slug> --json
 *
 * # FLAGS
 *
 *   --slug=<slug>          required — built slot under dist/real-games/<slug>/
 *   --spins=N              total spin count (default 1000)
 *   --tolerance-bps=N      drift band in basis points (default 50 = ±0.5%)
 *   --checkpoint=N         record every N spins (default 100)
 *   --backend              auto-spawn math backend before probe
 *   --json                 machine output (suppresses human-readable)
 *   --headed               opt out of headless (debug only)
 *   --timeout-ms=N         per-spin click timeout (default 4000)
 *
 * # EXIT CODES
 *
 *   0  measured RTP within tolerance of declared
 *   1  drift exceeded tolerance OR probe runtime error
 *   2  setup error (slug missing, slot.html unbuilt, etc)
 *   3  playwright not installed (`npm i -D playwright`)
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO      = resolve(__dirname, '..');
const REAL_GAMES = `${REPO}/dist/real-games`;
const REPORT_DIR = `${REPO}/reports`;

/* ── argv ──────────────────────────────────────────────────────────── */

function parseArgv(argv) {
  const out = { _: [], flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json' || a === '--headed' || a === '--backend') {
      out.flags.add(a.slice(2));
    } else if (a.startsWith('--slug=')) {
      out.slug = a.slice('--slug='.length);
    } else if (a === '--slug') {
      out.slug = argv[++i];
    } else if (a.startsWith('--spins=')) {
      out.spins = parseInt(a.slice('--spins='.length), 10);
    } else if (a === '--spins') {
      out.spins = parseInt(argv[++i], 10);
    } else if (a.startsWith('--tolerance-bps=')) {
      out.toleranceBps = parseInt(a.slice('--tolerance-bps='.length), 10);
    } else if (a === '--tolerance-bps') {
      out.toleranceBps = parseInt(argv[++i], 10);
    } else if (a.startsWith('--checkpoint=')) {
      out.checkpoint = parseInt(a.slice('--checkpoint='.length), 10);
    } else if (a === '--checkpoint') {
      out.checkpoint = parseInt(argv[++i], 10);
    } else if (a.startsWith('--timeout-ms=')) {
      out.timeoutMs = parseInt(a.slice('--timeout-ms='.length), 10);
    } else if (a === '--timeout-ms') {
      out.timeoutMs = parseInt(argv[++i], 10);
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    } else {
      out._.push(a);
    }
  }
  return out;
}

const args = parseArgv(process.argv.slice(2));
if (args.help || !args.slug) {
  process.stdout.write(`tools/_lv3-live-rtp-probe.mjs — LV3-10 E2E RTP convergence probe

USAGE
  node tools/_lv3-live-rtp-probe.mjs --slug=<slug> [--spins=N]
                                     [--tolerance-bps=N] [--checkpoint=N]
                                     [--backend] [--json] [--headed]
                                     [--timeout-ms=N]

EXIT CODES
  0  within tolerance, 1  drift, 2  setup error, 3  playwright missing
`);
  process.exit(args.help ? 0 : 2);
}

const SPINS = Number.isFinite(args.spins) && args.spins > 0 ? args.spins : 1000;
const TOL_BPS = Number.isFinite(args.toleranceBps) && args.toleranceBps > 0 ? args.toleranceBps : 50;
const CHECKPOINT = Number.isFinite(args.checkpoint) && args.checkpoint > 0 ? args.checkpoint : 100;
const TIMEOUT_MS = Number.isFinite(args.timeoutMs) && args.timeoutMs > 0 ? args.timeoutMs : 4000;
const JSON_OUT = args.flags.has('json');
const HEADED = args.flags.has('headed');
const WITH_BACKEND = args.flags.has('backend');

function log(msg) {
  if (!JSON_OUT) process.stdout.write(msg);
}

/* ── setup checks ──────────────────────────────────────────────────── */

const _SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
if (!_SLUG_RE.test(args.slug)) {
  process.stderr.write(`error: slug '${args.slug}' fails safety whitelist\n`);
  process.exit(2);
}
const slotPath = resolve(REAL_GAMES, args.slug, 'slot.html');
const modelPath = resolve(REAL_GAMES, args.slug, 'model.json');
if (!existsSync(slotPath)) {
  process.stderr.write(`error: ${slotPath} not found — build first\n`);
  process.exit(2);
}
if (!existsSync(modelPath)) {
  process.stderr.write(`error: ${modelPath} not found\n`);
  process.exit(2);
}

/* Read declared RTP from model.json. The math object may live at
   model.math.targetRtp / model.compliance[0].rtpPct / model.targetRtp.
   Walk the most common paths. */
function readDeclaredRtp(model) {
  if (!model || typeof model !== 'object') return null;
  if (typeof model.targetRtp === 'number') return model.targetRtp;
  if (model.math && typeof model.math.targetRtp === 'number') return model.math.targetRtp;
  if (model.math && typeof model.math.rtp === 'number') return model.math.rtp;
  if (Array.isArray(model.compliance)) {
    for (const j of model.compliance) {
      if (j && typeof j.rtpPct === 'number') return j.rtpPct;
      if (j && j.rtp && typeof j.rtp.target === 'number') return j.rtp.target;
    }
  }
  return null;
}

const model = JSON.parse(readFileSync(modelPath, 'utf8'));
const declaredRtp = readDeclaredRtp(model);
if (declaredRtp === null) {
  process.stderr.write(`error: no declared RTP found in ${modelPath}\n`);
  process.exit(2);
}

log(`LV3 live RTP probe · slug=${args.slug}\n`);
log(`  declared RTP : ${declaredRtp.toFixed(2)}%\n`);
log(`  tolerance    : ±${(TOL_BPS / 100).toFixed(2)}% (${TOL_BPS} bps)\n`);
log(`  spins        : ${SPINS}\n`);
log(`  checkpoint   : every ${CHECKPOINT}\n`);

/* ── optional backend spawn ────────────────────────────────────────── */

let backendStop = null;
if (WITH_BACKEND) {
  try {
    const spawner = await import(pathToFileURL(resolve(REPO, 'tools', 'math-backend-spawner.mjs')).href);
    if (typeof spawner.ensureBackendRunning === 'function') {
      log(`  backend      : spawning via math-backend-spawner...\n`);
      const handle = await spawner.ensureBackendRunning({ port: 9001 });
      backendStop = typeof handle.stop === 'function' ? handle.stop : null;
      log(`  backend      : ready on port ${handle.port || 9001}\n`);
    }
  } catch (e) {
    log(`  backend      : spawn failed (${e.message}); continuing without\n`);
  }
}

/* ── playwright ────────────────────────────────────────────────────── */

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (e) {
  process.stderr.write(`error: playwright not available — \`npm i -D playwright\` (${e.message})\n`);
  process.exit(3);
}

const url = pathToFileURL(slotPath).href;
const browser = await chromium.launch({ headless: !HEADED });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();

const consoleErrors = [];
page.on('pageerror', (err) => consoleErrors.push(String(err)));
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});

const tStart = Date.now();
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
  await page.waitForTimeout(500);

  /* Locate spin button — common selectors used across the corpus. */
  const SPIN_SELECTORS = [
    'button[data-role=spin]',
    '#spinBtn',
    '.spin-btn',
    'button[aria-label*="spin" i]',
  ];
  let spinSelector = null;
  for (const sel of SPIN_SELECTORS) {
    const exists = await page.$(sel);
    if (exists) { spinSelector = sel; break; }
  }
  if (!spinSelector) {
    throw new Error('no spin button found via known selectors');
  }
  log(`  spin button  : ${spinSelector}\n\n`);

  const checkpoints = [];
  let lastRtpRead = null;

  /* Click + checkpoint loop. */
  for (let i = 1; i <= SPINS; i++) {
    try {
      await page.click(spinSelector, { timeout: TIMEOUT_MS });
      /* Tiny settle — give postSpin a tick to land. */
      await page.waitForTimeout(8);
    } catch (e) {
      log(`  ✗ spin ${i} click failed: ${e.message}\n`);
      break;
    }
    if (i % CHECKPOINT === 0 || i === SPINS) {
      const measured = await page.evaluate(() => {
        return typeof window.__MEASURED_RTP__ === 'number' ? window.__MEASURED_RTP__
             : (typeof window.__BACKEND_LAST_SPIN === 'object' && window.__BACKEND_LAST_SPIN && typeof window.__BACKEND_LAST_SPIN.rtp === 'number' ? window.__BACKEND_LAST_SPIN.rtp
             : null);
      });
      if (typeof measured === 'number') {
        const driftBps = Math.round((measured - declaredRtp) * 100);
        lastRtpRead = measured;
        checkpoints.push({ spin: i, measuredRtp: measured, driftBps });
        log(`  checkpoint @ ${String(i).padStart(5)}  measured=${measured.toFixed(3)}%  drift=${driftBps >= 0 ? '+' : ''}${driftBps} bps\n`);
      }
    }
  }

  await ctx.close();
  await browser.close();

  const tEnd = Date.now();
  const wallclockS = ((tEnd - tStart) / 1000).toFixed(2);

  if (lastRtpRead === null) {
    process.stderr.write('error: no RTP measurement captured — block emitting __MEASURED_RTP__?\n');
    if (backendStop) try { await backendStop(); } catch (_) {}
    process.exit(2);
  }

  const finalDriftBps = Math.abs(Math.round((lastRtpRead - declaredRtp) * 100));
  const verdict = finalDriftBps <= TOL_BPS ? 'PASS' : 'FAIL';

  mkdirSync(REPORT_DIR, { recursive: true });
  const ts = new Date().toISOString();
  const report = {
    tool: 'tools/_lv3-live-rtp-probe.mjs',
    generatedAt: ts,
    slug: args.slug,
    declaredRtp,
    measuredRtp: lastRtpRead,
    finalDriftBps,
    toleranceBps: TOL_BPS,
    verdict,
    spinsRun: SPINS,
    wallclockS: parseFloat(wallclockS),
    checkpoints,
    consoleErrors: consoleErrors.slice(0, 20),
  };
  const reportFile = join(REPORT_DIR, `lv3-live-rtp-${args.slug}-${ts.replace(/[:.]/g, '-')}.json`);
  writeFileSync(reportFile, JSON.stringify(report, null, 2));

  if (JSON_OUT) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    log(`\n──────────────────────────────────────────────\n`);
    log(`  verdict      : ${verdict}\n`);
    log(`  declared     : ${declaredRtp.toFixed(3)}%\n`);
    log(`  measured     : ${lastRtpRead.toFixed(3)}%\n`);
    log(`  drift        : ${finalDriftBps} bps (tolerance ±${TOL_BPS} bps)\n`);
    log(`  spins run    : ${SPINS}\n`);
    log(`  wallclock    : ${wallclockS}s\n`);
    log(`  report       : ${reportFile}\n`);
    log(`──────────────────────────────────────────────\n`);
  }

  if (backendStop) try { await backendStop(); } catch (_) {}
  process.exit(verdict === 'PASS' ? 0 : 1);
} catch (e) {
  try { await browser.close(); } catch (_) {}
  if (backendStop) try { await backendStop(); } catch (_) {}
  process.stderr.write(`error: probe runtime failure: ${e.message}\n`);
  process.exit(1);
}
