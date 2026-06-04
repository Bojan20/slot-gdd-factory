/* eslint-disable no-console */
/**
 * Wave U9 — historyLog block tests.
 *
 * Coverage matrix:
 *   • defaultConfig + HISTORY_MODES enum
 *   • resolveConfig: capacity clamp, timeFormat enum, chipLabel cap,
 *     RGB regex on 4 color fields, boolean coercion, auto-disable kind
 *   • emitHistoryLogCSS (disabled = empty, enabled = button + backdrop +
 *     panel + table + slide-up keyframe + reduced-motion gate + mobile)
 *   • emitHistoryLogMarkup (XSS escape, hidden backdrop, role=dialog,
 *     aria-modal, CSV button gated by allowCsvExport, showTime=false
 *     drops time col)
 *   • emitHistoryLogRuntime (stub when disabled, listeners + window API)
 *   • Sandbox lifecycle: ring buffer overflow caps at capacity, BASE
 *     postSpin pushes base entry, FS spins skip, onFsEnd pushes single
 *     fs entry with totalWin, onGambleEnd pushes gamble entry only when
 *     winner=player counts, clear empties, getEntries returns snapshot,
 *     csv exports with right schema, auto-hide on preSpin/onFsTrigger/
 *     onAutoplayStart, escape closes
 */

import {
  defaultConfig, resolveConfig, HISTORY_MODES,
  emitHistoryLogCSS, emitHistoryLogMarkup, emitHistoryLogRuntime,
} from '../../src/blocks/historyLog.mjs';
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

console.log('— blocks/historyLog.mjs —');

/* ── defaults + resolveConfig ── */

t('defaultConfig: industry-baseline values', () => {
  const d = defaultConfig();
  eq(d.enabled, true);
  eq(d.capacity, 50);
  eq(d.allowCsvExport, false);
  eq(d.showTime, true);
  eq(d.timeFormat, 'hms');
  eq(d.chipLabel, '≡');
  eq(d.closeOnBackdrop, true);
  eq(d.closeOnEscape, true);
  eq(d.autoHideOnSpin, true);
});

t('HISTORY_MODES enum is frozen + canonical', () => {
  eq(Object.isFrozen(HISTORY_MODES), true);
  eq(HISTORY_MODES.join(','), 'base,fs,gamble');
});

t('resolveConfig: capacity clamped [1, 500]', () => {
  eq(resolveConfig({ historyLog: { capacity: 0 } }).capacity, 1);
  eq(resolveConfig({ historyLog: { capacity: 99999 } }).capacity, 500);
  eq(resolveConfig({ historyLog: { capacity: 100 } }).capacity, 100);
  eq(resolveConfig({ historyLog: { capacity: 'nope' } }).capacity, 50, 'non-finite → default');
});

t('resolveConfig: timeFormat enum + fallback', () => {
  eq(resolveConfig({ historyLog: { timeFormat: 'iso' } }).timeFormat, 'iso');
  eq(resolveConfig({ historyLog: { timeFormat: 'rel' } }).timeFormat, 'rel');
  eq(resolveConfig({ historyLog: { timeFormat: 'bogus' } }).timeFormat, 'hms');
});

t('resolveConfig: chipLabel length cap (≤4)', () => {
  eq(resolveConfig({ historyLog: { chipLabel: '📜' } }).chipLabel, '📜');
  eq(resolveConfig({ historyLog: { chipLabel: 'LOG' } }).chipLabel, 'LOG');
  eq(resolveConfig({ historyLog: { chipLabel: 'TOOLONG' } }).chipLabel, '≡');
});

t('resolveConfig: RGB regex on 4 color fields', () => {
  const c = resolveConfig({ historyLog: {
    chipColor: '1,2,3', chipTextColor: 'red',
    panelBgColor: '4, 5, 6', panelAccentColor: '#abc',
  }});
  eq(c.chipColor, '1,2,3');
  eq(c.panelBgColor, '4,5,6');
  eq(c.chipTextColor, '255,230,168', 'rejected → default');
  eq(c.panelAccentColor, '201,162,39', 'hex rejected');
});

t('resolveConfig: 4 booleans coerce', () => {
  const c = resolveConfig({ historyLog: {
    allowCsvExport: 1,
    showTime: 0,
    closeOnBackdrop: 'no',
    autoHideOnSpin: null,
  }});
  eq(c.allowCsvExport, true);
  eq(c.showTime, false);
  eq(c.closeOnBackdrop, true, 'no is truthy string → coerced true (intentional)');
  eq(c.autoHideOnSpin, true, 'null → no-op → stays default');
});

t('resolveConfig: auto-disable from feature kind', () => {
  for (const k of ['no_history_log', 'no-history-log', 'history_disabled', 'HISTORY-DISABLED']) {
    eq(resolveConfig({ features: [{ kind: k }] }).enabled, false, k);
  }
  eq(resolveConfig({ features: [{ kind: 'free_spins' }] }).enabled, true);
});

/* ── CSS ── */

t('emitHistoryLogCSS: empty when disabled', () => {
  eq(emitHistoryLogCSS({ ...defaultConfig(), enabled: false }), '');
});

t('emitHistoryLogCSS: enabled bakes button + backdrop + panel + table selectors', () => {
  const css = emitHistoryLogCSS(defaultConfig());
  for (const sel of ['.history-btn', '.history-backdrop', '.history-panel',
                     '.history-table', '.history-action', '.history-close',
                     '.history-empty', '@keyframes history-slide-up',
                     '@media (prefers-reduced-motion: reduce)']) {
    ct(css, sel);
  }
  ct(css, 'z-index: 40');
});

t('emitHistoryLogCSS: mobile media query baked', () => {
  ct(emitHistoryLogCSS(defaultConfig()), '@media (max-width: 480px)');
});

/* ── Markup ── */

t('emitHistoryLogMarkup: empty when disabled', () => {
  eq(emitHistoryLogMarkup({ ...defaultConfig(), enabled: false }), '');
});

t('emitHistoryLogMarkup: button + backdrop + dialog role + close button', () => {
  const html = emitHistoryLogMarkup(defaultConfig());
  ct(html, 'id="historyBtn"');
  ct(html, 'id="historyBackdrop"');
  ct(html, 'hidden');
  ct(html, 'role="dialog"');
  ct(html, 'aria-modal="true"');
  ct(html, 'id="historyCloseBtn"');
  ct(html, 'id="historyClearBtn"');
});

t('emitHistoryLogMarkup: CSV button gated by allowCsvExport', () => {
  const off = emitHistoryLogMarkup(defaultConfig());
  const on  = emitHistoryLogMarkup({ ...defaultConfig(), allowCsvExport: true });
  nct(off, 'historyExportBtn');
  ct(on, 'id="historyExportBtn"');
});

t('emitHistoryLogMarkup: showTime=false drops Time column', () => {
  const html = emitHistoryLogMarkup({ ...defaultConfig(), showTime: false });
  nct(html, '>Time<');
  ct(html, '>Bet<');
});

t('emitHistoryLogMarkup: XSS payload in label + aria escaped', () => {
  const html = emitHistoryLogMarkup({
    ...defaultConfig(),
    chipLabel: '<x>',
    ariaLabel: 'a"><script>x',
  });
  ct(html, '&lt;x&gt;');
  ct(html, '&quot;');
  ct(html, '&lt;script&gt;');
});

/* ── Runtime stub vs enabled ── */

t('emitHistoryLogRuntime: disabled emits stub', () => {
  const src = emitHistoryLogRuntime({ ...defaultConfig(), enabled: false });
  ct(src, 'window.historyLogShow       = function () {}');
  ct(src, 'window.historyLogGetEntries = function () { return []; }');
  ct(src, 'window.historyLogExportCsv  = function () { return \'\'; }');
  nct(src, "HookBus.on(");
});

t('emitHistoryLogRuntime: enabled wires 7 listeners + window API', () => {
  const src = emitHistoryLogRuntime(defaultConfig());
  ct(src, "HookBus.on('preSpin'");
  ct(src, "HookBus.on('onFsTrigger'");
  ct(src, "HookBus.on('postSpin'");
  ct(src, "HookBus.on('onFsEnd'");
  ct(src, "HookBus.on('onGambleEnd'");
  ct(src, "HookBus.on('onBalanceChanged'");
  ct(src, "HookBus.on('onAutoplayStart'");
  ct(src, 'window.historyLogShow');
});

/* ── Sandbox ── */

function buildSandbox(cfg = defaultConfig(), opts = {}) {
  const hbSrc = emitHookBusRuntime({ debugLog: false });
  const hlSrc = emitHistoryLogRuntime(cfg);

  const elements = new Map();
  function makeElement(id) {
    if (elements.has(id)) return elements.get(id);
    const el = {
      id, hidden: id === 'historyBackdrop',
      className: '', textContent: '', innerHTML: '',
      style: { display: '' },
      _classes: new Set(), _attrs: {}, _listeners: new Map(),
      classList: {
        add(c){ el._classes.add(c); }, remove(c){ el._classes.delete(c); },
        toggle(c, on){ if (on) el._classes.add(c); else el._classes.delete(c); },
        contains(c){ return el._classes.has(c); },
      },
      setAttribute(k, v){ el._attrs[k] = v; }, getAttribute(k){ return el._attrs[k]; },
      addEventListener(name, fn){
        if (!el._listeners.has(name)) el._listeners.set(name, []);
        el._listeners.get(name).push(fn);
      },
      removeEventListener(){},
      focus(){ el._focused = true; },
      click(){ for (const fn of (el._listeners.get('click') || [])) fn({ target: el }); },
      _fire(name, ev){ for (const fn of (el._listeners.get(name) || [])) fn(ev || { target: el }); },
    };
    elements.set(id, el);
    return el;
  }
  for (const id of ['historyBtn','historyBackdrop','historyPanel','historyTable',
                    'historyTableBody','historyEmpty','historyCloseBtn',
                    'historyClearBtn','historyExportBtn']) {
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
    body: { appendChild() {}, removeChild() {} },
    createElement() { return { href: '', download: '', click() {} }; },
    _fireDoc(name, ev) { for (const fn of (docListeners.get(name) || [])) fn(ev); },
  };
  const fakeWindow = opts.window || {};
  const fakeConsole = { warn: () => {}, error: () => {}, log: () => {} };

  /* eslint-disable-next-line no-new-func */
  const factory = new Function(
    'window', 'document', 'console', 'setTimeout', 'clearTimeout', 'Date', 'Blob', 'URL',
    hbSrc + '\n' + hlSrc + '\nreturn { HookBus: window.HookBus };'
  );
  const FakeBlob = function () {};
  const FakeURL = { createObjectURL: () => 'blob://x', revokeObjectURL: () => {} };
  factory(fakeWindow, fakeDocument, fakeConsole, setTimeout, clearTimeout, Date, FakeBlob, FakeURL);

  return { window: fakeWindow, document: fakeDocument, elements, docListeners, HookBus: fakeWindow.HookBus };
}

t('sandbox: postSpin (BASE) pushes base entry with bet, win, balance', () => {
  const sb = buildSandbox(defaultConfig());
  sb.window.__SLOT_BET__    = 2.50;
  sb.window.__SLOT_BALANCE__ = 1000;
  sb.HookBus.emit('preSpin', { duringFs: false });
  sb.window.__SLOT_BALANCE__ = 997.50;  /* simulating balanceHud debit */
  sb.window.__WIN_AWARD__   = 7.50;
  sb.window.__SLOT_BALANCE__ = 1005;    /* simulating credit */
  sb.HookBus.emit('postSpin', { duringFs: false });
  const e = sb.window.historyLogGetEntries();
  eq(e.length, 1);
  eq(e[0].mode, 'base');
  eq(e[0].bet, 2.50);
  eq(e[0].win, 7.50);
  eq(e[0].balanceBefore, 1000, 'snapshotted via preSpin');
  eq(e[0].balanceAfter, 1005);
});

t('sandbox: postSpin (FS) does NOT push base entry', () => {
  const sb = buildSandbox(defaultConfig());
  sb.window.__SLOT_BET__    = 1;
  sb.window.__SLOT_BALANCE__ = 1000;
  sb.HookBus.emit('postSpin', { duringFs: true });
  eq(sb.window.historyLogGetEntries().length, 0);
});

t('sandbox: onFsEnd pushes single fs entry with totalWin', () => {
  const sb = buildSandbox(defaultConfig());
  sb.window.__SLOT_BALANCE__ = 1000;
  sb.HookBus.emit('onFsTrigger', { award: 10, scatters: 4 });
  sb.window.__SLOT_BALANCE__ = 1250;
  sb.HookBus.emit('onFsEnd', { totalWin: 250 });
  const e = sb.window.historyLogGetEntries();
  eq(e.length, 1);
  eq(e[0].mode, 'fs');
  eq(e[0].bet, 0);
  eq(e[0].win, 250);
  eq(e[0].fsTotal, 250);
  eq(e[0].balanceBefore, 1000);
  eq(e[0].balanceAfter, 1250);
});

t('sandbox: onGambleEnd pushes gamble entry when winner=player', () => {
  const sb = buildSandbox(defaultConfig());
  sb.window.__SLOT_BALANCE__ = 1080;
  sb.HookBus.emit('onGambleEnd', { winner: 'player', stake: 10, bank: 80 });
  const e = sb.window.historyLogGetEntries();
  eq(e.length, 1);
  eq(e[0].mode, 'gamble');
  eq(e[0].bet, 10);
  eq(e[0].win, 80);
});

t('sandbox: onGambleEnd loss (winner=house) still logs the entry (bank=0)', () => {
  const sb = buildSandbox(defaultConfig());
  sb.window.__SLOT_BALANCE__ = 1000;
  sb.HookBus.emit('onGambleEnd', { winner: 'house', stake: 10, bank: 0 });
  const e = sb.window.historyLogGetEntries();
  eq(e.length, 1);
  eq(e[0].win, 0);
});

t('sandbox: ring buffer caps at capacity', () => {
  const sb = buildSandbox({ ...defaultConfig(), capacity: 3 });
  sb.window.__SLOT_BET__ = 1;
  sb.window.__SLOT_BALANCE__ = 1000;
  for (let i = 0; i < 5; i++) {
    sb.HookBus.emit('preSpin', { duringFs: false });
    sb.window.__WIN_AWARD__ = 0;
    sb.HookBus.emit('postSpin', { duringFs: false });
  }
  const e = sb.window.historyLogGetEntries();
  eq(e.length, 3, 'overflow shifted out');
  eq(e[0].id, 3, 'oldest dropped → first kept is id #3');
  eq(e[2].id, 5);
});

t('sandbox: monotonic IDs (1, 2, 3, ...)', () => {
  const sb = buildSandbox(defaultConfig());
  sb.window.__SLOT_BALANCE__ = 1000;
  for (let i = 0; i < 3; i++) {
    sb.HookBus.emit('preSpin', { duringFs: false });
    sb.HookBus.emit('postSpin', { duringFs: false });
  }
  const e = sb.window.historyLogGetEntries();
  eq(e.map(x => x.id).join(','), '1,2,3');
});

t('sandbox: historyLogClear empties + resets ID counter', () => {
  const sb = buildSandbox(defaultConfig());
  sb.window.__SLOT_BALANCE__ = 1000;
  sb.HookBus.emit('preSpin', { duringFs: false });
  sb.HookBus.emit('postSpin', { duringFs: false });
  eq(sb.window.historyLogGetEntries().length, 1);
  sb.window.historyLogClear();
  eq(sb.window.historyLogGetEntries().length, 0);
  /* New entry → id resets to 1. */
  sb.HookBus.emit('preSpin', { duringFs: false });
  sb.HookBus.emit('postSpin', { duringFs: false });
  eq(sb.window.historyLogGetEntries()[0].id, 1);
});

t('sandbox: historyLogShow opens + Hide closes + Toggle flips', () => {
  const sb = buildSandbox(defaultConfig());
  eq(sb.elements.get('historyBackdrop').hidden, true);
  sb.window.historyLogShow();
  eq(sb.elements.get('historyBackdrop').hidden, false);
  sb.window.historyLogHide();
  eq(sb.elements.get('historyBackdrop').hidden, true);
  sb.window.historyLogToggle();
  eq(sb.window.HISTORY_LOG_STATE.open, true);
  sb.window.historyLogToggle();
  eq(sb.window.HISTORY_LOG_STATE.open, false);
});

t('sandbox: preSpin auto-hides when autoHideOnSpin=true', () => {
  const sb = buildSandbox(defaultConfig());
  sb.window.historyLogShow();
  sb.HookBus.emit('preSpin', { duringFs: false });
  eq(sb.window.HISTORY_LOG_STATE.open, false);
});

t('sandbox: preSpin does NOT hide when autoHideOnSpin=false', () => {
  const sb = buildSandbox({ ...defaultConfig(), autoHideOnSpin: false });
  sb.window.historyLogShow();
  sb.HookBus.emit('preSpin', { duringFs: false });
  eq(sb.window.HISTORY_LOG_STATE.open, true);
});

t('sandbox: onFsTrigger always hides + onAutoplayStart always hides', () => {
  const sb = buildSandbox({ ...defaultConfig(), autoHideOnSpin: false });
  sb.window.historyLogShow();
  sb.HookBus.emit('onFsTrigger', {});
  eq(sb.window.HISTORY_LOG_STATE.open, false);
  sb.window.historyLogShow();
  sb.HookBus.emit('onAutoplayStart', { remaining: 25, step: 25 });
  eq(sb.window.HISTORY_LOG_STATE.open, false);
});

t('sandbox: Escape key closes panel', () => {
  const sb = buildSandbox(defaultConfig());
  sb.window.historyLogShow();
  sb.document._fireDoc('keydown', { key: 'Escape' });
  eq(sb.window.HISTORY_LOG_STATE.open, false);
});

t('sandbox: backdrop click closes; inner click does NOT', () => {
  const sb = buildSandbox(defaultConfig());
  sb.window.historyLogShow();
  const bd = sb.elements.get('historyBackdrop');
  bd._fire('click', { target: { other: 'inner' } });
  eq(sb.window.HISTORY_LOG_STATE.open, true);
  bd._fire('click', { target: bd });
  eq(sb.window.HISTORY_LOG_STATE.open, false);
});

t('sandbox: historyLogExportCsv emits header + rows in schema order', () => {
  const sb = buildSandbox({ ...defaultConfig(), allowCsvExport: true });
  sb.window.__SLOT_BET__    = 1;
  sb.window.__SLOT_BALANCE__ = 1000;
  sb.HookBus.emit('preSpin', { duringFs: false });
  sb.window.__WIN_AWARD__   = 5;
  sb.HookBus.emit('postSpin', { duringFs: false });
  const csv = sb.window.historyLogExportCsv();
  ct(csv, 'id,ts,mode,bet,win,balance_before,balance_after');
  ct(csv, ',base,');
});

t('sandbox: invalid __WIN_AWARD__ treated as 0', () => {
  const sb = buildSandbox(defaultConfig());
  sb.window.__SLOT_BET__    = 1;
  sb.window.__SLOT_BALANCE__ = 1000;
  sb.window.__WIN_AWARD__   = NaN;
  sb.HookBus.emit('preSpin', { duringFs: false });
  sb.HookBus.emit('postSpin', { duringFs: false });
  const e = sb.window.historyLogGetEntries();
  eq(e[0].win, 0);
});

t('sandbox: fsTotal not set on base entries', () => {
  const sb = buildSandbox(defaultConfig());
  sb.window.__SLOT_BET__ = 1;
  sb.window.__SLOT_BALANCE__ = 1000;
  sb.HookBus.emit('preSpin', { duringFs: false });
  sb.HookBus.emit('postSpin', { duringFs: false });
  ok(!('fsTotal' in sb.window.historyLogGetEntries()[0]), 'base entries omit fsTotal');
});

t('sandbox: getEntries returns a snapshot (not live ref)', () => {
  const sb = buildSandbox(defaultConfig());
  sb.window.__SLOT_BET__ = 1;
  sb.window.__SLOT_BALANCE__ = 1000;
  sb.HookBus.emit('preSpin', { duringFs: false });
  sb.HookBus.emit('postSpin', { duringFs: false });
  const snap1 = sb.window.historyLogGetEntries();
  eq(snap1.length, 1);
  sb.HookBus.emit('preSpin', { duringFs: false });
  sb.HookBus.emit('postSpin', { duringFs: false });
  eq(snap1.length, 1, 'snapshot did not mutate');
  eq(sb.window.historyLogGetEntries().length, 2);
});

t('sandbox: close button receives focus after show', () => {
  const sb = buildSandbox(defaultConfig());
  sb.window.historyLogShow();
  eq(sb.elements.get('historyCloseBtn')._focused, true);
});

/* ── Hygiene ── */

t('determinism: same config → byte-identical CSS', () => {
  eq(emitHistoryLogCSS(defaultConfig()), emitHistoryLogCSS(defaultConfig()));
});

t('vendor-neutral: no vendor strings anywhere', () => {
  const all = emitHistoryLogCSS(defaultConfig()) +
              emitHistoryLogMarkup(defaultConfig()) +
              emitHistoryLogRuntime(defaultConfig());
  for (const banned of ['gates','olympus','reactoonz','megaways','netent','wrath',
                        'sweet bonanza','pragmatic','microgaming','playa-slot']) {
    nct(all.toLowerCase(), banned, 'banned: ' + banned);
  }
});

console.log('\n--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
