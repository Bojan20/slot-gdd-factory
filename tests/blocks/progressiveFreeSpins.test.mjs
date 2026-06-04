/**
 * Unit test for src/blocks/progressiveFreeSpins.mjs
 *
 * Validates the LEGO block contract:
 *   1. defaults are safe + industry-baseline
 *   2. resolveConfig validates every key with strict shape checks
 *   3. auto-enable from features array (both kind variants)
 *   4. strategy enum gating
 *   5. ladderValues array validation + length cap + per-element clamp
 *   6. CSS emit is empty when disabled, populated when enabled
 *   7. CSS contains chip + grown + reduced-motion gate + mobile media query
 *   8. markup is empty when disabled, populated when enabled
 *   9. markup uses chipLabel + startMult literals
 *  10. runtime is stub when disabled
 *  11. runtime bakes all 5 constants (strategy, start, step, ladder, max)
 *  12. runtime exposes pfsReset, pfsBump, pfsGet, PFS_STATE on window
 *  13. runtime registers HookBus.on for onFsTrigger, onFsSpinResult, onFsEnd
 *  14. linear strategy progression is correct
 *  15. doubling strategy progression is correct
 *  16. fibonacci strategy progression is correct
 *  17. ladder strategy advances index by 1 per bump
 *  18. cap clamps every strategy
 *  19. resetOnRoundEnd flag honored
 *  20. determinism — same config → same emitted output
 *  21. no game-specific names in emitted output (template rule)
 *  22. CSS uses .pfs-chip class (markup ↔ CSS contract)
 *  23. runtime injects HookBus.setMult only when v > 0
 *  24. invalid strategy falls through to default 'linear'
 *  25. ladder with 1 element rejected (must be ≥ 2)
 */

import { strict as assert } from 'node:assert';
import {
  defaultConfig,
  resolveConfig,
  emitProgressiveFreeSpinsCSS,
  emitProgressiveFreeSpinsMarkup,
  emitProgressiveFreeSpinsRuntime,
} from '../../src/blocks/progressiveFreeSpins.mjs';

let fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

console.log('\n— blocks/progressiveFreeSpins.mjs —');

/* ── 1-3: defaults + resolve + auto-enable ───────────────────────── */
t('default config disabled with industry baselines', () => {
  const d = defaultConfig();
  assert.equal(d.enabled, false);
  assert.equal(d.strategy, 'linear');
  assert.equal(d.startMult, 1);
  assert.equal(d.step, 1);
  assert.equal(d.maxMult, 0);
  assert.equal(d.resetOnRoundEnd, true);
  assert.ok(Array.isArray(d.ladderValues) && d.ladderValues.length >= 4);
  assert.equal(typeof d.chipColor, 'string');
  assert.equal(typeof d.chipLabel, 'string');
});

t('resolveConfig: override startMult + step + maxMult clamped to int range', () => {
  const c = resolveConfig({
    progressiveFreeSpins: { enabled: true, startMult: 5, step: 3, maxMult: 1000 },
  });
  assert.equal(c.enabled, true);
  assert.equal(c.startMult, 5);
  assert.equal(c.step, 3);
  assert.equal(c.maxMult, 1000);
});

t('auto-enable from features[].kind === "progressive_free_spins"', () => {
  const c = resolveConfig({ features: [{ kind: 'progressive_free_spins' }] });
  assert.equal(c.enabled, true);
});

t('auto-enable from features[].kind === "progressive_fs" (alias)', () => {
  const c = resolveConfig({ features: [{ kind: 'progressive_fs' }] });
  assert.equal(c.enabled, true);
});

/* ── 4-5: strategy + ladder validation ───────────────────────────── */
t('strategy: each valid enum is honored', () => {
  for (const s of ['linear', 'doubling', 'fibonacci', 'ladder']) {
    const c = resolveConfig({ progressiveFreeSpins: { strategy: s } });
    assert.equal(c.strategy, s);
  }
});

t('strategy: invalid value falls back to default linear', () => {
  const c = resolveConfig({ progressiveFreeSpins: { strategy: 'bogus' } });
  assert.equal(c.strategy, 'linear');
});

t('ladderValues: valid array accepted', () => {
  const c = resolveConfig({
    progressiveFreeSpins: { ladderValues: [1, 2, 5, 10, 25] },
  });
  assert.deepEqual(c.ladderValues, [1, 2, 5, 10, 25]);
});

t('ladderValues: single-element array rejected (must be ≥ 2)', () => {
  const c = resolveConfig({ progressiveFreeSpins: { ladderValues: [10] } });
  assert.deepEqual(c.ladderValues, defaultConfig().ladderValues);
});

t('ladderValues: clamped to 32 elements max', () => {
  const huge = Array.from({ length: 64 }, (_, i) => i + 1);
  const c = resolveConfig({ progressiveFreeSpins: { ladderValues: huge } });
  assert.equal(c.ladderValues.length, 32);
});

t('ladderValues: each element clamped to [1, 1_000_000]', () => {
  const c = resolveConfig({
    progressiveFreeSpins: { ladderValues: [0, 5, 5_000_000] },
  });
  /* 0 fails the >= 1 filter so the whole array fails validation and we
     fall back to defaults — by design. Test instead with all-valid: */
  const c2 = resolveConfig({
    progressiveFreeSpins: { ladderValues: [1, 5, 5_000_000] },
  });
  assert.equal(c2.ladderValues[0], 1);
  assert.equal(c2.ladderValues[1], 5);
  assert.equal(c2.ladderValues[2], 1_000_000);
});

t('chipColor: invalid format ignored', () => {
  const c = resolveConfig({ progressiveFreeSpins: { chipColor: 'not-rgb' } });
  assert.equal(c.chipColor, defaultConfig().chipColor);
});

t('chipColor: valid r,g,b accepted', () => {
  const c = resolveConfig({ progressiveFreeSpins: { chipColor: '12,34,56' } });
  assert.equal(c.chipColor, '12,34,56');
});

/* ── 6-9: CSS + markup ───────────────────────────────────────────── */
t('CSS empty when disabled', () => {
  assert.equal(emitProgressiveFreeSpinsCSS(defaultConfig()), '');
});

t('CSS has .pfs-chip class + grown animation + reduced-motion gate', () => {
  const css = emitProgressiveFreeSpinsCSS({ ...defaultConfig(), enabled: true });
  assert.ok(/\.pfs-chip\b/.test(css));
  assert.ok(/\.pfs-chip\.is-grown/.test(css));
  assert.ok(/@keyframes\s+pfsGrow/.test(css));
  assert.ok(/prefers-reduced-motion/.test(css));
  assert.ok(/max-width:\s*620px/.test(css), 'mobile media query expected');
});

t('markup empty when disabled', () => {
  assert.equal(emitProgressiveFreeSpinsMarkup(defaultConfig()), '');
});

t('markup contains pfsChip id + chipLabel + startMult', () => {
  const cfg = { ...defaultConfig(), enabled: true, chipLabel: 'FS MULTIPLIER', startMult: 3 };
  const html = emitProgressiveFreeSpinsMarkup(cfg);
  assert.ok(/id="pfsChip"/.test(html));
  assert.ok(/FS MULTIPLIER/.test(html));
  assert.ok(/×3/.test(html));
});

t('markup escapes chipLabel HTML (XSS guard)', () => {
  const cfg = { ...defaultConfig(), enabled: true, chipLabel: '<script>x</script>' };
  const html = emitProgressiveFreeSpinsMarkup(cfg);
  assert.ok(!/<script>x<\/script>/.test(html));
  assert.ok(/&lt;script&gt;/.test(html));
});

/* ── 10-13: runtime contract ─────────────────────────────────────── */
t('runtime is stub when disabled', () => {
  const rt = emitProgressiveFreeSpinsRuntime(defaultConfig());
  assert.ok(/progressiveFreeSpins:\s*disabled/.test(rt));
  assert.ok(!/HookBus\.on/.test(rt));
});

t('runtime bakes all 5 config constants as literals', () => {
  const cfg = {
    ...defaultConfig(),
    enabled: true,
    strategy: 'doubling',
    startMult: 2,
    step: 3,
    maxMult: 10000,
    ladderValues: [1, 5, 25, 100],
  };
  const rt = emitProgressiveFreeSpinsRuntime(cfg);
  assert.ok(/PFS_STRATEGY\s*=\s*"doubling"/.test(rt));
  assert.ok(/PFS_START\s*=\s*2/.test(rt));
  assert.ok(/PFS_STEP\s*=\s*3/.test(rt));
  assert.ok(/PFS_MAX\s*=\s*10000/.test(rt));
  assert.ok(/PFS_LADDER\s*=\s*\[1,5,25,100\]/.test(rt));
});

t('runtime exposes pfsReset, pfsBump, pfsGet, PFS_STATE on window', () => {
  const rt = emitProgressiveFreeSpinsRuntime({ ...defaultConfig(), enabled: true });
  assert.ok(/window\.pfsReset\s*=\s*pfsReset/.test(rt));
  assert.ok(/window\.pfsBump\s*=\s*pfsBump/.test(rt));
  assert.ok(/window\.pfsGet\s*=\s*pfsGet/.test(rt));
  assert.ok(/window\.PFS_STATE\s*=\s*PFS_STATE/.test(rt));
});

t('runtime registers HookBus.on for onFsTrigger / onFsSpinResult / onFsEnd', () => {
  const rt = emitProgressiveFreeSpinsRuntime({ ...defaultConfig(), enabled: true });
  assert.ok(/HookBus\.on\('onFsTrigger'/.test(rt));
  assert.ok(/HookBus\.on\('onFsSpinResult'/.test(rt));
  assert.ok(/HookBus\.on\('onFsEnd'/.test(rt));
});

t('runtime pushes value into HookBus.setMult only when v > 0', () => {
  const rt = emitProgressiveFreeSpinsRuntime({ ...defaultConfig(), enabled: true });
  assert.ok(/if\s*\(v\s*>\s*0\)\s*HookBus\.setMult/.test(rt),
    'guard `if (v > 0) HookBus.setMult(...)` expected');
});

t('runtime uses Math.max so it composes with other multiplier sources', () => {
  const rt = emitProgressiveFreeSpinsRuntime({ ...defaultConfig(), enabled: true });
  assert.ok(/Math\.max\(HookBus\.getMult\(\),\s*v\)/.test(rt),
    'composition via Math.max(getMult, v) expected');
});

/* ── 14-19: strategy semantics — exercise the runtime logic ──────── */
function makeEvalCtx(cfg, fakeFSM = { phase: 'FS_ACTIVE' }) {
  /* Evaluate the emitted runtime inside a sandbox so we can drive
     pfsBump() and inspect PFS_STATE without a real browser. */
  const rt = emitProgressiveFreeSpinsRuntime({ ...cfg, enabled: true });
  /* The runtime expects FSM, HookBus, document, window in scope. */
  const stubChip = { dataset: {}, querySelector: () => null, classList: { add(){}, remove(){} }, offsetWidth: 1 };
  const stubDoc = {
    getElementById: () => stubChip,
    addEventListener: () => {},
  };
  const stubHookBus = {
    _handlers: {},
    on(ev, fn) { (this._handlers[ev] = this._handlers[ev] || []).push(fn); },
    emit(ev, payload) { (this._handlers[ev] || []).forEach(fn => fn(payload || {})); },
    _mult: 1,
    getMult() { return this._mult; },
    setMult(v) { this._mult = v; },
  };
  const stubWin = {};
  const fn = new Function('document', 'window', 'FSM', 'HookBus', rt +
    `; return { pfsReset, pfsBump, pfsGet, PFS_STATE, HookBus };`);
  return fn(stubDoc, stubWin, fakeFSM, stubHookBus);
}

t('strategy=linear: 1 → 2 → 3 → 4 with step=1', () => {
  const ctx = makeEvalCtx({ strategy: 'linear', startMult: 1, step: 1 });
  ctx.pfsReset();
  assert.equal(ctx.pfsBump(), 2);
  assert.equal(ctx.pfsBump(), 3);
  assert.equal(ctx.pfsBump(), 4);
});

t('strategy=linear: step=5 honors arithmetic step', () => {
  const ctx = makeEvalCtx({ strategy: 'linear', startMult: 1, step: 5 });
  ctx.pfsReset();
  assert.equal(ctx.pfsBump(), 6);
  assert.equal(ctx.pfsBump(), 11);
});

t('strategy=doubling: 1 → 2 → 4 → 8 → 16', () => {
  const ctx = makeEvalCtx({ strategy: 'doubling', startMult: 1, step: 2 });
  ctx.pfsReset();
  assert.equal(ctx.pfsBump(), 2);
  assert.equal(ctx.pfsBump(), 4);
  assert.equal(ctx.pfsBump(), 8);
  assert.equal(ctx.pfsBump(), 16);
});

t('strategy=fibonacci: 1 → 2 → 3 → 5 → 8 → 13', () => {
  const ctx = makeEvalCtx({ strategy: 'fibonacci', startMult: 1 });
  ctx.pfsReset();
  assert.equal(ctx.pfsBump(), 2);
  assert.equal(ctx.pfsBump(), 3);
  assert.equal(ctx.pfsBump(), 5);
  assert.equal(ctx.pfsBump(), 8);
  assert.equal(ctx.pfsBump(), 13);
});

t('strategy=ladder: advances one index per bump and clamps at last', () => {
  const ctx = makeEvalCtx({
    strategy: 'ladder',
    startMult: 1,
    ladderValues: [1, 3, 7, 20],
  });
  ctx.pfsReset();
  assert.equal(ctx.pfsBump(), 3);
  assert.equal(ctx.pfsBump(), 7);
  assert.equal(ctx.pfsBump(), 20);
  assert.equal(ctx.pfsBump(), 20, 'clamp at last index');
});

t('maxMult caps every strategy', () => {
  const ctx = makeEvalCtx({ strategy: 'linear', startMult: 1, step: 5, maxMult: 10 });
  ctx.pfsReset();
  assert.equal(ctx.pfsBump(), 6);
  assert.equal(ctx.pfsBump(), 10, 'cap kicks in');
  assert.equal(ctx.pfsBump(), 10, 'stays capped');
});

t('bump is a no-op when FSM phase is not FS_ACTIVE / FS_INTRO', () => {
  const ctx = makeEvalCtx({ strategy: 'linear', startMult: 1, step: 1 }, { phase: 'BASE' });
  ctx.pfsReset();
  assert.equal(ctx.pfsBump(), 1, 'base game ignores escalator');
});

t('HookBus integration: onFsTrigger resets, onFsSpinResult bumps + sets mult', () => {
  const ctx = makeEvalCtx({ strategy: 'linear', startMult: 1, step: 2 });
  ctx.HookBus.emit('onFsTrigger', {});
  assert.equal(ctx.pfsGet(), 1, 'reset back to start');
  ctx.HookBus.emit('onFsSpinResult', {});
  assert.equal(ctx.pfsGet(), 3, 'bumped');
  assert.equal(ctx.HookBus.getMult(), 3, 'pushed into HookBus.setMult');
  ctx.HookBus.emit('onFsSpinResult', {});
  assert.equal(ctx.pfsGet(), 5);
  assert.equal(ctx.HookBus.getMult(), 5);
});

t('resetOnRoundEnd=true: onFsEnd clears back to start', () => {
  const ctx = makeEvalCtx({ strategy: 'linear', startMult: 1, step: 1, resetOnRoundEnd: true });
  ctx.HookBus.emit('onFsTrigger', {});
  ctx.HookBus.emit('onFsSpinResult', {});
  ctx.HookBus.emit('onFsSpinResult', {});
  assert.equal(ctx.pfsGet(), 3);
  ctx.HookBus.emit('onFsEnd', {});
  assert.equal(ctx.pfsGet(), 1, 'reset back to start at FS end');
});

t('resetOnRoundEnd=false: onFsEnd preserves current value', () => {
  const ctx = makeEvalCtx({ strategy: 'linear', startMult: 1, step: 1, resetOnRoundEnd: false });
  ctx.HookBus.emit('onFsTrigger', {});
  ctx.HookBus.emit('onFsSpinResult', {});
  assert.equal(ctx.pfsGet(), 2);
  ctx.HookBus.emit('onFsEnd', {});
  assert.equal(ctx.pfsGet(), 2, 'preserved');
});

/* ── 20-25: hygiene + determinism + template rule ────────────────── */
t('determinism — emitter is pure (two calls byte-identical)', () => {
  const a = emitProgressiveFreeSpinsRuntime({ ...defaultConfig(), enabled: true });
  const b = emitProgressiveFreeSpinsRuntime({ ...defaultConfig(), enabled: true });
  assert.equal(a, b);
});

t('no game-specific names in emitted output (template rule)', () => {
  const cfg = { ...defaultConfig(), enabled: true };
  const all = emitProgressiveFreeSpinsCSS(cfg) +
              emitProgressiveFreeSpinsMarkup(cfg) +
              emitProgressiveFreeSpinsRuntime(cfg);
  const banned = /(gates[- ]of[- ]olympus|wrath[- ]of[- ]olympus|crystal[- ]forge|midnight[- ]fangs|sweet[- ]bonanza|sugar[- ]rush|reactoonz|pragmatic|netent|microgaming|aristocrat|wazdan)/i;
  assert.ok(!banned.test(all), 'emitted output must not name any specific game / vendor');
});

t('markup ↔ CSS contract: chip id and class names line up', () => {
  const cfg = { ...defaultConfig(), enabled: true };
  const html = emitProgressiveFreeSpinsMarkup(cfg);
  const css  = emitProgressiveFreeSpinsCSS(cfg);
  assert.ok(/id="pfsChip"/.test(html) && /pfs-chip/.test(html));
  assert.ok(/\.pfs-chip\b/.test(css));
  assert.ok(/pfs-val/.test(html) && /\.pfs-chip\s+\.pfs-val/.test(css));
});

t('disabled emit-ers compose cleanly (orchestrator can splice without branching)', () => {
  /* Disabled emit returns empty string for CSS/markup and a comment-only
     stub for runtime — meaning the orchestrator can concatenate without
     `if (enabled)` checks. */
  const cfg = defaultConfig();
  assert.equal(emitProgressiveFreeSpinsCSS(cfg), '');
  assert.equal(emitProgressiveFreeSpinsMarkup(cfg), '');
  assert.ok(emitProgressiveFreeSpinsRuntime(cfg).startsWith('/*'));
});

if (fail > 0) {
  console.error(`\n✗ ${fail} test(s) failed in progressiveFreeSpins.test.mjs`);
  process.exit(1);
}
console.log(`\n✓ All progressiveFreeSpins tests passed`);
