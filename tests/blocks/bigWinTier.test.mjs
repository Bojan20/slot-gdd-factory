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

t('defaultConfig: vendor-neutral placeholder labels (BIGWINTIER<N>)', () => {
  const c = defaultConfig();
  for (let i = 0; i < c.labels.length; i++) {
    eq(c.labels[i], 'BIGWINTIER' + (i + 1), `label ${i+1} is BIGWINTIER${i+1}`);
  }
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
  eq(c.labels[0], 'BIGWINTIER1');
});

t('resolveConfig: durations override accepted in range', () => {
  const c = resolveConfig({ bigWinTier: { enabled: true, durations: [1000, 1500, 2000, 3000, 4000] } });
  eq(c.durations[4], 4000);
});

t('resolveConfig: malformed color rejected', () => {
  const c = resolveConfig({ bigWinTier: { enabled: true, colors: ['bad', '1,2,3', '1,2,3', '1,2,3', '1,2,3'] } });
  eq(c.colors[0], '255,210,90');   /* default tier 1 */
});

t('resolveConfig: compound flag + fadeMs honored', () => {
  const c = resolveConfig({ bigWinTier: { enabled: true, compound: false, fadeMs: 500 } });
  eq(c.compound, false);
  eq(c.fadeMs, 500);
});

t('defaultConfig: compound walkthrough enabled by default (WoO baseline)', () => {
  const c = defaultConfig();
  eq(c.compound, true);
  eq(c.fadeMs, 300);
});

t('emitBigWinTierCSS: disabled emits empty string', () => {
  eq(emitBigWinTierCSS(defaultConfig()), '');
});

t('emitBigWinTierCSS: enabled emits banner + 5 tier accents', () => {
  const css = emitBigWinTierCSS(resolveConfig({ bigWinTier: { enabled: true } }));
  ct(css, '.big-win-tier-host', 'host');
  ct(css, '.big-win-tier-banner', 'banner');
  for (let i = 1; i <= 5; i++) ct(css, `[data-tier="${i}"]`, `tier ${i} CSS selector`);
  ct(css, '@keyframes bigWinTierIn',  'fade-in keyframe');
  ct(css, '@keyframes bigWinTierOut', 'fade-out keyframe');
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
  ct(rt, "'onBigWinTierEnd'",                  'end emit');
  ct(rt, '_runCompound',                       'compound sequencer');
  ct(rt, '_fadeOutCurrent',                    'fade-out helper');
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

/* ── W47.S3 — V3 screen-shake ladder ──────────────────────────────── */

t('defaultConfig exposes shake ladder (W47.S3)', () => {
  const c = defaultConfig();
  ok(Array.isArray(c.shakeAmplitudePxPerTier), 'shakeAmplitudePxPerTier must be array');
  eq(c.shakeAmplitudePxPerTier.length, 5, 'shake ladder must be 5 entries long');
  eq(c.shakeAmplitudePxPerTier[0], 0, 'tier 1 calm by default');
  eq(c.shakeAmplitudePxPerTier[1], 0, 'tier 2 calm by default');
  ok(c.shakeAmplitudePxPerTier[2] >= 1, 'tier 3+ shakes');
  ok(c.shakeAmplitudePxPerTier[4] >= c.shakeAmplitudePxPerTier[2], 'amplitude monotonic non-decreasing');
  eq(c.shakeMinTier, 3, 'shakeMinTier defaults to 3 (gate matches the amplitudes)');
  ok(c.shakePeriodMs >= 80 && c.shakePeriodMs <= 600, 'shakePeriodMs within bounds');
});

t('resolveConfig clamps shake amplitudes + period (W47.S3)', () => {
  const c = resolveConfig({ bigWinTier: {
    enabled: true,
    shakeAmplitudePxPerTier: [-5, 0, 200, 'bad', 6],   /* -5 → 0, 200 → 16, 'bad' → 0 */
    shakeMinTier: 99,                                    /* clamped to 5 */
    shakePeriodMs: 9999,                                 /* clamped to 600 */
  }});
  eq(c.shakeAmplitudePxPerTier[0], 0, '-5 clamps to 0');
  eq(c.shakeAmplitudePxPerTier[2], 16, '200 clamps to MAX_SHAKE_PX=16');
  eq(c.shakeAmplitudePxPerTier[3], 0, 'NaN clamps to 0');
  eq(c.shakeMinTier, 5, 'minTier > TIER_COUNT clamps to 5');
  eq(c.shakePeriodMs, 600, 'period clamps to MAX_SHAKE_PERIOD_MS');
});

t('resolveConfig rejects wrong-length shake ladder (W47.S3)', () => {
  const c = resolveConfig({ bigWinTier: { enabled: true, shakeAmplitudePxPerTier: [2, 4] }});
  /* Falls back to defaults — wrong-length array must not corrupt the ladder. */
  eq(c.shakeAmplitudePxPerTier.length, 5, 'must keep 5-element default');
});

t('emitBigWinTierCSS contains shake keyframes (W47.S3)', () => {
  const css = emitBigWinTierCSS(resolveConfig({ bigWinTier: { enabled: true } }));
  ct(css, '@keyframes bigWinTierShake', 'keyframes declared');
  ct(css, '.big-win-tier-banner.is-shaking', 'class selector present');
  ct(css, '--bw-shake-amp', 'amplitude CSS variable wired');
  ct(css, '@media (prefers-reduced-motion: reduce)', 'reduced-motion gate present');
  /* The reduced-motion block must explicitly kill the shake animation. */
  ct(css, '.big-win-tier-banner.is-shaking { animation: none', 'reduced-motion kills shake');
});

t('emitBigWinTierRuntime carries SHAKE constants + _applyShake (W47.S3)', () => {
  const rt = emitBigWinTierRuntime(resolveConfig({ bigWinTier: { enabled: true } }));
  ct(rt, 'SHAKE_AMP', 'SHAKE_AMP constant emitted');
  ct(rt, 'SHAKE_PERIOD_MS', 'SHAKE_PERIOD_MS constant emitted');
  ct(rt, '_applyShake', 'helper function emitted');
  ct(rt, "matchMedia('(prefers-reduced-motion: reduce)')", 'matchMedia gate in runtime');
  ct(rt, "classList.add('is-shaking')", 'class toggle wired');
  ct(rt, "classList.remove('is-shaking')", 'cleanup in fadeOut + applyShake');
});

t('shake defaults pass vendor-neutral check (W47.S3)', () => {
  const css = emitBigWinTierCSS(resolveConfig({ bigWinTier: { enabled: true } }));
  /* The shake keyframes must NOT reference any branded effect name. */
  const banned = ['MegaShake', 'ThunderShake', 'BigBoom', 'IGT', 'pragmatic'];
  for (const w of banned) ne(css, w, `banned in shake CSS: ${w}`);
});

/* ─── W48 / V3 polish — five-step tier stepper ladder ───────────── */

t('V3 polish: CSS emits .big-win-tier-stepper with 5 step rules', () => {
  const css = emitBigWinTierCSS(resolveConfig({ bigWinTier: { enabled: true } }));
  if (!css.includes('.big-win-tier-stepper')) throw new Error('missing .big-win-tier-stepper rule');
  if (!css.includes('.big-win-tier-step')) throw new Error('missing .big-win-tier-step rule');
  /* Each tier must have its step-fill selector set. */
  for (const tier of [1, 2, 3, 4, 5]) {
    const sel = `[data-tier="${tier}"] .big-win-tier-stepper .big-win-tier-step[data-step="1"]`;
    if (!css.includes(sel)) throw new Error(`missing fill selector for tier ${tier}`);
  }
});

t('V3 polish: runtime injects 5 step nodes + role=progressbar', () => {
  const r = emitBigWinTierRuntime(resolveConfig({ bigWinTier: { enabled: true } }));
  if (!r.includes('role="progressbar"')) throw new Error('missing progressbar role');
  if (!r.includes('aria-valuemin="0"')) throw new Error('missing aria-valuemin');
  if (!r.includes('aria-valuemax="5"')) throw new Error('missing aria-valuemax');
  if (!r.includes('aria-label="Win tier progress"')) throw new Error('missing aria-label');
  for (const step of [1, 2, 3, 4, 5]) {
    if (!r.includes(`data-step="${step}"`)) throw new Error(`missing step ${step}`);
  }
});

t('V3 polish: runtime _swapTier updates aria-valuenow on stepper', () => {
  const r = emitBigWinTierRuntime(resolveConfig({ bigWinTier: { enabled: true } }));
  if (!r.includes("querySelector('.big-win-tier-stepper')")) {
    throw new Error('missing stepper query in _swapTier');
  }
  if (!r.includes("setAttribute('aria-valuenow'")) {
    throw new Error('missing aria-valuenow update');
  }
});

t('V3 polish: skip-snap path also injects stepper (non-mounted edge)', () => {
  const r = emitBigWinTierRuntime(resolveConfig({ bigWinTier: { enabled: true } }));
  const occ = (r.match(/role="progressbar"/g) || []).length;
  if (occ < 2) throw new Error(`expected ≥ 2 stepper inserts, got ${occ}`);
});

t('V3 polish: reduced-motion CSS kills stepper animation', () => {
  const css = emitBigWinTierCSS(resolveConfig({ bigWinTier: { enabled: true } }));
  if (!css.includes('prefers-reduced-motion: reduce')) {
    throw new Error('missing reduced-motion media query');
  }
  const m = css.match(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\n  \}\s*\n/);
  if (!m || !m[0].includes('.big-win-tier-step')) {
    throw new Error('reduced-motion block missing stepper kill rule');
  }
});

t('V3 polish: disabled emits no stepper', () => {
  const css = emitBigWinTierCSS(resolveConfig({ bigWinTier: { enabled: false } }));
  if (css.includes('.big-win-tier-stepper')) {
    throw new Error('disabled CSS leaked stepper rule');
  }
  const r = emitBigWinTierRuntime(resolveConfig({ bigWinTier: { enabled: false } }));
  if (r.includes('role="progressbar"')) {
    throw new Error('disabled runtime leaked stepper markup');
  }
});

console.log('--- summary ---\n  pass:', pass, '\n  fail:', fail);
if (fail > 0) process.exit(1);
