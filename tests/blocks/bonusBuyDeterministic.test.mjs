/**
 * tests/blocks/bonusBuyDeterministic.test.mjs — Wave H11
 *
 * Exercises: defaultConfig integrity, resolveConfig validators (incl.
 * hard requirement that bonusBuy must be enabled), CSS/markup/runtime
 * emit shape, vendor neutrality, determinism, and inline sandbox smoke
 * test that proves the picker → select → plant flow fires the expected
 * events end-to-end.
 */
import {
  defaultConfig, resolveConfig,
  emitBonusBuyDeterministicCSS,
  emitBonusBuyDeterministicMarkup,
  emitBonusBuyDeterministicRuntime,
} from '../../src/blocks/bonusBuyDeterministic.mjs';

let pass = 0, fail = 0;
function t(name, ok, hint) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (hint ? '  — ' + hint : '')); }
}

console.log('\n— blocks/bonusBuyDeterministic.mjs —');

/* ────────────────── defaultConfig integrity ───────────────── */
const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default plants = 3-tier ladder (STANDARD/PREMIUM/SUPER)',
  d.plants.map(p => p.tier).join(',') === 'STANDARD,PREMIUM,SUPER');
t('default plants costs strictly ascending',
  d.plants[0].costX < d.plants[1].costX && d.plants[1].costX < d.plants[2].costX);
t('SUPER tier carries 2× starting multiplier',
  d.plants[2].extraMult === 2);
t('every plant has positions array',
  d.plants.every(p => Array.isArray(p.positions) && p.positions.length > 0));
t('every plant position is [r,c] int pair',
  d.plants.every(p => p.positions.every(pos =>
    Array.isArray(pos) && pos.length === 2 && Number.isInteger(pos[0]) && Number.isInteger(pos[1]))));
t('symbolDefault = S', d.symbolDefault === 'S');
t('pickerTitle non-empty', d.pickerTitle && d.pickerTitle.length > 0);
t('pickerColor valid rgb triplet', /^\d{1,3},\d{1,3},\d{1,3}$/.test(d.pickerColor));
t('closeOnBackdrop default true', d.closeOnBackdrop === true);

/* defaultConfig() must return a fresh deep copy */
defaultConfig().plants.push({ tier: 'EXTRA', costX: 999, positions: [[0,0]] });
t('defaultConfig returns independent copy each call', defaultConfig().plants.length === 3);

/* ────────────────── resolveConfig — hard requirement ─────── */
const offCase = resolveConfig({ bonusBuyDeterministic: { enabled: true } });
t('hard requirement: force-disabled when bonusBuy off', offCase.enabled === false);

const offCase2 = resolveConfig({ features: [{ kind: 'deterministic_plant' }] });
t('feature-kind auto-enable still gated on bonusBuy presence',
  offCase2.enabled === false);

/* ────────────────── resolveConfig — happy paths ──────────── */
const baseModel = { bonusBuy: { enabled: true } };

const r1 = resolveConfig({ ...baseModel, bonusBuyDeterministic: { enabled: true } });
t('explicit enabled honored when bonusBuy is on', r1.enabled === true);

const r2 = resolveConfig({ ...baseModel, features: [{ kind: 'bonus_buy_deterministic' }] });
t('auto-enable via feature kind (snake_case)', r2.enabled === true);

const r3 = resolveConfig({ ...baseModel, features: [{ kind: 'deterministic-plant' }] });
t('auto-enable via feature kind (dash variant)', r3.enabled === true);

const r4 = resolveConfig({
  ...baseModel,
  bonusBuyDeterministic: {
    enabled: true,
    plants: [
      { tier: 'BASIC', costX: 50, positions: [[0,0],[1,0]], symbol: 'X' },
      { tier: 'MAX',   costX: 500, positions: [[0,0],[4,2]], symbol: 'X', extraMult: 5 },
    ],
    symbolDefault: 'Z',
    pickerTitle: 'BUY YOUR TIER',
    pickerColor: '100,200,255',
    closeOnBackdrop: false,
  },
});
t('plants override accepted (BASIC + MAX)',
  r4.plants.length === 2 && r4.plants[0].tier === 'BASIC' && r4.plants[1].extraMult === 5);
t('symbolDefault override accepted', r4.symbolDefault === 'Z');
t('pickerTitle override accepted', r4.pickerTitle === 'BUY YOUR TIER');
t('pickerColor override accepted', r4.pickerColor === '100,200,255');
t('closeOnBackdrop=false honored', r4.closeOnBackdrop === false);

/* ────────────────── resolveConfig — malformed input ──────── */
const m1 = resolveConfig({ ...baseModel, bonusBuyDeterministic: { enabled: true, plants: 'not-array' } });
t('non-array plants rejected → defaults retained', m1.plants.length === 3);

const m2 = resolveConfig({
  ...baseModel,
  bonusBuyDeterministic: {
    enabled: true,
    plants: [{ tier: 'A', costX: 50, positions: [[0,0],[0,0]] }],   /* duplicate position */
  },
});
t('duplicate positions in plant → defaults retained', m2.plants.length === 3);

const m3 = resolveConfig({
  ...baseModel,
  bonusBuyDeterministic: {
    enabled: true,
    plants: [{ tier: 'A', costX: -5, positions: [[0,0]] }],          /* negative cost */
  },
});
t('negative-cost plant → defaults retained', m3.plants.length === 3);

const m4 = resolveConfig({
  ...baseModel,
  bonusBuyDeterministic: {
    enabled: true,
    plants: [
      { tier: 'A', costX: 50, positions: [[0,0]] },
      { tier: 'A', costX: 100, positions: [[1,1]] },                 /* duplicate tier */
    ],
  },
});
t('duplicate tier labels → defaults retained', m4.plants.length === 3);

const m5 = resolveConfig({
  ...baseModel,
  bonusBuyDeterministic: { enabled: true, pickerColor: 'bogus' },
});
t('malformed pickerColor → default retained', m5.pickerColor === '255,170,80');

/* ────────────────── emit shape — disabled / enabled ─────── */
t('CSS empty when disabled', emitBonusBuyDeterministicCSS(defaultConfig()) === '');
t('Markup empty when disabled', emitBonusBuyDeterministicMarkup(defaultConfig()) === '');
t('Runtime emits stubs when disabled',
  emitBonusBuyDeterministicRuntime(defaultConfig()).includes('window.__BB_PLANT__       = null'));

const css = emitBonusBuyDeterministicCSS(r1);
t('CSS includes .bbd-overlay', css.includes('.bbd-overlay'));
t('CSS includes .bbd-tier-card', css.includes('.bbd-tier-card'));
t('CSS bakes pickerColor', css.includes('255,170,80'));
t('CSS guards prefers-reduced-motion', css.includes('prefers-reduced-motion'));

const mk = emitBonusBuyDeterministicMarkup(r1);
t('Markup includes #bbdOverlay', mk.includes('id="bbdOverlay"'));
t('Markup includes #bbdCancel', mk.includes('id="bbdCancel"'));
t('Markup includes role="dialog" + aria-modal="true"',
  mk.includes('role="dialog"') && mk.includes('aria-modal="true"'));
t('Markup includes 3 tier cards (default plants)',
  (mk.match(/data-tier-index="/g) || []).length === 3);
t('Markup includes data-modal="true" for spinControl modal guards',
  mk.includes('data-modal="true"'));
t('Markup XSS: pickerTitle escaped',
  emitBonusBuyDeterministicMarkup(resolveConfig({
    ...baseModel,
    bonusBuyDeterministic: { enabled: true, pickerTitle: '<script>bad</script>' },
  })).includes('&lt;script&gt;'));

const rt = emitBonusBuyDeterministicRuntime(r1);
t('Runtime exposes BBD_STATE', rt.includes('window.BBD_STATE'));
t('Runtime exposes bbdOpenPicker / bbdSelectTier / bbdCancelPicker',
  rt.includes('window.bbdOpenPicker') && rt.includes('window.bbdSelectTier') && rt.includes('window.bbdCancelPicker'));
t('Runtime bakes PLANTS as JSON literal',
  rt.includes('"STANDARD"') && rt.includes('"PREMIUM"') && rt.includes('"SUPER"'));
t('Runtime registers DOMContentLoaded patch hook',
  rt.includes("addEventListener('DOMContentLoaded'"));
t('Runtime registers onSpinResult / postSpin / onFsTrigger / onFsEnd',
  rt.includes("HookBus.on('onSpinResult'") &&
  rt.includes("HookBus.on('postSpin'") &&
  rt.includes("HookBus.on('onFsTrigger'") &&
  rt.includes("HookBus.on('onFsEnd'"));
t('Runtime emits onBonusBuyTierSelected', rt.includes("'onBonusBuyTierSelected'"));
t('Runtime emits onDeterministicPlantApplied', rt.includes("'onDeterministicPlantApplied'"));
t('Runtime guards against missing #bonusBuyBtn',
  rt.includes('bonusBuy not active'));

/* ────────────────── determinism ────────────────────────── */
const css2 = emitBonusBuyDeterministicCSS(r1);
t('determinism: identical config → byte-identical CSS', css === css2);
const rt2 = emitBonusBuyDeterministicRuntime(r1);
t('determinism: identical config → byte-identical runtime', rt === rt2);

/* ────────────────── vendor neutrality ─────────────────── */
const VENDOR_RX = /(igt|pragmatic|cash[- ]eruption|wolf[- ]run|cleopatra|buffalo|megaways|netent|microgaming|playtech|scientific games|aristocrat|konami|light\s*&\s*wonder)/i;
const allEmit = css + mk + rt;
t('vendor-neutral: no vendor / franchise strings in any emit', !VENDOR_RX.test(allEmit));

/* ────────────────── runtime sandbox smoke test ──────────── */
function makeSandbox() {
  function makeEl(tag) {
    const set = new Set();
    const el = {
      tagName: tag, children: [], style: {}, className: '',
      _attrs: {}, textContent: '', parentNode: null,
      disabled: false, _listeners: {},
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      setAttribute(k, v) { this._attrs[k] = String(v); },
      getAttribute(k) { return this._attrs[k] != null ? this._attrs[k] : null; },
      removeAttribute(k) { delete this._attrs[k]; },
      addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
      dispatchEvent(ev) {
        (this._listeners[ev.type] || []).forEach(fn => fn(ev));
      },
      click() {
        const evt = {
          type: 'click', target: el, currentTarget: el,
          stopPropagation() { this._stopped = true; },
          preventDefault() { this._prevented = true; },
        };
        this.dispatchEvent(evt);
      },
      focus() {},
      querySelector(sel) {
        if (sel === '.bbd-tier-card') return this.children.find(c => c.className && c.className.includes('bbd-tier-card')) || null;
        return null;
      },
      querySelectorAll(sel) {
        if (sel === '.bbd-tier-card' || sel === '#bbdOverlay .bbd-tier-card') {
          return this.children.filter(c => c.className && c.className.includes('bbd-tier-card'));
        }
        if (sel === '.cell') return this._cells || [];
        return [];
      },
    };
    el.classList = {
      add(c) { set.add(c); }, remove(c) { set.delete(c); }, contains(c) { return set.has(c); },
    };
    return el;
  }
  const overlay = makeEl('div'); overlay._attrs.id = 'bbdOverlay';
  /* 3 tier cards */
  ['STANDARD', 'PREMIUM', 'SUPER'].forEach(label => {
    const c = makeEl('button');
    c.className = 'bbd-tier-card';
    c._attrs['data-tier'] = label;
    overlay.children.push(c);
  });
  const cancel = makeEl('button'); cancel._attrs.id = 'bbdCancel';
  const buyBtn = makeEl('button'); buyBtn._attrs.id = 'bonusBuyBtn';

  /* 5×3 grid host */
  const grid = makeEl('div'); grid._attrs.id = 'gridHost';
  const cells = [];
  for (let i = 0; i < 15; i++) {
    const c = makeEl('div'); c.className = 'cell'; c.textContent = '?';
    cells.push(c); grid.children.push(c);
  }
  grid._cells = cells;

  const doc = {
    _byId: { bbdOverlay: overlay, bbdCancel: cancel, bonusBuyBtn: buyBtn, gridHost: grid },
    readyState: 'complete',
    addEventListener(ev, fn) { fn(); },                  /* fire immediately */
    getElementById(id) { return this._byId[id] || null; },
  };
  const HookBus = {
    _h: {},
    _mult: 1,
    on(e, fn) { (this._h[e] = this._h[e] || []).push(fn); },
    emit(e, p) { (this._h[e] || []).forEach(fn => fn(p)); },
    setMult(v) { this._mult = v; },
    getMult() { return this._mult; },
  };
  return {
    REELS: 5, ROWS: 3, __SLOT_BET__: 1,
    document: doc, HookBus,
    console: { warn: () => {}, error: () => {} },
  };
}

const sandboxWindow = makeSandbox();
const recorded = [];
sandboxWindow.HookBus.on('onBonusBuyTierSelected',     p => recorded.push({ e: 'selected', p }));
sandboxWindow.HookBus.on('onDeterministicPlantApplied', p => recorded.push({ e: 'plant',    p }));

const wrap = `
  var window = sandboxWindow;
  var document = window.document;
  var HookBus = window.HookBus;
  var console = window.console;
  var setTimeout = globalThis.setTimeout;
  ${rt}
`;
new Function('sandboxWindow', wrap)(sandboxWindow);

t('sandbox: BBD_STATE.patched === true after init', sandboxWindow.BBD_STATE.patched === true);
t('sandbox: __BB_PLANT__ starts null', sandboxWindow.__BB_PLANT__ === null);

/* Click Buy → modal opens (we wrap with stopPropagation so no actual buy fires) */
sandboxWindow.document.getElementById('bonusBuyBtn').click();
t('sandbox: modal opens on Buy click', sandboxWindow.BBD_STATE.modalOpen === true);

/* Select PREMIUM tier programmatically */
const ok = sandboxWindow.bbdSelectTier('PREMIUM');
t('sandbox: bbdSelectTier returns true for valid tier', ok === true);
t('sandbox: __BB_PLANT__ populated with PREMIUM',
  sandboxWindow.__BB_PLANT__ && sandboxWindow.__BB_PLANT__.tier === 'PREMIUM');
t('sandbox: __BB_PLANT__.positions length === 5 (PREMIUM = 5 scatters)',
  sandboxWindow.__BB_PLANT__.positions.length === 5);
t('sandbox: onBonusBuyTierSelected fired with tier=PREMIUM, costX=150',
  recorded.find(r => r.e === 'selected') && recorded.find(r => r.e === 'selected').p.tier === 'PREMIUM');

/* Fire onSpinResult → plant should be applied */
sandboxWindow.HookBus.emit('onSpinResult');
t('sandbox: onDeterministicPlantApplied fired exactly once',
  recorded.filter(r => r.e === 'plant').length === 1);
t('sandbox: plant event count === 5',
  recorded.find(r => r.e === 'plant').p.count === 5);
t('sandbox: plant event tier === PREMIUM',
  recorded.find(r => r.e === 'plant').p.tier === 'PREMIUM');

/* Verify 5 cells got the bonus symbol */
const plantedCells = sandboxWindow.document.getElementById('gridHost')._cells.filter(c => c.textContent === 'S');
t('sandbox: 5 cells now carry the bonus symbol "S"', plantedCells.length === 5);

/* Fire postSpin → plant should be cleared (one-shot) */
sandboxWindow.HookBus.emit('postSpin');
t('sandbox: __BB_PLANT__ cleared after postSpin', sandboxWindow.__BB_PLANT__ === null);

/* SUPER tier with extraMult */
sandboxWindow.bbdSelectTier('SUPER');
t('sandbox: SUPER tier extraMult applied via HookBus.setMult after onSpinResult',
  (function () {
    sandboxWindow.HookBus.emit('onSpinResult');
    return sandboxWindow.HookBus.getMult() === 2;
  })());

/* Cancel path */
sandboxWindow.bbdOpenPicker();
sandboxWindow.bbdCancelPicker();
t('sandbox: bbdCancelPicker clears modal state + lastSelection',
  sandboxWindow.BBD_STATE.modalOpen === false && sandboxWindow.BBD_STATE.lastSelection === null);

/* Invalid tier label */
const bad = sandboxWindow.bbdSelectTier('NONEXISTENT');
t('sandbox: bbdSelectTier returns false for invalid tier', bad === false);

console.log('\n--- summary ---');
console.log('  pass:', pass);
console.log('  fail:', fail);
if (fail > 0) process.exit(1);
