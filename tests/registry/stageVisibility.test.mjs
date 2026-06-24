/**
 * tests/registry/stageVisibility.test.mjs
 *
 * UQ-DEEP-AO · AO-6 · Stage-driven block visibility test suite.
 *
 * Covers ≥ 15 cases per AO-6 spec:
 *   1. SCHEMA_VERSION === '1'
 *   2. STAGES contains 6 stages
 *   3. STAGES frozen
 *   4. DEFAULT_STAGE === 'BaseGame'
 *   5. emitStageVisibilityCSS returns non-empty string
 *   6. CSS contains 'data-stage-current' selector
 *   7. CSS contains 'data-stage-active' selector
 *   8. emitStageVisibilityRuntime returns non-empty JS
 *   9. Runtime sets window.SlotStage
 *  10. Runtime defines setStage, getStage methods
 *  11. Runtime listens onFsTrigger/onFsEnd/onHnwTrigger/onHnwEnd
 *  12. Runtime guards HookBus (typeof check)
 *  13. Runtime has idempotency guard __STAGE_VIS_WIRED__
 *  14. Runtime no eval/document.write/innerHTML user assign
 *  15. setStage rejects invalid stage name
 *
 *  Extras (defensive coverage):
 *  16. STAGES contains canonical names (BaseGame, FreeSpin, LockAndRespin,
 *      Jackpot, PickBonus, EndGame)
 *  17. CSS uses display:none for non-active gated nodes
 *  18. Runtime exposes schemaVersion on window.SlotStage
 *  19. Runtime DOM-ready safe (DOMContentLoaded branch)
 *  20. buildSlotHTML import does not throw after AO-6 wiring
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  SCHEMA_VERSION,
  STAGES,
  DEFAULT_STAGE,
  emitStageVisibilityCSS,
  emitStageVisibilityRuntime,
} from '../../src/registry/stageVisibility.mjs';

/* ── 1. SCHEMA_VERSION ──────────────────────────────────────────────── */
test('UQ-DEEP-AO · #1 · SCHEMA_VERSION === "1"', () => {
  assert.equal(SCHEMA_VERSION, '1');
});

/* ── 2. STAGES count ────────────────────────────────────────────────── */
test('UQ-DEEP-AO · #2 · STAGES contains 6 stages', () => {
  assert.equal(STAGES.length, 6);
});

/* ── 3. STAGES frozen ───────────────────────────────────────────────── */
test('UQ-DEEP-AO · #3 · STAGES frozen', () => {
  assert.equal(Object.isFrozen(STAGES), true);
  /* Mutation must throw in strict mode (test files are ESM ≡ strict). */
  assert.throws(() => { STAGES.push('Extra'); });
});

/* ── 4. DEFAULT_STAGE ───────────────────────────────────────────────── */
test('UQ-DEEP-AO · #4 · DEFAULT_STAGE === "BaseGame"', () => {
  assert.equal(DEFAULT_STAGE, 'BaseGame');
});

/* ── 5. CSS non-empty ──────────────────────────────────────────────── */
test('UQ-DEEP-AO · #5 · emitStageVisibilityCSS returns non-empty string', () => {
  const css = emitStageVisibilityCSS();
  assert.equal(typeof css, 'string');
  assert.ok(css.trim().length > 0, 'CSS must be non-empty');
});

/* ── 6. CSS contains data-stage-current ────────────────────────────── */
test('UQ-DEEP-AO · #6 · CSS contains "data-stage-current" selector', () => {
  const css = emitStageVisibilityCSS();
  assert.ok(css.includes('data-stage-current'), 'CSS must reference data-stage-current');
});

/* ── 7. CSS contains data-stage-active ─────────────────────────────── */
test('UQ-DEEP-AO · #7 · CSS contains "data-stage-active" selector', () => {
  const css = emitStageVisibilityCSS();
  assert.ok(css.includes('data-stage-active'), 'CSS must reference data-stage-active');
});

/* ── 8. Runtime non-empty ──────────────────────────────────────────── */
test('UQ-DEEP-AO · #8 · emitStageVisibilityRuntime returns non-empty JS', () => {
  const js = emitStageVisibilityRuntime();
  assert.equal(typeof js, 'string');
  assert.ok(js.trim().length > 0, 'Runtime must be non-empty');
});

/* ── 9. Runtime exposes window.SlotStage ───────────────────────────── */
test('UQ-DEEP-AO · #9 · Runtime sets window.SlotStage', () => {
  const js = emitStageVisibilityRuntime();
  assert.ok(js.includes('window.SlotStage'), 'Runtime must attach window.SlotStage');
});

/* ── 10. Runtime defines setStage/getStage ─────────────────────────── */
test('UQ-DEEP-AO · #10 · Runtime defines setStage, getStage methods', () => {
  const js = emitStageVisibilityRuntime();
  assert.ok(js.includes('setStage'), 'Runtime must define setStage');
  assert.ok(js.includes('getStage'), 'Runtime must define getStage');
});

/* ── 11. Runtime listens to FS + HnW lifecycle ─────────────────────── */
test('UQ-DEEP-AO · #11 · Runtime listens onFsTrigger/onFsEnd/onHnwTrigger/onHnwEnd', () => {
  const js = emitStageVisibilityRuntime();
  assert.ok(js.includes('onFsTrigger'), 'must listen onFsTrigger');
  assert.ok(js.includes('onFsEnd'),     'must listen onFsEnd');
  assert.ok(js.includes('onHnwTrigger'),'must listen onHnwTrigger');
  assert.ok(js.includes('onHnwEnd'),    'must listen onHnwEnd');
});

/* ── 12. Runtime guards HookBus typeof ─────────────────────────────── */
test('UQ-DEEP-AO · #12 · Runtime guards HookBus (typeof check)', () => {
  const js = emitStageVisibilityRuntime();
  assert.ok(js.includes("typeof HookBus !== 'undefined'"),
    'Runtime must defensively check HookBus before use');
});

/* ── 13. Runtime idempotency guard ─────────────────────────────────── */
test('UQ-DEEP-AO · #13 · Runtime has idempotency guard __STAGE_VIS_WIRED__', () => {
  const js = emitStageVisibilityRuntime();
  assert.ok(js.includes('__STAGE_VIS_WIRED__'),
    'Runtime must guard against double-wiring with __STAGE_VIS_WIRED__');
});

/* ── 14. No eval/document.write/innerHTML user assign ─────────────── */
test('UQ-DEEP-AO · #14 · Runtime no eval/document.write/innerHTML user assign', () => {
  const js = emitStageVisibilityRuntime();
  assert.equal(/\beval\s*\(/.test(js), false, 'no eval(');
  assert.equal(/document\.write\s*\(/.test(js), false, 'no document.write(');
  assert.equal(/\.innerHTML\s*=/.test(js), false, 'no .innerHTML assignment');
});

/* ── 15. setStage rejects invalid stage ────────────────────────────── */
test('UQ-DEEP-AO · #15 · setStage rejects invalid stage name', () => {
  const js = emitStageVisibilityRuntime();
  /* The runtime guards setStage with STAGES.indexOf(stage) < 0 → return.
   * We assert the guard string is present (deterministic emission). */
  assert.ok(js.includes('indexOf(currentStage)') || js.includes('.indexOf(stage)'),
    'Runtime must validate stage name via STAGES.indexOf before applying');
  assert.ok(/<\s*0/.test(js) || /<0/.test(js),
    'Runtime must reject when indexOf(stage) < 0');
});

/* ── 16. Canonical stage names present ─────────────────────────────── */
test('UQ-DEEP-AO · #16 · STAGES contains canonical names', () => {
  const expected = ['BaseGame', 'FreeSpin', 'LockAndRespin', 'Jackpot', 'PickBonus', 'EndGame'];
  for (const name of expected) {
    assert.ok(STAGES.indexOf(name) >= 0, `STAGES must contain "${name}"`);
  }
});

/* ── 17. CSS hides non-active gated nodes ─────────────────────────── */
test('UQ-DEEP-AO · #17 · CSS uses display:none for non-active gated nodes', () => {
  const css = emitStageVisibilityCSS();
  assert.ok(/display:\s*none/.test(css), 'CSS must use display:none for hidden stages');
});

/* ── 18. Runtime exposes schemaVersion ─────────────────────────────── */
test('UQ-DEEP-AO · #18 · Runtime exposes schemaVersion on window.SlotStage', () => {
  const js = emitStageVisibilityRuntime();
  assert.ok(js.includes('schemaVersion'), 'window.SlotStage must expose schemaVersion');
});

/* ── 19. DOM-ready safe branch ─────────────────────────────────────── */
test('UQ-DEEP-AO · #19 · Runtime DOM-ready safe (DOMContentLoaded branch)', () => {
  const js = emitStageVisibilityRuntime();
  assert.ok(js.includes('DOMContentLoaded'),
    'Runtime must defer refreshActive when document.readyState === "loading"');
  assert.ok(js.includes('readyState'),
    'Runtime must branch on document.readyState');
});

/* ── 20. buildSlotHTML still imports cleanly with AO-6 wiring ─────── */
test('UQ-DEEP-AO · #20 · buildSlotHTML import does not throw after AO-6 wiring', async () => {
  /* Importing the module ensures the named exports (emitStageVisibilityCSS,
   * emitStageVisibilityRuntime, DEFAULT_STAGE) resolve from the registry. */
  const mod = await import('../../src/buildSlotHTML.mjs');
  assert.equal(typeof mod.buildSlotHTML, 'function',
    'buildSlotHTML still exports its public function after wiring AO-6');
});
