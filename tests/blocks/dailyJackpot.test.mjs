/* eslint-disable no-console */
import {
  defaultConfig, resolveConfig,
  emitDailyJackpotCSS, emitDailyJackpotMarkup, emitDailyJackpotRuntime,
} from '../../src/blocks/dailyJackpot.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; } };
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ok = (c, m = '') => { if (!c) throw new Error(`expected truthy — ${m}`); };
const ct = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };
const notct = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`unexpected substring ${JSON.stringify(n)} — ${m}`); };

console.log('— blocks/dailyJackpot.mjs —');

t('defaultConfig: disabled by default (opt-in)', () => {
  const c = defaultConfig();
  eq(c.enabled, false);
  eq(c.labelText, 'DAILY JACKPOT');
  eq(c.resetUTCHour, 0);
  eq(c.minPoolAmount, 1000);
  eq(c.maxPoolAmount, 100000);
});

t('resolveConfig: enabled=true honored', () => {
  eq(resolveConfig({ dailyJackpot: { enabled: true } }).enabled, true);
});

t('resolveConfig: numeric clamps for resetUTCHour / triggerProbability', () => {
  eq(resolveConfig({ dailyJackpot: { resetUTCHour: 25 } }).resetUTCHour, 23, '24+ clamped to 23');
  eq(resolveConfig({ dailyJackpot: { resetUTCHour: -1 } }).resetUTCHour, 0, 'neg clamped to 0');
  eq(resolveConfig({ dailyJackpot: { triggerProbability: 5 } }).triggerProbability, 1, '> 1 clamped');
  eq(resolveConfig({ dailyJackpot: { triggerProbability: -0.1 } }).triggerProbability, 0, 'neg clamped');
});

t('resolveConfig: maxPool cannot drop below minPool', () => {
  const c = resolveConfig({ dailyJackpot: { minPoolAmount: 5000, maxPoolAmount: 1000 } });
  ok(c.maxPoolAmount >= c.minPoolAmount, 'max >= min invariant');
});

t('resolveConfig: contribRate clamped to [0,1]', () => {
  eq(resolveConfig({ dailyJackpot: { contribRate: 2 } }).contribRate, 1);
  eq(resolveConfig({ dailyJackpot: { contribRate: -1 } }).contribRate, 0);
  eq(resolveConfig({ dailyJackpot: { contribRate: 0.5 } }).contribRate, 0.5);
});

t('resolveConfig: holdMs clamped to [500, 30000]', () => {
  eq(resolveConfig({ dailyJackpot: { holdMs: 100 } }).holdMs, 500);
  eq(resolveConfig({ dailyJackpot: { holdMs: 99999 } }).holdMs, 30000);
});

t('resolveConfig: label XSS rejected, valid label accepted', () => {
  eq(resolveConfig({ dailyJackpot: { labelText: '<script>' } }).labelText, 'DAILY JACKPOT');
  eq(resolveConfig({ dailyJackpot: { labelText: 'MEGA POOL' } }).labelText, 'MEGA POOL');
});

t('resolveConfig: currency inherits from balanceHud', () => {
  const c = resolveConfig({ dailyJackpot: { enabled: true }, balanceHud: { currency: '$' } });
  eq(c.currency, '$');
});

t('resolveConfig: explicit dailyJackpot.currency overrides balanceHud', () => {
  const c = resolveConfig({ dailyJackpot: { enabled: true, currency: '¥' }, balanceHud: { currency: '$' } });
  eq(c.currency, '¥');
});

t('emitDailyJackpotCSS: disabled emits stub note string', () => {
  const css = emitDailyJackpotCSS(defaultConfig());
  ct(css, 'disabled by GDD');
  notct(css, '@keyframes');
  notct(css, '.dailyJackpot-banner');
});

t('emitDailyJackpotCSS: enabled emits banner + keyframes + reduced-motion', () => {
  const css = emitDailyJackpotCSS(resolveConfig({ dailyJackpot: { enabled: true } }));
  ct(css, '.dailyJackpot-host');
  ct(css, '.dailyJackpot-banner');
  ct(css, '@keyframes dailyJackpot-enter');
  ct(css, '@media (prefers-reduced-motion: reduce)');
});

t('emitDailyJackpotMarkup: disabled emits empty', () => {
  eq(emitDailyJackpotMarkup(defaultConfig()), '');
});

t('emitDailyJackpotMarkup: enabled mounts host + label + amount with ARIA', () => {
  const html = emitDailyJackpotMarkup(resolveConfig({ dailyJackpot: { enabled: true } }));
  ct(html, 'id="dailyJackpotHost"');
  ct(html, 'id="dailyJackpotAmount"');
  ct(html, 'role="status"');
  ct(html, 'aria-live="polite"');
  ct(html, 'DAILY JACKPOT');
  ct(html, 'data-show="false"');
});

t('emitDailyJackpotMarkup: XSS in label is escaped', () => {
  const html = emitDailyJackpotMarkup(resolveConfig({ dailyJackpot: { enabled: true, labelText: 'CASH<>POOL' } }));
  /* invalid label rejected by resolveConfig — default used */
  ct(html, 'DAILY JACKPOT');
  notct(html, '<>');
});

t('emitDailyJackpotRuntime: disabled emits stub symbols + safe noop window API', () => {
  const rt = emitDailyJackpotRuntime(defaultConfig());
  ct(rt, 'DAILY_JACKPOT_STATE');
  ct(rt, 'enabled: false');
  ct(rt, 'window.dailyJackpotShow');
  ct(rt, 'window.dailyJackpotForce');
});

t('emitDailyJackpotRuntime: enabled wires preSpin/postSpin/onFs/onBigWin listeners', () => {
  const rt = emitDailyJackpotRuntime(resolveConfig({ dailyJackpot: { enabled: true } }));
  ct(rt, "HookBus.on('preSpin'");
  ct(rt, "HookBus.on('postSpin'");
  ct(rt, "HookBus.on('onFsTrigger'");
  ct(rt, "HookBus.on('onFsEnd'");
  ct(rt, "HookBus.on('onBigWinTierEntered'");
  ct(rt, "HookBus.on('onBigWinTierExited'");
});

t('emitDailyJackpotRuntime: bakes config literals into source', () => {
  const rt = emitDailyJackpotRuntime(resolveConfig({ dailyJackpot: { enabled: true, holdMs: 7500, triggerProbability: 0.0001 } }));
  ct(rt, '7500');
  ct(rt, '0.0001');
});

t('emitDailyJackpotRuntime: HookBus emit onDailyJackpotAward declared', () => {
  const rt = emitDailyJackpotRuntime(resolveConfig({ dailyJackpot: { enabled: true } }));
  ct(rt, "HookBus.emit('onDailyJackpotAward'");
});

t('determinism: identical config → byte-identical CSS', () => {
  const c = resolveConfig({ dailyJackpot: { enabled: true } });
  eq(emitDailyJackpotCSS(c), emitDailyJackpotCSS(c));
});

t('determinism: identical config → byte-identical runtime', () => {
  const c = resolveConfig({ dailyJackpot: { enabled: true } });
  eq(emitDailyJackpotRuntime(c), emitDailyJackpotRuntime(c));
});

t('vendor-neutral: no vendor / studio / brand strings in any emit', () => {
  const c = resolveConfig({ dailyJackpot: { enabled: true } });
  const all = emitDailyJackpotCSS(c) + emitDailyJackpotMarkup(c) + emitDailyJackpotRuntime(c);
  ['pragmatic', 'igt', 'netent', 'microgaming', 'wolf', 'cleopatra', 'megaways', 'olympus', 'zeus', 'cash eruption'].forEach(n => {
    if (all.toLowerCase().includes(n)) throw new Error('vendor string leaked: ' + n);
  });
});

console.log('--- summary ---');
console.log('  pass:', pass);
console.log('  fail:', fail);
process.exit(fail === 0 ? 0 : 1);
