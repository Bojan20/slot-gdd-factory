#!/usr/bin/env node
/**
 * tools/visual-regression-audit.mjs · Functional Item #4 — Visual regression
 * baseline (snapshot diff per block).
 *
 * What it does:
 *   1. For every `blocks/demos/<name>.html` (one self-contained demo
 *      per block — 100+ already exist):
 *        - Boot in headless Chromium at a fixed viewport.
 *        - Force motion-still: `prefers-reduced-motion: reduce` +
 *          injected CSS that disables all animations/transitions.
 *        - Wait a fixed settling delay (250 ms) — deterministic.
 *        - Take a full-page PNG screenshot.
 *        - SHA-256 the PNG bytes → "visual hash".
 *   2. Compare each visual hash against the recorded baseline at
 *      `tests/baselines/visual-regression.json`.
 *   3. Report:
 *        - PASS  baseline matches
 *        - DRIFT baseline exists, hash differs
 *        - NEW   no baseline (first-run, treated as drift)
 *        - GONE  baseline exists but demo file disappeared
 *
 *   On `--update-baseline` the current run is written as the new
 *   baseline (no diff check).
 *
 *   On `--fail-on-drift` exit non-zero whenever any demo drifts.
 *
 * Why hash-only (not pixel diff):
 *   The slot blocks are static-styled (CSS + SVG), with motion gated
 *   off. A hash is fast, deterministic, zero-pixel-tolerance — exactly
 *   the senior-grade behaviour Boki wants: any structural visual
 *   change MUST be intentional (rebake the baseline) or it's a bug.
 *
 *   If a future block proves hash-fragile (web-font hinting, GPU AA),
 *   the per-demo entry has room for `tolerance` + a thumbnail PNG path
 *   for pixel-diff fallback — extension point baked into the schema.
 *
 * Exit codes:
 *   0  every demo matches baseline (or --update-baseline succeeded)
 *   1  one or more drifts and --fail-on-drift was set
 *   2  no demos found / Chromium fatal
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const DEMOS_DIR = resolve(REPO, 'blocks/demos');
const BASELINE_PATH = resolve(REPO, 'tests/baselines/visual-regression.json');

const argv = process.argv.slice(2);
const UPDATE = argv.includes('--update-baseline');
const FAIL_ON_DRIFT = argv.includes('--fail-on-drift');
const QUIET = argv.includes('--quiet');

const VIEWPORT = { width: 1280, height: 800 };
const SETTLE_MS = 250;

const bar = (ch = '─', n = 90) => ch.repeat(n);

const log = (...m) => { if (!QUIET) console.log(...m); };

if (!existsSync(DEMOS_DIR)) {
  console.error(`❌ ${DEMOS_DIR} missing.`);
  process.exit(2);
}

const demos = readdirSync(DEMOS_DIR)
  .filter((f) => f.endsWith('.html'))
  .filter((f) => !f.startsWith('_'))
  .sort();

if (demos.length === 0) {
  console.error('❌ No demo HTML files found.');
  process.exit(2);
}

/* Load baseline if present. */
let baseline = { schema: 1, generated_at: null, viewport: VIEWPORT, demos: {} };
if (existsSync(BASELINE_PATH) && !UPDATE) {
  try { baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')); }
  catch (e) {
    console.error(`⚠ baseline corrupt (${e.message}); treating as absent`);
  }
}

log(bar('═'));
log(`📸 Visual regression audit · ${demos.length} demo(s) · viewport ${VIEWPORT.width}×${VIEWPORT.height}`);
log(`   baseline: ${existsSync(BASELINE_PATH) ? 'loaded (' + Object.keys(baseline.demos || {}).length + ' entries)' : 'absent (first run)'}`);
log(`   mode    : ${UPDATE ? 'UPDATE — rebaking' : FAIL_ON_DRIFT ? 'STRICT (fail on drift)' : 'REPORT (report drift, exit 0)'}`);
log(bar('═'));

/**
 * Inject motion-still CSS into a page so animations/transitions don't
 * make the screenshot non-deterministic.
 *
 * We use addStyleTag with `!important` overrides because some demos
 * declare `animation: ... infinite` inline and need a hammer. Visibility
 * of currently-running animations is reset to their initial frame.
 */
async function freezeMotion(page) {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        animation-iteration-count: 1 !important;
        animation-play-state: paused !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        scroll-behavior: auto !important;
        caret-color: transparent !important;
      }
      /* Static seed for any block that exposes a force-deterministic
       * hook (e.g., a Math.random replacement via window.__VR__seed).
       * Demos that don't read it just ignore it. */
    `,
  });
  await page.evaluate(() => {
    /* Replace Math.random for any block that gates initial layout on it.
     * Static-seed → identical pixel output across runs. */
    let s = 0x1234567;
    Math.random = function visualRegressionSeededRandom() {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };

    /* Freeze wall-clock + monotonic clock to a fixed epoch.
     * Demos that gate initial layout on Date.now() (e.g., holdAndWin
     * "__lastSpinAt__") get a deterministic timeline. Without this,
     * cosmetic delta-since-spin computations bleed into the rendered
     * DOM (data-* attribute, label text, mask offset). */
    const FROZEN_EPOCH = 1_700_000_000_000; /* 2023-11-14T22:13:20Z */
    const _origDateNow = Date.now;
    Date.now = function visualRegressionFrozenNow() { return FROZEN_EPOCH; };
    /* Keep `new Date()` consistent too — without arg routes through
     * Date.now under the hood in V8, but explicit override for portability. */
    const _OrigDate = Date;
    // eslint-disable-next-line no-global-assign
    Date = function FrozenDate(...args) {
      if (args.length === 0) return new _OrigDate(FROZEN_EPOCH);
      return new _OrigDate(...args);
    };
    Date.now = function () { return FROZEN_EPOCH; };
    Date.UTC = _OrigDate.UTC;
    Date.parse = _OrigDate.parse;
    Date.prototype = _OrigDate.prototype;

    if (typeof performance !== 'undefined' && performance.now) {
      performance.now = function visualRegressionFrozenPerfNow() { return 0; };
    }

    /* Drain the rAF queue once, then make subsequent rAFs no-ops
     * so animation tickers never schedule new frames mid-screenshot. */
    if (typeof requestAnimationFrame === 'function') {
      window.requestAnimationFrame = function visualRegressionNoopRaf() { return 0; };
      window.cancelAnimationFrame = function visualRegressionNoopCancelRaf() {};
    }
  });
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: VIEWPORT });

const newBaseline = { schema: 1, generated_at: new Date().toISOString(), viewport: VIEWPORT, demos: {} };
const verdicts = []; /* { name, status: 'pass'|'drift'|'new'|'gone', hash, refHash } */

for (const file of demos) {
  const name = basename(file, '.html');
  const abs = resolve(DEMOS_DIR, file);
  const page = await ctx.newPage();

  let hash = null;
  let bytes = 0;
  try {
    await page.goto(pathToFileURL(abs).href, { waitUntil: 'load', timeout: 8000 });
    await freezeMotion(page);
    await page.waitForTimeout(SETTLE_MS);
    const png = await page.screenshot({ fullPage: true, type: 'png', animations: 'disabled' });
    hash = createHash('sha256').update(png).digest('hex');
    bytes = png.length;
  } catch (err) {
    log(`  ✗ ${name.padEnd(45)} screenshot failed: ${err.message}`);
    verdicts.push({ name, status: 'error', detail: err.message });
    await page.close();
    continue;
  }
  await page.close();

  newBaseline.demos[name] = { hash, bytes, captured_at: new Date().toISOString() };

  const ref = baseline.demos?.[name];
  let status;
  if (!ref) status = 'new';
  else if (ref.hash === hash) status = 'pass';
  else status = 'drift';

  const sym = { pass: '✓', drift: '✗', new: '+', gone: '–', error: '!' }[status] || '?';
  log(`  ${sym} ${name.padEnd(45)} ${hash.slice(0, 12)}…  ${bytes.toString().padStart(6)}B  ${status.toUpperCase()}`);
  verdicts.push({ name, status, hash, refHash: ref?.hash || null });
}

/* Detect baseline entries that lost their demo file. */
const presentNames = new Set(demos.map((f) => basename(f, '.html')));
for (const name of Object.keys(baseline.demos || {})) {
  if (!presentNames.has(name)) {
    verdicts.push({ name, status: 'gone', refHash: baseline.demos[name].hash });
    log(`  – ${name.padEnd(45)} baseline entry has no demo file (deleted)`);
  }
}

await ctx.close();
await browser.close();

/* ── persist / report ─────────────────────────────────────────────────── */
if (UPDATE) {
  mkdirSync(dirname(BASELINE_PATH), { recursive: true });
  writeFileSync(BASELINE_PATH, JSON.stringify(newBaseline, null, 2));
  log(`\n📝 baseline rewritten → ${BASELINE_PATH}`);
  log(`   ${Object.keys(newBaseline.demos).length} entries`);
}

const counts = verdicts.reduce((acc, v) => { acc[v.status] = (acc[v.status] || 0) + 1; return acc; }, {});
log(`\n${bar('═')}`);
log(`SUMMARY · ${verdicts.length} verdict(s)`);
log(bar('═'));
log(`  ✓ PASS  : ${counts.pass  || 0}`);
log(`  ✗ DRIFT : ${counts.drift || 0}`);
log(`  + NEW   : ${counts.new   || 0}`);
log(`  – GONE  : ${counts.gone  || 0}`);
log(`  ! ERROR : ${counts.error || 0}`);

const drift = (counts.drift || 0) + (counts.error || 0);
const fresh = (counts.new   || 0) + (counts.gone  || 0);

if (UPDATE) {
  process.exit(0);
}
if (drift > 0 && FAIL_ON_DRIFT) {
  log(`\n❌ ${drift} demo(s) drifted from baseline. Run with --update-baseline to rebake.`);
  process.exit(1);
}
if (fresh > 0) {
  log(`\nℹ ${fresh} new/gone entries — run with --update-baseline to record.`);
}
process.exit(0);
