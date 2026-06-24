#!/usr/bin/env node
/**
 * Final Runtime Audit — Uses correct balance API and comprehensive testing
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5247;
const ROOT = '/Users/vanvinklstudio/Projects/slot-gdd-factory';

const TEST_FILES = [
  'dist/01_rectangular_5x3_playable.html',
  'dist/03_cluster_7x7_playable.html', 
  'dist/19_lock_respin_playable.html',
];

const findings = [];

async function auditSlot(filename) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`RUNTIME AUDIT: ${filename}`);
  console.log(`${'='.repeat(70)}`);

  const bugs = [];
  const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { 
    cwd: ROOT, 
    stdio: 'ignore' 
  });
  await new Promise(r => setTimeout(r, 600));

  try {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    const consoleMessages = [];
    const pageErrors = [];

    page.on('console', m => {
      if (m.type() === 'error') consoleMessages.push(m.text());
      if (m.type() === 'warning') consoleMessages.push(`[WARN] ${m.text()}`);
    });

    page.on('pageerror', e => pageErrors.push(e.message));

    // Boot
    console.log('\n[BOOT] Loading page...');
    try {
      await page.goto(`http://127.0.0.1:${PORT}/${filename}`, { 
        waitUntil: 'networkidle',
        timeout: 15000 
      });
      console.log('  ✓ Page loaded');
    } catch (e) {
      bugs.push(`BOOT_TIMEOUT: ${e.message}`);
      console.error(`  ✗ Boot failed: ${e.message}`);
      await browser.close();
      return { file: filename, bugs };
    }

    // Check critical APIs
    const bootCheck = await page.evaluate(() => ({
      hasHookBus: typeof window.HookBus !== 'undefined',
      hasBalanceApi: typeof window.balanceGet === 'function' && 
                     typeof window.balanceSet === 'function',
      hasSpinBtn: document.getElementById('spinBtn') !== null,
      initialBalance: (typeof window.balanceGet === 'function') ? window.balanceGet() : null,
    }));

    console.log(`  HookBus: ${bootCheck.hasHookBus}`);
    console.log(`  Balance API: ${bootCheck.hasBalanceApi}`);
    console.log(`  Spin Button: ${bootCheck.hasSpinBtn}`);
    console.log(`  Initial balance: €${bootCheck.initialBalance}`);

    if (!bootCheck.hasBalanceApi) {
      bugs.push('MISSING_BALANCE_API');
      console.warn('  ⚠ Balance API not exposed');
    }

    if (pageErrors.length > 0) {
      bugs.push(`BOOT_PAGE_ERRORS: ${pageErrors.length}`);
      console.warn(`  ⚠ Page errors: ${pageErrors.slice(0, 2).join('; ')}`);
    }

    await page.waitForTimeout(1000);

    // SPIN TEST
    console.log('\n[SPIN] Executing 3 consecutive spins...');

    for (let spinNum = 1; spinNum <= 3; spinNum++) {
      const preSpin = await page.evaluate(() => ({
        balance: typeof window.balanceGet === 'function' ? window.balanceGet() : null,
        spinBtnDisabled: document.getElementById('spinBtn')?.disabled || false,
        phase: typeof window.FSM !== 'undefined' ? window.FSM.phase : 'unknown',
      }));

      if (preSpin.balance === null) {
        bugs.push(`SPIN${spinNum}_BALANCE_API_FAIL`);
        break;
      }

      // Click spin
      const spinBtn = await page.$('#spinBtn');
      if (!spinBtn) {
        bugs.push(`SPIN${spinNum}_NO_SPIN_BTN`);
        break;
      }

      await spinBtn.click();
      const spinStart = Date.now();

      // Wait for completion
      let completed = false;
      for (let i = 0; i < 60; i++) {
        await page.waitForTimeout(100);
        completed = await page.evaluate(() => {
          const btn = document.getElementById('spinBtn');
          return btn && !btn.classList.contains('is-spinning') && !btn.disabled;
        });
        if (completed) break;
      }

      const spinTime = Date.now() - spinStart;

      if (!completed) {
        bugs.push(`SPIN${spinNum}_TIMEOUT: ${spinTime}ms`);
        console.warn(`  Spin ${spinNum}: ✗ Timeout (${spinTime}ms)`);
        break;
      }

      const postSpin = await page.evaluate(() => ({
        balance: typeof window.balanceGet === 'function' ? window.balanceGet() : null,
        phase: typeof window.FSM !== 'undefined' ? window.FSM.phase : 'unknown',
      }));

      const delta = postSpin.balance - preSpin.balance;
      console.log(`  Spin ${spinNum}: €${preSpin.balance} → €${postSpin.balance} (Δ€${delta}, ${spinTime}ms)`);

      // Validate balance
      if (!Number.isFinite(postSpin.balance)) {
        bugs.push(`SPIN${spinNum}_INVALID_BALANCE: ${postSpin.balance}`);
        console.warn(`  ✗ Invalid balance after spin: ${postSpin.balance}`);
        break;
      }

      if (postSpin.balance < 0) {
        bugs.push(`SPIN${spinNum}_NEGATIVE_BALANCE: €${postSpin.balance}`);
        console.warn(`  ✗ Negative balance: €${postSpin.balance}`);
      }

      // Check phase consistency
      if (postSpin.phase === 'ERROR' || postSpin.phase === 'STUCK') {
        bugs.push(`SPIN${spinNum}_FSM_${postSpin.phase}`);
        console.warn(`  ✗ FSM phase: ${postSpin.phase}`);
      }
    }

    // RAPID SPIN TEST
    console.log('\n[RAPID] Spam-clicking spin 10x without waiting...');

    const preRapid = await page.evaluate(() => 
      typeof window.balanceGet === 'function' ? window.balanceGet() : null
    );

    for (let i = 0; i < 10; i++) {
      const btn = await page.$('#spinBtn');
      if (btn) {
        try {
          await btn.click({ timeout: 50 });
        } catch (e) {}
      }
    }

    // Wait 4s for reels to settle
    await page.waitForTimeout(4000);

    const postRapid = await page.evaluate(() => 
      typeof window.balanceGet === 'function' ? window.balanceGet() : null
    );

    if (postRapid < 0) {
      bugs.push(`RAPID_NEGATIVE_BALANCE: €${postRapid}`);
      console.warn(`  ⚠ Negative balance after rapid clicks: €${postRapid}`);
    }
    console.log(`  Balance: €${preRapid} → €${postRapid}`);

    // RELOAD TEST
    console.log('\n[RELOAD] Page reload integrity...');

    const preReloadBalance = await page.evaluate(() => 
      typeof window.balanceGet === 'function' ? window.balanceGet() : null
    );

    await page.reload({ waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1000);

    const postReloadBalance = await page.evaluate(() => 
      typeof window.balanceGet === 'function' ? window.balanceGet() : null
    );

    if (preReloadBalance !== postReloadBalance) {
      bugs.push(`RELOAD_BALANCE_LOST: €${preReloadBalance} → €${postReloadBalance}`);
      console.warn(`  ⚠ Balance changed: €${preReloadBalance} → €${postReloadBalance}`);
    }
    console.log(`  Balance persisted: €${postReloadBalance}`);

    // MEMORY TEST
    console.log('\n[MEMORY] DOM growth check...');

    const domSamples = [];
    for (let i = 0; i < 5; i++) {
      const count = await page.evaluate(() => document.querySelectorAll('*').length);
      domSamples.push(count);
      await page.waitForTimeout(200);
    }

    const growth = domSamples[4] - domSamples[0];
    if (growth > 100) {
      bugs.push(`DOM_LEAK: +${growth} elements in 1s`);
      console.warn(`  ⚠ Large DOM growth: ${domSamples[0]} → ${domSamples[4]}`);
    }
    console.log(`  DOM element count: ${domSamples[0]} → ${domSamples[4]} (Δ+${growth})`);

    await browser.close();
  } catch (e) {
    bugs.push(`FATAL: ${e.message}`);
    console.error(`FATAL: ${e.message}`);
  } finally {
    srv.kill();
    await new Promise(r => setTimeout(r, 100));
  }

  return { file: filename, bugs };
}

// Run audits
for (const file of TEST_FILES) {
  const result = await auditSlot(file);
  findings.push(result);
}

// Summary Report
console.log(`\n${'='.repeat(70)}`);
console.log('RUNTIME AUDIT FINAL REPORT');
console.log(`${'='.repeat(70)}`);

let totalBugs = 0;
findings.forEach(f => {
  const bugCount = f.bugs.length;
  totalBugs += bugCount;
  const status = bugCount === 0 ? '✓ PASS' : `✗ FAIL (${bugCount} bugs)`;
  console.log(`\n${f.file}`);
  console.log(`  Status: ${status}`);
  if (f.bugs.length > 0) {
    f.bugs.forEach(bug => console.log(`    - ${bug}`));
  }
});

console.log(`\n${'='.repeat(70)}`);
console.log(`TOTAL BUGS: ${totalBugs}`);
console.log(`${'='.repeat(70)}`);

process.exit(totalBugs > 0 ? 1 : 0);
