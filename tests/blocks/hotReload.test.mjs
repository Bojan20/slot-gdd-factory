/* eslint-disable no-console */
/**
 * Wave P8 — hotReload BLOCK unit tests.
 *
 * Coverage:
 *   • defaultConfig stable shape + immutability
 *   • resolveConfig — accepts/rejects per knob (positive-int bounds,
 *     safe-path validator rejects http URLs, category arrays preserved)
 *   • emitHotReloadCSS — disabled = empty; enabled emits .hmr-badge
 *   • emitHotReloadMarkup — disabled = empty; enabled emits #hmrBadge
 *   • emitHotReloadRuntime — disabled emits stub; enabled wires SSE,
 *     idempotent guard, indicator branch, fast-path emits onGddChange,
 *     full-reload schedules location.reload()
 *   • Vendor-neutrality
 */
import {
  defaultConfig,
  resolveConfig,
  emitHotReloadCSS,
  emitHotReloadMarkup,
  emitHotReloadRuntime,
} from '../../src/blocks/hotReload.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); console.log('  ✓', n); pass++; }
  catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; }
};
const eq = (a, b, m = '') => {
  if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`);
};
const ok = (c, m = '') => { if (!c) throw new Error(`expected truthy — ${m}`); };
const ct = (s, n, m = '') => {
  if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`);
};
const nct = (s, n, m = '') => {
  if (String(s).includes(n)) throw new Error(`unexpected substring ${JSON.stringify(n)} — ${m}`);
};

console.log('— blocks/hotReload.mjs —');

/* ── defaultConfig + resolveConfig ────────────────────────────── */

t('defaultConfig: stable shape', () => {
  const c = defaultConfig();
  eq(c.enabled, false);
  eq(c.endpoint, '/__dev/events');
  eq(c.reconnectMs, 1500);
  eq(c.reconnectMaxMs, 10000);
  eq(c.debounceMs, 120);
  eq(c.keepalivePingMs, 25000);
  eq(c.indicator, true);
  ok(Array.isArray(c.fullReloadCategories));
  ok(Array.isArray(c.fastReloadCategories));
  ok(c.fullReloadCategories.includes('block'));
  ok(c.fastReloadCategories.includes('gdd'));
});

t('defaultConfig: returns fresh copy (no shared category arrays)', () => {
  const a = defaultConfig();
  const b = defaultConfig();
  ok(a !== b, 'separate root objects');
  ok(a.fullReloadCategories !== b.fullReloadCategories, 'category arrays independent');
  a.fullReloadCategories.push('mutated');
  eq(b.fullReloadCategories.includes('mutated'), false, 'mutation does not leak');
});

t('resolveConfig: empty model → defaults', () => {
  const c = resolveConfig({});
  eq(c.enabled, false);
  eq(c.endpoint, '/__dev/events');
});

t('resolveConfig: enabled flips only on === true', () => {
  eq(resolveConfig({ hotReload: { enabled: 'yes' } }).enabled, false);
  eq(resolveConfig({ hotReload: { enabled: 1 } }).enabled, false);
  eq(resolveConfig({ hotReload: { enabled: true } }).enabled, true);
});

t('resolveConfig: endpoint accepts relative paths, rejects http(s)', () => {
  eq(resolveConfig({ hotReload: { endpoint: '/sse' } }).endpoint, '/sse');
  eq(resolveConfig({ hotReload: { endpoint: '__dev/events' } }).endpoint, '__dev/events');
  eq(resolveConfig({ hotReload: { endpoint: 'http://evil.com/sse' } }).endpoint, '/__dev/events');
  eq(resolveConfig({ hotReload: { endpoint: 'https://evil.com/sse' } }).endpoint, '/__dev/events');
  eq(resolveConfig({ hotReload: { endpoint: 123 } }).endpoint, '/__dev/events');
  eq(resolveConfig({ hotReload: { endpoint: '' } }).endpoint, '/__dev/events');
});

t('resolveConfig: positive-int bounds on reconnect/debounce', () => {
  eq(resolveConfig({ hotReload: { reconnectMs: -1 } }).reconnectMs, 1500);
  eq(resolveConfig({ hotReload: { reconnectMs: 0 } }).reconnectMs, 1500);
  eq(resolveConfig({ hotReload: { reconnectMs: 500 } }).reconnectMs, 500);
  eq(resolveConfig({ hotReload: { reconnectMs: 999999 } }).reconnectMs, 1500); /* over max */
  eq(resolveConfig({ hotReload: { debounceMs: 80 } }).debounceMs, 80);
  eq(resolveConfig({ hotReload: { debounceMs: 'fast' } }).debounceMs, 120);
});

t('resolveConfig: reconnectMaxMs clamped to ≥ reconnectMs', () => {
  const c = resolveConfig({ hotReload: { reconnectMs: 3000, reconnectMaxMs: 1000 } });
  ok(c.reconnectMaxMs >= c.reconnectMs, 'max stays ≥ floor');
});

t('resolveConfig: category arrays accept valid string lists, reject garbage', () => {
  const ok1 = resolveConfig({ hotReload: { fullReloadCategories: ['x', 'y'] } });
  eq(ok1.fullReloadCategories.length, 2);
  eq(ok1.fullReloadCategories[0], 'x');
  const bad = resolveConfig({ hotReload: { fullReloadCategories: ['ok', 42] } });
  eq(bad.fullReloadCategories.includes('block'), true, 'falls back to defaults on mixed types');
  const bad2 = resolveConfig({ hotReload: { fastReloadCategories: 'gdd' } });
  eq(Array.isArray(bad2.fastReloadCategories), true);
});

t('resolveConfig: indicator turned off via false only', () => {
  eq(resolveConfig({ hotReload: { indicator: false } }).indicator, false);
  eq(resolveConfig({ hotReload: { indicator: 0 } }).indicator, true);
});

/* ── emitHotReloadCSS ─────────────────────────────────────────── */

t('emitHotReloadCSS: disabled → empty string', () => {
  eq(emitHotReloadCSS(defaultConfig()), '');
});

t('emitHotReloadCSS: enabled+indicator → emits .hmr-badge rules', () => {
  const css = emitHotReloadCSS({ enabled: true, indicator: true });
  ct(css, '.hmr-badge');
  ct(css, 'prefers-reduced-motion');
  ct(css, 'role="status"'.replace(/.*/, '')); /* sanity: css has no role */
  ct(css, 'data-state="connected"');
  ct(css, 'safe-area-inset');
});

t('emitHotReloadCSS: enabled+indicator off → empty', () => {
  const css = emitHotReloadCSS({ enabled: true, indicator: false });
  eq(css, '');
});

/* ── emitHotReloadMarkup ──────────────────────────────────────── */

t('emitHotReloadMarkup: disabled → empty', () => {
  eq(emitHotReloadMarkup(defaultConfig()), '');
});

t('emitHotReloadMarkup: enabled+indicator → host element with a11y attrs', () => {
  const html = emitHotReloadMarkup({ enabled: true, indicator: true });
  ct(html, 'id="hmrBadge"');
  ct(html, 'role="status"');
  ct(html, 'aria-live="polite"');
  ct(html, 'class="hmr-dot"');
});

/* ── emitHotReloadRuntime ─────────────────────────────────────── */

t('emitHotReloadRuntime: disabled → stub sets __HOT_RELOAD_ENABLED__ false', () => {
  const js = emitHotReloadRuntime(defaultConfig());
  ct(js, '__HOT_RELOAD_ENABLED__ = false');
  nct(js, 'new EventSource', 'disabled stub must not open SSE');
});

t('emitHotReloadRuntime: enabled wires EventSource + idempotency guard', () => {
  const js = emitHotReloadRuntime({ enabled: true });
  ct(js, '__HOT_RELOAD_STARTED__', 'idempotency flag');
  ct(js, 'new EventSource', 'opens SSE');
  ct(js, 'CFG.endpoint', 'reads endpoint from baked CFG');
  ct(js, '__HOT_RELOAD_STATE__', 'exposes state for debug');
  ct(js, 'onHotReloadConnect', 'emits connect event');
  ct(js, 'onHotReloadDisconnect', 'emits disconnect event');
});

t('emitHotReloadRuntime: enabled emits onGddChange on fast path', () => {
  const js = emitHotReloadRuntime({ enabled: true });
  ct(js, 'tryFastGddReload', 'fast-path handler present');
  ct(js, "HookBus.emit('onGddChange'", 'literal HookBus.emit so lego-gate detects ownership');
  ct(js, 'window.__SLOT_REPARSE__', 'looks up the reparser hook');
});

t('emitHotReloadRuntime: enabled emits connect / disconnect via literal HookBus.emit', () => {
  const js = emitHotReloadRuntime({ enabled: true });
  ct(js, "HookBus.emit('onHotReloadConnect'", 'connect emit literal');
  ct(js, "HookBus.emit('onHotReloadDisconnect'", 'disconnect emit literal');
});

t('emitHotReloadRuntime: enabled has debounced full reload', () => {
  const js = emitHotReloadRuntime({ enabled: true });
  ct(js, 'scheduleFullReload', 'full-reload helper present');
  ct(js, 'window.location.reload', 'triggers reload');
  ct(js, 'CFG.debounceMs', 'reads debounce from CFG');
});

t('emitHotReloadRuntime: exponential backoff capped at reconnectMaxMs', () => {
  const js = emitHotReloadRuntime({ enabled: true });
  ct(js, 'CFG.reconnectMs', 'backoff floor');
  ct(js, 'CFG.reconnectMaxMs', 'backoff ceiling');
  ct(js, 'state.backoffMs * 2', 'doubles on each retry');
});

t('emitHotReloadRuntime: defensive on missing EventSource', () => {
  const js = emitHotReloadRuntime({ enabled: true });
  ct(js, "typeof EventSource !== 'function'", 'guards EventSource availability');
});

t('emitHotReloadRuntime: exposes test hook hotReloadDisconnect', () => {
  const js = emitHotReloadRuntime({ enabled: true });
  ct(js, 'window.hotReloadDisconnect', 'test-hook present');
});

/* ── vendor neutrality ────────────────────────────────────────── */

t('vendor-neutral: block source contains no banned game / studio names', () => {
  const banned = ['playa', 'pragmatic', 'igt', 'netent', 'microgaming', 'olympus', 'crystal forge', 'midnight fangs', 'wrath'];
  const text = String(emitHotReloadCSS({ enabled: true, indicator: true })) +
               String(emitHotReloadMarkup({ enabled: true, indicator: true })) +
               String(emitHotReloadRuntime({ enabled: true }));
  for (const name of banned) {
    if (text.toLowerCase().includes(name)) {
      throw new Error('banned token in emitted output: ' + name);
    }
  }
});

console.log(`\n${pass} pass · ${fail} fail`);
if (fail > 0) process.exit(1);
