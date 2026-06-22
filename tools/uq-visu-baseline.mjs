#!/usr/bin/env node
/**
 * tools/uq-visu-baseline.mjs
 *
 * UQ-VISU (MASTER_TODO P1) — Pixel-level visual regression.
 *
 * Bakes a PNG screenshot baseline for a stable subset of GDD slot HTMLs
 * and uses `pixelmatch` to detect drift over time. Default tolerance
 * 0.5% per pixel + 1% total drift budget.
 *
 * USAGE
 *   node tools/uq-visu-baseline.mjs --bake          # capture baseline
 *   node tools/uq-visu-baseline.mjs                 # compare (gate)
 *   node tools/uq-visu-baseline.mjs --limit N       # subset
 *
 * STORAGE
 *   tests/baselines/visu/<slug>.png      pre-baked baseline
 *   reports/_uq-visu/<slug>.diff.png    drift artifact (FAIL only)
 *
 * EXIT 0 = within tolerance; 1 = any slug exceeds 1% drift.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const BASELINE_DIR = resolve(REPO, 'tests/baselines/visu');
const OUT_DIR      = resolve(REPO, 'reports/_uq-visu');
const DIST         = resolve(REPO, 'dist/real-games');
mkdirSync(BASELINE_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const args = process.argv.slice(2);
const BAKE  = args.includes('--bake');
const argVal = (flag) => {
  const a = args.find(x => x === flag || x.startsWith(flag + '='));
  return a ? (a.includes('=') ? a.split('=')[1] : args[args.indexOf(a) + 1]) : null;
};
const LIMIT = argVal('--limit') ? parseInt(argVal('--limit'), 10) : null;

const FIVE_MAIN = [
  'cash-eruption-foundry-gdd', 'gates-of-olympus-1000-gdd',
  'huff-n-more-puff-gdd', 'starlight-travellers-gdd', 'wrath-of-olympus-gdd',
];
/* Sample 60 GDD-ova covering grid varieties: 5 main + 55 synth sample
 * deterministic (every Nth slug alphabetically). */
function pickSlugs() {
  const all = readdirSync(DIST).filter(d => {
    const p = join(DIST, d, 'slot.html');
    return statSync(join(DIST, d)).isDirectory() && existsSync(p);
  });
  const slugs = [...FIVE_MAIN];
  const synth = all.filter(s => !FIVE_MAIN.includes(s)).sort();
  const step = Math.max(1, Math.floor(synth.length / 55));
  for (let i = 0; i < synth.length && slugs.length < 60; i += step) {
    slugs.push(synth[i]);
  }
  return LIMIT ? slugs.slice(0, LIMIT) : slugs;
}

const slugs = pickSlugs();
const PORT = 5380 + Math.floor(Math.random() * 100);
const srv = spawn('python3', ['-m', 'http.server', String(PORT)],
                  { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));
const browser = await chromium.launch({ headless: true });

const VIEWPORT = { width: 1280, height: 800 };
async function capture(slug) {
  const url = `http://127.0.0.1:${PORT}/dist/real-games/${slug}/slot.html`;
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('#spinBtn', { timeout: 8000 });
  await page.waitForTimeout(800);  // settle CSS animations
  /* Freeze any tickers so PNG is deterministic. */
  await page.evaluate(() => {
    document.body.classList.add('uq-visu-freeze');
    if (window.requestAnimationFrame) {
      window.requestAnimationFrame = () => 0;
    }
  });
  await page.waitForTimeout(150);
  const buf = await page.screenshot({ type: 'png', fullPage: false });
  await ctx.close();
  return buf;
}

const TOL_PER_PIXEL = 0.05;     /* pixelmatch threshold per-pixel */
const MAX_DRIFT_PCT = 1.0;       /* per-slug ceiling */

let bake = 0, pass = 0, fail = 0, missing = 0;
const failures = [];
console.log(`\n📸 UQ-VISU visual regression — ${slugs.length} slugs${BAKE ? ' (BAKE mode)' : ''}\n`);

for (const slug of slugs) {
  const baselinePath = join(BASELINE_DIR, slug + '.png');
  process.stdout.write(`  ${slug.padEnd(40)} … `);
  try {
    const buf = await capture(slug);
    if (BAKE) {
      writeFileSync(baselinePath, buf);
      console.log('✓ baked');
      bake++;
      continue;
    }
    if (!existsSync(baselinePath)) {
      console.log('— missing baseline (run --bake)');
      missing++;
      continue;
    }
    const a = PNG.sync.read(readFileSync(baselinePath));
    const b = PNG.sync.read(buf);
    if (a.width !== b.width || a.height !== b.height) {
      console.log(`✗ FAIL — dim mismatch ${a.width}×${a.height} vs ${b.width}×${b.height}`);
      fail++;
      failures.push({ slug, reason: 'dimensions' });
      continue;
    }
    const diff = new PNG({ width: a.width, height: a.height });
    const pixDiff = pixelmatch(a.data, b.data, diff.data, a.width, a.height,
                                { threshold: TOL_PER_PIXEL });
    const pct = (pixDiff / (a.width * a.height)) * 100;
    if (pct > MAX_DRIFT_PCT) {
      writeFileSync(join(OUT_DIR, slug + '.diff.png'), PNG.sync.write(diff));
      console.log(`✗ FAIL — ${pct.toFixed(3)}% drift > ${MAX_DRIFT_PCT}%`);
      fail++;
      failures.push({ slug, pct: pct.toFixed(3) });
    } else {
      console.log(`✓ PASS (${pct.toFixed(3)}%)`);
      pass++;
    }
  } catch (e) {
    console.log(`✗ ERROR ${(e.message || e).slice(0, 80)}`);
    fail++;
  }
}

await browser.close();
try { srv.kill(); } catch {}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if (BAKE) {
  console.log(`✓ BAKED ${bake} baselines → ${BASELINE_DIR}`);
} else {
  console.log(`✓ PASS ${pass} · ✗ FAIL ${fail} · — missing ${missing} / Σ ${slugs.length}`);
  if (fail > 0) {
    for (const f of failures.slice(0, 10)) console.log(`    ${f.slug} ${f.reason || f.pct + '% drift'}`);
  }
}
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

process.exit(fail === 0 ? 0 : 1);
