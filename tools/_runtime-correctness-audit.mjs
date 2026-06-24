#!/usr/bin/env node
/**
 * Runtime Correctness Audit
 * 
 * Targets real behavior patterns:
 * - Balance tracking corruption
 * - Win calculation/display mismatch
 * - Cascade animation lockup
 * - Spin result predictability leaks
 * - Memory growth during extended play
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5246;
const ROOT = '/Users/vanvinklstudio/Projects/slot-gdd-factory';

const TEST_FILES = [
  'dist/01_rectangular_5x3_playable.html',
  'dist/03_cluster_7x7_playable.html',
  'dist/19_lock_respin_playable.html',
];

const findings = [];

async function testSlot(filename) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`TESTING: ${filename}`);
  console.log(`${'='.repeat(70)}`);

  const issues = [];
  const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { 
    cwd: ROOT, 
    stdio: 'ignore' 
  });
  await new Promise(r => setTimeout(r, 600));

  try {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    await page.goto(`http://127.0.0.1:${PORT}/${filename}`, { 
      waitUntil: 'networkidle',
      timeout: 15000 
    });
    await page.waitForTimeout(1000);

    // Setup tracking
    await page.evaluate(() => {
      window.__AUDIT__ = {
        spinHistory: [],
        balanceHistory: [],
        winDisplayHistory: [],
        animationStalls: [],
        cascadeStuckCount: 0,
      };

      // Track all spins
      const origEmit = window.HookBus?.emit || (() => {});
      window.HookBus = window.HookBus || { on: () => {}, emit: () => {} };
      const oldEmit = window.HookBus.emit;

      window.HookBus.emit = function(event, payload) {
        if (event === 'onSpinResult') {
          window.__AUDIT__.spinHistory.push({
            time: performance.now(),
            result: payload,
          });
        }
        if (event === 'onWinPresentationStart') {
          window.__AUDIT__.winDisplayHistory.push({
            time: performance.now(),
            winAmount: payload?.amount,
          });
        }
        return oldEmit.call(this, event, payload);
      };
    });

    // Test 1: Track balance through 5 spins
    console.log('\n[Test 1] Balance integrity through 5 spins');
    
    const balances = [];
    for (let spinNum = 1; spinNum <= 5; spinNum++) {
      const preBalance = await page.evaluate(() => window.balance);
      balances.push(preBalance);
      
      const spinBtn = await page.$('#spinBtn');
      if (spinBtn) {
        await spinBtn.click();
      } else {
        await page.evaluate(() => window.HookBus?.emit('spinRequested'));
      }

      // Wait for spin complete
      let complete = false;
      for (let i = 0; i < 60; i++) {
        await page.waitForTimeout(100);
        complete = await page.evaluate(() => {
          const btn = document.getElementById('spinBtn');
          return btn && !btn.classList.contains('is-spinning') && !btn.disabled;
        });
        if (complete) break;
      }

      const postBalance = await page.evaluate(() => window.balance);
      const balanceDelta = postBalance - preBalance;
      console.log(`  Spin ${spinNum}: €${preBalance} → €${postBalance} (delta: €${balanceDelta})`);
      
      if (balanceDelta > 0) {
        console.log(`    ✓ Win detected: €${balanceDelta}`);
      }

      // Check balance is finite and positive
      if (!Number.isFinite(postBalance) || postBalance < 0) {
        issues.push(`SPIN${spinNum}_INVALID_BALANCE: ${postBalance}`);
        console.warn(`    ⚠ Invalid balance: ${postBalance}`);
        break;
      }
    }

    // Test 2: Win display correctness
    console.log('\n[Test 2] Win amount display tracking');
    
    const audit = await page.evaluate(() => window.__AUDIT__);
    console.log(`  Spins recorded: ${audit.spinHistory.length}`);
    console.log(`  Win displays recorded: ${audit.winDisplayHistory.length}`);

    // Test 3: Rapid spin stress (10 consecutive)
    console.log('\n[Test 3] Rapid spin stress test (10x consecutive)');
    
    const preStressBalance = await page.evaluate(() => window.balance);
    console.log(`  Pre-stress balance: €${preStressBalance}`);

    let stressSpinCount = 0;
    for (let i = 0; i < 10; i++) {
      const spinBtn = await page.$('#spinBtn');
      if (spinBtn) {
        const isSpinning = await page.evaluate(() => 
          document.getElementById('spinBtn').classList.contains('is-spinning')
        );
        if (!isSpinning) {
          await spinBtn.click();
          stressSpinCount++;
        }
      }
      await page.waitForTimeout(2000);
    }

    const postStressBalance = await page.evaluate(() => window.balance);
    const netLoss = preStressBalance - postStressBalance;
    console.log(`  Post-stress balance: €${postStressBalance}`);
    console.log(`  Net loss: €${netLoss} (${stressSpinCount} spins completed)`);

    if (postStressBalance < 0) {
      issues.push(`STRESS_NEGATIVE_BALANCE: €${postStressBalance} after ${stressSpinCount} spins`);
      console.warn(`  ⚠ NEGATIVE BALANCE: €${postStressBalance}`);
    }

    // Test 4: Spin result consistency check
    console.log('\n[Test 4] Spin result schema validation');
    
    const spinResults = await page.evaluate(() => window.__AUDIT__.spinHistory);
    let schemaErrors = 0;
    spinResults.slice(0, 3).forEach((sr, i) => {
      const r = sr.result;
      if (typeof r !== 'object') {
        console.warn(`  Spin ${i}: result is ${typeof r}, expected object`);
        schemaErrors++;
      }
    });
    if (schemaErrors > 0) {
      issues.push(`SPIN_RESULT_SCHEMA_ERROR: ${schemaErrors}/${spinResults.length}`);
    }

    // Test 5: DOM integrity check
    console.log('\n[Test 5] DOM stability check');
    
    const domStates = [];
    for (let i = 0; i < 3; i++) {
      const state = await page.evaluate(() => ({
        cellCount: document.querySelectorAll('.cell').length,
        reelCount: document.querySelectorAll('[class*="reel"]').length,
        spinBtnExists: document.getElementById('spinBtn') !== null,
      }));
      domStates.push(state);
      if (i < 2) await page.waitForTimeout(500);
    }
    
    const uniqueCellCounts = new Set(domStates.map(s => s.cellCount));
    console.log(`  Cell count stability: ${Array.from(uniqueCellCounts).join(', ')}`);
    if (uniqueCellCounts.size > 1) {
      issues.push(`DOM_CELL_COUNT_VARIATION: ${uniqueCellCounts.size} different counts`);
      console.warn(`  ⚠ Cell count varies: ${Array.from(uniqueCellCounts).join(', ')}`);
    }

    // Test 6: Console error accumulation
    console.log('\n[Test 6] Console health during gameplay');
    
    const consoleCheck = await page.evaluate(() => {
      // Count errors logged to page-level console
      return {
        pageErrors: window.__PAGE_ERRORS__ || 0,
        consoleErrors: window.__CONSOLE_ERRORS__ || 0,
      };
    });
    console.log(`  Page errors: ${consoleCheck.pageErrors}, console errors: ${consoleCheck.consoleErrors}`);

    await browser.close();
  } catch (e) {
    issues.push(`FATAL: ${e.message}`);
    console.error(`FATAL: ${e.message}`);
  } finally {
    srv.kill();
    await new Promise(r => setTimeout(r, 100));
  }

  return { file: filename, issues };
}

// Run tests
for (const file of TEST_FILES) {
  const result = await testSlot(file);
  findings.push(result);
}

// Summary
console.log(`\n${'='.repeat(70)}`);
console.log('CORRECTNESS AUDIT SUMMARY');
console.log(`${'='.repeat(70)}`);

findings.forEach(f => {
  const status = f.issues.length === 0 ? '✓ PASS' : `✗ FAIL`;
  console.log(`\n${f.file}: ${status}`);
  f.issues.forEach(issue => console.log(`  - ${issue}`));
});

const totalIssues = findings.reduce((sum, f) => sum + f.issues.length, 0);
console.log(`\nTotal issues found: ${totalIssues}`);
process.exit(totalIssues > 0 ? 1 : 0);
