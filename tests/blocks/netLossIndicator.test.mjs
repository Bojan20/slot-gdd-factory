/**
 * tests/blocks/netLossIndicator.test.mjs — Wave H12
 *
 * Exercises: defaultConfig integrity, resolveConfig validators (incl.
 * hard requirement that balanceHud must be enabled), CSS/markup/runtime
 * emit shape, vendor neutrality, determinism, and inline sandbox smoke
 * test that proves the onBalanceChanged → threshold detection → emit
 * flow works end-to-end.
 */
import {
  defaultConfig, resolveConfig,
  emitNetLossIndicatorCSS,
  emitNetLossIndicatorMarkup,
  emitNetLossIndicatorRuntime,
} from '../../src/blocks/netLossIndicator.mjs';

let pass = 0, fail = 0;
function t(name, ok, hint) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (hint ? '  — ' + hint : '')); }
}

console.log('\n— blocks/netLossIndicator.mjs —');

/* ────────────────── defaultConfig integrity ───────────────── */
const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('thresholds = 3-tier loss ladder', d.thresholds.length === 3);
t('thresholds[0].level === caution', d.thresholds[0].level === 'caution');
t('thresholds[2].level === alert', d.thresholds[2].level === 'alert');
t('all default thresholds are negative (loss ladder)',
  d.thresholds.every(th => th.amount < 0));
t('amounts strictly descending (-50, -150, -500)',
  d.thresholds[0].amount === -50 && d.thresholds[1].amount === -150 && d.thresholds[2].amount === -500);
t('positiveColor valid rgb triplet', /^\d{1,3},\d{1,3},\d{1,3}$/.test(d.positiveColor));
t('negativeColor valid rgb triplet', /^\d{1,3},\d{1,3},\d{1,3}$/.test(d.negativeColor));
t('neutralColor valid rgb triplet', /^\d{1,3},\d{1,3},\d{1,3}$/.test(d.neutralColor));
t('currencyPrefix default €', d.currencyPrefix === '€');
t('showLabel default true', d.showLabel === true);
t('showInBaseGame default true', d.showInBaseGame === true);
t('showInFs default true', d.showInFs === true);
t('resetOnSessionReset default true', d.resetOnSessionReset === true);
t('resetOnAutoplayStart default false (rarely wanted)', d.resetOnAutoplayStart === false);

/* defaultConfig() returns a fresh copy each call */
defaultConfig().thresholds.push({ amount: -1000, level: 'extra' });
t('defaultConfig returns independent copy each call', defaultConfig().thresholds.length === 3);

/* ────────────────── resolveConfig — happy paths ──────────── */
const r1 = resolveConfig({ netLossIndicator: { enabled: true } });
t('explicit enabled honored', r1.enabled === true);

const r2 = resolveConfig({ features: [{ kind: 'net_loss_indicator' }] });
t('auto-enable via feature kind (snake_case)', r2.enabled === true);

const r3 = resolveConfig({ features: [{ kind: 'session-net' }] });
t('auto-enable via feature kind (dash variant)', r3.enabled === true);

/* Hard requirement: must DISABLE when balanceHud is explicitly off */
const r4 = resolveConfig({
  netLossIndicator: { enabled: true },
  balanceHud: { enabled: false },
});
t('hard requirement: force-disabled when balanceHud.enabled=false', r4.enabled === false);

/* Thresholds override */
const r5 = resolveConfig({
  netLossIndicator: {
    enabled: true,
    thresholds: [
      { amount: -200, level: 'late_warn', label: 'BIG LOSS' },
      { amount: 100, level: 'profit',     label: 'IN PROFIT' },
    ],
  },
});
t('thresholds override accepted (custom)', r5.thresholds.length === 2);
t('thresholds sorted ASC by amount (-200 first, +100 last)',
  r5.thresholds[0].amount === -200 && r5.thresholds[1].amount === 100);

const r6 = resolveConfig({
  netLossIndicator: {
    enabled: true,
    showInBaseGame: false,
    showInFs: false,
    currencyPrefix: '$',
    positiveColor: '50,250,50',
    resetOnAutoplayStart: true,
  },
});
t('showInBaseGame=false honored', r6.showInBaseGame === false);
t('showInFs=false honored', r6.showInFs === false);
t('currencyPrefix override accepted', r6.currencyPrefix === '$');
t('positiveColor override accepted', r6.positiveColor === '50,250,50');
t('resetOnAutoplayStart=true honored', r6.resetOnAutoplayStart === true);

/* ────────────────── resolveConfig — malformed ────────────── */
const m1 = resolveConfig({ netLossIndicator: { enabled: true, thresholds: 'not-array' } });
t('non-array thresholds rejected → defaults retained', m1.thresholds.length === 3);

const m2 = resolveConfig({
  netLossIndicator: {
    enabled: true,
    thresholds: [{ amount: NaN, level: 'oops' }],
  },
});
t('NaN amount → defaults retained', m2.thresholds.length === 3);

const m3 = resolveConfig({
  netLossIndicator: {
    enabled: true,
    thresholds: [
      { amount: -10, level: 'a' },
      { amount: -20, level: 'a' },   /* duplicate level */
    ],
  },
});
t('duplicate level → defaults retained', m3.thresholds.length === 3);

const m4 = resolveConfig({
  netLossIndicator: {
    enabled: true,
    thresholds: [{ amount: -10, level: 'BAD LEVEL!' }],   /* malformed level */
  },
});
t('malformed level string → defaults retained', m4.thresholds.length === 3);

const m5 = resolveConfig({ netLossIndicator: { enabled: true, positiveColor: 'bogus' } });
t('malformed positiveColor → default retained', m5.positiveColor === '120,220,140');

const m6 = resolveConfig({
  netLossIndicator: { enabled: true, currencyPrefix: 'XXXXXXX' },   /* too long */
});
t('overly long currencyPrefix rejected', m6.currencyPrefix === '€');

/* ────────────────── emit shape — disabled / enabled ─────── */
t('CSS empty when disabled', emitNetLossIndicatorCSS(defaultConfig()) === '');
t('Markup empty when disabled', emitNetLossIndicatorMarkup(defaultConfig()) === '');
t('Runtime emits stubs when disabled',
  emitNetLossIndicatorRuntime(defaultConfig()).includes('window.__NET_LOSS__       = 0'));

const css = emitNetLossIndicatorCSS(r1);
t('CSS includes .balance-hud__col--net', css.includes('.balance-hud__col--net'));
t('CSS includes data-sign="pos|neg|zero" selectors',
  css.includes('data-sign="pos"') && css.includes('data-sign="neg"') && css.includes('data-sign="zero"'));
t('CSS bakes positiveColor', css.includes('120,220,140'));
t('CSS bakes negativeColor', css.includes('230,90,80'));
t('CSS emits per-threshold accent (caution + warn + alert)',
  css.includes('data-level="caution"') && css.includes('data-level="warn"') && css.includes('data-level="alert"'));
t('CSS guards prefers-reduced-motion', css.includes('prefers-reduced-motion'));

t('Markup empty when enabled (chip mounted at runtime)',
  emitNetLossIndicatorMarkup(r1) === '');

const rt = emitNetLossIndicatorRuntime(r1);
t('Runtime exposes NLI_STATE', rt.includes('window.NLI_STATE'));
t('Runtime exposes nliResetSession', rt.includes('window.nliResetSession'));
t('Runtime bakes thresholds as JSON literal',
  rt.includes('"caution"') && rt.includes('"warn"') && rt.includes('"alert"'));
t('Runtime registers onBalanceChanged listener',
  rt.includes("HookBus.on('onBalanceChanged'"));
t('Runtime registers onAutoplayStart listener',
  rt.includes("HookBus.on('onAutoplayStart'"));
t('Runtime registers onFsTrigger / onFsEnd listeners',
  rt.includes("HookBus.on('onFsTrigger'") && rt.includes("HookBus.on('onFsEnd'"));
t('Runtime emits onNetThresholdCrossed', rt.includes("'onNetThresholdCrossed'"));
t('Runtime DOMContentLoaded mount hook', rt.includes("addEventListener('DOMContentLoaded'"));
t('Runtime guards against missing #balanceHud', rt.includes('balanceHud not present'));

/* ────────────────── determinism ────────────────────────── */
const css2 = emitNetLossIndicatorCSS(r1);
t('determinism: identical config → byte-identical CSS', css === css2);
const rt2 = emitNetLossIndicatorRuntime(r1);
t('determinism: identical config → byte-identical runtime', rt === rt2);

/* ────────────────── vendor neutrality ─────────────────── */
const VENDOR_RX = /(igt|pragmatic|cash[- ]eruption|wolf[- ]run|cleopatra|buffalo|megaways|netent|microgaming|playtech|scientific games|aristocrat|konami|light\s*&\s*wonder)/i;
const allEmit = css + emitNetLossIndicatorMarkup(r1) + rt;
t('vendor-neutral: no vendor / franchise strings in any emit', !VENDOR_RX.test(allEmit));

/* ────────────────── runtime sandbox smoke test ───────────── */
function makeSandbox() {
  function makeEl(tag) {
    const set = new Set();
    const el = {
      tagName: tag, children: [], style: {}, className: '',
      _attrs: {}, textContent: '', parentNode: null,
      _id: '',
      get id() { return this._id; },
      set id(v) {
        this._id = String(v);
        if (this.ownerDoc && this.ownerDoc._byId) this.ownerDoc._byId[v] = this;
      },
      appendChild(c) {
        this.children.push(c);
        c.parentNode = this;
        c.ownerDoc = this.ownerDoc || c.ownerDoc;
        /* If child carries an id, register in the doc lookup table. */
        if (c._id && c.ownerDoc && c.ownerDoc._byId) c.ownerDoc._byId[c._id] = c;
        return c;
      },
      setAttribute(k, v) {
        this._attrs[k] = String(v);
        if (k === 'id') {
          this._id = String(v);
          if (this.ownerDoc && this.ownerDoc._byId) this.ownerDoc._byId[v] = this;
        }
      },
      getAttribute(k) {
        if (k === 'id') return this._id || null;
        return this._attrs[k] != null ? this._attrs[k] : null;
      },
      removeAttribute(k) { delete this._attrs[k]; },
      get innerHTML() { return this._innerHTML || ''; },
      set innerHTML(v) {
        this._innerHTML = v;
        /* Crude parse — extract <div id="x"> children so getElementById works. */
        const re = /id="([^"]+)"/g;
        let m;
        while ((m = re.exec(v)) !== null) {
          const child = makeEl('div');
          child._attrs.id = m[1];
          this.children.push(child);
          child.parentNode = this;
          if (this.ownerDoc && this.ownerDoc._byId) this.ownerDoc._byId[m[1]] = child;
        }
      },
    };
    el.classList = {
      add(c) { set.add(c); },
      remove(c) { set.delete(c); },
      contains(c) { return set.has(c); },
    };
    return el;
  }
  const hud = makeEl('div');
  const balanceVal = makeEl('div');
  balanceVal.textContent = '€1000.00';

  const doc = {
    _byId: {},
    readyState: 'complete',
    addEventListener(ev, fn) { fn(); },
    getElementById(id) { return this._byId[id] || null; },
    createElement(tag) {
      const el = makeEl(tag);
      el.ownerDoc = doc;
      return el;
    },
  };
  /* Set ownerDoc + id AFTER doc exists so setter side-effects register. */
  hud.ownerDoc = doc; hud.id = 'balanceHud';
  balanceVal.ownerDoc = doc; balanceVal.id = 'balanceHudBalanceValue';

  const HookBus = {
    _h: {},
    on(e, fn) { (this._h[e] = this._h[e] || []).push(fn); },
    emit(e, p) { (this._h[e] || []).forEach(fn => fn(p)); },
  };

  return {
    __SLOT_BALANCE__: 1000,
    document: doc, HookBus,
    console: { warn: () => {}, error: () => {} },
  };
}

const sandboxWindow = makeSandbox();
const recorded = [];
sandboxWindow.HookBus.on('onNetThresholdCrossed', p => recorded.push({ p }));

const wrap = `
  var window = sandboxWindow;
  var document = window.document;
  var HookBus = window.HookBus;
  var console = window.console;
  ${rt}
`;
new Function('sandboxWindow', wrap)(sandboxWindow);

t('sandbox: NLI_STATE present + enabled', sandboxWindow.NLI_STATE.enabled === true);
t('sandbox: mounted on DOMContentLoaded', sandboxWindow.NLI_STATE.mounted === true);
t('sandbox: net cell created in DOM',
  !!sandboxWindow.document.getElementById('balanceHudNetCol'));

/* Helper: emit onBalanceChanged AND keep sandbox __SLOT_BALANCE__ in
 * sync (mirrors what balanceHud does in production: writes the global
 * first, then fires the event). */
function balEmit(balance, delta, reason) {
  sandboxWindow.__SLOT_BALANCE__ = balance;
  sandboxWindow.HookBus.emit('onBalanceChanged', { balance: balance, delta: delta, reason: reason });
}

/* Fire init balance → sessionStart captured, net=0 */
balEmit(1000, 0, 'init');
t('sandbox: sessionStart captured at init (1000)', sandboxWindow.NLI_STATE.sessionStart === 1000);
t('sandbox: net === 0 after init', sandboxWindow.NLI_STATE.net === 0);
t('sandbox: __NET_LOSS__ exposed = 0', sandboxWindow.__NET_LOSS__ === 0);

/* Lose 60 → caution level triggered */
balEmit(940, -60, 'spin-debit');
t('sandbox: net === -60 after losing 60', sandboxWindow.NLI_STATE.net === -60);
t('sandbox: level === caution after net=-60', sandboxWindow.NLI_STATE.level === 'caution');
t('sandbox: onNetThresholdCrossed fired once (to=caution)',
  recorded.length === 1 && recorded[0].p.to === 'caution');
t('sandbox: direction=losing on first cross',
  recorded[0].p.direction === 'losing');

/* Lose more → warn level */
balEmit(800, -140, 'spin-debit');
t('sandbox: level escalated to warn at net=-200',
  sandboxWindow.NLI_STATE.level === 'warn');
t('sandbox: second threshold event fired (from caution to warn)',
  recorded.length === 2 && recorded[1].p.from === 'caution' && recorded[1].p.to === 'warn');

/* Recover → back to caution */
balEmit(900, +100, 'win-credit');
t('sandbox: net === -100 after recovery', sandboxWindow.NLI_STATE.net === -100);
t('sandbox: level dropped back to caution', sandboxWindow.NLI_STATE.level === 'caution');
t('sandbox: third event fired with direction=recovering',
  recorded.length === 3 && recorded[2].p.direction === 'recovering');

/* nliResetSession should zero the net at current balance */
sandboxWindow.nliResetSession();
t('sandbox: nliResetSession zeros net',
  sandboxWindow.NLI_STATE.net === 0 && sandboxWindow.NLI_STATE.level === '' &&
  sandboxWindow.__NET_LOSS__ === 0);
t('sandbox: sessionStart re-snapped to current balance after reset',
  sandboxWindow.NLI_STATE.sessionStart === 900);

/* Hit deep alert level */
balEmit(350, -550, 'spin-debit');
t('sandbox: deep loss net=-550 → alert level',
  sandboxWindow.NLI_STATE.level === 'alert');
t('sandbox: 4th event fired (to=alert)',
  recorded.length === 4 && recorded[3].p.to === 'alert');
t('sandbox: alert event carries threshold definition',
  recorded[3].p.threshold && recorded[3].p.threshold.amount === -500);

/* FS phase toggle */
sandboxWindow.HookBus.emit('onFsTrigger');
t('sandbox: FS trigger latches inFs=true', sandboxWindow.NLI_STATE.inFs === true);
sandboxWindow.HookBus.emit('onFsEnd');
t('sandbox: FS end clears inFs=false', sandboxWindow.NLI_STATE.inFs === false);

console.log('\n--- summary ---');
console.log('  pass:', pass);
console.log('  fail:', fail);
if (fail > 0) process.exit(1);
