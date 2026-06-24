#!/usr/bin/env node
/**
 * tests/contracts/expanding-wild-deep-q.test.mjs
 *
 * UQ-DEEP-Q regression suite — pins fixes from Boki's report
 * "expanding wild ne radoi pravilno" (2026-06-24) verified across two
 * parallel agents (local industry standard spec discovery + web research + code audit).
 *
 * Coverage (8 stamps):
 *   • B2 CRIT — appliesOnReels inherited from features[].config
 *   • B3 HIGH — FSM phase regex /^FS_/ unified
 *   • B4 CRIT — Hold & Win gate present
 *   • B5 CRIT — re-eval signal emitted post-expansion (the "ne radi" bug)
 *   • B6 MED  — winPresentation .cell--winsym class recognized
 *   • B8 CRIT — _scanGridForWildReels DOM fallback when payload no grid
 *   • B9 HIGH — _onPreSpin clears state even under H&W (soft clear)
 *   • B10 MED — expandingWildMultiplier features[].config inheritance
 *   • Whitelisted onReelsMutated event in HookBus
 *
 * Exit 0 PASS, 1 FAIL.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');

let pass = 0, fail = 0;
const failures = [];

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

async function test(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fail++;
    failures.push({ name, error: e.message });
    console.log(`  ✗ ${name} — ${e.message}`);
  }
}

console.log('═══ expanding-wild-deep-q.test.mjs ═══');

/* ────────────────────────────────────────────────────────────────────── */

await test('B2 CRIT: resolveConfig inherits appliesOnReels from features[].config', async () => {
  const mod = await import(resolve(REPO, 'src/blocks/expandingWild.mjs'));
  const cfg = mod.resolveConfig({
    features: [{ kind: 'expanding_wild', config: { appliesOnReels: [2, 3, 4, 5] } }],
  });
  assert(cfg.enabled === true, 'enabled not flipped on by features[]');
  assert(Array.isArray(cfg.appliesOnReels), 'appliesOnReels not set');
  assert(cfg.appliesOnReels.length === 4, `expected 4 reels, got ${cfg.appliesOnReels.length}`);
  assert(cfg.appliesOnReels.includes(2), 'reel 2 missing');
  assert(cfg.appliesOnReels.includes(5), 'reel 5 missing');
});

await test('B2 CRIT: resolveConfig features[].config also reads mode + wildSymbolId + onlyIfWinning', async () => {
  const mod = await import(resolve(REPO, 'src/blocks/expandingWild.mjs'));
  const cfg = mod.resolveConfig({
    features: [{
      kind: 'expanding_wild',
      config: {
        appliesOnReels: [3],
        mode: 'base',
        wildSymbolId: 'WI',
        onlyIfWinning: true,
      },
    }],
  });
  assert(cfg.mode === 'base', `mode not 'base': ${cfg.mode}`);
  assert(cfg.wildSymbolId === 'WI', `wildSymbolId not 'WI': ${cfg.wildSymbolId}`);
  assert(cfg.onlyIfWinning === true, `onlyIfWinning not true: ${cfg.onlyIfWinning}`);
});

await test('B2 CRIT: top-level model.expandingWild takes precedence over features[].config', async () => {
  const mod = await import(resolve(REPO, 'src/blocks/expandingWild.mjs'));
  const cfg = mod.resolveConfig({
    expandingWild: { mode: 'fs' },
    features: [{ kind: 'expanding_wild', config: { mode: 'base' } }],
  });
  assert(cfg.mode === 'fs', `top-level expandingWild.mode should win: got ${cfg.mode}`);
});

/* ────────────────────────────────────────────────────────────────────── */

await test('B3 HIGH: runtime uses /^FS_/ regex for phase check', async () => {
  const src = readFileSync(resolve(REPO, 'src/blocks/expandingWild.mjs'), 'utf8');
  assert(src.includes('/^FS_/.test(ph)'), 'phase regex test missing');
  /* Old strict equality should be gone in code (comment may reference). */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert(!/ph === 'FS_ACTIVE'/.test(code), "strict 'FS_ACTIVE' check still present");
});

/* ────────────────────────────────────────────────────────────────────── */

await test('B4 CRIT: H&W gate function present', async () => {
  const src = readFileSync(resolve(REPO, 'src/blocks/expandingWild.mjs'), 'utf8');
  assert(src.includes('_expWildHwActive'), 'H&W gate function missing');
  assert(src.includes('HW_STATE'), 'HW_STATE check missing');
  /* Gate must be called inside applyExpandingWilds. */
  assert(/if \(!_isForcedExpand && _expWildHwActive\(\)\) return \[\]/.test(src),
    'H&W gate not wired in applyExpandingWilds');
});

/* ────────────────────────────────────────────────────────────────────── */

await test('B5 CRIT: post-expansion re-eval signals emitted', async () => {
  const src = readFileSync(resolve(REPO, 'src/blocks/expandingWild.mjs'), 'utf8');
  /* Three channels must exist. */
  assert(src.includes('__LAST_SPIN_GRID_MUTATED__'), 'mutation flag missing');
  assert(src.includes("'onReelsMutated'"), 'onReelsMutated event missing');
  assert(/HookBus\.emit\('onSpinResult', \{.*reEval: true/.test(src),
    'onSpinResult re-fire with reEval marker missing');
});

await test('B5 CRIT: anti-recursion guard on reEval-marked spin', async () => {
  const src = readFileSync(resolve(REPO, 'src/blocks/expandingWild.mjs'), 'utf8');
  assert(src.includes('spinPayload.reEval === true'),
    'anti-recursion guard missing');
  assert(src.includes("spinPayload.source === 'expandingWild'"),
    'source-marker check missing');
});

await test('B5 CRIT: onReelsMutated event whitelisted in HookBus', async () => {
  const src = readFileSync(resolve(REPO, 'src/blocks/hookBus.mjs'), 'utf8');
  assert(src.includes("'onReelsMutated'"),
    'onReelsMutated not whitelisted in HookBus');
});

/* ────────────────────────────────────────────────────────────────────── */

await test('B6 MED: gate recognizes .cell--winsym (winPresentation actual class)', async () => {
  const src = readFileSync(resolve(REPO, 'src/blocks/expandingWild.mjs'), 'utf8');
  assert(src.includes('.cell--winsym'),
    'pravi class .cell--winsym not in gate selector');
});

/* ────────────────────────────────────────────────────────────────────── */

await test('B8 CRIT: expandingWildMultiplier DOM fallback for grid scan', async () => {
  const src = readFileSync(resolve(REPO, 'src/blocks/expandingWildMultiplier.mjs'), 'utf8');
  assert(src.includes('[data-reel]'), 'DOM fallback selector missing');
  assert(src.includes('document.querySelectorAll'), 'querySelectorAll fallback missing');
  /* Logic check: fallback must execute when grid is NOT array. */
  assert(/if \(typeof document === 'undefined'\) return reels/.test(src),
    'DOM fallback guard missing');
});

/* ────────────────────────────────────────────────────────────────────── */

await test('B9 HIGH: _onPreSpin soft-clears state under H&W', async () => {
  const src = readFileSync(resolve(REPO, 'src/blocks/expandingWildMultiplier.mjs'), 'utf8');
  /* Old behavior was early return — new behavior is soft clear. */
  assert(src.includes('Soft clear'), 'soft-clear comment missing');
  /* Must explicitly null EWM_STATE.activeReels even under H&W. */
  assert(/window\.EWM_STATE\.activeReels = new Map\(\)/.test(src),
    'EWM_STATE clear missing');
});

/* ────────────────────────────────────────────────────────────────────── */

await test('B10 MED: expandingWildMultiplier inherits features[].config', async () => {
  const mod = await import(resolve(REPO, 'src/blocks/expandingWildMultiplier.mjs'));
  const cfg = mod.resolveConfig({
    features: [{
      kind: 'expanding_wild_multiplier',
      config: {
        appliesIn: 'base',
        aggregation: 'additive',
        distribution: [{ value: 5, weight: 2 }, { value: 10, weight: 1 }],
      },
    }],
  });
  assert(cfg.enabled === true, 'enabled not flipped on');
  assert(cfg.appliesIn === 'base', `appliesIn not 'base': ${cfg.appliesIn}`);
  assert(cfg.aggregation === 'additive', `aggregation not 'additive': ${cfg.aggregation}`);
  assert(Array.isArray(cfg.distribution) && cfg.distribution.length === 2,
    `distribution length: ${cfg.distribution.length}`);
});

/* ────────────────────────────────────────────────────────────────────── */
/* End-to-end behavioral test — render slot.html, check DOM contract. */

await test('E2E: buildSlotHTML emits expanding wild block with appliesOnReels [2,3,4,5]', async () => {
  const { buildSlotHTML } = await import(resolve(REPO, 'src/buildSlotHTML.mjs'));
  const model = {
    name: 'TestExpW',
    topology: { reels: 5, rows: 3, paylines: 20, kind: 'rectangular' },
    theme: { tags: ['classic'], palette: { primary: '#000', accent: '#fff', wild: '#ffd700' }, mood: 'neutral' },
    symbols: { high: ['A','K'], mid: ['Q','J'], low: ['10','9'], specials: [{ id: 'W', kind: 'wild' }] },
    features: [{
      kind: 'expanding_wild',
      label: 'Expanding Wild',
      config: { appliesOnReels: [2, 3, 4, 5], mode: 'base', onlyIfWinning: true },
    }],
    payback: { rtp: 0.96 },
  };
  const html = buildSlotHTML(model);
  assert(html.includes('EXPANDING_WILD_APPLIES_ON_REELS_RAW'),
    'runtime constant for appliesOnReels missing');
  /* The 1-indexed array from GDD must end up in the runtime as [2,3,4,5]. */
  assert(/EXPANDING_WILD_APPLIES_ON_REELS_RAW\s*=\s*\[2,3,4,5\]/.test(html),
    'appliesOnReels not propagated to runtime');
  assert(html.includes("EXPANDING_WILD_MODE   = \"base\""),
    'mode not propagated to runtime');
  assert(html.includes('EXPANDING_WILD_ONLY_IF_WINNING = true'),
    'onlyIfWinning not propagated to runtime');
});

await test('E2E: slot.html emits H&W gate function in runtime', async () => {
  const { buildSlotHTML } = await import(resolve(REPO, 'src/buildSlotHTML.mjs'));
  const html = buildSlotHTML({
    name: 'TestExpW',
    topology: { reels: 5, rows: 3, paylines: 20, kind: 'rectangular' },
    theme: { tags: ['classic'], palette: { primary: '#000', accent: '#fff', wild: '#ffd700' }, mood: 'neutral' },
    symbols: { high: ['A','K'], mid: ['Q','J'], low: ['10','9'], specials: [{ id: 'W', kind: 'wild' }] },
    features: [{ kind: 'expanding_wild' }],
    payback: { rtp: 0.96 },
  });
  assert(html.includes('_expWildHwActive'),
    'H&W gate function not emitted in slot.html runtime');
  assert(html.includes('onReelsMutated'),
    'onReelsMutated event not emitted in slot.html runtime');
});

/* ────────────────────────────────────────────────────────────────────── */

console.log('');
console.log(`═══ ${pass} PASS · ${fail} FAIL ═══`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.error}`);
  process.exit(1);
}
process.exit(0);
