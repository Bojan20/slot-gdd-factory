#!/usr/bin/env node
/**
 * tools/_cell-content-stress.mjs
 *
 * Boki bug: "nestaju ćelije, tj simboli posle nekoliko spinova"
 * Hypothesis: .cell DOM stays, ali textContent postane '' (tumble gravity
 * leaves blanks if refill races). Testiram tako što POSLE SVAKOG spina
 * brojim koliko ćelija ima neprazan textContent.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const HOME = process.env.HOME;
const GDDS = [
  { name: 'Huff',      path: `${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf` },
  { name: 'Starlight', path: `${HOME}/Desktop/GDD/Starlight_Travellers_GDD.pdf` },
];

const PORT = 5239;
const URL  = `http://127.0.0.1:${PORT}/`;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch({ headless: true });

for (const gdd of GDDS) {
  if (!existsSync(gdd.path)) { console.log(`SKIP ${gdd.name}`); continue; }
  console.log(`\n═══ ${gdd.name} ═══`);
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'load' });
  await (await page.$('#fileInput')).setInputFiles(gdd.path);
  await page.waitForSelector('#previewFrame', { timeout: 15000 });
  await page.waitForTimeout(1200);
  const frame = page.frames().find(f => f !== page.mainFrame());

  const snap = async () => frame.evaluate(() => {
    const cells = document.querySelectorAll('.cell');
    let empty = 0, blank = 0, question = 0;
    const empties = [];
    cells.forEach((c, i) => {
      const t = (c.textContent || '').trim();
      if (!t) { empty++; empties.push(i); }
      else if (t === '?') question++;
      else if (t === '' || t === ' ') blank++;
    });
    return { total: cells.length, empty, blank, question, empties: empties.slice(0, 8) };
  });

  const initial = await snap();
  console.log(`  initial: total=${initial.total} empty=${initial.empty} ?=${initial.question}`);
  if (initial.empty > 0 || initial.question > 0) console.log(`    ⚠ initial empties: ${initial.empties.join(',')}`);

  // RAPID spins — only wait ~600ms (less than full ~3s spin), like a button-masher Boki
  const issues = [];
  for (let i = 0; i < 30; i++) {
    await frame.evaluate(() => document.getElementById('spinBtn')?.click());
    // brief wait — simulating rapid clicks
    await page.waitForTimeout(600 + Math.random() * 400);
    const st = await snap();
    if (st.empty > 0 || st.question > 0) {
      issues.push({ spin: i + 1, ...st });
    }
  }
  // Final wait for everything to settle
  await page.waitForTimeout(2000);
  const final = await snap();
  console.log(`  after 30 rapid spins → final: total=${final.total} empty=${final.empty} ?=${final.question}`);
  if (issues.length) {
    console.log(`  ✗ ${issues.length}/30 spins showed empty/? cells`);
    issues.slice(0, 5).forEach(x => console.log(`    spin#${x.spin}: empty=${x.empty} ?=${x.question} indexes=[${x.empties.join(',')}]`));
  } else {
    console.log(`  ✓ no empty cells across 30 rapid spins`);
  }

  // Now force CASCADE chip and stress
  console.log('  — cascade force + 10 rapid spins —');
  await frame.evaluate(() => {
    const c = document.querySelector('.ufp-chip[data-ufp-kind="cascade"]');
    if (c) c.click();
  });
  await page.waitForTimeout(300);
  const cascadeIssues = [];
  for (let i = 0; i < 10; i++) {
    await frame.evaluate(() => document.getElementById('spinBtn')?.click());
    await page.waitForTimeout(700);
    const st = await snap();
    if (st.empty > 0 || st.question > 0) cascadeIssues.push({ spin: i+1, ...st });
  }
  await page.waitForTimeout(2000);
  if (cascadeIssues.length) {
    console.log(`  ✗ cascade: ${cascadeIssues.length}/10 spins showed empty`);
    cascadeIssues.slice(0, 3).forEach(x => console.log(`    spin#${x.spin}: empty=${x.empty} ?=${x.question} indexes=[${x.empties.join(',')}]`));
  } else {
    console.log(`  ✓ cascade: no empty cells`);
  }

  await ctx.close();
}

await browser.close();
server.kill('SIGTERM');
await new Promise(r => setTimeout(r, 200));
