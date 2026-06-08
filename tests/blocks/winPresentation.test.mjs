/**
 * Unit test for src/blocks/winPresentation.mjs
 *
 * Validates the LEGO block contract:
 *   1. defaultConfig has stable shape, frozen
 *   2. resolveConfig accepts known overrides, rejects junk
 *   3. resolveConfig clamps and validates values
 *   4. emitWinPresentationRuntime returns string containing every required
 *      runtime symbol (detectLineWins, playWinSymCycle, applyWinHighlight,
 *      cancelWinSymCycle, WINSYM_CYCLE_TOKEN)
 *   5. emitted runtime bakes config values as literals (perEventMs,
 *      maxEvents, noWinChance) — runtime doesn't pay config-object cost
 *   6. winCycle === false at GDD level disables the cycle in the emitted
 *      runtime (matches inline behavior pre-block migration)
 */

import { strict as assert } from 'node:assert';
import {
  defaultConfig,
  resolveConfig,
  emitWinPresentationRuntime,
  emitDetectWinCombosRuntime,
} from '../../src/blocks/winPresentation.mjs';
import { parseGDD, extractWinPresentation } from '../../src/parser.mjs';

let fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

console.log('\n— blocks/winPresentation.mjs —');

t('defaultConfig: stable shape', () => {
  const c = defaultConfig();
  assert.equal(c.mode, 'per-line');
  assert.equal(c.perEventMs, 'auto');
  assert.equal(c.maxEvents, 8);
  assert.equal(c.noWinChance, 0.30);
  assert.equal(c.winCycle, true);
});

t('defaultConfig: returns fresh copy (not the frozen source)', () => {
  const a = defaultConfig();
  const b = defaultConfig();
  assert.notEqual(a, b, 'should be separate objects');
  a.mode = 'cluster';
  assert.equal(b.mode, 'per-line', 'mutating one should not affect the other');
});

t('resolveConfig: empty model → defaults', () => {
  const c = resolveConfig({});
  assert.deepEqual(c, defaultConfig());
});

t('resolveConfig: GDD override wins for valid mode', () => {
  const c = resolveConfig({ winPresentation: { mode: 'cluster' } });
  assert.equal(c.mode, 'cluster');
});

t('resolveConfig: invalid mode falls back to default', () => {
  const c = resolveConfig({ winPresentation: { mode: 'invalid-junk' } });
  assert.equal(c.mode, 'per-line');
});

/* ── Wave V5 — cascade-stagger mode ────────────────────────────────── */

t('Wave V5: cascade-stagger is a valid mode', () => {
  const c = resolveConfig({ winPresentation: { mode: 'cascade-stagger' } });
  assert.equal(c.mode, 'cascade-stagger');
});

t('Wave V5: defaultConfig has staggerStepMs = 80', () => {
  assert.equal(defaultConfig().staggerStepMs, 80);
});

t('Wave V5: staggerStepMs bounded 20..500', () => {
  assert.equal(resolveConfig({ winPresentation: { staggerStepMs: 120 } }).staggerStepMs, 120);
  assert.equal(resolveConfig({ winPresentation: { staggerStepMs: 10 } }).staggerStepMs, 80);
  assert.equal(resolveConfig({ winPresentation: { staggerStepMs: 9999 } }).staggerStepMs, 80);
  assert.equal(resolveConfig({ winPresentation: { staggerStepMs: 'fast' } }).staggerStepMs, 80);
});

t('Wave V5: runtime emit bakes staggerStepMs as perEventMs literal when mode=cascade-stagger', () => {
  const js = emitWinPresentationRuntime({ ...defaultConfig(), mode: 'cascade-stagger', staggerStepMs: 90 });
  /* Cascade mode overrides perEventMs adaptive — staggerStepMs literal must appear. */
  assert.ok(js.includes('const adaptive = 90'), 'expected adaptive=90 from staggerStepMs');
});

t('Wave V5: runtime emit keeps adaptive perEventMs when mode != cascade-stagger', () => {
  const js = emitWinPresentationRuntime({ ...defaultConfig(), mode: 'per-line' });
  /* per-line mode → adaptive `(events.length <= 4 ? 500 : 400)`, NOT a bare literal. */
  assert.ok(/const adaptive = \(events\.length/.test(js),
    'expected adaptive ternary for per-line mode');
});

t('Wave V5: runtime emit header documents the V5 cascade-stagger knob', () => {
  const js = emitWinPresentationRuntime();
  assert.ok(/Wave V5.*cascade-stagger/.test(js),
    'runtime header must reference V5 knob');
});

t('resolveConfig: numeric perEventMs accepted', () => {
  const c = resolveConfig({ winPresentation: { perEventMs: 350 } });
  assert.equal(c.perEventMs, 350);
});

t('resolveConfig: negative perEventMs rejected → default', () => {
  const c = resolveConfig({ winPresentation: { perEventMs: -100 } });
  assert.equal(c.perEventMs, 'auto');
});

t('resolveConfig: maxEvents bounded to 1..50', () => {
  assert.equal(resolveConfig({ winPresentation: { maxEvents: 12 } }).maxEvents, 12);
  assert.equal(resolveConfig({ winPresentation: { maxEvents: 100 } }).maxEvents, 8);
  assert.equal(resolveConfig({ winPresentation: { maxEvents: 0 } }).maxEvents, 8);
});

t('resolveConfig: noWinChance bounded to [0,1]', () => {
  assert.equal(resolveConfig({ winPresentation: { noWinChance: 0.5 } }).noWinChance, 0.5);
  assert.equal(resolveConfig({ winPresentation: { noWinChance: 1.5 } }).noWinChance, 0.30);
  assert.equal(resolveConfig({ winPresentation: { noWinChance: -0.1 } }).noWinChance, 0.30);
});

t('resolveConfig: winCycle=false honored', () => {
  const c = resolveConfig({ winPresentation: { winCycle: false } });
  assert.equal(c.winCycle, false);
});

t('emitWinPresentationRuntime: emits all required runtime symbols', () => {
  const src = emitWinPresentationRuntime();
  for (const sym of ['detectLineWins', 'playWinSymCycle', 'applyWinHighlight', 'cancelWinSymCycle', 'WINSYM_CYCLE_TOKEN']) {
    assert.ok(src.includes(sym), `runtime missing: ${sym}`);
  }
});

t('emitWinPresentationRuntime: bakes maxEvents as literal', () => {
  const src = emitWinPresentationRuntime({ maxEvents: 12 });
  assert.ok(src.includes('MAX_EVENTS = 12'), 'maxEvents not baked as 12');
});

t('emitWinPresentationRuntime: bakes noWinChance as literal', () => {
  const src = emitWinPresentationRuntime({ noWinChance: 0.5 });
  assert.ok(src.includes('Math.random() < 0.5'), 'noWinChance not baked');
});

t('emitWinPresentationRuntime: auto perEventMs → adaptive expression', () => {
  const src = emitWinPresentationRuntime({ perEventMs: 'auto' });
  assert.ok(src.includes('events.length <= 4 ? 500 : 400'), 'adaptive expression missing');
});

t('emitWinPresentationRuntime: numeric perEventMs → constant', () => {
  const src = emitWinPresentationRuntime({ perEventMs: 350 });
  assert.ok(src.includes('const adaptive = 350'), 'numeric perEventMs not baked');
});

t('emitWinPresentationRuntime: winCycle=false short-circuits the cycle', () => {
  const src = emitWinPresentationRuntime({ winCycle: false });
  // When winCycle is false at block-config level, the emitted gate evaluates
  // to true on the SECOND OR — i.e. the cycle returns immediately.
  assert.ok(src.includes('|| true'), 'winCycle=false gate missing');
});

t('emitWinPresentationRuntime: winCycle=true keeps cycle alive', () => {
  const src = emitWinPresentationRuntime({ winCycle: true });
  assert.ok(src.includes('|| false'), 'winCycle=true gate missing');
});

/* ── Parser → block integration ─────────────────────────────────────────── */

t('parser: GDD without Win Presentation section → undefined slots', () => {
  const gdd = '# Test\n## Topology\n| Reels | 5 |\n';
  const out = parseGDD(gdd, 'md');
  assert.equal(out.winPresentation.mode, undefined);
  assert.equal(out.winPresentation.perEventMs, undefined);
  assert.equal(out.winPresentation.maxEvents, undefined);
});

t('parser: explicit Win Presentation section → populated slots', () => {
  const gdd = [
    '# Test',
    '## Win Presentation',
    '- mode: cluster',
    '- per-event-ms: 250',
    '- max-events: 16',
    '- no-win-chance: 0.20',
    '- win-cycle: true',
    ''
  ].join('\n');
  const out = parseGDD(gdd, 'md');
  assert.equal(out.winPresentation.mode, 'cluster');
  assert.equal(out.winPresentation.perEventMs, 250);
  assert.equal(out.winPresentation.maxEvents, 16);
  assert.equal(out.winPresentation.noWinChance, 0.20);
  assert.equal(out.winPresentation.winCycle, true);
});

t('parser: heading variants (Win Cycle / Win Animations) recognised', () => {
  const variants = ['Win Cycle', 'Win Animations', 'Win Animation', 'Win Highlight'];
  for (const heading of variants) {
    const gdd = `# T\n## ${heading}\n- mode: per-line\n`;
    const out = parseGDD(gdd, 'md');
    assert.equal(out.winPresentation.mode, 'per-line', `heading "${heading}" not recognised`);
  }
});

t('parser: invalid/junk values rejected at block-resolve stage', () => {
  /* parser is permissive — block.resolveConfig is the validator */
  const gdd = '# T\n## Win Presentation\n- mode: garbage\n- max-events: 999\n';
  const out = parseGDD(gdd, 'md');
  /* parser captured garbage as-is, but block's resolveConfig filters it: */
  const cfg = resolveConfig(out);
  assert.equal(cfg.mode, 'per-line');     /* invalid mode → default */
  assert.equal(cfg.maxEvents, 8);          /* 999 out of bounds → default */
});

t('parser → emit roundtrip: GDD knobs reach the runtime literally', () => {
  const gdd = '# T\n## Win Presentation\n- per-event-ms: 420\n- max-events: 10\n';
  const out = parseGDD(gdd, 'md');
  const src = emitWinPresentationRuntime(resolveConfig(out));
  assert.ok(src.includes('const adaptive = 420'), 'perEventMs=420 did not reach runtime');
  assert.ok(src.includes('MAX_EVENTS = 10'), 'maxEvents=10 did not reach runtime');
});

/* ─── detectWinCombos emitter (B3 extraction) ────────────────────────── */

t('emitDetectWinCombosRuntime: emits cluster evaluator function', () => {
  const js = emitDetectWinCombosRuntime();
  assert.ok(js.includes('function detectWinCombos()'), 'must emit detectWinCombos function');
  assert.ok(js.includes('SYMBOL_REGISTRY'),  'must reference SYMBOL_REGISTRY');
  assert.ok(js.includes('FREESPINS.triggerSymbol'), 'must reference trigger symbol');
});

t('emitDetectWinCombosRuntime: bakes maxEvents as MAX_EVENTS literal', () => {
  const js = emitDetectWinCombosRuntime({ maxEvents: 12 });
  assert.ok(js.includes('MAX_EVENTS = 12'), 'maxEvents=12 did not reach detectWinCombos');
});

t('emitDetectWinCombosRuntime: defaults bake maxEvents=8', () => {
  const js = emitDetectWinCombosRuntime();
  assert.ok(js.includes('MAX_EVENTS = 8'), 'default maxEvents=8 missing');
});

t('emitDetectWinCombosRuntime: tierRank includes HP/MP/LP/WILD', () => {
  const js = emitDetectWinCombosRuntime();
  for (const k of ['HP', 'MP', 'LP', 'WILD']) {
    assert.ok(js.includes(`${k}:`), `tierRank missing ${k}`);
  }
});

if (fail > 0) {
  console.error(`\n${fail} FAILED`);
  process.exit(1);
}
console.log(`\n  All tests passed.`);
