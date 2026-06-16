/* eslint-disable no-console */
import {
  defaultConfig, resolveConfig,
  emitI18nRuntime,
  LANGUAGE_PACKS, CURRENCY_FORMATS, CURRENCY_SYMBOLS,
} from '../../src/blocks/i18n.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; } };
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ok = (c, m = '') => { if (!c) throw new Error(`expected truthy — ${m}`); };
const ct = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing ${JSON.stringify(n)} — ${m}`); };

console.log('— blocks/i18n.mjs —');

/* ─── language packs ──────────────────────────────────────────────── */

t('LANGUAGE_PACKS: 10 baseline locales present', () => {
  const want = ['en-US', 'sr-Latn', 'de-DE', 'es-ES', 'fr-FR', 'it-IT', 'pt-BR', 'tr-TR', 'ru-RU', 'zh-Hans'];
  for (const loc of want) ok(LANGUAGE_PACKS[loc], `missing ${loc}`);
  eq(Object.keys(LANGUAGE_PACKS).length, 10);
});

t('LANGUAGE_PACKS: every pack has the canonical baseline keys', () => {
  const canonical = Object.keys(LANGUAGE_PACKS['en-US']);
  for (const loc of Object.keys(LANGUAGE_PACKS)) {
    const pack = LANGUAGE_PACKS[loc];
    for (const key of canonical) {
      ok(typeof pack[key] === 'string' && pack[key].length > 0,
         `${loc} missing key ${key}`);
    }
  }
});

t('LANGUAGE_PACKS: srpski ekavica baseline (Boki language)', () => {
  const sr = LANGUAGE_PACKS['sr-Latn'];
  eq(sr['balance.label'], 'Kredit');
  eq(sr['bet.label'], 'Ulog');
  eq(sr['win.label'], 'Dobitak');
  eq(sr['bigWin.label'], 'VELIKI DOBITAK');
});

t('LANGUAGE_PACKS: packs are frozen (defensive)', () => {
  const fr = LANGUAGE_PACKS['fr-FR'];
  let threw = false;
  try { fr['balance.label'] = 'mutated'; } catch (_) { threw = true; }
  ok(threw || fr['balance.label'] === 'Solde', 'pack not frozen');
});

/* ─── currency formats ────────────────────────────────────────────── */

t('CURRENCY_FORMATS: 10 locales covered', () => {
  eq(Object.keys(CURRENCY_FORMATS).length, 10);
});

t('CURRENCY_FORMATS: US uses $ first + comma/dot', () => {
  const fmt = CURRENCY_FORMATS['en-US'];
  eq(fmt.thousand, ',');
  eq(fmt.decimal, '.');
  eq(fmt.symbolFirst, true);
});

t('CURRENCY_FORMATS: DE uses dot/comma + symbol last', () => {
  const fmt = CURRENCY_FORMATS['de-DE'];
  eq(fmt.thousand, '.');
  eq(fmt.decimal, ',');
  eq(fmt.symbolFirst, false);
});

t('CURRENCY_FORMATS: FR uses space/comma + symbol last', () => {
  const fmt = CURRENCY_FORMATS['fr-FR'];
  eq(fmt.thousand, ' ');
  eq(fmt.decimal, ',');
});

t('CURRENCY_SYMBOLS: core ISO 4217 set covered', () => {
  for (const ccy of ['USD', 'EUR', 'GBP', 'RUB', 'TRY', 'BRL', 'CNY', 'JPY']) {
    ok(CURRENCY_SYMBOLS[ccy], `missing ${ccy}`);
  }
});

/* ─── resolveConfig ────────────────────────────────────────────── */

t('resolveConfig: enabled override', () => {
  eq(resolveConfig({ i18n: { enabled: false } }).enabled, false);
});

t('resolveConfig: defaultLocale validated', () => {
  eq(resolveConfig({ i18n: { defaultLocale: 'sr-Latn' } }).defaultLocale, 'sr-Latn');
  eq(resolveConfig({ i18n: { defaultLocale: 'invalid_locale' } }).defaultLocale, 'en-US');
});

t('resolveConfig: defaultCurrency must be ISO 4217 3-letter', () => {
  eq(resolveConfig({ i18n: { defaultCurrency: 'EUR' } }).defaultCurrency, 'EUR');
  eq(resolveConfig({ i18n: { defaultCurrency: 'euro' } }).defaultCurrency, 'USD');
  eq(resolveConfig({ i18n: { defaultCurrency: 'USDD' } }).defaultCurrency, 'USD');
});

t('resolveConfig: extraPacks merged (sanitised)', () => {
  const c = resolveConfig({ i18n: {
    extraPacks: {
      'en-US': { 'custom.key': 'Hello' },
      'invalid': { 'x': 'y' },
      'fr-FR': { 'oversize-key': 'x'.repeat(600) },
    },
  }});
  ok(c.extraPacks['en-US']);
  ok(c.extraPacks['en-US']['custom.key'] === 'Hello');
  ok(!c.extraPacks['invalid']);
});

t('resolveConfig: fallbackChain accepts up to 5 locales', () => {
  const c = resolveConfig({ i18n: {
    fallbackChain: ['en-US', 'fr-FR', 'de-DE', 'invalid', 'es-ES', 'it-IT', 'pt-BR'],
  }});
  ok(c.fallbackChain.length <= 5);
  ok(c.fallbackChain.includes('en-US'));
});

/* ─── emitI18nRuntime ────────────────────────────────────────────── */

t('emitRuntime: disabled emits stub', () => {
  const r = emitI18nRuntime(resolveConfig({ i18n: { enabled: false } }));
  ct(r, '__SLOT_I18N__');
  ct(r, "t: function (key, fb)");
});

t('emitRuntime: bakes all 10 language packs', () => {
  const r = emitI18nRuntime(defaultConfig());
  for (const loc of Object.keys(LANGUAGE_PACKS)) {
    ct(r, JSON.stringify(loc));
  }
});

t('emitRuntime: HookBus listener for onLocaleChanged', () => {
  const r = emitI18nRuntime(defaultConfig());
  ct(r, "HookBus.on('onLocaleChanged'");
});

t('emitRuntime: extraPacks merged into baseline', () => {
  const r = emitI18nRuntime(resolveConfig({ i18n: {
    extraPacks: { 'fr-FR': { 'custom.brand': 'BrandName' } },
  }}));
  ct(r, 'custom.brand');
  ct(r, 'BrandName');
});

t('emitRuntime: useIntlNumberFormat flag baked', () => {
  const r = emitI18nRuntime(resolveConfig({ i18n: { useIntlNumberFormat: true } }));
  ct(r, 'USE_INTL = true');
  ct(r, 'Intl.NumberFormat');
});

/* ─── sandbox runtime tests ──────────────────────────────────────── */

function _mkSandbox(locale = 'en-US') {
  const nodes = [];
  const sandbox = {
    __SLOT_LOCALE__: locale,
    __SLOT_I18N__: null,
    HookBus: { emit() {}, on() {} },
  };
  const doc = {
    readyState: 'complete',
    querySelectorAll(sel) { return nodes.filter(n => n._sel === sel); },
    addEventListener() {},
  };
  sandbox.document = doc;
  sandbox._addNode = (sel, attrs = {}) => {
    const n = {
      _sel: sel, _attrs: attrs, textContent: '',
      getAttribute(name) { return attrs[name] != null ? attrs[name] : null; },
    };
    nodes.push(n);
    return n;
  };
  return sandbox;
}

t('runtime: t() resolves keys from active locale pack', () => {
  const sandbox = _mkSandbox('de-DE');
  const src = emitI18nRuntime(defaultConfig());
  new Function('window', 'document', src)(sandbox, sandbox.document);
  eq(sandbox.__SLOT_I18N__.t('balance.label'), 'Guthaben');
});

t('runtime: t() fallback chain when key missing', () => {
  const sandbox = _mkSandbox('fr-FR');
  const src = emitI18nRuntime(defaultConfig());
  new Function('window', 'document', src)(sandbox, sandbox.document);
  /* 'missing.key' not in any pack — returns the fallback arg */
  eq(sandbox.__SLOT_I18N__.t('missing.key', 'X'), 'X');
});

t('runtime: money() formats per-locale (US)', () => {
  const sandbox = _mkSandbox('en-US');
  const src = emitI18nRuntime(defaultConfig());
  new Function('window', 'document', src)(sandbox, sandbox.document);
  eq(sandbox.__SLOT_I18N__.money(1234.56, 'USD'), '$1,234.56');
});

t('runtime: money() formats per-locale (DE)', () => {
  const sandbox = _mkSandbox('de-DE');
  const src = emitI18nRuntime(resolveConfig({ i18n: { defaultLocale: 'de-DE' } }));
  new Function('window', 'document', src)(sandbox, sandbox.document);
  eq(sandbox.__SLOT_I18N__.money(1234.56, 'EUR'), '1.234,56 €');
});

t('runtime: money() formats per-locale (FR)', () => {
  const sandbox = _mkSandbox('fr-FR');
  const src = emitI18nRuntime(resolveConfig({ i18n: { defaultLocale: 'fr-FR' } }));
  new Function('window', 'document', src)(sandbox, sandbox.document);
  eq(sandbox.__SLOT_I18N__.money(1234.56, 'EUR'), '1 234,56 €');
});

t('runtime: paints [data-i18n] nodes at boot', () => {
  const sandbox = _mkSandbox('sr-Latn');
  const node = sandbox._addNode('[data-i18n]', { 'data-i18n': 'spin.cta' });
  const src = emitI18nRuntime(resolveConfig({ i18n: { defaultLocale: 'sr-Latn' } }));
  new Function('window', 'document', src)(sandbox, sandbox.document);
  eq(node.textContent, 'Vrti');
});

t('runtime: money() handles negative amounts', () => {
  const sandbox = _mkSandbox('en-US');
  const src = emitI18nRuntime(defaultConfig());
  new Function('window', 'document', src)(sandbox, sandbox.document);
  eq(sandbox.__SLOT_I18N__.money(-99.5, 'USD'), '-$99.50');
});

t('runtime: money() handles 0 properly', () => {
  const sandbox = _mkSandbox('en-US');
  const src = emitI18nRuntime(defaultConfig());
  new Function('window', 'document', src)(sandbox, sandbox.document);
  eq(sandbox.__SLOT_I18N__.money(0, 'USD'), '$0.00');
});

console.log(`\n  pass: ${pass}   fail: ${fail}`);
if (fail) process.exit(1);
