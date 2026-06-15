/* eslint-disable no-console */
/**
 * pickBonusReveal block unit tests (Wave W47.S16 — B71).
 *
 * Coverage:
 *   • defaultConfig stability + isolation
 *   • resolveConfig:
 *     - enabled toggle + auto-enable on bonusPick / bonusPickDeterministic
 *     - feature-kind auto-enable (4 kinds)
 *     - explicit enabled=false overrides auto
 *     - triggerEvent whitelist (3 events)
 *     - revealStyle whitelist (4 styles)
 *     - durationMs / autoCloseMs numeric clamps
 *     - haloColor RGB validation
 *     - messageTpl length cap + non-empty
 *   • CSS emit: disabled = empty; enabled = host + 1 keyframe block per
 *     style + prefers-reduced-motion guard + responsive
 *   • Markup emit: disabled = empty; enabled = role="status", aria-live,
 *     aria-label, initial data-active=false
 *   • Runtime emit: disabled = stub; enabled = IIFE + tight 1-binding
 *     trigger dispatch (dead-branch elimination)
 *   • LEGO discipline: emits exactly onPickRevealStart + onPickRevealEnd
 *   • Vendor-neutral: no studio / game names in emitted artefacts
 *   • Determinism: same config → byte-identical CSS + Markup + Runtime
 *   • Defensive: messageTpl label cap (40 chars), missing payload guards
 */
import {
  defaultConfig,
  resolveConfig,
  emitPickBonusRevealCSS,
  emitPickBonusRevealMarkup,
  emitPickBonusRevealRuntime,
} from '../../src/blocks/pickBonusReveal.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); console.log('  ✓', n); pass++; }
  catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; }
};
const eq  = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ok  = (c, m = '') => { if (!c) throw new Error(`expected truthy — ${m}`); };
const ct  = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };
const nct = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`unexpected substring ${JSON.stringify(n)} — ${m}`); };

console.log('— blocks/pickBonusReveal.mjs —');

/* ─── defaultConfig ───────────────────────────────────────────────── */
t('defaultConfig: stable shape', () => {
  const c = defaultConfig();
  eq(c.enabled, false);
  eq(c.triggerEvent, 'onBonusPickResolved');
  eq(c.revealStyle, 'zoom');
  eq(c.durationMs, 1500);
  eq(c.haloColor, '255,214,110');
  eq(c.messageTpl, 'YOU WON {label}');
  eq(c.autoCloseMs, 700);
});

t('defaultConfig: returns isolated copy', () => {
  const a = defaultConfig();
  const b = defaultConfig();
  ok(a !== b);
  a.enabled = true;
  eq(b.enabled, false);
});

/* ─── resolveConfig ────────────────────────────────────────────────── */
t('resolveConfig: empty model → defaults (disabled)', () => {
  eq(resolveConfig({}).enabled, false);
});

t('resolveConfig: enabled=true honored', () => {
  eq(resolveConfig({ pickBonusReveal: { enabled: true } }).enabled, true);
});

t('resolveConfig: auto-enable on model.bonusPick declaration', () => {
  eq(resolveConfig({ bonusPick: {} }).enabled, true);
});

t('resolveConfig: auto-enable on model.bonusPickDeterministic', () => {
  eq(resolveConfig({ bonusPickDeterministic: {} }).enabled, true);
});

t('resolveConfig: auto-enable on feature kinds', () => {
  for (const k of ['pick_bonus', 'bonus_pick', 'pick_em', 'pick_reveal']) {
    eq(resolveConfig({ features: [{ kind: k }] }).enabled, true, `kind ${k} should auto-enable`);
  }
});

t('resolveConfig: explicit enabled=false overrides feature auto-enable', () => {
  eq(resolveConfig({
    bonusPick: {},
    pickBonusReveal: { enabled: false },
  }).enabled, false);
});

t('resolveConfig: triggerEvent whitelist', () => {
  eq(resolveConfig({ pickBonusReveal: { triggerEvent: 'onFsTrigger' } }).triggerEvent, 'onFsTrigger');
  eq(resolveConfig({ pickBonusReveal: { triggerEvent: 'onWheelAwardCollected' } }).triggerEvent, 'onWheelAwardCollected');
  eq(resolveConfig({ pickBonusReveal: { triggerEvent: 'INVALID' } }).triggerEvent, 'onBonusPickResolved');
});

t('resolveConfig: revealStyle whitelist (4 styles)', () => {
  for (const s of ['flip', 'zoom', 'glow', 'shake']) {
    eq(resolveConfig({ pickBonusReveal: { revealStyle: s } }).revealStyle, s);
  }
  eq(resolveConfig({ pickBonusReveal: { revealStyle: 'INVALID' } }).revealStyle, 'zoom');
});

t('resolveConfig: durationMs clamped [200,8000]', () => {
  eq(resolveConfig({ pickBonusReveal: { durationMs: 2000 } }).durationMs, 2000);
  eq(resolveConfig({ pickBonusReveal: { durationMs: 50 } }).durationMs, 1500);
  eq(resolveConfig({ pickBonusReveal: { durationMs: 99999 } }).durationMs, 1500);
});

t('resolveConfig: autoCloseMs clamped [0,5000]', () => {
  eq(resolveConfig({ pickBonusReveal: { autoCloseMs: 1000 } }).autoCloseMs, 1000);
  eq(resolveConfig({ pickBonusReveal: { autoCloseMs: -10 } }).autoCloseMs, 700);
  eq(resolveConfig({ pickBonusReveal: { autoCloseMs: 9999 } }).autoCloseMs, 700);
});

t('resolveConfig: haloColor RGB validation', () => {
  eq(resolveConfig({ pickBonusReveal: { haloColor: '10,20,30' } }).haloColor, '10,20,30');
  eq(resolveConfig({ pickBonusReveal: { haloColor: 'gold' } }).haloColor, '255,214,110');
  eq(resolveConfig({ pickBonusReveal: { haloColor: '999,0,0' } }).haloColor, '255,214,110');
});

t('resolveConfig: messageTpl override + length cap', () => {
  eq(resolveConfig({ pickBonusReveal: { messageTpl: 'BIG WIN {label}!' } }).messageTpl, 'BIG WIN {label}!');
  eq(resolveConfig({ pickBonusReveal: { messageTpl: '' } }).messageTpl, 'YOU WON {label}');
  /* 81-char string rejected */
  const tooLong = 'a'.repeat(81);
  eq(resolveConfig({ pickBonusReveal: { messageTpl: tooLong } }).messageTpl, 'YOU WON {label}');
});

/* ─── CSS emit ─────────────────────────────────────────────────────── */
t('emitPickBonusRevealCSS: disabled → empty', () => {
  eq(emitPickBonusRevealCSS({ enabled: false }), '');
});

t('emitPickBonusRevealCSS: enabled → host + keyframe + RM guard', () => {
  const out = emitPickBonusRevealCSS(resolveConfig({ pickBonusReveal: { enabled: true } }));
  ct(out, '.pick-reveal');
  ct(out, '[data-active="true"]');
  ct(out, '@keyframes pickRevealZoom');
  ct(out, '@media (prefers-reduced-motion: reduce)');
  ct(out, 'animation: none');
});

t('emitPickBonusRevealCSS: exactly one keyframe block per build (dead-branch)', () => {
  const zoom = emitPickBonusRevealCSS(resolveConfig({ pickBonusReveal: { enabled: true, revealStyle: 'zoom' } }));
  nct(zoom, 'pickRevealFlip');
  nct(zoom, 'pickRevealGlow');
  nct(zoom, 'pickRevealShake');

  const flip = emitPickBonusRevealCSS(resolveConfig({ pickBonusReveal: { enabled: true, revealStyle: 'flip' } }));
  nct(flip, 'pickRevealZoom');
  nct(flip, 'pickRevealGlow');
  nct(flip, 'pickRevealShake');
});

t('emitPickBonusRevealCSS: each style emits its own keyframe name', () => {
  for (const [style, kf] of [
    ['zoom',  'pickRevealZoom'],
    ['flip',  'pickRevealFlip'],
    ['glow',  'pickRevealGlow'],
    ['shake', 'pickRevealShake'],
  ]) {
    const out = emitPickBonusRevealCSS(resolveConfig({ pickBonusReveal: { enabled: true, revealStyle: style } }));
    ct(out, '@keyframes ' + kf, `style ${style} should emit keyframe ${kf}`);
  }
});

t('emitPickBonusRevealCSS: haloColor baked via rgba()', () => {
  const out = emitPickBonusRevealCSS(resolveConfig({ pickBonusReveal: { enabled: true, haloColor: '5,10,15' } }));
  ct(out, 'rgba(5,10,15');
});

t('emitPickBonusRevealCSS: mobile responsive rule', () => {
  const out = emitPickBonusRevealCSS(resolveConfig({ pickBonusReveal: { enabled: true } }));
  ct(out, '@media (max-width: 480px)');
});

t('emitPickBonusRevealCSS: pointer-events:none (overlay never blocks)', () => {
  const out = emitPickBonusRevealCSS(resolveConfig({ pickBonusReveal: { enabled: true } }));
  ct(out, 'pointer-events: none');
});

/* ─── Markup emit ──────────────────────────────────────────────────── */
t('emitPickBonusRevealMarkup: disabled → empty', () => {
  eq(emitPickBonusRevealMarkup({ enabled: false }), '');
});

t('emitPickBonusRevealMarkup: enabled emits id + role + aria', () => {
  const out = emitPickBonusRevealMarkup(resolveConfig({ pickBonusReveal: { enabled: true } }));
  ct(out, 'id="pickReveal"');
  ct(out, 'role="status"');
  ct(out, 'aria-live="polite"');
  ct(out, 'aria-label="Bonus prize reveal"');
  ct(out, 'data-active="false"');
});

t('emitPickBonusRevealMarkup: prize slot + headline scaffold', () => {
  const out = emitPickBonusRevealMarkup(resolveConfig({ pickBonusReveal: { enabled: true } }));
  ct(out, 'class="pr-headline"');
  ct(out, 'class="pr-prize"');
});

/* ─── Runtime emit ─────────────────────────────────────────────────── */
t('emitPickBonusRevealRuntime: disabled → stub (no HookBus.on)', () => {
  const out = emitPickBonusRevealRuntime({ enabled: false });
  ct(out, 'disabled');
  nct(out, 'HookBus.on');
});

t('emitPickBonusRevealRuntime: enabled wires single trigger event (zoom default)', () => {
  const out = emitPickBonusRevealRuntime(resolveConfig({ pickBonusReveal: { enabled: true } }));
  ct(out, 'HookBus.on');
  ct(out, "'onBonusPickResolved'");
});

t('emitPickBonusRevealRuntime: onFsTrigger mode wires FS', () => {
  const out = emitPickBonusRevealRuntime(resolveConfig({ pickBonusReveal: { enabled: true, triggerEvent: 'onFsTrigger' } }));
  ct(out, "'onFsTrigger'");
  nct(out, "'onBonusPickResolved'");
  nct(out, "'onWheelAwardCollected'");
});

t('emitPickBonusRevealRuntime: onWheelAwardCollected mode', () => {
  const out = emitPickBonusRevealRuntime(resolveConfig({ pickBonusReveal: { enabled: true, triggerEvent: 'onWheelAwardCollected' } }));
  ct(out, "'onWheelAwardCollected'");
  nct(out, "'onFsTrigger'");
  nct(out, "'onBonusPickResolved'");
});

t('emitPickBonusRevealRuntime: emits onPickRevealStart + onPickRevealEnd', () => {
  const out = emitPickBonusRevealRuntime(resolveConfig({ pickBonusReveal: { enabled: true } }));
  ct(out, 'onPickRevealStart');
  ct(out, 'onPickRevealEnd');
});

t('emitPickBonusRevealRuntime: exposes window.firePickBonusReveal', () => {
  const out = emitPickBonusRevealRuntime(resolveConfig({ pickBonusReveal: { enabled: true } }));
  ct(out, 'window.firePickBonusReveal');
});

t('emitPickBonusRevealRuntime: defensive — token-based re-entrancy', () => {
  const out = emitPickBonusRevealRuntime(resolveConfig({ pickBonusReveal: { enabled: true } }));
  ct(out, 'PR_TOKEN');
  ct(out, '++PR_TOKEN');
});

t('emitPickBonusRevealRuntime: defensive — label safe-slice to 40 chars', () => {
  const out = emitPickBonusRevealRuntime(resolveConfig({ pickBonusReveal: { enabled: true } }));
  ct(out, '.slice(0, 40)');
});

t('emitPickBonusRevealRuntime: messageTpl literal baked in', () => {
  const out = emitPickBonusRevealRuntime(resolveConfig({ pickBonusReveal: { enabled: true, messageTpl: 'BONUS {label}!' } }));
  ct(out, 'BONUS {label}!');
});

/* ─── Determinism ──────────────────────────────────────────────────── */
t('determinism: same config → byte-identical CSS', () => {
  const cfg = resolveConfig({ pickBonusReveal: { enabled: true } });
  eq(emitPickBonusRevealCSS(cfg), emitPickBonusRevealCSS(cfg));
});

t('determinism: same config → byte-identical Markup', () => {
  const cfg = resolveConfig({ pickBonusReveal: { enabled: true } });
  eq(emitPickBonusRevealMarkup(cfg), emitPickBonusRevealMarkup(cfg));
});

t('determinism: same config → byte-identical Runtime', () => {
  const cfg = resolveConfig({ pickBonusReveal: { enabled: true } });
  eq(emitPickBonusRevealRuntime(cfg), emitPickBonusRevealRuntime(cfg));
});

/* ─── Vendor neutrality ────────────────────────────────────────────── */
t('vendor-neutral: no studio / game names in emitted artefacts', () => {
  const cfg = resolveConfig({ pickBonusReveal: { enabled: true } });
  const out = emitPickBonusRevealCSS(cfg)
            + emitPickBonusRevealMarkup(cfg)
            + emitPickBonusRevealRuntime(cfg);
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
