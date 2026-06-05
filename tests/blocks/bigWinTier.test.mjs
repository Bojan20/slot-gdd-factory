/* eslint-disable no-console */
/**
 * tests/blocks/bigWinTier.test.mjs — Wave H5
 *
 * Unit suite for the Big-Win Tier ladder block. Covers:
 *   • defaultConfig / resolveConfig (threshold + label + duration + color
 *     validators, malformed-GDD fallbacks, feature-kind auto-enable)
 *   • CSS / markup emit shape (vendor-neutral string check)
 *   • Runtime stub correctness (disabled emit must not crash)
 *   • Runtime symbols present in enabled emit (window.bigWinTierEnter /
 *     Exit / __BIG_WIN_TIER__ / BIG_WIN_TIER_STATE)
 *   • Determinism (same config → byte-identical output)
 */
import {
  BIG_WIN_TIER_IDS,
  defaultConfig, resolveConfig,
  emitBigWinTierCSS, emitBigWinTierMarkup, emitBigWinTierRuntime,
} from '../../src/blocks/bigWinTier.mjs';

let pass = 0, fail = 0;
const t  = (n, fn) => { try { fn(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; } };
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ok = (c, m = '') => { if (!c) throw new Error(`expected truthy — ${m}`); };
const ct = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };
const ne = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`unexpected substring ${JSON.stringify(n)} — ${m}`); };

console.log('— blocks/bigWinTier.mjs —');

t('BIG_WIN_TIER_IDS is frozen [1..5]', () => {
  ok(Object.isFrozen(BIG_WIN_TIER_IDS), 'must be frozen');
  eq(BIG_WIN_TIER_IDS.length, 5);
  for (let i = 0; i < 5; i++) eq(BIG_WIN_TIER_IDS[i], i + 1);
});

t('defaultConfig: disabled by default', () => {
  const c = defaultConfig();
  eq(c.enabled, false);
});

t('defaultConfig: 5 thresholds strictly ascending', () => {
  const c = defaultConfig();
  eq(c.thresholds.length, 5);
  for (let i = 1; i < 5; i++) ok(c.thresholds[i] > c.thresholds[i - 1], 'must ascend');
});

t('defaultConfig: vendor-neutral placeholder labels', () => {
  const c = defaultConfig();
  for (const l of c.labels) ok(/^TIER \d$/.test(l), 'label is TIER N');
});

t('defaultConfig: durations 400-20000ms range', () => {
  const c = defaultConfig();
  for (const d of c.durations) ok(d >= 400 && d <= 20000, 'duration in range');
});

t('resolveConfig: enable via explicit flag', () => {
  eq(resolveConfig({ bigWinTier: { enabled: true } }).enabled, true);
});

t('resolveConfig: feature-kind auto-enable (snake_case + dash variants)', () => {
  eq(resolveConfig({ features: [{ kind: 'big_win_tier' }] }).enabled, true);
  eq(resolveConfig({ features: [{ kind: 'big-win-tier' }] }).enabled, true);
  eq(resolveConfig({ features: [{ kind: 'win_ladder' }] }).enabled, true);
  eq(resolveConfig({ features: [{ kind: 'big_win_ladder' }] }).enabled, true);
});

t('resolveConfig: GDD threshold override accepted when valid', () => {
  const c = resolveConfig({ bigWinTier: { enabled: true, thresholds: [5, 15, 50, 150, 500] } });
  eq(c.thresholds[0], 5);
  eq(c.thresholds[4], 500);
});

t('resolveConfig: malformed threshold (non-ascending) rejected — falls back', () => {
  const c = resolveConfig({ bigWinTier: { enabled: true, thresholds: [10, 5, 50, 200, 1000] } });
  /* non-ascending pair (10 → 5) → reject → default array. */
  eq(c.thresholds[0], 10);
  eq(c.thresholds[1], 25);  /* defaults */
});

t('resolveConfig: wrong-length threshold array rejected', () => {
  const c = resolveConfig({ bigWinTier: { enabled: true, thresholds: [1, 2, 3] } });
  eq(c.thresholds.length, 5);
  eq(c.thresholds[4], 1000);   /* default tier 5 threshold */
});

t('resolveConfig: GDD labels override (vendor-neutral test path)', () => {
  const c = resolveConfig({
    bigWinTier: { enabled: true, labels: ['LEPA POBEDA', 'VELIKA POBEDA', 'SUPER POBEDA', 'HIPER POBEDA', 'GRAND POBEDA'] },
  });
  eq(c.labels[0], 'LEPA POBEDA');
  eq(c.labels[4], 'GRAND POBEDA');
});

t('resolveConfig: labels too long rejected — fall back to defaults', () => {
  const tooLong = 'A'.repeat(33);
  const c = resolveConfig({ bigWinTier: { enabled: true, labels: [tooLong, 'B', 'C', 'D', 'E'] } });
  eq(c.labels[0], 'TIER 1');
});

t('resolveConfig: durations override accepted in range', () => {
  const c = resolveConfig({ bigWinTier: { enabled: true, durations: [1000, 1500, 2000, 3000, 4000] } });
  eq(c.durations[4], 4000);
});

t('resolveConfig: malformed color rejected', () => {
  const c = resolveConfig({ bigWinTier: { enabled: true, colors: ['bad', '1,2,3', '1,2,3', '1,2,3', '1,2,3'] } });
  eq(c.colors[0], '255,210,90');   /* default tier 1 */
});

t('resolveConfig: passthrough flag + passthroughMs honored', () => {
  const c = resolveConfig({ bigWinTier: { enabled: true, passthrough: true, passthroughMs: 350 } });
  eq(c.passthrough, true);
  eq(c.passthroughMs, 350);
});

t('emitBigWinTierCSS: disabled emits empty string', () => {
  eq(emitBigWinTierCSS(defaultConfig()), '');
});

t('emitBigWinTierCSS: enabled emits banner + 5 tier accents', () => {
  const css = emitBigWinTierCSS(resolveConfig({ bigWinTier: { enabled: true } }));
  ct(css, '.big-win-tier-host', 'host');
  ct(css, '.big-win-tier-banner', 'banner');
  for (let i = 1; i <= 5; i++) ct(css, `[data-tier="${i}"]`, `tier ${i} CSS selector`);
  ct(css, 'is-tier-4', 'tier-4 flash class');
  ct(css, 'is-tier-5', 'tier-5 flash class');
  ct(css, 'prefers-reduced-motion', 'a11y media query');
});

t('emitBigWinTierMarkup: enabled mounts host node with aria-live', () => {
  const mk = emitBigWinTierMarkup(resolveConfig({ bigWinTier: { enabled: true } }));
  ct(mk, 'id="bigWinTierHost"');
  ct(mk, 'aria-live="polite"');
});

t('emitBigWinTierRuntime: disabled emits stub symbols', () => {
  const rt = emitBigWinTierRuntime(defaultConfig());
  ct(rt, 'window.__BIG_WIN_TIER__');
  ct(rt, 'window.bigWinTierEnter');
  ct(rt, 'window.bigWinTierExit');
  ct(rt, 'BIG_WIN_TIER_STATE');
});

t('emitBigWinTierRuntime: enabled emits public API + HookBus wiring', () => {
  const rt = emitBigWinTierRuntime(resolveConfig({ bigWinTier: { enabled: true } }));
  ct(rt, 'function bigWinTierEnter', 'enter fn');
  ct(rt, 'function bigWinTierExit',  'exit fn');
  ct(rt, 'tierFromRatio',            'pure lookup helper');
  ct(rt, "HookBus.on('onWinPresentationEnd'", 'win-presentation-end listener');
  ct(rt, "HookBus.on('onSkipRequested'",       'skip listener');
  ct(rt, "HookBus.on('preSpin'",               'preSpin flush');
  ct(rt, "'onBigWinTierEntered'",              'entered emit');
  ct(rt, "'onBigWinTierExited'",               'exited emit');
});

t('determinism: identical config → byte-identical runtime emit', () => {
  const a = emitBigWinTierRuntime(resolveConfig({ bigWinTier: { enabled: true, thresholds: [5,10,20,40,80] } }));
  const b = emitBigWinTierRuntime(resolveConfig({ bigWinTier: { enabled: true, thresholds: [5,10,20,40,80] } }));
  eq(a, b);
});

t('determinism: same config → byte-identical CSS', () => {
  const a = emitBigWinTierCSS(resolveConfig({ bigWinTier: { enabled: true } }));
  const b = emitBigWinTierCSS(resolveConfig({ bigWinTier: { enabled: true } }));
  eq(a, b);
});

t('vendor-neutral: no vendor / studio / brand strings in any emit', () => {
  const cfg = resolveConfig({ bigWinTier: { enabled: true } });
  const all = emitBigWinTierCSS(cfg) + emitBigWinTierMarkup(cfg) + emitBigWinTierRuntime(cfg);
  /* Per rule_no_vendor_mentions — none of these words may appear in
   * src/blocks/ output. (Tests pass placeholder labels TIER 1..5 only.) */
  const banned = ['IGT', 'PlayCore', 'playa slot', 'playa-slot', 'playaslot', 'pragmatic', 'megaways', 'NetEnt', 'Wolf', 'Cleopatra', 'Buffalo', 'Olympus'];
  for (const w of banned) ne(all, w, `banned vendor token: ${w}`);
});

console.log('--- summary ---\n  pass:', pass, '\n  fail:', fail);
if (fail > 0) process.exit(1);
