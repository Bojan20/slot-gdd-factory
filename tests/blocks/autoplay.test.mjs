/* eslint-disable no-console */
/**
 * Wave U4 — autoplay block tests.
 *
 * Coverage matrix:
 *   • defaultConfig industry-baseline (steps 10..1000, defaultStep 25)
 *   • resolveConfig validation: step list cleanup + dedupe, defaultStep
 *     clamp to allowed set, RGB regex, null vs positive number for stop
 *     thresholds, auto-enable from feature kind
 *   • emitAutoplayCSS  (disabled = empty, enabled = z-index baked,
 *     mobile media query, chipColor interpolated)
 *   • emitAutoplayMarkup (XSS escape, hidden panel + counter, button)
 *   • emitAutoplayRuntime (stub when disabled, all listeners wired when
 *     enabled, all constants baked)
 *   • Sandbox: full session lifecycle (start emits onAutoplayStart,
 *     postSpin ticks counter + emits onAutoplayTick, stop conditions
 *     fire (completed / singleWinAbove / lossLimit / winLimit / feature /
 *     slam), FS pause + resume behavior, manual stop)
 */

import {
  defaultConfig, resolveConfig,
  emitAutoplayCSS, emitAutoplayMarkup, emitAutoplayRuntime,
} from '../../src/blocks/autoplay.mjs';
import { emitHookBusRuntime } from '../../src/blocks/hookBus.mjs';

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
const eq  = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ct  = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };
const nct = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`unexpected substring ${JSON.stringify(n)} — ${m}`); };
const ok  = (v, m = '') => { if (!v) throw new Error(`expected truthy — ${m}`); };

console.log('— blocks/autoplay.mjs —');

/* ── defaults + resolveConfig ── */

t('defaultConfig: industry-baseline steps + thresholds', () => {
  const d = defaultConfig();
  /* Industry-default ON — autoplay is a baseline player control in modern
   * HTML5 slots. GDDs that explicitly forbid autoplay flip this off via
   * `## Autoplay\nenabled: false`. */
  eq(d.enabled, true);
  eq(d.stepValues.join(','), '10,25,50,100,250,500,1000');
  eq(d.defaultStep, 25);
  eq(d.betUnitFallback, 1.0);
  eq(d.stopOnAnyFeatureTrigger, true);
  eq(d.stopOnSingleWinX, null);
  eq(d.stopOnBalanceBelow, null);
  eq(d.stopOnLossAbove, null);
  eq(d.stopOnWinAbove, null);
  eq(d.interSpinDelayMs, 250);
  eq(d.showCounter, true);
});

t('resolveConfig: stepValues cleanup, dedup, clamp', () => {
  const c = resolveConfig({ autoplay: { stepValues: [10, 25, 25, -5, 'bad', 50, 12345, 100] } });
  eq(c.stepValues.join(','), '10,25,50,100', 'invalid + dupes stripped, 12345 clamped out');
});

t('resolveConfig: defaultStep must be in stepValues, else first allowed', () => {
  eq(resolveConfig({ autoplay: { defaultStep: 50 } }).defaultStep, 50);
  eq(resolveConfig({ autoplay: { stepValues: [20, 40], defaultStep: 25 } }).defaultStep, 20);
  eq(resolveConfig({ autoplay: { defaultStep: 999 } }).defaultStep, 25);
});

t('resolveConfig: stop thresholds — null kept, positive accepted, zero rejected', () => {
  const c = resolveConfig({ autoplay: {
    stopOnSingleWinX: 50, stopOnBalanceBelow: 1.5,
    stopOnLossAbove: null, stopOnWinAbove: 0,
  }});
  eq(c.stopOnSingleWinX, 50);
  eq(c.stopOnBalanceBelow, 1.5);
  eq(c.stopOnLossAbove, null);
  eq(c.stopOnWinAbove, null, '0 is treated as null (no threshold)');
});

t('resolveConfig: interSpinDelayMs clamped [0, 5000]', () => {
  eq(resolveConfig({ autoplay: { interSpinDelayMs: -10 } }).interSpinDelayMs, 0);
  eq(resolveConfig({ autoplay: { interSpinDelayMs: 99999 } }).interSpinDelayMs, 5000);
  eq(resolveConfig({ autoplay: { interSpinDelayMs: 400 } }).interSpinDelayMs, 400);
});

t('resolveConfig: chipColor RGB regex enforces shape', () => {
  eq(resolveConfig({ autoplay: { chipColor: '10, 20, 30' } }).chipColor, '10,20,30');
  eq(resolveConfig({ autoplay: { chipColor: '#abc' } }).chipColor, '90,180,255');
});

t('resolveConfig: auto-enable from features[].kind = autoplay', () => {
  for (const k of ['autoplay', 'auto_spin', 'auto-spin', 'AUTO_PLAY']) {
    eq(resolveConfig({ features: [{ kind: k }] }).enabled, true, k);
  }
  /* free_spins alone leaves the default; default is now ON, so still true.
   * An explicit `autoplay.enabled = false` (jurisdictional opt-out) is the
   * only path that forces it back off — covered separately below. */
  eq(resolveConfig({ features: [{ kind: 'free_spins' }] }).enabled, true);
  eq(resolveConfig({ autoplay: { enabled: false } }).enabled, false,
     'explicit opt-out flips it back off');
});

/* ── CSS ── */

t('emitAutoplayCSS: empty when disabled', () => {
  eq(emitAutoplayCSS({ ...defaultConfig(), enabled: false }), '');
});

t('emitAutoplayCSS: enabled bakes button + panel + counter selectors', () => {
  const css = emitAutoplayCSS({ ...defaultConfig(), enabled: true });
  for (const sel of ['.autoplay-btn', '.autoplay-btn.is-active', '.autoplay-panel',
                     '.autoplay-steps', '.autoplay-step', '.autoplay-step.is-selected',
                     '.autoplay-start', '.autoplay-counter']) {
    ct(css, sel);
  }
  /* Mobile breakpoint widened to 620px so the bottom-right spin cluster
     re-snaps its safe-area offsets on phones in portrait. */
  ct(css, '@media (max-width: 620px)');
});

t('emitAutoplayCSS: chipColor interpolated', () => {
  const css = emitAutoplayCSS({ ...defaultConfig(), enabled: true, chipColor: '11,22,33' });
  ct(css, 'rgba(11,22,33');
});

/* ── Markup ── */

t('emitAutoplayMarkup: empty when disabled', () => {
  eq(emitAutoplayMarkup({ ...defaultConfig(), enabled: false }), '');
});

t('emitAutoplayMarkup: panel + counter (no duplicate button — reuses sideHud autoBtn)', () => {
  const html = emitAutoplayMarkup({ ...defaultConfig(), enabled: true });
  /* Boki rule (04.06.2026): autoplay block must NOT render a floating
   * button. It reuses the existing #autoBtn rendered by the orchestrator
   * inside .sideHud next to the spin CTA. */
  nct(html, 'id="autoplayBtn"');
  nct(html, 'class="autoplay-btn"');
  ct(html, 'id="autoplayPanel"');
  ct(html, 'role="dialog"');
  ct(html, 'id="autoplayCounter"');
  ct(html, 'aria-live="polite"');
});

t('emitAutoplayMarkup: panel host text is XSS-safe', () => {
  /* No ariaLabel is rendered into markup anymore (the existing #autoBtn
   * carries its own aria attributes). Sanity check: nothing in the
   * emitted panel HTML accepts user-supplied text. */
  const html = emitAutoplayMarkup({ ...defaultConfig(), enabled: true });
  nct(html, '<script');
  nct(html, 'onerror=');
});

/* ── Runtime stub vs enabled ── */

t('emitAutoplayRuntime: disabled emits stub (window.autoplay* no-op)', () => {
  const src = emitAutoplayRuntime({ ...defaultConfig(), enabled: false });
  ct(src, 'window.autoplayStart    = function () {}');
  ct(src, 'window.autoplayStop     = function () {}');
  ct(src, 'window.autoplayIsActive = function () { return false; }');
  ct(src, 'window.__SLOT_AUTOSPIN_ACTIVE__ = false');
  nct(src, "HookBus.on(");
});

t('emitAutoplayRuntime: enabled wires all 5 lifecycle listeners + emits', () => {
  const src = emitAutoplayRuntime({ ...defaultConfig(), enabled: true });
  ct(src, "HookBus.on('onSpinResult'");
  ct(src, "HookBus.on('postSpin'");
  ct(src, "HookBus.on('onFsTrigger'");
  ct(src, "HookBus.on('onFsEnd'");
  ct(src, "HookBus.on('onSlamRequested'");
  ct(src, "HookBus.emit('onAutoplayStart'");
  ct(src, "HookBus.emit('onAutoplayTick'");
  ct(src, "HookBus.emit('onAutoplayStop'");
});

/* ── Sandbox lifecycle ── */

function buildSandbox(cfg, opts = {}) {
  const hbSrc = emitHookBusRuntime({ debugLog: false });
  const apSrc = emitAutoplayRuntime(cfg);

  const elements = new Map();
  function makeElement(id) {
    if (elements.has(id)) return elements.get(id);
    const el = {
      id, hidden: id === 'autoplayPanel' || id === 'autoplayCounter',
      disabled: false,
      className: '', textContent: '', innerHTML: '',
      _classes: new Set(), _attrs: {}, _listeners: new Map(),
      _children: [],
      classList: {
        add(c) { el._classes.add(c); },
        remove(c) { el._classes.delete(c); },
        toggle(c, on) { if (on) el._classes.add(c); else el._classes.delete(c); },
        contains(c) { return el._classes.has(c); },
      },
      setAttribute(k, v) { el._attrs[k] = v; },
      getAttribute(k) { return el._attrs[k]; },
      addEventListener(name, fn) {
        if (!el._listeners.has(name)) el._listeners.set(name, []);
        el._listeners.get(name).push(fn);
      },
      removeEventListener() {},
      appendChild(c) { el._children.push(c); },
      click() { for (const fn of (el._listeners.get('click') || [])) fn({}); },
      _fire(name, ev) { for (const fn of (el._listeners.get(name) || [])) fn(ev || {}); },
    };
    elements.set(id, el);
    return el;
  }
  /* autoBtn is the orchestrator-rendered sideHud control that autoplay
   * now binds to (Boki rule: no duplicate floating button). */
  for (const id of ['autoBtn','autoplayPanel','autoplaySteps','autoplayStart','autoplayCounter','spinBtn']) {
    makeElement(id);
  }

  const fakeDocument = {
    readyState: 'complete',
    getElementById(id) { return elements.get(id) || null; },
    addEventListener() {},
    createElement(tag) {
      const el = {
        tag, textContent: '', className: '', type: '',
        _classes: new Set(), _attrs: {}, _listeners: new Map(),
        setAttribute(k, v) { el._attrs[k] = v; },
        getAttribute(k) { return el._attrs[k]; },
        addEventListener(n, fn) {
          if (!el._listeners.has(n)) el._listeners.set(n, []);
          el._listeners.get(n).push(fn);
        },
        classList: {
          add(c) { el._classes.add(c); },
          remove(c) { el._classes.delete(c); },
          contains(c) { return el._classes.has(c); },
        },
      };
      return el;
    },
  };
  const fakeWindow = opts.window || {};
  const fakeConsole = { warn: () => {}, error: () => {}, log: () => {} };

  /* eslint-disable-next-line no-new-func */
  const factory = new Function(
    'window', 'document', 'console', 'performance', 'setTimeout', 'clearTimeout',
    hbSrc + '\n' + apSrc + '\nreturn { HookBus: window.HookBus };'
  );
  const perf = { now: () => Date.now() };
  factory(fakeWindow, fakeDocument, fakeConsole, perf, setTimeout, clearTimeout);

  return { window: fakeWindow, document: fakeDocument, elements, HookBus: fakeWindow.HookBus };
}

t('sandbox: autoplayStart emits onAutoplayStart + sets active + sets global flag', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true });
  const captured = [];
  sb.HookBus.on('onAutoplayStart', (p) => captured.push(p));
  sb.window.autoplayStart(50);
  eq(captured.length, 1);
  eq(captured[0].step, 50);
  eq(captured[0].remaining, 50);
  eq(sb.window.AUTOPLAY_STATE.active, true);
  eq(sb.window.__SLOT_AUTOSPIN_ACTIVE__, true);
});

t('sandbox: autoplayStart with invalid step falls back to defaultStep', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true });
  sb.window.autoplayStart(999);
  eq(sb.window.AUTOPLAY_STATE.step, 25);
});

t('sandbox: autoplayStop emits onAutoplayStop + clears flag', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true });
  const stopEvents = [];
  sb.HookBus.on('onAutoplayStop', (p) => stopEvents.push(p));
  sb.window.autoplayStart(25);
  sb.window.autoplayStop('manual');
  eq(stopEvents.length, 1);
  eq(stopEvents[0].reason, 'manual');
  eq(sb.window.AUTOPLAY_STATE.active, false);
  eq(sb.window.__SLOT_AUTOSPIN_ACTIVE__, false);
});

t('sandbox: postSpin (BASE) ticks counter + emits onAutoplayTick', () => {
  /* Use stepValues that include 3 so the session can be 3 spins long. */
  const sb = buildSandbox({ ...defaultConfig(), enabled: true, interSpinDelayMs: 0,
    stepValues: [3, 10, 25, 50], defaultStep: 3 });
  const ticks = [];
  sb.HookBus.on('onAutoplayTick', (p) => ticks.push(p));
  sb.window.autoplayStart(3);
  sb.window.__WIN_AWARD__ = 0;
  sb.HookBus.emit('onSpinResult', { duringFs: false });
  sb.HookBus.emit('postSpin', { duringFs: false });
  eq(ticks.length, 1);
  eq(ticks[0].remaining, 2);
  eq(sb.window.AUTOPLAY_STATE.completed, 1);
});

t('sandbox: postSpin (FS) does NOT count against session', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true,
    stepValues: [5, 10, 25], defaultStep: 5 });
  sb.window.autoplayStart(5);
  sb.HookBus.emit('postSpin', { duringFs: true });
  eq(sb.window.AUTOPLAY_STATE.completed, 0);
  eq(sb.window.AUTOPLAY_STATE.remaining, 5);
});

t('sandbox: completed stop reason after exhausting step count', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true, interSpinDelayMs: 0,
    stepValues: [2, 10, 25], defaultStep: 2 });
  const stops = [];
  sb.HookBus.on('onAutoplayStop', (p) => stops.push(p));
  sb.window.autoplayStart(2);
  sb.window.__WIN_AWARD__ = 0;
  sb.HookBus.emit('onSpinResult', { duringFs: false });
  sb.HookBus.emit('postSpin', { duringFs: false });
  sb.HookBus.emit('onSpinResult', { duringFs: false });
  sb.HookBus.emit('postSpin', { duringFs: false });
  eq(stops.length, 1);
  eq(stops[0].reason, 'completed');
  eq(stops[0].completed, 2);
});

t('sandbox: stopOnSingleWinX fires when last win crosses threshold', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true, interSpinDelayMs: 0,
    stopOnSingleWinX: 50, betUnitFallback: 1 });
  const stops = [];
  sb.HookBus.on('onAutoplayStop', (p) => stops.push(p));
  sb.window.autoplayStart(10);
  sb.window.__WIN_AWARD__ = 60;
  sb.HookBus.emit('onSpinResult', { duringFs: false });
  sb.HookBus.emit('postSpin', { duringFs: false });
  eq(stops.length, 1);
  eq(stops[0].reason, 'singleWinAbove');
});

t('sandbox: stopOnAnyFeatureTrigger fires after onFsTrigger', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true, interSpinDelayMs: 0,
    stopOnAnyFeatureTrigger: true });
  const stops = [];
  sb.HookBus.on('onAutoplayStop', (p) => stops.push(p));
  sb.window.autoplayStart(10);
  sb.HookBus.emit('onFsTrigger', { award: 10, scatters: 4 });
  /* The stop fires when the next postSpin landing checks pendingStopReason. */
  sb.HookBus.emit('onSpinResult', { duringFs: false });
  sb.HookBus.emit('postSpin', { duringFs: false });
  eq(stops.length, 1);
  eq(stops[0].reason, 'feature');
});

t('sandbox: stopOnAnyFeatureTrigger=false → pauses during FS, resumes on FsEnd', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true, interSpinDelayMs: 0,
    stopOnAnyFeatureTrigger: false });
  const stops = [];
  sb.HookBus.on('onAutoplayStop', (p) => stops.push(p));
  sb.window.autoplayStart(10);
  sb.HookBus.emit('onFsTrigger', { award: 10, scatters: 4 });
  eq(sb.window.AUTOPLAY_STATE.paused, true);
  sb.HookBus.emit('onFsEnd', { totalWin: 200 });
  eq(sb.window.AUTOPLAY_STATE.paused, false);
  eq(stops.length, 0, 'session should continue');
});

t('sandbox: onSlamRequested marks pendingStopReason=slam', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true, interSpinDelayMs: 0 });
  const stops = [];
  sb.HookBus.on('onAutoplayStop', (p) => stops.push(p));
  sb.window.autoplayStart(10);
  sb.HookBus.emit('onSlamRequested', { phase: 'pre', source: 'button' });
  eq(sb.window.AUTOPLAY_STATE.pendingStopReason, 'slam');
  /* Next postSpin observes pending reason and stops. */
  sb.HookBus.emit('onSpinResult', { duringFs: false });
  sb.HookBus.emit('postSpin', { duringFs: false });
  eq(stops.length, 1);
  eq(stops[0].reason, 'slam');
});

t('sandbox: stopOnLossAbove fires when cumulative loss crosses threshold', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true, interSpinDelayMs: 0,
    stopOnLossAbove: 1.5, betUnitFallback: 1 });
  const stops = [];
  sb.HookBus.on('onAutoplayStop', (p) => stops.push(p));
  sb.window.autoplayStart(10);
  sb.window.__WIN_AWARD__ = 0;
  sb.HookBus.emit('onSpinResult', { duringFs: false });
  sb.HookBus.emit('postSpin', { duringFs: false });
  sb.HookBus.emit('onSpinResult', { duringFs: false });
  sb.HookBus.emit('postSpin', { duringFs: false });
  eq(stops.length, 1);
  eq(stops[0].reason, 'lossLimit');
});

t('sandbox: stopOnWinAbove fires when cumulative win crosses threshold', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true, interSpinDelayMs: 0,
    stopOnWinAbove: 100, betUnitFallback: 1 });
  const stops = [];
  sb.HookBus.on('onAutoplayStop', (p) => stops.push(p));
  sb.window.autoplayStart(10);
  sb.window.__WIN_AWARD__ = 120;
  sb.HookBus.emit('onSpinResult', { duringFs: false });
  sb.HookBus.emit('postSpin', { duringFs: false });
  /* singleWinAbove not enabled here, so winLimit catches it next. */
  eq(stops.length, 1);
  eq(stops[0].reason, 'winLimit');
});

t('sandbox: double-start ignored — second call is a no-op', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true });
  const starts = [];
  sb.HookBus.on('onAutoplayStart', (p) => starts.push(p));
  sb.window.autoplayStart(25);
  sb.window.autoplayStart(50);
  eq(starts.length, 1);
  eq(sb.window.AUTOPLAY_STATE.step, 25, 'second start cannot change session step');
});

t('sandbox: autoplayIsActive reflects state', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true });
  eq(sb.window.autoplayIsActive(), false);
  sb.window.autoplayStart(25);
  eq(sb.window.autoplayIsActive(), true);
  sb.window.autoplayStop('manual');
  eq(sb.window.autoplayIsActive(), false);
});

/* ── Hygiene ── */

t('determinism: same config → byte-identical CSS', () => {
  eq(emitAutoplayCSS({ ...defaultConfig(), enabled: true }),
     emitAutoplayCSS({ ...defaultConfig(), enabled: true }));
});

t('vendor-neutral: no vendor strings anywhere', () => {
  const all = emitAutoplayCSS({ ...defaultConfig(), enabled: true }) +
              emitAutoplayMarkup({ ...defaultConfig(), enabled: true }) +
              emitAutoplayRuntime({ ...defaultConfig(), enabled: true });
  for (const banned of ['gates','olympus','reactoonz','megaways','netent','wrath',
                        'sweet bonanza','pragmatic','microgaming']) {
    nct(all.toLowerCase(), banned, 'banned: ' + banned);
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
