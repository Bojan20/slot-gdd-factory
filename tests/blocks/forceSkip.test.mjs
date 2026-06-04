/* eslint-disable no-console */
/**
 * Wave V2 — forceSkip block tests.
 *
 * Coverage matrix:
 *   • defaultConfig / resolveConfig (RGB regex, clamp, boolean coercion,
 *     phase gate booleans, label/aria length, auto-enable)
 *   • emitForceSkipCSS  (disabled = empty, enabled = z-index 25 baked)
 *   • emitForceSkipMarkup (id, hidden, XSS escape, data-phase attr)
 *   • emitForceSkipRuntime (stub when disabled, full when enabled,
 *     wires onSpinResult/onFsTrigger/onFsEnd/onSkipComplete/preSpin)
 *   • sandbox: per-phase show gating (rollup/fsIntro/fsOutro/celebration),
 *     forceSkipRequest sets window.__SLOT_SKIPPED__ + emits onSkipRequested,
 *     disabledPressed + hidePressed honored, onSkipComplete hides + clears,
 *     preSpin hides + clears, MIN_ROLLUP_MS_FOR_SHOW gate, award=0 gate.
 */

import {
  defaultConfig, resolveConfig,
  emitForceSkipCSS, emitForceSkipMarkup, emitForceSkipRuntime,
} from '../../src/blocks/forceSkip.mjs';
import {
  emitHookBusRuntime,
} from '../../src/blocks/hookBus.mjs';

let pass = 0, fail = 0;
const pending = [];
const t = (n, fn) => {
  try {
    const ret = fn();
    if (ret && typeof ret.then === 'function') {
      pending.push(ret.then(
        () => { console.log('  ✓', n); pass++; },
        (e) => { console.log('  ✗', n, '\n     ', e.message); fail++; },
      ));
    } else {
      console.log('  ✓', n); pass++;
    }
  } catch (e) {
    console.log('  ✗', n, '\n     ', e.message); fail++;
  }
};
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ct = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };
const nct = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`unexpected substring ${JSON.stringify(n)} — ${m}`); };
const ok = (v, m = '') => { if (!v) throw new Error(`expected truthy — ${m}`); };

console.log('— blocks/forceSkip.mjs —');

/* ── defaults + resolveConfig ── */

t('defaultConfig: industry-baseline values', () => {
  const d = defaultConfig();
  eq(d.enabled, false);
  eq(d.chipLabel, 'SKIP');
  eq(d.chipColor, '90,180,255');
  eq(d.disabledPressed, true);
  eq(d.hidePressed, false);
  eq(d.showDuringRollup, true);
  eq(d.showDuringFsIntro, true);
  eq(d.showDuringFsOutro, true);
  eq(d.showDuringCelebration, false);
  eq(d.minRollupMsForShow, 600);
  eq(d.ariaLabel, 'Skip animation');
});

t('resolveConfig: per-phase booleans coerced', () => {
  const c = resolveConfig({ forceSkip: {
    showDuringRollup: 0, showDuringFsIntro: 1,
    showDuringFsOutro: 'yes', showDuringCelebration: true,
  }});
  eq(c.showDuringRollup, false);
  eq(c.showDuringFsIntro, true);
  eq(c.showDuringFsOutro, true);
  eq(c.showDuringCelebration, true);
});

t('resolveConfig: minRollupMsForShow clamped [0, 5000]', () => {
  eq(resolveConfig({ forceSkip: { minRollupMsForShow: -1 } }).minRollupMsForShow, 0);
  eq(resolveConfig({ forceSkip: { minRollupMsForShow: 99999 } }).minRollupMsForShow, 5000);
  eq(resolveConfig({ forceSkip: { minRollupMsForShow: 1200 } }).minRollupMsForShow, 1200);
});

t('resolveConfig: chipColor RGB regex enforces shape', () => {
  eq(resolveConfig({ forceSkip: { chipColor: '10,20,30' } }).chipColor, '10,20,30');
  eq(resolveConfig({ forceSkip: { chipColor: '#abcdef' } }).chipColor, '90,180,255');
  eq(resolveConfig({ forceSkip: { chipColor: 'blue' } }).chipColor, '90,180,255');
});

t('resolveConfig: chipLabel + ariaLabel length cap', () => {
  eq(resolveConfig({ forceSkip: { chipLabel: 'X'.repeat(17) } }).chipLabel, 'SKIP');
  eq(resolveConfig({ forceSkip: { ariaLabel: 'X'.repeat(65) } }).ariaLabel, 'Skip animation');
});

t('resolveConfig: auto-enable from features[].kind = force_skip', () => {
  for (const k of ['force_skip', 'force-skip', 'FORCE_SKIP', 'skip_animation', 'skip-animation']) {
    eq(resolveConfig({ features: [{ kind: k }] }).enabled, true, k);
  }
  eq(resolveConfig({ features: [{ kind: 'free_spins' }] }).enabled, false);
});

/* ── CSS ── */

t('emitForceSkipCSS: empty when disabled', () => {
  eq(emitForceSkipCSS({ ...defaultConfig(), enabled: false }), '');
});

t('emitForceSkipCSS: z-index 25 baked when enabled', () => {
  const css = emitForceSkipCSS({ ...defaultConfig(), enabled: true });
  ct(css, 'z-index: 25');
  ct(css, '.force-skip-btn');
});

t('emitForceSkipCSS: fixed bottom positioning + mobile media query', () => {
  const css = emitForceSkipCSS({ ...defaultConfig(), enabled: true });
  ct(css, 'position: fixed');
  ct(css, 'bottom: 20px');
  ct(css, '@media (max-width: 480px)');
});

/* ── Markup ── */

t('emitForceSkipMarkup: empty when disabled', () => {
  eq(emitForceSkipMarkup({ ...defaultConfig(), enabled: false }), '');
});

t('emitForceSkipMarkup: id=forceSkipBtn + hidden + data-phase attr', () => {
  const html = emitForceSkipMarkup({ ...defaultConfig(), enabled: true });
  ct(html, 'id="forceSkipBtn"');
  ct(html, 'class="force-skip-btn"');
  ct(html, 'hidden');
  ct(html, 'data-phase=""');
});

t('emitForceSkipMarkup: XSS chipLabel + ariaLabel escaped', () => {
  const html = emitForceSkipMarkup({
    ...defaultConfig(), enabled: true,
    chipLabel: '<x>',
    ariaLabel: 'a"><b>',
  });
  ct(html, '&lt;x&gt;');
  ct(html, '&quot;');
  nct(html, '<x>');
});

/* ── Runtime: disabled stub ── */

t('emitForceSkipRuntime: disabled emits stub', () => {
  const src = emitForceSkipRuntime({ ...defaultConfig(), enabled: false });
  ct(src, 'window.forceSkipShow    = function () {}');
  ct(src, 'window.forceSkipHide    = function () {}');
  ct(src, 'window.forceSkipRequest = function () {}');
  ct(src, 'enabled: false');
  ct(src, 'window.__SLOT_SKIPPED__ = false');
});

t('emitForceSkipRuntime: enabled wires all 5 lifecycle listeners + emit', () => {
  const src = emitForceSkipRuntime({ ...defaultConfig(), enabled: true });
  ct(src, "HookBus.on('onSpinResult'");
  ct(src, "HookBus.on('onFsTrigger'");
  ct(src, "HookBus.on('onFsEnd'");
  ct(src, "HookBus.on('onSkipComplete'");
  ct(src, "HookBus.on('preSpin'");
  ct(src, "HookBus.emit('onSkipRequested'");
});

/* ── Sandbox ── */

function buildSandbox(cfg, opts = {}) {
  const hbSrc = emitHookBusRuntime({ debugLog: false });
  const skipSrc = emitForceSkipRuntime(cfg);

  const elements = new Map();
  function makeElement(id) {
    if (elements.has(id)) return elements.get(id);
    const el = {
      id, hidden: id === 'forceSkipBtn',
      disabled: false,
      className: '',
      _classes: new Set(),
      _attrs: {},
      _listeners: new Map(),
      classList: {
        add(c) { el._classes.add(c); },
        remove(c) { el._classes.delete(c); },
        contains(c) { return el._classes.has(c); },
      },
      setAttribute(k, v) { el._attrs[k] = v; },
      getAttribute(k) { return el._attrs[k]; },
      addEventListener(name, fn) {
        if (!el._listeners.has(name)) el._listeners.set(name, []);
        el._listeners.get(name).push(fn);
      },
      removeEventListener() {},
      _fire(name, ev) { for (const fn of (el._listeners.get(name) || [])) fn(ev || {}); },
    };
    elements.set(id, el);
    return el;
  }
  makeElement('forceSkipBtn');

  const fakeDocument = {
    readyState: 'complete',
    getElementById(id) { return elements.get(id) || null; },
    addEventListener() {},
  };
  const fakeWindow = opts.window || {};
  const fakeConsole = { warn: () => {}, error: () => {}, log: () => {} };

  /* eslint-disable-next-line no-new-func */
  const factory = new Function(
    'window', 'document', 'console', 'performance', 'setTimeout', 'clearTimeout',
    hbSrc + '\n' + skipSrc + '\nreturn { HookBus: window.HookBus };'
  );
  const perf = { now: () => Date.now() };
  factory(fakeWindow, fakeDocument, fakeConsole, perf, setTimeout, clearTimeout);

  return { window: fakeWindow, document: fakeDocument, elements, HookBus: fakeWindow.HookBus };
}

t('sandbox: onFsTrigger shows button with phase=fsIntro', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true });
  sb.HookBus.emit('onFsTrigger', { award: 10, scatters: 4 });
  const btn = sb.elements.get('forceSkipBtn');
  eq(btn.hidden, false);
  eq(btn._attrs['data-phase'], 'fsIntro');
  eq(sb.window.FORCE_SKIP_STATE.currentPhase, 'fsIntro');
});

t('sandbox: onFsEnd shows button with phase=fsOutro', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true });
  sb.HookBus.emit('onFsEnd', { totalWin: 250 });
  eq(sb.elements.get('forceSkipBtn').hidden, false);
  eq(sb.window.FORCE_SKIP_STATE.currentPhase, 'fsOutro');
});

t('sandbox: onSpinResult with award > 0 + adequate rollup ms shows phase=rollup', async () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true });
  sb.window.__WIN_AWARD__ = 50;
  sb.window.__WIN_ROLLUP_MS__ = 1500;
  sb.HookBus.emit('onSpinResult', { duringFs: false });
  await new Promise(r => setTimeout(r, 10));
  eq(sb.elements.get('forceSkipBtn').hidden, false);
  eq(sb.window.FORCE_SKIP_STATE.currentPhase, 'rollup');
});

t('sandbox: onSpinResult with __WIN_AWARD__ = 0 suppresses show', async () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true });
  sb.window.__WIN_AWARD__ = 0;
  sb.window.__WIN_ROLLUP_MS__ = 1500;
  sb.HookBus.emit('onSpinResult', { duringFs: false });
  await new Promise(r => setTimeout(r, 10));
  eq(sb.elements.get('forceSkipBtn').hidden, true);
});

t('sandbox: onSpinResult with very short rollup ms suppresses show', async () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true, minRollupMsForShow: 600 });
  sb.window.__WIN_AWARD__ = 50;
  sb.window.__WIN_ROLLUP_MS__ = 200;
  sb.HookBus.emit('onSpinResult', { duringFs: false });
  await new Promise(r => setTimeout(r, 10));
  eq(sb.elements.get('forceSkipBtn').hidden, true);
});

t('sandbox: forceSkipRequest sets __SLOT_SKIPPED__ flag + emits onSkipRequested', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true });
  const captured = [];
  sb.HookBus.on('onSkipRequested', (p) => captured.push(p));
  sb.HookBus.emit('onFsTrigger', { award: 10 });
  eq(sb.window.__SLOT_SKIPPED__, false, 'flag clear before request');
  sb.window.forceSkipRequest('button');
  eq(sb.window.__SLOT_SKIPPED__, true, 'flag set on request');
  eq(captured.length, 1);
  eq(captured[0].phase, 'fsIntro');
  eq(captured[0].source, 'button');
});

t('sandbox: forceSkipRequest no-op when button not visible', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true });
  const captured = [];
  sb.HookBus.on('onSkipRequested', (p) => captured.push(p));
  sb.window.forceSkipRequest('button');
  eq(captured.length, 0);
  eq(sb.window.__SLOT_SKIPPED__, false);
});

t('sandbox: forceSkipRequest sanitizes invalid source to "button"', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true });
  const captured = [];
  sb.HookBus.on('onSkipRequested', (p) => captured.push(p));
  sb.HookBus.emit('onFsTrigger', { award: 10 });
  sb.window.forceSkipRequest('haxxor');
  eq(captured[0].source, 'button');
});

t('sandbox: disabledPressed=true disables button after press', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true, disabledPressed: true });
  sb.HookBus.emit('onFsTrigger', { award: 10 });
  sb.window.forceSkipRequest('button');
  eq(sb.elements.get('forceSkipBtn').disabled, true);
});

t('sandbox: disabledPressed=false leaves button enabled after press', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true, disabledPressed: false });
  sb.HookBus.emit('onFsTrigger', { award: 10 });
  sb.window.forceSkipRequest('button');
  eq(sb.elements.get('forceSkipBtn').disabled, false);
});

t('sandbox: hidePressed=true immediately hides button on press', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true, hidePressed: true });
  sb.HookBus.emit('onFsTrigger', { award: 10 });
  sb.window.forceSkipRequest('button');
  eq(sb.elements.get('forceSkipBtn').hidden, true);
});

t('sandbox: onSkipComplete hides button + clears __SLOT_SKIPPED__ flag', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true });
  sb.HookBus.emit('onFsTrigger', { award: 10 });
  sb.window.forceSkipRequest('button');
  eq(sb.window.__SLOT_SKIPPED__, true);
  sb.HookBus.emit('onSkipComplete', { phase: 'fsIntro', duration: 20 });
  eq(sb.elements.get('forceSkipBtn').hidden, true);
  eq(sb.window.__SLOT_SKIPPED__, false);
});

t('sandbox: preSpin hides button + clears flag', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true });
  sb.HookBus.emit('onFsTrigger', { award: 10 });
  sb.window.forceSkipRequest('button');
  sb.HookBus.emit('preSpin', { duringFs: false });
  eq(sb.elements.get('forceSkipBtn').hidden, true);
  eq(sb.window.__SLOT_SKIPPED__, false);
});

t('sandbox: showDuringFsIntro=false gates the show on onFsTrigger', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true, showDuringFsIntro: false });
  sb.HookBus.emit('onFsTrigger', { award: 10 });
  eq(sb.elements.get('forceSkipBtn').hidden, true);
});

t('sandbox: showDuringFsOutro=false gates onFsEnd', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true, showDuringFsOutro: false });
  sb.HookBus.emit('onFsEnd', { totalWin: 1000 });
  eq(sb.elements.get('forceSkipBtn').hidden, true);
});

t('sandbox: showDuringRollup=false gates onSpinResult', async () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true, showDuringRollup: false });
  sb.window.__WIN_AWARD__ = 50;
  sb.window.__WIN_ROLLUP_MS__ = 2000;
  sb.HookBus.emit('onSpinResult', { duringFs: false });
  await new Promise(r => setTimeout(r, 10));
  eq(sb.elements.get('forceSkipBtn').hidden, true);
});

/* ── Hygiene ── */

t('determinism: same config → byte-identical CSS', () => {
  eq(
    emitForceSkipCSS({ ...defaultConfig(), enabled: true }),
    emitForceSkipCSS({ ...defaultConfig(), enabled: true }),
  );
});

t('vendor-neutral: no vendor strings in emitted CSS or runtime', () => {
  const css = emitForceSkipCSS({ ...defaultConfig(), enabled: true });
  const rt  = emitForceSkipRuntime({ ...defaultConfig(), enabled: true });
  for (const banned of ['gates','olympus','reactoonz','megaways','netent','wrath','sweet bonanza']) {
    nct(css.toLowerCase(), banned);
    nct(rt.toLowerCase(),  banned);
  }
});

/* ── async finale ── */
(async () => {
  await Promise.all(pending);
  console.log('\n--- summary ---');
  console.log(`  pass: ${pass}`);
  console.log(`  fail: ${fail}`);
  if (fail > 0) process.exit(1);
})();
