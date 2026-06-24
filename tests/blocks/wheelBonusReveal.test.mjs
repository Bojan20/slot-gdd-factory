/* eslint-disable no-console */
/**
 * wheelBonusReveal block unit tests (Wave W47.S18 — B72).
 *
 * Coverage:
 *   • defaultConfig stability + isolation
 *   • resolveConfig:
 *     - enabled toggle + auto-enable on wheelBonus / weightedWheelSegments
 *     - feature-kind auto-enable (4 kinds)
 *     - explicit enabled=false overrides auto
 *     - revealStyle whitelist (4 styles)
 *     - highlightDurationMs / autoCloseMs / jackpotMinValue clamps
 *     - haloColor + jackpotHaloColor RGB validation
 *     - centerMessage + jackpotMessage length cap
 *   • CSS emit: disabled = empty; enabled = host + 1 keyframe + RM guard
 *     + responsive mobile + jackpot variant + safe overlay (no pointer)
 *   • Markup emit: disabled = empty; enabled = role="status", aria-live,
 *     aria-label, data-active=false + data-jackpot=false
 *   • Runtime emit: disabled = stub; enabled = listener on onWheelSettled
 *     + onWheelJackpotHit + emit lifecycle pair
 *   • LEGO discipline: emits onWheelRevealStart + onWheelRevealEnd
 *   • Vendor-neutral: no studio / game names in emitted artefacts
 *   • Determinism: same config → byte-identical CSS + Markup + Runtime
 *   • Defensive: token-based re-entrancy, label slice(0,40)
 */
import {
  defaultConfig,
  resolveConfig,
  emitWheelBonusRevealCSS,
  emitWheelBonusRevealMarkup,
  emitWheelBonusRevealRuntime,
} from '../../src/blocks/wheelBonusReveal.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); console.log('  ✓', n); pass++; }
  catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; }
};
const eq  = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ok  = (c, m = '') => { if (!c) throw new Error(`expected truthy — ${m}`); };
const ct  = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };
const nct = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`unexpected substring ${JSON.stringify(n)} — ${m}`); };

console.log('— blocks/wheelBonusReveal.mjs —');

/* ─── defaultConfig ───────────────────────────────────────────────── */
t('defaultConfig: stable shape', () => {
  const c = defaultConfig();
  eq(c.enabled, false);
  eq(c.revealStyle, 'zoom');
  eq(c.highlightDurationMs, 1200);
  eq(c.autoCloseMs, 800);
  eq(c.haloColor, '255,210,90');
  eq(c.centerMessage, 'YOU WON {label}');
  eq(c.jackpotMinValue, 100);
  eq(c.jackpotMessage, 'JACKPOT! {label}');
  eq(c.jackpotHaloColor, '255,80,80');
});

t('defaultConfig: returns isolated frozen copy', () => {
  /* UQ-DEEP-AM FIX-3: top-level frozen; isolation by identity. */
  const a = defaultConfig();
  const b = defaultConfig();
  ok(a !== b);
  ok(Object.isFrozen(a));
  eq(a.enabled, b.enabled);
});

/* ─── resolveConfig ────────────────────────────────────────────────── */
t('resolveConfig: empty model → defaults (disabled)', () => {
  eq(resolveConfig({}).enabled, false);
});

t('resolveConfig: enabled=true honored', () => {
  eq(resolveConfig({ wheelBonusReveal: { enabled: true } }).enabled, true);
});

t('resolveConfig: auto-enable on model.wheelBonus declaration', () => {
  eq(resolveConfig({ wheelBonus: {} }).enabled, true);
});

t('resolveConfig: auto-enable on model.weightedWheelSegments', () => {
  eq(resolveConfig({ weightedWheelSegments: {} }).enabled, true);
});

t('resolveConfig: auto-enable on feature kinds', () => {
  for (const k of ['wheel_bonus', 'wheel_of_fortune', 'weighted_wheel', 'wheel_reveal']) {
    eq(resolveConfig({ features: [{ kind: k }] }).enabled, true, `kind ${k} should auto-enable`);
  }
});

t('resolveConfig: explicit enabled=false overrides feature auto-enable', () => {
  eq(resolveConfig({
    wheelBonus: {},
    wheelBonusReveal: { enabled: false },
  }).enabled, false);
});

t('resolveConfig: revealStyle whitelist (4 styles)', () => {
  for (const s of ['glow', 'shake', 'zoom', 'fanfare']) {
    eq(resolveConfig({ wheelBonusReveal: { revealStyle: s } }).revealStyle, s);
  }
  eq(resolveConfig({ wheelBonusReveal: { revealStyle: 'INVALID' } }).revealStyle, 'zoom');
});

t('resolveConfig: highlightDurationMs clamped [200,8000]', () => {
  eq(resolveConfig({ wheelBonusReveal: { highlightDurationMs: 2000 } }).highlightDurationMs, 2000);
  eq(resolveConfig({ wheelBonusReveal: { highlightDurationMs: 50 } }).highlightDurationMs, 1200);
  eq(resolveConfig({ wheelBonusReveal: { highlightDurationMs: 99999 } }).highlightDurationMs, 1200);
});

t('resolveConfig: autoCloseMs clamped [0,5000]', () => {
  eq(resolveConfig({ wheelBonusReveal: { autoCloseMs: 1500 } }).autoCloseMs, 1500);
  eq(resolveConfig({ wheelBonusReveal: { autoCloseMs: -1 } }).autoCloseMs, 800);
  eq(resolveConfig({ wheelBonusReveal: { autoCloseMs: 99999 } }).autoCloseMs, 800);
});

t('resolveConfig: jackpotMinValue clamped [1,1000000]', () => {
  eq(resolveConfig({ wheelBonusReveal: { jackpotMinValue: 500 } }).jackpotMinValue, 500);
  eq(resolveConfig({ wheelBonusReveal: { jackpotMinValue: 0 } }).jackpotMinValue, 100);
  eq(resolveConfig({ wheelBonusReveal: { jackpotMinValue: 99999999 } }).jackpotMinValue, 100);
});

t('resolveConfig: haloColor RGB validation', () => {
  eq(resolveConfig({ wheelBonusReveal: { haloColor: '10,20,30' } }).haloColor, '10,20,30');
  eq(resolveConfig({ wheelBonusReveal: { haloColor: 'gold' } }).haloColor, '255,210,90');
  eq(resolveConfig({ wheelBonusReveal: { haloColor: '999,1,2' } }).haloColor, '255,210,90');
});

t('resolveConfig: jackpotHaloColor RGB validation (independent)', () => {
  eq(resolveConfig({ wheelBonusReveal: { jackpotHaloColor: '50,60,70' } }).jackpotHaloColor, '50,60,70');
  eq(resolveConfig({ wheelBonusReveal: { jackpotHaloColor: 'jp' } }).jackpotHaloColor, '255,80,80');
});

t('resolveConfig: centerMessage + jackpotMessage length cap', () => {
  eq(resolveConfig({ wheelBonusReveal: { centerMessage: 'BIG WIN {label}' } }).centerMessage, 'BIG WIN {label}');
  eq(resolveConfig({ wheelBonusReveal: { centerMessage: '' } }).centerMessage, 'YOU WON {label}');
  const tooLong = 'a'.repeat(81);
  eq(resolveConfig({ wheelBonusReveal: { centerMessage: tooLong } }).centerMessage, 'YOU WON {label}');
  eq(resolveConfig({ wheelBonusReveal: { jackpotMessage: tooLong } }).jackpotMessage, 'JACKPOT! {label}');
});

/* ─── CSS emit ─────────────────────────────────────────────────────── */
t('emitWheelBonusRevealCSS: disabled → empty', () => {
  eq(emitWheelBonusRevealCSS({ enabled: false }), '');
});

t('emitWheelBonusRevealCSS: enabled → host + keyframe + RM guard', () => {
  const out = emitWheelBonusRevealCSS(resolveConfig({ wheelBonusReveal: { enabled: true } }));
  ct(out, '.wheel-reveal');
  ct(out, '[data-active="true"]');
  ct(out, '[data-jackpot="true"]');
  ct(out, '@keyframes wheelRevealZoom');
  ct(out, '@media (prefers-reduced-motion: reduce)');
  ct(out, 'animation: none');
});

t('emitWheelBonusRevealCSS: dead-branch — exactly one keyframe per build', () => {
  const zoom = emitWheelBonusRevealCSS(resolveConfig({ wheelBonusReveal: { enabled: true, revealStyle: 'zoom' } }));
  nct(zoom, 'wheelRevealGlow');
  nct(zoom, 'wheelRevealShake');
  nct(zoom, 'wheelRevealFanfare');

  const fan = emitWheelBonusRevealCSS(resolveConfig({ wheelBonusReveal: { enabled: true, revealStyle: 'fanfare' } }));
  nct(fan, 'wheelRevealZoom');
  nct(fan, 'wheelRevealGlow');
  nct(fan, 'wheelRevealShake');
});

t('emitWheelBonusRevealCSS: each style emits its own keyframe name', () => {
  for (const [style, kf] of [
    ['zoom',    'wheelRevealZoom'],
    ['glow',    'wheelRevealGlow'],
    ['shake',   'wheelRevealShake'],
    ['fanfare', 'wheelRevealFanfare'],
  ]) {
    const out = emitWheelBonusRevealCSS(resolveConfig({ wheelBonusReveal: { enabled: true, revealStyle: style } }));
    ct(out, '@keyframes ' + kf, `style ${style} should emit keyframe ${kf}`);
  }
});

t('emitWheelBonusRevealCSS: jackpot variant uses jackpotHaloColor', () => {
  const out = emitWheelBonusRevealCSS(resolveConfig({ wheelBonusReveal: { enabled: true, jackpotHaloColor: '11,22,33' } }));
  ct(out, 'rgba(11,22,33');
});

t('emitWheelBonusRevealCSS: mobile responsive rule', () => {
  const out = emitWheelBonusRevealCSS(resolveConfig({ wheelBonusReveal: { enabled: true } }));
  ct(out, '@media (max-width: 480px)');
});

t('emitWheelBonusRevealCSS: pointer-events:none (overlay never blocks input)', () => {
  const out = emitWheelBonusRevealCSS(resolveConfig({ wheelBonusReveal: { enabled: true } }));
  ct(out, 'pointer-events: none');
});

/* ─── Markup emit ──────────────────────────────────────────────────── */
t('emitWheelBonusRevealMarkup: disabled → empty', () => {
  eq(emitWheelBonusRevealMarkup({ enabled: false }), '');
});

t('emitWheelBonusRevealMarkup: enabled emits id + role + aria + data flags', () => {
  const out = emitWheelBonusRevealMarkup(resolveConfig({ wheelBonusReveal: { enabled: true } }));
  ct(out, 'id="wheelReveal"');
  ct(out, 'role="status"');
  ct(out, 'aria-live="polite"');
  ct(out, 'aria-label="Wheel reveal"');
  ct(out, 'data-active="false"');
  ct(out, 'data-jackpot="false"');
});

t('emitWheelBonusRevealMarkup: prize slot + headline scaffold', () => {
  const out = emitWheelBonusRevealMarkup(resolveConfig({ wheelBonusReveal: { enabled: true } }));
  ct(out, 'class="wr-headline"');
  ct(out, 'class="wr-prize"');
});

/* ─── Runtime emit ─────────────────────────────────────────────────── */
t('emitWheelBonusRevealRuntime: disabled → stub (no HookBus.on)', () => {
  const out = emitWheelBonusRevealRuntime({ enabled: false });
  ct(out, 'disabled');
  nct(out, 'HookBus.on');
});

t('emitWheelBonusRevealRuntime: enabled wires onWheelSettled', () => {
  const out = emitWheelBonusRevealRuntime(resolveConfig({ wheelBonusReveal: { enabled: true } }));
  ct(out, "HookBus.on('onWheelSettled'");
});

t('emitWheelBonusRevealRuntime: enabled wires onWheelJackpotHit escalation', () => {
  const out = emitWheelBonusRevealRuntime(resolveConfig({ wheelBonusReveal: { enabled: true } }));
  ct(out, "HookBus.on('onWheelJackpotHit'");
});

t('emitWheelBonusRevealRuntime: emits onWheelRevealStart + onWheelRevealEnd', () => {
  const out = emitWheelBonusRevealRuntime(resolveConfig({ wheelBonusReveal: { enabled: true } }));
  ct(out, 'onWheelRevealStart');
  ct(out, 'onWheelRevealEnd');
});

t('emitWheelBonusRevealRuntime: exposes window.fireWheelBonusReveal', () => {
  const out = emitWheelBonusRevealRuntime(resolveConfig({ wheelBonusReveal: { enabled: true } }));
  ct(out, 'window.fireWheelBonusReveal');
});

t('emitWheelBonusRevealRuntime: defensive — token-based re-entrancy', () => {
  const out = emitWheelBonusRevealRuntime(resolveConfig({ wheelBonusReveal: { enabled: true } }));
  ct(out, 'WR_TOKEN');
  ct(out, '++WR_TOKEN');
});

t('emitWheelBonusRevealRuntime: defensive — label safe-slice to 40 chars', () => {
  const out = emitWheelBonusRevealRuntime(resolveConfig({ wheelBonusReveal: { enabled: true } }));
  ct(out, '.slice(0, 40)');
});

t('emitWheelBonusRevealRuntime: jackpot threshold baked into runtime', () => {
  const out = emitWheelBonusRevealRuntime(resolveConfig({ wheelBonusReveal: { enabled: true, jackpotMinValue: 250 } }));
  ct(out, 'WR_JP_MIN      = 250');
});

t('emitWheelBonusRevealRuntime: centerMessage + jackpotMessage literals baked', () => {
  const out = emitWheelBonusRevealRuntime(resolveConfig({
    wheelBonusReveal: {
      enabled: true,
      centerMessage: 'PRIZE: {label}',
      jackpotMessage: 'MEGA {label}!',
    },
  }));
  ct(out, 'PRIZE: {label}');
  ct(out, 'MEGA {label}!');
});

/* ─── Determinism ──────────────────────────────────────────────────── */
t('determinism: same config → byte-identical CSS', () => {
  const cfg = resolveConfig({ wheelBonusReveal: { enabled: true } });
  eq(emitWheelBonusRevealCSS(cfg), emitWheelBonusRevealCSS(cfg));
});

t('determinism: same config → byte-identical Markup', () => {
  const cfg = resolveConfig({ wheelBonusReveal: { enabled: true } });
  eq(emitWheelBonusRevealMarkup(cfg), emitWheelBonusRevealMarkup(cfg));
});

t('determinism: same config → byte-identical Runtime', () => {
  const cfg = resolveConfig({ wheelBonusReveal: { enabled: true } });
  eq(emitWheelBonusRevealRuntime(cfg), emitWheelBonusRevealRuntime(cfg));
});

/* ─── Vendor neutrality ────────────────────────────────────────────── */
t('vendor-neutral: no studio / game names in emitted artefacts', () => {
  const cfg = resolveConfig({ wheelBonusReveal: { enabled: true } });
  const out = emitWheelBonusRevealCSS(cfg)
            + emitWheelBonusRevealMarkup(cfg)
            + emitWheelBonusRevealRuntime(cfg);
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
