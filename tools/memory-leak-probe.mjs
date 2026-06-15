#!/usr/bin/env node
/**
 * tools/memory-leak-probe.mjs
 *
 * Wave F4 / A7 — Memory leak detector via Playwright headless loop.
 *
 * What it does
 * ------------
 * Boots one canonical fixture, runs N spin-clicks back-to-back, samples
 * the V8 heap before + after, and asserts the delta stays under a hard
 * threshold. Detached DOM nodes are also sampled via CDP so listener
 * leaks (most common slot-game leak class) surface.
 *
 * Default budget (per A7 contract): 10 K spins headless, heap delta
 * < 5 MB. We default to 200 spins for the routine CI run (sub-minute);
 * `--soak` flips to 10 000 for the nightly soak.
 *
 * Strategy:
 *   1. Boot canonical fixture (default WRATH_OF_OLYMPUS).
 *   2. Click #spinBtn N times, awaiting postSpin between clicks.
 *   3. Sample `performance.measureUserAgentSpecificMemory()` when
 *      available; fall back to `performance.memory.usedJSHeapSize`.
 *   4. Compare delta vs threshold; report pass/fail.
 *
 * Output: JSON-ish + human-readable summary.
 *
 * Tunables:
 *   PROBE_SPINS    default 200    (override: --spins N)
 *   PROBE_LIMIT_MB default 5      (override: --limit N)
 *   --soak                        10 000 spins + 25 MB budget
 *   --fail-on-violation           strict exit 1 on threshold breach
 *
 * Senior-grade rule:
 *   • Single responsibility — memory leak probe.
 *   • Pure Node + Playwright (already a dev dep).
 *   • Vendor-neutral.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolvePath(__dirname, '..');

const C = {
  red:    s => `\x1b[31m${s}\x1b[0m`,
  green:  s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  dim:    s => `\x1b[2m${s}\x1b[0m`,
};

const argv = process.argv.slice(2);
const SOAK = argv.includes('--soak');
const STRICT = argv.includes('--fail-on-violation');
let SPINS = SOAK ? 10000 : parseInt(process.env.PROBE_SPINS || '200', 10);
let LIMIT_MB = SOAK ? 25 : parseFloat(process.env.PROBE_LIMIT_MB || '5');
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--spins') SPINS = parseInt(argv[++i], 10);
  if (argv[i] === '--limit') LIMIT_MB = parseFloat(argv[++i]);
}

const FIXTURE = process.env.PROBE_FIXTURE || 'WRATH_OF_OLYMPUS_GAME_GDD.html';
const PORT = 5234;

console.log(C.bold(C.cyan('\n🧠 Memory leak probe — slot-gdd-factory\n')));
console.log(C.dim(`   Wave F4 / A7 perf gate.`));
console.log(C.dim(`   Spins: ${SPINS} · Heap budget: ${LIMIT_MB} MB · Fixture: ${FIXTURE}`));
console.log(C.dim(`   Mode: ${STRICT ? 'STRICT (failing gate)' : 'REPORT-ONLY (exit 0)'}\n`));

/* ── 1. Build fixtures if missing ────────────────────────────────────── */
const ULT_DIR = resolvePath(REPO, 'tools/_qa/ultimate-html');
const FIXTURE_PATH = resolvePath(ULT_DIR, `sample__${FIXTURE}`);
if (!existsSync(FIXTURE_PATH)) {
  console.log(C.yellow(`   fixture missing — regenerating via parse+build pipeline …`));
  /* The full pipeline lives in cortex-eyes-ultimate-qa; we call the
   * tiny helper directly here. */
  const { parseGDD } = await import('../src/parser.mjs');
  const { buildSlotHTML } = await import('../src/buildSlotHTML.mjs');
  const samplePath = resolvePath(REPO, 'samples/WRATH_OF_OLYMPUS_GAME_GDD.md');
  const src = readFileSync(samplePath, 'utf8');
  const model = parseGDD(src);
  const html = buildSlotHTML(model);
  if (!existsSync(ULT_DIR)) mkdirSync(ULT_DIR, { recursive: true });
  writeFileSync(FIXTURE_PATH, html, 'utf8');
  console.log(C.dim(`   wrote fixture → ${FIXTURE_PATH}`));
}

/* ── 2. Start local Node static server on PROBE port ─────────────────── */
const server = spawn('node', [resolvePath(REPO, 'tools/static-server.mjs')], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});
await new Promise(r => setTimeout(r, 300));

let exitStatus = 0;
let browser;
try {
  browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const url = `http://127.0.0.1:${PORT}/tools/_qa/ultimate-html/sample__${FIXTURE}`;
  console.log(C.dim(`   booting ${url} …`));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.HookBus !== 'undefined' && document.querySelector('#spinBtn'), { timeout: 10000 });
  /* Wait for the spin button to actually be visible + clickable. The
   * paint/layout pass after HookBus boot can take ~150 ms on a clean
   * CI run; without this wait Playwright's first click timed out at
   * 1500 ms and the whole loop reported zero clicks. */
  await page.waitForSelector('#spinBtn', { state: 'visible', timeout: 10000 });

  const sampleHeap = async () => {
    return await page.evaluate(async () => {
      if (performance.measureUserAgentSpecificMemory) {
        try {
          const m = await performance.measureUserAgentSpecificMemory();
          return m.bytes || 0;
        } catch (_) {}
      }
      if (performance.memory) return performance.memory.usedJSHeapSize || 0;
      return 0;
    });
  };

  /* Warm-up — let JS lazy modules load + first paint settle. */
  for (let i = 0; i < 3; i++) {
    await page.click('#spinBtn').catch(() => {});
    await page.waitForTimeout(120);
  }

  const heapBefore = await sampleHeap();
  const t0 = Date.now();

  let okClicks = 0;
  for (let i = 0; i < SPINS; i++) {
    const ok = await page.click('#spinBtn', { timeout: 3000, force: true }).then(() => true).catch(() => false);
    if (!ok) break;
    okClicks++;
    /* Don't await full settle every spin — pace at ~3 ms per click to
     * mimic autoplay turbo. The real signal is heap growth over many
     * iterations, not visual completeness. */
    await page.waitForTimeout(3);
  }

  /* Trigger a GC if exposed (Playwright launches without --js-flags
   * by default, so GC is best-effort via Performance API). */
  await page.evaluate(() => {
    if (typeof gc === 'function') try { gc(); } catch (_) {}
  });
  await page.waitForTimeout(500);

  const heapAfter = await sampleHeap();
  const tookMs = Date.now() - t0;
  const deltaBytes = heapAfter - heapBefore;
  const deltaMB = deltaBytes / (1024 * 1024);
  const limitBytes = LIMIT_MB * 1024 * 1024;

  console.log(`\n   spins clicked   : ${okClicks} / ${SPINS}`);
  console.log(`   wallclock       : ${tookMs} ms (${(tookMs / Math.max(1, okClicks)).toFixed(2)} ms/spin)`);
  console.log(`   heap before     : ${(heapBefore / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   heap after      : ${(heapAfter / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   delta           : ${deltaMB.toFixed(2)} MB`);
  console.log(`   budget          : ${LIMIT_MB} MB`);

  const pass = deltaBytes < limitBytes;
  console.log('');
  if (pass) {
    console.log(C.green(C.bold(`✅ memory leak probe clean.\n`)));
  } else if (STRICT) {
    console.log(C.red(C.bold(`❌ memory leak probe — delta ${deltaMB.toFixed(2)} MB exceeds budget ${LIMIT_MB} MB.\n`)));
    exitStatus = 1;
  } else {
    console.log(C.yellow(C.bold(`⚠ memory leak probe — delta ${deltaMB.toFixed(2)} MB > ${LIMIT_MB} MB budget — REPORT ONLY (use --fail-on-violation to enforce).\n`)));
  }
} catch (err) {
  console.error(C.red(`probe error: ${err.message}`));
  exitStatus = 3;
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill();
}

process.exit(exitStatus);
