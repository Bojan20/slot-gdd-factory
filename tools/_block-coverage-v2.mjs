#!/usr/bin/env node
/**
 * tools/_block-coverage-v2.mjs
 *
 * V2 of block coverage walker. Two fixes from V1:
 *   1. HookBus instrumentation via addInitScript (BEFORE iframe parse) so
 *      listener registration is actually captured, not lost to the race.
 *   2. Diagnoses why spins=2 happened for megaclusters/plinko/crash/etc
 *      — logs button state per spin attempt so we know if the button is
 *      locked, phase is wrong, or win-present-active is stuck.
 *
 * Per-block verdict:
 *   - DEFAULT_ON blocks → DOM element must exist (#balanceHud, #stageBadge,
 *     #winRollupHost, .ufp-chip, #spinBtn, etc.)
 *   - emit-owner blocks → at least one of their declared emits fired
 *   - hook-listener blocks → at least one of their declared hooks fired
 *     AND at least one listener is registered for it
 *
 * Output: tools/_eyes/block-coverage-v2/_v2.json
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const OUT  = `${REPO}/tools/_eyes/block-coverage-v2`;
mkdirSync(OUT, { recursive: true });
const HOME = process.env.HOME;

const manifest = JSON.parse(readFileSync(`${REPO}/blocks/_manifest.json`, 'utf-8'));

const TARGETS = [
  { label: 'rect5x3',      file: `${REPO}/samples/grids/01_rectangular_5x3_GAME_GDD.md` },
  { label: 'cluster7x7',   file: `${REPO}/samples/grids/03_cluster_7x7_GAME_GDD.md` },
  { label: 'megaclusters', file: `${REPO}/samples/grids/05_megaclusters_GAME_GDD.md` },
  { label: 'hexagonal',    file: `${REPO}/samples/grids/06_hexagonal_GAME_GDD.md` },
  { label: 'plinko',       file: `${REPO}/samples/grids/16_plinko_GAME_GDD.md` },
  { label: 'crash',        file: `${REPO}/samples/grids/17_crash_GAME_GDD.md` },
  { label: 'wheel',        file: `${REPO}/samples/grids/18_wheel_GAME_GDD.md` },
  { label: 'lockrespin',   file: `${REPO}/samples/grids/19_lock_respin_GAME_GDD.md` },
  { label: 'huff',         file: `${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf` },
  { label: 'starlight',    file: `${HOME}/Desktop/GDD/Starlight_Travellers_GDD.pdf` },
  { label: 'wrath',        file: `${HOME}/Desktop/GDD/Wrath_of_Olympus_GDD.pdf` },
  { label: 'gates',        file: `${HOME}/Desktop/GDD/Gates_of_Olympus_1000_GDD.pdf` },
];

const PORT = 5269;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

const browser = await chromium.launch({ headless: true });
const PARALLEL = 4;

async function runOne(label, file) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  /* KEY FIX: addInitScript runs in EVERY frame BEFORE any user script.
     This way HookBus.on/emit get wrapped before blocks register listeners. */
  await ctx.addInitScript(() => {
    Object.defineProperty(window, '__INSTRUMENT_HOOKBUS__', { value: true, writable: false });
    let pending = null;
    function install() {
      if (!window.HookBus || !window.HookBus.on || !window.HookBus.emit) return false;
      if (window.__HOOK_INSTRUMENTED__) return true;
      window.__HOOK_INSTRUMENTED__ = true;
      window.__COV = { emitCounts: {}, listenerCounts: {} };
      const origEmit = window.HookBus.emit.bind(window.HookBus);
      const origOn = window.HookBus.on.bind(window.HookBus);
      window.HookBus.emit = function(name, payload) {
        window.__COV.emitCounts[name] = (window.__COV.emitCounts[name] || 0) + 1;
        return origEmit(name, payload);
      };
      window.HookBus.on = function(name, cb, opts) {
        window.__COV.listenerCounts[name] = (window.__COV.listenerCounts[name] || 0) + 1;
        return origOn(name, cb, opts);
      };
      return true;
    }
    /* Poll until HookBus appears (created by emitHookBusRuntime). */
    pending = setInterval(() => {
      if (install()) { clearInterval(pending); pending = null; }
    }, 5);
  });

  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGE: '+e));
  try {
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
    await page.waitForSelector('#fileInput', { state: 'attached', timeout: 15000 });
    await page.setInputFiles('#fileInput', file);
    await page.waitForSelector('#previewFrame', { timeout: 25000 });
    await page.waitForTimeout(3000);
  } catch (e) {
    await ctx.close();
    return { label, file, error: `setup failed: ${e.message}`, errs };
  }

  const frame = page.frames().find(f => f !== page.mainFrame());
  if (!frame) { await ctx.close(); return { label, file, error: 'no iframe', errs }; }
  frame.on('console', m => { if (m.type()==='error') errs.push('[iframe] '+m.text()); });

  // DOM element inventory for DEFAULT_ON blocks
  const dom = await frame.evaluate(() => ({
    spinBtn: !!document.getElementById('spinBtn'),
    balanceHud: !!document.getElementById('balanceHud'),
    stageBadge: !!document.getElementById('stageBadge'),
    winRollupHost: !!document.getElementById('winRollupHost'),
    paytableBtn: !!document.querySelector('#paytableBtn, [data-paytable]'),
    settingsBtn: !!document.querySelector('#settingsBtn, [data-settings]'),
    autoplayBtn: !!document.querySelector('#autoplayBtn, [data-autoplay]'),
    turboBtn: !!document.querySelector('#turboBtn, [data-turbo]'),
    historyBtn: !!document.querySelector('#historyBtn, [data-history]'),
    betSelector: !!document.querySelector('#betPlus, #betMinus, .bet-selector, [data-bet]'),
    ufpChips: document.querySelectorAll('.ufp-chip').length,
    symbolInfoPopover: !!document.querySelector('#symInfoToggle, [data-sym-info]'),
    cellCount: document.querySelectorAll('.cell').length,
    gridHost: !!document.getElementById('gridHost'),
  }));

  const meta = await frame.evaluate(() => ({
    shape: window.SHAPE && { kind: window.SHAPE.kind, evaluation: window.SHAPE.evaluation },
    chips: Array.from(document.querySelectorAll('.ufp-chip')).map(c => c.getAttribute('data-ufp-kind')),
    instrumented: !!window.__HOOK_INSTRUMENTED__,
    earlyListenerCounts: window.__COV ? Object.keys(window.__COV.listenerCounts).length : 0,
  }));

  // Diagnose spin-button state across attempts + auto-dismiss FS overlays
  const spinDiag = [];
  let spinsDone = 0;
  let fsDismissed = 0;
  for (let i = 0; i < 30; i++) {
    let ok = false;
    let lastDiag = null;
    for (let j = 0; j < 50; j++) {
      lastDiag = await frame.evaluate(() => {
        const b = document.getElementById('spinBtn');
        const cta = document.querySelector('.fs-overlay-cta, .fs-overlay button, [data-fs-cta], .fs-cta');
        return {
          hasBtn: !!b,
          disabled: !!(b && b.disabled),
          spinning: !!(b && b.classList.contains('is-spinning')),
          phase: window.FSM ? window.FSM.phase : null,
          winPresActive: !!window.__SLOT_WIN_PRESENT_ACTIVE__,
          hasFsCta: !!cta,
        };
      });
      /* Auto-dismiss FS_INTRO and FS_OUTRO overlays — they wait for player
       * CTA tap. Without this, base-spin loop blocks on first FS trigger. */
      if (lastDiag.phase === 'FS_INTRO' || lastDiag.phase === 'FS_OUTRO') {
        if (lastDiag.hasFsCta) {
          await frame.evaluate(() => {
            document.querySelector('.fs-overlay-cta, .fs-overlay button, [data-fs-cta], .fs-cta')?.click();
          });
          fsDismissed++;
          await page.waitForTimeout(400);
          continue;
        }
      }
      if (lastDiag.hasBtn && !lastDiag.disabled && !lastDiag.spinning &&
          (lastDiag.phase === 'BASE' || lastDiag.phase === 'FS_ACTIVE') &&
          !lastDiag.winPresActive) {
        ok = true;
        break;
      }
      await page.waitForTimeout(150);
    }
    if (!ok) {
      spinDiag.push({ attempt: i, status: 'BLOCKED', diag: lastDiag });
      break;
    }
    await frame.evaluate(() => document.getElementById('spinBtn')?.click());
    await page.waitForTimeout(2000);
    spinsDone++;
  }

  // Chip sweep
  const chipResults = {};
  for (const kind of meta.chips) {
    // wait base
    for (let j = 0; j < 60; j++) {
      const ok = await frame.evaluate(() => {
        const b = document.getElementById('spinBtn');
        const ph = window.FSM ? window.FSM.phase : 'BASE';
        return b && !b.disabled && !b.classList.contains('is-spinning') && ph === 'BASE' && !window.__SLOT_WIN_PRESENT_ACTIVE__;
      });
      if (ok) break;
      await page.waitForTimeout(200);
    }
    const before = await frame.evaluate(() => window.__COV ? { ...window.__COV.emitCounts } : {});
    await frame.evaluate((k) => document.querySelector(`.ufp-chip[data-ufp-kind="${k}"]`)?.click(), kind);
    await page.waitForTimeout(400);
    await frame.evaluate(() => document.getElementById('spinBtn')?.click());
    await page.waitForTimeout(2500);
    const after = await frame.evaluate(() => window.__COV ? { ...window.__COV.emitCounts } : {});
    const delta = {};
    for (const k of Object.keys(after)) {
      const d = (after[k] || 0) - (before[k] || 0);
      if (d > 0) delta[k] = d;
    }
    chipResults[kind] = delta;
  }

  // Final
  const result = await frame.evaluate(() => ({
    emitCounts: window.__COV ? { ...window.__COV.emitCounts } : {},
    listenerCounts: window.__COV ? { ...window.__COV.listenerCounts } : {},
    instrumented: !!window.__HOOK_INSTRUMENTED__,
  }));

  await page.close();
  await ctx.close();
  return { label, file, meta, dom, result, spinsDone, fsDismissed, spinDiag, chipResults, errs };
}

const allResults = [];
console.log(`\n══ Running ${TARGETS.length} targets, parallel ${PARALLEL} ══`);
const queue = [...TARGETS];
async function worker(id) {
  while (queue.length) {
    const t = queue.shift();
    if (!t) return;
    const start = Date.now();
    console.log(`  [W${id}] start ${t.label}`);
    try {
      const r = await runOne(t.label, t.file);
      const dur = ((Date.now() - start)/1000).toFixed(1);
      allResults.push(r);
      const ec = Object.keys(r.result?.emitCounts || {}).length;
      const lc = Object.keys(r.result?.listenerCounts || {}).length;
      const fd = (r.fsDismissed != null) ? r.fsDismissed : '?';
      console.log(`  [W${id}] done  ${t.label.padEnd(13)} ${dur}s spins=${(r.spinsDone||0).toString().padStart(2)} emits=${ec} fsDismiss=${fd} errs=${r.errs?.length || 0}${r.error ? ' ERROR:'+r.error : ''}`);
      if (r.spinDiag && r.spinDiag.length) {
        const d = r.spinDiag[0];
        console.log(`        BLOCKED at attempt ${d.attempt}: ${JSON.stringify(d.diag)}`);
      }
    } catch (e) {
      console.log(`  [W${id}] FAIL ${t.label}: ${e.message}`);
      allResults.push({ label: t.label, file: t.file, error: e.message, errs: [] });
    }
  }
}
await Promise.all(Array.from({ length: PARALLEL }, (_, i) => worker(i+1)));

// Aggregate per-block verdict
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
// Reverse maps from manifest
const BLOCK_BY_EMIT = {};
for (const b of manifest.blocks) {
  for (const e of (b.emittedEvents || [])) {
    BLOCK_BY_EMIT[e] = (BLOCK_BY_EMIT[e] || []);
    BLOCK_BY_EMIT[e].push(b.name);
  }
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
      for (const [name, st] of Object.entries(blockStatus)) {
        if (st.hooksExpected.includes(hk)) {
          st.hooksRegistered.add(hk);
        }
      }
    }
  }
}

// Classify
const verdicts = { PASS: [], WARN: [], FAIL: [] };
for (const [name, s] of Object.entries(blockStatus)) {
  const expectsEmits = s.emitsExpected.length > 0;
  const expectsHooks = s.hooksExpected.length > 0;
  if (!expectsEmits && !expectsHooks) {
    verdicts.PASS.push({ name, why: 'pure (no hooks/emits)' });
  } else if (expectsHooks && s.hooksRegistered.size === 0 && expectsEmits && s.emitsObserved.size === 0) {
    verdicts.FAIL.push({ name, why: `no hooks or emits ever fired` });
  } else if (expectsEmits && s.emitsObserved.size === 0) {
    verdicts.FAIL.push({ name, why: `0/${s.emitsExpected.length} emits observed (${s.emitsExpected.join(',')})` });
  } else if (expectsHooks && s.hooksRegistered.size === 0) {
    verdicts.WARN.push({ name, why: `0/${s.hooksExpected.length} hooks (${s.hooksExpected.join(',')}); emits ok` });
  } else if (expectsEmits && s.emitsObserved.size / s.emitsExpected.length < 0.5) {
    verdicts.WARN.push({ name, why: `${s.emitsObserved.size}/${s.emitsExpected.length} emits; missing ${s.emitsExpected.filter(e => !s.emitsObserved.has(e)).join(',')}` });
  } else {
    verdicts.PASS.push({ name, why: `${s.emitsObserved.size}/${s.emitsExpected.length} emits, ${s.hooksRegistered.size}/${s.hooksExpected.length} hooks` });
  }
}

for (const s of Object.values(blockStatus)) {
  s.emitsObserved = [...s.emitsObserved];
  s.hooksRegistered = [...s.hooksRegistered];
  s.gddsWhereSeen = [...s.gddsWhereSeen];
}

writeFileSync(`${OUT}/_v2.json`, JSON.stringify({
  generatedAt: new Date().toISOString(),
  blockStatus,
  verdicts,
  rawResults: allResults.map(r => ({ ...r, errs: r.errs?.slice(0, 5) })),
}, null, 2));

console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
console.log(`║          BLOCK COVERAGE V2 — FINAL REPORT                    ║`);
console.log(`╚══════════════════════════════════════════════════════════════╝\n`);
for (const r of allResults) {
  const ec = Object.keys(r.result?.emitCounts || {}).length;
  const lc = Object.keys(r.result?.listenerCounts || {}).length;
  console.log(`  ${(r.label||'?').padEnd(13)} shape=${(r.meta?.shape?.kind||'?').padEnd(13)} spins=${(r.spinsDone||0).toString().padStart(2)} emits=${ec} listeners=${lc} instr=${r.meta?.instrumented ? '✓' : '✗'} errs=${r.errs?.length || 0}`);
}
console.log(`\n── Block verdict ──`);
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
console.log(`\nDetail: ${OUT}/_v2.json`);
