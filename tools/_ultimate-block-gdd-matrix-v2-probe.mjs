#!/usr/bin/env node
/**
 * tools/_ultimate-block-gdd-matrix-v2-probe.mjs · D-9.5 ENHANCED MATRIX
 *
 * Unapređenje D-9: umesto da samo broji signal score, ovaj probe za svaki
 * blok računa **EXPECTED enabled** (manifest default + model.json override)
 * i uporedi sa **RUNTIME signal**. Ako je blok declared-enabled ali nema
 * nikakvog signala u nekom GDD-u → STVARNI FAIL (regresija ili buggy emit).
 *
 * Algoritam:
 *
 *   1. Load blocks/_manifest.json → 184 blok-a sa defaultConfig.enabled
 *   2. Za svaku igru: load model.json — merge overrides preko defaults
 *      → per-blok per-igri "declaredEnabled" boolean
 *   3. Run D-9 snapshot procedure (warmup 5 spinova + state/DOM/listener snap)
 *   4. Per (blok × igri) verdict:
 *        EXPECTED & SIGNAL    → PASS  (blok savršeno radi)
 *        EXPECTED & NO SIGNAL → FAIL  (blok declared ali ne radi)
 *        !EXPECTED & SIGNAL   → INFO  (nije declared ali ipak radi — legit
 *                                       često: stub runtime even when off)
 *        !EXPECTED & NO SIG.  → PASS  (off u modelu, off u runtime)
 *   5. Summary: koji blokovi su FAIL-ovali u kojim GDD-ovima
 *
 * Exit code:
 *   0  ako 0 FAIL preko svih (blok × igri) ćelija
 *   1  ako ≥ 1 FAIL
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const DIST = resolve(REPO, 'dist/real-games');
const MANIFEST_PATH = resolve(REPO, 'blocks/_manifest.json');
const OUT = resolve(REPO, 'reports/_ultimate-block-gdd-matrix-v2');

const WARMUP_SPINS = 5;
const POST_SPIN_TIMEOUT = 4000;

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

function log(...a) { console.log(...a); }

/* Per-block known-marker registry — blokovi koji ne slede default
   `<NAME>_STATE` konvenciju imaju custom signal varijable. Otkriveno
   kroz D-9 v1 → 9 false-fail blokova; ovde dopunjeno. */
const BLOCK_MARKERS = {
  anteBet: ['ANTE_BET_ON', 'ANTE_BET_MULTIPLIER'],
  clusterPaysEval: ['detectClusterWins'],
  waysEval: ['detectWaysWins', '__waysEval'],
  payAnywhereEval: ['detectPayAnywhereWins', 'PAY_ANYWHERE_TABLE'],
  universalForcePanel: ['FORCE_TRIGGER', 'FORCE_BIG_WIN_TIER'],
  spinTempo: ['SPIN_TEMPO_ENABLED'],
  jurisdictionGate: ['__SLOT_JURISDICTION__', 'JURISDICTION_LOCK'],
  regulatorDisclosureModal: [
    '__AUTOPLAY_DISCLOSURE_ACK__',
    '__EU_AI_DECLARATION_ACK__',
    '__FR_FRJ_CHECK_PASSED__',
    '__IT_RUA_CHECK_PASSED__',
  ],
  pwaInstallability: ['__SLOT_PWA_STATE__', '__SLOT_PWA_PROMPT__'],
  detectLineWins: ['detectLineWins'],
  detectWinCombos: ['detectWinCombos'],
  paylineOverlay: ['drawPaylineOverlay'],
};

function deriveStateMarkers(name) {
  const upper = name.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
  const derived = [upper + '_STATE', '__' + upper + '_STATE__', '__' + upper + '__', upper, name + 'State'];
  const known = BLOCK_MARKERS[name] || [];
  return [...derived, ...known];
}

function deriveDomKeys(name) {
  const kebab = name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  return { name, kebab };
}

async function clickSpin(page) {
  return await page.evaluate(() => {
    const btn = document.getElementById('spinBtn');
    if (btn && !btn.disabled) { btn.click(); return true; }
    return false;
  });
}

async function waitForPostSpin(page, timeoutMs) {
  try {
    await page.evaluate((to) => new Promise((res) => {
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; res(); } }, to);
      try {
        if (window.HookBus && window.HookBus.once) {
          window.HookBus.once('postSpin', () => { if (!done) { done = true; clearTimeout(t); res(); } });
        }
      } catch (_) {}
    }), timeoutMs);
  } catch (_) {}
}

async function snapshotPage(page, manifest, extraMarkers) {
  return await page.evaluate(({ blocks, extra }) => {
    const allEvents = new Set();
    for (const b of blocks) {
      for (const ev of (b.lifecycleHooks || [])) allEvents.add(ev);
      for (const ev of (b.emittedEvents || [])) allEvents.add(ev);
    }
    const listenerCounts = {};
    if (window.HookBus && typeof window.HookBus.listenerCount === 'function') {
      for (const e of allEvents) listenerCounts[e] = window.HookBus.listenerCount(e) || 0;
    }
    /* Broad filter — caps, __DOUBLE_UNDER__, and known explicit extras
       (block-specific markers passed from the host script). */
    const globalKeys = Object.keys(window).filter(k => /^[A-Z_]+(_STATE)?$|^__[A-Z]/.test(k));
    /* Test each extra explicitly via typeof so we catch lowercase function
       names like detectClusterWins / drawPaylineOverlay. */
    const extraPresent = [];
    for (const m of extra) {
      try {
        if (typeof window[m] !== 'undefined') extraPresent.push(m);
      } catch (_) {}
    }
    const domNodes = document.querySelectorAll('[data-block], [id], [class]');
    const dataBlocks = new Set(), ids = new Set(), classes = new Set();
    for (const n of domNodes) {
      if (n.dataset && n.dataset.block) dataBlocks.add(n.dataset.block);
      if (n.id) ids.add(n.id);
      if (n.classList) for (const c of n.classList) classes.add(c);
    }
    return {
      listenerCounts,
      globalKeys: [...globalKeys, ...extraPresent],
      dataBlocks: [...dataBlocks], ids: [...ids], classes: [...classes],
    };
  }, { blocks: manifest.blocks, extra: extraMarkers });
}

/** Compute expected-enabled per block by dynamically calling each block's
    resolveConfig(model).enabled — the canonical truth-source the runtime
    builder uses. Falls back to manifest defaultConfig.enabled if a block
    has no resolveConfig export. */
async function computeExpected(manifest, model) {
  const expected = {};
  for (const b of manifest.blocks) {
    let declared = (b.defaultConfig && b.defaultConfig.enabled === true);
    try {
      const blockPath = resolve(REPO, b.file);
      const mod = await import(pathToFileURL(blockPath).href);
      if (typeof mod.resolveConfig === 'function') {
        const cfg = mod.resolveConfig(model || {});
        if (cfg && typeof cfg.enabled === 'boolean') declared = cfg.enabled;
      }
    } catch (_) {
      /* fall back to manifest default */
    }
    expected[b.name] = declared;
  }
  return expected;
}

function evalSignal(b, snap) {
  const stateKeys = deriveStateMarkers(b.name);
  const dom = deriveDomKeys(b.name);
  const hasState = stateKeys.some(k => snap.globalKeys.includes(k));
  const hasDom = (
    snap.dataBlocks.includes(b.name) ||
    snap.dataBlocks.includes(dom.kebab) ||
    snap.ids.includes(b.name) ||
    snap.ids.includes(dom.kebab) ||
    snap.classes.includes(dom.kebab)
  );
  const hooks = b.lifecycleHooks || [];
  const allHooked = hooks.length > 0 && hooks.every(e => (snap.listenerCounts[e] || 0) >= 1);
  const someHooked = hooks.length > 0 && hooks.some(e => (snap.listenerCounts[e] || 0) >= 1);
  return {
    hasState, hasDom, allHooked, someHooked,
    signal: hasState || hasDom || allHooked || someHooked,
  };
}

async function runOneGame(browser, gameDir, manifest) {
  const slot = resolve(DIST, gameDir, 'slot.html');
  if (!existsSync(slot)) return { game: gameDir, error: 'slot.html missing' };

  let model = null;
  try {
    const modelPath = resolve(DIST, gameDir, 'model.json');
    if (existsSync(modelPath)) model = JSON.parse(readFileSync(modelPath, 'utf8'));
  } catch (_) {}
  const expected = await computeExpected(manifest, model);

  const url = pathToFileURL(slot).href;
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errors = { console: [], page: [] };
  page.on('console', (m) => { if (m.type() === 'error') errors.console.push(m.text().slice(0, 240)); });
  page.on('pageerror', (e) => errors.page.push(String(e).slice(0, 240)));

  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(800);

  for (let i = 0; i < WARMUP_SPINS; i++) {
    const ok = await clickSpin(page);
    if (!ok) break;
    await waitForPostSpin(page, POST_SPIN_TIMEOUT);
    await page.waitForTimeout(150);
  }

  /* Compile all extra block-specific markers from registry. */
  const extraMarkers = [];
  for (const arr of Object.values(BLOCK_MARKERS)) extraMarkers.push(...arr);
  const snap = await snapshotPage(page, manifest, extraMarkers);
  await ctx.close();

  const cells = {};
  let pass = 0, fail = 0, info = 0, offOk = 0;
  for (const b of manifest.blocks) {
    const sig = evalSignal(b, snap);
    const exp = !!expected[b.name];
    let verdict;
    if (exp && sig.signal) { verdict = 'PASS'; pass++; }
    else if (exp && !sig.signal) { verdict = 'FAIL'; fail++; }
    else if (!exp && sig.signal) { verdict = 'INFO'; info++; }
    else { verdict = 'OFF-OK'; offOk++; }
    cells[b.name] = { expected: exp, ...sig, verdict };
  }
  return {
    game: gameDir,
    expectedEnabledCount: Object.values(expected).filter(Boolean).length,
    cells, errors,
    counts: { pass, fail, info, offOk },
  };
}

async function main() {
  log('\n🎰 ULTIMATE BLOCK × GDD MATRIX v2 · D-9.5');
  log('   Per-blok per-igri: EXPECTED (manifest default + model overlay) vs RUNTIME signal\n');
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const games = readdirSync(DIST).filter((g) => existsSync(resolve(DIST, g, 'slot.html'))).sort();
  if (games.length === 0) { console.error('FATAL: nema dist/real-games'); process.exit(2); }
  log(`   Blocks: ${manifest.blocks.length} · GDDs: ${games.length}\n`);

  const browser = await chromium.launch({ headless: true });
  const per = {};
  for (const g of games) {
    const t0 = Date.now();
    log(`▸ ${g}`);
    try {
      const r = await runOneGame(browser, g, manifest);
      per[g] = r;
      log(`   declared=${r.expectedEnabledCount} · PASS=${r.counts.pass} · FAIL=${r.counts.fail} · INFO=${r.counts.info} · OFF-OK=${r.counts.offOk} · err=${r.errors.console.length + r.errors.page.length} · ${((Date.now()-t0)/1000).toFixed(1)}s`);
    } catch (e) {
      log('   ❌ FAILED:', String(e).slice(0, 200));
      per[g] = { game: g, error: String(e) };
    }
  }
  await browser.close();

  /* Per-block aggregate. */
  const blockAgg = {};
  for (const b of manifest.blocks) {
    const perGdd = {};
    let failCount = 0, passCount = 0;
    for (const g of games) {
      const r = per[g];
      const c = r && r.cells && r.cells[b.name];
      perGdd[g] = c;
      if (c && c.verdict === 'FAIL') failCount++;
      if (c && c.verdict === 'PASS') passCount++;
    }
    blockAgg[b.name] = { perGdd, failCount, passCount };
  }

  /* Cross-GDD failures. */
  const failedBlocks = Object.entries(blockAgg).filter(([_, a]) => a.failCount > 0);

  const stamp = Date.now();
  const outPath = resolve(OUT, `run-${stamp}.json`);
  writeFileSync(outPath, JSON.stringify({ stamp, games, per, blockAgg }, null, 2));

  log('\n══════════════════════════════════════════════════════════════════════');
  log('SUMMARY · BLOCK × GDD MATRIX v2 (declared vs runtime)');
  log('══════════════════════════════════════════════════════════════════════');
  let totalFails = 0;
  for (const g of games) {
    const r = per[g];
    log(`  ${g.padEnd(34)} declared=${r.expectedEnabledCount} · PASS=${r.counts.pass} · FAIL=${r.counts.fail} · INFO=${r.counts.info} · OFF-OK=${r.counts.offOk}`);
    totalFails += r.counts.fail;
  }
  log('');
  log(`  Σ FAIL preko svih ćelija:   ${totalFails}`);
  log(`  Σ blokova sa bilo kojim FAIL: ${failedBlocks.length}`);
  log('');

  if (failedBlocks.length > 0) {
    log('  ── BLOKOVI KOJI SU DECLARED ALI NEMAJU RUNTIME SIGNAL (pravi fail):');
    for (const [name, a] of failedBlocks) {
      const breakdown = games.map(g => {
        const c = a.perGdd[g];
        if (!c) return `${g.slice(0,12)}=?`;
        const flags = (c.hasState ? 'S' : '.') + (c.hasDom ? 'D' : '.') + (c.allHooked ? 'H' : '.');
        const tag = c.verdict === 'FAIL' ? '✗' : (c.verdict === 'PASS' ? '✓' : (c.verdict === 'INFO' ? 'i' : '◯'));
        return `${g.slice(0,12)}=${tag}${flags}`;
      }).join(' ');
      log(`     ✗ ${name.padEnd(34)} ${breakdown}`);
    }
    log('');
  } else {
    log('  ✅ NEMA DECLARED-ALI-BROKEN blokova — svaki declared-enabled blok ima runtime signal u svom GDD-u.');
    log('');
  }

  log(`   Report: ${outPath}\n`);
  process.exit(totalFails === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(2); });
