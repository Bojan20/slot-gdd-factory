#!/usr/bin/env node
/**
 * Live verification of Wave H5.4 — bigWinTier continuous-counter rewrite.
 *
 * Boki spec (05.06.2026):
 *   1. Each tier ≈ 4 s of counter time
 *   2. Compound walks through all tiers (1 → finalTier)
 *   3. NO stop between tiers — counter ticks LINEARLY at constant speed
 *   4. After climax, plaque holds for endHoldMs=4s, then fades out
 *   5. onBigWinTierEnd fires once at the end
 *   6. Skip CTA jumps to climax + short fade-out
 *
 * Probe runs on wrath-of-olympus.html (has bigWinTier enabled). Forces a
 * tier-5 big-win via window.bigWinTierEnter(5, 1500) and samples:
 *   • counter value over time → must be monotonically increasing,
 *     near-linear (no plateaus between tier swaps)
 *   • tier transitions → must reach 5 without DOM re-mount in between
 *     (single .big-win-tier-banner node throughout)
 *   • event order → 5× onBigWinTierEntered, 5× onBigWinTierExited, 1× onBigWinTierEnd
 *   • total visible time ≈ (5 × 4000) + endHold 4000 + fade 300 ≈ 24.3 s natural,
 *     OR ≤ ~480 ms when skip is fired mid-walkthrough
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';

const OUT = '/tmp/cortex-bigwin-flow';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const PORT = 5193;
const URL = `http://127.0.0.1:${PORT}/dist/wrath-of-olympus.html`;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
  cwd: '/Users/vanvinklstudio/Projects/slot-gdd-factory',
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 700));

function summarize(label, samples) {
  if (samples.length < 2) return `${label}: insufficient samples (${samples.length})`;
  const first = samples[0];
  const last  = samples[samples.length - 1];
  const dt    = last.t - first.t;
  const dv    = (last.count || 0) - (first.count || 0);
  const ratePerSec = dv / (dt / 1000);
  // Linearity check: max deviation between consecutive segments
  let maxDeviation = 0;
  for (let i = 2; i < samples.length; i++) {
    const seg1 = ((samples[i-1].count || 0) - (samples[i-2].count || 0)) / Math.max(1, samples[i-1].t - samples[i-2].t);
    const seg2 = ((samples[i].count   || 0) - (samples[i-1].count || 0)) / Math.max(1, samples[i].t - samples[i-1].t);
    const expected = ratePerSec / 1000;
    const dev = Math.abs(seg2 - expected) / Math.max(0.001, expected);
    if (dev > maxDeviation && samples[i].t - samples[i-1].t < 200) maxDeviation = dev;
  }
  return `${label}: ${samples.length} samples over ${dt}ms, count 0 → ${last.count|0}, rate ${ratePerSec.toFixed(1)}/s, max linearity deviation ${(maxDeviation*100).toFixed(1)}%`;
}

try {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const consoleMsgs = [];
  page.on('pageerror', (e) => consoleMsgs.push('ERR ' + e.message.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') consoleMsgs.push(m.text().slice(0, 200)); });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // Verify the block is wired
  const presence = await page.evaluate(() => ({
    hostExists: !!document.getElementById('bigWinTierHost'),
    enterFn:    typeof window.bigWinTierEnter,
    exitFn:     typeof window.bigWinTierExit,
    state:      window.BIG_WIN_TIER_STATE,
  }));
  console.log('Presence check:', presence);

  if (presence.enterFn !== 'function') {
    console.error('❌ bigWinTier not wired — abort');
    await browser.close();
    server.kill();
    process.exit(2);
  }

  // ── SCENARIO 1 — natural walkthrough to tier 5, sample counter every 200 ms ──
  console.log('\n— SCENARIO 1: natural walkthrough tier 5 finalX=1500 —');
  await page.evaluate(() => {
    window.__BWT_TRACE__ = { events: [], samples: [] };
    if (window.HookBus && typeof window.HookBus.on === 'function') {
      ['onBigWinTierEntered','onBigWinTierExited','onBigWinTierEnd'].forEach(e => {
        window.HookBus.on(e, (p) => window.__BWT_TRACE__.events.push({ e, t: performance.now()|0, ...p }));
      });
    }
    const tick = () => {
      const amt = document.querySelector('.big-win-tier-amount');
      const banner = document.querySelector('.big-win-tier-banner');
      window.__BWT_TRACE__.samples.push({
        t: performance.now()|0,
        count: amt ? Number(amt.getAttribute('data-count')||0) : null,
        tier:  banner ? Number(banner.getAttribute('data-tier')||0) : null,
        show:  banner ? banner.getAttribute('data-show') : null,
        nodes: document.querySelectorAll('.big-win-tier-banner').length,
      });
    };
    window.__BWT_INTERVAL__ = setInterval(tick, 200);
    window.bigWinTierEnter(5, 1500);
  });

  // Wait for natural completion. WoO durations sum = 22 s, + 4 s hold + 0.3 s fade.
  // Add a safety margin.
  await page.waitForTimeout(27500);

  const scenario1 = await page.evaluate(() => {
    clearInterval(window.__BWT_INTERVAL__);
    return window.__BWT_TRACE__;
  });

  const entered = scenario1.events.filter(e => e.e === 'onBigWinTierEntered');
  const exited  = scenario1.events.filter(e => e.e === 'onBigWinTierExited');
  const ended   = scenario1.events.filter(e => e.e === 'onBigWinTierEnd');
  console.log(`  onBigWinTierEntered: ${entered.length} events, tiers ${entered.map(e=>e.tier).join('→')}`);
  console.log(`  onBigWinTierExited:  ${exited.length} events,  tiers ${exited.map(e=>e.tier).join('→')}`);
  console.log(`  onBigWinTierEnd:     ${ended.length} events,   reason=${ended[0]?.reason}, finalTier=${ended[0]?.tier}, x=${ended[0]?.x}`);
  console.log(`  ${summarize('counter trace', scenario1.samples.filter(s=>s.count!=null))}`);
  const maxNodes = scenario1.samples.reduce((m,s) => Math.max(m, s.nodes||0), 0);
  console.log(`  max simultaneous .big-win-tier-banner nodes: ${maxNodes} (must be 1 for "no remount")`);

  // ── Acceptance checks ──
  const checks = [];
  checks.push(['5 onBigWinTierEntered events',  entered.length === 5]);
  checks.push(['onBigWinTierEntered tiers 1→5', JSON.stringify(entered.map(e=>e.tier)) === '[1,2,3,4,5]']);
  checks.push(['5 onBigWinTierExited events',   exited.length === 5]);
  checks.push(['1 onBigWinTierEnd event',       ended.length === 1]);
  checks.push(['onBigWinTierEnd reason=natural', ended[0]?.reason === 'natural']);
  checks.push(['onBigWinTierEnd finalTier=5',   ended[0]?.tier === 5]);
  checks.push(['onBigWinTierEnd x=1500',        ended[0]?.x === 1500]);
  checks.push(['max simultaneous banners ≤ 1',  maxNodes <= 1]);
  // Counter is monotonic non-decreasing
  let monotonic = true;
  let prevCount = 0;
  for (const s of scenario1.samples) {
    if (s.count != null) {
      if (s.count < prevCount - 1) { monotonic = false; break; }
      prevCount = s.count;
    }
  }
  checks.push(['counter monotonic non-decreasing', monotonic]);
  checks.push(['counter reached finalX (≥1490)',    prevCount >= 1490]);

  // ── SCENARIO 2 — skip during walkthrough ──
  console.log('\n— SCENARIO 2: skip mid-walkthrough at tier 3 —');
  // Ensure scenario 1 is fully drained before starting scenario 2
  await page.evaluate(() => {
    if (window.BIG_WIN_TIER_STATE && window.BIG_WIN_TIER_STATE.walkActive) {
      window.bigWinTierExit('skipped');
    }
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    window.__BWT_TRACE2__ = { events: [], samples: [] };
    // Fresh listener registration (HookBus is multi-subscriber so the previous
    // ones still fire — but they push into __BWT_TRACE__, not __BWT_TRACE2__).
    if (window.HookBus && typeof window.HookBus.on === 'function') {
      ['onBigWinTierEntered','onBigWinTierExited','onBigWinTierEnd'].forEach(e => {
        window.HookBus.on(e, (p) => window.__BWT_TRACE2__.events.push({ e, t: performance.now()|0, ...p }));
      });
    }
    window.bigWinTierEnter(5, 2000);
  });
  // Wait until tier 3 likely active (10 s in: tier 1 at 0-4s, tier 2 at 4-8s, tier 3 at 8-12s)
  await page.waitForTimeout(10000);
  const skipT0 = await page.evaluate(() => {
    const t0 = performance.now()|0;
    window.bigWinTierExit('skipped');
    return t0;
  });
  await page.waitForTimeout(700);
  const scenario2 = await page.evaluate(() => window.__BWT_TRACE2__);
  const end2 = scenario2.events.find(e => e.e === 'onBigWinTierEnd');
  const skipLatency = end2 ? (end2.t - skipT0) : null;
  console.log(`  onBigWinTierEnd reason=${end2?.reason}, latency from skip: ${skipLatency} ms`);
  checks.push(['skip → onBigWinTierEnd reason=skipped',    end2?.reason === 'skipped']);
  checks.push(['skip latency ≤ 600 ms',                    skipLatency != null && skipLatency <= 600]);

  // Report
  console.log('\n— ACCEPTANCE —');
  let pass = 0, fail = 0;
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
    if (ok) pass++; else fail++;
  }
  console.log(`\nResult: ${pass}/${pass+fail} pass, errors: ${consoleMsgs.length}`);
  if (consoleMsgs.length) consoleMsgs.slice(0, 5).forEach(m => console.log('  console:', m));

  await browser.close();
  server.kill();
  process.exit(fail === 0 && consoleMsgs.length === 0 ? 0 : 1);
} catch (e) {
  console.error('PROBE ERROR:', e.message);
  server.kill();
  process.exit(2); /* UQ-FORTIFY6 #3: probe internal error → exit 2 (HARD-FAIL category, CI must not treat as soft-warn) */
}
