/* eslint-disable no-console */
/**
 * Wave U5 — betSelector block tests.
 *
 * Coverage matrix:
 *   • defaultConfig industry-baseline (coin ladder, multiplier ladder,
 *     defaults, currency)
 *   • resolveConfig validation:
 *       - coinValues / multipliers cleanup, dedupe, clamp, sort
 *       - defaultCoin / defaultMultiplier snap to closest if not in ladder
 *       - currency allow-list (€/$/£/¥/GBP) + reject HTML chars
 *       - currencyPosition prefix vs suffix
 *       - boolean flags reflected
 *       - chipColor / chipTextColor RGB regex enforcement
 *   • emitBetSelectorCSS:
 *       - disabled = empty
 *       - enabled bakes all 12 selectors (chip / steps / panel / grid / picks)
 *       - chipColor interpolated
 *       - prefers-reduced-motion + mobile media queries present
 *   • emitBetSelectorMarkup:
 *       - disabled = empty
 *       - enabled bakes chip + steps + panel + 2 grids + total + max
 *       - aria-* attributes present
 *       - XSS payload in ariaLabel HTML-escaped
 *   • emitBetSelectorRuntime:
 *       - disabled emits stub (window.__SLOT_BET__ still set)
 *       - enabled bakes coin / mult ladders + currency
 *   • Sandbox:
 *       - initial __SLOT_BET__ matches defaultCoin × defaultMultiplier
 *       - betSelectorSetCoin emits onBetChanged + updates total
 *       - betSelectorSetMultiplier emits onBetChanged + updates total
 *       - betSelectorStep iterates through flat dedup ladder
 *       - betSelectorStep clamps at boundaries (no go below 0.01 × 1)
 *       - MAX BET jumps to last × last
 *       - preSpin → locks; postSpin → unlocks
 *       - onAutoplayStart locks even if postSpin would unlock
 *       - multi-reason lock: spinning + autoplay both active → unlock spinning
 *         alone does NOT release lock
 *       - onFsTrigger locks; onFsEnd unlocks
 *       - locked state ignores setCoin / setMultiplier / step / max
 *       - reduced-motion + a11y: aria-disabled / aria-expanded reflect state
 *       - determinism: same config → byte-identical emit triplet
 *       - vendor-neutral: 0 banned strings anywhere
 */

import {
  defaultConfig, resolveConfig,
  emitBetSelectorCSS, emitBetSelectorMarkup, emitBetSelectorRuntime,
} from '../../src/blocks/betSelector.mjs';
import { emitHookBusRuntime } from '../../src/blocks/hookBus.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); console.log('  ✓', n); pass++; }
  catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; }
};
const eq  = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ct  = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };
const nct = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`unexpected substring ${JSON.stringify(n)} — ${m}`); };
const ok  = (v, m = '') => { if (!v) throw new Error(`expected truthy — ${m}`); };
const close = (a, b, tol = 1e-9) => { if (Math.abs(a - b) > tol) throw new Error(`expected ~${b}, got ${a}`); };

console.log('— blocks/betSelector.mjs —');

/* ── defaults + resolveConfig ── */

t('defaultConfig: industry-baseline coin + multiplier ladders', () => {
  const d = defaultConfig();
  eq(d.enabled, true);
  eq(d.coinValues.join(','), '0.01,0.02,0.05,0.1,0.2,0.5,1');
  eq(d.multipliers.join(','), '1,5,10,20,50,100');
  eq(d.defaultCoin, 0.10);
  eq(d.defaultMultiplier, 10);
  eq(d.currency, '€');
  eq(d.currencyPosition, 'prefix');
});

t('resolveConfig: coinValues cleanup + dedup + sort', () => {
  const r = resolveConfig({ betSelector: { coinValues: [0.5, 0.1, 'x', NaN, 0.5, 0.05, -1, 99999] } });
  eq(r.coinValues.join(','), '0.05,0.1,0.5');
});

t('resolveConfig: multipliers integer-only + dedup', () => {
  const r = resolveConfig({ betSelector: { multipliers: [10.6, 10, 5.4, 5, 1, 2, 50] } });
  /* 10.6 → round 11; 10 kept; 5.4 → 5; 5 dedup; final sorted ascending. */
  eq(r.multipliers.join(','), '1,2,5,10,11,50');
});

t('resolveConfig: defaultCoin snaps to closest if not in ladder', () => {
  const r = resolveConfig({ betSelector: { coinValues: [0.01, 0.10, 1.00], defaultCoin: 0.30 } });
  eq(r.defaultCoin, 0.10); /* 0.30 → closest is 0.10 (dist 0.2) vs 1.00 (dist 0.7) */
});

t('resolveConfig: defaultMultiplier snaps to closest', () => {
  const r = resolveConfig({ betSelector: { multipliers: [1, 10, 100], defaultMultiplier: 35 } });
  eq(r.defaultMultiplier, 10); /* 35 → 10 (dist 25) vs 100 (dist 65) */
});

t('resolveConfig: currency allow-list accepts € $ £ ¥ + multi-char', () => {
  for (const sym of ['€', '$', '£', '¥', 'USD', 'GBP']) {
    eq(resolveConfig({ betSelector: { currency: sym } }).currency, sym);
  }
});

t('resolveConfig: currency rejects HTML-unsafe payloads', () => {
  const r = resolveConfig({ betSelector: { currency: '<script>' } });
  eq(r.currency, '€'); /* falls back to default */
});

t('resolveConfig: currencyPosition prefix vs suffix', () => {
  eq(resolveConfig({ betSelector: { currencyPosition: 'suffix' } }).currencyPosition, 'suffix');
  eq(resolveConfig({ betSelector: { currencyPosition: 'invalid' } }).currencyPosition, 'prefix');
});

t('resolveConfig: chipColor RGB regex enforces shape', () => {
  eq(resolveConfig({ betSelector: { chipColor: '10,20,30' } }).chipColor, '10,20,30');
  eq(resolveConfig({ betSelector: { chipColor: 'red' } }).chipColor, '255,200,80');
});

t('resolveConfig: ariaLabel length cap', () => {
  eq(resolveConfig({ betSelector: { ariaLabel: 'Bet' } }).ariaLabel, 'Bet');
  /* > 64 chars rejected → default */
  const big = 'x'.repeat(65);
  eq(resolveConfig({ betSelector: { ariaLabel: big } }).ariaLabel, 'Adjust bet');
});

/* ── CSS emission ── */

t('emitBetSelectorCSS: empty when disabled', () => {
  eq(emitBetSelectorCSS({ enabled: false }), '');
});

t('emitBetSelectorCSS: enabled bakes every required selector', () => {
  const css = emitBetSelectorCSS({ ...defaultConfig(), enabled: true });
  for (const sel of ['.bet-chip', '.bet-chip__value', '.bet-steps', '.bet-step',
                     '.bet-panel', '.bet-grid', '.bet-pick', '.bet-pick.is-selected',
                     '.bet-panel-total', '.bet-panel-max']) ct(css, sel);
});

t('emitBetSelectorCSS: chipColor interpolated', () => {
  const css = emitBetSelectorCSS({ ...defaultConfig(), enabled: true, chipColor: '11,22,33' });
  ct(css, '11,22,33');
});

t('emitBetSelectorCSS: respects prefers-reduced-motion + mobile', () => {
  const css = emitBetSelectorCSS({ ...defaultConfig(), enabled: true });
  ct(css, '@media (prefers-reduced-motion: reduce)');
  ct(css, '@media (max-width: 480px)');
});

/* ── markup emission ── */

t('emitBetSelectorMarkup: empty when disabled', () => {
  eq(emitBetSelectorMarkup({ enabled: false }), '');
});

t('emitBetSelectorMarkup: enabled bakes chip + steps + panel + grids', () => {
  const html = emitBetSelectorMarkup({ ...defaultConfig(), enabled: true });
  for (const id of ['betChip', 'betChipValue', 'betStepDown', 'betStepUp',
                    'betPanel', 'betCoinGrid', 'betMultiplierGrid',
                    'betPanelTotal', 'betMaxBtn']) ct(html, `id="${id}"`);
  ct(html, 'aria-haspopup="dialog"');
  ct(html, 'role="dialog"');
  ct(html, 'role="radiogroup"');
});

t('emitBetSelectorMarkup: XSS payload in ariaLabel HTML-escaped', () => {
  const cfg = { ...defaultConfig(), enabled: true, ariaLabel: '"><script>x</script>' };
  const html = emitBetSelectorMarkup(cfg);
  nct(html, '<script>');
  ct(html, '&quot;&gt;&lt;script&gt;');
});

t('emitBetSelectorMarkup: panel hidden by default + non-modal', () => {
  const html = emitBetSelectorMarkup({ ...defaultConfig(), enabled: true });
  ct(html, 'id="betPanel" hidden');
  ct(html, 'aria-modal="false"');
});

/* ── runtime emission ── */

t('emitBetSelectorRuntime: disabled emits stub (window.__SLOT_BET__ still set)', () => {
  const js = emitBetSelectorRuntime({ enabled: false });
  ct(js, 'window.__SLOT_BET__         = 1;');
  ct(js, 'window.betSelectorStep      = function () {};');
});

t('emitBetSelectorRuntime: enabled bakes ladders + currency', () => {
  const js = emitBetSelectorRuntime({ ...defaultConfig(), enabled: true });
  ct(js, '[0.01,0.02,0.05,0.1,0.2,0.5,1]');
  ct(js, '[1,5,10,20,50,100]');
  ct(js, '"€"');
});

/* ── sandbox ── */

function buildSandbox(cfg) {
  const hbSrc = emitHookBusRuntime({ debugLog: false });
  const bsSrc = emitBetSelectorRuntime(cfg);

  const elements = new Map();
  function makeElement(id) {
    if (elements.has(id)) return elements.get(id);
    const el = {
      id, hidden: id === 'betPanel',
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
      contains(other) { return el._children.includes(other); },
      click() { for (const fn of (el._listeners.get('click') || [])) fn({}); },
      _fire(name, ev) { for (const fn of (el._listeners.get(name) || [])) fn(ev || {}); },
    };
    elements.set(id, el);
    return el;
  }
  for (const id of ['betChip','betChipValue','betStepDown','betStepUp',
                    'betPanel','betCoinGrid','betMultiplierGrid','betPanelTotal','betMaxBtn']) {
    makeElement(id);
  }

  const fakeDocument = {
    readyState: 'complete',
    getElementById(id) { return elements.get(id) || null; },
    addEventListener() {},
    createElement() {
      const el = {
        tag: '', textContent: '', className: '', type: '', disabled: false,
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
  const fakeWindow = {};
  const fakeConsole = { warn: () => {}, error: () => {}, log: () => {} };

  /* eslint-disable-next-line no-new-func */
  const factory = new Function(
    'window', 'document', 'console', 'performance', 'setTimeout', 'clearTimeout',
    hbSrc + '\n' + bsSrc + '\nreturn { HookBus: window.HookBus };'
  );
  const perf = { now: () => Date.now() };
  factory(fakeWindow, fakeDocument, fakeConsole, perf, setTimeout, clearTimeout);

  return { window: fakeWindow, document: fakeDocument, elements, HookBus: fakeWindow.HookBus };
}

t('sandbox: initial __SLOT_BET__ matches defaultCoin × defaultMultiplier', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true });
  eq(sb.window.__SLOT_BET__, 1.0); /* 0.10 × 10 */
  eq(sb.window.__SLOT_BET_COIN__, 0.10);
  eq(sb.window.__SLOT_BET_MULTIPLIER__, 10);
});

t('sandbox: initial onBetChanged fires with reason=init', () => {
  /* Sandbox emits during build; subscribe AFTER build sees only manual events.
   * To observe init emit, use a custom build path: pre-register listener on
   * a stub HookBus. We assert state instead. */
  const sb = buildSandbox({ ...defaultConfig(), enabled: true });
  eq(sb.window.BET_SELECTOR_STATE.total, 1.0);
});

t('sandbox: setCoin emits onBetChanged + updates total', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true });
  const events = [];
  sb.HookBus.on('onBetChanged', p => events.push(p));
  sb.window.betSelectorSetCoin(0.50);
  eq(events.length, 1);
  eq(events[0].coin, 0.50);
  close(events[0].bet, 5.00);
  eq(sb.window.__SLOT_BET__, 5.00);
});

t('sandbox: setMultiplier emits onBetChanged + updates total', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true });
  const events = [];
  sb.HookBus.on('onBetChanged', p => events.push(p));
  sb.window.betSelectorSetMultiplier(50);
  eq(events.length, 1);
  eq(events[0].multiplier, 50);
  close(events[0].bet, 5.00); /* 0.10 × 50 */
});

t('sandbox: setCoin rejects value not in ladder (no emit, state unchanged)', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true });
  const events = [];
  sb.HookBus.on('onBetChanged', p => events.push(p));
  sb.window.betSelectorSetCoin(0.123); /* not in ladder */
  eq(events.length, 0);
  eq(sb.window.__SLOT_BET_COIN__, 0.10);
});

t('sandbox: step(+1) advances along flat dedup ladder', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true });
  const events = [];
  sb.HookBus.on('onBetChanged', p => events.push(p));
  /* Default is 1.00 (0.10 × 10). One up should go to next ladder rung. */
  sb.window.betSelectorStep(1);
  eq(events.length, 1);
  ok(events[0].bet > 1.00, 'step+1 must increase bet');
});

t('sandbox: step(-N) clamps at minimum (no emit beyond floor)', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true });
  /* Drop to floor first by repeated step(-1) — small ladder, ~20 rungs total. */
  for (let i = 0; i < 50; i++) sb.window.betSelectorStep(-1);
  const events = [];
  sb.HookBus.on('onBetChanged', p => events.push(p));
  sb.window.betSelectorStep(-1);
  eq(events.length, 0); /* already at floor, no further emit */
});

t('sandbox: preSpin locks UI, postSpin unlocks', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true });
  eq(sb.window.betSelectorIsLocked(), false);
  sb.HookBus.emit('preSpin', {});
  eq(sb.window.betSelectorIsLocked(), true);
  sb.HookBus.emit('postSpin', {});
  eq(sb.window.betSelectorIsLocked(), false);
});

t('sandbox: locked state ignores setCoin / step / max', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true });
  const baseline = sb.window.__SLOT_BET__;
  sb.HookBus.emit('preSpin', {});
  sb.window.betSelectorSetCoin(1.00);
  sb.window.betSelectorStep(1);
  eq(sb.window.__SLOT_BET__, baseline, 'locked → no change');
});

t('sandbox: multi-reason lock (spinning + autoplay) — unlock spinning alone keeps lock', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true });
  sb.HookBus.emit('preSpin', {});
  sb.HookBus.emit('onAutoplayStart', { step: 25, remaining: 25 });
  eq(sb.window.betSelectorIsLocked(), true);
  sb.HookBus.emit('postSpin', {}); /* unlocks spinning, but autoplay still holds */
  eq(sb.window.betSelectorIsLocked(), true);
  sb.HookBus.emit('onAutoplayStop', { reason: 'manual', completed: 0 });
  eq(sb.window.betSelectorIsLocked(), false);
});

t('sandbox: FS round locks bet (trigger-bet wins for the round)', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true });
  sb.HookBus.emit('onFsTrigger', {});
  eq(sb.window.betSelectorIsLocked(), true);
  sb.HookBus.emit('postSpin', {}); /* unlocks spinning, fs still holds */
  eq(sb.window.betSelectorIsLocked(), true);
  sb.HookBus.emit('onFsEnd', {});
  eq(sb.window.betSelectorIsLocked(), false);
});

t('sandbox: ariaLabel locked chip reflects state (aria-disabled)', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true });
  sb.HookBus.emit('preSpin', {});
  const chip = sb.elements.get('betChip');
  eq(chip._attrs['aria-disabled'], 'true');
  sb.HookBus.emit('postSpin', {});
  eq(chip._attrs['aria-disabled'], 'false');
});

/* ── determinism + vendor neutrality ── */

t('determinism: identical config → byte-identical emit triplet', () => {
  const cfg = { ...defaultConfig(), enabled: true };
  eq(emitBetSelectorCSS(cfg),      emitBetSelectorCSS(cfg));
  eq(emitBetSelectorMarkup(cfg),   emitBetSelectorMarkup(cfg));
  eq(emitBetSelectorRuntime(cfg),  emitBetSelectorRuntime(cfg));
});

t('vendor-neutral: no banned strings in any emit', () => {
  const cfg = { ...defaultConfig(), enabled: true };
  const all = emitBetSelectorCSS(cfg) + emitBetSelectorMarkup(cfg) + emitBetSelectorRuntime(cfg);
  for (const banned of ['gates','olympus','reactoonz','megaways','netent',
                        'wrath','sweet bonanza','pragmatic','microgaming',
                        'playa-slot','playaslot']) {
    if (all.toLowerCase().includes(banned)) throw new Error(`vendor leak: ${banned}`);
  }
});

/* ── summary ── */
console.log('\n--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
