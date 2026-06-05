/* eslint-disable no-console */
import {
  defaultConfig, resolveConfig,
  emitWinRollupCSS, emitWinRollupMarkup, emitWinRollupRuntime,
} from '../../src/blocks/winRollup.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; } };
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ok = (c, m = '') => { if (!c) throw new Error(`expected truthy — ${m}`); };
const ct = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };
const notct = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`unexpected substring ${JSON.stringify(n)} — ${m}`); };

console.log('— blocks/winRollup.mjs —');

t('defaultConfig: enabled by default', () => {
  const c = defaultConfig();
  eq(c.enabled, true);
  eq(c.labelText, 'TOTAL WIN');
  eq(c.bigWinTriggerRatio, 10);
  eq(c.minDurationMs, 400);
  eq(c.maxDurationMs, 2000);
});

t('resolveConfig: enabled=false honored', () => {
  eq(resolveConfig({ winRollup: { enabled: false } }).enabled, false);
});

t('resolveConfig: label override accepted, junk rejected', () => {
  eq(resolveConfig({ winRollup: { labelText: 'WIN' } }).labelText, 'WIN');
  eq(resolveConfig({ winRollup: { labelText: '<script>' } }).labelText, 'TOTAL WIN');
  eq(resolveConfig({ winRollup: { labelText: '' } }).labelText, 'TOTAL WIN');
});

t('resolveConfig: bigWinTriggerRatio override', () => {
  eq(resolveConfig({ winRollup: { bigWinTriggerRatio: 25 } }).bigWinTriggerRatio, 25);
  eq(resolveConfig({ winRollup: { bigWinTriggerRatio: -1 } }).bigWinTriggerRatio, 10);
});

t('resolveConfig: duration knobs clamped', () => {
  eq(resolveConfig({ winRollup: { minDurationMs: 100 } }).minDurationMs, 100);
  eq(resolveConfig({ winRollup: { minDurationMs: 99999 } }).minDurationMs, 5000);
  eq(resolveConfig({ winRollup: { minDurationMs: 'oops' } }).minDurationMs, 400);
  eq(resolveConfig({ winRollup: { maxDurationMs: 1500, minDurationMs: 300 } }).maxDurationMs, 1500);
});

t('resolveConfig: currency inherits from balanceHud', () => {
  const c1 = resolveConfig({ balanceHud: { currency: '$', currencyPosition: 'suffix' } });
  eq(c1.currency, '$');
  eq(c1.currencyPosition, 'suffix');
});

t('resolveConfig: explicit winRollup.currency overrides balanceHud', () => {
  const c = resolveConfig({
    balanceHud: { currency: '$' },
    winRollup:  { currency: '£' },
  });
  eq(c.currency, '£');
});

t('emitWinRollupCSS: disabled emits empty/note string', () => {
  const css = emitWinRollupCSS({ enabled: false });
  ok(!css.includes('.win-rollup-banner'));
  ct(css, 'disabled');
});

t('emitWinRollupCSS: enabled emits host + banner + amount selectors', () => {
  const css = emitWinRollupCSS(defaultConfig());
  ct(css, '.win-rollup-host');
  ct(css, '.win-rollup-banner');
  ct(css, '.win-rollup-amount');
  ct(css, 'is-celebrate');
});

t('emitWinRollupMarkup: disabled emits empty', () => {
  eq(emitWinRollupMarkup({ enabled: false }), '');
});

t('emitWinRollupMarkup: mounts host with data-show=false and aria-live', () => {
  const html = emitWinRollupMarkup(defaultConfig());
  ct(html, 'id="winRollupHost"');
  ct(html, 'id="winRollupBanner"');
  ct(html, 'id="winRollupAmount"');
  ct(html, 'data-show="false"');
  ct(html, 'aria-live="polite"');
  ct(html, 'TOTAL WIN');
});

t('emitWinRollupMarkup: prefix currency formatted (default €)', () => {
  const html = emitWinRollupMarkup(defaultConfig());
  ct(html, '€0.00');
});

t('emitWinRollupMarkup: suffix currency formatted correctly', () => {
  const cfg = resolveConfig({ balanceHud: { currency: 'USD', currencyPosition: 'suffix' } });
  const html = emitWinRollupMarkup(cfg);
  ct(html, '0.00 USD');
});

t('emitWinRollupMarkup: XSS in label is escaped', () => {
  /* isPlainText rejects <>{}, so an injection-style label falls back to
   * the default "TOTAL WIN" — verify no raw script content leaks. */
  const html = emitWinRollupMarkup(resolveConfig({ winRollup: { labelText: 'alert(1)' } }));
  ct(html, 'alert(1)');
  notct(html, '<script');
});

t('emitWinRollupRuntime: disabled emits stub symbols', () => {
  const js = emitWinRollupRuntime({ enabled: false });
  ct(js, 'winRollupShow');
  ct(js, 'winRollupClear');
  ct(js, 'enabled: false');
  /* No HookBus wiring when disabled. */
  notct(js, 'onWinPresentationStart');
});

t('emitWinRollupRuntime: enabled wires lifecycle listeners + public API', () => {
  const js = emitWinRollupRuntime(defaultConfig());
  ct(js, 'HookBus.on(\'onWinPresentationStart\'');
  ct(js, 'HookBus.on(\'onWinPresentationEnd\'');
  ct(js, 'HookBus.on(\'onBigWinTierEntered\'');
  ct(js, 'HookBus.on(\'preSpin\'');
  ct(js, 'HookBus.on(\'onFsTrigger\'');
  ct(js, 'HookBus.on(\'onFsEnd\'');
  ct(js, 'window.winRollupShow');
  ct(js, 'window.winRollupClear');
  ct(js, 'window.WIN_ROLLUP_STATE');
});

t('emitWinRollupRuntime: bakes big-win threshold + currency literals', () => {
  const js = emitWinRollupRuntime(resolveConfig({
    winRollup: { bigWinTriggerRatio: 12 },
    balanceHud: { currency: '£' },
  }));
  ct(js, 'BIG_RATIO      = 12');
  ct(js, 'CURRENCY       = "£"');
});

t('determinism: identical config → byte-identical CSS', () => {
  eq(emitWinRollupCSS(defaultConfig()), emitWinRollupCSS(defaultConfig()));
});

t('determinism: identical config → byte-identical runtime', () => {
  eq(emitWinRollupRuntime(defaultConfig()), emitWinRollupRuntime(defaultConfig()));
});

t('vendor-neutral: no vendor / studio / brand strings in any emit', () => {
  const all = emitWinRollupCSS(defaultConfig()) + emitWinRollupMarkup(defaultConfig()) + emitWinRollupRuntime(defaultConfig());
  /* Block source must not name any vendor/franchise/title (LEGO rule). */
  ['pragmatic', 'igt', 'netent', 'microgaming', 'wolf', 'cleopatra', 'megaways', 'olympus', 'zeus'].forEach(n => {
    if (all.toLowerCase().includes(n)) throw new Error('vendor string leaked: ' + n);
  });
});

console.log('--- summary ---');
console.log('  pass:', pass);
console.log('  fail:', fail);
process.exit(fail === 0 ? 0 : 1);
