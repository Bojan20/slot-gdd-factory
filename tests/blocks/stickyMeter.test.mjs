/* eslint-disable no-console */
/**
 * stickyMeter block unit tests (Wave W47.S14 — B70).
 *
 * Coverage:
 *   • defaultConfig stability + frozen shape
 *   • resolveConfig:
 *     - enabled toggle + auto-enable on sticky-family declarations
 *     - position whitelist
 *     - numeric clamps (maxCap, fontSizePx, flashMs, zIndex)
 *     - showMaxCap / showInBase booleans
 *     - color / selector / label overrides
 *   • CSS emit: disabled = empty; enabled = host + data-change variants
 *     + prefers-reduced-motion guard + safe-area-inset positioning
 *   • Markup emit: disabled = empty; enabled = role="status", aria-live,
 *     aria-label, initial data-count="0"
 *   • Runtime emit: disabled = empty; enabled = IIFE with HookBus
 *     listeners on all six lifecycle events
 *   • LEGO discipline: emits exactly the owner declared in lego-gate
 *     (onStickyCountChange)
 *   • Vendor-neutral: no studio / game names in emitted artefacts
 *   • Determinism: same config → byte-identical CSS
 */
import {
  defaultConfig,
  resolveConfig,
  emitStickyMeterCSS,
  emitStickyMeterMarkup,
  emitStickyMeterRuntime,
} from '../../src/blocks/stickyMeter.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); console.log('  ✓', n); pass++; }
  catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; }
};
const eq  = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ok  = (c, m = '') => { if (!c) throw new Error(`expected truthy — ${m}`); };
const ct  = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };
const nct = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`unexpected substring ${JSON.stringify(n)} — ${m}`); };

console.log('— blocks/stickyMeter.mjs —');

/* ─── defaultConfig ───────────────────────────────────────────────── */
t('defaultConfig: frozen + stable shape', () => {
  const c = defaultConfig();
  eq(Object.isFrozen(c), true, 'defaultConfig should return a frozen object');
  eq(c.enabled, false);
  eq(c.maxCap, 30);
  eq(c.showMaxCap, true);
  eq(c.position, 'bottom-left');
  eq(c.fontSizePx, 12);
  eq(c.flashMs, 220);
  eq(c.zIndex, 34);
  eq(c.showInBase, false);
});

t('defaultConfig: same call returns same frozen snapshot', () => {
  const a = defaultConfig();
  const b = defaultConfig();
  /* Frozen object is safe to share — both calls compare structurally. */
  eq(a.enabled, b.enabled);
  eq(a.maxCap, b.maxCap);
});

/* ─── resolveConfig ────────────────────────────────────────────────── */
t('resolveConfig: empty model → defaults (disabled)', () => {
  const c = resolveConfig({});
  eq(c.enabled, false);
});

t('resolveConfig: explicit enabled=true honored', () => {
  eq(resolveConfig({ stickyMeter: { enabled: true } }).enabled, true);
});

t('resolveConfig: explicit enabled=false honored (overrides auto)', () => {
  eq(resolveConfig({
    stickyWild: { enabled: true },
    stickyMeter: { enabled: false },
  }).enabled, false);
});

t('resolveConfig: auto-enable on stickyWild declaration', () => {
  eq(resolveConfig({ stickyWild: { enabled: true } }).enabled, true);
});

t('resolveConfig: auto-enable on expandingWild declaration', () => {
  eq(resolveConfig({ expandingWild: {} }).enabled, true);
});

t('resolveConfig: auto-enable on holdAndWin declaration', () => {
  eq(resolveConfig({ holdAndWin: {} }).enabled, true);
});

t('resolveConfig: position whitelist', () => {
  eq(resolveConfig({ stickyMeter: { enabled: true, position: 'top-left' } }).position, 'top-left');
  eq(resolveConfig({ stickyMeter: { enabled: true, position: 'top-right' } }).position, 'top-right');
  eq(resolveConfig({ stickyMeter: { enabled: true, position: 'bottom-right' } }).position, 'bottom-right');
  eq(resolveConfig({ stickyMeter: { enabled: true, position: 'INVALID' } }).position, 'bottom-left');
});

t('resolveConfig: maxCap clamped [1,999]', () => {
  eq(resolveConfig({ stickyMeter: { enabled: true, maxCap: 50 } }).maxCap, 50);
  eq(resolveConfig({ stickyMeter: { enabled: true, maxCap: 0 } }).maxCap, 1);
  eq(resolveConfig({ stickyMeter: { enabled: true, maxCap: 9999 } }).maxCap, 999);
  eq(resolveConfig({ stickyMeter: { enabled: true, maxCap: 'NaN' } }).maxCap, 30);
});

t('resolveConfig: fontSizePx clamped [11,22] — Apple HIG floor', () => {
  eq(resolveConfig({ stickyMeter: { enabled: true, fontSizePx: 14 } }).fontSizePx, 14);
  eq(resolveConfig({ stickyMeter: { enabled: true, fontSizePx: 8 } }).fontSizePx, 11);
  eq(resolveConfig({ stickyMeter: { enabled: true, fontSizePx: 999 } }).fontSizePx, 22);
});

t('resolveConfig: flashMs clamped [120,1000]', () => {
  eq(resolveConfig({ stickyMeter: { enabled: true, flashMs: 300 } }).flashMs, 300);
  eq(resolveConfig({ stickyMeter: { enabled: true, flashMs: 50 } }).flashMs, 120);
  eq(resolveConfig({ stickyMeter: { enabled: true, flashMs: 9999 } }).flashMs, 1000);
});

t('resolveConfig: zIndex clamped [10,99]', () => {
  eq(resolveConfig({ stickyMeter: { enabled: true, zIndex: 50 } }).zIndex, 50);
  eq(resolveConfig({ stickyMeter: { enabled: true, zIndex: 0 } }).zIndex, 10);
  eq(resolveConfig({ stickyMeter: { enabled: true, zIndex: 9999 } }).zIndex, 99);
});

t('resolveConfig: showMaxCap boolean override', () => {
  eq(resolveConfig({ stickyMeter: { enabled: true, showMaxCap: false } }).showMaxCap, false);
  eq(resolveConfig({ stickyMeter: { enabled: true, showMaxCap: 'truthy' } }).showMaxCap, true); /* strict boolean only */
});

t('resolveConfig: showInBase boolean override', () => {
  eq(resolveConfig({ stickyMeter: { enabled: true, showInBase: true } }).showInBase, true);
  eq(resolveConfig({ stickyMeter: { enabled: true, showInBase: 'yes' } }).showInBase, false);
});

t('resolveConfig: custom stickySelector accepted', () => {
  const c = resolveConfig({ stickyMeter: { enabled: true, stickySelector: '.cell--bonus' } });
  eq(c.stickySelector, '.cell--bonus');
});

t('resolveConfig: empty stickySelector falls back to default', () => {
  const c = resolveConfig({ stickyMeter: { enabled: true, stickySelector: '' } });
  ct(c.stickySelector, '.cell--sticky');
});

t('resolveConfig: labelTemplate / labelTemplateWithMax override', () => {
  const c = resolveConfig({
    stickyMeter: { enabled: true, labelTemplate: 'STK {N}', labelTemplateWithMax: 'STK {N}/{M}' },
  });
  eq(c.labelTemplate, 'STK {N}');
  eq(c.labelTemplateWithMax, 'STK {N}/{M}');
});

t('resolveConfig: color overrides accepted', () => {
  const c = resolveConfig({
    stickyMeter: { enabled: true, bgColor: '#222', fgColor: '#fff', accentColor: '#0ff' },
  });
  eq(c.bgColor, '#222');
  eq(c.fgColor, '#fff');
  eq(c.accentColor, '#0ff');
});

/* ─── CSS emit ─────────────────────────────────────────────────────── */
t('emitStickyMeterCSS: disabled → empty', () => {
  eq(emitStickyMeterCSS({ enabled: false }), '');
});

t('emitStickyMeterCSS: enabled → host + data-change + data-full', () => {
  const cfg = resolveConfig({ stickyMeter: { enabled: true } });
  const out = emitStickyMeterCSS(cfg);
  ct(out, '.sticky-meter');
  ct(out, '[data-visible="true"]');
  ct(out, '[data-change="up"]');
  ct(out, '[data-full="true"]');
});

t('emitStickyMeterCSS: prefers-reduced-motion guard with motion-kill', () => {
  const out = emitStickyMeterCSS(resolveConfig({ stickyMeter: { enabled: true } }));
  ct(out, '@media (prefers-reduced-motion: reduce)');
  /* A4 audit demands one of: animation:none / transition:none / transform:none. */
  ct(out, 'transition: none');
  ct(out, 'transform: none');
});

t('emitStickyMeterCSS: safe-area-inset baked into anchor edges', () => {
  for (const pos of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
    const out = emitStickyMeterCSS(resolveConfig({ stickyMeter: { enabled: true, position: pos } }));
    ct(out, 'env(safe-area-inset-', `position ${pos} must use safe-area-inset`);
  }
});

t('emitStickyMeterCSS: position affects CSS edge keys', () => {
  const tl = emitStickyMeterCSS(resolveConfig({ stickyMeter: { enabled: true, position: 'top-left' } }));
  const br = emitStickyMeterCSS(resolveConfig({ stickyMeter: { enabled: true, position: 'bottom-right' } }));
  ct(tl, 'top:'); ct(tl, 'left:');
  ct(br, 'bottom:'); ct(br, 'right:');
});

t('emitStickyMeterCSS: pointer-events:none (decoration only)', () => {
  const out = emitStickyMeterCSS(resolveConfig({ stickyMeter: { enabled: true } }));
  ct(out, 'pointer-events: none');
});

/* ─── Markup emit ──────────────────────────────────────────────────── */
t('emitStickyMeterMarkup: disabled → empty', () => {
  eq(emitStickyMeterMarkup({ enabled: false }), '');
});

t('emitStickyMeterMarkup: enabled emits id + role + aria-live', () => {
  const out = emitStickyMeterMarkup(resolveConfig({ stickyMeter: { enabled: true } }));
  ct(out, 'id="stickyMeter"');
  ct(out, 'role="status"');
  ct(out, 'aria-live="polite"');
  ct(out, 'aria-label="Sticky symbol count"');
  ct(out, 'data-visible="false"');
  ct(out, 'data-count="0"');
});

t('emitStickyMeterMarkup: label renders with {N} → 0 + {M} → maxCap', () => {
  const out = emitStickyMeterMarkup(resolveConfig({ stickyMeter: { enabled: true, maxCap: 12 } }));
  ct(out, 'STICKY 0/12');
});

t('emitStickyMeterMarkup: showMaxCap=false uses bare labelTemplate', () => {
  const out = emitStickyMeterMarkup(resolveConfig({ stickyMeter: { enabled: true, showMaxCap: false } }));
  ct(out, 'STICKY 0');
  /* Bare template renders "STICKY 0", with-max would be "STICKY 0/30" —
     verify the "0/" pattern (label slash) is absent without touching the
     "</div>" closing-tag slash. */
  nct(out, '0/');
});

/* ─── Runtime emit ─────────────────────────────────────────────────── */
t('emitStickyMeterRuntime: disabled → empty', () => {
  eq(emitStickyMeterRuntime({ enabled: false }), '');
});

t('emitStickyMeterRuntime: enabled wires all 6 lifecycle listeners', () => {
  const out = emitStickyMeterRuntime(resolveConfig({ stickyMeter: { enabled: true } }));
  ct(out, "HookBus.on('onFsTrigger'");
  ct(out, "HookBus.on('preSpin'");
  ct(out, "HookBus.on('postSpin'");
  ct(out, "HookBus.on('onSpinResult'");
  ct(out, "HookBus.on('onTumbleStep'");
  ct(out, "HookBus.on('onFsEnd'");
});

t('emitStickyMeterRuntime: emits onStickyCountChange', () => {
  const out = emitStickyMeterRuntime(resolveConfig({ stickyMeter: { enabled: true } }));
  ct(out, "HookBus.emit('onStickyCountChange'");
});

t('emitStickyMeterRuntime: probes DOM via configured selector', () => {
  const out = emitStickyMeterRuntime(resolveConfig({ stickyMeter: { enabled: true, stickySelector: '.cell--frozen' } }));
  ct(out, '.cell--frozen');
});

t('emitStickyMeterRuntime: showInBase=true shows immediately', () => {
  const on  = emitStickyMeterRuntime(resolveConfig({ stickyMeter: { enabled: true, showInBase: true } }));
  const off = emitStickyMeterRuntime(resolveConfig({ stickyMeter: { enabled: true, showInBase: false } }));
  ct(on, 'showInBase = true');
  ct(off, 'showInBase = false');
});

t('emitStickyMeterRuntime: defensive try/catch around DOM probe', () => {
  const out = emitStickyMeterRuntime(resolveConfig({ stickyMeter: { enabled: true } }));
  ct(out, 'try {');
  ct(out, 'catch');
});

t('emitStickyMeterRuntime: defensive guard on missing HookBus', () => {
  const out = emitStickyMeterRuntime(resolveConfig({ stickyMeter: { enabled: true } }));
  ct(out, '!window.HookBus');
});

/* ─── Determinism ──────────────────────────────────────────────────── */
t('determinism: same config → byte-identical CSS', () => {
  const cfg = resolveConfig({ stickyMeter: { enabled: true } });
  eq(emitStickyMeterCSS(cfg), emitStickyMeterCSS(cfg));
});

t('determinism: same config → byte-identical Markup', () => {
  const cfg = resolveConfig({ stickyMeter: { enabled: true } });
  eq(emitStickyMeterMarkup(cfg), emitStickyMeterMarkup(cfg));
});

t('determinism: same config → byte-identical Runtime', () => {
  const cfg = resolveConfig({ stickyMeter: { enabled: true } });
  eq(emitStickyMeterRuntime(cfg), emitStickyMeterRuntime(cfg));
});

/* ─── Vendor neutrality ────────────────────────────────────────────── */
t('vendor-neutral: no studio / game names in emitted artefacts', () => {
  const cfg = resolveConfig({ stickyMeter: { enabled: true } });
  const out = emitStickyMeterCSS(cfg)
            + emitStickyMeterMarkup(cfg)
            + emitStickyMeterRuntime(cfg);
  const lower = out.toLowerCase();
  for (const bad of [
    'gates of olympus', 'wrath of olympus', 'reactoonz', 'sweet bonanza',
    'sugar rush', 'megaways', 'netent', 'microgaming', 'pragmatic',
    'lightning link', 'cleopatra', 'buffalo', 'cash eruption',
  ]) {
    nct(lower, bad, `vendor mention: ${bad}`);
  }
});

console.log(`\n  ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
