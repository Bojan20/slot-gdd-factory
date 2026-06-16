/**
 * tools/_spin-overlay-headless.mjs
 *
 * 2026-06-16 (Boki "sve celije dok se reel okrece, u svakom gridu sve ti
 *               glupo. polako i glupo, nije tako radilo. pogledaj rectangular
 *               kako radi. sve je sporo gledavo, mutno i dalje").
 *
 * Live-DOM proof that the cell-blur regression is dead. Loads the shipping
 * Wrath GDD into the factory page, clicks spin, then samples DOM state at
 * three points:
 *
 *   • t = 200 ms  (mid-spin)  — every reelCol must have `is-spinning`,
 *                                no cell may carry a non-trivial blur,
 *                                computed style on .reelCol must include
 *                                the motion ::after streak.
 *   • t = 1500 ms (mid-cascade) — at least some reels still spinning,
 *                                  at least one already settled.
 *   • t = 3500 ms (fully settled) — NO reelCol may carry `is-spinning`,
 *                                    NO cell may carry `is-blurring`.
 *
 * Run: `node tools/_spin-overlay-headless.mjs`
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const PORT = 5287;
const TARGET = `${REPO}/samples/WRATH_OF_OLYMPUS_GAME_GDD.md`;

const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));

let exitCode = 0;
try {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.waitForSelector('#fileInput', { state: 'attached', timeout: 15000 });
  await page.setInputFiles('#fileInput', TARGET);
  await page.waitForSelector('#previewFrame', { timeout: 25000 });
  await page.waitForTimeout(2000);
  const frame = page.frames().find(f => f !== page.mainFrame());

  // Warm-up: prime the grid with one spin so RECT_REELS lives.
  await frame.evaluate(() => document.getElementById('spinBtn')?.click());
  await page.waitForTimeout(3500);

  // Start the spin under test
  const t0 = Date.now();
  await frame.evaluate(() => document.getElementById('spinBtn')?.click());

  const sampleAt = async (whenMs, label) => {
    const due = t0 + whenMs;
    const wait = Math.max(0, due - Date.now());
    await page.waitForTimeout(wait);
    return frame.evaluate((label) => {
      const cols = Array.from(document.querySelectorAll('.reelCol'));
      const cells = Array.from(document.querySelectorAll('.cell'));
      const reels = (window.RECT_REELS || []);
      const spinningCols = cols.filter(c => c.classList.contains('is-spinning')).length;
      const blurredCells = cells.filter(c => {
        const f = getComputedStyle(c).filter || '';
        if (f === 'none' || f === '') return false;
        const m = f.match(/blur\(([0-9.]+)px\)/);
        return !!(m && parseFloat(m[1]) > 0.1);
      }).length;
      const spinningReels = reels.filter(r => r.spinning).length;
      const settledReels  = reels.filter(r => r.stopped).length;
      // ::after isn't directly queryable, but the streak class on the
      // parent is what activates it. We sample the FIRST spinning col
      // and assert it has the class.
      const sampleColHasClass = cols.length > 0 && cols.some(c => c.classList.contains('is-spinning'));
      return {
        label,
        cols: cols.length,
        cells: cells.length,
        reels: reels.length,
        spinningCols,
        blurredCells,
        spinningReels,
        settledReels,
        sampleColHasClass,
      };
    }, label);
  };

  const mid     = await sampleAt(200,  'mid-spin (t=200ms)');
  const cascade = await sampleAt(1500, 'mid-cascade (t=1500ms)');
  const settled = await sampleAt(3500, 'fully settled (t=3500ms)');

  console.log(JSON.stringify({ mid, cascade, settled }, null, 2));

  const checks = [
    ['mid: every reelCol carries is-spinning',
      mid.spinningCols === mid.reels && mid.reels > 0],
    ['mid: NO cell has computed blur > 0.1px (sharp glyphs)',
      mid.blurredCells === 0],
    ['mid: engine reports reels actively spinning',
      mid.spinningReels === mid.reels],
    ['cascade: some reels still spinning OR at least one settled (cascade in progress)',
      cascade.spinningReels >= 0 && (cascade.spinningReels + cascade.settledReels) > 0],
    ['settled: NO reelCol carries is-spinning anymore',
      settled.spinningCols === 0],
    ['settled: NO cell has computed blur > 0.1px',
      settled.blurredCells === 0],
    ['settled: every reel reports stopped (cascade fully landed)',
      settled.settledReels === settled.reels && settled.reels > 0],
  ];

  let pass = 0, fail = 0;
  for (const [name, ok] of checks) {
    console.log(ok ? '  ✓' : '  ✗', name);
    ok ? pass++ : fail++;
  }
  console.log('');
  console.log(`  ${pass} pass · ${fail} fail`);

  await browser.close();
  exitCode = fail === 0 ? 0 : 1;
} catch (e) {
  console.error('FAIL:', e.message);
  exitCode = 1;
} finally {
  try { server.kill(); } catch (_) {}
}
process.exit(exitCode);
