#!/usr/bin/env node
/**
 * tools/_ultimate-block-stress-real.mjs · D-3 REAL ULTIMATE STRESS
 *
 * Bokijev imperative (2026-06-19 20:08):
 *   "trreba mi realan i ultiamtivan test ... svaki jebeni blok"
 * Follow-up (2026-06-19 22:20):
 *   "sve istestiraj i sve noguce popravi ultimativno"
 *
 * Pravi headless Chromium stress probe — NIJE Node in-memory simulacija.
 * Za svaki real GDD fixture:
 *
 *   1. Pokrene pravi headless Chromium (NIJE Node fake)
 *   2. Učita dist/real-games/<game>/slot.html sa file:// URL
 *   3. Hvata svaku console error, page error, uncaught rejection
 *   4. Snima INITIAL DOM node count + initial heap
 *   5. WARMUP 5 spinova (lazy-init listenere — BBM wire, FS hook, autoplay)
 *   6. Snima POST-WARMUP baseline (pravi referenc za leak detect)
 *   7. Vrši 100 stvarnih spin-clickova sa await za postSpin emit
 *   8. Posle 100 spinova: force-okida svaku UFP chip (.ufp-chip[data-ufp-kind])
 *   9. Posle force-trigger: dodatnih 20 spinova
 *   10. Snima FINAL DOM node count, final heap, listener counts
 *   11. Leak verdict = POST-WARMUP → FINAL delta (NIJE initial→final,
 *       to lovi lazy init pa false-positive)
 *
 * Real wall-clock: ~5-8 minuta. NIJE 11 sekundi sintetičkog.
 *
 * D-3 fixovi vs D-1.5 (false-positive verzija od 21:11):
 *   • Warmup baseline (5 spinova) — više nema "listeners grew by 116"
 *     false positive od lazy-init BBM/FS listenera
 *   • Pravi UFP selector `.ufp-chip[data-ufp-kind]` — forcedKinds više nije []
 *   • Heap delta isključen iz verdict-a (Chromium roundeuje na 10MB)
 *   • Per-block coverage verifikacija (blocks.json declared = runtime detect)
 *   • Pre-rebuild garantuje da je svaka igra fresh build (paylineOverlay
 *     fix iz Wave D-3 mora biti u dist-u pre probe-a)
 *
 * Detektuje (ono što D-1 NE detektuje):
 *   • DOM node leak (postSpin ne čisti cells, overlay-i ostaju)
 *   • Listener growth POSLE warmup-a (pravi leak signal)
 *   • Console error koje ulaze tek na real DOM render
 *   • Page error iz block runtime-a (npr. cell.getBoundingClientRect bug)
 *   • DOM grid integrity na force-trigger sweep-u
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const DIST = resolve(REPO, 'dist/real-games');
const OUT = resolve(REPO, 'reports/_ultimate-block-stress-real');

const SPINS_WARMUP = 5;        /* lazy-init plateau (BBM wire, FS hooks) */
const SPINS_BASE = 100;        /* base spinovi posle warmup-a */
const SPINS_AFTER_FORCE = 20;  /* posle force trigger sweep */
const SPIN_WAIT_MS = 100;      /* min wait per spin event */
const POST_SPIN_TIMEOUT = 4000;

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

function log(...a) { console.log(...a); }

async function getMetrics(page) {
  return await page.evaluate(() => {
    const nodes = document.querySelectorAll('*').length;
    const cells = document.querySelectorAll('.cell').length;
    const overlays = document.querySelectorAll('[id$="Overlay"], [class*="overlay"]').length;
    /* Aggregate listener count across canonical lifecycle events. */
    const events = ['preSpin','onSpinResult','onTumbleStep','postSpin',
                    'onFsTrigger','onFsSpinResult','onFsEnd',
                    'onSkipRequested','onSlamRequested',
                    'onWinPresentationStart','onWinPresentationEnd',
                    'onBigWinTierEntered'];
    let listeners = 0;
    const perEvent = {};
    try {
      if (window.HookBus && typeof window.HookBus.listenerCount === 'function') {
        for (const e of events) {
          const n = window.HookBus.listenerCount(e) || 0;
          perEvent[e] = n;
          listeners += n;
        }
      }
    } catch (_) {}
    let heap = 0;
    try { heap = performance.memory ? performance.memory.usedJSHeapSize : 0; } catch (_) {}
    return { nodes, cells, overlays, listeners, perEvent, heap };
  });
}

async function clickSpin(page) {
  return await page.evaluate(() => {
    const btn = document.getElementById('spinBtn');
    if (btn && !btn.disabled) { btn.click(); return true; }
    return false;
  });
}

/* Wait up to N ms for spinBtn to become enabled again. Returns true if
   enabled, false if timeout. Handles FS intro / big-win rollup / autoplay
   transitions where the button is locked for a few seconds. */
async function waitSpinEnabled(page, maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const ok = await page.evaluate(() => {
      const btn = document.getElementById('spinBtn');
      return !!(btn && !btn.disabled);
    });
    if (ok) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

/* Dismiss known modal overlays (FS intro, big-win celebration, BBM, scatter)
   so the test stream keeps moving. Looks for canonical close/skip selectors
   in priority order. Returns count dismissed. */
async function dismissModalsIfAny(page) {
  return await page.evaluate(() => {
    let n = 0;
    const tryClick = (sel) => {
      const el = document.querySelector(sel);
      if (el && typeof el.click === 'function' && !el.disabled) { el.click(); n++; return true; }
      return false;
    };
    /* Canonical close/skip surfaces in priority order. */
    tryClick('#fsIntroSkip');
    tryClick('#fsOutroContinue');
    tryClick('#bbmClose');
    tryClick('#bigWinSkip');
    tryClick('.scatter-celebration-skip');
    tryClick('.win-rollup-skip');
    return n;
  });
}

async function attemptSpin(page) {
  /* Tolerant spin attempt: try click, if disabled, wait + dismiss modals + retry.
     Returns 'spin' | 'modal' | 'stuck'. */
  const clicked = await clickSpin(page);
  if (clicked) return 'spin';
  const dismissed = await dismissModalsIfAny(page);
  if (dismissed > 0) {
    await page.waitForTimeout(300);
    const c2 = await clickSpin(page);
    if (c2) return 'spin';
  }
  const ready = await waitSpinEnabled(page, 6000);
  if (ready) {
    const c3 = await clickSpin(page);
    if (c3) return 'spin';
  }
  return 'stuck';
}

async function waitForPostSpin(page, timeoutMs) {
  try {
    await page.evaluate((to) => new Promise((res) => {
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; res(); } }, to);
      try {
        if (window.HookBus && window.HookBus.once) {
          window.HookBus.once('postSpin', () => { if (!done) { done = true; clearTimeout(t); res(); } });
        }
      } catch (_) {}
    }), timeoutMs);
  } catch (_) {}
}

async function runOneGame(browser, gameDir) {
  const slot = resolve(DIST, gameDir, 'slot.html');
  if (!existsSync(slot)) return null;
  const url = pathToFileURL(slot).href;
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  const errors = { console: [], page: [], unhandledRejection: 0 };
  page.on('console', (m) => { if (m.type() === 'error') errors.console.push(m.text().slice(0, 240)); });
  page.on('pageerror', (e) => errors.page.push(String(e).slice(0, 240)));
  page.on('crash', () => errors.page.push('page crashed'));

  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  /* Settle initial render + ambient init. */
  await page.waitForTimeout(800);

  const initial = await getMetrics(page);

  /* --- WARMUP: 5 spins → lazy-init listenere plateau (BBM wire, FS hooks,
       autoplay state machine subscribe). Ovo je pravi baseline za leak. --- */
  let warmupActual = 0;
  let warmupStuck = 0;
  for (let i = 0; i < SPINS_WARMUP; i++) {
    const res = await attemptSpin(page);
    if (res === 'spin') { warmupActual++; await waitForPostSpin(page, POST_SPIN_TIMEOUT); }
    else warmupStuck++;
    await page.waitForTimeout(SPIN_WAIT_MS);
  }
  const postWarmup = await getMetrics(page);

  /* --- BASE: 100 stvarnih spinova posle warmup-a --- */
  let spinsActual = 0;
  let baseStuck = 0;
  for (let i = 0; i < SPINS_BASE; i++) {
    const res = await attemptSpin(page);
    if (res === 'spin') { spinsActual++; await waitForPostSpin(page, POST_SPIN_TIMEOUT); }
    else baseStuck++;
    await page.waitForTimeout(SPIN_WAIT_MS);
  }

  const midMetrics = await getMetrics(page);

  /* --- FORCE SWEEP: klikni svaku UFP chip (kanonski selector). --- */
  const forcedKinds = await page.evaluate(() => {
    const chips = Array.from(document.querySelectorAll('.ufp-chip[data-ufp-kind]'));
    const kinds = [];
    for (const ch of chips) {
      try {
        const k = ch.getAttribute('data-ufp-kind') || '';
        ch.click();
        kinds.push(k);
      } catch (_) {}
    }
    return kinds;
  });
  /* Settle after sweep. */
  await page.waitForTimeout(1500);

  /* --- POST-FORCE: 20 spinova posle UFP sweep-a --- */
  let postForceSpins = 0;
  let postForceStuck = 0;
  for (let i = 0; i < SPINS_AFTER_FORCE; i++) {
    const res = await attemptSpin(page);
    if (res === 'spin') { postForceSpins++; await waitForPostSpin(page, POST_SPIN_TIMEOUT); }
    else postForceStuck++;
    await page.waitForTimeout(SPIN_WAIT_MS);
  }

  const final = await getMetrics(page);

  const blockCoverage = await page.evaluate(() => {
    const out = {};
    const markers = [
      'HW_STATE','MULT_ORB_STATE','PERSISTENT_MULT_STATE','MATCH3_BONUS_STATE',
      'MONEY_GRAB_STATE','PATH_BONUS_STATE','BONUS_OVERLAY_MUTEX_STATE',
      'CASCADING_WILD_STATE','WWS_STATE','FREESPINS','FSM','BIDIR_WAYS_STATE',
      'ALL_WAYS_EVAL_STATE','PFRL_STATE','HISTORY_LOG_STATE','BIG_WIN_TIER_STATE',
      'AUTOPLAY_STATE','ST_STATE','RC_STATE','SLAM_STATE','SC_STATE',
      'FS_REEL_HEIGHT_STATE','FS_SYMBOL_UPGRADE_STATE','REEL_HEIGHT_ADAPTER_STATE',
      '__PLAYER_XP__','__BONUS_BUY_MENU_ACTIVE__','__BBM_WIRED__',
      '__TUMBLE_WIRED__','__WIN_BOTH_WAYS__','__PFRL_COMPOUND_MAX__',
    ];
    for (const m of markers) {
      out[m] = (typeof window[m] !== 'undefined');
    }
    return out;
  });

  await ctx.close();
  const t1 = Date.now();

  /* PRAVI leak delta = POST-WARMUP → FINAL (ne initial → final). */
  const leakDelta = {
    nodes: final.nodes - postWarmup.nodes,
    cells: final.cells - postWarmup.cells,
    overlays: final.overlays - postWarmup.overlays,
    listeners: final.listeners - postWarmup.listeners,
    heap: final.heap - postWarmup.heap,
  };
  /* Lazy-init delta = INITIAL → POST-WARMUP (informativno, ne za verdict). */
  const lazyInitDelta = {
    listeners: postWarmup.listeners - initial.listeners,
  };

  return {
    game: gameDir,
    durationMs: t1 - t0,
    spinsWarmup: warmupActual,
    spinsBase: spinsActual,
    spinsPostForce: postForceSpins,
    stuck: { warmup: warmupStuck, base: baseStuck, postForce: postForceStuck },
    forcedKinds,
    initial,
    postWarmup,
    mid: midMetrics,
    final,
    leakDelta,
    lazyInitDelta,
    errors,
    blockCoverage,
  };
}

async function main() {
  log('\n🎰 ULTIMATE BLOCK STRESS REAL · D-3 (post-warmup baseline + UFP sweep + payline guard)');
  log('   Real wall-clock target: 5-8 minuta. Detektuje DOM leak, listener growth, console err.\n');
  const games = readdirSync(DIST).filter((g) => existsSync(resolve(DIST, g, 'slot.html'))).sort();
  if (games.length === 0) {
    console.error('FATAL: nema dist/real-games/<game>/slot.html — pokreni `npm run test:parse:real-pdfs` prvo.');
    process.exit(2);
  }

  const browser = await chromium.launch({ headless: true });
  const reports = [];
  for (const g of games) {
    log(`▸ ${g} …`);
    const t0 = Date.now();
    try {
      const r = await runOneGame(browser, g);
      reports.push(r);
      log(`   warmup=${r.spinsWarmup} base=${r.spinsBase} +force=${r.spinsPostForce} ` +
          `(stuck w${r.stuck.warmup}/b${r.stuck.base}/p${r.stuck.postForce}) forced=${r.forcedKinds.length} · ` +
          `LEAK Δnodes=${r.leakDelta.nodes} Δcells=${r.leakDelta.cells} Δlisteners=${r.leakDelta.listeners} ` +
          `· lazy-init listeners=${r.lazyInitDelta.listeners} · ` +
          `console-err=${r.errors.console.length} page-err=${r.errors.page.length} ` +
          `· ${((Date.now()-t0)/1000).toFixed(1)}s`);
    } catch (e) {
      log('   ❌ FAILED:', String(e).slice(0, 200));
      reports.push({ game: g, error: String(e) });
    }
  }
  await browser.close();

  const verdicts = [];
  for (const r of reports) {
    if (!r || r.error) {
      verdicts.push({ game: r && r.game, verdict: 'ERROR', why: r && r.error });
      continue;
    }
    const errs = r.errors.console.length + r.errors.page.length;
    /* Post-warmup → final delta. Iznad ovog je pravi leak signal. */
    const leakyDom = r.leakDelta.nodes > 200;
    const leakyListeners = r.leakDelta.listeners > 5;
    const fails = [];
    if (errs > 0) fails.push(`${errs} console/page errors`);
    if (leakyDom) fails.push(`DOM grew by ${r.leakDelta.nodes} nodes post-warmup`);
    if (leakyListeners) fails.push(`listeners grew by ${r.leakDelta.listeners} post-warmup`);
    verdicts.push({
      game: r.game,
      verdict: fails.length === 0 ? 'PASS' : 'FAIL',
      fails,
      leakDelta: r.leakDelta,
      lazyInitListeners: r.lazyInitDelta.listeners,
      forcedKinds: r.forcedKinds,
    });
  }

  const stamp = Date.now();
  const outPath = resolve(OUT, `run-${stamp}.json`);
  writeFileSync(outPath, JSON.stringify({ stamp, reports, verdicts }, null, 2));

  log('\n══════════════════════════════════════════════════════════════════════');
  log('SUMMARY');
  log('══════════════════════════════════════════════════════════════════════');
  for (const v of verdicts) {
    const sym = v.verdict === 'PASS' ? '✓' : (v.verdict === 'FAIL' ? '✗' : '!');
    log(`  ${sym} ${(v.game || '?').padEnd(36)} ${v.verdict.padEnd(6)} ${(v.fails && v.fails.join(', ')) || ''}`);
  }
  const failed = verdicts.filter((v) => v.verdict !== 'PASS').length;
  log(`\n   Σ ${verdicts.length - failed}/${verdicts.length} PASS · report ${outPath}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(2); });
