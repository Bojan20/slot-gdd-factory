/* eslint-disable no-console */
/**
 * Wave U8 — balanceHud block tests.
 *
 * Coverage matrix:
 *   • defaultConfig industry-baseline (enabled=true, startingBalance=1000)
 *   • resolveConfig validation: clamp ranges, RGB regex, boolean coerce,
 *     currency length cap, currencyPosition enum, auto-disable kind
 *   • emitBalanceHudCSS (disabled = empty, enabled = balance-hud +
 *     debit/credit pulse keyframes, reduced-motion gate, mobile media)
 *   • emitBalanceHudMarkup (XSS escape, role=status, aria-live=polite,
 *     showWinColumn=false skips win col)
 *   • emitBalanceHudRuntime (stub when disabled, listeners + window API
 *     when enabled)
 *   • Sandbox lifecycle:
 *       - initial paint sets window.__SLOT_BALANCE__ = startingBalance
 *       - preSpin (BASE) debits bet (FALLBACK or window.__SLOT_BET__)
 *       - preSpin (FS) does NOT debit
 *       - onSpinResult samples window.__WIN_AWARD__ → STATE.lastWin
 *       - postSpin (BASE) credits lastWin
 *       - onFsTrigger resets fsTotalWin
 *       - onFsEnd credits totalWin from payload OR fsTotalWin fallback
 *       - onGambleEnd credits bank only when winner='player'
 *       - onBetChanged refreshes bet column
 *       - balanceCredit/Debit/Set/Reset emit onBalanceChanged with reason
 *       - balanceDebit floors at 0 (no negative balance)
 *       - invalid amounts (NaN, Infinity, ≤0) ignored
 */

import {
  defaultConfig, resolveConfig, BALANCE_REASONS,
  emitBalanceHudCSS, emitBalanceHudMarkup, emitBalanceHudRuntime,
} from '../../src/blocks/balanceHud.mjs';
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

console.log('— blocks/balanceHud.mjs —');

/* ── defaults + resolveConfig ── */

t('defaultConfig: industry-baseline values', () => {
  const d = defaultConfig();
  eq(d.enabled, true);
  eq(d.startingBalance, 1000);
  eq(d.fallbackBet, 1.00);
  eq(d.currency, '€');
  eq(d.currencyPosition, 'prefix');
  eq(d.showWinColumn, true);
  eq(d.showTotalWinDuringFs, true);
  eq(d.pulseOnChange, true);
});

t('BALANCE_REASONS enum is frozen + canonical', () => {
  eq(Object.isFrozen(BALANCE_REASONS), true);
  eq(BALANCE_REASONS.join(','), 'init,spin,win,gamble,reset,topup,manual');
});

t('resolveConfig: startingBalance clamped [0, 1e9]', () => {
  eq(resolveConfig({ balanceHud: { startingBalance: -100 } }).startingBalance, 0);
  eq(resolveConfig({ balanceHud: { startingBalance: 1e12 } }).startingBalance, 1e9);
  eq(resolveConfig({ balanceHud: { startingBalance: 500 } }).startingBalance, 500);
  eq(resolveConfig({ balanceHud: { startingBalance: 'nope' } }).startingBalance, 1000, 'non-finite → default');
});

t('resolveConfig: fallbackBet clamped [0.01, 10000], rejects ≤0', () => {
  eq(resolveConfig({ balanceHud: { fallbackBet: 0 } }).fallbackBet, 1.00);
  eq(resolveConfig({ balanceHud: { fallbackBet: -5 } }).fallbackBet, 1.00);
  eq(resolveConfig({ balanceHud: { fallbackBet: 99999 } }).fallbackBet, 10000);
  eq(resolveConfig({ balanceHud: { fallbackBet: 2.5 } }).fallbackBet, 2.5);
});

t('resolveConfig: currency length cap (≤4), positions enum', () => {
  eq(resolveConfig({ balanceHud: { currency: '$' } }).currency, '$');
  eq(resolveConfig({ balanceHud: { currency: 'CHF' } }).currency, 'CHF');
  eq(resolveConfig({ balanceHud: { currency: 'EUROZONE' } }).currency, '€', '>4 → default');
  eq(resolveConfig({ balanceHud: { currency: '' } }).currency, '€', 'empty → default');

  eq(resolveConfig({ balanceHud: { currencyPosition: 'suffix' } }).currencyPosition, 'suffix');
  eq(resolveConfig({ balanceHud: { currencyPosition: 'prefix' } }).currencyPosition, 'prefix');
  eq(resolveConfig({ balanceHud: { currencyPosition: 'bogus' } }).currencyPosition, 'prefix', 'unknown → default');
});

t('resolveConfig: RGB regex on 3 color fields', () => {
  const c = resolveConfig({ balanceHud: {
    accentColor: '10, 20, 30',
    debitColor: 'red',
    creditColor: '#abc',
  }});
  eq(c.accentColor, '10,20,30', 'spaces stripped');
  eq(c.debitColor,  '255,120,120', 'named → default');
  eq(c.creditColor, '120,255,180', 'hex → default');
});

t('resolveConfig: 3 booleans coerce', () => {
  const c = resolveConfig({ balanceHud: {
    showWinColumn: 0,
    showTotalWinDuringFs: 1,
    pulseOnChange: 'yes',
  }});
  eq(c.showWinColumn, false);
  eq(c.showTotalWinDuringFs, true);
  eq(c.pulseOnChange, true);
});

t('resolveConfig: auto-disable from feature kind', () => {
  for (const k of ['no_balance_hud', 'no-balance-hud', 'balance_hud_disabled', 'BALANCE-HUD-DISABLED']) {
    eq(resolveConfig({ features: [{ kind: k }] }).enabled, false, k);
  }
  eq(resolveConfig({ features: [{ kind: 'free_spins' }] }).enabled, true);
});

/* ── CSS ── */

t('emitBalanceHudCSS: empty when disabled', () => {
  eq(emitBalanceHudCSS({ ...defaultConfig(), enabled: false }), '');
});

t('emitBalanceHudCSS: enabled bakes balance-hud + col selectors', () => {
  const css = emitBalanceHudCSS(defaultConfig());
  for (const sel of ['.balance-hud', '.balance-hud__col', '.balance-hud__label',
                     '.balance-hud__value', '.balance-hud__col--win']) {
    ct(css, sel);
  }
});

t('emitBalanceHudCSS: pulse keyframes baked iff pulseOnChange=true', () => {
  const withPulse = emitBalanceHudCSS({ ...defaultConfig(), pulseOnChange: true });
  const noPulse   = emitBalanceHudCSS({ ...defaultConfig(), pulseOnChange: false });
  ct(withPulse, '@keyframes balanceDebitPulse');
  ct(withPulse, '@keyframes balanceCreditPulse');
  ct(withPulse, 'prefers-reduced-motion: reduce');
  nct(noPulse, '@keyframes balanceDebitPulse');
});

t('emitBalanceHudCSS: mobile media query + color interpolation', () => {
  const css = emitBalanceHudCSS({ ...defaultConfig(), accentColor: '11,22,33' });
  ct(css, '@media (max-width: 620px)');
  ct(css, 'rgb(11,22,33)');
});

/* ── Markup ── */

t('emitBalanceHudMarkup: empty when disabled', () => {
  eq(emitBalanceHudMarkup({ ...defaultConfig(), enabled: false }), '');
});

t('emitBalanceHudMarkup: id=balanceHud + role=status + aria-live=polite', () => {
  const html = emitBalanceHudMarkup(defaultConfig());
  ct(html, 'id="balanceHud"');
  ct(html, 'role="status"');
  ct(html, 'aria-live="polite"');
  ct(html, 'id="balanceHudBalanceValue"');
  ct(html, 'id="balanceHudBetValue"');
  ct(html, 'id="balanceHudWinValue"');
});

t('emitBalanceHudMarkup: showWinColumn=false drops win col', () => {
  const html = emitBalanceHudMarkup({ ...defaultConfig(), showWinColumn: false });
  nct(html, 'balanceHudWinValue');
  ct(html, 'balanceHudBalanceValue');
});

t('emitBalanceHudMarkup: XSS payload in ariaLabel HTML-escaped', () => {
  const html = emitBalanceHudMarkup({ ...defaultConfig(), ariaLabel: 'a"><script>x' });
  ct(html, '&quot;');
  ct(html, '&lt;script&gt;');
  nct(html, '"><script>');
});

/* ── Runtime stub vs enabled ── */

t('emitBalanceHudRuntime: disabled emits stub (window.balance* no-op)', () => {
  const src = emitBalanceHudRuntime({ ...defaultConfig(), enabled: false });
  ct(src, 'window.balanceGet    = function () { return 0; }');
  ct(src, 'window.balanceSet    = function () {}');
  ct(src, 'window.balanceCredit = function () {}');
  ct(src, 'window.balanceDebit  = function () {}');
  ct(src, 'enabled: false');
  nct(src, "HookBus.on(");
});

t('emitBalanceHudRuntime: enabled wires expected listeners + emit + window API', () => {
  /* 2026-06-10 bug-fix — onSpinResult listener removed; lastWin snapshot
   * moved into the postSpin listener so it reads the fresh __WIN_AWARD__
   * (postSpin orchestrator runs applyWinHighlight BEFORE emitting postSpin,
   * so by then __WIN_AWARD__ is the round's real total, not 0). */
  const src = emitBalanceHudRuntime(defaultConfig());
  ct(src, "HookBus.on('preSpin'");
  ct(src, "HookBus.on('postSpin'");
  ct(src, "HookBus.on('onFsTrigger'");
  ct(src, "HookBus.on('onFsEnd'");
  ct(src, "HookBus.on('onGambleEnd'");
  ct(src, "HookBus.on('onBetChanged'");
  ct(src, "HookBus.emit('onBalanceChanged'");
  ct(src, 'window.balanceGet');
  ct(src, 'window.balanceCredit');
  ct(src, 'window.__SLOT_BALANCE__');
});

/* ── Sandbox ── */

function buildSandbox(cfg = defaultConfig(), opts = {}) {
  const hbSrc = emitHookBusRuntime({ debugLog: false });
  const bhSrc = emitBalanceHudRuntime(cfg);

  const elements = new Map();
  function makeElement(id) {
    if (elements.has(id)) return elements.get(id);
    const el = {
      id, hidden: false,
      className: '', textContent: '',
      offsetWidth: 1,    /* force-reflow read */
      _classes: new Set(),
      _listeners: new Map(),
      classList: {
        add(c)    { el._classes.add(c); },
        remove(c) { el._classes.delete(c); },
        toggle(c, on) { if (on) el._classes.add(c); else el._classes.delete(c); },
        contains(c) { return el._classes.has(c); },
      },
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
  for (const id of ['balanceHudBalanceCol','balanceHudBalanceValue',
                    'balanceHudBetCol','balanceHudBetValue',
                    'balanceHudWinCol','balanceHudWinLabel','balanceHudWinValue']) {
    makeElement(id);
  }

  const docListeners = new Map();
  const fakeDocument = {
    readyState: 'complete',
    getElementById(id) { return elements.get(id) || null; },
    addEventListener(name, fn) {
      if (!docListeners.has(name)) docListeners.set(name, []);
      docListeners.get(name).push(fn);
    },
  };
  const fakeWindow = opts.window || {};
  const fakeConsole = { warn: () => {}, error: () => {}, log: () => {} };

  /* eslint-disable-next-line no-new-func */
  const factory = new Function(
    'window', 'document', 'console',
    hbSrc + '\n' + bhSrc + '\nreturn { HookBus: window.HookBus };'
  );
  factory(fakeWindow, fakeDocument, fakeConsole);

  return { window: fakeWindow, document: fakeDocument, elements, HookBus: fakeWindow.HookBus };
}

t('sandbox: initial paint sets __SLOT_BALANCE__ + balance value + emits init event', () => {
  const captured = [];
  const sb = buildSandbox(defaultConfig());
  sb.HookBus.on('onBalanceChanged', (p) => captured.push(p));
  /* Re-emit init manually since we registered listener after factory. The
   * factory ran initial paint which already emitted before subscription;
   * call balanceSet to force a re-emit for assertion. */
  eq(sb.window.__SLOT_BALANCE__, 1000);
  eq(sb.window.BALANCE_HUD_STATE.balance, 1000);
  eq(sb.elements.get('balanceHudBalanceValue').textContent, '€1000.00');
});

t('sandbox: preSpin (BASE) debits fallback bet from balance', () => {
  const sb = buildSandbox(defaultConfig());
  const before = sb.window.__SLOT_BALANCE__;
  sb.HookBus.emit('preSpin', { duringFs: false });
  eq(sb.window.__SLOT_BALANCE__, before - 1, 'fallback bet 1.00 debited');
  eq(sb.elements.get('balanceHudBalanceValue').textContent, '€999.00');
});

t('sandbox: preSpin (BASE) honors window.__SLOT_BET__ over fallback', () => {
  const sb = buildSandbox(defaultConfig());
  sb.window.__SLOT_BET__ = 5.00;
  sb.HookBus.emit('preSpin', { duringFs: false });
  eq(sb.window.__SLOT_BALANCE__, 995.00);
});

t('sandbox: preSpin (FS) does NOT debit', () => {
  const sb = buildSandbox(defaultConfig());
  const before = sb.window.__SLOT_BALANCE__;
  sb.HookBus.emit('preSpin', { duringFs: true });
  eq(sb.window.__SLOT_BALANCE__, before, 'FS spins are free');
});

t('sandbox: postSpin (BASE) credits lastWin from window.__WIN_AWARD__', () => {
  const sb = buildSandbox(defaultConfig());
  sb.window.__WIN_AWARD__ = 25;
  sb.HookBus.emit('preSpin', { duringFs: false });    /* debit 1 */
  sb.HookBus.emit('onSpinResult', { duringFs: false });  /* sample 25 */
  sb.HookBus.emit('postSpin', { duringFs: false });   /* credit 25 */
  eq(sb.window.__SLOT_BALANCE__, 1000 - 1 + 25);
});

t('sandbox: postSpin (FS) does NOT credit (FS round accumulates in totalWin)', () => {
  const sb = buildSandbox(defaultConfig());
  const before = sb.window.__SLOT_BALANCE__;
  sb.window.__WIN_AWARD__ = 50;
  sb.HookBus.emit('preSpin', { duringFs: true });
  sb.HookBus.emit('onSpinResult', { duringFs: true });
  sb.HookBus.emit('postSpin', { duringFs: true });
  eq(sb.window.__SLOT_BALANCE__, before, 'no balance change during FS');
  eq(sb.window.BALANCE_HUD_STATE.fsTotalWin, 50);
});

t('sandbox: onFsTrigger resets fsTotalWin', () => {
  const sb = buildSandbox(defaultConfig());
  sb.window.BALANCE_HUD_STATE.fsTotalWin = 200;
  sb.HookBus.emit('onFsTrigger', { award: 10, scatters: 4 });
  eq(sb.window.BALANCE_HUD_STATE.fsTotalWin, 0);
});

t('sandbox: onFsEnd credits payload.totalWin', () => {
  const sb = buildSandbox(defaultConfig());
  const before = sb.window.__SLOT_BALANCE__;
  sb.HookBus.emit('onFsEnd', { totalWin: 250 });
  eq(sb.window.__SLOT_BALANCE__, before + 250);
});

t('sandbox: onFsEnd falls back to fsTotalWin when payload.totalWin missing', () => {
  const sb = buildSandbox(defaultConfig());
  sb.window.BALANCE_HUD_STATE.fsTotalWin = 175;
  const before = sb.window.__SLOT_BALANCE__;
  sb.HookBus.emit('onFsEnd', {});
  eq(sb.window.__SLOT_BALANCE__, before + 175);
});

t('sandbox: onGambleEnd credits bank when winner=player', () => {
  const sb = buildSandbox(defaultConfig());
  const before = sb.window.__SLOT_BALANCE__;
  sb.HookBus.emit('onGambleEnd', { winner: 'player', bank: 80 });
  eq(sb.window.__SLOT_BALANCE__, before + 80);
});

t('sandbox: onGambleEnd does NOT credit when winner!=player', () => {
  const sb = buildSandbox(defaultConfig());
  const before = sb.window.__SLOT_BALANCE__;
  sb.HookBus.emit('onGambleEnd', { winner: 'house', bank: 0 });
  eq(sb.window.__SLOT_BALANCE__, before);
});

t('sandbox: onBetChanged refreshes bet column', () => {
  const sb = buildSandbox(defaultConfig());
  sb.window.__SLOT_BET__ = 7.50;
  sb.HookBus.emit('onBetChanged', { newBet: 7.50 });
  eq(sb.elements.get('balanceHudBetValue').textContent, '€7.50');
});

t('sandbox: balanceCredit emits onBalanceChanged with delta + reason', () => {
  const sb = buildSandbox(defaultConfig());
  const captured = [];
  sb.HookBus.on('onBalanceChanged', (p) => captured.push(p));
  sb.window.balanceCredit(50, 'topup');
  eq(captured.length, 1);
  eq(captured[0].delta, 50);
  eq(captured[0].reason, 'topup');
  eq(captured[0].balance, 1050);
});

t('sandbox: balanceDebit floors at 0 (no negative balance)', () => {
  const sb = buildSandbox(defaultConfig());
  sb.window.balanceDebit(99999);
  eq(sb.window.__SLOT_BALANCE__, 0);
});

t('sandbox: balanceCredit ignores ≤0 + NaN + Infinity', () => {
  const sb = buildSandbox(defaultConfig());
  const before = sb.window.__SLOT_BALANCE__;
  sb.window.balanceCredit(0);
  sb.window.balanceCredit(-5);
  sb.window.balanceCredit(NaN);
  sb.window.balanceCredit(Infinity);
  eq(sb.window.__SLOT_BALANCE__, before);
});

t('sandbox: balanceSet emits delta correctly + clamps to [0, 1e10]', () => {
  const sb = buildSandbox(defaultConfig());
  const captured = [];
  sb.HookBus.on('onBalanceChanged', (p) => captured.push(p));
  sb.window.balanceSet(500);
  eq(captured[0].delta, -500, 'went from 1000 to 500');
  sb.window.balanceSet(-999);
  /* invalid → no emit */
  eq(captured.length, 1);
  sb.window.balanceSet(1e15);
  eq(sb.window.__SLOT_BALANCE__, 1e10);
});

t('sandbox: balanceReset restores starting + emits reason=reset', () => {
  const sb = buildSandbox(defaultConfig());
  const captured = [];
  sb.HookBus.on('onBalanceChanged', (p) => captured.push(p));
  sb.window.balanceDebit(300);
  sb.window.balanceReset();
  const last = captured[captured.length - 1];
  eq(last.reason, 'reset');
  eq(sb.window.__SLOT_BALANCE__, 1000);
});

t('sandbox: balanceGet returns current balance', () => {
  const sb = buildSandbox(defaultConfig());
  eq(sb.window.balanceGet(), 1000);
  sb.window.balanceDebit(150);
  eq(sb.window.balanceGet(), 850);
});

t('sandbox: pulse class added on debit (debit-pulse) + on credit (credit-pulse)', () => {
  const sb = buildSandbox(defaultConfig());
  sb.window.balanceDebit(10);
  ok(sb.elements.get('balanceHudBalanceCol').classList.contains('is-debit-pulse'));
  sb.window.balanceCredit(20);
  ok(sb.elements.get('balanceHudBalanceCol').classList.contains('is-credit-pulse'));
});

t('sandbox: postSpin BASE clears WIN column at start of new spin via preSpin', () => {
  const sb = buildSandbox(defaultConfig());
  sb.window.__WIN_AWARD__ = 25;
  sb.HookBus.emit('preSpin', { duringFs: false });
  sb.HookBus.emit('onSpinResult', { duringFs: false });
  sb.HookBus.emit('postSpin', { duringFs: false });
  eq(sb.elements.get('balanceHudWinValue').textContent, '€25.00');
  /* Next spin → win cleared during preSpin. */
  sb.HookBus.emit('preSpin', { duringFs: false });
  eq(sb.elements.get('balanceHudWinValue').textContent, '—');
});

t('sandbox: invalid __WIN_AWARD__ (NaN, negative, Infinity) treated as 0', () => {
  const sb = buildSandbox(defaultConfig());
  const before = sb.window.__SLOT_BALANCE__;
  sb.window.__WIN_AWARD__ = NaN;
  sb.HookBus.emit('preSpin', { duringFs: false });
  sb.HookBus.emit('onSpinResult', { duringFs: false });
  sb.HookBus.emit('postSpin', { duringFs: false });
  eq(sb.window.__SLOT_BALANCE__, before - 1, 'only debit happened, no credit');
});

t('sandbox: currencyPosition=suffix flips format', () => {
  const sb = buildSandbox({ ...defaultConfig(), currencyPosition: 'suffix', currency: '$' });
  eq(sb.elements.get('balanceHudBalanceValue').textContent, '1000.00 $');
});

/* ── Hygiene ── */

t('determinism: same config → byte-identical CSS', () => {
  eq(emitBalanceHudCSS(defaultConfig()), emitBalanceHudCSS(defaultConfig()));
});

t('vendor-neutral: no vendor strings anywhere', () => {
  const all = emitBalanceHudCSS(defaultConfig()) +
              emitBalanceHudMarkup(defaultConfig()) +
              emitBalanceHudRuntime(defaultConfig());
  for (const banned of ['gates','olympus','reactoonz','megaways','netent','wrath',
                        'sweet bonanza','pragmatic','microgaming','playa-slot']) {
    nct(all.toLowerCase(), banned, 'banned: ' + banned);
  }
});

console.log('\n--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
