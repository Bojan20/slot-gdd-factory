#!/usr/bin/env node
/**
 * tests/blocks/germanyComplianceGate.test.mjs
 *
 * W58.J-DE — GlüStV (Glücksspielstaatsvertrag 2021) compliance gate.
 *
 * Authority anchors:
 *   §11(2) Spielpause     — 5-second spin pace floor (rapid-play protection)
 *   §6e    Speicherverbot — no persisted state across sessions
 *   §11(3) Boni-Verbot    — already enforced by bonusBuy.mjs (W57.A4)
 *
 * This test pins both ends of the gate:
 *   1. resolveConfig — 3-key jurisdiction precedence + auto-enable when DE
 *   2. emitRuntime — §11(2) window flag + §6e storage clear + 2 sole emits
 *   3. emit-only block — registered in HOOK_REGISTRATION_OPT_OUT
 *   4. EXPECTED_EMIT_OWNERS — both events sole-owned by this block
 *   5. CSS no-op — block has no visual surface
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
const srcPath = resolve(here, '../../src/blocks/germanyComplianceGate.mjs');
const src = readFileSync(srcPath, 'utf8');
const legoSrc = readFileSync(resolve(here, '../../tools/lego-gate.mjs'), 'utf8');

const mod = await import('../../src/blocks/germanyComplianceGate.mjs');
const {
  defaultConfig,
  resolveConfig,
  emitGermanyComplianceGateCSS,
  emitGermanyComplianceGateRuntime,
  STATE_CLEAR_PREFIXES,
  DE_MIN_SPIN_MS_DEFAULT,
} = mod;

/* ════════════════════════════════════════════════════════════════════
 * 1. Exports + contract
 * ════════════════════════════════════════════════════════════════════ */
block('1. Public API contract', () => {
  t('1.1 STATE_CLEAR_PREFIXES exported',     !!STATE_CLEAR_PREFIXES);
  t('1.2 STATE_CLEAR_PREFIXES frozen',        Object.isFrozen(STATE_CLEAR_PREFIXES));
  t('1.3 STATE_CLEAR_PREFIXES has __SLOT_',   STATE_CLEAR_PREFIXES.includes('__SLOT_'));
  t('1.4 STATE_CLEAR_PREFIXES has __FS_',     STATE_CLEAR_PREFIXES.includes('__FS_'));
  t('1.5 STATE_CLEAR_PREFIXES has __HW_',     STATE_CLEAR_PREFIXES.includes('__HW_'));
  t('1.6 DE_MIN_SPIN_MS_DEFAULT = 5000 (§11(2) floor)',
    DE_MIN_SPIN_MS_DEFAULT === 5000);
});

/* ════════════════════════════════════════════════════════════════════
 * 2. defaultConfig
 * ════════════════════════════════════════════════════════════════════ */
block('2. defaultConfig', () => {
  const c = defaultConfig();
  t('2.1 enabled defaults false (opt-in)',   c.enabled === false);
  t('2.2 jurisdiction defaults null',        c.jurisdiction === null);
  t('2.3 minSpinMs defaults 5000',           c.minSpinMs === 5000);
  t('2.4 clearOnBoot defaults true',         c.clearOnBoot === true);
  t('2.5 prefixes defaults to STATE_CLEAR_PREFIXES',
    JSON.stringify(c.prefixes) === JSON.stringify(STATE_CLEAR_PREFIXES.slice()));
  /* mutating defaults must not leak between calls */
  c.prefixes.push('__POISON__');
  const c2 = defaultConfig();
  t('2.6 defaults return fresh array (no mutation leak)',
    !c2.prefixes.includes('__POISON__'));
});

/* ════════════════════════════════════════════════════════════════════
 * 3. resolveConfig — 3-key jurisdiction precedence + auto-enable DE
 * ════════════════════════════════════════════════════════════════════ */
block('3. resolveConfig 3-key precedence + auto-enable', () => {
  /* No jurisdiction → enabled stays false. */
  const off = resolveConfig({});
  t('3.1 No jurisdiction → enabled FALSE', off.enabled === false);
  t('3.2 No jurisdiction → jurisdiction null', off.jurisdiction === null);

  /* DE via germanyComplianceGate.jurisdiction (3rd precedence). */
  const c1 = resolveConfig({ germanyComplianceGate: { jurisdiction: 'DE' } });
  t('3.3 DE via germanyComplianceGate → enabled TRUE', c1.enabled === true);
  t('3.4 DE jurisdiction normalized uppercase', c1.jurisdiction === 'DE');

  /* DE via responsibleGambling.jurisdiction (2nd precedence). */
  const c2 = resolveConfig({ responsibleGambling: { jurisdiction: 'de' } });
  t('3.5 lowercase de via responsibleGambling → uppercase + enabled',
    c2.jurisdiction === 'DE' && c2.enabled === true);

  /* DE via regulator.profile (1st precedence — wins over the rest). */
  const c3 = resolveConfig({
    regulator: { profile: 'DE' },
    responsibleGambling: { jurisdiction: 'UKGC' }, /* should lose */
    germanyComplianceGate: { jurisdiction: 'MGA' }, /* should lose */
  });
  t('3.6 regulator.profile precedence wins',
    c3.jurisdiction === 'DE' && c3.enabled === true);

  /* Non-DE jurisdiction → enabled stays false (no auto-enable). */
  const c4 = resolveConfig({ regulator: { profile: 'UKGC' } });
  t('3.7 UKGC → enabled FALSE (no auto-enable outside DE)',
    c4.enabled === false && c4.jurisdiction === 'UKGC');

  /* Explicit GDD opt-in regardless of jurisdiction. */
  const c5 = resolveConfig({ germanyComplianceGate: { enabled: true } });
  t('3.8 explicit enabled:true honored without jurisdiction', c5.enabled === true);
});

/* ════════════════════════════════════════════════════════════════════
 * 4. resolveConfig — minSpinMs bounds + prefix sanitization
 * ════════════════════════════════════════════════════════════════════ */
block('4. resolveConfig knob clamping', () => {
  /* Bounds clamp on minSpinMs (1000..30000). */
  const tooLow = resolveConfig({ germanyComplianceGate: { minSpinMs: 100 } });
  t('4.1 minSpinMs 100 out-of-bounds → defaults 5000', tooLow.minSpinMs === 5000);
  const tooHigh = resolveConfig({ germanyComplianceGate: { minSpinMs: 999999 } });
  t('4.2 minSpinMs 999999 out-of-bounds → defaults 5000', tooHigh.minSpinMs === 5000);
  const ok = resolveConfig({ germanyComplianceGate: { minSpinMs: 7500 } });
  t('4.3 minSpinMs 7500 valid → applied', ok.minSpinMs === 7500);
  const badType = resolveConfig({ germanyComplianceGate: { minSpinMs: 'fast' } });
  t('4.4 minSpinMs string ignored → defaults 5000', badType.minSpinMs === 5000);

  /* Prefix sanitization. */
  const evil = resolveConfig({ germanyComplianceGate: {
    prefixes: ['__OK_', 'with space', '__hyphen-bad', '__OK2_', '<script>'],
  }});
  t('4.5 prefix list drops space/hyphen/HTML, keeps OK only',
    evil.prefixes.length === 2 && evil.prefixes.includes('__OK_') && evil.prefixes.includes('__OK2_'));
  const allBad = resolveConfig({ germanyComplianceGate: { prefixes: ['bad space'] } });
  t('4.6 all-bad prefix list → defaults retained',
    JSON.stringify(allBad.prefixes) === JSON.stringify(STATE_CLEAR_PREFIXES.slice()));
});

/* ════════════════════════════════════════════════════════════════════
 * 5. emitCSS no-op contract
 * ════════════════════════════════════════════════════════════════════ */
block('5. emitCSS no-op', () => {
  t('5.1 emitCSS returns empty string (block has no visual surface)',
    emitGermanyComplianceGateCSS(defaultConfig()) === '');
  t('5.2 emitCSS enabled DE also returns empty',
    emitGermanyComplianceGateCSS(resolveConfig({ regulator: { profile: 'DE' } })) === '');
});

/* ════════════════════════════════════════════════════════════════════
 * 6. emitRuntime disabled → empty string
 * ════════════════════════════════════════════════════════════════════ */
block('6. emitRuntime disabled', () => {
  t('6.1 disabled config → empty runtime', emitGermanyComplianceGateRuntime(defaultConfig()) === '');
  t('6.2 UKGC jurisdiction → no auto-enable → empty runtime',
    emitGermanyComplianceGateRuntime(resolveConfig({ regulator: { profile: 'UKGC' } })) === '');
});

/* ════════════════════════════════════════════════════════════════════
 * 7. emitRuntime DE wiring — §11(2) spin pace flag + emit
 * ════════════════════════════════════════════════════════════════════ */
block('7. emitRuntime §11(2) wiring', () => {
  const rt = emitGermanyComplianceGateRuntime(resolveConfig({ regulator: { profile: 'DE' } }));
  t('7.1 sets window.__DE_MIN_SPIN_MS__ = 5000',
    /window\.__DE_MIN_SPIN_MS__\s*=\s*MIN_SPIN_MS/.test(rt) &&
    /MIN_SPIN_MS\s*=\s*5000/.test(rt));
  t('7.2 sole-owner emit onMinSpinPaceEnforced',
    /HookBus\.emit\(\s*['"]onMinSpinPaceEnforced['"]/.test(rt));
  t('7.3 emit payload cites DE-GluStV-2021-§11(2)',
    /onMinSpinPaceEnforced[\s\S]{0,400}DE-GluStV-2021-§11\(2\)/.test(rt));
  t('7.4 emit payload includes jurisdiction',
    /onMinSpinPaceEnforced[\s\S]{0,400}jurisdiction:/.test(rt));
});

/* ════════════════════════════════════════════════════════════════════
 * 8. emitRuntime §6e wiring — storage clear + emit
 * ════════════════════════════════════════════════════════════════════ */
block('8. emitRuntime §6e wiring', () => {
  const rt = emitGermanyComplianceGateRuntime(resolveConfig({ regulator: { profile: 'DE' } }));
  t('8.1 _clearPrefixedStorage helper declared',
    /function\s+_clearPrefixedStorage/.test(rt));
  t('8.2 iterates localStorage + sessionStorage',
    /window\.localStorage/.test(rt) && /window\.sessionStorage/.test(rt));
  t('8.3 try/catch around each storage access (private-mode safety)',
    /try\s*\{[\s\S]{0,200}localStorage[\s\S]{0,200}\}\s*catch/.test(rt));
  t('8.4 prefix-matched keys collected via indexOf === 0',
    /key\.indexOf\(PREFIXES\[[\s\S]{0,30}\)\s*===\s*0/.test(rt));
  t('8.5 sole-owner emit onGameStateCleared',
    /HookBus\.emit\(\s*['"]onGameStateCleared['"]/.test(rt));
  t('8.6 emit payload cites DE-GluStV-2021-§6e',
    /onGameStateCleared[\s\S]{0,500}DE-GluStV-2021-§6e/.test(rt));
  t('8.7 emit payload includes count of cleared keys',
    /onGameStateCleared[\s\S]{0,500}count:/.test(rt));
  t('8.8 prefixesCleared shipped as fresh slice (no leak)',
    /prefixesCleared:\s*PREFIXES\.slice\(\)/.test(rt));
});

/* ════════════════════════════════════════════════════════════════════
 * 9. emitRuntime — clearOnBoot=false → §6e suppressed but §11(2) still fires
 * ════════════════════════════════════════════════════════════════════ */
block('9. emitRuntime clearOnBoot=false', () => {
  const cfg = resolveConfig({
    regulator: { profile: 'DE' },
    germanyComplianceGate: { clearOnBoot: false },
  });
  const rt = emitGermanyComplianceGateRuntime(cfg);
  t('9.1 CLEAR_ON_BOOT baked false',
    /CLEAR_ON_BOOT\s*=\s*false/.test(rt));
  t('9.2 §11(2) onMinSpinPaceEnforced still emitted',
    /HookBus\.emit\(\s*['"]onMinSpinPaceEnforced['"]/.test(rt));
  /* §6e branch still emits onGameStateCleared (since the count of
   * cleared items is 0 when CLEAR_ON_BOOT is false the storage isn't
   * touched, but the audit event is gated on the if-branch). Verify
   * the if-guard structure. */
  t('9.3 §6e wrapped in if (CLEAR_ON_BOOT)',
    /if\s*\(\s*CLEAR_ON_BOOT[\s\S]{0,80}_clearPrefixedStorage/.test(rt));
});

/* ════════════════════════════════════════════════════════════════════
 * 10. LEGO contracts
 * ════════════════════════════════════════════════════════════════════ */
block('10. LEGO contracts', () => {
  t('10.1 onMinSpinPaceEnforced owner declared',
    /onMinSpinPaceEnforced:\s*\[\s*['"]germanyComplianceGate\.mjs['"]\s*\]/.test(legoSrc));
  t('10.2 onGameStateCleared owner declared',
    /onGameStateCleared:\s*\[\s*['"]germanyComplianceGate\.mjs['"]\s*\]/.test(legoSrc));
  t('10.3 W58.J-DE marker comment in lego-gate.mjs',
    /W58\.J-DE/.test(legoSrc));
  t('10.4 GlüStV / GluStV citation in lego-gate.mjs',
    /Gl[üu]StV/.test(legoSrc));
  t('10.5 germanyComplianceGate.mjs registered in HOOK_REGISTRATION_OPT_OUT',
    /HOOK_REGISTRATION_OPT_OUT[\s\S]{0,3000}germanyComplianceGate\.mjs/.test(legoSrc));
});

/* ════════════════════════════════════════════════════════════════════
 * 11. Honest scope
 * ════════════════════════════════════════════════════════════════════ */
block('11. Honest scope', () => {
  t('11.1 Source cites §11(2) by section reference',
    /§\s*11\s*\(2\)/.test(src));
  t('11.2 Source cites §6e by section reference',
    /§\s*6e/.test(src));
  t('11.3 Source notes §11(3) bonus-buy already covered by W57.A4',
    /W57\.A4/.test(src) && /§\s*11\s*\(3\)/.test(src));
  t('11.4 Source cites rule_no_math_unless_asked honest scope',
    /rule_no_math_unless_asked/.test(src));
  t('11.5 No vendor / theme strings in source',
    !/(Wrath|Olympus|Lightning Link|Megaways|Pragmatic|NetEnt|Microgaming|IGT)/i.test(src));
});

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
