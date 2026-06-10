#!/usr/bin/env node
/**
 * Brutal monkey stress — 150 random actions per GDD: spin spam, force chips,
 * modal toggles, bet ±. Every 10 actions: snapshot empties/?. If any action
 * leaves the grid with empty cells, save a PNG + console.error log.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const OUT  = `${REPO}/tools/_eyes/monkey`;
mkdirSync(OUT, { recursive: true });
const HOME = process.env.HOME;
const GDDS = [
  { name: 'Huff',      path: `${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf` },
  { name: 'Starlight', path: `${HOME}/Desktop/GDD/Starlight_Travellers_GDD.pdf` },
];

const PORT = 5241;
const URL  = `http://127.0.0.1:${PORT}/`;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch({ headless: true });

for (const gdd of GDDS) {
  if (!existsSync(gdd.path)) continue;
  console.log(`\n═══ ${gdd.name} — monkey stress ═══`);
  const errs = [], warns = [], pageErrs = [];
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type()==='error') errs.push(m.text()); if (m.type()==='warning') warns.push(m.text()); });
  page.on('pageerror', e => pageErrs.push(String(e)));
  await page.goto(URL, { waitUntil: 'load' });
  await (await page.$('#fileInput')).setInputFiles(gdd.path);
  await page.waitForSelector('#previewFrame', { timeout: 15000 });
  await page.waitForTimeout(1200);
  const frame = page.frames().find(f => f !== page.mainFrame());
  frame.on('console', m => { if (m.type()==='error') errs.push('[iframe] '+m.text()); });
  frame.on('pageerror', e => pageErrs.push('[iframe] '+e));

  const snap = async () => frame.evaluate(() => {
    const cells = document.querySelectorAll('.cell');
    let empty = 0, q = 0;
    const emptyIdx = [];
    cells.forEach((c, i) => {
      const t = (c.textContent || '').trim();
      if (!t) { empty++; emptyIdx.push(i); }
      else if (t === '?') { q++; emptyIdx.push(i); }
    });
    return { total: cells.length, empty, q, emptyIdx: emptyIdx.slice(0, 10), phase: window.FSM ? window.FSM.phase : 'BASE' };
  });

  const initial = await snap();
  console.log(`  initial: total=${initial.total} empty=${initial.empty} ?=${initial.q}`);

  const actions = [
    async () => frame.evaluate(() => document.getElementById('spinBtn')?.click()),
    async () => frame.evaluate(() => document.getElementById('turboBtn')?.click()),
    async () => frame.evaluate(() => document.querySelector('.ufp-chip[data-ufp-kind="free_spins"]')?.click()),
    async () => frame.evaluate(() => document.querySelector('.ufp-chip[data-ufp-kind="big_win"]')?.click()),
    async () => frame.evaluate(() => document.querySelector('.ufp-chip[data-ufp-kind="cascade"]')?.click()),
    async () => frame.evaluate(() => document.querySelector('.ufp-chip[data-ufp-kind="multiplier"]')?.click()),
    async () => frame.evaluate(() => document.getElementById('bonusBuyBtn')?.click()),
    async () => frame.evaluate(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); }),
    async () => frame.evaluate(() => document.querySelector('#paytableBtn')?.click()),
    async () => frame.evaluate(() => document.querySelector('#settingsBtn, #settingsMenuBtn')?.click()),
  ];

  const dirty = [];
  for (let i = 0; i < 150; i++) {
    const act = actions[Math.floor(Math.random() * actions.length)];
    try { await act(); } catch (e) {}
    await page.waitForTimeout(150 + Math.random() * 400);
    if (i % 10 === 9) {
      // dismiss modals
      await frame.evaluate(() => {
        document.querySelectorAll('.modal-backdrop, [data-modal-backdrop], .bb-backdrop, .autoplay-backdrop, .paytable-backdrop, .settings-backdrop').forEach(el => { try { el.click(); } catch(e){} });
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });
      await page.waitForTimeout(200);
      const s = await snap();
      if (s.empty > 0 || s.q > 0 || s.total !== initial.total) {
        dirty.push({ tick: i + 1, ...s });
        await page.screenshot({ path: `${OUT}/${gdd.name}-dirty-${i+1}.png`, fullPage: false });
      }
    }
  }
  // final settle
  await frame.evaluate(() => {
    document.querySelectorAll('.modal-backdrop, [data-modal-backdrop], .bb-backdrop').forEach(el => { try { el.click(); } catch(e){} });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
  await page.waitForTimeout(4000);
  const final = await snap();
  console.log(`  final after 150 monkey actions: total=${final.total} empty=${final.empty} ?=${final.q} phase=${final.phase}`);
  console.log(`  dirty checkpoints: ${dirty.length}`);
  dirty.slice(0, 6).forEach(d => console.log(`    tick#${d.tick}: cells=${d.total} empty=${d.empty} ?=${d.q} phase=${d.phase} idx=[${d.emptyIdx.join(',')}]`));
  console.log(`  errors: ${errs.length} warns: ${warns.length} pageErrs: ${pageErrs.length}`);
  if (errs.length) writeFileSync(`${OUT}/${gdd.name}-errors.txt`, errs.slice(0, 30).join('\n'));

  await ctx.close();
}

await browser.close();
server.kill('SIGTERM');
await new Promise(r => setTimeout(r, 200));
console.log(`\nDirty screenshots at: ${OUT}`);
