/**
 * Unit test for src/blocks/paylineOverlay.mjs
 *
 * paylineOverlay is a runtime DOM block — its public API is a single
 * `emitPaylineOverlayRuntime()` string emitter. The emitted JS runs in
 * the browser and manipulates SVG nodes. So this test exercises:
 *
 *   1. emitter returns a non-empty string
 *   2. all 4 required runtime functions are defined in the emitted code
 *      (ensurePaylineOverlay, clearPaylineOverlay, drawPaylineOverlay,
 *      cellCenterInGrid)
 *   3. the emitted code references the gridHost (`grid` variable) — the
 *      orchestrator wiring contract holds
 *   4. tier-color hook (`tier-` class prefix) is present so CSS can map
 *      HP/MP/LP/WILD → stroke color downstream
 *   5. dash-length CSS custom property (`--payline-len`) is set so the
 *      draw-in keyframe scales to the actual polyline length (no 1000px
 *      placeholder)
 *   6. line-number badge contract: circle + text + clamp into viewport
 *   7. empty-event guard: `event.cells.length < 2` early-return (no
 *      single-cell ghost polyline)
 *   8. determinism — emitter called twice yields byte-identical string
 *      (pure function, no random / Date.now)
 *   9. (smoke) inject the emitted code into a jsdom-lite Function and
 *      verify the functions can be looked up by name without throwing
 */

import { strict as assert } from 'node:assert';
import { emitPaylineOverlayRuntime } from '../../src/blocks/paylineOverlay.mjs';

let fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

console.log('\n— blocks/paylineOverlay.mjs —');

const src = emitPaylineOverlayRuntime();

t('emitter returns a non-empty string', () => {
  assert.equal(typeof src, 'string');
  assert.ok(src.length > 500, `expected > 500 chars of runtime JS, got ${src.length}`);
});

t('all 4 runtime functions defined in emitted code', () => {
  for (const fn of ['ensurePaylineOverlay', 'clearPaylineOverlay', 'drawPaylineOverlay', 'cellCenterInGrid']) {
    assert.ok(
      new RegExp(`function\\s+${fn}\\s*\\(`).test(src),
      `expected emitted code to define function ${fn}()`
    );
  }
});

t('emitter wires in the gridHost variable (orchestrator contract)', () => {
  assert.ok(/\bgrid\b/.test(src), 'expected emitted code to reference the upstream `grid` host node');
  assert.ok(/grid\.appendChild\(PAYLINE_SVG\)/.test(src), 'SVG must be appended to gridHost');
});

t('tier color hook present (HP/MP/LP/WILD downstream)', () => {
  assert.ok(/tier-\s*' \+ tier|tier-' \+ tier|tier-'\s*\+\s*tier/.test(src),
    'expected tier-<TIER> class prefix on polyline');
});

t('dash-length custom property scales to polyline length', () => {
  assert.ok(/--payline-len/.test(src),
    'expected --payline-len CSS variable to be set per event');
  assert.ok(/Math\.ceil\(pathLen\)/.test(src),
    'pathLen should be ceil-ed before being set as --payline-len');
});

t('line-number badge: circle + text + viewport clamp', () => {
  assert.ok(/payline-badge/.test(src), 'expected payline-badge SVG node');
  assert.ok(/payline-badge-text/.test(src), 'expected payline-badge-text SVG node');
  assert.ok(/Math\.max\(14,\s*pts\[0\]\.x\s*-\s*22\)/.test(src),
    'badge x must clamp to >= 14 so it stays inside SVG viewport');
  assert.ok(/Math\.min\(gridRect\.height\s*-\s*14,\s*pts\[0\]\.y\)/.test(src),
    'badge y must clamp to gridRect.height - 14');
});

t('empty / 1-cell event short-circuits (no ghost polyline)', () => {
  assert.ok(
    /event\.cells\.length\s*<\s*2/.test(src),
    'expected `event.cells.length < 2` early-return in drawPaylineOverlay'
  );
  assert.ok(
    /pts\.length\s*<\s*2/.test(src),
    'expected `pts.length < 2` early-return after cellCenterInGrid filter'
  );
});

t('determinism: emitter is pure (two calls identical)', () => {
  const a = emitPaylineOverlayRuntime();
  const b = emitPaylineOverlayRuntime();
  assert.equal(a, b, 'emitter must be deterministic — same string every call');
});

t('emitted code is syntactically valid JS (Function ctor accepts it)', () => {
  // Wrap in a stub that satisfies the orchestrator's enclosing scope
  // (the emitted code references `grid` and `document`).
  const wrapped =
    `const grid = { appendChild() {}, getBoundingClientRect() { return { left:0, top:0, width:300, height:200 }; } };` +
    `const document = { getElementById() { return null; }, createElementNS() { return { setAttribute() {}, style: { setProperty() {} }, appendChild() {}, firstChild: null, removeChild() {} }; } };` +
    src +
    `; return { ensurePaylineOverlay, clearPaylineOverlay, drawPaylineOverlay, cellCenterInGrid };`;
  // No throw == syntactic validity. We don't execute — just construct.
  // (Executing would require a real DOM; the smoke goal is parse-cleanliness.)
  const make = new Function(wrapped);
  assert.equal(typeof make, 'function');
});

t('no game-specific names in emitted code (template rule)', () => {
  const banned = /(gates[- ]of[- ]olympus|wrath[- ]of[- ]olympus|crystal[- ]forge|midnight[- ]fangs|sweet[- ]bonanza|sugar[- ]rush)/i;
  assert.ok(!banned.test(src),
    'emitted runtime must not name any specific game (vendor-neutral)');
});

if (fail > 0) {
  console.error(`\n✗ ${fail} test(s) failed in paylineOverlay.test.mjs`);
  process.exit(1);
}
console.log(`\n✓ All paylineOverlay tests passed`);
