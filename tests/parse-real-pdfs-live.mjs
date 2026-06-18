#!/usr/bin/env node
/**
 * tests/parse-real-pdfs-live.mjs · Functional Item #1 (live half)
 *
 * Sibling of `parse-real-pdfs.mjs`. The static probe builds the HTML
 * artifacts; this probe boots them in headless Chromium and asserts:
 *   1. No `pageerror` (uncaught runtime exception).
 *   2. No console.error during initial paint.
 *   3. Canonical hosts exist (`#gridHost`, `#frameHost`).
 *   4. At least one cell rendered inside the grid host.
 *
 * Runs only if `dist/real-games/<game>/slot.html` exists — produced by
 * the static probe. Skip with exit 2 if no artifacts found, so CI can
 * order: static probe → live probe.
 *
 * Exit codes:
 *   0  all real-game builds boot clean in Chromium
 *   1  one or more runtime failures
 *   2  no artifacts to verify (static probe didn't run first)
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const ART_DIR = resolve(REPO, 'dist/real-games');

const bar = (ch = '─', n = 90) => ch.repeat(n);

if (!existsSync(ART_DIR)) {
  console.error(`❌ ${ART_DIR} missing. Run \`node tests/parse-real-pdfs.mjs\` first.`);
  process.exit(2);
}

const games = readdirSync(ART_DIR)
  .filter(d => statSync(resolve(ART_DIR, d)).isDirectory())
  .filter(d => existsSync(resolve(ART_DIR, d, 'slot.html')));

if (games.length === 0) {
  console.error('❌ No slot.html artifacts found. Run static probe first.');
  process.exit(2);
}

console.log(bar('═'));
console.log(`🎬 Real-game live verification · ${games.length} game(s)`);
console.log(bar('═'));

/**
 * Boot one slot.html in headless Chromium and capture runtime signal.
 * Times out at 8s per game — generous enough for slow heuristics-rich
 * games (Hold & Win full-grid panel), tight enough that one stuck game
 * doesn't gum up the whole sweep.
 */
async function verifyOne(browser, slug) {
  const slotPath = resolve(ART_DIR, slug, 'slot.html');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  const errs = [];
  const consoleErrs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrs.push(msg.text());
  });

  let stage = 'goto';
  try {
    await page.goto(pathToFileURL(slotPath).href, {
      waitUntil: 'load',
      timeout: 8000,
    });
    stage = 'settle';
    /* Allow microtasks + first paint to flush. */
    await page.waitForTimeout(250);
    stage = 'probe';

    const probe = await page.evaluate(() => {
      const gridHost = document.querySelector('#gridHost');
      const frameHost = document.querySelector('#frameHost');
      const cells = gridHost ? gridHost.querySelectorAll('[data-cell],[data-symbol],.cell,.symbol') : [];
      return {
        hasGridHost: !!gridHost,
        hasFrameHost: !!frameHost,
        cellCount: cells.length,
        bodyChildren: document.body.children.length,
      };
    });

    return {
      slug,
      ok: errs.length === 0 && consoleErrs.length === 0 && probe.hasGridHost && probe.hasFrameHost && probe.cellCount > 0,
      stage: 'done',
      pageErrors: errs,
      consoleErrors: consoleErrs,
      probe,
    };
  } catch (err) {
    return {
      slug,
      ok: false,
      stage,
      pageErrors: errs,
      consoleErrors: consoleErrs,
      crash: err.message,
    };
  } finally {
    await ctx.close();
  }
}

const browser = await chromium.launch({ headless: true });
const results = [];
for (const slug of games) {
  process.stdout.write(`  • ${slug.padEnd(50)} `);
  const r = await verifyOne(browser, slug);
  results.push(r);
  if (r.ok) {
    console.log(`✓ cells=${r.probe.cellCount}`);
  } else {
    console.log(`✗ stage=${r.stage}` +
      (r.crash ? ` crash="${r.crash}"` : '') +
      (r.pageErrors.length ? ` pageErr=${r.pageErrors.length}` : '') +
      (r.consoleErrors.length ? ` consoleErr=${r.consoleErrors.length}` : '') +
      (r.probe ? ` host(g=${r.probe.hasGridHost} f=${r.probe.hasFrameHost} c=${r.probe.cellCount})` : ''));
    if (r.pageErrors.length) console.log(`     pageError[0]: ${r.pageErrors[0]}`);
    if (r.consoleErrors.length) console.log(`     consoleError[0]: ${r.consoleErrors[0]}`);
  }
}
await browser.close();

/* Summary table */
console.log(`\n${bar('═')}`);
console.log('SUMMARY · live runtime verification');
console.log(bar('═'));

const COL = { idx: 3, slug: 38, cells: 5, perr: 5, cerr: 5, ok: 4 };
const sep =
  `├─${'─'.repeat(COL.idx)}─┼─${'─'.repeat(COL.slug)}─┼─${'─'.repeat(COL.cells)}` +
  `─┼─${'─'.repeat(COL.perr)}─┼─${'─'.repeat(COL.cerr)}─┼─${'─'.repeat(COL.ok)}─┤`;

console.log('┌' + sep.slice(1, -1).replace(/┼/g, '┬') + '┐');
console.log(
  `│ ${'#'.padEnd(COL.idx)} │ ${'Game'.padEnd(COL.slug)} │ ${'Cells'.padEnd(COL.cells)} ` +
  `│ ${'pErr'.padEnd(COL.perr)} │ ${'cErr'.padEnd(COL.cerr)} │ ${'OK'.padEnd(COL.ok)} │`,
);
console.log(sep);

let pass = 0;
let fail = 0;
results.forEach((r, i) => {
  const cells = r.probe ? String(r.probe.cellCount) : '—';
  const perr  = String(r.pageErrors.length);
  const cerr  = String(r.consoleErrors.length);
  console.log(
    `│ ${String(i + 1).padEnd(COL.idx)} │ ${r.slug.padEnd(COL.slug).slice(0, COL.slug)} ` +
    `│ ${cells.padEnd(COL.cells)} │ ${perr.padEnd(COL.perr)} │ ${cerr.padEnd(COL.cerr)} ` +
    `│ ${(r.ok ? '✓' : '✗').padEnd(COL.ok)} │`,
  );
  if (r.ok) pass++; else fail++;
});
console.log('└' + sep.slice(1, -1).replace(/┼/g, '┴') + '┘');
console.log(`\n${pass}/${results.length} live PASS · ${fail} fail`);

process.exit(fail > 0 ? 1 : 0);
