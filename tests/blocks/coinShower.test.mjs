/* eslint-disable no-console */
/**
 * coinShower block unit tests.
 *
 * Coverage:
 *   • defaultConfig stability + isolation
 *   • resolveConfig: enabled toggle, triggerMode whitelist, spawnArc
 *     whitelist, RGB color validation, numeric bounds, feature auto-enable
 *   • CSS emit: disabled = empty; enabled = container + .coin + keyframes
 *     + prefers-reduced-motion guard + responsive mobile rule
 *   • Markup emit: disabled = empty; enabled = id="coinShower",
 *     aria-hidden, data-active=false
 *   • Runtime emit: disabled = stub; enabled = IIFE + HookBus.on listener
 *   • Trigger-mode dispatch: exactly one of onBigWinTier / onFsTrigger /
 *     onTumbleStep / onSpinResult is wired per build
 *   • LEGO discipline: emits exactly the lifecycle events declared in the
 *     lego-gate owner map (onCoinShowerStart / onCoinShowerEnd)
 *   • Vendor-neutral: no studio / game names in emitted artefacts
 *   • Accessibility: prefers-reduced-motion rule present
 *   • Determinism: same config → byte-identical CSS
 */
import {
  defaultConfig,
  resolveConfig,
  emitCoinShowerCSS,
  emitCoinShowerMarkup,
  emitCoinShowerRuntime,
} from '../../src/blocks/coinShower.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); console.log('  ✓', n); pass++; }
  catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; }
};
const eq  = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ok  = (c, m = '') => { if (!c) throw new Error(`expected truthy — ${m}`); };
const ct  = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };
const nct = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`unexpected substring ${JSON.stringify(n)} — ${m}`); };

console.log('— blocks/coinShower.mjs —');

/* ─── defaultConfig ───────────────────────────────────────────────── */
t('defaultConfig: stable shape', () => {
  const c = defaultConfig();
  eq(c.enabled, false);
  eq(c.triggerMode, 'big_win');
  eq(c.minWinX, 25);
  eq(c.bigWinMinTier, 2);
  eq(c.chainMinLen, 3);
  eq(c.coinCount, 48);
  eq(c.durationMs, 2000);
  eq(c.coinColor, '255,214,110');
  eq(c.spawnArc, 'top');
  eq(c.gravityPx, 1400);
  eq(c.haptic, false);
});

t('defaultConfig: returns isolated copy', () => {
  const a = defaultConfig();
  const b = defaultConfig();
  ok(a !== b);
  a.enabled = true;
  eq(b.enabled, false);
});

/* ─── resolveConfig ────────────────────────────────────────────────── */
t('resolveConfig: empty model → defaults', () => {
  const c = resolveConfig({});
  eq(c.enabled, false);
  eq(c.triggerMode, 'big_win');
});

t('resolveConfig: enabled=true honored', () => {
  eq(resolveConfig({ coinShower: { enabled: true } }).enabled, true);
});

t('resolveConfig: triggerMode whitelist', () => {
  eq(resolveConfig({ coinShower: { triggerMode: 'any_win' } }).triggerMode, 'any_win');
  eq(resolveConfig({ coinShower: { triggerMode: 'bonus_trigger' } }).triggerMode, 'bonus_trigger');
  eq(resolveConfig({ coinShower: { triggerMode: 'cascade_chain' } }).triggerMode, 'cascade_chain');
  eq(resolveConfig({ coinShower: { triggerMode: 'INVALID' } }).triggerMode, 'big_win');
});

t('resolveConfig: spawnArc whitelist', () => {
  eq(resolveConfig({ coinShower: { spawnArc: 'top-center' } }).spawnArc, 'top-center');
  eq(resolveConfig({ coinShower: { spawnArc: 'left' } }).spawnArc, 'left');
  eq(resolveConfig({ coinShower: { spawnArc: 'right' } }).spawnArc, 'right');
  eq(resolveConfig({ coinShower: { spawnArc: 'INVALID' } }).spawnArc, 'top');
});

t('resolveConfig: minWinX clamped [1,10000]', () => {
  eq(resolveConfig({ coinShower: { minWinX: 50 } }).minWinX, 50);
  eq(resolveConfig({ coinShower: { minWinX: 0 } }).minWinX, 25);
  eq(resolveConfig({ coinShower: { minWinX: 99999 } }).minWinX, 25);
});

t('resolveConfig: bigWinMinTier clamped [1,10]', () => {
  eq(resolveConfig({ coinShower: { bigWinMinTier: 4 } }).bigWinMinTier, 4);
  eq(resolveConfig({ coinShower: { bigWinMinTier: 0 } }).bigWinMinTier, 2);
  eq(resolveConfig({ coinShower: { bigWinMinTier: 99 } }).bigWinMinTier, 2);
});

t('resolveConfig: chainMinLen clamped [1,50]', () => {
  eq(resolveConfig({ coinShower: { chainMinLen: 7 } }).chainMinLen, 7);
  eq(resolveConfig({ coinShower: { chainMinLen: 0 } }).chainMinLen, 3);
  eq(resolveConfig({ coinShower: { chainMinLen: 9999 } }).chainMinLen, 3);
});

t('resolveConfig: coinCount clamped [1,200]', () => {
  eq(resolveConfig({ coinShower: { coinCount: 80 } }).coinCount, 80);
  eq(resolveConfig({ coinShower: { coinCount: 0 } }).coinCount, 48);
  eq(resolveConfig({ coinShower: { coinCount: 9999 } }).coinCount, 48);
});

t('resolveConfig: durationMs clamped [200,10000]', () => {
  eq(resolveConfig({ coinShower: { durationMs: 1500 } }).durationMs, 1500);
  eq(resolveConfig({ coinShower: { durationMs: 50 } }).durationMs, 2000);
  eq(resolveConfig({ coinShower: { durationMs: 99999 } }).durationMs, 2000);
});

t('resolveConfig: gravityPx clamped [50,5000]', () => {
  eq(resolveConfig({ coinShower: { gravityPx: 2000 } }).gravityPx, 2000);
  eq(resolveConfig({ coinShower: { gravityPx: 1 } }).gravityPx, 1400);
  eq(resolveConfig({ coinShower: { gravityPx: 99999 } }).gravityPx, 1400);
});

t('resolveConfig: coinColor RGB validation', () => {
  eq(resolveConfig({ coinShower: { coinColor: '12,34,56' } }).coinColor, '12,34,56');
  eq(resolveConfig({ coinShower: { coinColor: 'gold' } }).coinColor, '255,214,110');
  eq(resolveConfig({ coinShower: { coinColor: '999,1,2' } }).coinColor, '255,214,110');
});

t('resolveConfig: haptic toggle', () => {
  eq(resolveConfig({ coinShower: { haptic: true } }).haptic, true);
  eq(resolveConfig({ coinShower: { haptic: 'truthy' } }).haptic, false);   /* must be boolean type */
});

t('resolveConfig: feature auto-enable', () => {
  eq(resolveConfig({ features: [{ kind: 'coin_shower' }] }).enabled, true);
  eq(resolveConfig({ features: [{ kind: 'big_win_celebration' }] }).enabled, true);
  eq(resolveConfig({ features: [{ kind: 'celebration_burst' }] }).enabled, true);
});

t('resolveConfig: explicit enabled=false overrides feature auto-enable', () => {
  eq(resolveConfig({
    features: [{ kind: 'coin_shower' }],
    coinShower: { enabled: false },
  }).enabled, false);
});

/* ─── CSS emit ─────────────────────────────────────────────────────── */
t('emitCoinShowerCSS: disabled → empty', () => {
  eq(emitCoinShowerCSS({ enabled: false }), '');
});

t('emitCoinShowerCSS: enabled → container + coin + keyframes', () => {
  const out = emitCoinShowerCSS({ ...defaultConfig(), enabled: true });
  ct(out, '.coin-shower');
  ct(out, '.coin-shower .coin');
  ct(out, '@keyframes coinFall');
  ct(out, 'will-change: transform, opacity');
});

t('emitCoinShowerCSS: prefers-reduced-motion guard present + hard motion kill', () => {
  const out = emitCoinShowerCSS({ ...defaultConfig(), enabled: true });
  ct(out, '@media (prefers-reduced-motion: reduce)');
  /* Hard motion-kill — A4 audit demands one of these directives. */
  ct(out, 'animation: none');
  ct(out, 'transform: none');
});

t('emitCoinShowerCSS: mobile responsive rule present', () => {
  const out = emitCoinShowerCSS({ ...defaultConfig(), enabled: true });
  ct(out, '@media (max-width: 480px)');
});

t('emitCoinShowerCSS: coinColor baked in via rgba()', () => {
  const out = emitCoinShowerCSS({ ...defaultConfig(), enabled: true, coinColor: '10,20,30' });
  ct(out, 'rgba(10,20,30');
});

t('emitCoinShowerCSS: spawnArc affects origin geometry', () => {
  const top = emitCoinShowerCSS({ ...defaultConfig(), enabled: true, spawnArc: 'top' });
  const left = emitCoinShowerCSS({ ...defaultConfig(), enabled: true, spawnArc: 'left' });
  /* top arc starts at top: 0%; left arc starts at top: 50%. */
  ct(top, 'top: 0%');
  ct(left, 'top: 50%');
});

/* ─── Markup emit ──────────────────────────────────────────────────── */
t('emitCoinShowerMarkup: disabled → empty', () => {
  eq(emitCoinShowerMarkup({ enabled: false }), '');
});

t('emitCoinShowerMarkup: enabled emits id, data-active, aria-hidden', () => {
  const out = emitCoinShowerMarkup({ ...defaultConfig(), enabled: true });
  ct(out, 'id="coinShower"');
  ct(out, 'data-active="false"');
  ct(out, 'aria-hidden="true"');
});

/* ─── Runtime emit ─────────────────────────────────────────────────── */
t('emitCoinShowerRuntime: disabled → stub (no HookBus.on)', () => {
  const out = emitCoinShowerRuntime({ enabled: false });
  ct(out, 'disabled');
  nct(out, 'HookBus.on');
});

t('emitCoinShowerRuntime: enabled wires HookBus.on for big_win mode', () => {
  const out = emitCoinShowerRuntime({ ...defaultConfig(), enabled: true, triggerMode: 'big_win' });
  ct(out, 'HookBus.on');
  ct(out, "'onBigWinTier'");
});

t('emitCoinShowerRuntime: bonus_trigger mode wires onFsTrigger', () => {
  const out = emitCoinShowerRuntime({ ...defaultConfig(), enabled: true, triggerMode: 'bonus_trigger' });
  ct(out, "HookBus.on");
  ct(out, "'onFsTrigger'");
});

t('emitCoinShowerRuntime: cascade_chain mode wires onTumbleStep', () => {
  const out = emitCoinShowerRuntime({ ...defaultConfig(), enabled: true, triggerMode: 'cascade_chain' });
  ct(out, "'onTumbleStep'");
});

t('emitCoinShowerRuntime: any_win mode wires onSpinResult', () => {
  const out = emitCoinShowerRuntime({ ...defaultConfig(), enabled: true, triggerMode: 'any_win' });
  ct(out, "'onSpinResult'");
});

t('emitCoinShowerRuntime: exactly one trigger binding per build', () => {
  /* Build-time dispatch — only the selected listener appears in output. */
  const bw = emitCoinShowerRuntime({ ...defaultConfig(), enabled: true, triggerMode: 'big_win' });
  nct(bw, "'onTumbleStep'");
  nct(bw, "'onSpinResult'");
  nct(bw, "'onFsTrigger'");

  const aw = emitCoinShowerRuntime({ ...defaultConfig(), enabled: true, triggerMode: 'any_win' });
  nct(aw, "'onBigWinTier'");
  nct(aw, "'onTumbleStep'");
  nct(aw, "'onFsTrigger'");
});

t('emitCoinShowerRuntime: emits onCoinShowerStart + onCoinShowerEnd', () => {
  const out = emitCoinShowerRuntime({ ...defaultConfig(), enabled: true });
  ct(out, 'onCoinShowerStart');
  ct(out, 'onCoinShowerEnd');
});

t('emitCoinShowerRuntime: exposes window.fireCoinShower', () => {
  const out = emitCoinShowerRuntime({ ...defaultConfig(), enabled: true });
  ct(out, 'window.fireCoinShower');
});

t('emitCoinShowerRuntime: respects prefers-reduced-motion at runtime', () => {
  const out = emitCoinShowerRuntime({ ...defaultConfig(), enabled: true });
  ct(out, '(prefers-reduced-motion: reduce)');
});

t('emitCoinShowerRuntime: haptic gated by config + navigator', () => {
  const off = emitCoinShowerRuntime({ ...defaultConfig(), enabled: true, haptic: false });
  ct(off, 'CS_HAPTIC       = false');
  const on  = emitCoinShowerRuntime({ ...defaultConfig(), enabled: true, haptic: true  });
  ct(on, 'CS_HAPTIC       = true');
  ct(on, 'navigator.vibrate');
});

/* ─── Determinism ──────────────────────────────────────────────────── */
t('determinism: same config → byte-identical CSS', () => {
  const cfg = { ...defaultConfig(), enabled: true };
  const a = emitCoinShowerCSS(cfg);
  const b = emitCoinShowerCSS(cfg);
  eq(a, b);
});

t('determinism: same config → byte-identical Runtime', () => {
  const cfg = { ...defaultConfig(), enabled: true };
  const a = emitCoinShowerRuntime(cfg);
  const b = emitCoinShowerRuntime(cfg);
  eq(a, b);
});

/* ─── Vendor neutrality ────────────────────────────────────────────── */
t('vendor-neutral: no studio / game names in emitted artefacts', () => {
  const cfg = { ...defaultConfig(), enabled: true };
  const out = emitCoinShowerCSS(cfg)
            + emitCoinShowerMarkup(cfg)
            + emitCoinShowerRuntime(cfg);
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
