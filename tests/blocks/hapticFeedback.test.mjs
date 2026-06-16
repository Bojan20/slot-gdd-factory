/* eslint-disable no-console */
import {
  defaultConfig, resolveConfig,
  emitHapticFeedbackRuntime,
} from '../../src/blocks/hapticFeedback.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; } };
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ok = (c, m = '') => { if (!c) throw new Error(`expected truthy — ${m}`); };
const ct = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };
const nc = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`should NOT include ${JSON.stringify(n)} — ${m}`); };

console.log('— blocks/hapticFeedback.mjs —');

/* ─── defaults ─────────────────────────────────────────────────────── */

t('defaultConfig: opt-in (disabled by default)', () => {
  const c = defaultConfig();
  eq(c.enabled, false);
  eq(c.bigWinMinTier, 3);
  eq(c.fsTrigger, true);
  eq(c.maxDurationMs, 500);
  ok(Array.isArray(c.patterns.bigWin));
  ok(Array.isArray(c.patterns.fsTrigger));
});

t('defaultConfig: patterns are frozen prototype-safe', () => {
  const a = defaultConfig();
  const b = defaultConfig();
  // mutate one — other untouched (no shared reference leak)
  a.patterns.bigWin.push(999);
  eq(b.patterns.bigWin.includes(999), false);
});

/* ─── resolveConfig — happy path ───────────────────────────────────── */

t('resolveConfig: enabled flag honored', () => {
  eq(resolveConfig({ hapticFeedback: { enabled: true } }).enabled, true);
  eq(resolveConfig({ hapticFeedback: { enabled: false } }).enabled, false);
});

t('resolveConfig: bigWinMinTier clamped 1..5', () => {
  eq(resolveConfig({ hapticFeedback: { bigWinMinTier: 0 } }).bigWinMinTier, 1);
  eq(resolveConfig({ hapticFeedback: { bigWinMinTier: 10 } }).bigWinMinTier, 5);
  eq(resolveConfig({ hapticFeedback: { bigWinMinTier: 4 } }).bigWinMinTier, 4);
  eq(resolveConfig({ hapticFeedback: { bigWinMinTier: 2.7 } }).bigWinMinTier, 2);
});

t('resolveConfig: maxDurationMs clamped 50..2000', () => {
  eq(resolveConfig({ hapticFeedback: { maxDurationMs: 10 } }).maxDurationMs, 50);
  eq(resolveConfig({ hapticFeedback: { maxDurationMs: 9999 } }).maxDurationMs, 2000);
  eq(resolveConfig({ hapticFeedback: { maxDurationMs: 800 } }).maxDurationMs, 800);
});

t('resolveConfig: fsTrigger boolean', () => {
  eq(resolveConfig({ hapticFeedback: { fsTrigger: false } }).fsTrigger, false);
  eq(resolveConfig({ hapticFeedback: { fsTrigger: true } }).fsTrigger, true);
});

t('resolveConfig: custom patterns accepted', () => {
  const c = resolveConfig({ hapticFeedback: {
    patterns: { bigWin: [10, 20, 10], fsTrigger: [5, 5] },
  }});
  eq(c.patterns.bigWin.join(','), '10,20,10');
  eq(c.patterns.fsTrigger.join(','), '5,5');
});

/* ─── resolveConfig — adversarial inputs ───────────────────────────── */

t('resolveConfig: rejects negative pattern values', () => {
  const c = resolveConfig({ hapticFeedback: {
    patterns: { bigWin: [-10, 20, -5, 30] },
  }});
  // negatives filtered out — only 20, 30 survive
  eq(c.patterns.bigWin.join(','), '20,30');
});

t('resolveConfig: rejects out-of-range pattern values (>1000ms)', () => {
  const c = resolveConfig({ hapticFeedback: {
    patterns: { bigWin: [50, 9999, 60] },
  }});
  eq(c.patterns.bigWin.join(','), '50,60');
});

t('resolveConfig: rejects non-array patterns silently', () => {
  const c = resolveConfig({ hapticFeedback: {
    patterns: { bigWin: 'not-an-array', fsTrigger: null },
  }});
  // defaults preserved
  ok(Array.isArray(c.patterns.bigWin));
  ok(Array.isArray(c.patterns.fsTrigger));
});

t('resolveConfig: empty pattern array preserves default', () => {
  const c = resolveConfig({ hapticFeedback: {
    patterns: { bigWin: [] },
  }});
  ok(c.patterns.bigWin.length > 0);
});

t('resolveConfig: null/undefined model handled', () => {
  ok(resolveConfig().enabled === false);
  ok(resolveConfig(null).enabled === false);
  ok(resolveConfig({}).enabled === false);
  ok(resolveConfig({ hapticFeedback: null }).enabled === false);
});

/* ─── emitHapticFeedbackRuntime ─────────────────────────────────────── */

t('emitRuntime: disabled emits stub (no behavior)', () => {
  const r = emitHapticFeedbackRuntime(defaultConfig());
  ct(r, 'window.hapticFeedback');
  ct(r, 'function () { return false; }');
  ct(r, 'HAPTIC_FEEDBACK_STATE');
  nc(r, 'navigator.vibrate'); // must NOT touch navigator when disabled
});

t('emitRuntime: enabled emits navigator.vibrate gate', () => {
  const r = emitHapticFeedbackRuntime(resolveConfig({ hapticFeedback: { enabled: true } }));
  ct(r, 'navigator.vibrate');
  ct(r, 'prefers-reduced-motion');
  ct(r, '__SLOT_AUTOSPIN_ACTIVE__');
  ct(r, 'onBigWinTierEntered');
  ct(r, 'onFsTrigger');
});

t('emitRuntime: respects fsTrigger=false (no FS listener)', () => {
  const r = emitHapticFeedbackRuntime(resolveConfig({ hapticFeedback: {
    enabled: true, fsTrigger: false,
  }}));
  nc(r, "HookBus.on('onFsTrigger'");
});

t('emitRuntime: bigWinMinTier hard-coded into gate', () => {
  const r = emitHapticFeedbackRuntime(resolveConfig({ hapticFeedback: {
    enabled: true, bigWinMinTier: 4,
  }}));
  ct(r, 'BIG_WIN_MIN_TIER = 4');
});

t('emitRuntime: maxDurationMs hard-coded', () => {
  const r = emitHapticFeedbackRuntime(resolveConfig({ hapticFeedback: {
    enabled: true, maxDurationMs: 750,
  }}));
  ct(r, 'MAX_DURATION_MS = 750');
});

t('emitRuntime: custom pattern serialized', () => {
  const r = emitHapticFeedbackRuntime(resolveConfig({ hapticFeedback: {
    enabled: true, patterns: { bigWin: [25, 30, 25] },
  }}));
  ct(r, '[25,30,25]');
});

/* ─── runtime contract simulation (sandbox eval) ───────────────────── */

t('runtime: cap function clips pattern total to MAX_DURATION_MS', () => {
  // Simulate sandbox: install a fake navigator + matchMedia + HookBus.
  const sandbox = {
    vibrations: [],
    navigator: { vibrate(p) { sandbox.vibrations.push(p); return true; } },
    matchMedia() { return { matches: false }; },
    __SLOT_AUTOSPIN_ACTIVE__: false,
    HookBus: { on() {} },
  };
  const src = emitHapticFeedbackRuntime(resolveConfig({ hapticFeedback: {
    enabled: true, maxDurationMs: 100,
    patterns: { bigWin: [80, 80, 80] }, // total 240ms, should clip to 100
  }}));
  const fn = new Function('window', 'navigator', `
    ${src.replace(/window\./g, 'window.')}
    return window.hapticFeedback;
  `);
  const haptic = fn(sandbox, sandbox.navigator);
  haptic('bigWin', 'test');
  const fired = sandbox.vibrations[0];
  const total = fired.reduce((s, x) => s + x, 0);
  ok(total <= 100, `cap exceeded: ${total}ms > 100ms`);
});

t('runtime: prefers-reduced-motion blocks fire', () => {
  const sandbox = {
    vibrations: [],
    navigator: { vibrate(p) { sandbox.vibrations.push(p); return true; } },
    matchMedia() { return { matches: true }; }, // REDUCED MOTION ON
    __SLOT_AUTOSPIN_ACTIVE__: false,
    HookBus: { on() {} },
  };
  const src = emitHapticFeedbackRuntime(resolveConfig({ hapticFeedback: {
    enabled: true,
  }}));
  const fn = new Function('window', 'navigator', `
    ${src}
    return window.hapticFeedback;
  `);
  const haptic = fn(sandbox, sandbox.navigator);
  const result = haptic('bigWin', 'test');
  eq(result, false, 'reduced-motion did not block');
  eq(sandbox.vibrations.length, 0);
});

t('runtime: autospin active blocks fire (player-protection)', () => {
  const sandbox = {
    vibrations: [],
    navigator: { vibrate(p) { sandbox.vibrations.push(p); return true; } },
    matchMedia() { return { matches: false }; },
    __SLOT_AUTOSPIN_ACTIVE__: true, // AUTOSPIN ON
    HookBus: { on() {} },
  };
  const src = emitHapticFeedbackRuntime(resolveConfig({ hapticFeedback: {
    enabled: true,
  }}));
  const fn = new Function('window', 'navigator', `
    ${src}
    return window.hapticFeedback;
  `);
  const haptic = fn(sandbox, sandbox.navigator);
  const result = haptic('bigWin', 'test');
  eq(result, false, 'autospin did not block');
});

t('runtime: missing navigator.vibrate returns false (browser without API)', () => {
  const sandbox = {
    matchMedia() { return { matches: false }; },
    __SLOT_AUTOSPIN_ACTIVE__: false,
    HookBus: { on() {} },
  };
  const src = emitHapticFeedbackRuntime(resolveConfig({ hapticFeedback: {
    enabled: true,
  }}));
  const fn = new Function('window', 'navigator', `
    ${src}
    return window.hapticFeedback;
  `);
  const haptic = fn(sandbox, {}); // navigator without vibrate
  const result = haptic('bigWin', 'test');
  eq(result, false);
});

t('runtime: HookBus wires onBigWinTierEntered with tier gate', () => {
  const handlers = {};
  const sandbox = {
    vibrations: [],
    navigator: { vibrate(p) { sandbox.vibrations.push(p); return true; } },
    matchMedia() { return { matches: false }; },
    __SLOT_AUTOSPIN_ACTIVE__: false,
    HookBus: { on(ev, fn) { handlers[ev] = fn; } },
  };
  const src = emitHapticFeedbackRuntime(resolveConfig({ hapticFeedback: {
    enabled: true, bigWinMinTier: 3,
  }}));
  const fn = new Function('window', 'navigator', `
    ${src}
    return window.hapticFeedback;
  `);
  fn(sandbox, sandbox.navigator);

  // tier 2 should NOT fire
  handlers.onBigWinTierEntered({ tier: 2 });
  eq(sandbox.vibrations.length, 0, 'tier 2 fired below floor');

  // tier 3 (floor) should fire
  handlers.onBigWinTierEntered({ tier: 3 });
  eq(sandbox.vibrations.length, 1, 'tier 3 floor did not fire');

  // tier 5 should fire
  handlers.onBigWinTierEntered({ tier: 5 });
  eq(sandbox.vibrations.length, 2);
});

t('runtime: STATE record updated on fire', () => {
  const sandbox = {
    vibrations: [],
    navigator: { vibrate(p) { sandbox.vibrations.push(p); return true; } },
    matchMedia() { return { matches: false }; },
    __SLOT_AUTOSPIN_ACTIVE__: false,
    HookBus: { on() {} },
  };
  const src = emitHapticFeedbackRuntime(resolveConfig({ hapticFeedback: {
    enabled: true,
  }}));
  const fn = new Function('window', 'navigator', `
    ${src}
    return { fn: window.hapticFeedback, state: window.HAPTIC_FEEDBACK_STATE };
  `);
  const { fn: haptic, state } = fn(sandbox, sandbox.navigator);
  haptic('bigWin', 'unit-test-reason');
  eq(state.lastReason, 'unit-test-reason');
  ok(state.lastFiredAt > 0, 'lastFiredAt not set');
});

console.log(`\n  pass: ${pass}   fail: ${fail}`);
if (fail) process.exit(1);
