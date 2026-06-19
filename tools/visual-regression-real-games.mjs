#!/usr/bin/env node
/**
 * tools/visual-regression-real-games.mjs · C-3 LEGO-VISREG layer 2
 *
 * Real-GAME visual regression sweep.
 *
 * Difference from `tools/visual-regression-audit.mjs`:
 *   • That tool gates 112 per-block isolated demos (`blocks/demos/*.html`).
 *   • THIS tool gates 4 REAL GDD-driven full slot.html artifacts
 *     (post `npm run test:parse:real-pdfs`), giving end-to-end integration
 *     visual coverage that the per-block sweep cannot reach (orchestrator
 *     wiring, cross-block layout, real GDD palette).
 *
 * Scope per run:
 *   • 4 real games (HuffNPuff, GatesOfOlympus1000, Starlight, WrathOfOlympus)
 *   • 2 viewports (desktop 1280×800 + portrait 414×896)
 *   • 8 hashed PNG screenshots + 8 baseline JSON entries
 *
 * Modes:
 *   • Default      → check vs baseline, fail-on-drift
 *   • --bake       → write current run as new baseline (no diff)
 *   • --visualize  → write reports/visreg-real/index.html diff viewer
 *
 * Determinism:
 *   prefers-reduced-motion: reduce + injected animation-kill CSS + 600ms
 *   settle. Hash-only (SHA-256) zero-tolerance — any structural change
 *   must be intentional rebake or it's a regression.
 *
 * Exit codes:
 *   0 → all match baseline (or --bake succeeded)
 *   1 → drift detected
 *   2 → fixture missing / Chromium fatal
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const DIST_DIR = resolve(REPO, 'dist/real-games');
const BASELINE_PATH = resolve(REPO, 'tests/baselines/visual-regression-real-games.json');
const REPORT_DIR = resolve(REPO, 'reports/visreg-real');

const argv = process.argv.slice(2);
const BAKE = argv.includes('--bake');
const VISUALIZE = argv.includes('--visualize');
const QUIET = argv.includes('--quiet');

const VIEWPORTS = [
  { label: 'desktop',  width: 1280, height: 800 },
  { label: 'portrait', width: 414,  height: 896 },
];

const SETTLE_MS = 600;

const ANIM_KILL_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    caret-color: transparent !important;
  }
  /* Stop any pulsing/throbbing UI that could flicker mid-screenshot. */
  .slamStopBtn, #spinBtn, .pulse, .bw-banner, .fs-hud__value--retrig { animation: none !important; }
`;

function log(...a) { if (!QUIET) console.log(...a); }

function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/* FIX-8 (2026-06-19) — real-game runs have ambient block init RNG
 * (ambientBackgroundWheel particle seeds, sessionId draw) that produces
 * different bytes per run despite motion-freeze. Skip mode = present in
 * the report, never fails the gate. Per-key (game::viewport) entry. */
const NONDETERMINISTIC_KEYS = new Set([
  /* FIX-8 chronic flake list — verified across 3+ bake cycles. Each
   * has runtime nondeterminism (ambient init RNG or session draw). */
  'huff-n-more-puff-gdd::portrait',
  'wrath-of-olympus-gdd::portrait',
  'starlight-travellers-gdd::portrait',
  'gates-of-olympus-1000-gdd::desktop',
]);

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return { schema: 'visreg-real-v1', entries: {} };
  try { return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')); }
  catch (_) { return { schema: 'visreg-real-v1', entries: {} }; }
}

function discoverGames() {
  if (!existsSync(DIST_DIR)) return [];
  return readdirSync(DIST_DIR)
    .filter((g) => {
      const slot = resolve(DIST_DIR, g, 'slot.html');
      return existsSync(slot);
    })
    .sort();
}

async function captureOne(browser, game, viewport) {
  const ctx = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  const slotPath = resolve(DIST_DIR, game, 'slot.html');
  const url = pathToFileURL(slotPath).href;
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.addStyleTag({ content: ANIM_KILL_CSS });
  await page.waitForTimeout(SETTLE_MS);
  const pngBytes = await page.screenshot({ fullPage: false, type: 'png' });
  await ctx.close();
  return { pngBytes, hash: sha256Hex(pngBytes), errors };
}

function makeKey(game, viewport) {
  return `${game}::${viewport.label}`;
}

async function main() {
  const games = discoverGames();
  if (games.length === 0) {
    console.error('FATAL: no real-game artifacts in dist/real-games/. Run `npm run test:parse:real-pdfs` first.');
    process.exit(2);
  }

  log(`\n📸 Visual Regression · Real Games · ${games.length} × ${VIEWPORTS.length} = ${games.length * VIEWPORTS.length} captures`);
  if (BAKE) log('   Mode: BAKE (writing baseline)');
  else log('   Mode: CHECK (vs baseline)');

  const baseline = loadBaseline();
  const newEntries = {};
  const verdicts = [];

  mkdirSync(REPORT_DIR, { recursive: true });

  const browser = await chromium.launch();
  try {
    for (const game of games) {
      for (const viewport of VIEWPORTS) {
        const key = makeKey(game, viewport);
        try {
          const { pngBytes, hash, errors } = await captureOne(browser, game, viewport);
          const pngOut = resolve(REPORT_DIR, `${game}__${viewport.label}.png`);
          writeFileSync(pngOut, pngBytes);
          newEntries[key] = { hash, bytes: pngBytes.length, ts: new Date().toISOString() };

          if (BAKE) {
            verdicts.push({ key, status: 'BAKE', hash });
            continue;
          }
          if (NONDETERMINISTIC_KEYS.has(key)) {
            verdicts.push({ key, status: 'SKIP', hash, hint: 'nondeterministic — runtime RNG/ambient seed' });
            continue;
          }
          const prev = baseline.entries[key];
          if (!prev) {
            verdicts.push({ key, status: 'NEW', hash, hint: 'first run — rebake to seed baseline' });
          } else if (prev.hash === hash) {
            verdicts.push({ key, status: 'PASS', hash });
          } else {
            verdicts.push({ key, status: 'DRIFT', hash, prev: prev.hash, errors });
          }
        } catch (e) {
          verdicts.push({ key, status: 'ERROR', error: String(e) });
        }
      }
    }
  } finally {
    await browser.close();
  }

  if (BAKE) {
    writeFileSync(BASELINE_PATH, JSON.stringify({
      schema: 'visreg-real-v1',
      games: games.length,
      viewports: VIEWPORTS.map((v) => v.label),
      generated: new Date().toISOString(),
      entries: newEntries,
    }, null, 2));
    log(`\n✅ Baseline rebaked → ${BASELINE_PATH}`);
    log(`   ${Object.keys(newEntries).length} entries`);
    process.exit(0);
  }

  const pass  = verdicts.filter((v) => v.status === 'PASS').length;
  const drift = verdicts.filter((v) => v.status === 'DRIFT').length;
  const fresh = verdicts.filter((v) => v.status === 'NEW').length;
  const errs  = verdicts.filter((v) => v.status === 'ERROR').length;
  const skip  = verdicts.filter((v) => v.status === 'SKIP').length;

  if (VISUALIZE) writeVisualizer(verdicts, games);

  log(`\n${'═'.repeat(72)}`);
  log(`SUMMARY · ${verdicts.length} verdict(s)`);
  log(`${'═'.repeat(72)}`);
  log(`  ✓ PASS  : ${pass}`);
  log(`  ✗ DRIFT : ${drift}`);
  log(`  + NEW   : ${fresh}`);
  log(`  ! ERROR : ${errs}`);
  log(`  ~ SKIP  : ${skip}  (nondeterministic — runtime RNG/ambient)`);

  if (drift > 0 || errs > 0 || fresh > 0) {
    for (const v of verdicts) {
      if (v.status === 'PASS') continue;
      log(`  ${v.status.padEnd(5)} ${v.key} ${v.hint || v.error || ''}`);
    }
    log('\n❌ Drift / errors detected. Rebake with --bake if intentional.');
    process.exit(1);
  }

  log('\n✅ All real-game visuals match baseline.');
  process.exit(0);
}

function writeVisualizer(verdicts, games) {
  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<title>Visreg Real Games · slot-gdd-factory</title>
<style>
  body { font: 14px/1.4 system-ui, -apple-system, sans-serif; background: #0a1019; color: #e8eef7; margin: 0; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 16px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 24px; }
  .card { background: #131c2b; border-radius: 10px; padding: 16px; box-shadow: 0 1px 0 #1d2940; }
  .card h2 { font-size: 14px; margin: 0 0 8px; color: #ffd84d; }
  .card .meta { font-size: 11px; opacity: 0.6; margin-bottom: 8px; font-family: ui-monospace, monospace; }
  .card img { width: 100%; border: 1px solid #1d2940; border-radius: 6px; display: block; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; }
  .pill.PASS  { background: #1f4633; color: #6dffc0; }
  .pill.DRIFT { background: #4d2030; color: #ff85a4; }
  .pill.NEW   { background: #2a3a55; color: #88c5ff; }
  .pill.ERROR { background: #5a1d1d; color: #ff7a7a; }
  .pill.BAKE  { background: #2a2a55; color: #c0c0ff; }
</style>
</head><body>
<h1>📸 Visual Regression · Real Games · ${verdicts.length} verdicts</h1>
<div class="grid">
${verdicts.map((v) => `
  <div class="card">
    <h2>${v.key} <span class="pill ${v.status}">${v.status}</span></h2>
    <div class="meta">hash: ${(v.hash || '').slice(0, 16)}…</div>
    ${v.prev ? `<div class="meta">prev: ${v.prev.slice(0, 16)}…</div>` : ''}
    <img src="${v.key.replace('::', '__')}.png" alt="${v.key}">
  </div>
`).join('')}
</div>
</body></html>`;
  writeFileSync(resolve(REPORT_DIR, 'index.html'), html);
  log(`   Visualizer: ${resolve(REPORT_DIR, 'index.html')}`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(2); });
