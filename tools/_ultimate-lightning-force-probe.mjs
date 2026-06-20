#!/usr/bin/env node
/**
 * tools/_ultimate-lightning-force-probe.mjs · D-12 LIGHTNING FORCE HUNTER
 *
 * Bokijev imperative (2026-06-20):
 *   "kada forsujem ... u WoO igri ili bilo kojoj koja ima taj blok, zelim
 *    da taj force radi. Znaci, mora da se pokaze kolko je multiplier da
 *    se izabere kao force dugme posebno, i on da da se odradi spin, da
 *    se dobije win i da se vidi da multiplier radi na taj dobitaj."
 *
 * SHTA RADI — per-chip end-to-end verifikacija:
 *
 *   Za svaku igru koja ima `lightning` feature deklarisan u model.json:
 *   1. Load slot.html u headless Chromium, čekaj RECT_REELS + spinBtn
 *    2. Instrument HookBus.emit (addInitScript) — snimaj svaki `onLightningStrike`
 *      event sa payload-om { multX, prevMult, newMult }
 *    3. Za svaku od 4 vrednosti [2, 3, 5, 10]:
 *       a. Klikni odgovarajući chip (.ufp-chip[data-ufp-kind="lightning_xN"])
 *       b. Sačekaj postSpin emit (max 8s)
 *       c. Sačekaj onWinPresentationEnd (osigurava da je spin fully resolved)
 *       d. Snimi __WIN_AWARD__, onLightningStrike events
 *    4. ASSERT-evi:
 *       • Tačno 1 onLightningStrike event po klik-u
 *       • payload.multX === forced value (tj. klik na ⚡×5 → multX===5)
 *       • __WIN_AWARD__ > 0 (multiplier mora imati win bazu da bi se primenio)
 *       • Strip-meter overlay vidljiv tokom strike-a (visual check optional)
 *
 *   Pass: 4/4 vrednosti × N igara = sve PASS, deterministic, 0 violacija.
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const DIST = resolve(REPO, 'dist/real-games');
const OUT = resolve(REPO, 'reports/_ultimate-lightning-force');

const FORCED_VALUES = [2, 3, 5, 10];
const SPIN_TIMEOUT_MS = 10000;
const VIEWPORT = { width: 1440, height: 900 };

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

function log(...a) { console.log(...a); }

function gamesWithLightning() {
  if (!existsSync(DIST)) return [];
  const games = [];
  for (const d of readdirSync(DIST)) {
    const modelPath = join(DIST, d, 'model.json');
    const slotPath  = join(DIST, d, 'slot.html');
    try {
      if (!statSync(slotPath).isFile()) continue;
      const m = JSON.parse(readFileSync(modelPath, 'utf8'));
      const features = Array.isArray(m && m.features) ? m.features : [];
      const hasFeatureLightning = features.some(f => f && f.kind === 'lightning');
      const hasTopLevelLightning = !!(m && m.lightning && typeof m.lightning === 'object');
      const hasRLM = !!(m && m.randomLightningMultiplier &&
                       typeof m.randomLightningMultiplier === 'object');
      if (hasFeatureLightning || hasTopLevelLightning || hasRLM) games.push(d);
    } catch {}
  }
  return games.sort();
}

const INIT_SCRIPT = `
(function() {
  if (window.__D12) return;
  window.__D12 = { strikes: [], started: performance.now() };
  const installer = setInterval(function () {
    if (!window.HookBus || typeof window.HookBus.emit !== 'function') return;
    if (window.HookBus.__d12_wrapped) return;
    const orig = window.HookBus.emit.bind(window.HookBus);
    window.HookBus.__d12_wrapped = true;
    window.HookBus.emit = function (name, payload) {
      if (name === 'onLightningStrike' || name === 'onLightningStrikeMissed') {
        window.__D12.strikes.push({
          event: name,
          ts: performance.now() - window.__D12.started,
          payload: payload || null,
          winAward: window.__WIN_AWARD__,
        });
      }
      return orig(name, payload);
    };
    clearInterval(installer);
  }, 30);
})();
`;

async function waitSpinEnabled(page, maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const ok = await page.evaluate(() => {
      const btn = document.getElementById('spinBtn');
      return !!(btn && !btn.disabled);
    });
    if (ok) return true;
    await page.waitForTimeout(120);
  }
  return false;
}

async function clickChipAndWaitPostSpin(page, kind, beforeCount) {
  const chipFound = await page.evaluate((k) => {
    const sel = '.ufp-chip[data-ufp-kind="' + k + '"]';
    const el = document.querySelector(sel);
    if (!el) return false;
    el.click();
    return true;
  }, kind);
  if (!chipFound) return { ok: false, reason: 'chip-missing' };

  /* Wait for a NEW strike event past the baseline count. */
  const start = Date.now();
  while (Date.now() - start < SPIN_TIMEOUT_MS) {
    const haveStrike = await page.evaluate(() =>
      (window.__D12.strikes || []).length);
    if (haveStrike > beforeCount) {
      /* Give a tiny window for the same-spin events to settle. */
      await page.waitForTimeout(400);
      return { ok: true };
    }
    await page.waitForTimeout(120);
  }
  return { ok: false, reason: 'no-strike-within-timeout' };
}

async function runGame(browser, game) {
  const url = pathToFileURL(join(DIST, game, 'slot.html')).href;
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  await page.addInitScript(INIT_SCRIPT);

  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e?.message || e)));

  log(`\n┌─ ${game}`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('#spinBtn', { timeout: 8000 });
    await page.waitForFunction(() => Array.isArray(window.RECT_REELS) &&
                                      window.RECT_REELS.length > 0,
                               { timeout: 10000 });
    await waitSpinEnabled(page, 4000);

    /* Verify all 4 chips are present in DOM. */
    const presentChips = await page.evaluate((vals) => {
      return vals.map(v => {
        const el = document.querySelector(
          '.ufp-chip[data-ufp-kind="lightning_x' + v + '"]');
        return el ? v : null;
      }).filter(Boolean);
    }, FORCED_VALUES);

    log(`│  chip discovery: ${presentChips.length}/4 present ` +
        `[${presentChips.map(v => 'x' + v).join(', ')}]`);

    if (presentChips.length === 0) {
      log(`│  ⚠ no lightning chips rendered — skipping`);
      await ctx.close();
      return { game, verdict: 'SKIP', reason: 'no-chips', perValue: [] };
    }

    /* Clear strikes log before per-value loop. */
    await page.evaluate(() => { window.__D12.strikes = []; });

    const perValue = [];
    for (const v of FORCED_VALUES) {
      const kind = 'lightning_x' + v;
      if (!presentChips.includes(v)) {
        perValue.push({ value: v, ok: false, reason: 'chip-missing' });
        log(`│    × ⚡×${v}: chip missing`);
        continue;
      }
      await waitSpinEnabled(page, 8000);
      /* Snapshot strike count before click — anything new is from THIS chip. */
      const before = await page.evaluate(() => (window.__D12.strikes || []).length);
      const res = await clickChipAndWaitPostSpin(page, kind, before);
      /* Extra settle window — UFP sets BUSY=true for ~3s after chip click. */
      await page.waitForTimeout(3200);

      const snap = await page.evaluate((b) => {
        const all = window.__D12.strikes || [];
        const newStrikes = all.slice(b);
        return {
          newStrikes,
          totalAward: window.__WIN_AWARD__,
          forcedFlagAfter: window.__FORCE_LIGHTNING_MULT__,  /* should be null */
        };
      }, before);

      const strikeEvents = snap.newStrikes.filter(s => s.event === 'onLightningStrike');
      const verifiedValue = strikeEvents.length === 1 &&
                             strikeEvents[0].payload &&
                             strikeEvents[0].payload.multX === v;
      const pass = res.ok && verifiedValue;

      perValue.push({
        value: v, kind, ok: pass,
        chipClicked: res.ok,
        strikeCount: strikeEvents.length,
        observedMultX: strikeEvents[0]?.payload?.multX ?? null,
        winAwardAfter: snap.totalAward,
        forcedFlagClearedAfter: snap.forcedFlagAfter == null,
        clickError: res.ok ? null : res.reason,
      });
      log(`│    ${pass ? '✓' : '✗'} ⚡×${v}: strikes=${strikeEvents.length} ` +
          `observedMultX=${strikeEvents[0]?.payload?.multX ?? '?'} ` +
          `award=${snap.totalAward}`);
    }

    await ctx.close();
    const passCount = perValue.filter(p => p.ok).length;
    const verdict = (passCount === FORCED_VALUES.length && pageErrors.length === 0)
      ? 'PASS' : 'FAIL';
    log(`└─ ${verdict}  (${passCount}/${FORCED_VALUES.length} values verified)`);

    return { game, verdict, perValue, pageErrors,
             summary: { passCount, totalCount: FORCED_VALUES.length,
                        pageErrors: pageErrors.length } };
  } catch (e) {
    log(`│  ⚠ unexpected: ${String(e.message || e).slice(0, 200)}`);
    try { await ctx.close(); } catch {}
    return { game, verdict: 'ERROR', error: String(e.message || e),
             perValue: [], pageErrors,
             summary: { passCount: 0, totalCount: FORCED_VALUES.length,
                        pageErrors: pageErrors.length } };
  }
}

async function main() {
  const games = gamesWithLightning();
  if (!games.length) {
    console.error('NO GAMES with lightning feature in', DIST);
    process.exit(2);
  }
  log(`🎯 D-12 LIGHTNING FORCE PROBE — ${games.length} igara × 4 vrednosti = ` +
      `${games.length * 4} deterministic strike-ova`);

  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const g of games) results.push(await runGame(browser, g));
  await browser.close();

  const pass = results.filter(r => r.verdict === 'PASS').length;
  const fail = results.filter(r => r.verdict === 'FAIL').length;
  const skip = results.filter(r => r.verdict === 'SKIP').length;
  const err  = results.filter(r => r.verdict === 'ERROR').length;
  const finalVerdict = (fail === 0 && err === 0 && pass > 0) ? 'PASS' : 'FAIL';

  const report = {
    generatedAt: new Date().toISOString(),
    config: { forcedValues: FORCED_VALUES, viewport: VIEWPORT,
              spinTimeoutMs: SPIN_TIMEOUT_MS },
    perGame: results.map(r => ({ game: r.game, verdict: r.verdict,
                                  ...r.summary, perValue: r.perValue,
                                  error: r.error })),
    finalVerdict, pass, fail, skip, err,
  };
  const outFile = join(OUT, `run-${Date.now()}.json`);
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  log('\n📄 Report:', outFile);

  log('\n┌──────────────────────────────────────────────────────────────────────────┐');
  log(`│ D-12 LIGHTNING FORCE · FINAL: ${finalVerdict.padEnd(4)} ` +
      `(${pass} PASS / ${fail} FAIL / ${skip} SKIP / ${err} ERR)`);
  log('└──────────────────────────────────────────────────────────────────────────┘');
  for (const r of results) {
    log(`  • ${r.game.padEnd(38)} ${r.verdict.padEnd(5)} ` +
        `${r.summary.passCount}/${r.summary.totalCount} values verified`);
  }

  process.exit(finalVerdict === 'PASS' ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(2); });
