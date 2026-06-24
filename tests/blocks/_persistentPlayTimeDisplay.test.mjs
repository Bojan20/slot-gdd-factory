#!/usr/bin/env node
/**
 * tests/blocks/_persistentPlayTimeDisplay.test.mjs
 *
 * W58.J-SE — Spelinspektionen §7.2 persistent play-time display gate.
 *
 * Authority: Spelinspektionen Föreskrifter SIFS 2018:6 §7.2 "Information
 * om tid och förlust" — continuous-display obligation. Cross-validation
 * cousins (UKGC RTS 12, DGOJ Art 8) share the spirit; SE has the cleanest
 * formulation so we anchor on SE for the whitelist.
 *
 * This test pins both ends of the gate:
 *   1. resolveConfig — 3-key jurisdiction precedence + PLAY_TIME_DISPLAY
 *      whitelist + requirePersistentPlayTimeDisplay flag.
 *   2. emitCSS — persistent HUD chip class + safe-area inset support.
 *   3. emitRuntime — mount once + tick every second + sole-owner emit
 *      of onPlayTimeDisplayRequired.
 *   4. LEGO EXPECTED_EMIT_OWNERS — owner declaration.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function block(name, fn) { console.log('— ' + name + ' —'); fn(); console.log(''); }

const here = dirname(fileURLToPath(import.meta.url));
const srcPath = resolve(here, '../../src/blocks/realityCheck.mjs');
const src = readFileSync(srcPath, 'utf8');
const legoSrc = readFileSync(resolve(here, '../../tools/lego-gate.mjs'), 'utf8');

const mod = await import('../../src/blocks/realityCheck.mjs');
const {
  defaultConfig,
  resolveConfig,
  emitRealityCheckCSS,
  emitRealityCheckRuntime,
  PLAY_TIME_DISPLAY_REQUIRED_JURISDICTIONS,
} = mod;

/* ════════════════════════════════════════════════════════════════════
 * 1. Whitelist constants + frozen export
 * ════════════════════════════════════════════════════════════════════ */
block('1. PLAY_TIME_DISPLAY_REQUIRED_JURISDICTIONS contract', () => {
  t('1.1 Export exists', !!PLAY_TIME_DISPLAY_REQUIRED_JURISDICTIONS);
  t('1.2 Array shape (length ≥ 1)',
    Array.isArray(PLAY_TIME_DISPLAY_REQUIRED_JURISDICTIONS) &&
    PLAY_TIME_DISPLAY_REQUIRED_JURISDICTIONS.length >= 1);
  t('1.3 Contains SE (Spelinspektionen anchor)',
    PLAY_TIME_DISPLAY_REQUIRED_JURISDICTIONS.includes('SE'));
  t('1.4 Frozen (Object.isFrozen) — whitelist tamper-proof',
    Object.isFrozen(PLAY_TIME_DISPLAY_REQUIRED_JURISDICTIONS));
});

/* ════════════════════════════════════════════════════════════════════
 * 2. defaultConfig — new SE fields default null/false
 * ════════════════════════════════════════════════════════════════════ */
block('2. defaultConfig — W58.J-SE fields', () => {
  const c = defaultConfig();
  t('2.1 jurisdiction defaults to null', c.jurisdiction === null);
  t('2.2 requirePersistentPlayTimeDisplay defaults to false',
    c.requirePersistentPlayTimeDisplay === false);
});

/* ════════════════════════════════════════════════════════════════════
 * 3. resolveConfig — 3-key jurisdiction precedence
 * ════════════════════════════════════════════════════════════════════ */
block('3. resolveConfig 3-key precedence', () => {
  /* No jurisdiction → gate INACTIVE. */
  const off = resolveConfig({});
  t('3.1 No jurisdiction → requirePersistent…=false', off.requirePersistentPlayTimeDisplay === false);
  t('3.2 No jurisdiction → jurisdiction=null', off.jurisdiction === null);

  /* SE via realityCheck.jurisdiction (3rd precedence). */
  const c1 = resolveConfig({ realityCheck: { jurisdiction: 'SE' } });
  t('3.3 jurisdiction=SE via realityCheck → flag TRUE',
    c1.requirePersistentPlayTimeDisplay === true);
  t('3.4 jurisdiction normalized to UPPERCASE',
    c1.jurisdiction === 'SE');

  /* SE via responsibleGambling.jurisdiction (2nd precedence). */
  const c2 = resolveConfig({ responsibleGambling: { jurisdiction: 'se' } });
  t('3.5 lowercase se via responsibleGambling → uppercase + flag TRUE',
    c2.jurisdiction === 'SE' && c2.requirePersistentPlayTimeDisplay === true);

  /* SE via regulator.profile (1st precedence — wins over rest). */
  const c3 = resolveConfig({
    regulator: { profile: 'SE' },
    responsibleGambling: { jurisdiction: 'UKGC' }, /* should lose */
    realityCheck: { jurisdiction: 'MGA' },         /* should lose */
  });
  t('3.6 regulator.profile wins precedence over the other two',
    c3.jurisdiction === 'SE' && c3.requirePersistentPlayTimeDisplay === true);

  /* Non-SE jurisdiction → flag stays FALSE. */
  const c4 = resolveConfig({ realityCheck: { jurisdiction: 'UKGC' } });
  t('3.7 UKGC → jurisdiction set but flag FALSE (not on whitelist)',
    c4.jurisdiction === 'UKGC' && c4.requirePersistentPlayTimeDisplay === false);
});

/* ════════════════════════════════════════════════════════════════════
 * 4. emitCSS — persistent HUD chip class declaration
 * ════════════════════════════════════════════════════════════════════ */
block('4. emitCSS persistent HUD chip', () => {
  const c = resolveConfig({ realityCheck: { enabled: true, jurisdiction: 'SE' } });
  const css = emitRealityCheckCSS(c);
  t('4.1 .rc-play-time-hud class emitted', css.includes('.rc-play-time-hud'));
  t('4.2 position: fixed for always-on-top placement', /\.rc-play-time-hud\s*\{[\s\S]*position:\s*fixed/.test(css));
  t('4.3 safe-area-inset-top supported (iOS notch)',
    css.includes('env(safe-area-inset-top'));
  t('4.4 safe-area-inset-right supported',
    css.includes('env(safe-area-inset-right'));
  t('4.5 tabular-nums for digit-jitter-free updates',
    css.includes('tabular-nums'));
  t('4.6 pointer-events: none (purely visual, no hit-test)',
    /\.rc-play-time-hud[\s\S]*pointer-events:\s*none/.test(css));
  t('4.7 prefers-reduced-motion media block covers .rc-play-time-hud',
    /prefers-reduced-motion[\s\S]*\.rc-play-time-hud/.test(css));
});

/* ════════════════════════════════════════════════════════════════════
 * 5. emitRuntime — mount + tick + sole emit
 * ════════════════════════════════════════════════════════════════════ */
block('5. emitRuntime W58.J-SE wiring', () => {
  const c = resolveConfig({ realityCheck: { enabled: true, jurisdiction: 'SE' } });
  const rt = emitRealityCheckRuntime(c);

  t('5.1 __W58SE_REQUIRED flag baked TRUE for SE',
    /__W58SE_REQUIRED\s*=\s*true/.test(rt));
  t('5.2 __W58SE_JURISDICTION baked as "SE"',
    /__W58SE_JURISDICTION\s*=\s*"SE"/.test(rt));
  t('5.3 _mountPlayTimeHud function defined',
    /function\s+_mountPlayTimeHud/.test(rt));
  t('5.4 HUD element id rcPlayTimeHud used',
    rt.includes("'rcPlayTimeHud'"));
  t('5.5 Idempotent mount — getElementById check before append',
    /getElementById\('rcPlayTimeHud'\)[\s\S]{0,200}return/.test(rt));
  t('5.6 1-second setInterval tick',
    /setInterval\(\s*function[\s\S]{0,800},\s*1000\s*\)/.test(rt));
  t('5.7 Sole-owner emit of onPlayTimeDisplayRequired',
    /HookBus\.emit\(\s*['"]onPlayTimeDisplayRequired['"]/.test(rt));
  t('5.8 Emit payload includes jurisdiction + rule citation',
    /onPlayTimeDisplayRequired[\s\S]{0,200}jurisdiction[\s\S]{0,100}SE-SIFS-2018:6-7\.2/.test(rt));
  t('5.9 ARIA: role="status" on HUD',
    /setAttribute\(\s*['"]role['"]\s*,\s*['"]status['"]/.test(rt));
  t('5.10 ARIA: aria-live="off" (polite suppression — purely visual)',
    /setAttribute\(\s*['"]aria-live['"]\s*,\s*['"]off['"]/.test(rt));
  t('5.11 DOMContentLoaded wiring (boot timing)',
    /DOMContentLoaded[\s\S]{0,100}_mountPlayTimeHud/.test(rt));
});

/* ════════════════════════════════════════════════════════════════════
 * 6. emitRuntime — non-SE jurisdiction → mount no-op
 * ════════════════════════════════════════════════════════════════════ */
block('6. emitRuntime — non-SE → flag baked FALSE', () => {
  const c = resolveConfig({ realityCheck: { enabled: true, jurisdiction: 'UKGC' } });
  const rt = emitRealityCheckRuntime(c);
  t('6.1 __W58SE_REQUIRED flag baked FALSE for UKGC',
    /__W58SE_REQUIRED\s*=\s*false/.test(rt));
  t('6.2 Guard short-circuits mount when flag is false',
    /__W58SE_REQUIRED[\s\S]{0,80}return/.test(rt));
});

/* ════════════════════════════════════════════════════════════════════
 * 7. LEGO §4 — sole-owner declaration
 * ════════════════════════════════════════════════════════════════════ */
block('7. LEGO EXPECTED_EMIT_OWNERS contract', () => {
  t('7.1 onPlayTimeDisplayRequired declared in EXPECTED_EMIT_OWNERS',
    /onPlayTimeDisplayRequired:\s*\[\s*['"]realityCheck\.mjs['"]\s*\]/.test(legoSrc));
  t('7.2 W58.J-SE marker comment present in lego-gate.mjs',
    /W58\.J-SE/.test(legoSrc));
  t('7.3 SE rule citation in lego-gate.mjs',
    /Spelinspektionen[\s\S]{0,200}SIFS\s*2018:6/.test(legoSrc));
});

/* ════════════════════════════════════════════════════════════════════
 * 8. Honest scope markers
 * ════════════════════════════════════════════════════════════════════ */
block('8. Honest scope', () => {
  /* Source must declare the rule by name so a future audit can trace. */
  t('8.1 Source cites SIFS 2018:6 §7.2',
    /SIFS\s*2018:6/.test(src) && /§?7\.2/.test(src));
  /* Block is opt-in via jurisdiction; no theme strings. */
  t('8.2 No vendor / theme strings in W58.J-SE additions',
    !/(Wrath|Olympus|Lightning Link|Megaways|Pragmatic|NetEnt|Microgaming|industry standard)/i.test(
      src.split('W58.J-SE')[1] || ''));
});

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
