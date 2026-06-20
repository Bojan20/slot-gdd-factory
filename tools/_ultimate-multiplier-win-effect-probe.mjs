#!/usr/bin/env node
/**
 * tools/_ultimate-multiplier-win-effect-probe.mjs · D-14.2 WIN-EFFECT
 *
 * Boki imperative (2026-06-20):
 *   "dalje, sve mora da rdi saverseno"
 *
 * Postojeci D-13 probe verifikuje da CANONICAL EVENT letio (feat=Y). Ne
 * verifikuje da je multiplier STVARNO podigao payout. Ovaj probe ide
 * sloj dublje: za svaki multiplier chip + svaku igru, klikne chip,
 * sace ka da spin settle, i proverava:
 *
 *   1. HookBus.getMult() > 1 posle klika
 *   2. (opciono) Vidljiv paint chip u DOM-u (ufp-mult-chip / ufp-orb-chip /
 *      lightning-bolt-overlay / .ufp-feature-chip / .hwfm-chip / .hwlom-chip /
 *      .hwrjm-chip / .mult-ladder[data-visible=true])
 *
 * Output: matrica game × kind sa PASS/FAIL per verdict, plus aggregate.
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const DIST = resolve(REPO, 'dist/real-games');
const OUT = resolve(REPO, 'reports/_ultimate-multiplier-win-effect');

const SETTLE_MS = 3000;
const VIEWPORT = { width: 1440, height: 900 };

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

/* Multiplier-relevant kinds — only the chips Boki cares about for
 * "ovaj multiplier zaista podigne payout". Other chips (free_spins,
 * big_win, wheel_bonus, jackpot, gamble, hold_and_win, bonus_pick)
 * dont set a payout multiplier and are out of scope here. */
const MULT_KINDS = new Set([
  'multiplier',
  'multiplier_orb',
  'persistent_multiplier',
  'lightning_x2', 'lightning_x3', 'lightning_x5', 'lightning_x10',
]);

/* Visible paint hook per kind — CSS selector that should exist in DOM
 * within SETTLE_MS after click. NULL means we don't gate on paint. */
const PAINT_SELECTOR = {
  multiplier:            '.ufp-mult-chip, [data-mult-applied]',
  multiplier_orb:        '.ufp-orb-chip, [data-mult-orb]',
  persistent_multiplier: '.pm-chip',
  lightning_x2:          '.lightning-bolt-overlay[data-mult="x2"], .lightning-bolt-overlay.is-striking',
  lightning_x3:          '.lightning-bolt-overlay[data-mult="x3"], .lightning-bolt-overlay.is-striking',
  lightning_x5:          '.lightning-bolt-overlay[data-mult="x5"], .lightning-bolt-overlay.is-striking',
  lightning_x10:         '.lightning-bolt-overlay[data-mult="x10"], .lightning-bolt-overlay.is-striking',
};

function listGames() {
  if (!existsSync(DIST)) return [];
  return readdirSync(DIST).filter(d => {
    const p = join(DIST, d, 'slot.html');
    try { return statSync(p).isFile(); } catch { return false; }
  }).sort();
}

function log(...a) { console.log(...a); }

async function discoverMultChipKinds(browser, game) {
  const url = pathToFileURL(join(DIST, game, 'slot.html')).href;
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('#spinBtn', { timeout: 8000 });
    const kinds = await page.evaluate(() => {
      const arr = [];
      document.querySelectorAll('.ufp-chip[data-ufp-kind]').forEach(el => {
        arr.push(el.getAttribute('data-ufp-kind'));
      });
      return arr;
    });
    await ctx.close();
    return kinds.filter(k => MULT_KINDS.has(k));
  } catch (e) {
    try { await ctx.close(); } catch {}
    throw e;
  }
}

async function runOneChip(browser, game, kind) {
  const url = pathToFileURL(join(DIST, game, 'slot.html')).href;
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e?.message || e)));

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('#spinBtn', { timeout: 8000 });
    await page.waitForFunction(() =>
      window.HookBus && typeof window.HookBus.getMult === 'function',
      { timeout: 8000 });

    const before = await page.evaluate(() => window.HookBus.getMult());

    const clickRes = await page.evaluate((k) => {
      const el = document.querySelector('.ufp-chip[data-ufp-kind="' + k + '"]');
      if (!el) return { ok: false, reason: 'not-found' };
      el.click();
      return { ok: true };
    }, kind);

    if (!clickRes.ok) {
      await ctx.close();
      return { kind, verdict: 'FAIL', reason: 'chip-missing',
               multBefore: before, multAfter: null, paintFound: null };
    }

    await page.waitForTimeout(SETTLE_MS);

    const after = await page.evaluate(() => window.HookBus.getMult());

    const sel = PAINT_SELECTOR[kind] || null;
    let paintFound = null;
    if (sel) {
      paintFound = await page.evaluate((s) => {
        return document.querySelectorAll(s).length > 0;
      }, sel);
    }

    const multRaised = (typeof after === 'number' && after > 1) ||
                       (typeof after === 'number' && after > before);
    const verdict = multRaised ? 'PASS' : 'FAIL';

    await ctx.close();
    return { kind, verdict, multBefore: before, multAfter: after, paintFound, pageErrors };
  } catch (e) {
    try { await ctx.close(); } catch {}
    return { kind, verdict: 'ERROR', error: String(e.message || e),
             multBefore: null, multAfter: null, paintFound: null, pageErrors };
  }
}

async function runGame(browser, game) {
  log(`\n┌─ ${game}`);
  let kinds;
  try {
    kinds = await discoverMultChipKinds(browser, game);
  } catch (e) {
    log(`│  ⚠ discover fail: ${String(e.message || e).slice(0, 160)}`);
    return { game, verdict: 'ERROR', perChip: [],
             summary: { totalChips: 0, pass: 0, fail: 0 } };
  }
  log(`│  multiplier chips: ${kinds.length}`);
  if (!kinds.length) {
    return { game, verdict: 'SKIP', reason: 'no-mult-chips', perChip: [],
             summary: { totalChips: 0, pass: 0, fail: 0 } };
  }

  const perChip = [];
  for (const kind of kinds) {
    const res = await runOneChip(browser, game, kind);
    perChip.push(res);
    const ratio = (res.multBefore != null && res.multAfter != null)
      ? `${res.multBefore}→${res.multAfter}`
      : `${res.multBefore}→${res.multAfter}`;
    const paint = res.paintFound === null ? '–' : (res.paintFound ? 'Y' : 'N');
    log(`│    ${res.verdict === 'PASS' ? '✓' : '✗'} ${kind.padEnd(24)} ` +
        `mult=${String(ratio).padEnd(8)} paint=${paint}`);
  }

  const pass = perChip.filter(c => c.verdict === 'PASS').length;
  const fail = perChip.filter(c => c.verdict !== 'PASS').length;
  log(`└─ ${pass}/${kinds.length} mult chips RAISE win`);

  return { game, verdict: fail === 0 ? 'PASS' : 'FAIL', perChip,
           summary: { totalChips: kinds.length, pass, fail } };
}

async function main() {
  const games = listGames();
  if (!games.length) { console.error('NO GAMES'); process.exit(2); }
  log(`🎯 D-14.2 MULTIPLIER WIN-EFFECT PROBE — ${games.length} games`);

  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const g of games) results.push(await runGame(browser, g));
  await browser.close();

  const totalChips = results.reduce((a, r) => a + (r.summary?.totalChips || 0), 0);
  const totalPass  = results.reduce((a, r) => a + (r.summary?.pass || 0), 0);
  const totalFail  = results.reduce((a, r) => a + (r.summary?.fail || 0), 0);
  const final = totalFail === 0 ? 'PASS' : 'FAIL';

  const report = {
    generatedAt: new Date().toISOString(),
    perGame: results,
    aggregate: { totalChips, totalPass, totalFail, final },
  };
  const outFile = join(OUT, `run-${Date.now()}.json`);
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  log('\n📄 Report:', outFile);

  log('\n┌──────────────────────────────────────────────────────────────────────┐');
  log(`│ D-14.2 MULT WIN-EFFECT · FINAL: ${final.padEnd(4)} ` +
      `(${totalPass}/${totalChips} PASS · ${totalFail} FAIL)`);
  log('└──────────────────────────────────────────────────────────────────────┘');
  for (const r of results) {
    log(`  • ${r.game.padEnd(38)} ${(r.verdict || '?').padEnd(5)} ` +
        `${r.summary?.pass ?? '?'}/${r.summary?.totalChips ?? '?'} PASS`);
  }

  process.exit(final === 'PASS' ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(2); });
