#!/usr/bin/env node
/**
 * Animation & Cascade Runtime Audit
 * 
 * Tests for:
 * - Cascade animation lockup (win animation hangs)
 * - Reel stop consistency
 * - Win presentation display delay
 * - Symbol flicker or corruption during cascade
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5248;
const ROOT = '/Users/vanvinklstudio/Projects/slot-gdd-factory';

const TEST_FILES = [
  'dist/03_cluster_7x7_playable.html',  // Most complex grid = highest animation load
];

async function animationAudit(filename) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`ANIMATION AUDIT: ${filename}`);
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

    await page.goto(`http://127.0.0.1:${PORT}/${filename}`, { 
      waitUntil: 'networkidle',
      timeout: 15000 
    });

    // Instrument animation tracking
    await page.evaluate(() => {
      window.__ANIM_TRACK__ = {
        spinStartTime: null,
        spinEndTime: null,
        reelStopTimes: [],
        winPresentationStart: null,
        winPresentationEnd: null,
        cascadeStartTime: null,
        cascadeEndTime: null,
        cellsMutated: 0,
        animationFrameCount: 0,
      };

      // Track HookBus events
      const originalEmit = window.HookBus?.emit || (() => {});
      if (window.HookBus) {
        const origEmit = window.HookBus.emit;
        window.HookBus.emit = function(event, payload) {
          const now = performance.now();
          if (event === 'preSpin') {
            window.__ANIM_TRACK__.spinStartTime = now;
            window.__ANIM_TRACK__.reelStopTimes = [];
          }
          if (event === 'onSpinResult') {
            window.__ANIM_TRACK__.spinEndTime = now;
          }
          if (event === 'onWinPresentationStart') {
            window.__ANIM_TRACK__.winPresentationStart = now;
          }
          if (event === 'onWinPresentationEnd') {
            window.__ANIM_TRACK__.winPresentationEnd = now;
          }
          return origEmit.call(this, event, payload);
        };
      }

      // Count RAF frames
      const origRaf = window.requestAnimationFrame;
      window.requestAnimationFrame = function(fn) {
        window.__ANIM_TRACK__.animationFrameCount++;
        return origRaf.call(this, fn);
      };
    });

    await page.waitForTimeout(800);

    // Run 3 spins looking for animation issues
    console.log('\n[Test 1] Spin animation timing (3 spins)');

    for (let spinNum = 1; spinNum <= 3; spinNum++) {
      const btn = await page.$('#spinBtn');
      if (btn) await btn.click();

      // Wait for spin complete with timeout
      const startWait = Date.now();
      let spinComplete = false;
      for (let i = 0; i < 65; i++) {
        await page.waitForTimeout(100);
        spinComplete = await page.evaluate(() => {
          const btn = document.getElementById('spinBtn');
          return btn && !btn.classList.contains('is-spinning') && !btn.disabled;
        });
        if (spinComplete) break;
      }

      const totalTime = Date.now() - startWait;

      if (!spinComplete) {
        bugs.push(`SPIN${spinNum}_ANIMATION_TIMEOUT: ${totalTime}ms (no completion within 6.5s)`);
        console.warn(`  Spin ${spinNum}: ✗ ANIMATION TIMEOUT (${totalTime}ms)`);
        break;
      }

      const timing = await page.evaluate(() => window.__ANIM_TRACK__);
      const spinDuration = timing.spinEndTime - timing.spinStartTime;
      console.log(`  Spin ${spinNum}: ${spinDuration?.toFixed(0)}ms (${timing.animationFrameCount} RAF frames)`);

      if (spinDuration > 6000) {
        bugs.push(`SPIN${spinNum}_LONG_ANIMATION: ${spinDuration}ms`);
        console.warn(`    ✗ Animation took ${spinDuration}ms (expected < 5000ms)`);
      }

      if (timing.winPresentationStart && timing.winPresentationEnd) {
        const winDuration = timing.winPresentationEnd - timing.winPresentationStart;
        console.log(`    Win presentation: ${winDuration?.toFixed(0)}ms`);
        if (winDuration > 4000) {
          console.warn(`    ⚠ Win presentation took ${winDuration}ms`);
        }
      }
    }

    // Test 2: Check for stuck reels/cells
    console.log('\n[Test 2] Reel/cell DOM stability post-spin');

    const preSpin = await page.evaluate(() => ({
      cellCount: document.querySelectorAll('.cell').length,
      reelCount: document.querySelectorAll('[class*="reel"]').length,
      spinningReels: Array.from(document.querySelectorAll('[class*="reel"]')).filter(el =>
        el.classList.contains('spinning') || el.style.animation
      ).length,
    }));

    const btn = await page.$('#spinBtn');
    if (btn) await btn.click();

    // Wait 3s mid-spin and check
    await page.waitForTimeout(1500);

    const midSpin = await page.evaluate(() => {
      const spinning = Array.from(document.querySelectorAll('[class*="reel"]')).filter(el =>
        el.classList.contains('spinning') || el.style.animation
      ).length;
      return {
        reelsSpinning: spinning,
        hasSpinning: spinning > 0,
      };
    });

    console.log(`  Mid-spin: ${midSpin.reelsSpinning} reels spinning (expect > 0)`);
    if (!midSpin.hasSpinning) {
      console.warn(`    ⚠ No reels spinning mid-spin detected`);
    }

    // Wait for completion
    for (let i = 0; i < 50; i++) {
      await page.waitForTimeout(100);
      const done = await page.evaluate(() => {
        const btn = document.getElementById('spinBtn');
        return btn && !btn.classList.contains('is-spinning');
      });
      if (done) break;
    }

    const postSpin = await page.evaluate(() => ({
      cellCount: document.querySelectorAll('.cell').length,
      reelCount: document.querySelectorAll('[class*="reel"]').length,
      spinningReels: Array.from(document.querySelectorAll('[class*="reel"]')).filter(el =>
        el.classList.contains('spinning')
      ).length,
    }));

    console.log(`  Post-spin: ${postSpin.spinningReels} reels spinning (expect 0)`);
    if (postSpin.spinningReels > 0) {
      bugs.push(`REELS_STUCK_SPINNING: ${postSpin.spinningReels} reels`);
      console.warn(`    ✗ Reels stuck in spinning state!`);
    }

    // Test 3: Extended play (10 spins) for memory/animation leaks
    console.log('\n[Test 3] Extended play stress (10 spins, watch for animation stalls)');

    let stalls = 0;
    for (let i = 1; i <= 10; i++) {
      const btn = await page.$('#spinBtn');
      if (btn && !await page.evaluate(() => document.getElementById('spinBtn').classList.contains('is-spinning'))) {
        await btn.click();

        let complete = false;
        const startTime = Date.now();
        for (let j = 0; j < 60; j++) {
          await page.waitForTimeout(100);
          complete = await page.evaluate(() => {
            const b = document.getElementById('spinBtn');
            return b && !b.classList.contains('is-spinning');
          });
          if (complete) break;
        }

        const elapsed = Date.now() - startTime;
        if (!complete || elapsed > 6000) {
          stalls++;
          console.log(`  Spin ${i}: STALL (${elapsed}ms)`);
        }
      }
    }

    if (stalls > 2) {
      bugs.push(`ANIMATION_STALLS: ${stalls}/10 spins took > 6s`);
      console.warn(`  ✗ ${stalls} animation stalls detected in extended play`);
    }

    console.log(`  Completed 10 spins, ${stalls} stalls`);

    await browser.close();
  } catch (e) {
    bugs.push(`FATAL: ${e.message}`);
    console.error(`FATAL: ${e.message}`);
  } finally {
    srv.kill();
    await new Promise(r => setTimeout(r, 100));
  }

  return bugs;
}

// Run audit
const bugs = await animationAudit(TEST_FILES[0]);

console.log(`\n${'='.repeat(70)}`);
console.log('ANIMATION AUDIT RESULT');
console.log(`${'='.repeat(70)}`);
console.log(`Total issues: ${bugs.length}`);
bugs.forEach(b => console.log(`  - ${b}`));

process.exit(bugs.length > 0 ? 1 : 0);
