#!/usr/bin/env node
/**
 * tools/_ultimate-all-force-chips-probe.mjs · D-13 ALL-FORCE-CHIPS AUDIT
 *
 * Boki imperative (2026-06-20, follow-up posle D-12):
 *   pattern iz lightning_x* mora da važi za SVAKI force chip — klik mora
 *   da pokrene REAL spin i da relevantan feature stvarno proradi.
 *
 * SHTA RADI:
 *   1. Za svaku igru:
 *      a. Discover SVI chip-ovi u panelu (.ufp-chip[data-ufp-kind])
 *      b. Klikni svaki redom; izmedju klikova settle window (BUSY lock)
 *      c. Snimi koji HookBus event-evi su emitovani posle svakog klika
 *         (whitelist relevantnih per-kind signala)
 *      d. ASSERT-evi per chip:
 *           • clicked OK (chip postoji + klik prošao)
 *           • spinHappened (postSpin event posle klika)
 *           • featureEmit (≥ 1 expected event za taj kind)
 *
 *   2. Per-kind expected-event mapping (kind → list of acceptable emit
 *      names). Ako bar JEDAN iz liste padne posle klika, smatra se da
 *      feature radi.
 *
 *   3. Verdict: PASS = clicked + spinHappened + featureEmit svuda.
 *      FAIL = bilo koji od tri ne prođe.
 *
 * Output: matrica game × kind sa per-kind verdict-om, plus aggregate
 * "koliko je broken chip-ova kroz sve igre".
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const DIST = resolve(REPO, 'dist/real-games');
const OUT = resolve(REPO, 'reports/_ultimate-all-force-chips');

const CHIP_TIMEOUT_MS = 12000;
const SETTLE_AFTER_MS = 3500;
const VIEWPORT = { width: 1440, height: 900 };

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

function log(...a) { console.log(...a); }

function listGames() {
  if (!existsSync(DIST)) return [];
  return readdirSync(DIST).filter(d => {
    const p = join(DIST, d, 'slot.html');
    try { return statSync(p).isFile(); } catch { return false; }
  }).sort();
}

/* Per-kind acceptable "feature actually triggered" emit names. If a chip
   click produces ANY of these events, we count the feature as wired.
   Empty list means "any postSpin is enough" (the chip is purely
   spin-triggering with no per-feature signal — e.g. cascade evaluators). */
const EXPECTED_EVENTS = {
  free_spins:           ['onFsTrigger'],
  big_win:              ['onBigWinTierEntered'],
  hold_and_win:         ['onHoldAndWinPayout', 'onHoldAndWinPhase',
                          'onHoldAndWinEnd', 'onWildTriggerHoldAndWinRequested',
                          'onHoldAndWinReelExpanded'],
  bonus_pick:           ['onPickRevealStart', 'onPickRevealEnd',
                          'onForceFeatureRequested'],
  wheel_bonus:          ['onWheelSettled', 'onWheelSegmentChosen',
                          'onWheelModalOpened', 'wheelBonus.spin',
                          'wheelBonus.complete'],
  bonus_buy:            ['onBonusBuyRequested', 'onBonusBuyMenuOpened'],
  multiplier:           ['onMultiplierChanged', 'onMultChange',
                          'onForceMultiplier'],
  multiplier_orb:       ['onMultiplierChanged', 'onMultChange',
                          'onForceMultiplier'],
  persistent_multiplier:['onMultChange', 'onForceMultiplier',
                          'onMultiplierChanged'],
  cascade:              ['onTumbleStep'],
  cluster_pays:         ['clusterPays:evaluated', 'onClusterPay'],
  ways:                 ['onAllWaysPay', 'onBidirectionalWaysPay',
                          'onWaysReshaped'],
  pay_anywhere:         ['onForceFeatureRequested'],
  expanding_wild:       ['expandingWild:applied', 'onExpansionWildAdded'],
  walking_wild:         ['onWalkingWildSpawned', 'onWalkingWildStep'],
  sticky_wild:          ['onStickyCountChange'],
  mystery_symbol:       ['onMysteryRevealStart', 'onMysteryRevealEnd',
                          'onMysteryWildRevealed', 'onMysteryMultiplierRevealed'],
  scatter_pay:          ['onScatterCelebrationStart', 'onForceFeatureRequested'],
  lightning:            ['onLightningStrike'],
  lightning_x2:         ['onLightningStrike'],
  lightning_x3:         ['onLightningStrike'],
  lightning_x5:         ['onLightningStrike'],
  lightning_x10:        ['onLightningStrike'],
  respin:               ['requestRespin', 'onRespinChargeBump',
                          'onRespinChargeFull'],
  wild_reel:            ['onForceFeatureRequested'],
  gamble:               ['onGambleStart', 'onGambleRound', 'onGambleEnd'],
  ante_bet:             ['onAnteBetChanged'],
  super_symbol:         ['onSuperSymbolLand', 'onSuperSymbolUpgraded'],
  jackpot:              ['onJackpotRoomEnter', 'onJackpotRoomEntered',
                          'onJackpotRoomWon', 'onWheelJackpotHit',
                          'onDailyJackpotAward'],
};

/* Whitelist of event names that the page wrapper should retain (covers
   union of EXPECTED_EVENTS values + postSpin). */
const WATCHED_EVENTS = Array.from(new Set(
  ['postSpin', 'preSpin'].concat(
    ...Object.values(EXPECTED_EVENTS))
));

const INIT_SCRIPT = `
(function() {
  if (window.__D13) return;
  window.__D13 = { events: [] };
  const WATCH = new Set(${JSON.stringify(WATCHED_EVENTS)});
  const installer = setInterval(function () {
    if (!window.HookBus || typeof window.HookBus.emit !== 'function') return;
    if (window.HookBus.__d13_wrapped) return;
    const orig = window.HookBus.emit.bind(window.HookBus);
    window.HookBus.__d13_wrapped = true;
    window.HookBus.emit = function (name, payload) {
      if (WATCH.has(name)) {
        window.__D13.events.push({ event: name, ts: performance.now() });
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

/* D-13.1 (2026-06-20) — RELOAD-PER-CHIP. Earlier sweep iterated all chips
 * on a single page load → after the first chip that entered an FS round
 * (or BW tier banner), every subsequent chip click was silently rejected
 * by UFP `_isFsActive()` guard ("force chip rejected — FS round active",
 * per `rule_force_buttons_real_spin.md` + FIX-8 M7). Result: TAČNO 1
 * chip PASS po igri, sve ostalo "spin=N feat=N" false-negative.
 *
 * Fix: each chip gets a fresh page (newContext + newPage) so global state
 * (`__SLOT_FSM_STATE`, `__FORCE_*__`, FREESPINS.remaining) starts clean.
 * Trade-off: probe takes ~3× longer but matrix is honest.
 */

async function discoverChipKinds(browser, game) {
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
    return kinds;
  } catch (e) {
    try { await ctx.close(); } catch {}
    throw e;
  }
}

async function runOneChipFreshPage(browser, game, kind) {
  const url = pathToFileURL(join(DIST, game, 'slot.html')).href;
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  await page.addInitScript(INIT_SCRIPT);

  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e?.message || e)));

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('#spinBtn', { timeout: 8000 });
    await page.waitForFunction(() =>
      Array.isArray(window.RECT_REELS) && window.RECT_REELS.length > 0,
      { timeout: 10000 });
    await waitSpinEnabled(page, 4000);

    const before = await page.evaluate(() => window.__D13.events.length);
    const clickRes = await page.evaluate((k) => {
      const el = document.querySelector('.ufp-chip[data-ufp-kind="' + k + '"]');
      if (!el) return { ok: false, reason: 'not-found' };
      el.click();
      return { ok: true };
    }, kind);

    if (!clickRes.ok) {
      await ctx.close();
      return { kind, clicked: false, spinHappened: false, featureEmit: false,
               verdict: 'FAIL', reason: 'chip-missing', pageErrors };
    }

    const start = Date.now();
    let newEvents = [];
    while (Date.now() - start < CHIP_TIMEOUT_MS) {
      const snap = await page.evaluate((b) => {
        const all = window.__D13.events || [];
        return all.slice(b);
      }, before);
      newEvents = snap;
      const hasPostSpin = newEvents.some(e => e.event === 'postSpin');
      if (hasPostSpin) break;
      await page.waitForTimeout(150);
    }

    const spinHappened = newEvents.some(e => e.event === 'postSpin');
    const expected = EXPECTED_EVENTS[kind] || [];
    const featureEmit = expected.length === 0
      ? true
      : newEvents.some(e => expected.includes(e.event));

    const verdict = (clickRes.ok && spinHappened && featureEmit) ? 'PASS' : 'FAIL';
    await ctx.close();
    return {
      kind, clicked: true, spinHappened, featureEmit, verdict,
      emittedEvents: Array.from(new Set(newEvents.map(e => e.event))),
      expectedEvents: expected, pageErrors,
    };
  } catch (e) {
    try { await ctx.close(); } catch {}
    return { kind, clicked: false, spinHappened: false, featureEmit: false,
             verdict: 'ERROR', error: String(e.message || e), pageErrors };
  }
}

async function runGame(browser, game) {
  log(`\n┌─ ${game}`);
  let chipKinds;
  try {
    chipKinds = await discoverChipKinds(browser, game);
  } catch (e) {
    log(`│  ⚠ discover failed: ${String(e.message || e).slice(0, 200)}`);
    return { game, verdict: 'ERROR', error: String(e.message || e),
             perChip: [], summary: { totalChips: 0, pass: 0, fail: 0 } };
  }
  log(`│  discovered chips: ${chipKinds.length}`);
  if (!chipKinds.length) {
    return { game, verdict: 'SKIP', reason: 'no-chips', perChip: [],
             summary: { totalChips: 0, pass: 0, fail: 0 } };
  }

  const perChip = [];
  for (const kind of chipKinds) {
    const res = await runOneChipFreshPage(browser, game, kind);
    perChip.push(res);
    log(`│    ${res.verdict === 'PASS' ? '✓' : '✗'} ${kind.padEnd(24)} ` +
        `spin=${res.spinHappened ? 'Y' : 'N'} feat=${res.featureEmit ? 'Y' : 'N'}`);
  }

  const pass = perChip.filter(c => c.verdict === 'PASS').length;
  const fail = perChip.filter(c => c.verdict !== 'PASS').length;
  log(`└─ ${pass}/${chipKinds.length} chips PASS · ${fail} FAIL`);

  return { game, verdict: fail === 0 ? 'PASS' : 'FAIL', perChip,
           summary: { totalChips: chipKinds.length, pass, fail } };
}

async function main() {
  const games = listGames();
  if (!games.length) { console.error('NO GAMES'); process.exit(2); }
  log(`🎯 D-13 ALL-FORCE-CHIPS PROBE — ${games.length} igara, ~${games.length * 15} chip clicks total`);

  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const g of games) results.push(await runGame(browser, g));
  await browser.close();

  /* Aggregate broken-chip map: kind → list of games where it FAILed. */
  const brokenByKind = {};
  for (const r of results) {
    for (const c of (r.perChip || [])) {
      if (c.verdict !== 'PASS') {
        if (!brokenByKind[c.kind]) brokenByKind[c.kind] = [];
        brokenByKind[c.kind].push({
          game: r.game, spinHappened: c.spinHappened,
          featureEmit: c.featureEmit, emittedEvents: c.emittedEvents,
        });
      }
    }
  }

  const totalChips = results.reduce((a, r) => a + (r.summary?.totalChips || 0), 0);
  const totalPass  = results.reduce((a, r) => a + (r.summary?.pass || 0), 0);
  const totalFail  = results.reduce((a, r) => a + (r.summary?.fail || 0), 0);
  const finalVerdict = totalFail === 0 ? 'PASS' : 'FAIL';

  const report = {
    generatedAt: new Date().toISOString(),
    perGame: results,
    brokenByKind,
    aggregate: { totalChips, totalPass, totalFail, finalVerdict,
                  uniqueBrokenKinds: Object.keys(brokenByKind).length },
  };
  const outFile = join(OUT, `run-${Date.now()}.json`);
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  log('\n📄 Report:', outFile);

  log('\n┌──────────────────────────────────────────────────────────────────────────┐');
  log(`│ D-13 ALL-FORCE-CHIPS · FINAL: ${finalVerdict.padEnd(4)} ` +
      `(${totalPass}/${totalChips} chip-clicks PASS · ${totalFail} FAIL)`);
  log(`│ Unique broken chip kinds: ${Object.keys(brokenByKind).length}`);
  log('└──────────────────────────────────────────────────────────────────────────┘');
  for (const r of results) {
    log(`  • ${r.game.padEnd(38)} ${(r.verdict || '?').padEnd(5)} ` +
        `${r.summary?.pass ?? '?'}/${r.summary?.totalChips ?? '?'} PASS`);
  }
  if (Object.keys(brokenByKind).length) {
    log('\n  Broken chip kinds (count of games failing):');
    for (const [k, list] of Object.entries(brokenByKind)) {
      log(`    ✗ ${k.padEnd(28)} ${list.length} game(s) fail`);
    }
  }

  process.exit(finalVerdict === 'PASS' ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(2); });
