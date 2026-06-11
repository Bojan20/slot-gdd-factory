/**
 * tests/blocks/sessionTimeout.test.mjs — Wave H3
 *
 * Exercises: defaultConfig integrity, resolveConfig validators (incl.
 * cross-bounds warnMs ≤ maxMs), CSS / markup / runtime emit shape,
 * XSS escaping, vendor neutrality, determinism, and inline sandbox
 * smoke test that proves the warning + force-break flow + extend +
 * logout CTA + realityCheck-pause integration.
 */
import {
  defaultConfig, resolveConfig,
  emitSessionTimeoutCSS,
  emitSessionTimeoutMarkup,
  emitSessionTimeoutRuntime,
} from '../../src/blocks/sessionTimeout.mjs';

let pass = 0, fail = 0;
function t(name, ok, hint) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (hint ? '  — ' + hint : '')); }
}

console.log('\n— blocks/sessionTimeout.mjs —');

/* ────────────────── defaultConfig integrity ───────────────── */
const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('maxMs default = 60 min (3600000)', d.maxMs === 60 * 60 * 1000);
t('warnMs default = 60 s (60000)', d.warnMs === 60000);
t('breakMs default = 5 min (300000)', d.breakMs === 5 * 60 * 1000);
t('forceLogout default false', d.forceLogout === false);
t('extendable default true', d.extendable === true);
t('pauseDuringReality default true', d.pauseDuringReality === true);
t('accentColor valid rgb', /^\d{1,3},\d{1,3},\d{1,3}$/.test(d.accentColor));
t('warningTitle non-empty', d.warningTitle && d.warningTitle.length > 0);
t('breakTitle non-empty', d.breakTitle && d.breakTitle.length > 0);
t('copyContinue non-empty', d.copyContinue && d.copyContinue.length > 0);
t('copyQuit non-empty', d.copyQuit && d.copyQuit.length > 0);

/* defaultConfig fresh copy (no shared mutation) */
const dA = defaultConfig();
dA.warningTitle = 'MUTATED';
t('defaultConfig returns independent copy', defaultConfig().warningTitle !== 'MUTATED');

/* ────────────────── resolveConfig — happy paths ──────────── */
const r1 = resolveConfig({ sessionTimeout: { enabled: true } });
t('explicit enabled honored', r1.enabled === true);

const r2 = resolveConfig({ features: [{ kind: 'session_timeout' }] });
t('auto-enable via feature kind (snake_case)', r2.enabled === true);

const r3 = resolveConfig({ features: [{ kind: 'session-limit' }] });
t('auto-enable via feature-limit kind (dash variant)', r3.enabled === true);

const r4 = resolveConfig({
  sessionTimeout: {
    enabled: true,
    maxMs: 30 * 60 * 1000,
    warnMs: 30000,
    breakMs: 10 * 60 * 1000,
    forceLogout: true,
    extendable: false,
    pauseDuringReality: false,
    accentColor: '120,200,255',
    warningTitle: 'TAKE A REST',
    breakTitle: 'COOLING DOWN',
    copyContinue: 'KEEP GOING',
    copyQuit: 'SIGN OUT',
  },
});
t('maxMs override accepted', r4.maxMs === 30 * 60 * 1000);
t('warnMs override accepted', r4.warnMs === 30000);
t('breakMs override accepted', r4.breakMs === 10 * 60 * 1000);
t('forceLogout override accepted', r4.forceLogout === true);
t('extendable override accepted', r4.extendable === false);
t('pauseDuringReality override accepted', r4.pauseDuringReality === false);
t('accentColor override accepted', r4.accentColor === '120,200,255');
t('warningTitle override accepted', r4.warningTitle === 'TAKE A REST');
t('breakTitle override accepted', r4.breakTitle === 'COOLING DOWN');
t('copyContinue override accepted', r4.copyContinue === 'KEEP GOING');
t('copyQuit override accepted', r4.copyQuit === 'SIGN OUT');

/* ────────────────── resolveConfig — malformed / clamping ── */
const m1 = resolveConfig({ sessionTimeout: { enabled: true, maxMs: 1000 } });
t('too-small maxMs clamped to floor (60s)', m1.maxMs === 60 * 1000);

const m2 = resolveConfig({ sessionTimeout: { enabled: true, maxMs: 999999999 } });
t('too-large maxMs clamped to ceiling (24h)', m2.maxMs === 24 * 60 * 60 * 1000);

const m3 = resolveConfig({ sessionTimeout: { enabled: true, breakMs: 100 } });
t('too-small breakMs clamped to floor (30s)', m3.breakMs === 30 * 1000);

const m4 = resolveConfig({ sessionTimeout: { enabled: true, breakMs: 999999999 } });
t('too-large breakMs clamped to ceiling (1h)', m4.breakMs === 60 * 60 * 1000);

/* warnMs > maxMs gets clamped to maxMs */
const m5 = resolveConfig({ sessionTimeout: { enabled: true, maxMs: 120000, warnMs: 500000 } });
t('warnMs clamped to maxMs (cross-bounds)', m5.warnMs === 120000);

/* negative warnMs → clamped to 0 */
const m6 = resolveConfig({ sessionTimeout: { enabled: true, warnMs: -1000 } });
t('negative warnMs clamped to 0', m6.warnMs === 0);

const m7 = resolveConfig({ sessionTimeout: { enabled: true, accentColor: 'bogus' } });
t('malformed accentColor → default retained', m7.accentColor === '255,90,90');

const m8 = resolveConfig({ sessionTimeout: { enabled: true, warningTitle: '' } });
t('empty warningTitle → default retained', m8.warningTitle === 'SESSION TIME WARNING');

const m9 = resolveConfig({ sessionTimeout: { enabled: true, warningTitle: 'x'.repeat(200) } });
t('over-length warningTitle → default retained', m9.warningTitle === 'SESSION TIME WARNING');

/* ────────────────── emit shape — disabled / enabled ─────── */
t('CSS empty when disabled', emitSessionTimeoutCSS(defaultConfig()) === '');
t('Markup empty when disabled', emitSessionTimeoutMarkup(defaultConfig()) === '');
t('Runtime emits stubs when disabled',
  emitSessionTimeoutRuntime(defaultConfig()).includes('window.__SESSION_BREAK_ACTIVE__ = false'));

const css = emitSessionTimeoutCSS(r1);
t('CSS includes .st-overlay', css.includes('.st-overlay'));
t('CSS includes .st-modal', css.includes('.st-modal'));
t('CSS includes .st-btn--quit accent', css.includes('.st-btn--quit'));
t('CSS bakes accentColor', css.includes('255,90,90'));
t('CSS guards prefers-reduced-motion', css.includes('prefers-reduced-motion'));
t('CSS z-index 98 (above realityCheck z 97)', css.includes('z-index: 98'));

const mk = emitSessionTimeoutMarkup(r1);
t('Markup includes #stOverlay', mk.includes('id="stOverlay"'));
t('Markup includes #stCounter (countdown)', mk.includes('id="stCounter"'));
t('Markup includes role="dialog" + aria-modal="true"',
  mk.includes('role="dialog"') && mk.includes('aria-modal="true"'));
t('Markup includes stBtnExtend (default extendable=true)', mk.includes('id="stBtnExtend"'));
t('Markup omits stBtnQuit when forceLogout=false', !mk.includes('id="stBtnQuit"'));

const mkForceLogout = emitSessionTimeoutMarkup(resolveConfig({
  sessionTimeout: { enabled: true, forceLogout: true, extendable: false },
}));
t('Markup includes stBtnQuit when forceLogout=true', mkForceLogout.includes('id="stBtnQuit"'));
t('Markup omits stBtnExtend when extendable=false', !mkForceLogout.includes('id="stBtnExtend"'));

t('Markup XSS: warningTitle escaped',
  emitSessionTimeoutMarkup(resolveConfig({
    sessionTimeout: { enabled: true, warningTitle: '<script>bad</script>' },
  })).includes('&lt;script&gt;'));

const rt = emitSessionTimeoutRuntime(r1);
t('Runtime exposes ST_STATE', rt.includes('window.ST_STATE'));
t('Runtime exposes stShowWarning / stForceTimeout / stResumeFromBreak / stResetSession',
  rt.includes('window.stShowWarning') &&
  rt.includes('window.stForceTimeout') &&
  rt.includes('window.stResumeFromBreak') &&
  rt.includes('window.stResetSession'));
t('Runtime exposes __SESSION_BREAK_ACTIVE__', rt.includes('window.__SESSION_BREAK_ACTIVE__'));
t('Runtime registers preSpin / onAutoplayTick / onRealityCheckPaused / onRealityCheckResumed',
  rt.includes("HookBus.on('preSpin'") &&
  rt.includes("HookBus.on('onAutoplayTick'") &&
  rt.includes("HookBus.on('onRealityCheckPaused'") &&
  rt.includes("HookBus.on('onRealityCheckResumed'"));
t('Runtime emits onSessionWarningShown',  rt.includes("HookBus.emit('onSessionWarningShown'"));
t('Runtime emits onSessionTimeoutFired',  rt.includes("HookBus.emit('onSessionTimeoutFired'"));
t('Runtime emits onSessionResumed',       rt.includes("HookBus.emit('onSessionResumed'"));
t('Runtime emits onSessionExtended',      rt.includes("HookBus.emit('onSessionExtended'"));
t('Runtime emits onSessionLogoutRequested', rt.includes("HookBus.emit('onSessionLogoutRequested'"));

/* ────────────────── determinism ────────────────────────── */
const css2 = emitSessionTimeoutCSS(r1);
t('determinism: identical config → byte-identical CSS', css === css2);
const rt2 = emitSessionTimeoutRuntime(r1);
t('determinism: identical config → byte-identical runtime', rt === rt2);

/* ────────────────── vendor neutrality ─────────────────── */
const VENDOR_RX = /(igt|pragmatic|cash[- ]eruption|wolf[- ]run|cleopatra|buffalo|megaways|netent|microgaming|playtech|scientific games|aristocrat|konami|light\s*&\s*wonder)/i;
const allEmit = css + mk + mkForceLogout + rt;
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
    };
    el.classList = {
      add(c) { set.add(c); },
      remove(c) { set.delete(c); },
      contains(c) { return set.has(c); },
    };
    return el;
  }

  const overlay  = makeEl('div');
  const title    = makeEl('div');
  const body     = makeEl('span');
  const counter  = makeEl('span');
  const meta     = makeEl('span');
  const btnExt   = makeEl('button');
  const btnQuit  = makeEl('button');

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

  overlay.ownerDoc  = doc; overlay.id  = 'stOverlay';
  title.ownerDoc    = doc; title.id    = 'stTitle';
  body.ownerDoc     = doc; body.id     = 'stBodyText';
  counter.ownerDoc  = doc; counter.id  = 'stCounter';
  meta.ownerDoc     = doc; meta.id     = 'stMeta';
  btnExt.ownerDoc   = doc; btnExt.id   = 'stBtnExtend';
  btnQuit.ownerDoc  = doc; btnQuit.id  = 'stBtnQuit';

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
    setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval,
  };
}

/* Tiny config so we can synthesize threshold crossings without waiting:
 * maxMs=60s, warnMs=10s, breakMs=30s, forceLogout=true. */
const testCfg = resolveConfig({
  sessionTimeout: { enabled: true, maxMs: 60 * 1000, warnMs: 10 * 1000, breakMs: 30 * 1000, forceLogout: true },
});
const rtTest = emitSessionTimeoutRuntime(testCfg);

const sandboxWindow = makeSandbox();
const recorded = [];
sandboxWindow.HookBus.on('onSessionWarningShown',    p => recorded.push({ e: 'warning', p }));
sandboxWindow.HookBus.on('onSessionTimeoutFired',    p => recorded.push({ e: 'fired',   p }));
sandboxWindow.HookBus.on('onSessionResumed',         p => recorded.push({ e: 'resumed', p }));
sandboxWindow.HookBus.on('onSessionExtended',        p => recorded.push({ e: 'extended', p }));
sandboxWindow.HookBus.on('onSessionLogoutRequested', p => recorded.push({ e: 'logout',  p }));

const wrap = `
  var window = sandboxWindow;
  var document = window.document;
  var HookBus = window.HookBus;
  var console = window.console;
  var performance = window.performance;
  var setTimeout = window.setTimeout;
  var clearTimeout = window.clearTimeout;
  var setInterval = window.setInterval;
  var clearInterval = window.clearInterval;
  ${rtTest}
`;
new Function('sandboxWindow', wrap)(sandboxWindow);

t('sandbox: ST_STATE.enabled === true', sandboxWindow.ST_STATE.enabled === true);
t('sandbox: __SESSION_BREAK_ACTIVE__ starts false', sandboxWindow.__SESSION_BREAK_ACTIVE__ === false);

/* ── Warning trigger: directly nudge sessionMs past threshold ── */
sandboxWindow.ST_STATE.sessionMs = (60 - 10) * 1000;   /* warnMs threshold hit */
sandboxWindow.ST_STATE.lastTickWall = sandboxWindow.performance.now();
sandboxWindow.HookBus.emit('preSpin');
t('sandbox: warning threshold → onSessionWarningShown fired',
  recorded.filter(e => e.e === 'warning').length === 1);
t('sandbox: warning payload has remainingMs + sessionMs',
  recorded.find(e => e.e === 'warning').p.remainingMs >= 0 &&
  Number.isFinite(recorded.find(e => e.e === 'warning').p.sessionMs));

/* ── Extend flow ── */
recorded.length = 0;
sandboxWindow.document.getElementById('stBtnExtend').click();
t('sandbox: extend click fires onSessionExtended',
  recorded.filter(e => e.e === 'extended').length === 1);
t('sandbox: extend resets sessionMs + warned',
  sandboxWindow.ST_STATE.sessionMs === 0 && sandboxWindow.ST_STATE.warned === false);

/* ── Force timeout flow ── */
recorded.length = 0;
sandboxWindow.ST_STATE.sessionMs = 70 * 1000;   /* > maxMs */
sandboxWindow.ST_STATE.lastTickWall = sandboxWindow.performance.now();
sandboxWindow.HookBus.emit('preSpin');
t('sandbox: hard cap → onSessionTimeoutFired fired',
  recorded.filter(e => e.e === 'fired').length === 1);
t('sandbox: __SESSION_BREAK_ACTIVE__ flipped true', sandboxWindow.__SESSION_BREAK_ACTIVE__ === true);
t('sandbox: fired.breakMs matches config (30s)',
  recorded.find(e => e.e === 'fired').p.breakMs === 30 * 1000);
t('sandbox: fired.forceLogout === true', recorded.find(e => e.e === 'fired').p.forceLogout === true);

/* ── Logout CTA inside force-break ── */
recorded.length = 0;
sandboxWindow.document.getElementById('stBtnQuit').click();
t('sandbox: logout click fires onSessionLogoutRequested',
  recorded.filter(e => e.e === 'logout').length === 1);
/* Fable audit (AL-5.2 high): logout no longer emits the spurious
 * onSessionResumed BEFORE the logout event — that caused a UI flicker
 * (resume re-enabled the slot, then logout tore it down). Break state
 * is still released directly so QA can observe the clean exit. */
t('sandbox: logout flow does NOT emit a spurious onSessionResumed (Fable AL-5.2)',
  recorded.filter(e => e.e === 'resumed').length === 0);
t('sandbox: __SESSION_BREAK_ACTIVE__ released after logout',
  sandboxWindow.__SESSION_BREAK_ACTIVE__ === false);

/* ── Programmatic stResumeFromBreak ── */
recorded.length = 0;
sandboxWindow.ST_STATE.sessionMs = 70 * 1000;
sandboxWindow.stForceTimeout();
sandboxWindow.stResumeFromBreak('manual');
t('sandbox: manual resume → 1 onSessionResumed',
  recorded.filter(e => e.e === 'resumed').length === 1);
t('sandbox: resume.reason === manual',
  recorded.find(e => e.e === 'resumed').p.reason === 'manual');

/* ── stResetSession ── */
sandboxWindow.ST_STATE.sessionMs = 999;
sandboxWindow.ST_STATE.warned = true;
sandboxWindow.stResetSession();
t('sandbox: reset clears sessionMs + warned',
  sandboxWindow.ST_STATE.sessionMs === 0 && sandboxWindow.ST_STATE.warned === false);

/* ── realityCheck-pause integration ── */
recorded.length = 0;
sandboxWindow.HookBus.emit('onRealityCheckPaused', { durationMs: 60000 });
t('sandbox: realityCheck pause flips ST_STATE.paused',
  sandboxWindow.ST_STATE.paused === true);
sandboxWindow.ST_STATE.sessionMs = 70 * 1000;
sandboxWindow.HookBus.emit('preSpin');
t('sandbox: preSpin while paused does NOT fire timeout',
  recorded.filter(e => e.e === 'fired').length === 0);
sandboxWindow.HookBus.emit('onRealityCheckResumed', {});
t('sandbox: realityCheck resume clears ST_STATE.paused',
  sandboxWindow.ST_STATE.paused === false);

/* ── Idempotency: double force-timeout is no-op ── */
recorded.length = 0;
sandboxWindow.stResetSession();
sandboxWindow.stForceTimeout();
sandboxWindow.stForceTimeout();
t('sandbox: double stForceTimeout → only 1 emit',
  recorded.filter(e => e.e === 'fired').length === 1);

/* ── Idempotency: double warning is no-op ── */
recorded.length = 0;
sandboxWindow.stResetSession();
sandboxWindow.ST_STATE.sessionMs = (60 - 5) * 1000;
sandboxWindow.HookBus.emit('preSpin');
sandboxWindow.HookBus.emit('preSpin');
t('sandbox: repeated warning-threshold preSpin → only 1 emit',
  recorded.filter(e => e.e === 'warning').length === 1);

/* ── pauseDuringReality=false branch: no clock pause on realityCheck event ── */
const cfgNoPause = resolveConfig({
  sessionTimeout: { enabled: true, maxMs: 60000, warnMs: 5000, breakMs: 30000, pauseDuringReality: false },
});
const rtNoPause = emitSessionTimeoutRuntime(cfgNoPause);
const sb2 = makeSandbox();
const wrap2 = `
  var window = sandboxWindow;
  var document = window.document;
  var HookBus = window.HookBus;
  var console = window.console;
  var performance = window.performance;
  var setTimeout = window.setTimeout;
  var clearTimeout = window.clearTimeout;
  var setInterval = window.setInterval;
  var clearInterval = window.clearInterval;
  ${rtNoPause}
`;
new Function('sandboxWindow', wrap2)(sb2);
sb2.HookBus.emit('onRealityCheckPaused', { durationMs: 60000 });
t('sandbox(pauseDuringReality=false): paused stays false even after realityCheck pause',
  sb2.ST_STATE.paused === false);

/* Cleanup — close any timers held by sandbox runs so node exits cleanly. */
sandboxWindow.stResetSession();
if (sb2.stResetSession) sb2.stResetSession();

console.log('\n--- summary ---');
console.log('  pass:', pass);
console.log('  fail:', fail);
if (fail > 0) process.exit(1);
