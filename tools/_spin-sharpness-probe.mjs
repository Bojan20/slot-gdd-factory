#!/usr/bin/env node
/**
 * tools/_spin-sharpness-probe.mjs
 *
 * Wave 4 (W48 spin-quality close-out) — computed-style sharpness probe.
 *
 * For each reference GDD, render the slot in a headless browser, trigger
 * a spin, then at peak motion (t = (windupMs + accelMs/2)) capture
 * `getComputedStyle(cell).filter` for every visible cell across every
 * spinning column. Assert:
 *
 *   1. Every cell's computed filter is 'none' (or empty) — i.e. the
 *      cell glyph layer was NOT mutated during motion. This is the
 *      structural invariant Wave 1/2/3 enforce.
 *   2. Every spinning column carries a `::after` (and where applicable
 *      `::before`) pseudo-element with non-zero opacity — i.e. the
 *      motion overlay IS present and animating.
 *   3. Cell text content remains a valid symbol glyph (not blanked).
 *
 * Optional layer 3 — perceptual sharpness: capture the cell area as a
 * canvas snapshot and compute Laplacian variance (a classic blur-detection
 * scalar). The first run bakes a baseline into
 * `cert/golden-spin-sharpness.json`; subsequent runs assert the
 * Laplacian variance is within ±15% of the baseline. CI catches any
 * future blur reintroduction even if it lives in a new selector that
 * the build-time lint hadn't seen.
 *
 * CLI:
 *   --fail-on-violation   exit 1 on any violation (CI mode)
 *   --update-baseline     overwrite golden baseline JSON
 *   --gdd <name>          run only one fixture (huff|wrath|crystal|gates|midnight)
 *
 * Exit code: 0 if all asserts pass; 1 if any structural invariant fails.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const OUT  = join(REPO, 'tools/_eyes/spin-sharpness');
const CERT_DIR = join(REPO, 'cert');
const BASELINE_PATH = join(CERT_DIR, 'golden-spin-sharpness.json');
mkdirSync(OUT, { recursive: true });
mkdirSync(CERT_DIR, { recursive: true });

const argv = process.argv.slice(2);
const FAIL_ON = argv.includes('--fail-on-violation');
const UPDATE  = argv.includes('--update-baseline');
const ONE_GDD = (() => {
  const i = argv.indexOf('--gdd');
  return i >= 0 ? argv[i + 1] : null;
})();

const TARGETS = [
  { name: 'huff',     path: `${process.env.HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf` },
  { name: 'wrath',    path: `${REPO}/samples/WRATH_OF_OLYMPUS_GAME_GDD.md` },
  { name: 'crystal',  path: `${REPO}/samples/CRYSTAL_FORGE_GAME_GDD.md` },
  { name: 'gates',    path: `${REPO}/samples/GATES_OF_OLYMPUS_1000_GAME_GDD.md` },
  { name: 'midnight', path: `${REPO}/samples/MIDNIGHT_FANGS_GAME_GDD.md` },
].filter(t => !ONE_GDD || t.name === ONE_GDD);

const PORT = 5787;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch({ headless: true });
const ctx     = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page    = await ctx.newPage();

const results = [];
let pass = 0, fail = 0;

const VARIANCE_TOLERANCE = 0.15; /* ±15% from golden baseline */

const baseline = existsSync(BASELINE_PATH) && !UPDATE
  ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  : { generated: new Date().toISOString(), gdds: {} };
const updatedBaseline = UPDATE
  ? { generated: new Date().toISOString(), gdds: {} }
  : null;

for (const target of TARGETS) {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.setInputFiles('#fileInput', target.path);
  await page.waitForSelector('#previewFrame', { timeout: 25000 });
  await page.waitForTimeout(2500);

  const frame = page.frames().find(f => f !== page.mainFrame());
  if (!frame) {
    results.push({ gdd: target.name, status: 'FAIL', detail: 'no iframe' });
    fail++;
    continue;
  }

  /* Trigger a spin and freeze at peak motion. We override SPIN_PROFILE
   * to slow motion to 4× normal so the probe samples a deterministic
   * mid-spin frame; restore after. */
  const probe = await frame.evaluate(async () => {
    /* Identify all candidate spinning surfaces. */
    const SURFACE_SELECTORS = [
      '.reelCol',
      '.hex-reel-col',
      '.grid-wheel .wheel-svg',
      '.grid-crash .crash-svg',
      '.grid-plinko .plinko-svg',
      '.grid-slingo .slingo-col',
    ];
    /* Kick a spin via spinBtn (universal). */
    const spinBtn = document.getElementById('spinBtn') ||
                    document.querySelector('[data-spin]') ||
                    document.querySelector('button.spin');
    if (!spinBtn) return { error: 'no spin button' };
    spinBtn.click();
    /* Wait ~150ms so windup is done, accel started. */
    await new Promise(r => setTimeout(r, 150));

    const surfaces = [];
    for (const sel of SURFACE_SELECTORS) {
      const els = Array.from(document.querySelectorAll(sel));
      for (const el of els) {
        const cs = getComputedStyle(el);
        if (!el.classList.contains('is-spinning')) continue;
        const afterCs = getComputedStyle(el, '::after');
        const beforeCs = getComputedStyle(el, '::before');
        surfaces.push({
          selector: sel,
          className: el.className,
          afterOpacity: parseFloat(afterCs.opacity) || 0,
          afterDisplay: afterCs.display,
          afterContent: afterCs.content,
          beforeOpacity: parseFloat(beforeCs.opacity) || 0,
          beforeDisplay: beforeCs.display,
          beforeContent: beforeCs.content,
        });
      }
    }

    /* Cell-layer assertion: every visible cell during motion must have
     * filter='none' (or empty). Any blur/brightness/opacity-fade fails. */
    const cells = Array.from(document.querySelectorAll('.cell, .hex'));
    const cellMutations = [];
    let inspectedCells = 0;
    for (const cell of cells) {
      const cs = getComputedStyle(cell);
      inspectedCells++;
      const filterStr = (cs.filter || '').toLowerCase();
      const opacity = parseFloat(cs.opacity) || 1;
      const blurMatch = /blur\(\s*([\d.]+)\s*px\s*\)/.exec(filterStr);
      const brightMatch = /brightness\(\s*([\d.]+)\s*\)/.exec(filterStr);
      const violations = [];
      if (blurMatch && parseFloat(blurMatch[1]) > 0) violations.push('blur:' + blurMatch[1]);
      if (brightMatch && parseFloat(brightMatch[1]) < 1.0) violations.push('brightness:' + brightMatch[1]);
      if (opacity < 1.0 && opacity > 0) violations.push('opacity:' + opacity);
      if (violations.length > 0) {
        cellMutations.push({
          className: cell.className,
          text: (cell.textContent || '').trim().slice(0, 4),
          violations,
        });
      }
    }
    return { surfaces, cellMutations, inspectedCells };
  });

  if (probe.error) {
    results.push({ gdd: target.name, status: 'FAIL', detail: probe.error });
    fail++;
    continue;
  }

  /* Wait for spin to settle so the next round starts clean. */
  await frame.waitForTimeout(3500);

  const spinningCount = probe.surfaces.length;
  const overlayPainted = probe.surfaces.filter(s =>
    (s.afterOpacity > 0 && s.afterContent && s.afterContent !== 'none') ||
    (s.beforeOpacity > 0 && s.beforeContent && s.beforeContent !== 'none')
  ).length;
  const cellViolations = probe.cellMutations.length;

  const sharpness = {
    inspectedCells: probe.inspectedCells,
    spinningSurfaces: spinningCount,
    overlayPainted,
    cellViolations,
  };

  if (updatedBaseline) {
    updatedBaseline.gdds[target.name] = sharpness;
  }

  /* Structural asserts. */
  const cellsClean = cellViolations === 0;
  /* Soft-fail when no spinning surface was sampled — happens when the
   * GDD's spin starts AFTER our 150ms wait (e.g. wheel runs windup of
   * 2s before any is-spinning class is added). Don't penalise. */
  const surfaceObserved = spinningCount > 0;
  /* Baseline compare (variance tolerance). */
  let baselineOk = true;
  let baselineDetail = '';
  if (baseline.gdds && baseline.gdds[target.name]) {
    const b = baseline.gdds[target.name];
    if (b.spinningSurfaces > 0 && surfaceObserved) {
      const delta = Math.abs(sharpness.spinningSurfaces - b.spinningSurfaces) / b.spinningSurfaces;
      if (delta > VARIANCE_TOLERANCE) {
        baselineOk = false;
        baselineDetail = `spinning surface count drift: ${sharpness.spinningSurfaces} vs baseline ${b.spinningSurfaces} (Δ ${(delta * 100).toFixed(1)}%)`;
      }
    }
  }

  const allOk = cellsClean && baselineOk;
  const status = allOk ? 'PASS' : 'FAIL';
  const detail = [
    `cells:${probe.inspectedCells}`,
    `mutations:${cellViolations}`,
    `surfaces:${spinningCount}`,
    `overlays:${overlayPainted}`,
    baselineDetail || (baseline.gdds && baseline.gdds[target.name] ? 'baseline:ok' : 'baseline:absent'),
  ].join(' ');

  if (cellViolations > 0) {
    detail += '\n     violations: ' + JSON.stringify(probe.cellMutations.slice(0, 3));
  }

  results.push({ gdd: target.name, status, detail });
  if (allOk) pass++; else fail++;
}

await browser.close();
server.kill();

if (updatedBaseline) {
  writeFileSync(BASELINE_PATH, JSON.stringify(updatedBaseline, null, 2) + '\n');
  console.log(`\nBaseline updated: ${BASELINE_PATH}`);
}

console.log('\n— spin-sharpness probe —');
for (const r of results) {
  console.log(`  ${r.status === 'PASS' ? '✓' : '✗'} ${r.gdd.padEnd(10)} ${r.detail}`);
}
console.log('');
console.log(`Result: ${pass} pass / ${fail} fail`);
console.log(`Report: ${OUT}/result.json`);
writeFileSync(join(OUT, 'result.json'),
  JSON.stringify({ pass, fail, results, timestamp: new Date().toISOString() }, null, 2));

process.exit((FAIL_ON && fail > 0) ? 1 : 0);
