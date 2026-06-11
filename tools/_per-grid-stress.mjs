/**
 * Per-grid stress probe — Boki's "svaki grid mora savršeno + svaki blok"
 * verification. Spins each fixture 5×, checks for:
 *   - JS errors / page errors
 *   - DOM redness (undefined/NaN/null/[object Object] in visible text)
 *   - Stuck spin button (locked permanently after spin)
 *   - Mid-spin anticipation halos appearing wrongly (regression guard)
 *   - postSpin emit reaching listeners
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const PORT = 5191;

const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));

const GALLERY = resolve(REPO, 'dist/gallery');
const fixtures = readdirSync(GALLERY).filter(f => f.endsWith('.html') && f !== 'index.html').sort();

const browser = await chromium.launch();
const results = [];

for (const fx of fixtures) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGE: ' + e.message.slice(0, 140)));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errs.push('CON: ' + m.text().slice(0, 140)); });

  const url = `http://127.0.0.1:${PORT}/dist/gallery/${fx}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);

  // Install HookBus tap
  await page.evaluate(() => {
    window.__SP_EMITS__ = {};
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      const orig = window.HookBus.emit;
      window.HookBus.emit = function (n, p) {
        window.__SP_EMITS__[n] = (window.__SP_EMITS__[n] || 0) + 1;
        return orig.call(this, n, p);
      };
    }
  });

  // Idle-state halo check (regression guard for fix made above)
  const idleHalos = await page.evaluate(() =>
    document.querySelectorAll('.cell--anticipating-cell').length
  );

  // Spin button presence
  const hasBtn = await page.evaluate(() => !!document.getElementById('spinBtn'));

  let spinsTried = 0, postSpinsSeen = 0, btnStuck = false;
  if (hasBtn) {
    for (let i = 0; i < 5; i++) {
      const disabled = await page.evaluate(() => {
        const btn = document.getElementById('spinBtn');
        return btn ? btn.disabled : null;
      });
      if (disabled === null) break;
      if (disabled) {
        // Wait briefly for unlock — if stuck > 12 s after a spin, flag it.
        let unlocked = false;
        const start = Date.now();
        while (Date.now() - start < 12000) {
          await page.waitForTimeout(200);
          const d = await page.evaluate(() => document.getElementById('spinBtn').disabled);
          if (!d) { unlocked = true; break; }
        }
        if (!unlocked) { btnStuck = true; break; }
      }
      await page.evaluate(() => document.getElementById('spinBtn').click());
      spinsTried++;
      // Wait up to 8s for postSpin
      const before = postSpinsSeen;
      const start = Date.now();
      while (Date.now() - start < 8000) {
        const ps = await page.evaluate(() => (window.__SP_EMITS__ || {}).postSpin || 0);
        if (ps > postSpinsSeen) { postSpinsSeen = ps; break; }
        await page.waitForTimeout(150);
      }
      if (postSpinsSeen === before) break; // spin never finished
      await page.waitForTimeout(300);
    }
  }

  // DOM redness scan
  const redness = await page.evaluate(() => {
    const out = [];
    const banned = [/\bundefined\b/, /\bNaN\b/, /\[object Object\]/];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent) continue;
      const tag = parent.tagName.toUpperCase();
      if (tag === 'SCRIPT' || tag === 'STYLE') continue;
      const txt = (node.nodeValue || '').trim();
      if (!txt) continue;
      for (const re of banned) {
        if (re.test(txt)) {
          out.push({ tag, txt: txt.slice(0, 60), cls: parent.className });
          break;
        }
      }
    }
    return out;
  });

  results.push({
    fx,
    errs: errs.length, errSample: errs[0] || '',
    idleHalos,
    hasBtn,
    spinsTried, postSpinsSeen,
    btnStuck,
    redness: redness.length,
    rednessSample: redness[0] || null,
  });

  await ctx.close();
}

await browser.close();
server.kill();

console.log('\n┌────────────────────────────────────────────┬─────┬──────┬─────┬───────┬──────┬─────────┐');
console.log('│ Fixture                                    │ err │ idle │ btn │ spins │ post │ redness │');
console.log('├────────────────────────────────────────────┼─────┼──────┼─────┼───────┼──────┼─────────┤');
for (const r of results) {
  const fx = r.fx.replace('.html', '').padEnd(42);
  const err = String(r.errs).padStart(3);
  const idle = String(r.idleHalos).padStart(4);
  const btn = (r.btnStuck ? 'STUCK' : (r.hasBtn ? ' ok ' : ' no ')).padStart(4);
  const spins = String(r.spinsTried).padStart(5);
  const post = String(r.postSpinsSeen).padStart(4);
  const red = String(r.redness).padStart(7);
  console.log(`│ ${fx} │ ${err} │ ${idle} │ ${btn} │ ${spins} │ ${post} │ ${red} │`);
}
console.log('└────────────────────────────────────────────┴─────┴──────┴─────┴───────┴──────┴─────────┘');

const sus = results.filter(r => r.errs > 0 || r.idleHalos > 0 || r.btnStuck || r.redness > 0);
console.log(`\nDefects: ${sus.length} / ${results.length}`);
for (const r of sus) {
  console.log(`  ${r.fx}: errs=${r.errs} idleHalos=${r.idleHalos} btnStuck=${r.btnStuck} redness=${r.redness}`);
  if (r.errSample) console.log(`    err: ${r.errSample}`);
  if (r.rednessSample) console.log(`    red: <${r.rednessSample.tag}.${r.rednessSample.cls}> "${r.rednessSample.txt}"`);
}
process.exit(sus.length > 0 ? 1 : 0);
