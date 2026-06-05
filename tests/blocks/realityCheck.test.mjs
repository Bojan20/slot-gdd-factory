/**
 * tests/blocks/realityCheck.test.mjs — Wave H2
 *
 * Exercises: defaultConfig integrity, resolveConfig validators, CSS /
 * markup / runtime emit shape, vendor neutrality, determinism, and
 * inline sandbox smoke test that proves the trigger paths (time / spin /
 * net-loss) + CTA flow (continue / pause / quit).
 */
import {
  defaultConfig, resolveConfig,
  emitRealityCheckCSS,
  emitRealityCheckMarkup,
  emitRealityCheckRuntime,
} from '../../src/blocks/realityCheck.mjs';

let pass = 0, fail = 0;
function t(name, ok, hint) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (hint ? '  — ' + hint : '')); }
}

console.log('\n— blocks/realityCheck.mjs —');

/* ────────────────── defaultConfig integrity ───────────────── */
const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('intervalMs default = 600000 (10 min)', d.intervalMs === 600000);
t('spinInterval default = 0 (disabled)', d.spinInterval === 0);
t('triggerOnLossLevel default = alert', d.triggerOnLossLevel === 'alert');
t('pauseOptions default = [5,15,30]', JSON.stringify(d.pauseOptions) === '[5,15,30]');
t('currencyPrefix default = €', d.currencyPrefix === '€');
t('showElapsedTime default true', d.showElapsedTime === true);
t('showSpinCount default true', d.showSpinCount === true);
t('showNetSummary default true', d.showNetSummary === true);
t('dismissBlocksSpin default true', d.dismissBlocksSpin === true);
t('accentColor valid rgb', /^\d{1,3},\d{1,3},\d{1,3}$/.test(d.accentColor));
t('title non-empty', d.title && d.title.length > 0);

/* defaultConfig fresh copy */
defaultConfig().pauseOptions.push(99);
t('defaultConfig returns independent copy', defaultConfig().pauseOptions.length === 3);

/* ────────────────── resolveConfig — happy paths ──────────── */
const r1 = resolveConfig({ realityCheck: { enabled: true } });
t('explicit enabled honored', r1.enabled === true);

const r2 = resolveConfig({ features: [{ kind: 'reality_check' }] });
t('auto-enable via feature kind (snake_case)', r2.enabled === true);

const r3 = resolveConfig({ features: [{ kind: 'reality-check' }] });
t('auto-enable via feature kind (dash variant)', r3.enabled === true);

const r4 = resolveConfig({
  realityCheck: {
    enabled: true,
    intervalMs: 1800000,    /* 30 min */
    spinInterval: 100,
    triggerOnLossLevel: 'warn',
    pauseOptions: [10, 30],
    currencyPrefix: '$',
    showElapsedTime: false,
    accentColor: '50,200,255',
    title: 'PLAYER CHECK',
  },
});
t('intervalMs override accepted', r4.intervalMs === 1800000);
t('spinInterval override accepted', r4.spinInterval === 100);
t('triggerOnLossLevel override accepted', r4.triggerOnLossLevel === 'warn');
t('pauseOptions override accepted', JSON.stringify(r4.pauseOptions) === '[10,30]');
t('currencyPrefix override accepted', r4.currencyPrefix === '$');
t('showElapsedTime=false honored', r4.showElapsedTime === false);
t('accentColor override accepted', r4.accentColor === '50,200,255');
t('title override accepted', r4.title === 'PLAYER CHECK');

/* triggerOnLossLevel empty string disables loss-based trigger */
const r5 = resolveConfig({ realityCheck: { enabled: true, triggerOnLossLevel: '' } });
t('empty triggerOnLossLevel honored (disables loss trigger)', r5.triggerOnLossLevel === '');

/* ────────────────── resolveConfig — malformed ────────────── */
const m1 = resolveConfig({ realityCheck: { enabled: true, intervalMs: 100 } });
t('too-small intervalMs clamped to floor (5000)', m1.intervalMs === 5000);

const m2 = resolveConfig({ realityCheck: { enabled: true, pauseOptions: 'not-array' } });
t('non-array pauseOptions → defaults retained', JSON.stringify(m2.pauseOptions) === '[5,15,30]');

const m3 = resolveConfig({ realityCheck: { enabled: true, pauseOptions: [0, -5] } });
t('invalid pauseOptions values → defaults retained', JSON.stringify(m3.pauseOptions) === '[5,15,30]');

const m4 = resolveConfig({ realityCheck: { enabled: true, accentColor: 'bogus' } });
t('malformed accentColor → default retained', m4.accentColor === '255,170,80');

const m5 = resolveConfig({ realityCheck: { enabled: true, triggerOnLossLevel: 'BAD LEVEL' } });
t('malformed triggerOnLossLevel → default retained', m5.triggerOnLossLevel === 'alert');

/* ────────────────── emit shape — disabled / enabled ─────── */
t('CSS empty when disabled', emitRealityCheckCSS(defaultConfig()) === '');
t('Markup empty when disabled', emitRealityCheckMarkup(defaultConfig()) === '');
t('Runtime emits stubs when disabled',
  emitRealityCheckRuntime(defaultConfig()).includes('window.__REALITY_PAUSE_ACTIVE__ = false'));

const css = emitRealityCheckCSS(r1);
t('CSS includes .rc-overlay', css.includes('.rc-overlay'));
t('CSS includes .rc-modal', css.includes('.rc-modal'));
t('CSS includes .rc-btn--quit accent', css.includes('.rc-btn--quit'));
t('CSS bakes accentColor', css.includes('255,170,80'));
t('CSS guards prefers-reduced-motion', css.includes('prefers-reduced-motion'));

const mk = emitRealityCheckMarkup(r1);
t('Markup includes #rcOverlay', mk.includes('id="rcOverlay"'));
t('Markup includes rcBtnContinue + rcBtnPause + rcBtnQuit',
  mk.includes('id="rcBtnContinue"') && mk.includes('id="rcBtnPause"') && mk.includes('id="rcBtnQuit"'));
t('Markup includes role="dialog" + aria-modal="true"',
  mk.includes('role="dialog"') && mk.includes('aria-modal="true"'));
t('Markup includes data-modal="true" (spinControl guard)', mk.includes('data-modal="true"'));
t('Markup includes 3 pause-option buttons (default 5/15/30)',
  (mk.match(/data-pause-min="/g) || []).length === 3);
t('Markup XSS: title escaped',
  emitRealityCheckMarkup(resolveConfig({
    realityCheck: { enabled: true, title: '<script>bad</script>' },
  })).includes('&lt;script&gt;'));

const rt = emitRealityCheckRuntime(r1);
t('Runtime exposes RC_STATE', rt.includes('window.RC_STATE'));
t('Runtime exposes rcShow / rcDismiss / rcResetSession',
  rt.includes('window.rcShow') && rt.includes('window.rcDismiss') && rt.includes('window.rcResetSession'));
t('Runtime exposes __REALITY_PAUSE_ACTIVE__', rt.includes('window.__REALITY_PAUSE_ACTIVE__'));
t('Runtime registers preSpin / onAutoplayTick / onBalanceChanged / onNetThresholdCrossed',
  rt.includes("HookBus.on('preSpin'") &&
  rt.includes("HookBus.on('onAutoplayTick'") &&
  rt.includes("HookBus.on('onBalanceChanged'") &&
  rt.includes("HookBus.on('onNetThresholdCrossed'"));
t('Runtime emits onRealityCheckShown', rt.includes("HookBus.emit('onRealityCheckShown'"));
t('Runtime emits onRealityCheckDismissed', rt.includes("HookBus.emit('onRealityCheckDismissed'"));
t('Runtime emits onRealityCheckPaused', rt.includes("HookBus.emit('onRealityCheckPaused'"));
t('Runtime emits onRealityCheckResumed', rt.includes("HookBus.emit('onRealityCheckResumed'"));
t('Runtime emits onRealityCheckQuit', rt.includes("HookBus.emit('onRealityCheckQuit'"));

/* ────────────────── determinism ────────────────────────── */
const css2 = emitRealityCheckCSS(r1);
t('determinism: identical config → byte-identical CSS', css === css2);
const rt2 = emitRealityCheckRuntime(r1);
t('determinism: identical config → byte-identical runtime', rt === rt2);

/* ────────────────── vendor neutrality ─────────────────── */
const VENDOR_RX = /(igt|pragmatic|cash[- ]eruption|wolf[- ]run|cleopatra|buffalo|megaways|netent|microgaming|playtech|scientific games|aristocrat|konami|light\s*&\s*wonder)/i;
const allEmit = css + mk + rt;
t('vendor-neutral: no vendor / franchise strings in any emit', !VENDOR_RX.test(allEmit));

/* ────────────────── runtime sandbox smoke test ───────────── */
function makeSandbox() {
  function makeEl(tag) {
    const set = new Set();
    const el = {
      tagName: tag, children: [], style: {}, className: '',
      _attrs: {}, _id: '', textContent: '', parentNode: null,
      _listeners: {},
      get id() { return this._id; },
      set id(v) {
        this._id = String(v);
        if (this.ownerDoc && this.ownerDoc._byId) this.ownerDoc._byId[v] = this;
      },
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
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
      addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
      click() { (this._listeners.click || []).forEach(fn => fn({ type: 'click' })); },
      querySelectorAll(sel) {
        if (sel === '.rc-pause-btn') {
          return this.children.filter(c => c.className && c.className.includes('rc-pause-btn'));
        }
        return [];
      },
    };
    el.classList = {
      add(c) { set.add(c); },
      remove(c) { set.delete(c); },
      contains(c) { return set.has(c); },
    };
    return el;
  }
  const overlay = makeEl('div');
  const optsBox = makeEl('div');
  const contBtn = makeEl('button');
  const pauseBtn = makeEl('button');
  const quitBtn = makeEl('button');
  const statTime = makeEl('div');
  const statSpins = makeEl('div');
  const statWin = makeEl('div');
  const statLoss = makeEl('div');
  const statNet = makeEl('div');
  const statNetBox = makeEl('div');

  /* Pause options children — 3 buttons */
  [5, 15, 30].forEach(min => {
    const b = makeEl('button');
    b.className = 'rc-pause-btn';
    b._attrs['data-pause-min'] = String(min);
    optsBox.children.push(b);
  });

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
  /* Wire ids */
  overlay.ownerDoc = doc; overlay.id = 'rcOverlay';
  optsBox.ownerDoc = doc; optsBox.id = 'rcPauseOptions';
  contBtn.ownerDoc = doc; contBtn.id = 'rcBtnContinue';
  pauseBtn.ownerDoc = doc; pauseBtn.id = 'rcBtnPause';
  quitBtn.ownerDoc = doc; quitBtn.id = 'rcBtnQuit';
  statTime.ownerDoc = doc; statTime.id = 'rcStatTime';
  statSpins.ownerDoc = doc; statSpins.id = 'rcStatSpins';
  statWin.ownerDoc = doc; statWin.id = 'rcStatWin';
  statLoss.ownerDoc = doc; statLoss.id = 'rcStatLoss';
  statNet.ownerDoc = doc; statNet.id = 'rcStatNet';
  statNetBox.ownerDoc = doc; statNetBox.id = 'rcStatNetBox';

  const HookBus = {
    _h: {},
    on(e, fn) { (this._h[e] = this._h[e] || []).push(fn); },
    emit(e, p) { (this._h[e] || []).forEach(fn => fn(p)); },
  };
  return {
    document: doc, HookBus,
    console: { warn: () => {}, error: () => {} },
    performance: { now: () => Date.now() },
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
  };
}

/* Build a runtime with intervalMs=10000 (10s — short enough that we can
 * synthesize crossings in tests without waiting) + spinInterval=5. */
const testCfg = resolveConfig({
  realityCheck: { enabled: true, intervalMs: 10000, spinInterval: 5, triggerOnLossLevel: 'alert' },
});
const rtTest = emitRealityCheckRuntime(testCfg);

const sandboxWindow = makeSandbox();
const recorded = [];
sandboxWindow.HookBus.on('onRealityCheckShown',     p => recorded.push({ e: 'shown', p }));
sandboxWindow.HookBus.on('onRealityCheckDismissed', p => recorded.push({ e: 'dismissed', p }));
sandboxWindow.HookBus.on('onRealityCheckPaused',    p => recorded.push({ e: 'paused', p }));
sandboxWindow.HookBus.on('onRealityCheckResumed',   p => recorded.push({ e: 'resumed', p }));
sandboxWindow.HookBus.on('onRealityCheckQuit',      p => recorded.push({ e: 'quit', p }));

const wrap = `
  var window = sandboxWindow;
  var document = window.document;
  var HookBus = window.HookBus;
  var console = window.console;
  var performance = window.performance;
  var setTimeout = window.setTimeout;
  var clearTimeout = window.clearTimeout;
  ${rtTest}
`;
new Function('sandboxWindow', wrap)(sandboxWindow);

t('sandbox: RC_STATE.enabled === true', sandboxWindow.RC_STATE.enabled === true);
t('sandbox: __REALITY_PAUSE_ACTIVE__ starts false', sandboxWindow.__REALITY_PAUSE_ACTIVE__ === false);

/* ── Spin-based trigger: 5 preSpin events → spinInterval=5 fires modal ── */
for (let i = 0; i < 5; i++) sandboxWindow.HookBus.emit('preSpin');
t('sandbox: 5 spins → 1 onRealityCheckShown fired with reason=spins',
  recorded.filter(e => e.e === 'shown').length === 1 &&
  recorded.find(e => e.e === 'shown').p.reason === 'spins');
t('sandbox: shown event stats.spins === 5',
  recorded.find(e => e.e === 'shown').p.stats.spins === 5);

/* ── CONTINUE dismiss ── */
sandboxWindow.document.getElementById('rcBtnContinue').click();
t('sandbox: continue click → onRealityCheckDismissed{reason:continue}',
  recorded.filter(e => e.e === 'dismissed').length === 1 &&
  recorded.find(e => e.e === 'dismissed').p.reason === 'continue');

/* ── Loss-based trigger ── */
sandboxWindow.HookBus.emit('onNetThresholdCrossed', { to: 'alert', from: 'warn', direction: 'losing', net: -650 });
t('sandbox: alert-level loss → modal shown with reason=loss',
  recorded.filter(e => e.e === 'shown' && e.p.reason === 'loss').length === 1);

/* ── PAUSE flow ── */
sandboxWindow.rcDismiss('continue');   /* close current modal first */
recorded.length = 0;
sandboxWindow.rcShow('time');
/* User clicks PAUSE → reveals options. We simulate clicking the 5-min option. */
const pauseOpts = sandboxWindow.document.getElementById('rcPauseOptions').querySelectorAll('.rc-pause-btn');
pauseOpts[0].click();
t('sandbox: pause click fires onRealityCheckPaused',
  recorded.filter(e => e.e === 'paused').length === 1);
t('sandbox: paused.durationMs === 5 min',
  recorded.find(e => e.e === 'paused').p.durationMs === 5 * 60 * 1000);
t('sandbox: __REALITY_PAUSE_ACTIVE__ flipped true', sandboxWindow.__REALITY_PAUSE_ACTIVE__ === true);

/* ── QUIT flow ── */
recorded.length = 0;
/* Fake some session state */
sandboxWindow.RC_STATE.spins = 100;
sandboxWindow.RC_STATE.totalWin = 250;
sandboxWindow.RC_STATE.totalLoss = 350;
sandboxWindow.RC_STATE.paused = false;   /* allow modal */
sandboxWindow.RC_STATE._shown = false;
sandboxWindow.rcShow('time');
sandboxWindow.document.getElementById('rcBtnQuit').click();
t('sandbox: quit click fires onRealityCheckQuit',
  recorded.filter(e => e.e === 'quit').length === 1);
t('sandbox: quit.stats.net === -100 (250 - 350)',
  recorded.find(e => e.e === 'quit').p.stats.net === -100);
t('sandbox: rcResetSession after quit clears counters',
  sandboxWindow.RC_STATE.spins === 0 && sandboxWindow.RC_STATE.totalWin === 0 && sandboxWindow.RC_STATE.totalLoss === 0);

/* ── Win/loss tracking via onBalanceChanged ── */
sandboxWindow.HookBus.emit('onBalanceChanged', { balance: 1100, delta: +100, reason: 'win-credit' });
sandboxWindow.HookBus.emit('onBalanceChanged', { balance: 1050, delta: -50,  reason: 'spin-debit' });
t('sandbox: totalWin accumulates from positive deltas', sandboxWindow.RC_STATE.totalWin === 100);
t('sandbox: totalLoss accumulates from negative deltas', sandboxWindow.RC_STATE.totalLoss === 50);

console.log('\n--- summary ---');
console.log('  pass:', pass);
console.log('  fail:', fail);
if (fail > 0) process.exit(1);
