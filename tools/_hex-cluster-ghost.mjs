#!/usr/bin/env node
/**
 * tools/_hex-cluster-ghost.mjs
 *
 * Walker pokazao 37 ghost cells na hexagonal, 8 na cluster + gates.
 * Razlog nije tumble (već fix-ovan). Da nadjem novi root cause.
 *
 * Hvata svaku ghost ćeliju sa svim CSS klasama + computed style + stack
 * trace mutatora.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const OUT  = `${REPO}/tools/_eyes/hex-cluster-ghost`;
mkdirSync(OUT, { recursive: true });
const HOME = process.env.HOME;

const TARGETS = [
  { label: 'hexagonal',  file: `${REPO}/samples/grids/06_hexagonal_GAME_GDD.md` },
  { label: 'cluster7x7', file: `${REPO}/samples/grids/03_cluster_7x7_GAME_GDD.md` },
  { label: 'gates',      file: `${HOME}/Desktop/GDD/Gates_of_Olympus_1000_GDD.pdf` },
];

const PORT = 5268;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

const browser = await chromium.launch({ headless: true });

async function probe(label, file) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGE: '+e));
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.waitForSelector('#fileInput', { state: 'attached', timeout: 10000 });
  await page.setInputFiles('#fileInput', file);
  await page.waitForSelector('#previewFrame', { timeout: 25000 });
  await page.waitForTimeout(3000);
  const frame = page.frames().find(f => f !== page.mainFrame());

  await frame.evaluate(() => {
    window.__GHOST = { samples: [], peakGhost: 0, peakGhostDetail: null };
    setInterval(() => {
      const cells = Array.from(document.querySelectorAll('.cell'));
      const ghosts = [];
      cells.forEach((c, i) => {
        const cs = getComputedStyle(c);
        const op = parseFloat(cs.opacity) || 0;
        const tr = cs.transform || 'none';
        const m = tr.match(/matrix\(([^)]+)\)/);
        const sx = m ? parseFloat(m[1].split(',')[0]) : 1;
        const txt = (c.textContent || '').trim();
        if ((op < 0.1 || sx < 0.5) && cs.visibility === 'visible' && cs.display !== 'none') {
          ghosts.push({
            idx: i,
            op: op.toFixed(2),
            sx: sx.toFixed(2),
            txt: txt.slice(0, 8),
            classes: Array.from(c.classList).join(' '),
            parentClasses: c.parentElement ? Array.from(c.parentElement.classList).join(' ') : '',
            visible: cs.visibility,
            display: cs.display,
          });
        }
      });
      if (ghosts.length > window.__GHOST.peakGhost) {
        window.__GHOST.peakGhost = ghosts.length;
        window.__GHOST.peakGhostDetail = {
          t: Date.now(),
          phase: window.FSM ? window.FSM.phase : '?',
          ghosts: ghosts.slice(0, 10),
        };
      }
    }, 100);
  });

  const cfg = await frame.evaluate(() => ({
    shape: window.SHAPE && { kind: window.SHAPE.kind, evaluation: window.SHAPE.evaluation },
    cellCount: document.querySelectorAll('.cell').length,
  }));
  console.log(`  ${label}: ${cfg.shape && cfg.shape.kind} (${cfg.cellCount} cells)`);

  // 15 spinova
  for (let i = 0; i < 15; i++) {
    for (let j = 0; j < 40; j++) {
      const ok = await frame.evaluate(() => {
        const b = document.getElementById('spinBtn');
        const ph = window.FSM ? window.FSM.phase : 'BASE';
        return b && !b.disabled && !b.classList.contains('is-spinning') && ph === 'BASE' && !window.__SLOT_WIN_PRESENT_ACTIVE__;
      });
      if (ok) break;
      await page.waitForTimeout(120);
    }
    await frame.evaluate(() => document.getElementById('spinBtn')?.click());
    await page.waitForTimeout(2000);
  }

  const result = await frame.evaluate(() => window.__GHOST);
  await page.close();
  await ctx.close();
  return { label, cfg, result, errs };
}

for (const t of TARGETS) {
  console.log(`\n── ${t.label} ──`);
  const r = await probe(t.label, t.file);
  console.log(`  peak ghost cells: ${r.result.peakGhost}`);
  if (r.result.peakGhostDetail) {
    console.log(`  phase at peak: ${r.result.peakGhostDetail.phase}`);
    r.result.peakGhostDetail.ghosts.forEach(g => {
      console.log(`    idx=${g.idx} op=${g.op} sx=${g.sx} txt="${g.txt}" classes="${g.classes}" parent="${g.parentClasses}"`);
    });
  }
  console.log(`  errors: ${r.errs.length}`);
  writeFileSync(`${OUT}/${t.label}.json`, JSON.stringify(r, null, 2));
}

await browser.close();
server.kill('SIGTERM');
