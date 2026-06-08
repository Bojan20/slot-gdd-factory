/* eslint-disable no-console */
import {
  defaultConfig, resolveConfig, shouldHandle,
  emitGenericFeatureBannerCSS, emitGenericFeatureBannerMarkup, emitGenericFeatureBannerRuntime,
  DEDICATED_KINDS,
} from '../../src/blocks/genericFeatureBanner.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; } };
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ok = (c, m = '') => { if (!c) throw new Error(`expected truthy — ${m}`); };
const ct = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };
const notCt = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`unexpected substring ${JSON.stringify(n)} — ${m}`); };

console.log('— blocks/genericFeatureBanner.mjs —');

/* ─── defaults ────────────────────────────────────────── */
t('defaultConfig: sane defaults', () => {
  const c = defaultConfig();
  eq(c.enabled, true);
  eq(c.dwellMs, 1200);
  eq(c.fadeMs, 240);
  eq(c.handleKinds, 'auto');
});

/* ─── resolveConfig ──────────────────────────────────── */
t('resolveConfig: enabled=false honored', () => {
  eq(resolveConfig({ genericFeatureBanner: { enabled: false } }).enabled, false);
});

t('resolveConfig: dwellMs valid passes', () => {
  eq(resolveConfig({ genericFeatureBanner: { dwellMs: 800 } }).dwellMs, 800);
});

t('resolveConfig: dwellMs out of range rejected', () => {
  eq(resolveConfig({ genericFeatureBanner: { dwellMs: 100000 } }).dwellMs, 1200);
  eq(resolveConfig({ genericFeatureBanner: { dwellMs: 50 } }).dwellMs, 1200);
});

t('resolveConfig: fadeMs clamps', () => {
  eq(resolveConfig({ genericFeatureBanner: { fadeMs: 999 } }).fadeMs, 240);
  eq(resolveConfig({ genericFeatureBanner: { fadeMs: 100 } }).fadeMs, 100);
});

t('resolveConfig: handleKinds array accepted', () => {
  const c = resolveConfig({ genericFeatureBanner: { handleKinds: ['lightning', 'mystery_symbol'] } });
  ok(Array.isArray(c.handleKinds));
  eq(c.handleKinds.length, 2);
});

/* ─── shouldHandle ───────────────────────────────────── */
t('shouldHandle: auto + free_spins (dedicated) → false', () => {
  eq(shouldHandle(defaultConfig(), 'free_spins'), false);
});

t('shouldHandle: auto + lightning (no dedicated block) → true', () => {
  eq(shouldHandle(defaultConfig(), 'lightning'), true);
});

t('shouldHandle: auto + bonus_pick (no dedicated standalone block currently) → true', () => {
  // Note: bonus_pick has bonusPick.mjs but it's not declared in DEDICATED_KINDS
  // (it's a multi-step interactive that the generic banner is fine to also flash for)
  eq(shouldHandle(defaultConfig(), 'bonus_pick'), true);
});

t('shouldHandle: explicit handleKinds whitelist exact match', () => {
  const c = resolveConfig({ genericFeatureBanner: { handleKinds: ['lightning'] } });
  eq(shouldHandle(c, 'lightning'), true);
  eq(shouldHandle(c, 'mystery_symbol'), false);
});

t('shouldHandle: disabled cfg → false', () => {
  eq(shouldHandle({ enabled: false }, 'lightning'), false);
});

t('DEDICATED_KINDS contains free_spins + bonus_buy + multiplier + big_win', () => {
  ok(DEDICATED_KINDS.includes('free_spins'));
  ok(DEDICATED_KINDS.includes('bonus_buy'));
  ok(DEDICATED_KINDS.includes('multiplier'));
  ok(DEDICATED_KINDS.includes('big_win'));
});

/* ─── CSS ────────────────────────────────────────────── */
t('emitGenericFeatureBannerCSS: disabled → marker comment, no .gfb-banner', () => {
  const css = emitGenericFeatureBannerCSS({ enabled: false });
  ct(css, 'disabled by GDD');
  notCt(css, '.gfb-banner');
});

t('emitGenericFeatureBannerCSS: enabled emits banner + reduced-motion', () => {
  const css = emitGenericFeatureBannerCSS(defaultConfig());
  ct(css, '.gfb-banner');
  ct(css, 'data-visible="true"');
  ct(css, 'prefers-reduced-motion');
});

t('emitGenericFeatureBannerCSS: respects fadeMs override', () => {
  const css = emitGenericFeatureBannerCSS(resolveConfig({ genericFeatureBanner: { fadeMs: 500 } }));
  ct(css, '500ms ease');
});

/* ─── Markup ─────────────────────────────────────────── */
t('emitGenericFeatureBannerMarkup: disabled → no banner div', () => {
  const m = emitGenericFeatureBannerMarkup({ enabled: false });
  notCt(m, 'id="gfbBanner"');
});

t('emitGenericFeatureBannerMarkup: enabled emits banner, label, kicker', () => {
  const m = emitGenericFeatureBannerMarkup(defaultConfig());
  ct(m, 'id="gfbBanner"');
  ct(m, 'id="gfbBannerLabel"');
  ct(m, 'FEATURE TRIGGERED');
  ct(m, 'role="status"');
  ct(m, 'aria-live="polite"');
  ct(m, 'data-visible="false"');
});

/* ─── Runtime ────────────────────────────────────────── */
t('emitGenericFeatureBannerRuntime: disabled → no runtime', () => {
  const r = emitGenericFeatureBannerRuntime({ enabled: false });
  notCt(r, 'addEventListener');
});

t('emitGenericFeatureBannerRuntime: enabled wires show/hide + subscribes', () => {
  const r = emitGenericFeatureBannerRuntime(defaultConfig());
  ct(r, 'window.genericFeatureBannerShow');
  ct(r, 'window.genericFeatureBannerHide');
  ct(r, 'onForceFeatureRequested');
  ct(r, "HookBus.on('onForceFeatureRequested'");
});

t('emitGenericFeatureBannerRuntime: uses textContent (XSS-safe)', () => {
  const r = emitGenericFeatureBannerRuntime(defaultConfig());
  ct(r, 'textContent');
});

t('emitGenericFeatureBannerRuntime: dwell + fade values baked in', () => {
  const r = emitGenericFeatureBannerRuntime(
    resolveConfig({ genericFeatureBanner: { dwellMs: 900, fadeMs: 300 } })
  );
  ct(r, 'DWELL_MS = 900');
  ct(r, 'FADE_MS  = 300');
});

t('emitGenericFeatureBannerRuntime: DEDICATED list baked in', () => {
  const r = emitGenericFeatureBannerRuntime(defaultConfig());
  ct(r, 'free_spins');
  ct(r, 'big_win');
});

t('emitGenericFeatureBannerRuntime: explicit handleKinds takes precedence', () => {
  const r = emitGenericFeatureBannerRuntime(
    resolveConfig({ genericFeatureBanner: { handleKinds: ['lightning'] } })
  );
  ct(r, '"lightning"');
});

t('emitGenericFeatureBannerRuntime: hide clears timer', () => {
  const r = emitGenericFeatureBannerRuntime(defaultConfig());
  ct(r, 'clearTimeout');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
