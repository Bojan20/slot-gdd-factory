/* eslint-disable no-console */
/**
 * Wave V7 — symbolInfoPopover block unit tests.
 *
 * Coverage:
 *   • defaultConfig + resolveConfig validation (bounded knobs, RGB)
 *   • emitSymbolInfoPopoverCSS: disabled = empty, enabled = popover rules
 *   • emitSymbolInfoPopoverMarkup: hidden host div present / absent
 *   • emitSymbolInfoPopoverRuntime: enabled/disabled branches + lifecycle
 *     listeners + toggle semantic
 *   • Vendor-neutrality: no game / vendor names
 */
import {
  defaultConfig,
  resolveConfig,
  emitSymbolInfoPopoverCSS,
  emitSymbolInfoPopoverMarkup,
  emitSymbolInfoPopoverRuntime,
} from '../../src/blocks/symbolInfoPopover.mjs';

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

console.log('— blocks/symbolInfoPopover.mjs —');

/* ── defaultConfig + resolveConfig ────────────────────────────── */

t('defaultConfig: stable shape', () => {
  const c = defaultConfig();
  eq(c.enabled, true);
  eq(c.autoHideMs, 2400);
  eq(c.accentColor, '255,214,110');
  eq(c.bgColor, '10,12,18');
  eq(c.textColor, '245,242,228');
  eq(c.showTierBadge, true);
  eq(c.showPayoutHint, true);
});

t('defaultConfig: returns fresh copy', () => {
  const a = defaultConfig();
  const b = defaultConfig();
  ok(a !== b, 'separate objects');
  a.enabled = false;
  eq(b.enabled, true, 'mutation does not leak');
});

t('resolveConfig: empty model → defaults', () => {
  const c = resolveConfig({});
  eq(c.enabled, true);
  eq(c.autoHideMs, 2400);
});

t('resolveConfig: autoHideMs bounded 400..8000', () => {
  eq(resolveConfig({ symbolInfoPopover: { autoHideMs: 1500 } }).autoHideMs, 1500);
  eq(resolveConfig({ symbolInfoPopover: { autoHideMs: 200 } }).autoHideMs, 2400);
  eq(resolveConfig({ symbolInfoPopover: { autoHideMs: 99999 } }).autoHideMs, 2400);
});

t('resolveConfig: enabled=false honored', () => {
  eq(resolveConfig({ symbolInfoPopover: { enabled: false } }).enabled, false);
});

t('resolveConfig: RGB validation', () => {
  eq(resolveConfig({ symbolInfoPopover: { accentColor: '50,100,150' } }).accentColor, '50,100,150');
  eq(resolveConfig({ symbolInfoPopover: { accentColor: 'gold' } }).accentColor, '255,214,110');
  eq(resolveConfig({ symbolInfoPopover: { accentColor: '999,1000,2000' } }).accentColor, '255,214,110');
});

t('resolveConfig: showTierBadge / showPayoutHint flip false', () => {
  const c = resolveConfig({ symbolInfoPopover: { showTierBadge: false, showPayoutHint: false } });
  eq(c.showTierBadge, false);
  eq(c.showPayoutHint, false);
});

/* ── emitSymbolInfoPopoverCSS ─────────────────────────────────── */

t('emitSymbolInfoPopoverCSS: disabled → empty/comment', () => {
  const css = emitSymbolInfoPopoverCSS({ enabled: false });
  ok(!css.includes('.symbolInfoPopover {'), 'no rules when disabled');
});

t('emitSymbolInfoPopoverCSS: enabled emits .symbolInfoPopover + .is-open', () => {
  const css = emitSymbolInfoPopoverCSS();
  ct(css, '.symbolInfoPopover');
  ct(css, '.is-open');
  ct(css, 'prefers-reduced-motion');
});

t('emitSymbolInfoPopoverCSS: bakes accent color literal', () => {
  const css = emitSymbolInfoPopoverCSS({ ...defaultConfig(), accentColor: '50,100,150' });
  ct(css, 'rgba(50,100,150');
});

/* ── emitSymbolInfoPopoverMarkup ──────────────────────────────── */

t('emitSymbolInfoPopoverMarkup: enabled emits host div', () => {
  const m = emitSymbolInfoPopoverMarkup();
  ct(m, 'id="symbolInfoPopover"');
  ct(m, 'role="tooltip"');
  ct(m, 'aria-hidden="true"');
});

t('emitSymbolInfoPopoverMarkup: disabled emits nothing', () => {
  eq(emitSymbolInfoPopoverMarkup({ enabled: false }), '');
});

/* ── emitSymbolInfoPopoverRuntime ─────────────────────────────── */

t('emitSymbolInfoPopoverRuntime: disabled emits stubs', () => {
  const js = emitSymbolInfoPopoverRuntime({ enabled: false });
  ct(js, 'disabled by GDD');
  ct(js, 'window.showSymbolInfo  = function () {}');
  ct(js, 'window.hideSymbolInfo  = function () {}');
});

t('emitSymbolInfoPopoverRuntime: enabled emits showSymbolInfo + hideSymbolInfo', () => {
  const js = emitSymbolInfoPopoverRuntime();
  ct(js, 'function showSymbolInfo(cellEl)');
  ct(js, 'function hideSymbolInfo()');
  ct(js, 'window.showSymbolInfo = showSymbolInfo');
  ct(js, 'window.hideSymbolInfo = hideSymbolInfo');
});

t('emitSymbolInfoPopoverRuntime: registers lifecycle listeners', () => {
  const js = emitSymbolInfoPopoverRuntime();
  ct(js, "HookBus.on('preSpin'");
  ct(js, "HookBus.on('onFsTrigger'");
  ct(js, "HookBus.on('onFsEnd'");
});

t('emitSymbolInfoPopoverRuntime: delegated click + Escape handler wired', () => {
  const js = emitSymbolInfoPopoverRuntime();
  ct(js, "document.addEventListener('click'");
  ct(js, "document.addEventListener('keydown'");
  ct(js, "e.key === 'Escape'");
});

t('emitSymbolInfoPopoverRuntime: bakes autoHideMs as literal', () => {
  const js = emitSymbolInfoPopoverRuntime({ ...defaultConfig(), autoHideMs: 3000 });
  ct(js, 'SYMBOL_INFO_POPOVER_AUTO_HIDE_MS = 3000');
});

t('emitSymbolInfoPopoverRuntime: exposes SYMBOL_INFO_POPOVER_STATE', () => {
  const js = emitSymbolInfoPopoverRuntime();
  ct(js, 'window.SYMBOL_INFO_POPOVER_STATE');
});

t('emitSymbolInfoPopoverRuntime: toggle semantic (second tap closes)', () => {
  const js = emitSymbolInfoPopoverRuntime();
  /* The toggle is implemented as `if (_sipLastCell === cell) hideSymbolInfo()`. */
  ct(js, '_sipLastCell === cell');
});

t('emitSymbolInfoPopoverRuntime: hides on outside click', () => {
  const js = emitSymbolInfoPopoverRuntime();
  /* Outer dispatch ends with `hideSymbolInfo()` for any non-.cell target. */
  ct(js, "e.target && e.target.closest ? e.target.closest('.cell') : null");
});

/* ── Hygiene ── */

t('determinism: same config → byte-identical CSS', () => {
  eq(emitSymbolInfoPopoverCSS(defaultConfig()),
     emitSymbolInfoPopoverCSS(defaultConfig()));
});

t('vendor-neutral: no game / vendor names', () => {
  const all = emitSymbolInfoPopoverCSS(defaultConfig()) +
              emitSymbolInfoPopoverMarkup(defaultConfig()) +
              emitSymbolInfoPopoverRuntime(defaultConfig());
  for (const banned of [
    'gates', 'olympus', 'reactoonz', 'megaways', 'netent', 'wrath',
    'sweet bonanza', 'pragmatic', 'microgaming', 'playa-slot', 'crystal forge',
  ]) {
    nct(all.toLowerCase(), banned, 'banned: ' + banned);
  }
});

console.log(`\nV7 result: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
