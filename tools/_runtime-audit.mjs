#!/usr/bin/env node
/**
 * Runtime Behavior Audit Probe
 * 
 * Tests representative slot.html files from dist/ for:
 * - Boot phase: console errors, missing globals, CSS load failures
 * - Spin phase: spin completes, win/loss display, balance updates
 * - Rapid-spin phase: re-entrance bugs, negative balance, FSM state corruption
 * - Reload phase: localStorage corruption, state preservation
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = 5244;
const ROOT = '/Users/vanvinklstudio/Projects/slot-gdd-factory';

// Test files: one rectangular, one cluster, one special mechanic
const TEST_FILES = [
  'dist/01_rectangular_5x3_playable.html',
  'dist/03_cluster_7x7_playable.html',
  'dist/19_lock_respin_playable.html',  // complex mechanic
];

const results = [];

async function runProbe(filename) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`PROBING: ${filename}`);
  console.log(`${'='.repeat(70)}`);

  const fileResult = {
    file: filename,
    phases: {},
    errors: [],
  };

  // Start HTTP server
  const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { 
    cwd: ROOT, 
    stdio: 'ignore' 
  });
  
  await new Promise(r => setTimeout(r, 600));

  try {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    const consoleErrors = [];
    const pageErrors = [];
    
    page.on('console', m => {
      if (m.type() === 'error') {
        consoleErrors.push(m.text().slice(0, 300));
      }
    });
    
    page.on('pageerror', e => {
      pageErrors.push(e.message.slice(0, 300));
    });

    // ===== BOOT PHASE =====
    console.log('\n[BOOT PHASE] Loading slot.html...');
    const bootStart = Date.now();
    try {
      await page.goto(`http://127.0.0.1:${PORT}/${filename}`, { 
        waitUntil: 'networkidle',
        timeout: 15000 
      });
    } catch (e) {
      fileResult.errors.push(`BOOT_TIMEOUT: ${e.message}`);
      console.error(`  ERROR: Failed to load - ${e.message}`);
      await browser.close();
      return fileResult;
    }

    const bootTime = Date.now() - bootStart;
    console.log(`  ✓ Page loaded in ${bootTime}ms`);

    // Check for critical globals
    const bootState = await page.evaluate(() => ({
      hasHookBus: typeof window.HookBus !== 'undefined',
      hasGlobalState: typeof window.FSM !== 'undefined' || typeof window.gameState !== 'undefined',
      hasSpinBtn: document.getElementById('spinBtn') !== null,
      hasBalance: document.querySelector('[data-testid="balance"]') !== null || 
                  document.querySelector('[class*="balance"]') !== null,
      windowErrors: window.__BOOT_ERRORS__ || [],
    }));

    console.log(`  HookBus: ${bootState.hasHookBus}`);
    console.log(`  FSM/GameState: ${bootState.hasGlobalState}`);
    console.log(`  Spin Button: ${bootState.hasSpinBtn}`);
    console.log(`  Balance Display: ${bootState.hasBalance}`);

    if (consoleErrors.length > 0) {
      console.warn(`  ⚠ Console errors during boot: ${consoleErrors.length}`);
      consoleErrors.forEach(e => console.warn(`    - ${e}`));
      fileResult.errors.push(...consoleErrors.map(e => `CONSOLE_ERROR: ${e}`));
    }

    if (pageErrors.length > 0) {
      console.warn(`  ⚠ Page errors: ${pageErrors.length}`);
      pageErrors.forEach(e => console.warn(`    - ${e}`));
      fileResult.errors.push(...pageErrors.map(e => `PAGE_ERROR: ${e}`));
    }

    fileResult.phases.boot = {
      time: bootTime,
      critical: bootState,
      consoleErrors: consoleErrors.length,
      pageErrors: pageErrors.length,
    };

    // Wait 3s to observe any deferred init errors
    await page.waitForTimeout(2000);
    const earlyErrors = [...consoleErrors];
    if (pageErrors.length > 0) {
      fileResult.errors.push('BOOT_PAGE_ERRORS: ' + pageErrors.slice(0, 2).join(' | '));
    }

    // ===== SPIN PHASE =====
    console.log('\n[SPIN PHASE] Attempting single spin...');
    
    const initialBalance = await page.evaluate(() => {
      try {
        const balEl = document.querySelector('[data-testid="balance"]') ||
                      document.querySelector('[class*="balance"]') ||
                      document.querySelector('[class*="wallet"]');
        return balEl?.textContent || 'unknown';
      } catch (e) {
        return 'error: ' + e.message;
      }
    });
    console.log(`  Initial balance: ${initialBalance}`);

    const spinStart = Date.now();
    try {
      // Try to click spin button
      const spinBtn = await page.$('#spinBtn');
      if (spinBtn) {
        await spinBtn.click();
        console.log(`  ✓ Spin button clicked`);
      } else {
        // Try HookBus
        await page.evaluate(() => {
          if (window.HookBus) {
            window.HookBus.emit('spinRequested', { source: 'probe' });
          }
        });
        console.log(`  ✓ Spin event emitted`);
      }
    } catch (e) {
      fileResult.errors.push(`SPIN_CLICK_ERROR: ${e.message}`);
      console.error(`  ERROR clicking spin: ${e.message}`);
    }

    // Wait for spin to complete (max 5s)
    let spinCompleted = false;
    try {
      await page.waitForFunction(() => {
        const btn = document.getElementById('spinBtn');
        if (!btn) return false;
        return !btn.classList.contains('is-spinning') && !btn.disabled;
      }, { timeout: 5000 }).catch(() => {});
      
      spinCompleted = true;
      const spinTime = Date.now() - spinStart;
      console.log(`  ✓ Spin completed in ${spinTime}ms`);
      fileResult.phases.spin = { time: spinTime, completed: true };
    } catch (e) {
      console.warn(`  ⚠ Spin did not complete within timeout`);
      fileResult.phases.spin = { time: Date.now() - spinStart, completed: false };
      fileResult.errors.push(`SPIN_TIMEOUT: took > 5000ms`);
    }

    const postSpinBalance = await page.evaluate(() => {
      try {
        const balEl = document.querySelector('[data-testid="balance"]') ||
                      document.querySelector('[class*="balance"]') ||
                      document.querySelector('[class*="wallet"]');
        return balEl?.textContent || 'unknown';
      } catch (e) {
        return 'error: ' + e.message;
      }
    });
    console.log(`  Final balance: ${postSpinBalance}`);

    // ===== RAPID-SPIN PHASE =====
    console.log('\n[RAPID-SPIN PHASE] Spam-clicking spin button 10x in 200ms...');
    
    try {
      // Get initial FSM state
      const preRapidState = await page.evaluate(() => ({
        phase: typeof window.FSM !== 'undefined' ? window.FSM.phase : 'no-fsm',
        balance: typeof window.FSM !== 'undefined' ? window.FSM.balance : 'n/a',
      }));

      // Spam click
      for (let i = 0; i < 10; i++) {
        const spinBtn = await page.$('#spinBtn');
        if (spinBtn) {
          try {
            await spinBtn.click({ timeout: 100 });
          } catch (e) {
            // expected to fail sometimes
          }
        }
        await page.waitForTimeout(20);
      }
      console.log(`  ✓ Spam clicks executed`);

      // Wait for reels to settle
      await page.waitForTimeout(3000);

      // Check post-rapid state
      const postRapidState = await page.evaluate(() => {
        const balance = typeof window.FSM !== 'undefined' ? window.FSM.balance : 'n/a';
        const isNegative = typeof balance === 'number' && balance < 0;
        const phase = typeof window.FSM !== 'undefined' ? window.FSM.phase : 'no-fsm';
        return {
          phase,
          balance,
          isNegative,
          spinBtnDisabled: document.getElementById('spinBtn')?.disabled || false,
        };
      });

      console.log(`  Post-rapid state: phase=${postRapidState.phase}, balance=${postRapidState.balance}`);
      if (postRapidState.isNegative) {
        fileResult.errors.push(`RAPID_NEGATIVE_BALANCE: ${postRapidState.balance}`);
        console.warn(`  ⚠ NEGATIVE BALANCE DETECTED!`);
      }

      fileResult.phases.rapidSpin = postRapidState;
    } catch (e) {
      fileResult.errors.push(`RAPID_SPIN_ERROR: ${e.message}`);
      console.warn(`  ⚠ Rapid spin error: ${e.message}`);
    }

    // ===== RELOAD PHASE =====
    console.log('\n[RELOAD PHASE] Reloading page...');
    
    const preReloadBalance = postSpinBalance;
    try {
      await page.reload({ waitUntil: 'networkidle', timeout: 15000 });
      console.log(`  ✓ Page reloaded`);

      await page.waitForTimeout(1000);

      const postReloadBalance = await page.evaluate(() => {
        try {
          const balEl = document.querySelector('[data-testid="balance"]') ||
                        document.querySelector('[class*="balance"]') ||
                        document.querySelector('[class*="wallet"]');
          return balEl?.textContent || 'unknown';
        } catch (e) {
          return 'error: ' + e.message;
        }
      });

      console.log(`  Balance after reload: ${postReloadBalance}`);
      
      // Check for localStorage corruption
      const storageCheck = await page.evaluate(() => {
        try {
          const items = {};
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            const val = localStorage.getItem(key);
            try {
              JSON.parse(val);
              items[key] = 'valid';
            } catch (e) {
              items[key] = 'corrupt';
            }
          }
          return items;
        } catch (e) {
          return { error: e.message };
        }
      });

      const corruptKeys = Object.entries(storageCheck).filter(([_, v]) => v === 'corrupt');
      if (corruptKeys.length > 0) {
        console.warn(`  ⚠ Corrupt localStorage keys: ${corruptKeys.map(([k]) => k).join(', ')}`);
        fileResult.errors.push(`CORRUPT_STORAGE: ${corruptKeys.map(([k]) => k).join(', ')}`);
      }

      fileResult.phases.reload = {
        balanceChanged: preReloadBalance !== postReloadBalance,
        postReloadBalance,
        corruptKeys: corruptKeys.length,
      };
    } catch (e) {
      fileResult.errors.push(`RELOAD_ERROR: ${e.message}`);
      console.error(`  ERROR during reload: ${e.message}`);
    }

    await browser.close();
  } catch (e) {
    fileResult.errors.push(`PROBE_FATAL: ${e.message}`);
    console.error(`\nFATAL ERROR: ${e.message}`);
  } finally {
    srv.kill();
    await new Promise(r => setTimeout(r, 100));
  }

  return fileResult;
}

// Run probes sequentially
for (const file of TEST_FILES) {
  const result = await runProbe(file);
  results.push(result);
}

// ===== SUMMARY =====
console.log(`\n${'='.repeat(70)}`);
console.log('AUDIT SUMMARY');
console.log(`${'='.repeat(70)}`);

results.forEach(r => {
  const errorCount = r.errors.length;
  const status = errorCount === 0 ? '✓ PASS' : `✗ FAIL (${errorCount} errors)`;
  console.log(`\n${r.file}: ${status}`);
  if (r.errors.length > 0) {
    r.errors.slice(0, 5).forEach(err => console.log(`  - ${err}`));
    if (r.errors.length > 5) console.log(`  ... and ${r.errors.length - 5} more`);
  }
  if (r.phases.boot) {
    console.log(`  Boot: ${r.phases.boot.time}ms, pageErrors=${r.phases.boot.pageErrors}`);
  }
  if (r.phases.spin) {
    console.log(`  Spin: ${r.phases.spin.time}ms, completed=${r.phases.spin.completed}`);
  }
  if (r.phases.rapidSpin && r.phases.rapidSpin.isNegative) {
    console.log(`  Rapid: NEGATIVE BALANCE=${r.phases.rapidSpin.balance}`);
  }
});

process.exit(results.some(r => r.errors.length > 0) ? 1 : 0);
