/**
 * tests/blocks/convergenceHud.test.mjs
 *
 * LV3-14 (Boki 2026-06-26) — Contract tests for convergenceHud block.
 *
 * Covers (16 cases):
 *
 * resolveConfig:
 *   1.  defaultConfig() is frozen + has enabled=false
 *   2.  resolveConfig honours model.convergenceHud.enabled=true
 *   3.  resolveConfig honours position whitelist
 *   4.  resolveConfig rejects invalid position
 *   5.  resolveConfig clamps pollIntervalMs to bounds
 *   6.  resolveConfig clamps toleranceBps to bounds
 *
 * emit:
 *   7.  emitConvergenceHudCSS empty when disabled
 *   8.  emitConvergenceHudCSS bakes position class
 *   9.  emitConvergenceHudMarkup empty when disabled
 *  10.  emitConvergenceHudMarkup tagged + has all anchor IDs
 *  11.  emitConvergenceHudRuntime stub when disabled
 *  12.  emitConvergenceHudRuntime bakes POLL_MS + TOL_BPS literals
 *  13.  emitConvergenceHudRuntime registers idempotency guard
 *
 * lifecycle:
 *  14.  emitConvergenceHudRuntime emits onSolverConverged via HookBus
 *  15.  smartDefault auto-enables when compliance declared
 *  16.  smartDefault does NOT auto-enable when no LV3 signal
 */

import { strict as assert } from 'node:assert';
import {
  defaultConfig,
  resolveConfig,
  emitConvergenceHudCSS,
  emitConvergenceHudMarkup,
  emitConvergenceHudRuntime,
  smartDefault,
} from '../../src/blocks/convergenceHud.mjs';

let pass = 0;
let fail = 0;
function t(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${err.message}`);
    fail++;
  }
}

console.log('convergenceHud contract suite');

/* 1 */
t('defaultConfig() is frozen and disabled by default', () => {
  const cfg = defaultConfig();
  assert.equal(Object.isFrozen(cfg), true);
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.position, 'top-left');
  assert.equal(cfg.pollIntervalMs, 250);
  assert.equal(cfg.toleranceBps, 5);
});

/* 2 */
t('resolveConfig honours model.convergenceHud.enabled=true', () => {
  const cfg = resolveConfig({ convergenceHud: { enabled: true } });
  assert.equal(cfg.enabled, true);
});

/* 3 */
t('resolveConfig honours position whitelist (4 valid)', () => {
  for (const p of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
    const cfg = resolveConfig({ convergenceHud: { enabled: true, position: p } });
    assert.equal(cfg.position, p);
  }
});

/* 4 */
t('resolveConfig rejects invalid position (keeps default)', () => {
  const cfg = resolveConfig({ convergenceHud: { enabled: true, position: 'middle' } });
  assert.equal(cfg.position, 'top-left');
});

/* 5 */
t('resolveConfig clamps pollIntervalMs to [50, 5000]', () => {
  assert.equal(resolveConfig({ convergenceHud: { pollIntervalMs: 500 } }).pollIntervalMs, 500);
  assert.equal(resolveConfig({ convergenceHud: { pollIntervalMs: 10 } }).pollIntervalMs, 250); /* fallback default */
  assert.equal(resolveConfig({ convergenceHud: { pollIntervalMs: 99999 } }).pollIntervalMs, 250);
  assert.equal(resolveConfig({ convergenceHud: { pollIntervalMs: 'fast' } }).pollIntervalMs, 250);
});

/* 6 */
t('resolveConfig clamps toleranceBps to [1, 500]', () => {
  assert.equal(resolveConfig({ convergenceHud: { toleranceBps: 50 } }).toleranceBps, 50);
  assert.equal(resolveConfig({ convergenceHud: { toleranceBps: 0 } }).toleranceBps, 5);
  assert.equal(resolveConfig({ convergenceHud: { toleranceBps: 9999 } }).toleranceBps, 5);
});

/* 7 */
t('emitConvergenceHudCSS empty when disabled', () => {
  const css = emitConvergenceHudCSS({ ...defaultConfig() });
  assert.equal(css, '');
});

/* 8 */
t('emitConvergenceHudCSS bakes position offsets', () => {
  const cfg = resolveConfig({ convergenceHud: { enabled: true, position: 'bottom-right' } });
  const css = emitConvergenceHudCSS(cfg);
  assert.match(css, /bottom:\s*12px;\s*right:\s*12px;/);
  assert.match(css, /\.convergence-hud\b/);
  assert.match(css, /\[data-state="ok"\]/);
});

/* 9 */
t('emitConvergenceHudMarkup empty when disabled', () => {
  const m = emitConvergenceHudMarkup({ ...defaultConfig() });
  assert.equal(m, '');
});

/* 10 */
t('emitConvergenceHudMarkup tagged + has all anchor IDs', () => {
  const cfg = resolveConfig({ convergenceHud: { enabled: true } });
  const m = emitConvergenceHudMarkup(cfg);
  assert.match(m, /data-block-name=/);
  assert.match(m, /class="convergence-hud"/);
  assert.match(m, /id="chIter"/);
  assert.match(m, /id="chResid"/);
  assert.match(m, /id="chDelta"/);
  assert.match(m, /id="chBadge"/);
  /* a11y annotations */
  assert.match(m, /aria-live="polite"/);
});

/* 11 */
t('emitConvergenceHudRuntime stub when disabled', () => {
  const rt = emitConvergenceHudRuntime({ ...defaultConfig() });
  assert.match(rt, /disabled/);
  assert.equal(rt.includes('setInterval'), false);
});

/* 12 */
t('emitConvergenceHudRuntime bakes POLL_MS + TOL_BPS literals', () => {
  const cfg = resolveConfig({
    convergenceHud: { enabled: true, pollIntervalMs: 333, toleranceBps: 25 },
  });
  const rt = emitConvergenceHudRuntime(cfg);
  assert.match(rt, /POLL_MS = 333/);
  assert.match(rt, /TOL_BPS = 25/);
});

/* 13 */
t('emitConvergenceHudRuntime registers idempotency guard', () => {
  const cfg = resolveConfig({ convergenceHud: { enabled: true } });
  const rt = emitConvergenceHudRuntime(cfg);
  assert.match(rt, /window\.__CONVERGENCE_HUD_INIT__/);
});

/* 14 */
t('emitConvergenceHudRuntime emits onSolverConverged via HookBus', () => {
  const cfg = resolveConfig({ convergenceHud: { enabled: true } });
  const rt = emitConvergenceHudRuntime(cfg);
  assert.match(rt, /HookBus\.emit\(['"]onSolverConverged['"]/);
});

/* 15 */
t('smartDefault auto-enables when compliance declared', () => {
  const next = smartDefault(
    { compliance: [{ code: 'UKGC' }] },
    null,
  );
  assert.equal(next.enabled, true);
});

/* 16 */
t('smartDefault does NOT auto-enable when no LV3 signal', () => {
  /* No compliance, no __lv3__ feature → declared stays as-is. */
  const next = smartDefault({ name: 'plain' }, null);
  assert.notEqual(next.enabled, true);
});

/* ─── UQ-LV3-QA-3 regression coverage ───────────────────────────── */

/* 17 */
t('UQ-LV3-QA-3 #1: runtime uses if/else not ternary-assignment', () => {
  /* Pre-fix line 241 was `elDelta.firstChild ? elDelta.firstChild.textContent = '—' : null;`
     — assignment inside ternary. Verify the fixed source uses a
     proper if (...) form. */
  const cfg = resolveConfig({ convergenceHud: { enabled: true } });
  const rt = emitConvergenceHudRuntime(cfg);
  assert.ok(!/firstChild\s*\?\s*\w+\.firstChild\.textContent\s*=/.test(rt),
    'must not use ternary-as-statement for assignment');
  assert.match(rt, /if\s*\(deltaTextNode\)/);
});

/* 18 */
t('UQ-LV3-QA-3 #3+#4: runtime tears down prior interval + wires beforeunload', () => {
  const cfg = resolveConfig({ convergenceHud: { enabled: true } });
  const rt = emitConvergenceHudRuntime(cfg);
  /* Stop any pre-existing interval before installing new one. */
  assert.match(rt, /typeof window\.__CONVERGENCE_HUD_STOP__\s*===\s*['"]function['"]/);
  /* beforeunload listener. */
  assert.match(rt, /addEventListener\(['"]beforeunload['"]/);
  /* Hookbus onSlotDestroy subscription. */
  assert.match(rt, /onSlotDestroy/);
});

/* 19 */
t('UQ-LV3-QA-3 #9: runtime uses own-property guards (no proto pollution)', () => {
  const cfg = resolveConfig({ convergenceHud: { enabled: true } });
  const rt = emitConvergenceHudRuntime(cfg);
  /* hasOwnProperty.call pattern present. */
  assert.match(rt, /hasOwnProperty\.call/);
  /* `converged` is gated on own-property + strict `=== true`. */
  assert.match(rt, /converged\s*=\s*_has\(st,\s*['"]converged['"]\)\s*&&\s*st\.converged\s*===\s*true/);
});

/* 20 */
t('UQ-LV3-QA-3 #5: HUD root has aria-live=off; announcements in separate node', () => {
  const cfg = resolveConfig({ convergenceHud: { enabled: true } });
  const m = emitConvergenceHudMarkup(cfg);
  assert.match(m, /class="convergence-hud"[^>]*aria-live="off"/);
  assert.match(m, /id="chAnnounce"[^>]*aria-live="polite"/);
});

/* 21 */
t('UQ-LV3-QA-3 #6: state label paired with data-state (WCAG 1.4.1)', () => {
  const cfg = resolveConfig({ convergenceHud: { enabled: true } });
  const m = emitConvergenceHudMarkup(cfg);
  assert.match(m, /id="chStateLabel"/);
  const rt = emitConvergenceHudRuntime(cfg);
  /* runtime updates the text label via STATE_COPY mapping. */
  assert.match(rt, /STATE_COPY\s*=\s*\{/);
  assert.match(rt, /CONVERGED/);
  assert.match(rt, /DIVERGED/);
});

/* 22 */
t('UQ-LV3-QA-3 #7: WARN_MULTIPLIER named constant (no magic ×10)', () => {
  const cfg = resolveConfig({ convergenceHud: { enabled: true } });
  const rt = emitConvergenceHudRuntime(cfg);
  assert.match(rt, /WARN_MULTIPLIER\s*=\s*10/);
  assert.match(rt, /TOL_BPS\s*\*\s*WARN_MULTIPLIER/);
});

console.log(`\nResult: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
