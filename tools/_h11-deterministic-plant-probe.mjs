#!/usr/bin/env node
/**
 * Live verification of Wave H11 — bonusBuyDeterministic on GoO dist.
 *
 * Scenario:
 *   1. Open dist/gates-of-olympus-1000.html (has bonusBuy + H11)
 *   2. Verify block runtime is wired (BBD_STATE, picker DOM present)
 *   3. Click Buy → assert modal opens
 *   4. Select PREMIUM tier programmatically → assert __BB_PLANT__ populated
 *   5. Fire onSpinResult → assert plant applied to grid cells, onDeterministicPlantApplied emitted
 *   6. Fire postSpin → assert __BB_PLANT__ cleared (one-shot)
 *   7. SUPER tier path (with extraMult)
 *   8. Cancel path
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5199;
const URL = `http://127.0.0.1:${PORT}/dist/gates-of-olympus-1000.html`;
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
    buyBtn:       !!document.getElementById('bonusBuyBtn'),
    overlay:      !!document.getElementById('bbdOverlay'),
    cancelBtn:    !!document.getElementById('bbdCancel'),
    tierCount:    document.querySelectorAll('#bbdOverlay .bbd-tier-card').length,
    bbdState:     !!window.BBD_STATE,
    bbdEnabled:   window.BBD_STATE && window.BBD_STATE.enabled === true,
    bbdPatched:   window.BBD_STATE && window.BBD_STATE.patched === true,
    plantsCount:  window.BBD_STATE && Array.isArray(window.BBD_STATE.plants) ? window.BBD_STATE.plants.length : null,
    initialPlant: window.__BB_PLANT__,
    openFn:       typeof window.bbdOpenPicker,
    selectFn:     typeof window.bbdSelectTier,
    cancelFn:     typeof window.bbdCancelPicker,
  }));
  console.log('Presence check:', presence);

  if (!presence.buyBtn || !presence.bbdPatched) {
    console.error('❌ H11 not wired — abort');
    await browser.close();
    server.kill();
    process.exit(2);
  }

  // ── SCENARIO 1 — Buy click opens modal (NO buy fires) ──
  console.log('\n— SCENARIO 1: click Buy → modal opens, no spin fires —');
  const r1 = await page.evaluate(async () => {
    /* Track if FORCE_TRIGGER got set (which would mean the original
     * buy handler fired — should NOT happen on first Buy click). */
    const before = typeof window.FORCE_TRIGGER !== 'undefined' ? window.FORCE_TRIGGER : null;
    document.getElementById('bonusBuyBtn').click();
    await new Promise(r => setTimeout(r, 100));
    const after = typeof window.FORCE_TRIGGER !== 'undefined' ? window.FORCE_TRIGGER : null;
    return {
      modalOpen: window.BBD_STATE.modalOpen,
      overlayDataShow: document.getElementById('bbdOverlay').getAttribute('data-show'),
      forceTriggerBefore: before,
      forceTriggerAfter: after,
      forceTriggerChanged: before !== after,
    };
  });
  console.log(`  modalOpen: ${r1.modalOpen}, overlay data-show: ${r1.overlayDataShow}`);
  console.log(`  FORCE_TRIGGER changed by buy click: ${r1.forceTriggerChanged}`);

  // ── SCENARIO 2 — Cancel closes modal cleanly ──
  console.log('\n— SCENARIO 2: cancel button closes modal —');
  const r2 = await page.evaluate(async () => {
    document.getElementById('bbdCancel').click();
    await new Promise(r => setTimeout(r, 100));
    return {
      modalOpen: window.BBD_STATE.modalOpen,
      lastSelection: window.BBD_STATE.lastSelection,
      bbPlant: window.__BB_PLANT__,
    };
  });
  console.log(`  modalOpen: ${r2.modalOpen}, lastSelection: ${r2.lastSelection}, __BB_PLANT__: ${r2.bbPlant}`);

  // ── SCENARIO 3 — Open → select PREMIUM → assert plant ──
  console.log('\n— SCENARIO 3: open → select PREMIUM → emit onSpinResult —');
  const r3 = await page.evaluate(async () => {
    const trace = { selected: null, planted: null };
    window.HookBus.on('onBonusBuyTierSelected',     p => trace.selected = p);
    window.HookBus.on('onDeterministicPlantApplied', p => trace.planted = p);

    document.getElementById('bonusBuyBtn').click();
    await new Promise(r => setTimeout(r, 80));
    /* Bypass the synthetic re-click so we don't trigger a real spin. */
    const origBypass = window.BBD_STATE.bypassWrap;
    window.BBD_STATE.bypassWrap = true;
    window.bbdSelectTier('PREMIUM');
    window.BBD_STATE.bypassWrap = origBypass;
    await new Promise(r => setTimeout(r, 80));

    const beforeFire = {
      tier: window.__BB_PLANT__ && window.__BB_PLANT__.tier,
      positionsLen: window.__BB_PLANT__ && window.__BB_PLANT__.positions.length,
      symbol: window.__BB_PLANT__ && window.__BB_PLANT__.symbol,
    };
    /* Simulate engine onSpinResult */
    window.HookBus.emit('onSpinResult');
    await new Promise(r => setTimeout(r, 50));
    const plantedSymbol = window.__BB_PLANT__ ? window.__BB_PLANT__.symbol : null;
    const cellsWithPlant = plantedSymbol
      ? Array.from(document.querySelectorAll('.cell')).filter(c => c.textContent === plantedSymbol).length
      : 0;
    /* postSpin should clear */
    window.HookBus.emit('postSpin');
    await new Promise(r => setTimeout(r, 50));
    return {
      trace, beforeFire, cellsWithPlant,
      bbAfterPost: window.__BB_PLANT__,
    };
  });
  console.log(`  Selected: ${JSON.stringify(r3.trace.selected)}`);
  console.log(`  Planted event: ${JSON.stringify(r3.trace.planted)}`);
  console.log(`  Before onSpinResult: ${JSON.stringify(r3.beforeFire)}`);
  console.log(`  Cells now carrying planted symbol: ${r3.cellsWithPlant}`);
  console.log(`  __BB_PLANT__ after postSpin: ${r3.bbAfterPost}`);

  // ── SCENARIO 4 — SUPER tier with extraMult ──
  console.log('\n— SCENARIO 4: SUPER tier with extraMult applied via HookBus.setMult —');
  const r4 = await page.evaluate(async () => {
    /* Reset mult to 1 first */
    if (window.HookBus && typeof window.HookBus.setMult === 'function') window.HookBus.setMult(1);
    const initialMult = window.HookBus.getMult();
    window.bbdOpenPicker();
    await new Promise(r => setTimeout(r, 50));
    const origBypass = window.BBD_STATE.bypassWrap;
    window.BBD_STATE.bypassWrap = true;
    window.bbdSelectTier('SUPER');
    window.BBD_STATE.bypassWrap = origBypass;
    await new Promise(r => setTimeout(r, 50));
    window.HookBus.emit('onSpinResult');
    await new Promise(r => setTimeout(r, 50));
    const finalMult = window.HookBus.getMult();
    window.HookBus.emit('postSpin');
    return { initialMult, finalMult, plantTier: 'SUPER (drawn)' };
  });
  console.log(`  Initial mult: ${r4.initialMult}, after SUPER plant: ${r4.finalMult}`);

  // ── ACCEPTANCE ──
  console.log('\n— ACCEPTANCE —');
  const checks = [
    ['#bonusBuyBtn present',                                presence.buyBtn],
    ['#bbdOverlay present',                                  presence.overlay],
    ['#bbdCancel present',                                   presence.cancelBtn],
    ['3 tier cards rendered in overlay',                     presence.tierCount === 3],
    ['BBD_STATE.enabled === true',                           presence.bbdEnabled],
    ['BBD_STATE.patched === true',                           presence.bbdPatched],
    ['plants count === 3',                                   presence.plantsCount === 3],
    ['__BB_PLANT__ starts null',                             presence.initialPlant === null],
    ['bbdOpenPicker / SelectTier / CancelPicker exposed',    presence.openFn === 'function' && presence.selectFn === 'function' && presence.cancelFn === 'function'],
    /* S1 */
    ['S1: Buy click opens modal',                            r1.modalOpen === true && r1.overlayDataShow === 'true'],
    ['S1: Buy click does NOT trigger FORCE_TRIGGER (wrapped at capture)', !r1.forceTriggerChanged],
    /* S2 */
    ['S2: Cancel closes modal',                              r2.modalOpen === false],
    ['S2: Cancel clears lastSelection',                      r2.lastSelection === null],
    ['S2: __BB_PLANT__ stays null after cancel',             r2.bbPlant === null],
    /* S3 */
    ['S3: onBonusBuyTierSelected fired (tier=PREMIUM, costX=150)', r3.trace.selected && r3.trace.selected.tier === 'PREMIUM' && r3.trace.selected.costX === 150],
    ['S3: __BB_PLANT__ populated with PREMIUM, 5 positions, symbol=S', r3.beforeFire.tier === 'PREMIUM' && r3.beforeFire.positionsLen === 5 && r3.beforeFire.symbol === 'S'],
    ['S3: onDeterministicPlantApplied fired with tier=PREMIUM',  r3.trace.planted && r3.trace.planted.tier === 'PREMIUM'],
    ['S3: planted count === 5 (5×3 grid fits all PREMIUM positions)', r3.trace.planted && r3.trace.planted.count === 5],
    ['S3: cells carrying planted symbol ≥ 5',                r3.cellsWithPlant >= 5],
    ['S3: __BB_PLANT__ cleared after postSpin (one-shot)',   r3.bbAfterPost === null],
    /* S4 */
    ['S4: SUPER tier extraMult=2 applied via HookBus.setMult', r4.finalMult === 2],
    /* No errors */
    ['0 page errors',                                        errs.length === 0],
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
  process.exit(3);
}
