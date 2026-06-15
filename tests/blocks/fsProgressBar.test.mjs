/* eslint-disable no-console */
/**
 * tests/blocks/fsProgressBar.test.mjs — Wave B69
 *
 * Unit suite for the FS Progress Bar block.
 */
import {
  defaultConfig, resolveConfig,
  emitFsProgressBarCSS, emitFsProgressBarMarkup, emitFsProgressBarRuntime,
} from '../../src/blocks/fsProgressBar.mjs';

let pass = 0, fail = 0;
const t  = (n, fn) => { try { fn(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; } };
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ok = (c, m = '') => { if (!c) throw new Error(`expected truthy — ${m}`); };
const ct = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };
const ne = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`unexpected substring ${JSON.stringify(n)} — ${m}`); };

console.log('— blocks/fsProgressBar.mjs —');

t('defaultConfig: disabled by default', () => {
  const c = defaultConfig();
  eq(c.enabled, false);
  eq(c.position, 'top-right');
  ok(c.labelTemplate.includes('{i}') && c.labelTemplate.includes('{n}'));
  ok(c.fontSizePx >= 11 && c.fontSizePx <= 18, 'font size within Apple HIG');
});

t('resolveConfig: auto-enable from feature kind free_spins', () => {
  const c = resolveConfig({ features: [{ kind: 'free_spins' }] });
  eq(c.enabled, true, 'free_spins kind must auto-enable');
});

t('resolveConfig: auto-enable from feature kind fs_round', () => {
  const c = resolveConfig({ features: [{ kind: 'fs_round' }] });
  eq(c.enabled, true);
});

t('resolveConfig: stays disabled without fs-style feature', () => {
  const c = resolveConfig({ features: [{ kind: 'tumble' }] });
  eq(c.enabled, false);
});

t('resolveConfig: explicit enabled=true overrides feature scan', () => {
  const c = resolveConfig({ fsProgressBar: { enabled: true } });
  eq(c.enabled, true);
});

t('resolveConfig: invalid position falls back to default', () => {
  const c = resolveConfig({ fsProgressBar: { enabled: true, position: 'middle' } });
  eq(c.position, 'top-right');
});

t('resolveConfig: rgb triplet validation', () => {
  const c = resolveConfig({ fsProgressBar: { enabled: true, barColor: '#ffcc00' } });
  eq(c.barColor, '255,210,90', 'hex string must be rejected, default kept');
  const c2 = resolveConfig({ fsProgressBar: { enabled: true, barColor: '0,128,255' } });
  eq(c2.barColor, '0,128,255');
});

t('resolveConfig: labelTemplate must contain both {i} and {n}', () => {
  const c = resolveConfig({ fsProgressBar: { enabled: true, labelTemplate: 'spin {i}' } });
  eq(c.labelTemplate, '{i} of {n}', 'malformed template falls back to default');
});

t('resolveConfig: fontSizePx clamped to Apple HIG floor / ceiling', () => {
  const c = resolveConfig({ fsProgressBar: { enabled: true, fontSizePx: 3 } });
  eq(c.fontSizePx, 11);
  const c2 = resolveConfig({ fsProgressBar: { enabled: true, fontSizePx: 999 } });
  eq(c2.fontSizePx, 18);
});

t('emitFsProgressBarCSS: empty when disabled', () => {
  eq(emitFsProgressBarCSS(defaultConfig()), '');
});

t('emitFsProgressBarCSS: contains progress + fill + reduced-motion gate', () => {
  const css = emitFsProgressBarCSS(resolveConfig({ fsProgressBar: { enabled: true } }));
  ct(css, '.fs-progress');
  ct(css, '.fs-progress__fill');
  ct(css, '@media (prefers-reduced-motion: reduce)');
  ct(css, 'transition: none', 'reduced-motion must kill the fill transition');
});

t('emitFsProgressBarCSS: positions vary by config', () => {
  const tr = emitFsProgressBarCSS(resolveConfig({ fsProgressBar: { enabled: true, position: 'top-right' } }));
  const bl = emitFsProgressBarCSS(resolveConfig({ fsProgressBar: { enabled: true, position: 'bottom-left' } }));
  ct(tr, 'right: 12px');
  ct(bl, 'left: 12px');
  ct(bl, 'bottom:');
});

t('emitFsProgressBarMarkup: empty when disabled', () => {
  eq(emitFsProgressBarMarkup(defaultConfig()), '');
});

t('emitFsProgressBarMarkup: ARIA wiring (role=progressbar + aria-valuemin/max/now + aria-live)', () => {
  const html = emitFsProgressBarMarkup(resolveConfig({ fsProgressBar: { enabled: true } }));
  ct(html, 'role="progressbar"');
  ct(html, 'aria-valuemin="0"');
  ct(html, 'aria-valuemax="0"');
  ct(html, 'aria-valuenow="0"');
  ct(html, 'aria-live="polite"', 'label region must announce updates');
  ct(html, 'id="fsProgress"');
});

t('emitFsProgressBarRuntime: disabled emits safe no-op stubs', () => {
  const rt = emitFsProgressBarRuntime(defaultConfig());
  ct(rt, 'window.fsProgressShow');
  ct(rt, 'window.fsProgressUpdate');
  ct(rt, 'window.fsProgressHide');
});

t('emitFsProgressBarRuntime: enabled wires onFsTrigger / onFsSpinResult / onFsRetrigger / onFsEnd', () => {
  const rt = emitFsProgressBarRuntime(resolveConfig({ fsProgressBar: { enabled: true } }));
  ct(rt, "HookBus.on('onFsTrigger'");
  ct(rt, "HookBus.on('onFsSpinResult'");
  ct(rt, "HookBus.on('onFsRetrigger'");
  ct(rt, "HookBus.on('onFsEnd'");
});

t('emitFsProgressBarRuntime: total clamped to MAX_TOTAL', () => {
  const rt = emitFsProgressBarRuntime(resolveConfig({ fsProgressBar: { enabled: true } }));
  ct(rt, '999', 'MAX_TOTAL constant must be visible in runtime');
});

t('determinism: same config → byte-identical emits', () => {
  const cfg = resolveConfig({ fsProgressBar: { enabled: true } });
  eq(emitFsProgressBarCSS(cfg), emitFsProgressBarCSS(cfg));
  eq(emitFsProgressBarMarkup(cfg), emitFsProgressBarMarkup(cfg));
  eq(emitFsProgressBarRuntime(cfg), emitFsProgressBarRuntime(cfg));
});

t('vendor-neutral: no studio / game tokens in any emit', () => {
  const cfg = resolveConfig({ fsProgressBar: { enabled: true } });
  const all = emitFsProgressBarCSS(cfg) + emitFsProgressBarMarkup(cfg) + emitFsProgressBarRuntime(cfg);
  const banned = ['IGT', 'pragmatic', 'megaways', 'NetEnt', 'Cleopatra', 'Buffalo', 'Olympus', 'Wolf'];
  for (const w of banned) ne(all, w, `banned vendor token: ${w}`);
});

console.log('--- summary ---\n  pass:', pass, '\n  fail:', fail);
if (fail > 0) process.exit(1);
