/* eslint-disable no-console */
/**
 * UQ-DEEP-AM · FIX-1 — spin throttle re-enable timeout
 *
 * Context (QA-1, UQ-DEEP-AL Playwright probe, 5 baseline slots × 50 spins):
 *   • Spin throughput ~55% (avg 27/50 spins completed). The Playwright probe
 *     waited up to 2.5s for #spinBtn to enable, then clicked with a 1500ms
 *     timeout — the click timed out on ~23/50 spins because the lifecycle
 *     finalize chain (postSpin → spinButton.disabled=false) could exceed
 *     1500ms on a long rollup, and there was no machine-readable signal for
 *     automation to await readiness.
 *
 * Fix (FIX-1):
 *   1. Expose `window.__SPIN_READY__` — Promise that resolves the moment
 *      the CTA is safe to click. Replaced on every preSpin with a fresh
 *      pending Promise; resolved on the lifecycle finalize chain. Headless
 *      automation does `await window.__SPIN_READY__` instead of
 *      poll-then-click-with-timeout.
 *   2. Mirror via `data-spin-ready="true|false"` DOM attribute for selector-
 *      based waits and visual-regression diffs.
 *   3. `lockAfterSpinMs` config (default 800, clamp [200, 2000]) arms a
 *      watchdog on preSpin that soft-unlocks the CTA if the finalize chain
 *      somehow misses — guarantees the Promise resolves within the bounded
 *      window even on degraded paths.
 *   4. `schemaVersion: '1'` stamp on the resolved config so downstream
 *      consumers (registry tooling, telemetry) can detect contract version.
 *
 * Root cause of the throughput drop: postSpin re-enables #spinBtn at the
 * tail of `applyWinHighlight()` which awaits the full rollup cycle
 * (up to ~3s on a multi-event win). The Playwright probe's hard-coded
 * 1500ms click timeout couldn't span that window. With `__SPIN_READY__`
 * the automation can await arbitrary-length rollups deterministically.
 */

import {
  defaultConfig, resolveConfig,
  emitSpinControlMarkup, emitSpinControlRuntime,
} from '../../src/blocks/spinControl.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); console.log('  ✓', n); pass++; }
  catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; }
};
const eq  = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ct  = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };
const nct = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`unexpected substring ${JSON.stringify(n)} — ${m}`); };
const ok  = (v, m = '') => { if (!v) throw new Error(`expected truthy — ${m}`); };

console.log('— blocks/spinThroughput.test.mjs — UQ-DEEP-AM FIX-1 —');

/* ── 1. defaultConfig exposes lockAfterSpinMs ≤ 800 + schemaVersion ── */

t('defaultConfig: lockAfterSpinMs field present + default ≤ 800ms', () => {
  const d = defaultConfig();
  ok('lockAfterSpinMs' in d, 'lockAfterSpinMs key missing from defaultConfig');
  eq(typeof d.lockAfterSpinMs, 'number', 'lockAfterSpinMs must be number');
  ok(d.lockAfterSpinMs <= 800, `default lockAfterSpinMs must be <= 800 (industry sweet spot); got ${d.lockAfterSpinMs}`);
  ok(d.lockAfterSpinMs >= 200, `default lockAfterSpinMs must be >= 200ms floor; got ${d.lockAfterSpinMs}`);
});

t('defaultConfig: schemaVersion is "1"', () => {
  const d = defaultConfig();
  eq(d.schemaVersion, '1', 'schemaVersion stamp absent or wrong value');
});

t('defaultConfig: returned object is frozen (immutable contract)', () => {
  const d = defaultConfig();
  ok(Object.isFrozen(d), 'defaultConfig must return a frozen object — contract immutability');
});

/* ── 2. resolveConfig clamps lockAfterSpinMs to [200, 2000] ── */

t('resolveConfig: lockAfterSpinMs clamped low to 200', () => {
  const c = resolveConfig({ spinControl: { lockAfterSpinMs: 0 } });
  eq(c.lockAfterSpinMs, 200, 'lockAfterSpinMs floor must clamp to 200');
});

t('resolveConfig: lockAfterSpinMs clamped high to 2000', () => {
  const c = resolveConfig({ spinControl: { lockAfterSpinMs: 99999 } });
  eq(c.lockAfterSpinMs, 2000, 'lockAfterSpinMs ceiling must clamp to 2000');
});

t('resolveConfig: lockAfterSpinMs accepts mid-range value verbatim', () => {
  const c = resolveConfig({ spinControl: { lockAfterSpinMs: 600 } });
  eq(c.lockAfterSpinMs, 600, 'mid-range value must pass through');
});

t('resolveConfig: lockAfterSpinMs falls back to default when key absent', () => {
  const c = resolveConfig({ spinControl: {} });
  eq(c.lockAfterSpinMs, defaultConfig().lockAfterSpinMs, 'absent key must yield default');
});

t('resolveConfig: lockAfterSpinMs NaN clamped to floor (not silently dropped)', () => {
  const c = resolveConfig({ spinControl: { lockAfterSpinMs: 'banana' } });
  eq(c.lockAfterSpinMs, 200, 'non-numeric input must clamp to floor');
});

t('resolveConfig: schemaVersion preserved on resolve', () => {
  const c = resolveConfig({ spinControl: { lockAfterSpinMs: 500 } });
  eq(c.schemaVersion, '1', 'schemaVersion must survive resolve');
});

/* ── 3. Runtime wires __SPIN_READY__ Promise + data-spin-ready attribute ── */

t('emitSpinControlRuntime: enabled wires window.__SPIN_READY__ Promise', () => {
  const src = emitSpinControlRuntime(defaultConfig());
  ct(src, '__SPIN_READY__', '__SPIN_READY__ symbol missing from runtime');
  ct(src, 'new Promise', 'Promise constructor not used to mint __SPIN_READY__');
});

t('emitSpinControlRuntime: enabled wires data-spin-ready attribute', () => {
  const src = emitSpinControlRuntime(defaultConfig());
  ct(src, 'data-spin-ready', 'data-spin-ready attribute set/unset missing');
  /* Both true AND false flips must exist for a symmetric busy/ready signal. */
  ct(src, "'data-spin-ready', 'true'",  'ready flip missing');
  ct(src, "'data-spin-ready', 'false'", 'busy flip missing');
});

t('emitSpinControlRuntime: LOCK_AFTER_SPIN_MS baked from resolved cfg', () => {
  const src = emitSpinControlRuntime({ ...defaultConfig(), lockAfterSpinMs: 650 });
  ct(src, 'LOCK_AFTER_SPIN_MS    = 650', 'baked lock window not interpolated');
});

t('emitSpinControlRuntime: ready watchdog arms on preSpin', () => {
  const src = emitSpinControlRuntime(defaultConfig());
  ct(src, '_armSpinReadyWatchdog', 'watchdog arm helper missing');
  ct(src, '_markSpinBusy',          'busy marker helper missing');
  ct(src, '_markSpinReady',         'ready marker helper missing');
});

t('emitSpinControlRuntime: no hard-coded magic > 800ms timeout literal', () => {
  const src = emitSpinControlRuntime(defaultConfig());
  /* Reject obvious offenders that QA-1 flagged. The runtime should source
   * every long timeout from the resolved config, never from a literal. */
  nct(src, 'setTimeout(_drain, 1500)',  'hard-coded 1500ms setTimeout regression');
  nct(src, 'setTimeout(_release, 1500)', 'hard-coded 1500ms setTimeout regression');
  nct(src, ', 1500)',                    'bare 1500 magic literal regression');
});

t('emitSpinControlRuntime: disabled stub still resolves __SPIN_READY__', () => {
  const src = emitSpinControlRuntime({ ...defaultConfig(), enabled: false });
  ct(src, '__SPIN_READY__',     'disabled stub must still expose the Promise');
  ct(src, 'Promise.resolve(true)', 'disabled stub must resolve immediately to avoid wedging callers');
});

/* ── 4. Markup carries the initial ready attribute ── */

t('emitSpinControlMarkup: initial data-spin-ready="true" on idle CTA', () => {
  const html = emitSpinControlMarkup(defaultConfig());
  ct(html, 'data-spin-ready="true"', 'initial ready signal missing from markup');
});

/* ── 5. Vendor-neutral hygiene ── */

t('vendor-neutral: no banned vendor strings in runtime', () => {
  const src = emitSpinControlRuntime(defaultConfig()).toLowerCase();
  for (const banned of ['gates','olympus','reactoonz','megaways','netent','wrath',
                        'sweet bonanza','pragmatic','microgaming','playa-slot']) {
    nct(src, banned, 'banned vendor string: ' + banned);
  }
});

console.log('\n--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
