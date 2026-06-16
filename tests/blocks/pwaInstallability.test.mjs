/* eslint-disable no-console */
import {
  defaultConfig, resolveConfig,
  emitPwaInstallabilityMarkup, emitPwaInstallabilityRuntime,
} from '../../src/blocks/pwaInstallability.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; } };
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ok = (c, m = '') => { if (!c) throw new Error(`expected truthy — ${m}`); };
const ct = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };

console.log('— blocks/pwaInstallability.mjs —');

/* ─── defaults ─────────────────────────────────────────────────────── */

t('defaultConfig: enabled by default', () => {
  const c = defaultConfig();
  eq(c.enabled, true);
  eq(c.display, 'standalone');
  eq(c.orientation, 'any');
  ok(/^#[0-9a-f]+$/i.test(c.themeColor));
  ok(/^#[0-9a-f]+$/i.test(c.backgroundColor));
});

/* ─── resolveConfig ───────────────────────────────────────────────── */

t('resolveConfig: name auto-fills from model.gameName', () => {
  const c = resolveConfig({ gameName: 'Wrath Of Olympus' });
  eq(c.name, 'Wrath Of Olympus');
  eq(c.shortName, 'Wrath Of Oly'); // 12 char cap (slice(0,12))
});

t('resolveConfig: explicit pwa.name overrides gameName', () => {
  const c = resolveConfig({ gameName: 'Foo', pwaInstallability: { name: 'Bar Slot' } });
  eq(c.name, 'Bar Slot');
});

t('resolveConfig: name sanitized (no <>"\'`)', () => {
  const c = resolveConfig({ pwaInstallability: { name: '<script>Bad' } });
  ok(!c.name.includes('<'));
  ok(!c.name.includes('>'));
});

t('resolveConfig: display whitelist', () => {
  eq(resolveConfig({ pwaInstallability: { display: 'fullscreen' } }).display, 'fullscreen');
  eq(resolveConfig({ pwaInstallability: { display: 'browser' } }).display, 'standalone');
});

t('resolveConfig: theme + bg + icon color hex validated', () => {
  const c = resolveConfig({ pwaInstallability: { themeColor: '#ff0000', backgroundColor: 'not-hex' } });
  eq(c.themeColor, '#ff0000');
  eq(c.backgroundColor, '#0b0f16'); // default kept
});

t('resolveConfig: enabled override', () => {
  eq(resolveConfig({ pwaInstallability: { enabled: false } }).enabled, false);
});

/* ─── emitMarkup ──────────────────────────────────────────────────── */

t('emitMarkup: disabled emits empty', () => {
  eq(emitPwaInstallabilityMarkup(resolveConfig({ pwaInstallability: { enabled: false } })), '');
});

t('emitMarkup: <link rel=manifest> with data: URI', () => {
  const html = emitPwaInstallabilityMarkup(defaultConfig());
  ct(html, '<link rel="manifest"');
  ct(html, 'data:application/manifest+json;base64,');
});

t('emitMarkup: theme-color meta + apple-touch-icon', () => {
  const html = emitPwaInstallabilityMarkup(defaultConfig());
  ct(html, 'name="theme-color"');
  ct(html, 'apple-mobile-web-app-capable');
  ct(html, 'apple-touch-icon');
});

t('emitMarkup: manifest decodes to valid JSON with required PWA fields', () => {
  const html = emitPwaInstallabilityMarkup(resolveConfig({ gameName: 'TestGame' }));
  const m = html.match(/data:application\/manifest\+json;base64,([A-Za-z0-9+/=]+)/);
  ok(m, 'no manifest data URI');
  const json = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
  eq(json.name, 'TestGame');
  ok(typeof json.short_name === 'string' && json.short_name.length > 0);
  ok(Array.isArray(json.icons) && json.icons.length === 2);
  eq(json.icons[0].sizes, '192x192');
  eq(json.icons[1].sizes, '512x512');
  ok(json.theme_color);
  ok(json.background_color);
  ok(['standalone', 'fullscreen', 'minimal-ui'].includes(json.display));
});

t('emitMarkup: icons use data: SVG', () => {
  const html = emitPwaInstallabilityMarkup(defaultConfig());
  const m = html.match(/data:application\/manifest\+json;base64,([A-Za-z0-9+/=]+)/);
  const json = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
  for (const icon of json.icons) {
    ct(icon.src, 'data:image/svg+xml;base64,');
    eq(icon.type, 'image/svg+xml');
    ct(icon.purpose, 'maskable');
  }
});

/* ─── emitRuntime ─────────────────────────────────────────────────── */

t('emitRuntime: disabled emits stub', () => {
  const r = emitPwaInstallabilityRuntime(resolveConfig({ pwaInstallability: { enabled: false } }));
  ct(r, 'swRegistered: false');
});

t('emitRuntime: enabled registers SW via blob URL', () => {
  const r = emitPwaInstallabilityRuntime(defaultConfig());
  ct(r, 'navigator.serviceWorker.register');
  ct(r, 'new Blob');
  ct(r, 'URL.createObjectURL');
});

t('emitRuntime: HTTPS / localhost guard', () => {
  const r = emitPwaInstallabilityRuntime(defaultConfig());
  ct(r, "location.protocol === 'https:'");
  ct(r, "localhost");
});

t('emitRuntime: beforeinstallprompt + appinstalled wired', () => {
  const r = emitPwaInstallabilityRuntime(defaultConfig());
  ct(r, "addEventListener('beforeinstallprompt'");
  ct(r, "addEventListener('appinstalled'");
});

t('emitRuntime: exposes __SLOT_PWA_PROMPT__ helper', () => {
  const r = emitPwaInstallabilityRuntime(defaultConfig());
  ct(r, '__SLOT_PWA_PROMPT__');
});

t('emitRuntime: iOS standalone detection branch', () => {
  const r = emitPwaInstallabilityRuntime(defaultConfig());
  ct(r, 'navigator.standalone');
  ct(r, "(display-mode: standalone)");
});

/* ─── runtime sandbox ─────────────────────────────────────────────── */

function _mkSandbox() {
  const registered = [];
  const listeners = {};
  return {
    __SLOT_PWA_STATE__: null,
    __SLOT_PWA_PROMPT__: null,
    location: { protocol: 'https:', hostname: 'example.com' },
    navigator: {
      serviceWorker: {
        register(url, opts) {
          registered.push({ url, opts });
          return Promise.resolve({});
        },
      },
      standalone: false,
    },
    addEventListener(ev, fn) { listeners[ev] = fn; },
    matchMedia() { return { matches: false }; },
    HookBus: { emit() {}, on() {} },
    _registered: registered,
    _listeners: listeners,
  };
}

t('runtime: registers SW on https origin', () => {
  const sandbox = _mkSandbox();
  /* Polyfill Blob + URL.createObjectURL for sandbox */
  globalThis.Blob = globalThis.Blob || class { constructor(parts, opts) { this.parts = parts; this.type = opts && opts.type; } };
  globalThis.URL = globalThis.URL || { createObjectURL() { return 'blob:test'; } };
  if (typeof globalThis.URL.createObjectURL !== 'function') {
    globalThis.URL.createObjectURL = () => 'blob:test';
  }

  const src = emitPwaInstallabilityRuntime(defaultConfig());
  /* Use indirect eval so sandbox bindings work. */
  const fn = new Function('window', 'navigator', 'location', 'document', 'Blob', 'URL', src);
  fn(sandbox, sandbox.navigator, sandbox.location, {}, globalThis.Blob, globalThis.URL);
  eq(sandbox._registered.length, 1);
});

t('runtime: state initialized', () => {
  const sandbox = _mkSandbox();
  const src = emitPwaInstallabilityRuntime(defaultConfig());
  new Function('window', 'navigator', 'location', 'document', 'Blob', 'URL', src)(
    sandbox, sandbox.navigator, sandbox.location, {}, globalThis.Blob, globalThis.URL,
  );
  ok(sandbox.__SLOT_PWA_STATE__);
  eq(sandbox.__SLOT_PWA_STATE__.installable, false);
  eq(sandbox.__SLOT_PWA_STATE__.installed, false);
});

t('runtime: beforeinstallprompt sets installable', () => {
  const sandbox = _mkSandbox();
  const src = emitPwaInstallabilityRuntime(defaultConfig());
  new Function('window', 'navigator', 'location', 'document', 'Blob', 'URL', src)(
    sandbox, sandbox.navigator, sandbox.location, {}, globalThis.Blob, globalThis.URL,
  );
  const fakeEvent = { preventDefault() {}, prompt() {}, userChoice: Promise.resolve({ outcome: 'accepted' }) };
  sandbox._listeners.beforeinstallprompt(fakeEvent);
  eq(sandbox.__SLOT_PWA_STATE__.installable, true);
});

console.log(`\n  pass: ${pass}   fail: ${fail}`);
if (fail) process.exit(1);
