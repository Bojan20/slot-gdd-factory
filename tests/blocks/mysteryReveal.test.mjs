/* eslint-disable no-console */
/**
 * mysteryReveal block unit tests — Wave W47.S19 / B65.
 *
 * Coverage: defaults, enable/disable, position whitelist, bounds clamps,
 * RGB validacija, bgAlpha range, bannerTemplate cap, auto-enable from
 * mysterySymbol state + feature kinds, explicit override, CSS/Markup/
 * Runtime shape, dead-branch check, ARIA wiring, RM hard kill,
 * determinism, vendor-neutral.
 */
import {
  defaultConfig,
  resolveConfig,
  emitMysteryRevealCSS,
  emitMysteryRevealMarkup,
  emitMysteryRevealRuntime,
} from '../../src/blocks/mysteryReveal.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/mysteryReveal.mjs');

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); console.log('  ✓', n); pass++; }
  catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; }
};
const eq  = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ok  = (c, m = '') => { if (!c) throw new Error(`expected truthy — ${m}`); };
const ct  = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };

console.log('— blocks/mysteryReveal.mjs —');

/* ─── defaults ──────────────────────────────────────────────────── */
t('defaultConfig: stable shape', () => {
  const c = defaultConfig();
  eq(c.enabled, false);
  eq(c.showBanner, true);
  eq(c.delayMs, 320);
  eq(c.durationMs, 900);
  eq(c.autoCloseMs, 200);
  eq(c.bannerTemplate, 'MYSTERY: {SYM}');
  eq(c.haloColor, '180,120,255');
  eq(c.fgColor, '255,255,255');
  eq(c.bgAlpha, 0.6);
  eq(c.position, 'center');
  eq(c.haptic, false);
});
t('defaultConfig isolated copy', () => {
  const a = defaultConfig(); const b = defaultConfig();
  a.enabled = true; a.durationMs = 9999;
  eq(b.enabled, false); eq(b.durationMs, 900);
});

/* ─── enable toggle ────────────────────────────────────────────── */
t('explicit enabled:true wins', () => {
  eq(resolveConfig({ mysteryReveal: { enabled: true } }).enabled, true);
});
t('explicit enabled:false wins', () => {
  eq(resolveConfig({ mysteryReveal: { enabled: false } }).enabled, false);
});

/* ─── position ──────────────────────────────────────────────────── */
t('position whitelist (top/center/bottom)', () => {
  for (const p of ['top', 'center', 'bottom']) {
    eq(resolveConfig({ mysteryReveal: { enabled: true, position: p } }).position, p);
  }
});
t('position invalid falls back to center', () => {
  eq(resolveConfig({ mysteryReveal: { enabled: true, position: 'left' } }).position, 'center');
});

/* ─── bounds ────────────────────────────────────────────────────── */
t('delayMs low/mid/high accepted', () => {
  eq(resolveConfig({ mysteryReveal: { enabled: true, delayMs: 0 } }).delayMs, 0);
  eq(resolveConfig({ mysteryReveal: { enabled: true, delayMs: 1500 } }).delayMs, 1500);
  eq(resolveConfig({ mysteryReveal: { enabled: true, delayMs: 3000 } }).delayMs, 3000);
});
t('delayMs out-of-bounds rejected', () => {
  eq(resolveConfig({ mysteryReveal: { enabled: true, delayMs: -5 } }).delayMs, 320);
  eq(resolveConfig({ mysteryReveal: { enabled: true, delayMs: 9999 } }).delayMs, 320);
  eq(resolveConfig({ mysteryReveal: { enabled: true, delayMs: 'wat' } }).delayMs, 320);
});
t('durationMs bounds', () => {
  eq(resolveConfig({ mysteryReveal: { enabled: true, durationMs: 200 } }).durationMs, 200);
  eq(resolveConfig({ mysteryReveal: { enabled: true, durationMs: 6000 } }).durationMs, 6000);
  eq(resolveConfig({ mysteryReveal: { enabled: true, durationMs: 100 } }).durationMs, 900);
  eq(resolveConfig({ mysteryReveal: { enabled: true, durationMs: 99999 } }).durationMs, 900);
});
t('autoCloseMs bounds', () => {
  eq(resolveConfig({ mysteryReveal: { enabled: true, autoCloseMs: 0 } }).autoCloseMs, 0);
  eq(resolveConfig({ mysteryReveal: { enabled: true, autoCloseMs: 4000 } }).autoCloseMs, 4000);
  eq(resolveConfig({ mysteryReveal: { enabled: true, autoCloseMs: -1 } }).autoCloseMs, 200);
  eq(resolveConfig({ mysteryReveal: { enabled: true, autoCloseMs: 9999 } }).autoCloseMs, 200);
});

/* ─── strings + colors + alpha ──────────────────────────────────── */
t('haloColor RGB validation', () => {
  eq(resolveConfig({ mysteryReveal: { enabled: true, haloColor: '12,34,56' } }).haloColor, '12,34,56');
  eq(resolveConfig({ mysteryReveal: { enabled: true, haloColor: 'purple' } }).haloColor, '180,120,255');
  eq(resolveConfig({ mysteryReveal: { enabled: true, haloColor: '256,0,0' } }).haloColor, '180,120,255');
});
t('fgColor RGB validation', () => {
  eq(resolveConfig({ mysteryReveal: { enabled: true, fgColor: '10,20,30' } }).fgColor, '10,20,30');
  eq(resolveConfig({ mysteryReveal: { enabled: true, fgColor: 'white' } }).fgColor, '255,255,255');
});
t('bannerTemplate length cap (48)', () => {
  eq(resolveConfig({ mysteryReveal: { enabled: true, bannerTemplate: '✨ {SYM} {N} ✨' } }).bannerTemplate, '✨ {SYM} {N} ✨');
  eq(resolveConfig({ mysteryReveal: { enabled: true, bannerTemplate: '' } }).bannerTemplate, 'MYSTERY: {SYM}');
  const tooLong = 'X'.repeat(49);
  eq(resolveConfig({ mysteryReveal: { enabled: true, bannerTemplate: tooLong } }).bannerTemplate, 'MYSTERY: {SYM}');
});
t('bgAlpha range [0,1]', () => {
  eq(resolveConfig({ mysteryReveal: { enabled: true, bgAlpha: 0 } }).bgAlpha, 0);
  eq(resolveConfig({ mysteryReveal: { enabled: true, bgAlpha: 0.85 } }).bgAlpha, 0.85);
  eq(resolveConfig({ mysteryReveal: { enabled: true, bgAlpha: 1 } }).bgAlpha, 1);
  eq(resolveConfig({ mysteryReveal: { enabled: true, bgAlpha: 1.5 } }).bgAlpha, 0.6);
  eq(resolveConfig({ mysteryReveal: { enabled: true, bgAlpha: -0.1 } }).bgAlpha, 0.6);
});
t('showBanner + haptic strict boolean', () => {
  eq(resolveConfig({ mysteryReveal: { enabled: true, showBanner: false } }).showBanner, false);
  eq(resolveConfig({ mysteryReveal: { enabled: true, showBanner: 'yes' } }).showBanner, true, 'truthy string ignored');
  eq(resolveConfig({ mysteryReveal: { enabled: true, haptic: true } }).haptic, true);
  eq(resolveConfig({ mysteryReveal: { enabled: true, haptic: 1 } }).haptic, false);
});

/* ─── auto-enable ──────────────────────────────────────────────── */
t('auto-enable: model.mysterySymbol.enabled', () => {
  eq(resolveConfig({ mysterySymbol: { enabled: true } }).enabled, true);
});
t('auto-enable: feature kind mystery_symbol', () => {
  eq(resolveConfig({ features: [{ kind: 'mystery_symbol' }] }).enabled, true);
});
t('auto-enable: feature kind mystery_reveal', () => {
  eq(resolveConfig({ features: [{ kind: 'mystery_reveal' }] }).enabled, true);
});
t('explicit enabled:false overrides auto', () => {
  eq(resolveConfig({ mysterySymbol: { enabled: true }, mysteryReveal: { enabled: false } }).enabled, false);
});
t('no mystery, no flag → stays disabled', () => {
  eq(resolveConfig({}).enabled, false);
});

/* ─── CSS emit ──────────────────────────────────────────────────── */
t('CSS disabled = empty', () => {
  eq(emitMysteryRevealCSS(defaultConfig()), '');
});
t('CSS enabled = host + label + keyframe + RM + mobile', () => {
  const css = emitMysteryRevealCSS(resolveConfig({ mysteryReveal: { enabled: true } }));
  ok(css.length > 500);
  ct(css, '.mystery-reveal',          'host class');
  ct(css, '.mr-label',                'label');
  ct(css, '@keyframes mrShow',        'keyframe');
  ct(css, 'prefers-reduced-motion',   'rm guard');
  ct(css, 'max-width: 480px',         'mobile rule');
});
t('CSS halo + fg + bgAlpha flow into rules', () => {
  const css = emitMysteryRevealCSS(resolveConfig({ mysteryReveal: { enabled: true, haloColor: '11,22,33', fgColor: '44,55,66', bgAlpha: 0.4 } }));
  ct(css, '11,22,33');
  ct(css, '44,55,66');
  ct(css, 'rgba(0, 0, 0, 0.4)');
});
t('CSS position-specific anchor', () => {
  ct(emitMysteryRevealCSS(resolveConfig({ mysteryReveal: { enabled: true, position: 'top' } })),    'top: 12%');
  ct(emitMysteryRevealCSS(resolveConfig({ mysteryReveal: { enabled: true, position: 'bottom' } })), 'bottom: 16%');
});

/* ─── Markup ────────────────────────────────────────────────────── */
t('markup disabled = empty', () => {
  eq(emitMysteryRevealMarkup(defaultConfig()), '');
});
t('markup enabled = host + ARIA + label child', () => {
  const m = emitMysteryRevealMarkup(resolveConfig({ mysteryReveal: { enabled: true } }));
  ct(m, 'id="mysteryReveal"');
  ct(m, 'role="status"');
  ct(m, 'aria-live="polite"');
  ct(m, 'aria-label="Mystery reveal"');
  ct(m, 'aria-hidden="true"');
  ct(m, 'data-active="false"');
  ct(m, 'class="mr-label"');
});

/* ─── Runtime ───────────────────────────────────────────────────── */
t('runtime disabled = empty', () => {
  eq(emitMysteryRevealRuntime(defaultConfig()), '');
});
t('runtime enabled = IIFE + HookBus + emits + binding', () => {
  const r = emitMysteryRevealRuntime(resolveConfig({ mysteryReveal: { enabled: true } }));
  ok(r.length > 800);
  ct(r, '(function _mysteryRevealRuntime()');
  ct(r, "HookBus.on('onSpinResult'");
  ct(r, "HookBus.emit('onMysteryRevealStart'");
  ct(r, "HookBus.emit('onMysteryRevealEnd'");
  ct(r, 'window.fireMysteryReveal');
  ct(r, '__MYSTERY_REVEAL__');
});
t('runtime bakes template literal', () => {
  const r = emitMysteryRevealRuntime(resolveConfig({ mysteryReveal: { enabled: true, bannerTemplate: 'MEGA {SYM}!' } }));
  ct(r, '"MEGA {SYM}!"');
});
t('runtime: showBanner flag baked', () => {
  const rOn  = emitMysteryRevealRuntime(resolveConfig({ mysteryReveal: { enabled: true, showBanner: true } }));
  const rOff = emitMysteryRevealRuntime(resolveConfig({ mysteryReveal: { enabled: true, showBanner: false } }));
  ct(rOn,  'MR_SHOW_BANNER  = true');
  ct(rOff, 'MR_SHOW_BANNER  = false');
});
t('runtime: start emit precedes end emit', () => {
  const r = emitMysteryRevealRuntime(resolveConfig({ mysteryReveal: { enabled: true } }));
  const iStart = r.indexOf("HookBus.emit('onMysteryRevealStart'");
  const iEnd   = r.indexOf("HookBus.emit('onMysteryRevealEnd'");
  ok(iStart > -1 && iEnd > -1);
  ok(iStart < iEnd);
});

/* ─── Determinism ───────────────────────────────────────────────── */
t('determinism: byte-identical CSS', () => {
  const m = { mysteryReveal: { enabled: true, position: 'top' } };
  eq(emitMysteryRevealCSS(resolveConfig(m)), emitMysteryRevealCSS(resolveConfig(m)));
});
t('determinism: byte-identical Markup', () => {
  const m = { mysteryReveal: { enabled: true } };
  eq(emitMysteryRevealMarkup(resolveConfig(m)), emitMysteryRevealMarkup(resolveConfig(m)));
});
t('determinism: byte-identical Runtime', () => {
  const m = { mysteryReveal: { enabled: true, durationMs: 1100 } };
  eq(emitMysteryRevealRuntime(resolveConfig(m)), emitMysteryRevealRuntime(resolveConfig(m)));
});

/* ─── Vendor-neutral ────────────────────────────────────────────── */
t('source vendor-neutral', () => {
  const src = readFileSync(SRC_PATH, 'utf8').toLowerCase();
  const BANNED = ['gates of olympus','wrath of olympus','reactoonz','sweet bonanza','sugar rush','megaways','netent','microgaming','pragmatic','lightning-link','cleopatra','buffalo','igt','cash eruption'];
  for (const v of BANNED) if (src.includes(v)) throw new Error('vendor leak: ' + v);
});

console.log(`\n  ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
