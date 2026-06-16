/* eslint-disable no-console */
import {
  defaultConfig, resolveConfig,
  emitRtlLayoutCSS, emitRtlLayoutRuntime,
} from '../../src/blocks/rtlLayout.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; } };
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ok = (c, m = '') => { if (!c) throw new Error(`expected truthy — ${m}`); };
const ct = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };
const nc = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`should NOT include ${JSON.stringify(n)} — ${m}`); };

console.log('— blocks/rtlLayout.mjs —');

/* ─── defaults ─────────────────────────────────────────────────────── */

t('defaultConfig: enabled by default (RTL support always on)', () => {
  const c = defaultConfig();
  eq(c.enabled, true);
  eq(c.forceDir, null);
  ok(Array.isArray(c.numericSelectors));
  ok(Array.isArray(c.rtlLocaleList));
});

t('defaultConfig: canonical numeric selectors present', () => {
  const c = defaultConfig();
  ok(c.numericSelectors.includes('.balance-hud__value'));
  ok(c.numericSelectors.includes('.win-rollup'));
  ok(c.numericSelectors.includes('.bet-display'));
  ok(c.numericSelectors.includes('[data-numeric]'));
});

t('defaultConfig: canonical RTL locales (ar, he, fa, ur, ps)', () => {
  const c = defaultConfig();
  for (const p of ['ar', 'he', 'fa', 'ur', 'ps']) {
    ok(c.rtlLocaleList.includes(p), `missing ${p}`);
  }
});

/* ─── resolveConfig ───────────────────────────────────────────────── */

t('resolveConfig: enabled override', () => {
  eq(resolveConfig({ rtlLayout: { enabled: false } }).enabled, false);
});

t('resolveConfig: forceDir accepts only "rtl" or "ltr"', () => {
  eq(resolveConfig({ rtlLayout: { forceDir: 'rtl' } }).forceDir, 'rtl');
  eq(resolveConfig({ rtlLayout: { forceDir: 'ltr' } }).forceDir, 'ltr');
  eq(resolveConfig({ rtlLayout: { forceDir: 'auto' } }).forceDir, null);
  eq(resolveConfig({ rtlLayout: { forceDir: '<script>' } }).forceDir, null);
});

t('resolveConfig: numericSelectors extend (dedupe)', () => {
  const c = resolveConfig({ rtlLayout: { numericSelectors: ['.custom-bal', '[data-numeric]'] } });
  ok(c.numericSelectors.includes('.custom-bal'));
  ok(c.numericSelectors.includes('[data-numeric]'));
  // dedupe — [data-numeric] should still appear once
  const occ = c.numericSelectors.filter(x => x === '[data-numeric]').length;
  eq(occ, 1);
});

t('resolveConfig: numericSelectors rejects oversized strings (DoS guard)', () => {
  const c = resolveConfig({ rtlLayout: {
    numericSelectors: ['x'.repeat(300), '.ok-sel'],
  }});
  ok(c.numericSelectors.includes('.ok-sel'));
  ok(!c.numericSelectors.some(s => s.length >= 200));
});

t('resolveConfig: rtlLocaleList accepts BCP-47 prefixes', () => {
  const c = resolveConfig({ rtlLayout: { rtlLocaleList: ['ku', 'AR'] } });
  ok(c.rtlLocaleList.includes('ku'));
  ok(c.rtlLocaleList.includes('ar')); // lowercased
});

t('resolveConfig: rtlLocaleList rejects non-language strings', () => {
  const c = resolveConfig({ rtlLayout: { rtlLocaleList: ['<script>', '1234'] } });
  // bad ones filtered
  ok(!c.rtlLocaleList.includes('<script>'));
  ok(!c.rtlLocaleList.includes('1234'));
});

/* ─── emitRtlLayoutCSS ────────────────────────────────────────────── */

t('emitCSS: disabled emits empty', () => {
  eq(emitRtlLayoutCSS(resolveConfig({ rtlLayout: { enabled: false } })), '');
});

t('emitCSS: numeric isolation rule present', () => {
  const css = emitRtlLayoutCSS(defaultConfig());
  ct(css, 'unicode-bidi: isolate');
  ct(css, 'direction: ltr');
  ct(css, '.balance-hud__value');
  ct(css, '[data-numeric]');
});

t('emitCSS: html[dir=rtl] mirrors emitted', () => {
  const css = emitRtlLayoutCSS(defaultConfig());
  ct(css, 'html[dir="rtl"]');
  ct(css, 'flex-direction: row-reverse');
});

t('emitCSS: reel grid is NOT flipped (semantic order preserved)', () => {
  const css = emitRtlLayoutCSS(defaultConfig());
  // no .reels { direction: rtl } or .grid { row-reverse }
  nc(css, '.reels { direction: rtl');
  nc(css, '.grid { flex-direction: row-reverse');
});

/* ─── emitRtlLayoutRuntime ───────────────────────────────────────── */

t('emitRuntime: disabled emits stub', () => {
  const r = emitRtlLayoutRuntime(resolveConfig({ rtlLayout: { enabled: false } }));
  ct(r, '__SLOT_RTL_ACTIVE__ = false');
});

t('emitRuntime: enabled bakes RTL_PREFIXES + FORCE_DIR', () => {
  const r = emitRtlLayoutRuntime(defaultConfig());
  ct(r, 'RTL_PREFIXES');
  ct(r, '"ar"');
  ct(r, '"he"');
  ct(r, 'FORCE_DIR = null');
});

t('emitRuntime: HookBus.on onLocaleChanged + storage listener', () => {
  const r = emitRtlLayoutRuntime(defaultConfig());
  ct(r, "HookBus.on('onLocaleChanged'");
  ct(r, "addEventListener('storage'");
  ct(r, "HookBus.emit('onDirChanged'");
});

t('emitRuntime: forceDir bakes override', () => {
  const r = emitRtlLayoutRuntime(resolveConfig({ rtlLayout: { forceDir: 'rtl' } }));
  ct(r, 'FORCE_DIR = "rtl"');
});

/* ─── sandbox eval — runtime contract ─────────────────────────────── */

function _mkSandbox(locale, dirAttr = 'ltr') {
  const sandbox = {
    __SLOT_LOCALE__: locale,
    __SLOT_RTL_ACTIVE__: false,
    matchMedia() { return { matches: false }; },
    addEventListener() {},
    emissions: [],
    HookBus: {
      on() {},
      emit(ev, p) { sandbox.emissions.push({ ev, p }); },
    },
  };
  const docEl = {
    _dir: dirAttr,
    getAttribute(name) { return name === 'dir' ? this._dir : null; },
    setAttribute(name, val) { if (name === 'dir') this._dir = val; },
  };
  sandbox.document = { documentElement: docEl };
  return { sandbox, docEl };
}

t('runtime: Hebrew locale (he-IL) flips dir=rtl', () => {
  const { sandbox, docEl } = _mkSandbox('he-IL');
  const src = emitRtlLayoutRuntime(defaultConfig());
  new Function('window', 'document', `${src}`)(sandbox, sandbox.document);
  eq(docEl._dir, 'rtl');
  eq(sandbox.__SLOT_RTL_ACTIVE__, true);
});

t('runtime: Arabic (ar-SA) flips dir=rtl', () => {
  const { sandbox, docEl } = _mkSandbox('ar-SA');
  const src = emitRtlLayoutRuntime(defaultConfig());
  new Function('window', 'document', `${src}`)(sandbox, sandbox.document);
  eq(docEl._dir, 'rtl');
});

t('runtime: English (en-US) stays dir=ltr', () => {
  const { sandbox, docEl } = _mkSandbox('en-US');
  const src = emitRtlLayoutRuntime(defaultConfig());
  new Function('window', 'document', `${src}`)(sandbox, sandbox.document);
  eq(docEl._dir, 'ltr');
  eq(sandbox.__SLOT_RTL_ACTIVE__, false);
});

t('runtime: Persian / Farsi (fa-IR) flips dir=rtl', () => {
  const { sandbox, docEl } = _mkSandbox('fa-IR');
  const src = emitRtlLayoutRuntime(defaultConfig());
  new Function('window', 'document', `${src}`)(sandbox, sandbox.document);
  eq(docEl._dir, 'rtl');
});

t('runtime: emits onDirChanged when flipping', () => {
  const { sandbox } = _mkSandbox('he-IL'); // initial doc dir='ltr', will flip
  const src = emitRtlLayoutRuntime(defaultConfig());
  new Function('window', 'document', `${src}`)(sandbox, sandbox.document);
  const flip = sandbox.emissions.find(e => e.ev === 'onDirChanged');
  ok(flip, 'no onDirChanged emission');
  eq(flip.p.dir, 'rtl');
  eq(flip.p.prev, 'ltr');
});

t('runtime: NO onDirChanged when locale already matches dir', () => {
  const { sandbox } = _mkSandbox('en-US', 'ltr');
  const src = emitRtlLayoutRuntime(defaultConfig());
  new Function('window', 'document', `${src}`)(sandbox, sandbox.document);
  const flips = sandbox.emissions.filter(e => e.ev === 'onDirChanged');
  eq(flips.length, 0);
});

t('runtime: forceDir overrides locale detection', () => {
  const { sandbox, docEl } = _mkSandbox('en-US');
  const src = emitRtlLayoutRuntime(resolveConfig({ rtlLayout: { forceDir: 'rtl' } }));
  new Function('window', 'document', `${src}`)(sandbox, sandbox.document);
  eq(docEl._dir, 'rtl');
});

t('runtime: empty locale → ltr default', () => {
  const { sandbox, docEl } = _mkSandbox('');
  const src = emitRtlLayoutRuntime(defaultConfig());
  new Function('window', 'document', `${src}`)(sandbox, sandbox.document);
  eq(docEl._dir, 'ltr');
});

console.log(`\n  pass: ${pass}   fail: ${fail}`);
if (fail) process.exit(1);
