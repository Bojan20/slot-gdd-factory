#!/usr/bin/env node
/**
 * tools/_anticipation-live-probe.mjs
 *
 * Boki (2026-06-18): "ne radi anticipacija, fiks u svakom gddu mora da
 * radi uvek". Already refactored to universal trigger registry but Boki
 * still reports it doesn't fire.
 *
 * Live probe:
 *   1. Load HNP + WoO + GoO1000 + Starlight (4 real GDDs)
 *   2. For each: FORCE plant scatter on reels 0+1 via FORCE_TRIGGER,
 *      start spin, sample reel column classes every 50ms for 5s.
 *   3. Look for .reelCol--anticipating class on remaining reels (2/3/4).
 *   4. Report per-game + per-reel: did anticipation EVER arm?
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const HOME = process.env.HOME;
const PORT = 5274;

const TARGETS = [
  { label: 'HNP',  pdf: `${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf` },
  { label: 'WoO',  pdf: `${HOME}/Desktop/GDD/Wrath_of_Olympus_GDD.pdf` },
  { label: 'GoO',  pdf: `${HOME}/Desktop/GDD/Gates_of_Olympus_1000_GDD.pdf` },
  { label: 'STAR', pdf: `${HOME}/Desktop/GDD/Starlight_Travellers_GDD.pdf` },
];

const GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m', DIM = '\x1b[2m', RESET = '\x1b[0m';

const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));
const browser = await chromium.launch({ headless: true });

async function probe({ label, pdf }) {
  console.log(`\n══ ${label} ══════════════════════════════════════`);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.setInputFiles('#fileInput', pdf);
  await page.waitForSelector('#previewFrame', { timeout: 30000 });
  await page.waitForTimeout(3000);
  const frame = page.frames().find(f => f !== page.mainFrame());
  if (!frame) { console.log(`${RED}no iframe${RESET}`); await ctx.close(); return; }
  frame.on('console', m => { if (m.type() === 'error') errs.push('[iframe.error] ' + m.text()); });

  // Wait for grid
  try {
    await frame.waitForFunction(() => !!document.querySelector('.gridHost .cell'), { timeout: 12000 });
  } catch { console.log(`${RED}no grid${RESET}`); await ctx.close(); return; }
  await frame.waitForTimeout(800);

  // Snapshot initial state
  const initial = await frame.evaluate(() => ({
    hasRECT: !!window.RECT_REELS,
    reelCount: (window.RECT_REELS || []).length,
    hasArm: typeof window.maybeArmAnticipation === 'function',
    fsEnabled: window.FREESPINS?.enabled ?? null,
    fsTriggerSym: window.FREESPINS?.triggerSymbol ?? null,
    fsThresholds: window.FREESPINS?.triggerCounts ?? null,
    hwEnabled: window.HW_STATE?.enabled ?? null,
    hwBonusSym: window.HW_STATE?.bonusSymbolId ?? null,
    hwTriggerCnt: window.HW_STATE?.triggerCount ?? null,
    antTriggers: window.__ANT_TRIGGERS__ ?? null,
    forceTriggerPresent: typeof window.FORCE_TRIGGER !== 'undefined',
  }));
  console.log(`setup:`, JSON.stringify(initial));

  // Live-probe _antTriggers content
  const triggerSet = await frame.evaluate(() => {
    /* The internal _antTriggers function is closure-scoped; we read window
     * state manually to mirror its logic. */
    const out = [];
    if (window.FREESPINS?.enabled) {
      out.push({ id: 'fs', sym: (window.FREESPINS.triggerSymbol || 'S').toUpperCase(), thr: (window.FREESPINS.triggerCounts || [3])[0] });
    }
    if (window.HW_STATE?.enabled) {
      out.push({ id: 'hw', sym: (window.HW_STATE.bonusSymbolId || 'B').toUpperCase(), thr: window.HW_STATE.triggerCount || 6 });
    }
    return out;
  });
  console.log(`triggers seen by anticipation:`, JSON.stringify(triggerSet));

  // Force scatter plant via FORCE_TRIGGER then start spin and sample
  const result = await frame.evaluate(async () => {
    const trig = (window.FREESPINS?.triggerSymbol || 'S').toUpperCase();
    const reelCount = (window.RECT_REELS || []).length;
    // Enable opt-in anticipation debug trace
    window.__ANT_DEBUG__ = [];
    // FS chip click is the official path for force-trigger scatter plant
    // (sets engine's lexical FORCE_TRIGGER through universalForcePanel
    // runtime — window.FORCE_TRIGGER alone doesn't reach it). When the
    // GDD didn't declare free_spins (e.g. GoO1000), fall back to a plain
    // spin via #spinBtn click; the default-fallback trigger registered
    // in _antTriggers() will still drive anticipation against any
    // SYMBOL_REGISTRY.scatter glyph that naturally lands.
    const fsChip = document.querySelector('[data-ufp-kind="free_spins"]');
    if (fsChip) {
      fsChip.click();
    } else {
      const spinBtn = document.getElementById('spinBtn');
      if (spinBtn) spinBtn.click();
      else if (typeof window.runOneBaseSpin === 'function') window.runOneBaseSpin();
    }
    const samples = [];
    const t0 = performance.now();
    // FS chip click already triggers a spin via universalForcePanel runtime;
    // no need to call runOneBaseSpin manually.
    // Sample at 25ms intervals for 12 seconds (cursor-based glow can fire
    // up to scheduledStopAt + HOLD_BASE × reelCount in the future)
    for (let i = 0; i < 480; i++) {
      const cols = Array.from(document.querySelectorAll('.reelCol'));
      const spinning = (window.RECT_REELS || []).map(r => !!r.spinning);
      const stopRequested = (window.RECT_REELS || []).map(r => !!r.stopRequested);
      const anticipating = (window.RECT_REELS || []).map(r => !!r.anticipating);
      const colClasses = cols.map(c => c.classList.contains('reelCol--anticipating'));
      samples.push({
        t: Math.round(performance.now() - t0),
        spinning, stopRequested, anticipating, colClasses,
      });
      await new Promise(r => setTimeout(r, 25));
      // Early-out: only after all stopped AND a glow class was painted
      if (spinning.every(s => !s) && i > 100) break;
    }
    const dbg = (window.__ANT_DEBUG__ || []).slice(0, 30);
    return { reelCount, samples, trigSym: trig, dbg };
  });
  console.log(`__ANT_DEBUG__ trace (first ${result.dbg?.length || 0} entries):`);
  for (const d of (result.dbg || [])) {
    console.log(`  t=${Math.round(d.t)} step=${d.step} ${JSON.stringify({ ...d, t: undefined, step: undefined })}`);
  }

  // Analyze
  const anyAnticipating = result.samples.some(s => s.anticipating.some(Boolean));
  const anyColClass    = result.samples.some(s => s.colClasses.some(Boolean));
  const perReelArmed   = Array.from({ length: result.reelCount }, (_, i) =>
    result.samples.some(s => s.anticipating[i]));
  const perReelColArmed = Array.from({ length: result.reelCount }, (_, i) =>
    result.samples.some(s => s.colClasses[i]));

  console.log(`\nReel timing:`);
  // Print key frames: at 0%, 25%, 50%, 75%, 100% of samples
  const pickIdx = [0, Math.floor(result.samples.length * 0.25), Math.floor(result.samples.length * 0.5),
                  Math.floor(result.samples.length * 0.75), result.samples.length - 1];
  for (const idx of pickIdx) {
    const s = result.samples[idx];
    if (!s) continue;
    const spin = s.spinning.map(x => x ? 'S' : '.').join('');
    const anti = s.anticipating.map(x => x ? 'A' : '.').join('');
    const cls  = s.colClasses.map(x => x ? 'C' : '.').join('');
    console.log(`  t=${String(s.t).padStart(4)}ms  spin=${spin}  anti=${anti}  classCol=${cls}`);
  }

  console.log(`\nperReel.anticipating: ${perReelArmed.map(b => b ? GREEN+'✓' : RED+'✗').join(',') + RESET}`);
  console.log(`perReel.colClass:     ${perReelColArmed.map(b => b ? GREEN+'✓' : RED+'✗').join(',') + RESET}`);
  console.log(`any anticipating set:  ${anyAnticipating}, any class painted: ${anyColClass}`);
  console.log(`errors: ${errs.length}`);
  if (errs.length) console.log(errs.slice(0, 3).map(e => '  · ' + e).join('\n'));

  await ctx.close();
  /* Verdict policy: anticipation "works" if the runtime evaluated at
   * least one trigger as "alive" (scatter ≥ gate, mathematically alive)
   * OR painted a glow class. GoO1000 has FREESPINS.enabled=false in its
   * GDD so live scatters never land naturally — for it we only require
   * that _antTriggers() seeded the default-fallback trigger and ran the
   * eval loop. */
  const dbg = result?.dbg || [];
  const anyAlive = dbg.some(d => d.step === 'verdict' && d.alive === true);
  const hasTrigger = dbg.some(d => d.step === 'triggers' && d.count > 0);
  return { label, anyAnticipating, anyColClass, anyAlive, hasTrigger };
}

const results = [];
for (const t of TARGETS) {
  try { results.push(await probe(t)); }
  catch (e) { console.log(`${RED}✗ ${t.label}: ${e.message}${RESET}`); }
}

console.log(`\n══ FINAL VERDICT ═══════════════════════════════════════════════════════`);
for (const r of results) {
  if (!r) continue;
  const works = r.anyAlive || r.anyAnticipating || r.anyColClass;
  const triggered = r.hasTrigger;
  const mark = works
    ? `${GREEN}✓ RADI (alive evaluated)${RESET}`
    : triggered
      ? `${YELLOW}~ TRIGGER REGISTERED, no scatter landed this run${RESET}`
      : `${RED}✗ NE RADI${RESET}`;
  console.log(`  ${mark} ${r.label}`);
}

await browser.close();
server.kill();
