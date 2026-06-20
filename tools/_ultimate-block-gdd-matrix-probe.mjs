#!/usr/bin/env node
/**
 * tools/_ultimate-block-gdd-matrix-probe.mjs · D-9 BLOCK × GDD MATRIX
 *
 * Boki 2026-06-20: "ali mora da radi pravilno, kako radi za WoO na primer,
 *                   tako mora za svaki moguci gdd. dinamicki mora da radi
 *                   zavisno od gdd-a. da li postoji ultimativni test koji
 *                   mozes da uradis za svaki blok, ali da ga pogledas kako
 *                   radi, i da se uveris da u svakom gddu radi svaki blok
 *                   isto?"
 *
 * Real headless Chromium probe koji pravi STVARNU 184 × N matricu:
 *
 *   ROWS:   sve 184 bloka iz blocks/_manifest.json
 *   COLS:   svaki GDD u dist/real-games/<game>/slot.html
 *   CELL:   per-block-per-GDD verdict
 *
 * Algoritam:
 *
 *   1. Load blocks/_manifest.json — canonical block list sa lifecycleHooks
 *   2. Auto-derive po blok-u: state-marker globals, DOM selectors, listener
 *      events koji se očekuju da budu attached kad je blok enabled
 *   3. Za svaki GDD:
 *      a. open slot.html headless
 *      b. warmup 5 spinova (lazy-init listeneri attach)
 *      c. snima per-event listenerCount + state markers + DOM markers
 *      d. compute per-block "signal score" (0..3):
 *           +1 ako bilo koji od auto-derived state markers postoji
 *           +1 ako bilo koji DOM marker postoji
 *           +1 ako svi declared lifecycleHooks imaju listenerCount >= 1
 *   4. Per-block aggregate: u koliko GDD-ova score >= 1 (active)
 *   5. Matrix output: blok × GDD = score (0..3)
 *
 * Verdict za PASS:
 *   • Za svaki blok: ako je active u 1 GDD-u (npr. WoO), mora biti active
 *     u SVIM ostalim GDD-ovima koji ga ENABLE-uju u model.json
 *   • Inače = FAIL (blok ne radi konzistentno preko GDD-ova)
 *
 * Output:
 *   • reports/_ultimate-block-gdd-matrix/run-<ts>.json (full matrix)
 *   • Console summary + per-block delta-list
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const DIST = resolve(REPO, 'dist/real-games');
const MANIFEST_PATH = resolve(REPO, 'blocks/_manifest.json');
const OUT = resolve(REPO, 'reports/_ultimate-block-gdd-matrix');

const WARMUP_SPINS = 5;
const POST_SPIN_TIMEOUT = 4000;

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

function log(...a) { console.log(...a); }

/** Auto-derive plausible state-marker global names from block name. */
function deriveStateMarkers(blockName) {
  /* Convert camelCase → UPPER_SNAKE and produce common variants. */
  const upper = blockName.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
  return [
    upper + '_STATE',
    '__' + upper + '_STATE__',
    '__' + upper + '__',
    upper,
    blockName + 'State',
  ];
}

/** Auto-derive DOM selectors that the block might inject. */
function deriveDomSelectors(blockName) {
  const kebab = blockName.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  return [
    `#${blockName}`,
    `#${kebab}`,
    `[data-block="${blockName}"]`,
    `[data-block="${kebab}"]`,
    `.${kebab}`,
  ];
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

async function snapshotPage(page, manifest) {
  return await page.evaluate((blocks) => {
    /* Collect everything once per page (cheaper than per-block evaluate). */
    const allEvents = new Set();
    for (const b of blocks) {
      for (const ev of (b.lifecycleHooks || [])) allEvents.add(ev);
      for (const ev of (b.emittedEvents || [])) allEvents.add(ev);
    }
    const listenerCounts = {};
    if (window.HookBus && typeof window.HookBus.listenerCount === 'function') {
      for (const e of allEvents) {
        listenerCounts[e] = window.HookBus.listenerCount(e) || 0;
      }
    }
    /* Snapshot all globals once. */
    const globalKeys = Object.keys(window).filter(k => /^[A-Z_]+(_STATE)?$|^__[A-Z]/.test(k));
    /* Snapshot known data-block markers + classes. */
    const domNodes = document.querySelectorAll('[data-block], [id], [class]');
    const domMarkers = { dataBlocks: new Set(), ids: new Set(), classes: new Set() };
    for (const n of domNodes) {
      if (n.dataset && n.dataset.block) domMarkers.dataBlocks.add(n.dataset.block);
      if (n.id) domMarkers.ids.add(n.id);
      if (n.classList) for (const c of n.classList) domMarkers.classes.add(c);
    }
    return {
      listenerCounts,
      globalKeys,
      dataBlocks: [...domMarkers.dataBlocks],
      ids: [...domMarkers.ids],
      classes: [...domMarkers.classes],
    };
  }, manifest.blocks);
}

async function runOneGame(browser, gameDir, manifest) {
  const slot = resolve(DIST, gameDir, 'slot.html');
  if (!existsSync(slot)) return { game: gameDir, error: 'slot.html missing' };

  const url = pathToFileURL(slot).href;
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  const errors = { console: [], page: [] };
  page.on('console', (m) => { if (m.type() === 'error') errors.console.push(m.text().slice(0, 240)); });
  page.on('pageerror', (e) => errors.page.push(String(e).slice(0, 240)));

  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(800);

  /* Warmup — lazy-init listeners + BBM wire + FS hook attach. */
  let warmupOk = 0;
  for (let i = 0; i < WARMUP_SPINS; i++) {
    const clicked = await clickSpin(page);
    if (!clicked) break;
    warmupOk++;
    await waitForPostSpin(page, POST_SPIN_TIMEOUT);
    await page.waitForTimeout(150);
  }

  const snap = await snapshotPage(page, manifest);
  /* Load model.json — declared per-block enable status. */
  let model = null;
  try {
    const modelPath = resolve(DIST, gameDir, 'model.json');
    if (existsSync(modelPath)) model = JSON.parse(readFileSync(modelPath, 'utf8'));
  } catch (_) {}

  /* Per-block score. */
  const blockScores = {};
  for (const b of manifest.blocks) {
    const stateKeys = deriveStateMarkers(b.name);
    const domSels = deriveDomSelectors(b.name);
    const hasState = stateKeys.some(k => snap.globalKeys.includes(k));
    const hasDom = (
      snap.dataBlocks.includes(b.name) ||
      snap.dataBlocks.includes(b.name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()) ||
      snap.ids.includes(b.name) ||
      snap.ids.includes(b.name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()) ||
      snap.classes.includes(b.name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase())
    );
    const hooks = b.lifecycleHooks || [];
    const allHooked = hooks.length === 0 ? false : hooks.every(e => (snap.listenerCounts[e] || 0) >= 1);
    const someHooked = hooks.length === 0 ? false : hooks.some(e => (snap.listenerCounts[e] || 0) >= 1);

    /* Declared enable status from model — check both top-level key + per-feature kind. */
    let declared = null;
    if (model) {
      const m = model[b.name];
      if (m && typeof m.enabled === 'boolean') declared = m.enabled;
      else if (m) declared = true; // present in model
    }
    let score = 0;
    if (hasState) score++;
    if (hasDom) score++;
    if (allHooked) score++;
    /* If allHooked false but someHooked true and block declares > 1 hooks,
       still partial signal. */
    blockScores[b.name] = {
      score,
      hasState,
      hasDom,
      allHooked,
      someHooked,
      declared,
      hooks: hooks.length,
    };
  }

  await ctx.close();
  return {
    game: gameDir,
    warmupOk,
    errors,
    blockScores,
  };
}

async function main() {
  log('\n🎰 ULTIMATE BLOCK × GDD MATRIX · D-9');
  const manifestRaw = readFileSync(MANIFEST_PATH, 'utf8');
  const manifest = JSON.parse(manifestRaw);
  log(`   Blocks: ${manifest.blocks.length}`);
  const games = readdirSync(DIST).filter((g) => existsSync(resolve(DIST, g, 'slot.html'))).sort();
  log(`   GDDs:   ${games.length} (${games.join(', ')})`);
  log('');

  if (games.length === 0) {
    console.error('FATAL: nema dist/real-games/<game>/slot.html');
    process.exit(2);
  }

  const browser = await chromium.launch({ headless: true });
  const perGameResults = {};
  for (const g of games) {
    const t0 = Date.now();
    log(`▸ ${g}`);
    try {
      const r = await runOneGame(browser, g, manifest);
      perGameResults[g] = r;
      const active = Object.values(r.blockScores).filter(s => s.score >= 1).length;
      log(`   ${active}/${manifest.blocks.length} blokova active · ${r.errors.console.length + r.errors.page.length} err · ${((Date.now()-t0)/1000).toFixed(1)}s`);
    } catch (e) {
      log('   ❌ FAILED:', String(e).slice(0, 200));
      perGameResults[g] = { game: g, error: String(e) };
    }
  }
  await browser.close();

  /* Build cross-GDD aggregate per block. */
  const blockAggregate = {};
  for (const b of manifest.blocks) {
    const perGdd = {};
    let activeGddCount = 0;
    let consistentGddCount = 0;
    let firstActiveSignal = null;
    for (const g of games) {
      const r = perGameResults[g];
      if (!r || !r.blockScores) { perGdd[g] = null; continue; }
      const s = r.blockScores[b.name];
      perGdd[g] = s;
      if (s.score >= 1) {
        activeGddCount++;
        if (!firstActiveSignal) firstActiveSignal = { hasState: s.hasState, hasDom: s.hasDom, allHooked: s.allHooked };
      }
    }
    /* Consistency check: ako je blok active u BAR jednom GDD-u, ostali sa
       active = isti signal pattern → consistent. */
    if (firstActiveSignal) {
      for (const g of games) {
        const s = perGdd[g];
        if (s && s.score >= 1) {
          const same = s.hasState === firstActiveSignal.hasState
                    && s.hasDom   === firstActiveSignal.hasDom
                    && s.allHooked === firstActiveSignal.allHooked;
          if (same) consistentGddCount++;
        }
      }
    }
    blockAggregate[b.name] = {
      perGdd,
      activeGddCount,
      consistentGddCount,
      hooks: b.lifecycleHooks || [],
    };
  }

  /* Persist full matrix. */
  const stamp = Date.now();
  const outPath = resolve(OUT, `run-${stamp}.json`);
  writeFileSync(outPath, JSON.stringify({ stamp, games, manifest: { total: manifest.blocks.length }, perGameResults, blockAggregate }, null, 2));

  /* Compute SUMMARY. */
  log('\n══════════════════════════════════════════════════════════════════════');
  log('SUMMARY · BLOCK × GDD MATRIX');
  log('══════════════════════════════════════════════════════════════════════');
  let totalBlocks = manifest.blocks.length;
  let activeInAllGames = 0;     // blok active u SVIM GDD-ovima
  let activeInSome = 0;          // active u 1..N-1 GDD-ova
  let inactiveEverywhere = 0;    // 0 GDD aktivnih
  let inconsistent = 0;          // active u >1 GDD-ova ali sa različitim signal pattern-om
  for (const name of Object.keys(blockAggregate)) {
    const a = blockAggregate[name];
    if (a.activeGddCount === games.length) activeInAllGames++;
    else if (a.activeGddCount === 0) inactiveEverywhere++;
    else activeInSome++;
    if (a.activeGddCount > 1 && a.consistentGddCount !== a.activeGddCount) inconsistent++;
  }
  log(`  Σ blokova ukupno:            ${totalBlocks}`);
  log(`  ✓ Active u SVIM GDD-ovima:   ${activeInAllGames}`);
  log(`  ◐ Active u nekima:           ${activeInSome}`);
  log(`  ◯ Inactive svuda:            ${inactiveEverywhere} (verovatno opt-in/disabled defaultno)`);
  log(`  ⚠ Inconsistent signal:       ${inconsistent}`);
  log('');

  /* List inconsistent blocks (most relevant for "ne radi isto u svakom GDD"). */
  if (inconsistent > 0) {
    log('  ── BLOKOVI SA NEKONZISTENTNIM SIGNAL-OM (rade drugačije u različitim GDD-ovima):');
    for (const name of Object.keys(blockAggregate)) {
      const a = blockAggregate[name];
      if (a.activeGddCount > 1 && a.consistentGddCount !== a.activeGddCount) {
        const breakdown = games.map(g => {
          const s = a.perGdd[g];
          if (!s || s.score === 0) return `${g.slice(0,12)}=◯`;
          const flags = (s.hasState ? 'S' : '.') + (s.hasDom ? 'D' : '.') + (s.allHooked ? 'H' : '.');
          return `${g.slice(0,12)}=${flags}`;
        }).join(' ');
        log(`     ✗ ${name.padEnd(34)} ${breakdown}`);
      }
    }
    log('');
  }

  /* List blocks active in some but not all (potentially expected per-GDD config). */
  if (activeInSome > 0 && activeInSome <= 20) {
    log(`  ── BLOKOVI U 1..${games.length-1} GDD-OVA (per-GDD opt-in, possibly correct):`);
    for (const name of Object.keys(blockAggregate)) {
      const a = blockAggregate[name];
      if (a.activeGddCount > 0 && a.activeGddCount < games.length) {
        const breakdown = games.map(g => {
          const s = a.perGdd[g];
          return `${g.slice(0,12)}=${s && s.score >= 1 ? '✓' : '◯'}`;
        }).join(' ');
        log(`     ◐ ${name.padEnd(34)} ${breakdown}`);
      }
    }
    log('');
  }

  log(`   Report: ${outPath}\n`);

  /* Exit code: 0 if no inconsistent (cross-GDD parity OK), 1 otherwise. */
  process.exit(inconsistent === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(2); });
