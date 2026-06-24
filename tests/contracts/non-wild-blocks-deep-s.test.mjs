#!/usr/bin/env node
/**
 * tests/contracts/non-wild-blocks-deep-s.test.mjs
 *
 * UQ-DEEP-S regression suite (2026-06-24) — sister-block parity audit
 * proširen sa wild blokova na non-wild bonus/feature/multiplier/cluster
 * blokove + E2E live runtime finding-e iz Cash Eruption smoke.
 *
 * Coverage:
 *   CRIT-1 superSymbolUpgrade P6 (data-symbol + GRID + symbolOverride)
 *   CRIT-2 symbolSplitReveal P6 partial fix
 *   CRIT-3 mysterySymbolMultiplier race (HookBus.addMult)
 *   CRIT-4 holdAndWin P2 (features.config inheritance + kind alias)
 *   HIGH-5 multiplierOrb P4 + P2 + 3× FSM regex
 *   HIGH-6 clusterPaysEval P3 (H&W gate)
 *   HIGH-7 wheelBonus P2 (segments/duration/title from features.config)
 *   HIGH-9 persistentMultiplier P4 (/^FS_/ + /^BASE/ regex)
 *   HIGH-10 persistentMultiplier P2 (features.config inheritance)
 *   E2E: anti-vendor display name scrub <title> + .title + __MODEL_NAME__
 *   E2E: math-backend convergence_pass strict gate
 *   E2E: sessionId pass-through (no vendor scrub on client-id strings)
 *   MED-12 holdAndWin /^FS_/ regex
 *
 * Exit 0 PASS, 1 FAIL.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

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

console.log('═══ non-wild-blocks-deep-s.test.mjs ═══');

/* ────────────────────────────────────────────────────────────────────── */
/* CRIT-1 superSymbolUpgrade P6 */
await test('CRIT-1 superSymbolUpgrade: data-symbol + GRID + symbolOverride emit', async () => {
  const src = readFileSync(resolve(REPO, 'src/blocks/superSymbolUpgrade.mjs'), 'utf8');
  assert(src.includes("setAttribute('data-symbol'"), 'data-symbol setAttribute missing');
  assert(src.includes('window.GRID.set'), 'window.GRID.set missing');
  assert(/HookBus\.emit\('symbolOverride'/.test(src), 'symbolOverride emit missing');
});

/* CRIT-2 symbolSplitReveal P6 partial */
await test('CRIT-2 symbolSplitReveal: GRID + symbolOverride added (data-symbol already had)', async () => {
  const src = readFileSync(resolve(REPO, 'src/blocks/symbolSplitReveal.mjs'), 'utf8');
  assert(src.includes('window.GRID.set'), 'window.GRID.set missing');
  assert(/HookBus\.emit\('symbolOverride'/.test(src), 'symbolOverride emit missing');
});

/* CRIT-3 mysterySymbolMultiplier race */
await test('CRIT-3 mysterySymbolMultiplier: addMult() canonical API, no HookBus.lastMult read', async () => {
  const src = readFileSync(resolve(REPO, 'src/blocks/mysterySymbolMultiplier.mjs'), 'utf8');
  assert(src.includes('window.HookBus.addMult(sum)'), 'addMult call missing');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert(!/HookBus\.lastMult/.test(code), 'non-canonical HookBus.lastMult still read');
});

/* CRIT-4 holdAndWin P2 */
await test('CRIT-4 holdAndWin: features[].config inheritance with kind alias', async () => {
  const mod = await import(resolve(REPO, 'src/blocks/holdAndWin.mjs'));
  const cfg = mod.resolveConfig({
    features: [{ kind: 'hold_and_win', config: {
      triggerCount: 7, bonusSymbolId: 'B', respinsAwarded: 4, fullGridBonusX: 500,
    }}],
  });
  assert(cfg.enabled === true, 'enabled not flipped');
  assert(cfg.triggerCount === 7, `triggerCount=${cfg.triggerCount}, expected 7`);
  assert(cfg.bonusSymbolId === 'B', `bonusSymbolId=${cfg.bonusSymbolId}`);
  assert(cfg.respinsAwarded === 4, `respinsAwarded=${cfg.respinsAwarded}`);
  assert(cfg.fullGridBonusX === 500, `fullGridBonusX=${cfg.fullGridBonusX}`);
  /* camelCase kind alias must also work. */
  const cfg2 = mod.resolveConfig({
    features: [{ kind: 'holdAndWin', config: { triggerCount: 8 } }],
  });
  assert(cfg2.triggerCount === 8, `camelCase alias failed: ${cfg2.triggerCount}`);
});

/* HIGH-5 multiplierOrb P4 + P2 */
await test('HIGH-5 multiplierOrb: /^FS_/ regex (no strict FS_ACTIVE)', async () => {
  const src = readFileSync(resolve(REPO, 'src/blocks/multiplierOrb.mjs'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  assert(!/FSM\.phase === 'FS_ACTIVE'/.test(code), 'strict FS_ACTIVE still present');
  assert(src.includes('/^FS_/.test(FSM.phase)'), 'regex not present');
});

await test('HIGH-11 multiplierOrb: features.config inherits distribution', async () => {
  const mod = await import(resolve(REPO, 'src/blocks/multiplierOrb.mjs'));
  const cfg = mod.resolveConfig({
    features: [{ kind: 'multiplier_orb', config: {
      symbolId: 'MO',
      distribution: [{ value: 5, weight: 1 }, { value: 10, weight: 1 }],
    }}],
  });
  assert(cfg.enabled === true, 'enabled not flipped');
  assert(cfg.symbolId === 'MO', `symbolId=${cfg.symbolId}`);
  assert(Array.isArray(cfg.distribution) && cfg.distribution.length === 2,
    `distribution=${cfg.distribution?.length}`);
});

/* HIGH-6 clusterPaysEval P3 */
await test('HIGH-6 clusterPaysEval: H&W gate present in reels:stopped handler', async () => {
  const src = readFileSync(resolve(REPO, 'src/blocks/clusterPaysEval.mjs'), 'utf8');
  assert(/if \(window\.HW_STATE && window\.HW_STATE\.active === true\) return/.test(src),
    'H&W gate missing');
});

/* HIGH-7 wheelBonus P2 */
await test('HIGH-7 wheelBonus: features.config inherits segments', async () => {
  const mod = await import(resolve(REPO, 'src/blocks/wheelBonus.mjs'));
  const cfg = mod.resolveConfig({
    features: [{ kind: 'wheel_bonus', config: {
      segments: [
        { label: 'GOLD', value: 100 }, { label: 'SILVER', value: 50 },
        { label: 'BRONZE', value: 25 }, { label: 'EMPTY', value: 0 },
      ],
      spinDurationMs: 4500,
      title: 'Wheel Spin',
    }}],
  });
  assert(cfg.enabled === true, 'enabled not flipped');
  assert(Array.isArray(cfg.segments) && cfg.segments.length === 4,
    `segments=${cfg.segments?.length}, expected 4`);
  assert(cfg.spinDurationMs === 4500, `spinDurationMs=${cfg.spinDurationMs}`);
  assert(cfg.title === 'Wheel Spin', `title=${cfg.title}`);
});

/* HIGH-9 + HIGH-10 persistentMultiplier */
await test('HIGH-9 persistentMultiplier: /^FS_/ + /^BASE/ regex', async () => {
  const src = readFileSync(resolve(REPO, 'src/blocks/persistentMultiplier.mjs'), 'utf8');
  assert(src.includes('/^FS_/.test(ph)'), 'FS regex missing');
  assert(src.includes('/^BASE/.test(ph)'), 'BASE regex missing');
});

await test('HIGH-10 persistentMultiplier: features.config inherits growPerWin/maxMult', async () => {
  const mod = await import(resolve(REPO, 'src/blocks/persistentMultiplier.mjs'));
  const cfg = mod.resolveConfig({
    features: [{ kind: 'persistent_multiplier', config: {
      mode: 'fs', growPerWin: 2, maxMult: 100, startMult: 1,
    }}],
  });
  assert(cfg.enabled === true, 'enabled not flipped');
  assert(cfg.mode === 'fs', `mode=${cfg.mode}`);
  assert(cfg.growPerWin === 2, `growPerWin=${cfg.growPerWin}`);
  assert(cfg.maxMult === 100, `maxMult=${cfg.maxMult}`);
});

/* MED-12 holdAndWin P4 */
await test('MED-12 holdAndWin: /^FS_/ regex in body (no triple-OR strict)', async () => {
  const src = readFileSync(resolve(REPO, 'src/blocks/holdAndWin.mjs'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  assert(!/FSM\.phase === 'FS_INTRO' \|\| FSM\.phase === 'FS_ACTIVE' \|\| FSM\.phase === 'FS_OUTRO'/.test(code),
    'old triple-OR strict still present');
  assert(/\/\^FS_\/\.test\(FSM\.phase\)/.test(src), 'regex form missing');
});

/* ────────────────────────────────────────────────────────────────────── */
/* E2E: anti-vendor display name scrub */

await test('E2E anti-vendor: buildSlotHTML defines neutralDisplayName helper', async () => {
  const src = readFileSync(resolve(REPO, 'src/buildSlotHTML.mjs'), 'utf8');
  assert(src.includes('neutralDisplayName'), 'helper missing');
  assert(src.includes('DISPLAY_VENDOR_RX'), 'display regex missing');
  assert(src.includes('const displayName = neutralDisplayName(model.name)'),
    'displayName const not used at render time');
});

await test('E2E anti-vendor: Cash Eruption rebuilt HTML has zero "cash eruption" leaks', async () => {
  const distPath = resolve(REPO, 'dist/ingest/cash-eruption-foundry-gdd/index.html');
  if (!existsSync(distPath)) {
    throw new Error('Cash Eruption dist not built — run ingest');
  }
  const html = readFileSync(distPath, 'utf8');
  const matches = html.match(/cash[ -]eruption/gi);
  assert(!matches || matches.length === 0,
    `${matches?.length || 0} vendor leak(s) found in rebuilt HTML`);
  /* Title must be neutralized. */
  assert(html.includes('<title>[Slot] · Base Game</title>'),
    '<title> not neutralized');
  assert(html.includes('"[Slot]"') || html.includes("'[Slot]'"),
    '__MODEL_NAME__ not neutralized');
});

/* ────────────────────────────────────────────────────────────────────── */
/* E2E: convergence_pass strict gate + sessionId pass-through */

await test('E2E math-backend: convergence_pass strict gate present', async () => {
  const src = readFileSync(resolve(REPO, 'tools/math-backend.mjs'), 'utf8');
  assert(src.includes('CONVERGENCE_PRECISION_PCT'), 'precision constant missing');
  assert(src.includes('CONVERGENCE_CI_HALFWIDTH'), 'halfwidth constant missing');
  assert(src.includes('convergence_pass_rust'), 'preserved Rust verdict missing');
  assert(src.includes('convergence_criterion'), 'criterion debug object missing');
});

await test('E2E math-backend: sessionId pass-through (no vendor scrub on client IDs)', async () => {
  const src = readFileSync(resolve(REPO, 'tools/math-backend.mjs'), 'utf8');
  assert(src.includes("k === 'sessionId'"),
    'sessionId pass-through guard missing');
  assert(src.includes("k === 'source'"),
    'source pass-through guard missing');
});

/* ────────────────────────────────────────────────────────────────────── */
/* SOURCE PRECEDENCE — top-level model.xxx wins over features.config */

await test('SOURCE PRECEDENCE holdAndWin: top-level beats features.config', async () => {
  const mod = await import(resolve(REPO, 'src/blocks/holdAndWin.mjs'));
  const cfg = mod.resolveConfig({
    holdAndWin: { triggerCount: 10 },
    features: [{ kind: 'hold_and_win', config: { triggerCount: 5 } }],
  });
  assert(cfg.triggerCount === 10, `top-level should win, got: ${cfg.triggerCount}`);
});

await test('SOURCE PRECEDENCE wheelBonus: top-level beats features.config', async () => {
  const mod = await import(resolve(REPO, 'src/blocks/wheelBonus.mjs'));
  const cfg = mod.resolveConfig({
    wheelBonus: { title: 'TopLvl' },
    features: [{ kind: 'wheel_bonus', config: { title: 'FromFeat' } }],
  });
  assert(cfg.title === 'TopLvl', `top-level should win, got: ${cfg.title}`);
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
