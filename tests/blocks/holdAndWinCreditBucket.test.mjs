/**
 * tests/blocks/holdAndWinCreditBucket.test.mjs — Wave H14
 *
 * Exercises: defaultConfig integrity, resolveConfig validators (positive +
 * malformed input), CSS / markup / runtime emit shape, vendor neutrality,
 * determinism, and runtime sandbox happy-path (mock HW_STATE, mock DOM).
 */
import {
  defaultConfig, resolveConfig,
  emitHoldAndWinCreditBucketCSS,
  emitHoldAndWinCreditBucketMarkup,
  emitHoldAndWinCreditBucketRuntime,
} from '../../src/blocks/holdAndWinCreditBucket.mjs';

let pass = 0, fail = 0;
function t(name, ok, hint) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (hint ? '  — ' + hint : '')); }
}

console.log('\n— blocks/holdAndWinCreditBucket.mjs —');

/* ───────────────────── defaultConfig integrity ─────────────────────── */
const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('prizeMap is 7-tier industry baseline', Array.isArray(d.prizeMap) && d.prizeMap.length === 7);
t('prizeMap entries have {x,weight}', d.prizeMap.every(e => Number.isFinite(e.x) && Number.isFinite(e.weight)));
t('jackpotMap defaults to MINI/MINOR/MAJOR/GRAND', d.jackpotMap.map(j => j.label).join(',') === 'MINI,MINOR,MAJOR,GRAND');
t('jackpotMap weights skew low (GRAND ≤ MAJOR ≤ MINOR ≤ MINI)',
  d.jackpotMap[3].weight <= d.jackpotMap[2].weight &&
  d.jackpotMap[2].weight <= d.jackpotMap[1].weight &&
  d.jackpotMap[1].weight <= d.jackpotMap[0].weight);
t('allLockedAward defaults to GRAND', d.allLockedAward === 'GRAND');
t('bucketColor is valid rgb triplet', /^\d{1,3},\d{1,3},\d{1,3}$/.test(d.bucketColor));
t('jackpotColor is valid rgb triplet', /^\d{1,3},\d{1,3},\d{1,3}$/.test(d.jackpotColor));
t('currencyPrefix default ×', d.currencyPrefix === '×');
t('hudShowsTotal default true', d.hudShowsTotal === true);

/* defaultConfig() returns a FRESH copy — mutating must not affect defaults */
defaultConfig().prizeMap.push({ x: 999, weight: 1 });
t('defaultConfig returns independent copy each call', defaultConfig().prizeMap.length === 7);

/* ───────────────────── resolveConfig — happy paths ────────────────── */
const r1 = resolveConfig({ holdAndWinCreditBucket: { enabled: true } });
t('explicit enabled flag honored', r1.enabled === true);

const r2 = resolveConfig({ features: [{ kind: 'hold_and_win_credit_bucket' }] });
t('auto-enable via feature kind (snake_case)', r2.enabled === true);

const r3 = resolveConfig({ features: [{ kind: 'credit-bucket' }] });
t('auto-enable via feature kind (dash variant)', r3.enabled === true);

const r4 = resolveConfig({
  holdAndWinCreditBucket: {
    enabled: true,
    prizeMap: [{ x: 1, weight: 50 }, { x: 5, weight: 10 }],
    jackpotMap: [{ label: 'SMALL', x: 10, weight: 5 }, { label: 'BIG', x: 100, weight: 1 }],
    allLockedAward: 'BIG',
    bucketColor: '100,200,50',
    jackpotColor: '50,50,200',
    currencyPrefix: '€',
    hudShowsTotal: false,
  },
});
t('prizeMap override accepted', r4.prizeMap.length === 2 && r4.prizeMap[1].x === 5);
t('jackpotMap override accepted', r4.jackpotMap[0].label === 'SMALL');
t('allLockedAward override accepted', r4.allLockedAward === 'BIG');
t('bucketColor override accepted', r4.bucketColor === '100,200,50');
t('currencyPrefix override accepted', r4.currencyPrefix === '€');
t('hudShowsTotal=false honored', r4.hudShowsTotal === false);

/* ───────────────────── resolveConfig — malformed input ────────────── */
const m1 = resolveConfig({ holdAndWinCreditBucket: { enabled: true, prizeMap: 'not-array' } });
t('non-array prizeMap rejected → defaults retained', m1.prizeMap.length === 7);

const m2 = resolveConfig({ holdAndWinCreditBucket: { enabled: true, prizeMap: [{ x: -5, weight: 1 }] } });
t('negative-x prizeMap rejected → defaults retained', m2.prizeMap.length === 7);

const m3 = resolveConfig({ holdAndWinCreditBucket: { enabled: true, prizeMap: [{ x: 1, weight: 0 }] } });
t('zero-weight prizeMap rejected → defaults retained', m3.prizeMap.length === 7);

const m4 = resolveConfig({ holdAndWinCreditBucket: { enabled: true, jackpotMap: [] } });
t('empty jackpotMap rejected → defaults retained', m4.jackpotMap.length === 4);

const m5 = resolveConfig({
  holdAndWinCreditBucket: {
    enabled: true,
    jackpotMap: [{ label: 'A', x: 5, weight: 1 }, { label: 'A', x: 10, weight: 1 }],
  },
});
t('duplicate-label jackpotMap rejected → defaults retained', m5.jackpotMap.length === 4);

const m6 = resolveConfig({ holdAndWinCreditBucket: { enabled: true, bucketColor: 'not-rgb' } });
t('malformed bucketColor rejected → default retained', m6.bucketColor === '255,215,80');

const m7 = resolveConfig({
  holdAndWinCreditBucket: { enabled: true, allLockedAward: 'NONEXISTENT_TIER' },
});
/* When allLockedAward doesn't exist in the (default) jackpotMap, fall back
 * to the highest-x tier in that map — defaults' GRAND at 1000×. */
t('non-matching allLockedAward falls back to highest-x tier', m7.allLockedAward === 'GRAND');

const m8 = resolveConfig({
  holdAndWinCreditBucket: {
    enabled: true,
    jackpotMap: [{ label: 'ALPHA', x: 50, weight: 2 }, { label: 'OMEGA', x: 500, weight: 1 }],
    /* allLockedAward not provided — default 'GRAND' doesn't exist → fallback */
  },
});
t('default allLockedAward fallback works when GDD-overridden jackpotMap excludes GRAND', m8.allLockedAward === 'OMEGA');

/* ───────────────────── emit shape — disabled / enabled ─────────────── */
t('CSS empty when disabled', emitHoldAndWinCreditBucketCSS(defaultConfig()) === '');
t('Markup empty when disabled', emitHoldAndWinCreditBucketMarkup(defaultConfig()) === '');
t('Runtime emits stubs when disabled',
  emitHoldAndWinCreditBucketRuntime(defaultConfig()).includes('window.__HW_CREDIT_TOTAL__   = 0'));

const css = emitHoldAndWinCreditBucketCSS(r1);
t('CSS includes .hw-credit-chip selector', css.includes('.hw-credit-chip'));
t('CSS includes data-kind="credit" + data-kind="jackpot"',
  css.includes('data-kind="credit"') && css.includes('data-kind="jackpot"'));
t('CSS bucketColor interpolated', css.includes('255,215,80'));
t('CSS jackpotColor interpolated', css.includes('255,80,80'));
t('CSS includes prefers-reduced-motion guard', css.includes('prefers-reduced-motion'));

t('Markup empty (chips render dynamically)', emitHoldAndWinCreditBucketMarkup(r1) === '');

const rt = emitHoldAndWinCreditBucketRuntime(r1);
t('Runtime exposes HW_CREDIT_STATE', rt.includes('window.HW_CREDIT_STATE'));
t('Runtime exposes hwCreditReset', rt.includes('window.hwCreditReset'));
t('Runtime registers postSpin listener', rt.includes("HookBus.on('postSpin'"));
t('Runtime registers onSpinResult listener', rt.includes("HookBus.on('onSpinResult'"));
t('Runtime registers onFsTrigger / onFsEnd listeners',
  rt.includes("HookBus.on('onFsTrigger'") && rt.includes("HookBus.on('onFsEnd'"));
t('Runtime emits onCreditBucketRespinStart', rt.includes("'onCreditBucketRespinStart'"));
t('Runtime emits onCreditBucketLocked', rt.includes("'onCreditBucketLocked'"));
t('Runtime emits onCreditBucketEnd', rt.includes("'onCreditBucketEnd'"));
t('Runtime guards against missing HW_STATE', rt.includes('holdAndWin not enabled'));
t('Runtime bakes prizeMap as JSON literal', rt.includes('"x":1') && rt.includes('"weight":32'));
t('Runtime bakes jackpotMap as JSON literal', rt.includes('"MINI"') && rt.includes('"GRAND"'));

/* ───────────────────── determinism — pure emitters ─────────────────── */
const css2 = emitHoldAndWinCreditBucketCSS(r1);
t('determinism: identical config → byte-identical CSS', css === css2);
const rt2 = emitHoldAndWinCreditBucketRuntime(r1);
t('determinism: identical config → byte-identical runtime', rt === rt2);

/* ───────────────────── vendor neutrality ──────────────────────────── */
const VENDOR_RX = /(igt|pragmatic|cash[- ]eruption|wolf[- ]run|cleopatra|buffalo|megaways|netent|microgaming|playtech|scientific games|aristocrat|konami|l&w|light\s*&\s*wonder)/i;
const allEmit = css + emitHoldAndWinCreditBucketMarkup(r1) + rt;
t('vendor-neutral: no vendor / franchise strings in any emit',
  !VENDOR_RX.test(allEmit));

/* ───────────────────── runtime smoke test in sandbox ───────────────── */
/* Minimal DOM + HookBus + HW_STATE shim so we can prove the diff cycle
 * actually fires the expected events. Inline pure-JS sandbox — no JSDOM
 * dependency, just enough surface area for what the runtime touches. */
function makeSandbox() {
  function makeEl(tag) {
    const el = {
      tagName: tag, children: [], style: {}, className: '',
      _attrs: {}, textContent: '', innerHTML: '', parentNode: null,
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      removeChild(c) { this.children = this.children.filter(x => x !== c); c.parentNode = null; return c; },
      setAttribute(k, v) { this._attrs[k] = String(v); },
      getAttribute(k) { return this._attrs[k] != null ? this._attrs[k] : null; },
      querySelector(sel) {
        if (sel === '.hw-credit-chip') {
          return this.children.find(c => c.className && c.className.includes('hw-credit-chip')) || null;
        }
        if (sel === '.big-win-tier-amount') return null;
        return null;
      },
      querySelectorAll(sel) {
        if (sel === '.cell')             return this._cells || [];
        if (sel === '.hw-credit-chip')   return this.children.filter(c => c.className && c.className.includes('hw-credit-chip'));
        if (sel === '.hw-has-credit')    return this.children.filter(c => c.classList && c.classList.contains('hw-has-credit'));
        return [];
      },
    };
    /* classList shim — needs to live per-element so the Set is unique. */
    const set = new Set();
    el.classList = {
      add(c)      { set.add(c); el.className = Array.from(set).join(' '); },
      remove(c)   { set.delete(c); el.className = Array.from(set).join(' '); },
      contains(c) { return set.has(c); },
      forEach(fn) { set.forEach(fn); },
    };
    return el;
  }
  const gridHost = makeEl('div'); gridHost._attrs.id = 'gridHost';
  const cells = [];
  for (let i = 0; i < 15; i++) {                /* 5×3 = 15 cells */
    const c = makeEl('div');
    c.className = 'cell';
    cells.push(c);
    gridHost.children.push(c);
  }
  gridHost._cells = cells;

  const hud = makeEl('div'); hud._attrs.id = 'hwHud';
  const total = makeEl('span'); total._attrs.id = 'hwCreditTotalVal';

  const doc = {
    _byId: { gridHost, hwHud: hud, hwCreditTotalVal: total },
    getElementById(id) { return this._byId[id] || null; },
    createElement(tag) { return makeEl(tag); },
  };
  const HookBus = {
    _h: {},
    on(e, fn)  { (this._h[e] = this._h[e] || []).push(fn); },
    emit(e, p) { (this._h[e] || []).forEach(fn => fn(p)); },
  };
  const HW_STATE = { active: false, respinsLeft: 3, lockedCells: new Map() };

  return {
    REELS: 5, ROWS: 3, __SLOT_BET__: 1,
    HookBus, HW_STATE, document: doc,
    requestAnimationFrame: null,
    getComputedStyle: () => ({ position: 'relative' }),
    console: { warn: () => {}, error: () => {} },
  };
}

const sandboxWindow = makeSandbox();
/* Deterministic Math.random — first 4 draws low (always picks first
 * entries in the combined bag, which are credit values). */
const drawSeq = [0.001, 0.001, 0.001, 0.001];
let drawIdx = 0;
/* Proxy real Math but shadow random() with our deterministic sequence so
 * Math.round / Math.floor / Math.min / Math.max all keep working. */
const realMath = Math;
const stubMath = new Proxy(realMath, {
  get(t, k) {
    if (k === 'random') return () => drawSeq[realMath.min(drawIdx++, drawSeq.length - 1)];
    return t[k];
  },
});

const recordedEvents = [];
sandboxWindow.HookBus.on('onCreditBucketRespinStart', p => recordedEvents.push({ e: 'start', p }));
sandboxWindow.HookBus.on('onCreditBucketLocked',      p => recordedEvents.push({ e: 'locked', p }));
sandboxWindow.HookBus.on('onCreditBucketEnd',         p => recordedEvents.push({ e: 'end', p }));

/* Evaluate the emitted runtime in a sandbox where window/document/HookBus
 * resolve to our shim. Math.random is shadowed via the stub. */
const wrap = `
  var window = sandboxWindow;
  var document = window.document;
  var HookBus = window.HookBus;
  var console = window.console;
  var getComputedStyle = window.getComputedStyle;
  var Math = stubMath;
  ${rt}
`;
new Function('sandboxWindow', 'stubMath', wrap)(sandboxWindow, stubMath);

/* Simulate a hold-and-win round:
 *   spin 1: HW round begins, 1 cell locks
 *   spin 2: 1 more cell locks
 *   spin 3: round ends (HW_STATE.active flips false), no new lock */
sandboxWindow.HW_STATE.active = true;
sandboxWindow.HW_STATE.lockedCells.set('0,0', 'BONUS');
sandboxWindow.HookBus.emit('postSpin');

sandboxWindow.HW_STATE.lockedCells.set('1,2', 'BONUS');
sandboxWindow.HookBus.emit('postSpin');

sandboxWindow.HW_STATE.active = false;
sandboxWindow.HookBus.emit('postSpin');

t('sandbox: onCreditBucketRespinStart fired exactly once',
  recordedEvents.filter(e => e.e === 'start').length === 1);
t('sandbox: onCreditBucketLocked fired for every new lock',
  recordedEvents.filter(e => e.e === 'locked').length === 2);
t('sandbox: onCreditBucketEnd fired exactly once',
  recordedEvents.filter(e => e.e === 'end').length === 1);
t('sandbox: end event reports cellCount=2',
  recordedEvents.find(e => e.e === 'end').p.cellCount === 2);
t('sandbox: __HW_CREDIT_TOTAL__ matches sum of locked values',
  sandboxWindow.__HW_CREDIT_TOTAL__ === recordedEvents.find(e => e.e === 'end').p.total);
t('sandbox: __WIN_AWARD__ pushed for downstream presentation',
  Number.isFinite(sandboxWindow.__WIN_AWARD__) && sandboxWindow.__WIN_AWARD__ > 0);
t('sandbox: hwCreditReset clears values + total',
  (function () {
    sandboxWindow.hwCreditReset();
    return sandboxWindow.__HW_CREDIT_TOTAL__ === 0 && sandboxWindow.HW_CREDIT_STATE.values.size === 0;
  })());

console.log('\n--- summary ---');
console.log('  pass:', pass);
console.log('  fail:', fail);
if (fail > 0) process.exit(1);
