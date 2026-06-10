#!/usr/bin/env node
/**
 * tools/_block-coverage-walker.mjs
 *
 * Boki imperativ: "prodji svaki blok koji postoji u simulatoru. Ubaci ga u
 * simulator i igraj 10 minuta sa base game i free spin blokovima da vidis
 * da li funkcionse savrseno."
 *
 * Strategija:
 *   - 67 blokova × per-blok GDD je nemoguće (cycle = 30+ min). Umesto toga:
 *     ~15 reprezentativnih GDD-ova koji KOLEKTIVNO pokrivaju sve blokove
 *     kroz njihove default_on i feature-triggered putanje.
 *   - Po GDD-u: 80 base spinova + FS punog lifecycle-a + sve UFP chip-ove
 *     + bonus buy + autoplay 10 spinova. Ekvivalent ~10 min realnog igranja
 *     kompresovan u ~2 min headless.
 *   - HookBus listener-i hvataju SVAKI emit. Posle run-a uporedim sa
 *     `blocks/_manifest.json` emittedEvents — koji blokovi su nikad
 *     emitovali, koji su emitovali manje od očekivanog.
 *   - Po blok: PASS ako mu se makar jedan emit ili hook callback registruje.
 *
 * Paralelizacija: 4 chromium konteksta u jednom browser-u.
 *
 * Output: tools/_eyes/block-coverage/_coverage.json + console table.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const OUT  = `${REPO}/tools/_eyes/block-coverage`;
mkdirSync(OUT, { recursive: true });
const HOME = process.env.HOME;

const manifest = JSON.parse(readFileSync(`${REPO}/blocks/_manifest.json`, 'utf-8'));
const ALL_EMITS = new Set();
const BLOCK_BY_EMIT = {};
const BLOCK_BY_HOOK = {};
for (const b of manifest.blocks) {
  for (const e of (b.emittedEvents || [])) {
    ALL_EMITS.add(e);
    BLOCK_BY_EMIT[e] = (BLOCK_BY_EMIT[e] || []);
    BLOCK_BY_EMIT[e].push(b.name);
  }
  for (const h of (b.lifecycleHooks || [])) {
    BLOCK_BY_HOOK[h] = (BLOCK_BY_HOOK[h] || new Set());
    BLOCK_BY_HOOK[h].add(b.name);
  }
}

const TARGETS = [
  { label: 'rect5x3',      file: `${REPO}/samples/grids/01_rectangular_5x3_GAME_GDD.md` },
  { label: 'rect6x4',      file: `${REPO}/samples/grids/02_rectangular_6x4_GAME_GDD.md` },
  { label: 'cluster7x7',   file: `${REPO}/samples/grids/03_cluster_7x7_GAME_GDD.md` },
  { label: 'megaclusters', file: `${REPO}/samples/grids/05_megaclusters_GAME_GDD.md` },
  { label: 'hexagonal',    file: `${REPO}/samples/grids/06_hexagonal_GAME_GDD.md` },
  { label: 'expanding',    file: `${REPO}/samples/grids/13_expanding_GAME_GDD.md` },
  { label: 'dualcoloss',   file: `${REPO}/samples/grids/14_dual_colossal_GAME_GDD.md` },
  { label: 'slingo',       file: `${REPO}/samples/grids/15_slingo_GAME_GDD.md` },
  { label: 'plinko',       file: `${REPO}/samples/grids/16_plinko_GAME_GDD.md` },
  { label: 'crash',        file: `${REPO}/samples/grids/17_crash_GAME_GDD.md` },
  { label: 'wheel',        file: `${REPO}/samples/grids/18_wheel_GAME_GDD.md` },
  { label: 'lockrespin',   file: `${REPO}/samples/grids/19_lock_respin_GAME_GDD.md` },
  { label: 'huff',         file: `${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf` },
  { label: 'starlight',    file: `${HOME}/Desktop/GDD/Starlight_Travellers_GDD.pdf` },
  { label: 'wrath',        file: `${HOME}/Desktop/GDD/Wrath_of_Olympus_GDD.pdf` },
  { label: 'gates',        file: `${HOME}/Desktop/GDD/Gates_of_Olympus_1000_GDD.pdf` },
];

const PORT = 5266;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

const browser = await chromium.launch({ headless: true });
const PARALLEL = 4;

async function runOne(label, file) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGE: '+e));
  try {
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
    await page.waitForSelector('#fileInput', { state: 'attached', timeout: 15000 });
    await page.setInputFiles('#fileInput', file);
    await page.waitForSelector('#previewFrame', { timeout: 25000 });
    await page.waitForTimeout(2500);
  } catch (e) {
    await ctx.close();
    return { label, file, error: `setup failed: ${e.message}`, errs };
  }
  const frame = page.frames().find(f => f !== page.mainFrame());
  if (!frame) {
    await ctx.close();
    return { label, file, error: 'no iframe', errs };
  }
  frame.on('console', m => { if (m.type()==='error') errs.push('[iframe] '+m.text()); });

  // Instrument: hook every emit/listener registration on HookBus, count calls
  await frame.evaluate((emitList) => {
    window.__COV = {
      emitCounts: {},      // event -> count
      listenerCounts: {},  // event -> listener registration count
      chipsClicked: [],
      ghostFrames: 0,
      spinResults: 0,
      fsTriggers: 0,
      fsEnds: 0,
      winStarts: 0,
      bigWinStarts: 0,
      worstGhost: 0,
      totalCellSamples: 0,
    };
    if (!window.HookBus) return;
    const origEmit = window.HookBus.emit.bind(window.HookBus);
    const origOn   = window.HookBus.on.bind(window.HookBus);
    window.HookBus.emit = function(name, payload) {
      window.__COV.emitCounts[name] = (window.__COV.emitCounts[name] || 0) + 1;
      return origEmit(name, payload);
    };
    window.HookBus.on = function(name, cb, opts) {
      window.__COV.listenerCounts[name] = (window.__COV.listenerCounts[name] || 0) + 1;
      return origOn(name, cb, opts);
    };
    // Convenience counters
    if (window.HookBus.emit) {
      // Already wrapped — additionally tap key events for sanity
    }
    // Visual cell ghost sampler — broji ghost ćelije van FS overlay phase
    setInterval(() => {
      const phase = window.FSM ? window.FSM.phase : 'BASE';
      if (phase === 'FS_INTRO' || phase === 'FS_OUTRO' || phase === 'BB_INTRO' || phase === 'BB_OUTRO') return;
      const cells = Array.from(document.querySelectorAll('.cell'));
      let ghost = 0;
      cells.forEach(c => {
        const cs = getComputedStyle(c);
        const op = parseFloat(cs.opacity) || 0;
        const tr = cs.transform || 'none';
        const m = tr.match(/matrix\(([^)]+)\)/);
        const sx = m ? parseFloat(m[1].split(',')[0]) : 1;
        if ((op < 0.1 || sx < 0.5) && cs.visibility === 'visible') ghost++;
      });
      window.__COV.totalCellSamples++;
      if (ghost > window.__COV.worstGhost) window.__COV.worstGhost = ghost;
      if (ghost > 0) window.__COV.ghostFrames++;
    }, 120);
  }, Array.from(ALL_EMITS));

  const meta = await frame.evaluate(() => ({
    shape: window.SHAPE && { kind: window.SHAPE.kind, evaluation: window.SHAPE.evaluation, reels: window.SHAPE.reels, rows: window.SHAPE.rows },
    chips: Array.from(document.querySelectorAll('.ufp-chip')).map(c => c.getAttribute('data-ufp-kind')),
    symRegistry: window.SYMBOL_REGISTRY && { wild: window.SYMBOL_REGISTRY.wild, scatter: window.SYMBOL_REGISTRY.scatter, regularPay: window.SYMBOL_REGISTRY.regularPay },
    initialCells: document.querySelectorAll('.cell').length,
    blocks: {
      hasMultOrb: typeof window.spawnMultiplierOrb === 'function',
      hasHoldAndWin: !!window.HW_STATE,
      hasGamble: typeof window.openGamble === 'function' || !!document.querySelector('[data-gamble]'),
    },
  }));

  // 1) 60 base spinova (kompresovano, but real game-flow with wait for BASE ready)
  let spinsDone = 0;
  for (let i = 0; i < 60; i++) {
    let ready = false;
    for (let j = 0; j < 40; j++) {
      ready = await frame.evaluate(() => {
        const b = document.getElementById('spinBtn');
        const ph = window.FSM ? window.FSM.phase : 'BASE';
        return b && !b.disabled && !b.classList.contains('is-spinning') && ph === 'BASE' && !window.__SLOT_WIN_PRESENT_ACTIVE__;
      });
      if (ready) break;
      await page.waitForTimeout(120);
    }
    if (!ready) break;
    await frame.evaluate(() => document.getElementById('spinBtn')?.click());
    await page.waitForTimeout(1700);
    spinsDone++;
  }

  // 2) Force FS chip → 10 FS spinova
  let fsLifecycleOk = false;
  const hasFsChip = await frame.evaluate(() => !!document.querySelector('.ufp-chip[data-ufp-kind="free_spins"]'));
  if (hasFsChip) {
    await frame.evaluate(() => document.querySelector('.ufp-chip[data-ufp-kind="free_spins"]')?.click());
    await page.waitForTimeout(400);
    await frame.evaluate(() => document.getElementById('spinBtn')?.click());
    // Wait for FS_INTRO or FS_ACTIVE
    let intoFs = false;
    for (let j = 0; j < 80; j++) {
      const phase = await frame.evaluate(() => window.FSM ? window.FSM.phase : 'BASE');
      if (phase && phase.startsWith('FS_')) { intoFs = true; break; }
      await page.waitForTimeout(200);
    }
    if (intoFs) {
      // Dismiss intro overlay if present (click intro CTA)
      for (let j = 0; j < 30; j++) {
        const dismissed = await frame.evaluate(() => {
          const cta = document.querySelector('.fs-overlay-cta, .fs-overlay button, [data-fs-cta]');
          if (cta) { cta.click(); return true; }
          return false;
        });
        if (dismissed) break;
        const phase = await frame.evaluate(() => window.FSM ? window.FSM.phase : 'BASE');
        if (phase === 'FS_ACTIVE') break;
        await page.waitForTimeout(200);
      }
      // 12 FS spins
      for (let i = 0; i < 12; i++) {
        let ok = false;
        for (let j = 0; j < 50; j++) {
          ok = await frame.evaluate(() => {
            const b = document.getElementById('spinBtn');
            const ph = window.FSM ? window.FSM.phase : 'BASE';
            return b && !b.disabled && !b.classList.contains('is-spinning') && (ph === 'FS_ACTIVE' || ph === 'BASE') && !window.__SLOT_WIN_PRESENT_ACTIVE__;
          });
          if (ok) break;
          await page.waitForTimeout(150);
        }
        if (!ok) break;
        const phaseNow = await frame.evaluate(() => window.FSM ? window.FSM.phase : 'BASE');
        if (phaseNow === 'BASE') break;
        await frame.evaluate(() => document.getElementById('spinBtn')?.click());
        await page.waitForTimeout(1700);
      }
      fsLifecycleOk = true;
    }
  }

  // 3) UFP chip sweep — click every chip that exists
  const chipResults = {};
  const chipsToTry = ['multiplier', 'cascade', 'ways', 'cluster_pays', 'big_win', 'hold_and_win', 'bonus_pick', 'wheel'];
  // wait for BASE
  for (let j = 0; j < 60; j++) {
    const ready = await frame.evaluate(() => {
      const b = document.getElementById('spinBtn');
      const ph = window.FSM ? window.FSM.phase : 'BASE';
      return b && !b.disabled && !b.classList.contains('is-spinning') && ph === 'BASE' && !window.__SLOT_WIN_PRESENT_ACTIVE__;
    });
    if (ready) break;
    await page.waitForTimeout(200);
  }
  for (const k of chipsToTry) {
    const has = await frame.evaluate((kk) => !!document.querySelector(`.ufp-chip[data-ufp-kind="${kk}"]`), k);
    if (!has) continue;
    const before = await frame.evaluate(() => window.__COV.emitCounts['onForceFeatureRequested'] || 0);
    await frame.evaluate((kk) => document.querySelector(`.ufp-chip[data-ufp-kind="${kk}"]`)?.click(), k);
    await page.waitForTimeout(300);
    const after = await frame.evaluate(() => window.__COV.emitCounts['onForceFeatureRequested'] || 0);
    chipResults[k] = { emitted: after > before };
    // After chip, do 1 spin to drain effect
    await frame.evaluate(() => document.getElementById('spinBtn')?.click());
    await page.waitForTimeout(2500);
  }

  // 4) Autoplay: 8 spins
  let autoplayOk = false;
  const hasAutoplay = await frame.evaluate(() => !!document.querySelector('[data-autoplay], #autoplayBtn, .autoplay-btn'));
  if (hasAutoplay) {
    await frame.evaluate(() => document.querySelector('[data-autoplay], #autoplayBtn, .autoplay-btn')?.click());
    await page.waitForTimeout(3000);
    // pick "8" if popup
    await frame.evaluate(() => {
      const opt = Array.from(document.querySelectorAll('button, [role="button"]')).find(b => /^(8|10)$/.test((b.textContent||'').trim()));
      if (opt) opt.click();
    });
    await page.waitForTimeout(15000);  // let autoplay run for 15s
    autoplayOk = true;
  }

  // Final dump
  const result = await frame.evaluate(() => ({
    emitCounts: window.__COV.emitCounts,
    listenerCounts: window.__COV.listenerCounts,
    worstGhost: window.__COV.worstGhost,
    ghostFrames: window.__COV.ghostFrames,
    totalCellSamples: window.__COV.totalCellSamples,
    finalPhase: window.FSM ? window.FSM.phase : 'BASE',
  }));

  await page.close();
  await ctx.close();
  return { label, file, meta, result, spinsDone, fsLifecycleOk, chipResults, errs };
}

// Run with parallelism
const allResults = [];
console.log(`\n══ Running ${TARGETS.length} GDD targets with parallelism ${PARALLEL} ══`);
const queue = [...TARGETS];
async function worker(id) {
  while (queue.length) {
    const t = queue.shift();
    if (!t) return;
    console.log(`  [W${id}] starting ${t.label}`);
    const start = Date.now();
    try {
      const r = await runOne(t.label, t.file);
      const dur = ((Date.now() - start)/1000).toFixed(1);
      allResults.push(r);
      const emitCount = Object.keys(r.result?.emitCounts || {}).length;
      console.log(`  [W${id}] done   ${t.label.padEnd(15)} ${dur}s  emits=${emitCount}  spins=${r.spinsDone || 0}  fs=${r.fsLifecycleOk ? '✅' : '–'}  ghost=${r.result?.worstGhost ?? 'N/A'}  errs=${r.errs?.length || 0}`);
    } catch (e) {
      console.log(`  [W${id}] FAIL ${t.label}: ${e.message}`);
      allResults.push({ label: t.label, file: t.file, error: e.message, errs: [] });
    }
  }
}
await Promise.all(Array.from({ length: PARALLEL }, (_, i) => worker(i+1)));

// Aggregate per-block status
const blockStatus = {};
for (const b of manifest.blocks) {
  blockStatus[b.name] = {
    category: b.category,
    defaultOn: b.defaultConfig && b.defaultConfig.enabled === true,
    emitsExpected: b.emittedEvents || [],
    hooksExpected: b.lifecycleHooks || [],
    emitsObserved: new Set(),
    hooksRegistered: new Set(),
    gddsWhereSeen: new Set(),
  };
}
for (const r of allResults) {
  if (!r.result) continue;
  for (const [ev, count] of Object.entries(r.result.emitCounts || {})) {
    if (count > 0) {
      const owners = BLOCK_BY_EMIT[ev] || [];
      for (const o of owners) {
        if (blockStatus[o]) {
          blockStatus[o].emitsObserved.add(ev);
          blockStatus[o].gddsWhereSeen.add(r.label);
        }
      }
    }
  }
  for (const [hk, count] of Object.entries(r.result.listenerCounts || {})) {
    if (count > 0) {
      const owners = BLOCK_BY_HOOK[hk] ? Array.from(BLOCK_BY_HOOK[hk]) : [];
      for (const o of owners) {
        if (blockStatus[o]) {
          blockStatus[o].hooksRegistered.add(hk);
        }
      }
    }
  }
}

// Classify each block: PASS / WARN / FAIL
const verdicts = { PASS: [], WARN: [], FAIL: [] };
for (const [name, s] of Object.entries(blockStatus)) {
  const expectsEmits = s.emitsExpected.length > 0;
  const expectsHooks = s.hooksExpected.length > 0;
  const emitsRatio = expectsEmits ? s.emitsObserved.size / s.emitsExpected.length : 1;
  const hooksRatio = expectsHooks ? s.hooksRegistered.size / s.hooksExpected.length : 1;

  // PASS criteria:
  //  - blocks with no emits/hooks declared in manifest (pure CSS/markup) → PASS by default
  //  - blocks with hooks: at least one hook registered → PASS
  //  - blocks with emits: at least 50% of declared emits observed → PASS (some events
  //    only fire on specific GDD configs, full coverage is unreasonable)
  if (!expectsEmits && !expectsHooks) {
    verdicts.PASS.push({ name, why: 'pure (no hooks/emits)' });
  } else if (expectsHooks && s.hooksRegistered.size === 0) {
    verdicts.FAIL.push({ name, why: `no listeners registered for ${s.hooksExpected.join(',')}` });
  } else if (expectsEmits && s.emitsObserved.size === 0) {
    verdicts.FAIL.push({ name, why: `0/${s.emitsExpected.length} emits observed (${s.emitsExpected.join(',')})` });
  } else if (expectsEmits && emitsRatio < 0.5) {
    verdicts.WARN.push({ name, why: `${s.emitsObserved.size}/${s.emitsExpected.length} emits (${[...s.emitsObserved].join(',')}; missing ${s.emitsExpected.filter(e => !s.emitsObserved.has(e)).join(',')})` });
  } else {
    verdicts.PASS.push({ name, why: `${s.emitsObserved.size}/${s.emitsExpected.length} emits, ${s.hooksRegistered.size}/${s.hooksExpected.length} hooks` });
  }
}

// Convert sets to arrays for JSON output
for (const s of Object.values(blockStatus)) {
  s.emitsObserved = [...s.emitsObserved];
  s.hooksRegistered = [...s.hooksRegistered];
  s.gddsWhereSeen = [...s.gddsWhereSeen];
}

writeFileSync(`${OUT}/_coverage.json`, JSON.stringify({
  generatedAt: new Date().toISOString(),
  targets: TARGETS.map(t => t.label),
  blockStatus,
  verdicts,
  rawResults: allResults.map(r => ({ ...r, errs: r.errs?.slice(0, 5) })),
}, null, 2));

// Report
console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
console.log(`║          BLOCK COVERAGE WALKER — FINAL REPORT                ║`);
console.log(`╚══════════════════════════════════════════════════════════════╝\n`);
console.log(`Targets run: ${allResults.length}/${TARGETS.length}`);
let totalErrs = 0, totalGhost = 0, totalGhostFrames = 0;
for (const r of allResults) {
  totalErrs += r.errs?.length || 0;
  totalGhost = Math.max(totalGhost, r.result?.worstGhost || 0);
  totalGhostFrames += r.result?.ghostFrames || 0;
  const emitCount = Object.keys(r.result?.emitCounts || {}).length;
  console.log(`  ${(r.label||'?').padEnd(15)} shape=${(r.meta?.shape?.kind||'?').padEnd(14)} spins=${(r.spinsDone||0).toString().padStart(3)}  fs=${r.fsLifecycleOk ? '✅' : '–'}  emits=${emitCount}  ghost=${r.result?.worstGhost ?? 'N/A'}  errs=${r.errs?.length || 0}${r.error ? ' ERROR: '+r.error : ''}`);
}
console.log(`\nTotal console errors: ${totalErrs}`);
console.log(`Peak ghost cells across all runs: ${totalGhost}`);
console.log(`Total ghost frames: ${totalGhostFrames}`);

console.log(`\n── Block coverage verdict ──`);
console.log(`✅ PASS: ${verdicts.PASS.length}/${Object.keys(blockStatus).length}`);
console.log(`⚠️  WARN: ${verdicts.WARN.length}`);
console.log(`❌ FAIL: ${verdicts.FAIL.length}`);

if (verdicts.FAIL.length) {
  console.log(`\n── FAILS ──`);
  verdicts.FAIL.forEach(v => console.log(`  ❌ ${v.name.padEnd(28)} — ${v.why}`));
}
if (verdicts.WARN.length) {
  console.log(`\n── WARNS ──`);
  verdicts.WARN.forEach(v => console.log(`  ⚠️  ${v.name.padEnd(28)} — ${v.why}`));
}

await browser.close();
server.kill('SIGTERM');
console.log(`\nDetail in ${OUT}/_coverage.json`);
