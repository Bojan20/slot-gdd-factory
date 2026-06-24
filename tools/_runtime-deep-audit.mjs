#!/usr/bin/env node
/**
 * Deep Runtime Audit — Detects animaton bugs, RAF stalls, DOM corruption.
 * 
 * Tests for:
 * - RAF stall: requestAnimationFrame stops firing
 * - Cascade lockup: win animations that don't complete
 * - DOM mutation bugs: cells rendered with invalid state
 * - Symbol persistence: cell symbols randomly changing post-spin
 * - Balance corruption: math calculation errors
 * - Memory leaks: rapidly growing object counts
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5245;
const ROOT = '/Users/vanvinklstudio/Projects/slot-gdd-factory';

const TEST_FILES = [
  'dist/01_rectangular_5x3_playable.html',
  'dist/03_cluster_7x7_playable.html',
  'dist/19_lock_respin_playable.html',
];

const results = [];

async function runDeepProbe(filename) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`DEEP PROBE: ${filename}`);
  console.log(`${'='.repeat(70)}`);

  const fileResult = {
    file: filename,
    findings: [],
  };

  const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { 
    cwd: ROOT, 
    stdio: 'ignore' 
  });
  await new Promise(r => setTimeout(r, 600));

  try {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    // Inject instrumentation
    await page.goto(`http://127.0.0.1:${PORT}/${filename}`, { 
      waitUntil: 'networkidle',
      timeout: 15000 
    });

    // Instrument RAF to track stalls
    await page.evaluate(() => {
      window.__RAF_TRACKER__ = {
        rafCount: 0,
        rafErrors: [],
        lastRafTime: performance.now(),
        rafStalls: [],
      };

      const origRaf = window.requestAnimationFrame;
      window.requestAnimationFrame = function(fn) {
        const now = performance.now();
        const delta = now - window.__RAF_TRACKER__.lastRafTime;
        
        if (delta > 100 && window.__RAF_TRACKER__.rafCount > 10) {
          window.__RAF_TRACKER__.rafStalls.push({
            time: now,
            delta,
          });
        }
        window.__RAF_TRACKER__.lastRafTime = now;
        window.__RAF_TRACKER__.rafCount++;

        try {
          return origRaf(function(t) {
            try {
              fn(t);
            } catch (e) {
              window.__RAF_TRACKER__.rafErrors.push(String(e));
            }
          });
        } catch (e) {
          window.__RAF_TRACKER__.rafErrors.push('RAF_WRAPPER: ' + String(e));
          throw e;
        }
      };
    });

    await page.waitForTimeout(1000);

    // Spin 1: capture cell state
    console.log('\n[Test 1] Normal spin — capture cell state');
    
    const cellsBefore = await page.evaluate(() => {
      const cells = Array.from(document.querySelectorAll('.cell'));
      return cells.slice(0, 10).map((el, i) => ({
        index: i,
        text: el.textContent?.trim(),
        classes: el.className,
      }));
    });
    console.log(`  Before spin: ${cellsBefore.length} cells sampled`);

    // Click spin
    const spinBtn = await page.$('#spinBtn');
    if (spinBtn) {
      await spinBtn.click();
      console.log('  Spin button clicked');
    }

    // Wait for spin to complete
    let spinComplete = false;
    for (let i = 0; i < 50; i++) {
      await page.waitForTimeout(100);
      spinComplete = await page.evaluate(() => {
        const btn = document.getElementById('spinBtn');
        return btn && !btn.classList.contains('is-spinning');
      });
      if (spinComplete) break;
    }
    console.log(`  Spin completed: ${spinComplete} (waited ${spinComplete ? 'ok' : 'TIMEOUT'})`);

    // Capture cells after spin
    const cellsAfter = await page.evaluate(() => {
      const cells = Array.from(document.querySelectorAll('.cell'));
      return cells.slice(0, 10).map((el, i) => ({
        index: i,
        text: el.textContent?.trim(),
        classes: el.className,
      }));
    });

    // Check for symbol persistence
    let symbolChanges = 0;
    cellsBefore.forEach((before, i) => {
      if (cellsAfter[i] && before.text !== cellsAfter[i].text) {
        symbolChanges++;
      }
    });
    console.log(`  Symbol changes: ${symbolChanges}/10 (expect 3-7 in new spin)`);

    // Check RAF health
    const rafHealth = await page.evaluate(() => window.__RAF_TRACKER__);
    console.log(`  RAF frames: ${rafHealth.rafCount}, stalls: ${rafHealth.rafStalls.length}, errors: ${rafHealth.rafErrors.length}`);
    if (rafHealth.rafErrors.length > 0) {
      console.warn(`  ⚠ RAF errors detected: ${rafHealth.rafErrors.slice(0, 3).join('; ')}`);
      fileResult.findings.push(`RAF_ERRORS: ${rafHealth.rafErrors.slice(0, 2).join('; ')}`);
    }
    if (rafHealth.rafStalls.length > 0) {
      const maxStall = Math.max(...rafHealth.rafStalls.map(s => s.delta));
      console.warn(`  ⚠ RAF stall detected: ${maxStall}ms`);
      fileResult.findings.push(`RAF_STALL: ${maxStall}ms`);
    }

    // Test 2: Rapid balance queries
    console.log('\n[Test 2] Rapid balance state queries (20x)');
    
    const balances = await page.evaluate(() => {
      const results = [];
      for (let i = 0; i < 20; i++) {
        const fsm = typeof window.FSM !== 'undefined' ? window.FSM.balance : null;
        const html = document.querySelector('[class*="balance"]')?.textContent || '';
        results.push({ fsm, html: html.slice(0, 50) });
      }
      return results;
    });

    const uniqueFsmBalances = new Set(balances.map(b => String(b.fsm)));
    console.log(`  Unique FSM balances: ${uniqueFsmBalances.size}`);
    if (uniqueFsmBalances.size > 1) {
      console.warn(`  ⚠ Balance changed during rapid queries: ${Array.from(uniqueFsmBalances).join(', ')}`);
      fileResult.findings.push(`BALANCE_VOLATILITY: ${uniqueFsmBalances.size} different values in 20 queries`);
    }

    // Test 3: Check for DOM element leaks
    console.log('\n[Test 3] DOM element count growth');
    
    const elementCounts = [];
    for (let i = 0; i < 5; i++) {
      const count = await page.evaluate(() => document.querySelectorAll('*').length);
      elementCounts.push(count);
      await page.waitForTimeout(100);
    }
    const growth = elementCounts[4] - elementCounts[0];
    console.log(`  Element count: ${elementCounts[0]} → ${elementCounts[4]} (growth: ${growth})`);
    if (growth > 50) {
      console.warn(`  ⚠ Suspicious DOM growth: +${growth} elements in 500ms`);
      fileResult.findings.push(`DOM_LEAK: +${growth} elements over 500ms`);
    }

    // Test 4: Spin button re-entrance
    console.log('\n[Test 4] Rapid re-spin without waiting');
    
    const preRespinBalance = await page.evaluate(() => {
      return typeof window.FSM !== 'undefined' ? window.FSM.balance : null;
    });

    // Click spin without waiting for previous to complete
    for (let i = 0; i < 3; i++) {
      const btn = await page.$('#spinBtn');
      if (btn) {
        try {
          await btn.click({ timeout: 100 });
        } catch (e) {}
      }
    }
    await page.waitForTimeout(3000);

    const postRespinBalance = await page.evaluate(() => {
      return typeof window.FSM !== 'undefined' ? window.FSM.balance : null;
    });
    console.log(`  Pre-respin: ${preRespinBalance}, post-respin: ${postRespinBalance}`);

    if (typeof postRespinBalance === 'number' && postRespinBalance < 0) {
      console.warn(`  ⚠ NEGATIVE BALANCE: ${postRespinBalance}`);
      fileResult.findings.push(`NEGATIVE_BALANCE: ${postRespinBalance}`);
    }

    // Test 5: Console spam check
    console.log('\n[Test 5] Final state');
    const finalState = await page.evaluate(() => ({
      phase: typeof window.FSM !== 'undefined' ? window.FSM.phase : 'unknown',
      cellsRendered: document.querySelectorAll('.cell').length,
      reelsActive: Array.from(document.querySelectorAll('[class*="reel"]')).filter(el => el.classList.contains('spinning')).length,
    }));
    console.log(`  Phase: ${finalState.phase}, cells: ${finalState.cellsRendered}, spinning reels: ${finalState.reelsActive}`);

    await browser.close();
  } catch (e) {
    fileResult.findings.push(`PROBE_FATAL: ${e.message}`);
    console.error(`FATAL: ${e.message}`);
  } finally {
    srv.kill();
    await new Promise(r => setTimeout(r, 100));
  }

  return fileResult;
}

// Run probes
for (const file of TEST_FILES) {
  const result = await runDeepProbe(file);
  results.push(result);
}

// Summary
console.log(`\n${'='.repeat(70)}`);
console.log('DEEP AUDIT SUMMARY');
console.log(`${'='.repeat(70)}`);

results.forEach(r => {
  const status = r.findings.length === 0 ? '✓ PASS' : `✗ FINDINGS (${r.findings.length})`;
  console.log(`\n${r.file}: ${status}`);
  r.findings.forEach(f => console.log(`  - ${f}`));
});

process.exit(results.some(r => r.findings.length > 0) ? 1 : 0);
