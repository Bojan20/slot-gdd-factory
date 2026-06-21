#!/usr/bin/env node
/**
 * Live verification of Wave H13 — pathAwareMultiplier on the variable_reel
 * ways dist (the only dist with a ways evaluator).
 *
 * Scenario:
 *   1. Open dist/04_variable_reel_playable.html
 *   2. Verify waysEval runtime present (window.detectWaysWins defined)
 *   3. Verify H13 patched detectWaysWins (__origDetectWaysWins preserved,
 *      window.detectWaysWins replaced, PAW_STATE.patched === true)
 *   4. Mock the original detectWaysWins to return 2 controlled ways events
 *      with mock DOM cells, force Math.random to pick predictable tiers,
 *      call patched detectWaysWins(), then trigger postSpin via HookBus
 *      and assert __WIN_AWARD__ bonus + emit events + chip DOM render.
 *   5. Force FS boundary reset and verify state cleared.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5199;
const URL = `http://127.0.0.1:${PORT}/dist/04_variable_reel_playable.html`;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
  cwd: '/Users/vanvinklstudio/Projects/slot-gdd-factory',
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 800));

try {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('ERR ' + e.message.slice(0, 200)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) errs.push(m.text().slice(0, 200));
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // ── PRESENCE CHECK ──
  const presence = await page.evaluate(() => ({
    detectWaysWinsFn:        typeof window.detectWaysWins,
    origDetectWaysWins:      typeof window.__origDetectWaysWins,
    pawStateEnabled:         !!(window.PAW_STATE && window.PAW_STATE.enabled),
    pawStatePatched:         !!(window.PAW_STATE && window.PAW_STATE.patched),
    multiplierMapLen:        window.PAW_STATE && Array.isArray(window.PAW_STATE.multiplierMap)
                              ? window.PAW_STATE.multiplierMap.length : null,
    aggregation:             window.PAW_STATE ? window.PAW_STATE.aggregation : null,
    pawDrawFn:               typeof window.pawDraw,
    pawResetFn:              typeof window.pawReset,
    hudPresent:              !!document.getElementById('pawHud'),
    hudTotalPresent:         !!document.getElementById('pawHudTotal'),
    waysCountBaked:          typeof window.WAYS_COUNT === 'number' ? window.WAYS_COUNT : null,
  }));
  console.log('Presence check:', presence);

  if (presence.detectWaysWinsFn !== 'function' || !presence.pawStatePatched) {
    console.error('❌ H13 patch not active — abort');
    await browser.close();
    server.kill();
    process.exit(2);
  }

  // ── SCENARIO 1 — 2 events, draws tier ×2 + ×10, postSpin pushes award ──
  console.log('\n— SCENARIO 1: 2 ways events, draw ×2 + ×10, postSpin aggregate —');
  const r1 = await page.evaluate(async () => {
    const trace = { assigned: [], aggregate: null };
    window.HookBus.on('onPathMultiplierAssigned',  p => trace.assigned.push(p));
    window.HookBus.on('onPathMultiplierAggregate', p => trace.aggregate = p);

    /* Build 2 mock DOM cells we control. */
    const host = document.getElementById('gridHost');
    const realCells = host ? host.querySelectorAll('.cell') : [];
    const c0 = realCells[0] || document.createElement('div');
    const c1 = realCells[1] || document.createElement('div');
    const c2 = realCells[2] || document.createElement('div');

    /* Wipe stale chips from prior spins. */
    window.pawReset();

    /* Stub the ORIGINAL detectWaysWins (preserved by patch) so it returns
     * our controlled events. The patched wrapper still runs. */
    window.__origDetectWaysWins = function () {
      return [
        { symbol: 'HP1', ways: 12, runLength: 4, cells: [c0, c1] },
        { symbol: 'MP2', ways: 4,  runLength: 3, cells: [c2] },
      ];
    };

    /* Force RNG: weights = [40,24,16,10,6,3,1] cumsum [40,64,80,90,96,99,100].
     * r=0.05 → 5 < 40 → idx 0 (×2). r=0.85 → 85 ∈ (80,90) → idx 3 (×10). */
    const origRandom = Math.random;
    const seq = [0.05, 0.85];
    let i = 0;
    Math.random = () => seq[i++ % seq.length];
    window.__SLOT_BET__ = 1;

    const events = window.detectWaysWins();
    Math.random = origRandom;

    /* Fire postSpin so the aggregate listener computes the bonus. */
    window.__WIN_AWARD__ = 0;
    window.HookBus.emit('postSpin', { source: 'h13-probe' });
    await new Promise(r => setTimeout(r, 30));

    return {
      trace,
      eventCount: events.length,
      ev0: events[0] ? {
        symbol: events[0].symbol,
        ways: events[0].ways,
        pathMultiplier: events[0].pathMultiplier,
        label: events[0].pathMultiplierLabel,
      } : null,
      ev1: events[1] ? {
        symbol: events[1].symbol,
        ways: events[1].ways,
        pathMultiplier: events[1].pathMultiplier,
        label: events[1].pathMultiplierLabel,
      } : null,
      totalMult: window.PAW_STATE.totalMult,
      awardBonus: window.PAW_STATE.awardBonus,
      winAward: window.__WIN_AWARD__,
      hudShown: document.getElementById('pawHud').getAttribute('data-show') === 'true',
      hudTotalText: document.getElementById('pawHudTotal').textContent,
      chipCount: document.querySelectorAll('.paw-path-chip').length,
      chip0Text: (document.querySelectorAll('.paw-path-chip')[0] || {}).textContent,
    };
  });
  console.log(`  events: ${r1.eventCount}, ev0=${JSON.stringify(r1.ev0)}, ev1=${JSON.stringify(r1.ev1)}`);
  console.log(`  totalMult=${r1.totalMult}, awardBonus=${r1.awardBonus}, __WIN_AWARD__=${r1.winAward}`);
  console.log(`  HUD shown=${r1.hudShown}, total="${r1.hudTotalText}", chips=${r1.chipCount}, chip0="${r1.chip0Text}"`);
  console.log(`  assigned events: ${r1.trace.assigned.length}, aggregate event: ${JSON.stringify(r1.trace.aggregate)}`);

  // ── SCENARIO 2 — preSpin wipes state + chips ──
  console.log('\n— SCENARIO 2: preSpin wipes state —');
  const r2 = await page.evaluate(async () => {
    window.HookBus.emit('preSpin', { source: 'h13-probe' });
    await new Promise(r => setTimeout(r, 30));
    return {
      lastEventsLen: window.PAW_STATE.lastEvents.length,
      totalMult: window.PAW_STATE.totalMult,
      awardBonus: window.PAW_STATE.awardBonus,
      chipCount: document.querySelectorAll('.paw-path-chip').length,
      hudShown: document.getElementById('pawHud').getAttribute('data-show') === 'true',
      hudTotalText: document.getElementById('pawHudTotal').textContent,
    };
  });
  console.log(`  lastEventsLen=${r2.lastEventsLen}, totalMult=${r2.totalMult}, awardBonus=${r2.awardBonus}`);
  console.log(`  chips=${r2.chipCount}, HUD shown=${r2.hudShown}, total="${r2.hudTotalText}"`);

  // ── SCENARIO 3 — FS boundary reset ──
  console.log('\n— SCENARIO 3: onFsTrigger/onFsEnd resets state —');
  const r3 = await page.evaluate(async () => {
    window.PAW_STATE.totalMult = 99;
    window.PAW_STATE.lastEvents = [{ ways: 1, pathMultiplier: 99 }];
    window.PAW_STATE.awardBonus = 42;
    window.HookBus.emit('onFsTrigger', {});
    await new Promise(r => setTimeout(r, 30));
    const afterTrig = {
      totalMult: window.PAW_STATE.totalMult,
      eventsLen: window.PAW_STATE.lastEvents.length,
      awardBonus: window.PAW_STATE.awardBonus,
    };
    window.PAW_STATE.totalMult = 88;
    window.PAW_STATE.lastEvents = [{ ways: 2, pathMultiplier: 88 }];
    window.HookBus.emit('onFsEnd', {});
    await new Promise(r => setTimeout(r, 30));
    const afterEnd = {
      totalMult: window.PAW_STATE.totalMult,
      eventsLen: window.PAW_STATE.lastEvents.length,
    };
    return { afterTrig, afterEnd };
  });
  console.log(`  onFsTrigger → ${JSON.stringify(r3.afterTrig)}`);
  console.log(`  onFsEnd     → ${JSON.stringify(r3.afterEnd)}`);

  // ── ACCEPTANCE ──
  console.log('\n— ACCEPTANCE —');
  const checks = [
    /* Presence */
    ['detectWaysWins function present (waysEval active)',  presence.detectWaysWinsFn === 'function'],
    ['__origDetectWaysWins preserved (extension patched)', presence.origDetectWaysWins === 'function'],
    ['PAW_STATE.enabled === true',                          presence.pawStateEnabled === true],
    ['PAW_STATE.patched === true',                          presence.pawStatePatched === true],
    ['multiplierMap length === 7 tiers',                    presence.multiplierMapLen === 7],
    ['aggregation === additive (vendor-default)',           presence.aggregation === 'additive'],
    ['pawDraw helper exposed',                              presence.pawDrawFn === 'function'],
    ['pawReset helper exposed',                             presence.pawResetFn === 'function'],
    ['#pawHud div mounted',                                 presence.hudPresent === true],
    ['#pawHudTotal span mounted',                           presence.hudTotalPresent === true],
    ['WAYS_COUNT baked from variable_reel topology',        presence.waysCountBaked === 117649],
    /* Scenario 1 — decoration + aggregate */
    ['S1: 2 events returned by patched detectWaysWins',     r1.eventCount === 2],
    ['S1: ev0.pathMultiplier = 2',                          r1.ev0?.pathMultiplier === 2],
    ['S1: ev0.label = ×2',                                  r1.ev0?.label === '×2'],
    ['S1: ev1.pathMultiplier = 10',                         r1.ev1?.pathMultiplier === 10],
    ['S1: ev1.label = ×10',                                 r1.ev1?.label === '×10'],
    ['S1: 2 × onPathMultiplierAssigned fired',              r1.trace.assigned.length === 2],
    ['S1: assigned[0] symbol = HP1 + ways = 12',
      r1.trace.assigned[0]?.symbol === 'HP1' && r1.trace.assigned[0]?.ways === 12],
    ['S1: PAW_STATE.totalMult = 12 (additive 2+10)',        r1.totalMult === 12],
    ['S1: awardBonus = (12×2 + 4×10) / 117649 = ~0.000544',
      Math.abs(r1.awardBonus - 0.0005438) < 0.001],
    ['S1: __WIN_AWARD__ pushed additively',                 r1.winAward > 0 && Math.abs(r1.winAward - r1.awardBonus) < 0.001],
    ['S1: onPathMultiplierAggregate fired',                 !!r1.trace.aggregate],
    ['S1: aggregate.totalMult = 12',                        r1.trace.aggregate?.totalMult === 12],
    ['S1: HUD visible (data-show=true)',                    r1.hudShown === true],
    ['S1: HUD total text = ×12',                            r1.hudTotalText === '×12'],
    ['S1: 3 chips rendered (2 cells ev0 + 1 cell ev1)',     r1.chipCount === 3],
    ['S1: chip[0] text = ×2',                               r1.chip0Text === '×2'],
    /* Scenario 2 — preSpin wipes */
    ['S2: lastEvents cleared',                              r2.lastEventsLen === 0],
    ['S2: totalMult reset to 0',                            r2.totalMult === 0],
    ['S2: awardBonus reset to 0',                           r2.awardBonus === 0],
    ['S2: all chips removed from DOM',                      r2.chipCount === 0],
    ['S2: HUD hidden (no data-show)',                       r2.hudShown === false],
    ['S2: HUD total reset to ×0',                           r2.hudTotalText === '×0'],
    /* Scenario 3 — FS boundary reset */
    ['S3: onFsTrigger resets totalMult',                    r3.afterTrig.totalMult === 0],
    ['S3: onFsTrigger clears lastEvents',                   r3.afterTrig.eventsLen === 0],
    ['S3: onFsTrigger clears awardBonus',                   r3.afterTrig.awardBonus === 0],
    ['S3: onFsEnd resets totalMult',                        r3.afterEnd.totalMult === 0],
    ['S3: onFsEnd clears lastEvents',                       r3.afterEnd.eventsLen === 0],
    /* No errors */
    ['0 page errors',                                       errs.length === 0],
  ];
  let pass = 0, fail = 0;
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
    if (ok) pass++; else fail++;
  }
  console.log(`\nResult: ${pass}/${pass+fail} pass, errors: ${errs.length}`);
  if (errs.length) errs.slice(0, 5).forEach(e => console.log('  console:', e));

  await browser.close();
  server.kill();
  process.exit(fail === 0 ? 0 : 1);
} catch (e) {
  console.error('PROBE ERROR:', e.message);
  server.kill();
  process.exit(2); /* UQ-FORTIFY6 #3: probe internal error → exit 2 (HARD-FAIL category, CI must not treat as soft-warn) */
}
