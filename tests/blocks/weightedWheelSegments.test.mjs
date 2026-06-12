/**
 * tests/blocks/weightedWheelSegments.test.mjs — Wave H15
 *
 * Exercises: defaultConfig integrity, resolveConfig validators (incl.
 * the hard requirement that wheelBonus must be enabled), CSS / markup /
 * runtime emit shape, vendor neutrality, determinism, and sandbox
 * smoke test that proves the weighted draw + jackpot emit path works.
 */
import {
  defaultConfig, resolveConfig,
  emitWeightedWheelSegmentsCSS,
  emitWeightedWheelSegmentsMarkup,
  emitWeightedWheelSegmentsRuntime,
} from '../../src/blocks/weightedWheelSegments.mjs';

let pass = 0, fail = 0;
function t(name, ok, hint) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (hint ? '  — ' + hint : '')); }
}

console.log('\n— blocks/weightedWheelSegments.mjs —');

/* ────────────────── defaultConfig integrity ───────────────────── */
const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('weights null by default (uniform fallback)', d.weights === null);
t('jackpotMap defaults to MINI/MINOR/MAJOR/GRAND',
  d.jackpotMap.map(j => j.label).join(',') === 'MINI,MINOR,MAJOR,GRAND');
t('jackpotMap x ascending (MINI < MINOR < MAJOR < GRAND)',
  d.jackpotMap[0].x < d.jackpotMap[1].x &&
  d.jackpotMap[1].x < d.jackpotMap[2].x &&
  d.jackpotMap[2].x < d.jackpotMap[3].x);
t('defaultTierColor valid rgb triplet', /^\d{1,3},\d{1,3},\d{1,3}$/.test(d.defaultTierColor));
t('allowFallbackToValue default true', d.allowFallbackToValue === true);

/* defaultConfig() returns a FRESH copy */
defaultConfig().jackpotMap.push({ label: 'EXTRA', x: 9999 });
t('defaultConfig returns independent copy each call', defaultConfig().jackpotMap.length === 4);

/* ────────────────── resolveConfig — happy paths ──────────────── */
/* Hard requirement: wheelBonus must be enabled for this extension. */
const baseModel = {
  wheelBonus: { enabled: true, segments: [
    { label: '×2',  value: 2 },
    { label: '×5',  value: 5 },
    { label: '×10', value: 10 },
    { label: '×25', value: 25 },
    { label: '×100', value: 100, jackpotTier: 'MINI' },
    { label: 'GRAND', value: 0,  jackpotTier: 'GRAND' },
  ]},
};

const r1 = resolveConfig({ ...baseModel, weightedWheelSegments: { enabled: true } });
t('explicit enabled honored when wheelBonus is on', r1.enabled === true);

const r2 = resolveConfig({ ...baseModel, features: [{ kind: 'weighted_wheel_segments' }] });
t('auto-enable via feature kind (snake_case)', r2.enabled === true);

const r3 = resolveConfig({ ...baseModel, features: [{ kind: 'weighted-wheel' }] });
t('auto-enable via feature kind (dash short variant)', r3.enabled === true);

/* The hard requirement — must DISABLE when wheelBonus is off */
const offCase = resolveConfig({ weightedWheelSegments: { enabled: true } });   // no wheelBonus
t('hard requirement: force disabled when wheelBonus is off',
  offCase.enabled === false);

const offCase2 = resolveConfig({
  features: [{ kind: 'weighted_wheel_segments' }],   // feature kind but no wheelBonus
});
t('hard requirement: feature-kind auto-enable still forced off when wheelBonus missing',
  offCase2.enabled === false);

/* weights validator — must match segments.length */
const r4 = resolveConfig({
  ...baseModel,
  weightedWheelSegments: {
    enabled: true,
    weights: [30, 25, 18, 12, 8, 0.5],   /* matches 6 segments */
  },
});
t('valid weights array accepted', Array.isArray(r4.weights) && r4.weights.length === 6);
t('weights value preserved (30 first)', r4.weights[0] === 30);

const m1 = resolveConfig({
  ...baseModel,
  weightedWheelSegments: { enabled: true, weights: [1, 2] },   /* wrong length */
});
t('weights length mismatch → null fallback (uniform)', m1.weights === null);

const m2 = resolveConfig({
  ...baseModel,
  weightedWheelSegments: { enabled: true, weights: [1, 2, -3, 4, 5, 6] },
});
t('negative weight → null fallback', m2.weights === null);

const m3 = resolveConfig({
  ...baseModel,
  weightedWheelSegments: { enabled: true, weights: [1, 2, 0, 4, 5, 6] },
});
t('zero weight → null fallback', m3.weights === null);

/* jackpotMap validator */
const r5 = resolveConfig({
  ...baseModel,
  weightedWheelSegments: {
    enabled: true,
    jackpotMap: [{ label: 'SMALL', x: 10 }, { label: 'BIG', x: 500 }],
  },
});
t('jackpotMap override accepted', r5.jackpotMap.length === 2 && r5.jackpotMap[0].label === 'SMALL');

const m4 = resolveConfig({
  ...baseModel,
  weightedWheelSegments: { enabled: true, jackpotMap: [] },
});
t('empty jackpotMap → defaults retained', m4.jackpotMap.length === 4);

const m5 = resolveConfig({
  ...baseModel,
  weightedWheelSegments: {
    enabled: true,
    jackpotMap: [{ label: 'A', x: 5 }, { label: 'A', x: 10 }],
  },
});
t('duplicate-label jackpotMap → defaults retained', m5.jackpotMap.length === 4);

const m6 = resolveConfig({
  ...baseModel,
  weightedWheelSegments: { enabled: true, defaultTierColor: 'bogus' },
});
t('malformed defaultTierColor → default retained', m6.defaultTierColor === '255,80,80');

/* ────────────────── emit shape — disabled / enabled ─────────── */
t('CSS empty when disabled', emitWeightedWheelSegmentsCSS(defaultConfig()) === '');
t('Markup empty when disabled', emitWeightedWheelSegmentsMarkup(defaultConfig()) === '');
t('Runtime emits stubs when disabled',
  emitWeightedWheelSegmentsRuntime(defaultConfig()).includes('window.WWS_STATE = { enabled: false'));

const css = emitWeightedWheelSegmentsCSS(r1);
t('CSS includes .wb-seg[data-tier]', css.includes('.wb-seg[data-tier]'));
t('CSS bakes defaultTierColor', css.includes('255,80,80'));
t('CSS guards prefers-reduced-motion', css.includes('prefers-reduced-motion'));

t('Markup empty when enabled (block paints existing DOM)',
  emitWeightedWheelSegmentsMarkup(r1) === '');

const rt = emitWeightedWheelSegmentsRuntime(r1, baseModel.wheelBonus);
t('Runtime exposes WWS_STATE', rt.includes('window.WWS_STATE'));
t('Runtime exposes wwsDraw helper', rt.includes('window.wwsDraw'));
t('Runtime bakes jackpotMap as JSON literal',
  rt.includes('"MINI"') && rt.includes('"GRAND"'));
t('Runtime registers DOMContentLoaded patch hook',
  rt.includes("addEventListener('DOMContentLoaded'"));
t('Runtime registers onFsTrigger / onFsEnd resets',
  rt.includes("HookBus.on('onFsTrigger'") && rt.includes("HookBus.on('onFsEnd'"));
t('Runtime emits onWheelSegmentChosen', rt.includes("'onWheelSegmentChosen'"));
t('Runtime emits onWheelJackpotHit', rt.includes("'onWheelJackpotHit'"));
t('Runtime emits onWheelAwardCollected', rt.includes("'onWheelAwardCollected'"));
t('Runtime guards against missing wbSpin', rt.includes('wheelBonus not active'));
t('Runtime preserves original wbSpin as __origWbSpin', rt.includes('window.__origWbSpin'));

/* ────────────────── determinism ────────────────────────────── */
const css2 = emitWeightedWheelSegmentsCSS(r1);
t('determinism: identical config → byte-identical CSS', css === css2);
const rt2 = emitWeightedWheelSegmentsRuntime(r1, baseModel.wheelBonus);
t('determinism: identical config → byte-identical runtime', rt === rt2);

/* ────────────────── vendor neutrality ─────────────────────── */
const VENDOR_RX = /(igt|pragmatic|cash[- ]eruption|wolf[- ]run|cleopatra|buffalo|megaways|netent|microgaming|playtech|scientific games|aristocrat|konami|light\s*&\s*wonder)/i;
const allEmit = css + emitWeightedWheelSegmentsMarkup(r1) + rt;
t('vendor-neutral: no vendor / franchise strings in any emit', !VENDOR_RX.test(allEmit));

/* ────────────────── runtime sandbox smoke test ───────────── */
/* Build minimal DOM + window so we can prove the monkey-patch fires,
 * a weighted draw resolves, and onWheelSegmentChosen + onWheelJackpotHit
 * fire as expected. */
function makeSandbox() {
  function makeEl(tag) {
    const set = new Set();
    const el = {
      tagName: tag, children: [], style: {}, className: '',
      _attrs: {}, textContent: '', parentNode: null,
      disabled: false,
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      setAttribute(k, v) { this._attrs[k] = String(v); },
      getAttribute(k) { return this._attrs[k] != null ? this._attrs[k] : null; },
      removeAttribute(k) { delete this._attrs[k]; },
      querySelectorAll(sel) {
        if (sel === '#wbWheel .wb-seg') return this._segs || [];
        return [];
      },
    };
    el.classList = {
      add(c) { set.add(c); }, remove(c) { set.delete(c); }, contains(c) { return set.has(c); },
    };
    // EventListener stubs — runtime calls add/remove/dispatch on the
    // spin button to wire its click handler. Fable's re-arm refactor
    // clears then re-binds on re-trigger, which previously blew up
    // ("removeEventListener is not a function") in this sandbox.
    const listeners = new Map();
    el.addEventListener = (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    };
    el.removeEventListener = (type, fn) => {
      const s = listeners.get(type);
      if (s) s.delete(fn);
    };
    el.dispatchEvent = (ev) => {
      const s = listeners.get(ev && ev.type);
      if (s) for (const fn of s) try { fn(ev); } catch (_e) { /* swallow */ }
      return true;
    };
    return el;
  }

  const wheel = makeEl('div'); wheel._attrs.id = 'wbWheel';
  const segs = [];
  for (let i = 0; i < 6; i++) {
    const s = makeEl('div'); s.className = 'wb-seg'; segs.push(s);
  }
  wheel._segs = segs;

  const overlay = makeEl('div'); overlay._attrs.id = 'wbOverlay';
  const result  = makeEl('div'); result._attrs.id = 'wbResult';
  const spinBtn = makeEl('button'); spinBtn._attrs.id = 'wbSpin';
  const closeBtn = makeEl('button'); closeBtn._attrs.id = 'wbClose';

  const doc = {
    _byId: {
      wbWheel: wheel, wbOverlay: overlay, wbResult: result,
      wbSpin: spinBtn, wbClose: closeBtn,
    },
    readyState: 'complete',
    addEventListener() {},
    getElementById(id) { return this._byId[id] || null; },
    querySelectorAll(sel) { return wheel.querySelectorAll(sel); },
  };

  const HookBus = {
    _h: {}, on(e, fn) { (this._h[e] = this._h[e] || []).push(fn); },
    emit(e, p) { (this._h[e] || []).forEach(fn => fn(p)); },
  };

  /* Provide a minimal wheelBonus runtime surface. */
  const WB_STATE = { active: true, spinning: false, result: null };
  const WB_SEGMENTS = baseModel.wheelBonus.segments;

  return {
    REELS: 5, ROWS: 3, __SLOT_BET__: 2,
    HookBus, document: doc,
    WB_STATE, WB_SEGMENTS, WB_DUR: 50,
    wbSpin: function () { /* dummy original */ },
    wbClose: function () { /* dummy original */ },
    console: { warn: () => {}, error: () => {} },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
  };
}

const sandboxWindow = makeSandbox();
/* Deterministic Math.random: first call → 0.99 (last segment = GRAND tier) */
const drawSeq = [0.99];
let drawIdx = 0;
const realMath = Math;
const stubMath = new Proxy(realMath, {
  get(t, k) {
    if (k === 'random') return () => drawSeq[realMath.min(drawIdx++, drawSeq.length - 1)];
    return t[k];
  },
});

const recordedEvents = [];
sandboxWindow.HookBus.on('onWheelSegmentChosen',  p => recordedEvents.push({ e: 'chosen', p }));
sandboxWindow.HookBus.on('onWheelJackpotHit',     p => recordedEvents.push({ e: 'jackpot', p }));
sandboxWindow.HookBus.on('onWheelAwardCollected', p => recordedEvents.push({ e: 'collected', p }));

const wrap = `
  var window = sandboxWindow;
  var document = window.document;
  var HookBus = window.HookBus;
  var console = window.console;
  var setTimeout = window.setTimeout;
  var clearTimeout = window.clearTimeout;
  var Math = stubMath;
  ${rt}
`;
new Function('sandboxWindow', 'stubMath', wrap)(sandboxWindow, stubMath);

t('sandbox: WWS_STATE.patched === true after DOMContentLoaded resolved',
  sandboxWindow.WWS_STATE.patched === true);
t('sandbox: __origWbSpin preserved', typeof sandboxWindow.__origWbSpin === 'function');
t('sandbox: window.wbSpin replaced with patched fn',
  sandboxWindow.wbSpin !== sandboxWindow.__origWbSpin);

/* Fire the patched wbSpin */
sandboxWindow.wbSpin();
/* Animation completes after WB_DUR + 80 = 130 ms */
await new Promise(r => setTimeout(r, 200));

const chosen = recordedEvents.filter(e => e.e === 'chosen');
const jackpot = recordedEvents.filter(e => e.e === 'jackpot');

t('sandbox: onWheelSegmentChosen fired exactly once', chosen.length === 1);
t('sandbox: chosen index is last segment (0.99 → idx 5 = GRAND)',
  chosen[0] && chosen[0].p.index === 5);
t('sandbox: chosen jackpotTier === GRAND', chosen[0] && chosen[0].p.jackpotTier === 'GRAND');
t('sandbox: chosen jackpotX === 1000', chosen[0] && chosen[0].p.jackpotX === 1000);
t('sandbox: onWheelJackpotHit fired exactly once', jackpot.length === 1);
t('sandbox: jackpotHit tier === GRAND', jackpot[0] && jackpot[0].p.tier === 'GRAND');

/* Fire patched wbClose → resolves award */
sandboxWindow.wbClose();
const collected = recordedEvents.filter(e => e.e === 'collected');
t('sandbox: onWheelAwardCollected fired exactly once', collected.length === 1);
t('sandbox: collected.isJackpot === true', collected[0] && collected[0].p.isJackpot === true);
t('sandbox: collected award === 1000', collected[0] && collected[0].p.award === 1000);
t('sandbox: __WIN_AWARD__ pushed = 1000 × bet (2) = 2000',
  sandboxWindow.__WIN_AWARD__ === 2000);
t('sandbox: WWS_STATE.lastResult cleared after collect',
  sandboxWindow.WWS_STATE.lastResult === null);

console.log('\n--- summary ---');
console.log('  pass:', pass);
console.log('  fail:', fail);
if (fail > 0) process.exit(1);
