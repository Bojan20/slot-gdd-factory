#!/usr/bin/env node
/**
 * tests/blocks/ukgcComplianceGate.test.mjs
 *
 * Wave F7 / HX1 — UK Gambling Commission (UKGC) RTS compliance gate.
 * Mirrors belgiumComplianceGate.test.mjs structure for parity.
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
const srcPath = resolve(here, '../../src/blocks/ukgcComplianceGate.mjs');
const src = readFileSync(srcPath, 'utf8');
const legoSrc = readFileSync(resolve(here, '../../tools/lego-gate.mjs'), 'utf8');

const mod = await import('../../src/blocks/ukgcComplianceGate.mjs');
const {
  defaultConfig,
  resolveConfig,
  emitUkgcComplianceGateCSS,
  emitUkgcComplianceGateRuntime,
  UK_MIN_SPIN_MS_DEFAULT,
  UK_AUTOPLAY_MAX_CAP,
  UK_REALITY_CHECK_DEFAULT,
} = mod;

block('1. Public API constants', () => {
  t('1.1 UK_MIN_SPIN_MS_DEFAULT = 2500', UK_MIN_SPIN_MS_DEFAULT === 2500);
  t('1.2 UK_AUTOPLAY_MAX_CAP = 50', UK_AUTOPLAY_MAX_CAP === 50);
  t('1.3 UK_REALITY_CHECK_DEFAULT = 60*60*1000', UK_REALITY_CHECK_DEFAULT === 3600000);
  t('1.4 bounds frozen', Object.isFrozen(mod.UK_MIN_SPIN_MS_BOUNDS));
});

block('2. defaultConfig', () => {
  const c = defaultConfig();
  t('2.1 enabled defaults false', c.enabled === false);
  t('2.2 jurisdiction defaults null', c.jurisdiction === null);
  t('2.3 minSpinMs defaults 2500', c.minSpinMs === 2500);
  t('2.4 autoplayCap defaults 50', c.autoplayCap === 50);
});

block('3. resolveConfig jurisdiction precedence + auto-enable', () => {
  t('3.1 no jurisdiction → disabled', resolveConfig({}).enabled === false);

  const c1 = resolveConfig({ regulator: { profile: 'UKGC' } });
  t('3.2 regulator.profile UKGC → enabled', c1.enabled === true && c1.jurisdiction === 'UKGC');

  const c2 = resolveConfig({ responsibleGambling: { jurisdiction: 'uk' } });
  t('3.3 lowercase via responsibleGambling → uppercase + enabled',
    c2.jurisdiction === 'UK' && c2.enabled === true);

  const c3 = resolveConfig({ regulator: { profile: 'GB' } });
  t('3.4 GB synonym honored', c3.jurisdiction === 'GB' && c3.enabled === true);

  const c4 = resolveConfig({ regulator: { profile: 'DE' } });
  t('3.5 non-UK → disabled', c4.enabled === false);

  const c5 = resolveConfig({ ukgcComplianceGate: { enabled: true } });
  t('3.6 explicit enabled:true honored', c5.enabled === true);
});

block('4. resolveConfig knob clamping', () => {
  const low = resolveConfig({ ukgcComplianceGate: { minSpinMs: 100 } });
  t('4.1 minSpinMs too low → default 2500', low.minSpinMs === 2500);
  const ok = resolveConfig({ ukgcComplianceGate: { minSpinMs: 3500 } });
  t('4.2 valid minSpinMs applied', ok.minSpinMs === 3500);
  const cap = resolveConfig({ ukgcComplianceGate: { autoplayCap: 75 } });
  t('4.3 valid autoplayCap applied', cap.autoplayCap === 75);
  const badCap = resolveConfig({ ukgcComplianceGate: { autoplayCap: 5 } });
  t('4.4 autoplayCap below bounds → default 50', badCap.autoplayCap === 50);
  const rc = resolveConfig({ ukgcComplianceGate: { realityCheckMs: 1800000 } });
  t('4.5 realityCheckMs accepted', rc.realityCheckMs === 1800000);
});

block('5. emit surfaces', () => {
  t('5.1 emitCSS returns empty string', emitUkgcComplianceGateCSS(defaultConfig()) === '');
  t('5.2 emitRuntime disabled returns empty', emitUkgcComplianceGateRuntime(defaultConfig()) === '');
  t('5.3 emitRuntime non-UK returns empty',
    emitUkgcComplianceGateRuntime(resolveConfig({ regulator: { profile: 'DE' } })) === '');
});

block('6. emitRuntime UK wiring', () => {
  const rt = emitUkgcComplianceGateRuntime(resolveConfig({ regulator: { profile: 'UKGC' } }));
  t('6.1 sets __UK_MIN_SPIN_MS__', /window\.__UK_MIN_SPIN_MS__\s*=\s*MIN_SPIN_MS/.test(rt));
  t('6.2 emits onUkRtsSpinPaceEnforced', /HookBus\.emit\(\s*['"]onUkRtsSpinPaceEnforced['"]/.test(rt));
  t('6.3 emits onUkRtpDisclosureRequired', /HookBus\.emit\(\s*['"]onUkRtpDisclosureRequired['"]/.test(rt));
  t('6.4 emits onUkNetPositionRequired', /HookBus\.emit\(\s*['"]onUkNetPositionRequired['"]/.test(rt));
  t('6.5 emits onUkRealityCheckEnforced', /HookBus\.emit\(\s*['"]onUkRealityCheckEnforced['"]/.test(rt));
  t('6.6 emits onUkAutoplayCapEnforced', /HookBus\.emit\(\s*['"]onUkAutoplayCapEnforced['"]/.test(rt));
  t('6.7 emits onGamStopCheckRequired', /HookBus\.emit\(\s*['"]onGamStopCheckRequired['"]/.test(rt));
  t('6.8 payload cites RTS 14D', /UKGC-RTS-14D/.test(rt));
  t('6.9 payload cites RTS 8B', /UKGC-RTS-8B/.test(rt));
  t('6.10 payload cites RTS 13C', /UKGC-RTS-13C/.test(rt));
  t('6.11 payload cites RTS 12C', /UKGC-RTS-12C/.test(rt));
  t('6.12 payload cites RTS 11A', /UKGC-RTS-11A/.test(rt));
  t('6.13 payload cites GamStop Code 3.5.4', /UKGC-Code-3\.5\.4/.test(rt));
});

block('7. LEGO contracts', () => {
  const events = [
    'onUkRtsSpinPaceEnforced',
    'onUkRtpDisclosureRequired',
    'onUkNetPositionRequired',
    'onUkRealityCheckEnforced',
    'onUkAutoplayCapEnforced',
  ];
  for (const ev of events) {
    t(`7.${ev} owner declared in lego-gate.mjs`,
      new RegExp(`${ev}:\\s*\\[\\s*['"]ukgcComplianceGate\\.mjs['"]\\s*\\]`).test(legoSrc));
  }
  /* Validate membership by parsing OPT_OUT block bounds instead of a
   * length-bounded regex — the set grows past 3000 chars after Wave F7. */
  const optOutMatch = legoSrc.match(/HOOK_REGISTRATION_OPT_OUT[\s\S]*?\n\]\);/);
  t('7.6 ukgcComplianceGate.mjs in HOOK_REGISTRATION_OPT_OUT',
    !!optOutMatch && optOutMatch[0].includes("ukgcComplianceGate.mjs"));
});

block('8. Honest scope', () => {
  t('8.1 Source cites RTS 14D', /RTS 14D/.test(src));
  t('8.2 Source cites RTS 8B', /RTS 8B/.test(src));
  t('8.3 Source cites rule_no_math_unless_asked', /rule_no_math_unless_asked/.test(src));
});

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
