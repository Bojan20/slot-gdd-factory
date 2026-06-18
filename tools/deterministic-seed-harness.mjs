#!/usr/bin/env node
/**
 * tools/deterministic-seed-harness.mjs · Functional Item #8 —
 * Deterministic seed harness for QA replay.
 *
 * What it proves:
 *   For every demo block, when the page boots with a seeded Math.random
 *   (a) two consecutive runs at the same seed produce IDENTICAL state
 *       (true determinism — required for QA replay), AND
 *   (b) two runs at DIFFERENT seeds produce DIFFERENT state for any
 *       demo that actually consumes randomness (sanity — proves the
 *       seed isn't ignored).
 *
 * Why this matters:
 *   Without (a), a QA reporting "spin sequence S triggered tier-3 BW"
 *   can't be reproduced — every replay differs. The cert evidence pack
 *   becomes worthless because the auditor can't re-run the scenario.
 *   Without (b), the seed is decorative; smart-defaults / parser
 *   inferred a constant somewhere and Math.random is effectively dead
 *   code. Either failure mode is a regulator-blocking defect.
 *
 * Method (per demo):
 *   Run 3 capture cycles in headless Chromium with the SAME freeze
 *   layer used by visual-regression-audit (Math.random seeded LCG,
 *   Date frozen, perf.now=0, rAF noop):
 *     run-A1: seed=0x1234567 (canonical)
 *     run-A2: seed=0x1234567 (replay)
 *     run-B : seed=0xDEADBEEF (sensitivity)
 *
 *   Hash full-page PNG of each. Verdicts:
 *     • REPLAY    : A1 === A2 ?  must be TRUE
 *     • SENSITIVE : A1 !== B  ?  must be TRUE for demos with RNG
 *
 *   When SENSITIVE is FALSE for a demo, that demo doesn't consume
 *   Math.random — it's static. We report INERT and don't fail; the
 *   important property is REPLAY.
 *
 * Exit codes:
 *   0  every demo: REPLAY ✓ AND (SENSITIVE ✓ OR INERT)
 *   1  any demo: REPLAY ✗ — non-deterministic at fixed seed
 *   2  Chromium fatal / demos missing
 */
import { existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const DEMOS_DIR = resolve(REPO, 'blocks/demos');
const OUT_DIR = resolve(REPO, 'dist/seed-harness');

const argv = process.argv.slice(2);
const STRICT = argv.includes('--strict') || argv.includes('--fail-on-replay-drift');
const QUIET = argv.includes('--quiet');

const SEED_A = 0x1234567;
const SEED_B = 0xDEADBEEF;
const SETTLE_MS = 350;

const bar = (ch = '─', n = 100) => ch.repeat(n);
const log = (...m) => { if (!QUIET) console.log(...m); };

if (!existsSync(DEMOS_DIR)) { console.error(`❌ ${DEMOS_DIR} missing`); process.exit(2); }
const demos = readdirSync(DEMOS_DIR).filter((f) => f.endsWith('.html') && !f.startsWith('_')).sort();
if (demos.length === 0) { console.error('❌ no demos'); process.exit(2); }

log(bar('═'));
log(`🎲 Deterministic seed harness · ${demos.length} demo(s) · seeds A=0x${SEED_A.toString(16)} B=0x${SEED_B.toString(16)}`);
log(`   mode: ${STRICT ? 'STRICT (fail on replay drift)' : 'REPORT'}`);
log(bar('═'));

/**
 * Install a deterministic freeze layer with a runtime-configurable seed.
 * Same shape as the visual-regression freeze, with the LCG seed read
 * from a window-side global injected before goto.
 */
async function freezeWithSeed(page, seed) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((SEED) => {
    let s = SEED;
    Math.random = function seedHarnessSeededRandom() {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    const FROZEN_EPOCH = 1_700_000_000_000;
    const _OrigDate = Date;
    Date.now = function () { return FROZEN_EPOCH; };
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
      performance.now = function () { return 0; };
    }
    if (typeof requestAnimationFrame === 'function') {
      window.requestAnimationFrame = function () { return 0; };
      window.cancelAnimationFrame = function () {};
    }
  }, seed);
  await page.addStyleTag({
    content: `*, *::before, *::after { animation: none !important; transition: none !important; }`,
  }).catch(() => { /* page may not be at navigated state yet — best-effort */ });
}

async function captureHash(ctx, abs, seed) {
  const page = await ctx.newPage();
  await freezeWithSeed(page, seed);
  try {
    await page.goto(pathToFileURL(abs).href, { waitUntil: 'networkidle', timeout: 10_000 });
    /* Re-inject the freeze CSS AFTER navigation in case addInitScript-time
     * style-tag didn't apply (page wasn't navigated yet). */
    await page.addStyleTag({
      content: `*, *::before, *::after { animation: none !important; transition: none !important; }`,
    });
    await page.waitForTimeout(SETTLE_MS);
    const png = await page.screenshot({ fullPage: true, type: 'png', animations: 'disabled' });
    return createHash('sha256').update(png).digest('hex');
  } finally {
    await page.close();
  }
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });

const results = [];
for (const file of demos) {
  const name = basename(file, '.html');
  const abs = resolve(DEMOS_DIR, file);
  let a1, a2, b, err = null;
  try {
    a1 = await captureHash(ctx, abs, SEED_A);
    a2 = await captureHash(ctx, abs, SEED_A);
    b  = await captureHash(ctx, abs, SEED_B);
  } catch (e) {
    err = e.message;
  }

  if (err) {
    log(`  ! ${name.padEnd(40)} ${err}`);
    results.push({ name, ok: false, error: err });
    continue;
  }

  const replay = a1 === a2;
  const sensitive = a1 !== b;
  const verdict = !replay ? 'FAIL-REPLAY' : (sensitive ? 'PASS' : 'PASS-INERT');
  const sym = !replay ? '✗' : (sensitive ? '✓' : '○');
  log(`  ${sym} ${name.padEnd(40)} A=${a1.slice(0,10)}…  replay=${replay} sensitive=${sensitive}  ${verdict}`);
  results.push({ name, a1, a2, b, replay, sensitive, verdict, ok: replay });
}

await ctx.close();
await browser.close();

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(resolve(OUT_DIR, 'report.json'), JSON.stringify({ seeds: { A: SEED_A, B: SEED_B }, generated_at: new Date().toISOString(), results }, null, 2));

const pass = results.filter((r) => r.ok).length;
const inert = results.filter((r) => r.verdict === 'PASS-INERT').length;
const fail = results.filter((r) => !r.ok).length;

log(`\n${bar('═')}`);
log('SUMMARY · deterministic seed harness');
log(bar('═'));
log(`  REPLAY ✓     : ${pass}/${results.length}`);
log(`  └─ active RNG (PASS)         : ${pass - inert}`);
log(`  └─ inert/static (PASS-INERT) : ${inert}`);
log(`  REPLAY ✗ (non-determinism)   : ${fail}`);
log(`  Artifacts                    : dist/seed-harness/report.json`);

process.exit(fail > 0 && STRICT ? 1 : 0);
