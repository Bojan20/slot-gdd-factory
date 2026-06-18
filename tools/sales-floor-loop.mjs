#!/usr/bin/env node
/**
 * tools/sales-floor-loop.mjs · Functional Item #9 — Demo mode /
 * auto-play sales floor stress loop.
 *
 * Boots a real-game slot.html and simulates an active player session:
 *   - Clicks the SPIN CTA every CYCLE_MS milliseconds
 *   - Runs for DURATION_MS total
 *   - Asserts ZERO pageerror / console.error throughout
 *   - Asserts grid host remains attached every cycle
 *   - Asserts balance HUD remains parseable every cycle (no NaN bleed)
 *
 * Why a sales floor loop:
 *   At a trade show kiosk a slot runs unattended for hours. A single
 *   memory leak, untracked timer, or stale-callback regression turns
 *   into a visible crash. Catching that before the kiosk leaves the
 *   building is the entire purpose of this probe.
 *
 * Default target: every game in dist/real-games/. Use `--game=<slug>`
 * to limit to one.
 *
 * Exit codes:
 *   0  every targeted game ran clean for DURATION_MS
 *   1  one or more games errored / lost host / NaN-bled the HUD
 *   2  artifacts missing (run parse-real-pdfs.mjs first)
 */
import { existsSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const ART_DIR = resolve(REPO, 'dist/real-games');
const OUT_DIR = resolve(REPO, 'dist/sales-floor');

const argv = process.argv.slice(2);
const DURATION_MS = +(argv.find((a) => a.startsWith('--duration='))?.slice(11) || 20_000);
const CYCLE_MS    = +(argv.find((a) => a.startsWith('--cycle='))?.slice(8)     || 1500);
const FILTER      = argv.find((a) => a.startsWith('--game='))?.slice(7) || null;
const QUIET       = argv.includes('--quiet');

const bar = (ch = '─', n = 100) => ch.repeat(n);
const log = (...m) => { if (!QUIET) console.log(...m); };

if (!existsSync(ART_DIR)) {
  console.error(`❌ ${ART_DIR} missing. Run \`node tests/parse-real-pdfs.mjs\` first.`);
  process.exit(2);
}

let games = readdirSync(ART_DIR)
  .filter((d) => statSync(resolve(ART_DIR, d)).isDirectory())
  .filter((d) => existsSync(resolve(ART_DIR, d, 'slot.html')));
if (FILTER) games = games.filter((g) => g.includes(FILTER));
if (games.length === 0) { console.error('❌ no games'); process.exit(2); }

log(bar('═'));
log(`🎰 Sales floor loop · ${games.length} game(s) · ${DURATION_MS / 1000}s session · spin every ${CYCLE_MS}ms`);
log(bar('═'));

const browser = await chromium.launch({ headless: true });
const results = [];

for (const slug of games) {
  process.stdout.write(`  • ${slug.padEnd(40)} `);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  let cycles = 0;
  let lostHost = 0;
  let nanBleed = 0;
  let crash = null;

  try {
    await page.goto(pathToFileURL(resolve(ART_DIR, slug, 'slot.html')).href, {
      waitUntil: 'load',
      timeout: 10_000,
    });
    await page.waitForTimeout(300);

    const start = Date.now();
    while (Date.now() - start < DURATION_MS) {
      const tick = await page.evaluate(() => {
        const grid = document.querySelector('#gridHost');
        const bal = document.querySelector('#bal');
        let balOk = true;
        if (bal) {
          const txt = bal.textContent || '';
          if (/NaN|undefined|Infinity/i.test(txt)) balOk = false;
        }
        const spinBtn = document.querySelector('#spinBtn,[data-action="spin"]');
        if (spinBtn && !spinBtn.disabled) spinBtn.click();
        return { hasGrid: !!grid, balOk };
      });
      cycles++;
      if (!tick.hasGrid) lostHost++;
      if (!tick.balOk) nanBleed++;
      await page.waitForTimeout(CYCLE_MS);
    }
  } catch (err) {
    crash = err.message;
  }

  await ctx.close();
  const ok = !crash && pageErrors.length === 0 && consoleErrors.length === 0 && lostHost === 0 && nanBleed === 0;
  log(ok ? `✓ cycles=${cycles}` : `✗ cycles=${cycles} pageErr=${pageErrors.length} consoleErr=${consoleErrors.length} lostHost=${lostHost} nanBleed=${nanBleed}${crash ? ' crash="' + crash + '"' : ''}`);
  results.push({ slug, ok, cycles, pageErrors, consoleErrors, lostHost, nanBleed, crash });
}

await browser.close();
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(resolve(OUT_DIR, 'report.json'), JSON.stringify({ duration_ms: DURATION_MS, cycle_ms: CYCLE_MS, generated_at: new Date().toISOString(), results }, null, 2));

const pass = results.filter((r) => r.ok).length;
const fail = results.length - pass;
log(`\n${bar('═')}`);
log(`SUMMARY · ${pass}/${results.length} games ran clean for ${DURATION_MS / 1000}s`);
log(bar('═'));

process.exit(fail > 0 ? 1 : 0);
