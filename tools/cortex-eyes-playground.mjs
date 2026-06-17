#!/usr/bin/env node
/**
 * tools/cortex-eyes-playground.mjs — Wave Z.1 atom Z8 (live verification)
 *
 * Headless Playwright probe of `/blocks/index.html`. Asserts the
 * skeleton is wired end-to-end:
 *
 *   1. Page loads without console errors / page errors
 *   2. Manifest pill shows the correct block count (read from
 *      `blocks/_manifest.json` at test time so the assertion can't
 *      drift)
 *   3. Sidebar renders one row per block, grouped by category
 *   4. Hash-routing: navigating to `#<name>` renders the detail pane
 *      with the block's exports, listens, emits tokens
 *   5. Filter input prunes the sidebar live
 *   6. Welcome screen comes back when hash cleared
 *
 * Exits 0 on green, 1 on first failure. Prints a tabular report so
 * cortex eyes drains the result in 200 ms.
 *
 * Runs against a one-shot Python HTTP server on port 5230 (consistent
 * with other Wave H/J probes which use 52xx range).
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5230;
const URL  = `http://127.0.0.1:${PORT}/blocks/index.html`;

const manifest = JSON.parse(readFileSync(resolve(ROOT, 'blocks/_manifest.json'), 'utf8'));

let pass = 0, fail = 0;
const log = (ok, name, hint = '') => {
  const tag = ok ? '✓' : '✗';
  console.log(`  ${tag} ${name}${hint && !ok ? '  — ' + hint : ''}`);
  if (ok) pass++; else fail++;
};

const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
  cwd: ROOT, stdio: 'ignore',
});

await new Promise((r) => setTimeout(r, 700));

try {
  const browser = await chromium.launch();
  const ctx     = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page    = await ctx.newPage();
  const errors  = [];
  page.on('pageerror',  (e) => errors.push('pageerror: ' + e.message.slice(0, 200)));
  page.on('console',    (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });

  console.log('— cortex-eyes-playground —');

  /* 1. Load + no console errors */
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  log(errors.length === 0, 'page loads with 0 console / page errors',
      errors[0] || '');

  /* 2. Header pills reflect manifest */
  const countText = await page.locator('#meta-count').textContent();
  log(countText && countText.includes(String(manifest.totalBlocks)),
      `pill shows totalBlocks (${manifest.totalBlocks})`,
      `got "${countText}"`);

  const eventsText = await page.locator('#meta-events').textContent();
  log(/^\d+ events$/.test((eventsText || '').trim()),
      'pill shows event count', `got "${eventsText}"`);

  /* 3. Sidebar populated with one row per block */
  const sidebarCount = await page.locator('.play-side-item').count();
  log(sidebarCount === manifest.totalBlocks,
      `sidebar has ${manifest.totalBlocks} items`,
      `got ${sidebarCount}`);

  /* 3a. Sidebar has at least 3 category groups (we have 9) */
  const groupCount = await page.locator('.play-side-group').count();
  log(groupCount >= 3, `sidebar has ≥3 category groups`,
      `got ${groupCount}`);

  /* 3b. Welcome screen shows per-category cards */
  const welcomeCards = await page.locator('.play-welcome-card').count();
  log(welcomeCards >= 3, 'welcome screen shows ≥3 category cards',
      `got ${welcomeCards}`);

  /* 4. Hash-route to a known block (paytable — present in any manifest) */
  await page.evaluate(() => { location.hash = '#paytable'; });
  await page.waitForTimeout(200);
  const detailName = await page.locator('.play-detail-name').textContent();
  log(detailName === 'paytable',
      'hash #paytable renders detail header',
      `got "${detailName}"`);

  /* 4a. Detail pane has all 8 cards (Z6 added actions, Z5 added live log,
         Z.2 added live demo iframe card) */
  const cards = await page.locator('.play-detail-grid .play-card').count();
  log(cards === 8, 'detail pane has 8 cards (API/listens/emits/files/config/actions/live/demo)',
      `got ${cards}`);

  /* 4a.bis — Z6 quick-action buttons + Z5 live-log buttons present */
  const btnCount = await page.locator('.play-btn').count();
  log(btnCount >= 4, 'quick-action + live-log buttons rendered',
      `expected ≥4, got ${btnCount}`);

  /* 4a.ter — Z5 live HookBus log card mounted with empty-state placeholder
              (this static page has no window.HookBus, so the empty hint
              MUST be visible) */
  const liveLog = await page.locator('#eventLog').count();
  log(liveLog === 1, 'live HookBus log card mounted',
      `expected 1 #eventLog, got ${liveLog}`);
  const emptyHint = await page.locator('#eventLog .play-event-empty').count();
  log(emptyHint === 1, 'live log shows empty-state placeholder (no HookBus on this page)',
      `expected 1 placeholder, got ${emptyHint}`);

  /* 4a.quint — Z4 trigger preset library — buttons render + listPresets exposed */
  const presetButtons = await page.locator('.play-btn-preset').count();
  log(presetButtons >= 18, 'trigger preset library has ≥18 buttons',
      `expected ≥18 buttons, got ${presetButtons}`);
  const presetIds = await page.evaluate(() =>
    window.BlockPlayground && window.BlockPlayground.listPresets
      ? window.BlockPlayground.listPresets().map((p) => p.id)
      : []
  );
  log(presetIds.includes('preSpinBase') && presetIds.includes('fsTrigger10'),
      'window.BlockPlayground.listPresets() exposes canonical entries',
      `got ${presetIds.length} presets`);

  /* 4a.six — preset click WITH demo iframe HookBus available (Z.2 always
   * loads block runtime in iframe → iframe.contentWindow.HookBus exists,
   * so playground.runPreset() falls through to that bus and NO warn pill
   * is shown). Test asserts the happy-path: 0 warn buttons after click. */
  await page.click('button[data-preset-id="preSpinBase"]');
  await page.waitForTimeout(80);
  const warnPill = await page.locator('button.play-btn-warn').count();
  log(warnPill === 0,
      'preset click with demo iframe HookBus does NOT raise warn pill',
      `expected 0 (iframe has HookBus), got ${warnPill}`);
  await page.waitForTimeout(1700);
  const warnGone = await page.locator('button.play-btn-warn').count();
  log(warnGone === 0, 'warn state cleared (or never set) after 1.5s',
      `expected 0, got ${warnGone}`);

  /* 4a.sev — preset round-trip with a stub HookBus → ✓ Fired pill + log row */
  await page.evaluate(() => {
    /* stub minimal HookBus surface for the test */
    if (!window.HookBus) {
      const handlers = {};
      window.HookBus = {
        on:   (n, fn) => { (handlers[n] = handlers[n] || []).push(fn); },
        emit: (n, p)  => { for (const fn of (handlers[n] || [])) try { fn(p); } catch (_) {} },
      };
      window.BlockPlayground.reattachHookBus();
    }
    window.BlockPlayground.clearEventLog();
  });
  await page.click('button[data-preset-id="fsTrigger10"]');
  await page.waitForTimeout(120);
  const okPill = await page.locator('button.play-btn-ok').count();
  log(okPill === 1, 'preset click with HookBus shows ✓ Fired confirmation',
      `expected 1 ok button, got ${okPill}`);
  const logRows = await page.locator('#eventLog .play-event-row').count();
  log(logRows >= 1, 'preset emit landed in live log',
      `expected ≥1 row, got ${logRows}`);
  const logSnapshot = await page.evaluate(() =>
    window.BlockPlayground.getEventLog().map((r) => r.name)
  );
  log(logSnapshot.includes('onFsTrigger'),
      'getEventLog() returns the emitted event name',
      `got ${JSON.stringify(logSnapshot)}`);

  /* 4a.qrt — Z6 localStorage persistence — filter survives reload */
  await page.fill('#filter', 'wild');
  await page.waitForTimeout(80);
  await page.reload({ waitUntil: 'networkidle' });
  const filterAfter = await page.locator('#filter').inputValue();
  log(filterAfter === 'wild', 'Z6 filter persisted across reload',
      `expected "wild", got "${filterAfter}"`);
  /* clear for next assertion phase */
  await page.click('#clear');
  await page.waitForTimeout(80);

  /* re-navigate to paytable for downstream assertions */
  await page.goto(URL + '#paytable', { waitUntil: 'networkidle' });
  await page.waitForTimeout(120);

  /* 4b. Listens tokens present (paytable listens to onBetChanged etc) */
  const listens = await page.locator('.play-token-listen').count();
  log(listens >= 1, 'detail pane has ≥1 listen token',
      `got ${listens}`);

  /* 4c. defaultConfig snapshot rendered (paytable has enabled: true now) */
  const cfgText = await page.locator('.play-config').textContent();
  log(cfgText && cfgText.includes('"enabled"'),
      'defaultConfig snapshot rendered',
      `got "${(cfgText || '').slice(0, 80)}…"`);

  /* 5. Filter prunes sidebar */
  await page.evaluate(() => { location.hash = ''; });
  await page.fill('#filter', 'multipl');
  await page.waitForTimeout(150);
  const filtered = await page.locator('.play-side-item').count();
  log(filtered > 0 && filtered < manifest.totalBlocks,
      `filter "multipl" narrows sidebar (${filtered} of ${manifest.totalBlocks})`);

  /* 6. Clear filter restores all items */
  await page.click('#clear');
  await page.waitForTimeout(100);
  const restored = await page.locator('.play-side-item').count();
  log(restored === manifest.totalBlocks, 'clear button restores all items',
      `got ${restored}`);

  /* 7. Unknown hash shows "not found" page */
  await page.evaluate(() => { location.hash = '#__nope__'; });
  await page.waitForTimeout(150);
  const notFoundH1 = await page.locator('main h1').textContent();
  log(notFoundH1 === 'Block not found',
      'unknown hash shows "Block not found" pane',
      `got "${notFoundH1}"`);

  await browser.close();
} catch (e) {
  console.error('  ✗ fatal probe error:', e.message);
  fail += 1;
} finally {
  server.kill();
}

console.log('\n--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
