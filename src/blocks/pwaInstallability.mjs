/**
 * src/blocks/pwaInstallability.mjs
 *
 * Wave A8 — Progressive Web App installability.
 *
 * Industry pattern: operators ship slots as installable web apps so
 * players can add to home-screen, run full-screen without browser
 * chrome, and survive flaky connections during a spin.
 *
 * Lighthouse "Installable PWA" requires (as of 2025):
 *   1. Web App Manifest with name, short_name, icons (192 + 512 px),
 *      start_url, display ∈ {standalone, fullscreen, minimal-ui},
 *      theme_color, background_color.
 *   2. Service worker registered + responds with a 200 for start_url
 *      while offline (basic offline page is enough).
 *   3. Served over HTTPS (or localhost during dev).
 *
 * This block is a single emit-once coordinator. It:
 *   • Synthesizes the manifest JSON from model.gameName + theme palette
 *     (so each game gets brand-correct theme_color / bg).
 *   • Embeds inline SVG icons as data: URIs (zero external deps, no
 *     extra fetches needed; data: URIs in manifest are spec-compliant).
 *   • Injects <link rel="manifest" href="data:application/manifest+json
 *     ;base64,...">.
 *   • Registers a service worker built from a Blob URL — the SW source
 *     is a tiny cache-first handler over the current HTML; no separate
 *     sw.js fetch needed.
 *   • Listens for `beforeinstallprompt` so a "Add to Home Screen" CTA
 *     can be shown via window.__SLOT_PWA_PROMPT__() helper.
 *
 * Why blob-URL SW: the slot ships as a single static HTML built by
 * buildSlotHTML.mjs — no second-file deploy story. Blob-URL SW is a
 * recognised pattern in PWAbuilder + Google Doc samples.
 *
 * GDD config (consumed from `model.pwaInstallability`):
 *   {
 *     enabled:        boolean (default true)
 *     name:           string  (default model.gameName || 'Slot')
 *     shortName:      string  (default first 12 chars of name)
 *     display:        'standalone' | 'fullscreen' | 'minimal-ui'
 *     orientation:    'any' | 'portrait' | 'landscape'
 *     themeColor:     '#rrggbb' (default '#05070c')
 *     backgroundColor:'#rrggbb' (default '#0b0f16')
 *     scope:          string  (default '/')
 *     startUrl:       string  (default '.')
 *     iconColor:      '#rrggbb' (default '#c9a227' — gold accent)
 *   }
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitPwaInstallabilityMarkup(cfg) → markup string (head <link>)
 *   emitPwaInstallabilityRuntime(cfg) → runtime JS string
 *
 * Runtime contract:
 *   window.__SLOT_PWA_STATE__ = { installable, installed, swRegistered }
 *   window.__SLOT_PWA_PROMPT__() → triggers install prompt if available
 *   window.HookBus emits 'onPwaInstallable' { ready } / 'onPwaInstalled'
 */

/* RFC 4648 base64 — zero-dep Node + browser-safe via Buffer/btoa. */
function _b64(str) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'utf8').toString('base64');
  }
  /* istanbul ignore next */
  return globalThis.btoa(unescape(encodeURIComponent(str)));
}

function _isHex(s) {
  return typeof s === 'string' && /^#[0-9a-f]{3,8}$/i.test(s);
}

function _sanitizeName(s) {
  return String(s || '').replace(/[<>"'`]/g, '').slice(0, 60).trim();
}

export function defaultConfig() {
  return Object.freeze({
    enabled: true,
    name: 'Slot Game',
    shortName: '',
    display: 'standalone',
    orientation: 'any',
    themeColor: '#05070c',
    backgroundColor: '#0b0f16',
    scope: '.',
    startUrl: '.',
    iconColor: '#c9a227',
    /* UQ-DEEP-U fix: capture beforeinstallprompt only when operator has a
     * UI surface (install button) to call __SLOT_PWA_PROMPT__. Default
     * false → preventDefault NOT called → browser shows native banner;
     * no "Banner not shown" console warning. Override to true if you wire
     * a custom install CTA that triggers __SLOT_PWA_PROMPT__. */
    captureInstallPrompt: false,
  });
}

const ALLOWED_DISPLAYS = new Set(['standalone', 'fullscreen', 'minimal-ui']);
const ALLOWED_ORIENTATIONS = new Set(['any', 'portrait', 'landscape', 'portrait-primary', 'landscape-primary']);

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.pwaInstallability) || {};

  if (m.enabled != null) cfg.enabled = !!m.enabled;

  /* Auto-name from model if no explicit pwa.name. */
  if (typeof m.name === 'string' && m.name.length > 0) {
    cfg.name = _sanitizeName(m.name);
  } else if (model && typeof model.gameName === 'string' && model.gameName.length > 0) {
    cfg.name = _sanitizeName(model.gameName);
  }

  if (typeof m.shortName === 'string' && m.shortName.length > 0) {
    cfg.shortName = _sanitizeName(m.shortName).slice(0, 12);
  } else {
    cfg.shortName = cfg.name.slice(0, 12);
  }

  if (ALLOWED_DISPLAYS.has(m.display)) cfg.display = m.display;
  if (ALLOWED_ORIENTATIONS.has(m.orientation)) cfg.orientation = m.orientation;

  if (_isHex(m.themeColor)) cfg.themeColor = m.themeColor.toLowerCase();
  if (_isHex(m.backgroundColor)) cfg.backgroundColor = m.backgroundColor.toLowerCase();
  if (_isHex(m.iconColor)) cfg.iconColor = m.iconColor.toLowerCase();

  if (typeof m.scope === 'string' && m.scope.length > 0 && m.scope.length < 200) {
    cfg.scope = m.scope;
  }
  if (typeof m.startUrl === 'string' && m.startUrl.length > 0 && m.startUrl.length < 200) {
    cfg.startUrl = m.startUrl;
  }
  if (m.captureInstallPrompt === true) cfg.captureInstallPrompt = true;

  return cfg;
}

/* Inline SVG icon. The slot brand mark — a simple chip with the first
 * glyph of the game name on the theme accent. Encoded as data: URI inside
 * the manifest. Two sizes via SVG viewBox (infinitely scalable). */
function _iconSvgDataUri(cfg, sizePx) {
  const initial = (cfg.name || 'S').slice(0, 1).toUpperCase().replace(/[^A-Z0-9]/g, 'S');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sizePx}" height="${sizePx}" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="${cfg.backgroundColor}"/>
  <circle cx="256" cy="256" r="180" fill="${cfg.iconColor}" opacity="0.92"/>
  <text x="50%" y="58%" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="260" font-weight="900" fill="${cfg.backgroundColor}">${initial}</text>
</svg>`;
  return `data:image/svg+xml;base64,${_b64(svg)}`;
}

function _buildManifest(cfg) {
  return {
    name: cfg.name,
    short_name: cfg.shortName,
    description: `${cfg.name} — slot game`,
    start_url: cfg.startUrl,
    scope: cfg.scope,
    display: cfg.display,
    orientation: cfg.orientation,
    theme_color: cfg.themeColor,
    background_color: cfg.backgroundColor,
    icons: [
      { src: _iconSvgDataUri(cfg, 192), sizes: '192x192', type: 'image/svg+xml', purpose: 'any maskable' },
      { src: _iconSvgDataUri(cfg, 512), sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' },
    ],
    categories: ['games', 'entertainment'],
    lang: 'en',
  };
}

export function emitPwaInstallabilityMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ pwaInstallability: cfg });
  if (!c.enabled) return '';

  const manifest = _buildManifest(c);
  const manifestB64 = _b64(JSON.stringify(manifest));
  const dataUri = `data:application/manifest+json;base64,${manifestB64}`;
  const appleIcon = _iconSvgDataUri(c, 180);

  return `
<!-- pwaInstallability BLOCK (Wave A8) — emitted by src/blocks/pwaInstallability.mjs -->
<link rel="manifest" href="${dataUri}">
<meta name="theme-color" content="${c.themeColor}">
<!-- UQ-DEEP-U fix (Boki console warning 2026-06-24):
     Chrome deprecation: apple-mobile-web-app-capable WITHOUT generic
     mobile-web-app-capable triggered "deprecated" warning. Solution:
     emit BOTH — generic (W3C standard, Chrome/Edge/Firefox) PLUS apple
     (still required for iOS Safari which doesn't honor generic). -->
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="${c.shortName}">
<link rel="apple-touch-icon" href="${appleIcon}">`;
}

/* Service worker source — emitted as a string, later wrapped in Blob.
 * Cache-first strategy over current document + same-origin assets.
 * Network-first for the current document itself so live updates win.
 * Zero external dependencies; uses native Cache API. */
function _swSource(cacheName) {
  return `
const CACHE = ${JSON.stringify(cacheName)};
const CORE = ['./'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
  )));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    try {
      const net = await fetch(e.request);
      const cache = await caches.open(CACHE);
      try { cache.put(e.request, net.clone()); } catch (_) {}
      return net;
    } catch (_) {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(e.request) || await cache.match('./');
      return cached || new Response('Offline', { status: 503 });
    }
  })());
});
`;
}

export function emitPwaInstallabilityRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ pwaInstallability: cfg });
  if (!c.enabled) {
    return `
  /* ── pwaInstallability BLOCK (disabled) ──────────────────────────── */
  window.__SLOT_PWA_STATE__ = { installable: false, installed: false, swRegistered: false };
  window.__SLOT_PWA_PROMPT__ = function () { return Promise.resolve(null); };
`;
  }

  const cacheName = `slot-pwa-${c.shortName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'app'}-v1`;
  const swSrc = _swSource(cacheName);

  return `
  /* ── pwaInstallability BLOCK — emitted by src/blocks/pwaInstallability.mjs
     Registers blob-URL service worker, listens for installable +
     installed events, exposes prompt helper. */
  (function () {
    var STATE = {
      installable: false,
      installed:   false,
      swRegistered: false,
    };
    window.__SLOT_PWA_STATE__ = STATE;

    var _deferredPrompt = null;
    window.__SLOT_PWA_PROMPT__ = function () {
      if (!_deferredPrompt) return Promise.resolve(null);
      try {
        _deferredPrompt.prompt();
        return _deferredPrompt.userChoice.then(function (choice) {
          _deferredPrompt = null;
          STATE.installable = false;
          return choice && choice.outcome;
        });
      } catch (_) {
        return Promise.resolve(null);
      }
    };

    function _safeEmit(ev, p) {
      try {
        if (window.HookBus && typeof window.HookBus.emit === 'function') {
          if (ev === 'onPwaSwReady')      window.HookBus.emit('onPwaSwReady', p || {});
          else if (ev === 'onPwaInstallable') window.HookBus.emit('onPwaInstallable', p || {});
          else if (ev === 'onPwaInstalled')   window.HookBus.emit('onPwaInstalled', p || {});
        }
      } catch (_) {}
    }

    /* SW registration — blob URL avoids any second-file deploy. Service
     * workers from same-origin blob URLs are permitted (spec-compliant).
     * UQ-DEEP-H fix (Boki sandbox-iframe console 2026-06-23): even
     * READING navigator.serviceWorker throws SecurityError inside a
     * sandboxed iframe without allow-same-origin (e.g. the web-uploader
     * preview iframe). Previous check used a logical-AND chain which
     * performs property access → throws BEFORE the if-body try/catch
     * can swallow it. Pull entire feature-detection inside try/catch
     * so the SecurityError never escapes the block.
     * (No backticks in this comment — surrounding string is a JS template
     * literal that would terminate on any raw backtick character.) */
    var _swCapable = false;
    try {
      _swCapable = (typeof navigator !== 'undefined') &&
                   !!navigator.serviceWorker &&
                   (typeof navigator.serviceWorker.register === 'function') &&
                   (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');
    } catch (_) { /* sandboxed iframe denies serviceWorker — graceful skip */ }
    if (_swCapable) {
      try {
        var swBlob = new Blob([${JSON.stringify(swSrc)}], { type: 'application/javascript' });
        var swUrl = URL.createObjectURL(swBlob);
        navigator.serviceWorker.register(swUrl, { scope: ${JSON.stringify(c.scope)} })
          .then(function () { STATE.swRegistered = true; _safeEmit('onPwaSwReady', { ready: true }); })
          .catch(function () { STATE.swRegistered = false; });
      } catch (_) { /* swallow — SW is enhancement, not requirement */ }
    }

    /* beforeinstallprompt — A2HS opportunity (Android Chrome / Edge).
     * UQ-DEEP-U fix (Boki console 2026-06-24): preventDefault() bez
     * sledeceg prompt() poziva tetera "Banner not shown: page must call
     * prompt()" Chrome warning. Default ponasanje: NE preventDefault,
     * pusti browser native banner. Custom install button (operator
     * opt-in) postavlja captureInstallPrompt=true → tada blok cuva
     * deferred event za rucnu __SLOT_PWA_PROMPT__ pozive. */
    var CAPTURE_INSTALL_PROMPT = ${c.captureInstallPrompt ? 'true' : 'false'};
    window.addEventListener('beforeinstallprompt', function (e) {
      if (CAPTURE_INSTALL_PROMPT) {
        e.preventDefault();
        _deferredPrompt = e;
      }
      STATE.installable = true;
      _safeEmit('onPwaInstallable', { ready: true, captured: CAPTURE_INSTALL_PROMPT });
    });

    /* appinstalled — confirms install completed. */
    window.addEventListener('appinstalled', function () {
      STATE.installed = true;
      STATE.installable = false;
      _deferredPrompt = null;
      _safeEmit('onPwaInstalled', { installedAt: Date.now() });
    });

    /* iOS standalone detection (no beforeinstallprompt on iOS). */
    if (window.navigator && window.navigator.standalone === true) {
      STATE.installed = true;
    }
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
      STATE.installed = true;
    }
  })();
`;
}
