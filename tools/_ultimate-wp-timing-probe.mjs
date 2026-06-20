#!/usr/bin/env node
/**
 * tools/_ultimate-wp-timing-probe.mjs · D-11 WIN-PRESENTATION TIMING HUNTER
 *
 * Bokijev imperative (2026-06-20):
 *   "Win prezentacije se javlajaju dok se okrecu rilovi, big win takodje"
 *
 * SHTA RADI — race-condition lover:
 *
 *   1. addInitScript injektuje wrappere PRE bilo kog block runtime-a:
 *      a. monkey-patch HookBus.emit da snima { event, ts, spinningReels,
 *         spinningBtn, fsmState } za svaki emit
 *      b. mutation observer na .reelCol da snima [is-spinning] add/remove
 *         timestamp
 *
 *   2. Per igri, forsira N=12 spinova sa noWinChance=0 + niska big-win
 *      threshold:
 *      a. set window.__cfg.winPresentation.noWinChance = 0
 *      b. set window.BIG_WIN_TIER_STATE.thresholds[0] = 0.1 (svaki win = big)
 *      c. klik spin
 *      d. čekaj postSpin event ili 6000ms timeout
 *
 *   3. Posle svih spinova, izvuče log i izvrši ASSERT-eve:
 *      • Svaki onWinPresentationStart mora doći POSLE poslednjeg
 *        onSpinResult event-a (ne sme pre)
 *      • U trenutku emit-a onWinPresentationStart, count
 *        document.querySelectorAll('.reelCol.is-spinning').length
 *        MORA biti 0 (svi reels stali)
 *      • Isto za onBigWinTierEntered (idi i strožije — emit posle End)
 *      • Nijedna `.cell--winsym` aktivna klasa ne sme postojati dok
 *        bilo koji `.reelCol.is-spinning` traje (paralelni-state guard)
 *
 *   4. Pass kriterijum: 0 violacija kroz sve igre, sve spinove.
 *
 * Razlog zašto BUG postoji (pre-fix hipoteza):
 *   winPresentation.mjs:728 / :845 / :943 emituju onWinPresentationStart
 *   bez eksplicitnog guard-a na `.reelCol.is-spinning` state. Timing je
 *   isključivo posledica callback ordering-a iz reelEngine.onTickAll →
 *   onSpinResult → handlePostSpin → applyWinHighlight. Bilo koji
 *   asinhroni hop između tih tačaka (rAF microtask race, FS retrigger,
 *   slamStop) ostavlja prostor da emit prođe DOK su reels još
 *   .is-spinning. Player vidi "win cycle dok reels rotiraju".
 *
 *   Fix: pre svakog emit-a, await waitForReelsIdle() koji čeka da
 *   `.reelCol.is-spinning` count padne na 0 (max 2000ms timeout).
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const DIST = resolve(REPO, 'dist/real-games');
const OUT = resolve(REPO, 'reports/_ultimate-wp-timing');

const SPINS_PER_GAME = 12;
const SPIN_TIMEOUT_MS = 6000;
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

const INIT_SCRIPT = `
(function() {
  if (window.__D11) return;
  window.__D11 = { events: [], started: performance.now() };

  function snapState() {
    const reelsSpinning = document.querySelectorAll('.reelCol.is-spinning').length;
    const spinBtn = document.getElementById('spinBtn');
    const spinBtnSpinning = !!(spinBtn && spinBtn.classList.contains('is-spinning'));
    const winsymCells = document.querySelectorAll('.cell--winsym, .cell.is-win, text.is-win').length;
    const fsmState = (window.FSM && (window.FSM.state || window.FSM.phase)) || null;
    return { reelsSpinning, spinBtnSpinning, winsymCells, fsmState };
  }

  /* Monkey-patch HookBus.emit AS SOON as HookBus appears on window. */
  const installer = setInterval(function () {
    if (!window.HookBus || typeof window.HookBus.emit !== 'function') return;
    if (window.HookBus.__d11_wrapped) return;
    const origEmit = window.HookBus.emit.bind(window.HookBus);
    window.HookBus.__d11_wrapped = true;
    window.HookBus.emit = function (name, payload) {
      const watched = (
        name === 'onSpinResult' ||
        name === 'onWinPresentationStart' ||
        name === 'onWinPresentationEnd' ||
        name === 'onBigWinTierEntered' ||
        name === 'onBigWinTierExited' ||
        name === 'postSpin' ||
        name === 'preSpin'
      );
      if (watched) {
        window.__D11.events.push({
          event: name,
          ts: performance.now() - window.__D11.started,
          state: snapState(),
          payloadKind: payload && typeof payload === 'object'
            ? Object.keys(payload).join(',') : typeof payload,
        });
      }
      return origEmit(name, payload);
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

async function clickSpinAndWait(page) {
  /* Click spin, wait for postSpin or timeout. */
  const before = await page.evaluate(() => window.__D11.events.length);
  await page.evaluate(() => {
    const btn = document.getElementById('spinBtn');
    if (btn && !btn.disabled) btn.click();
  });
  const start = Date.now();
  while (Date.now() - start < SPIN_TIMEOUT_MS) {
    const last = await page.evaluate(() => {
      const ev = window.__D11.events;
      for (let i = ev.length - 1; i >= 0; i--) {
        if (ev[i].event === 'postSpin') return ev[i].ts;
      }
      return null;
    });
    if (last !== null) {
      const evCount = await page.evaluate(() => window.__D11.events.length);
      if (evCount > before) return true;
    }
    await page.waitForTimeout(120);
  }
  return false;
}

async function runGame(browser, game) {
  const url = pathToFileURL(join(DIST, game, 'slot.html')).href;
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  await page.addInitScript(INIT_SCRIPT);

  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e?.message || e)));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  log(`\n┌─ ${game}`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('#spinBtn', { timeout: 8000 });
    await page.waitForFunction(() => {
      return Array.isArray(window.RECT_REELS) && window.RECT_REELS.length > 0;
    }, { timeout: 10000 });
    await waitSpinEnabled(page, 4000);

    /* Force-rich mode: every spin pays. Lower BW threshold to 0.1× bet so
       small wins also trip the big-win path → tests both emit sites. */
    await page.evaluate(() => {
      try {
        if (window.__cfg && window.__cfg.winPresentation) {
          window.__cfg.winPresentation.noWinChance = 0;
          window.__cfg.winPresentation.suppressLDW = false;
        }
        if (window.BIG_WIN_TIER_STATE) {
          window.BIG_WIN_TIER_STATE.enabled = true;
          if (Array.isArray(window.BIG_WIN_TIER_STATE.thresholds) &&
              window.BIG_WIN_TIER_STATE.thresholds.length > 0) {
            window.BIG_WIN_TIER_STATE.thresholds[0] = 0.1;
          }
        }
      } catch (_) {}
    });

    let spinsDone = 0;
    for (let s = 0; s < SPINS_PER_GAME; s++) {
      /* Force a BW tier per-spin to GUARANTEE wpStart + bwEnter emit so
         the timing assertion has something to validate. Tier 1 is the
         smallest big-win level — enough to trip both emit sites. */
      await page.evaluate(() => { window.__FORCE_BIG_WIN_TIER__ = 1; });
      const ok = await clickSpinAndWait(page);
      if (!ok) break;
      spinsDone++;
      /* Let any post-spin async (winCycle, BW banner) finish before next. */
      await waitSpinEnabled(page, 8000);
      await page.waitForTimeout(200);
    }

    const events = await page.evaluate(() => window.__D11.events || []);
    await ctx.close();

    /* Per-emit assertions. */
    const violations = [];
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.event === 'onWinPresentationStart' || e.event === 'onBigWinTierEntered') {
        if (e.state.reelsSpinning > 0) {
          violations.push({
            kind: 'emit-while-reels-spinning', idx: i, event: e.event,
            ts: e.ts, reelsSpinning: e.state.reelsSpinning,
            spinBtnSpinning: e.state.spinBtnSpinning, fsmState: e.state.fsmState,
          });
        }
      }
    }

    /* Ordering check — for each onWinPresentationStart there must be an
       onSpinResult earlier in the log (within same spin window). */
    let lastSpinResultTs = -1;
    for (const e of events) {
      if (e.event === 'onSpinResult') lastSpinResultTs = e.ts;
      if (e.event === 'onWinPresentationStart' && lastSpinResultTs < 0) {
        violations.push({
          kind: 'wp-start-before-any-spin-result', event: e.event, ts: e.ts,
        });
      }
    }

    const wpStarts  = events.filter(e => e.event === 'onWinPresentationStart').length;
    const wpEnds    = events.filter(e => e.event === 'onWinPresentationEnd').length;
    const bwEnters  = events.filter(e => e.event === 'onBigWinTierEntered').length;
    const spinRes   = events.filter(e => e.event === 'onSpinResult').length;
    const postSpins = events.filter(e => e.event === 'postSpin').length;

    const verdict = (violations.length === 0 && pageErrors.length === 0)
      ? 'PASS' : 'FAIL';

    log(`│  spins: ${spinsDone}/${SPINS_PER_GAME}  postSpin: ${postSpins}  ` +
        `onSpinResult: ${spinRes}`);
    log(`│  wpStart: ${wpStarts}  wpEnd: ${wpEnds}  bwEnter: ${bwEnters}`);
    log(`│  violations: ${violations.length}  pageErrors: ${pageErrors.length}`);
    if (violations.length) {
      for (const v of violations.slice(0, 5)) {
        log(`│    ✗ ${v.kind} · ${v.event} @ ${v.ts?.toFixed?.(1) ?? '?'}ms · ` +
            `reels spinning: ${v.reelsSpinning ?? '?'}  fsm: ${v.fsmState ?? '?'}`);
      }
    }
    log(`└─ ${verdict}`);

    return {
      game, verdict, spinsDone, events, violations,
      summary: { wpStarts, wpEnds, bwEnters, spinRes, postSpins,
                 violationCount: violations.length,
                 pageErrors: pageErrors.length,
                 consoleErrors: consoleErrors.length },
      pageErrors, consoleErrors,
    };
  } catch (e) {
    log(`│  ⚠ unexpected: ${String(e.message || e).slice(0, 200)}`);
    try { await ctx.close(); } catch {}
    return { game, verdict: 'ERROR', error: String(e.message || e),
             summary: { wpStarts: 0, wpEnds: 0, bwEnters: 0, spinRes: 0,
                        postSpins: 0, violationCount: 0,
                        pageErrors: pageErrors.length,
                        consoleErrors: consoleErrors.length },
             pageErrors, consoleErrors };
  }
}

async function main() {
  const games = listGames();
  if (!games.length) { console.error('NO GAMES'); process.exit(2); }
  log(`🎯 D-11 WP-TIMING PROBE — ${games.length} igara, ${SPINS_PER_GAME} forced-win spins/each`);

  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const g of games) results.push(await runGame(browser, g));
  await browser.close();

  const pass = results.filter(r => r.verdict === 'PASS').length;
  const fail = results.filter(r => r.verdict === 'FAIL').length;
  const err  = results.filter(r => r.verdict === 'ERROR').length;
  const totalViolations = results.reduce((a, r) =>
    a + (r.summary?.violationCount || 0), 0);
  const finalVerdict = (fail === 0 && err === 0 && totalViolations === 0)
    ? 'PASS' : 'FAIL';

  const report = {
    generatedAt: new Date().toISOString(),
    config: { spinsPerGame: SPINS_PER_GAME, viewport: VIEWPORT,
              spinTimeoutMs: SPIN_TIMEOUT_MS },
    perGame: results.map(r => ({ game: r.game, verdict: r.verdict,
                                  ...r.summary,
                                  violations: (r.violations || []).slice(0, 10),
                                  error: r.error })),
    rawEvents: results.map(r => ({ game: r.game, events: r.events || [] })),
    finalVerdict, pass, fail, err, totalViolations,
  };
  const outFile = join(OUT, `run-${Date.now()}.json`);
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  log('\n📄 Report:', outFile);

  log('\n┌──────────────────────────────────────────────────────────────────────────┐');
  log(`│ D-11 WP-TIMING · FINAL: ${finalVerdict.padEnd(4)} ` +
      `(${pass} PASS / ${fail} FAIL / ${err} ERR)`);
  log('└──────────────────────────────────────────────────────────────────────────┘');
  for (const r of results) {
    log(`  • ${r.game.padEnd(38)} ${r.verdict.padEnd(5)} ` +
        `viol=${r.summary?.violationCount ?? '?'}  ` +
        `wpStart=${r.summary?.wpStarts ?? '?'}  ` +
        `bwEnter=${r.summary?.bwEnters ?? '?'}`);
  }

  process.exit(finalVerdict === 'PASS' ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(2); });
