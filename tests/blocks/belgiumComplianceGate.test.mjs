#!/usr/bin/env node
/**
 * tests/blocks/belgiumComplianceGate.test.mjs
 *
 * Wave F7 / HX4 — Belgian Gaming Commission (BGC / KSC) compliance gate.
 * AR 25/10/2018 + Loi 7/5/1999.
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
const srcPath = resolve(here, '../../src/blocks/belgiumComplianceGate.mjs');
const src = readFileSync(srcPath, 'utf8');
const legoSrc = readFileSync(resolve(here, '../../tools/lego-gate.mjs'), 'utf8');

const mod = await import('../../src/blocks/belgiumComplianceGate.mjs');
const {
  defaultConfig,
  resolveConfig,
  emitBelgiumComplianceGateCSS,
  emitBelgiumComplianceGateRuntime,
  BE_MIN_SPIN_MS_DEFAULT,
  BE_UNDER21_CAP_EUR_DEFAULT,
} = mod;

block('1. Public API constants', () => {
  t('1.1 BE_MIN_SPIN_MS_DEFAULT = 2500', BE_MIN_SPIN_MS_DEFAULT === 2500);
  t('1.2 BE_UNDER21_CAP_EUR_DEFAULT = 200', BE_UNDER21_CAP_EUR_DEFAULT === 200);
  t('1.3 bounds frozen', Object.isFrozen(mod.BE_MIN_SPIN_MS_BOUNDS));
});

block('2. defaultConfig', () => {
  const c = defaultConfig();
  t('2.1 enabled defaults false', c.enabled === false);
  t('2.2 jurisdiction defaults null', c.jurisdiction === null);
  t('2.3 minSpinMs defaults 2500', c.minSpinMs === 2500);
  t('2.4 under21WeeklyCapEur defaults 200', c.under21WeeklyCapEur === 200);
});

block('3. resolveConfig jurisdiction precedence + auto-enable', () => {
  t('3.1 no jurisdiction → disabled', resolveConfig({}).enabled === false);

  const c1 = resolveConfig({ regulator: { profile: 'BE' } });
  t('3.2 regulator.profile BE → enabled', c1.enabled === true && c1.jurisdiction === 'BE');

  const c2 = resolveConfig({ responsibleGambling: { jurisdiction: 'be' } });
  t('3.3 lowercase via responsibleGambling → uppercase + enabled',
    c2.jurisdiction === 'BE' && c2.enabled === true);

  const c3 = resolveConfig({
    regulator: { profile: 'BE' },
    responsibleGambling: { jurisdiction: 'UKGC' },
    belgiumComplianceGate: { jurisdiction: 'SE' },
  });
  t('3.4 regulator.profile precedence wins', c3.jurisdiction === 'BE' && c3.enabled === true);

  const c4 = resolveConfig({ regulator: { profile: 'UKGC' } });
  t('3.5 non-BE → disabled', c4.enabled === false && c4.jurisdiction === 'UKGC');

  const c5 = resolveConfig({ belgiumComplianceGate: { enabled: true } });
  t('3.6 explicit enabled:true honored without jurisdiction', c5.enabled === true);
});

block('4. resolveConfig knob clamping', () => {
  const low = resolveConfig({ belgiumComplianceGate: { minSpinMs: 100 } });
  t('4.1 minSpinMs too low → default 2500', low.minSpinMs === 2500);
  const high = resolveConfig({ belgiumComplianceGate: { minSpinMs: 999999 } });
  t('4.2 minSpinMs too high → default 2500', high.minSpinMs === 2500);
  const ok = resolveConfig({ belgiumComplianceGate: { minSpinMs: 3500 } });
  t('4.3 valid minSpinMs applied', ok.minSpinMs === 3500);
  const bad = resolveConfig({ belgiumComplianceGate: { minSpinMs: 'fast' } });
  t('4.4 bad type ignored → default', bad.minSpinMs === 2500);
  const cap = resolveConfig({ belgiumComplianceGate: { under21WeeklyCapEur: 500 } });
  t('4.5 custom under21 cap applied', cap.under21WeeklyCapEur === 500);
});

block('5. emit surfaces', () => {
  t('5.1 emitCSS returns empty string', emitBelgiumComplianceGateCSS(defaultConfig()) === '');
  t('5.2 emitRuntime disabled returns empty', emitBelgiumComplianceGateRuntime(defaultConfig()) === '');
  t('5.3 emitRuntime non-BE returns empty',
    emitBelgiumComplianceGateRuntime(resolveConfig({ regulator: { profile: 'DE' } })) === '');
});

block('6. emitRuntime BE wiring', () => {
  const rt = emitBelgiumComplianceGateRuntime(resolveConfig({ regulator: { profile: 'BE' } }));
  t('6.1 sets __BE_EPIS_CHECK_REQUIRED__', /window\.__BE_EPIS_CHECK_REQUIRED__\s*=\s*true/.test(rt));
  t('6.2 emits onBeEpisCheckRequired', /HookBus\.emit\(\s*['"]onBeEpisCheckRequired['"]/.test(rt));
  t('6.3 sets __BE_UNDER21_WEEKLY_CAP_EUR__', /window\.__BE_UNDER21_WEEKLY_CAP_EUR__\s*=\s*U21_CAP_EUR/.test(rt));
  t('6.4 emits onBeUnder21CapEnforced', /HookBus\.emit\(\s*['"]onBeUnder21CapEnforced['"]/.test(rt));
  t('6.5 sets __BE_COOLING_OFF_REQUIRED__', /window\.__BE_COOLING_OFF_REQUIRED__\s*=\s*true/.test(rt));
  t('6.6 emits onBeCoolingOffRequired', /HookBus\.emit\(\s*['"]onBeCoolingOffRequired['"]/.test(rt));
  t('6.7 sets __BE_MIN_SPIN_MS__', /window\.__BE_MIN_SPIN_MS__\s*=\s*MIN_SPIN_MS/.test(rt));
  t('6.8 emits onBeMinSpinPaceEnforced', /HookBus\.emit\(\s*['"]onBeMinSpinPaceEnforced['"]/.test(rt));
  t('6.9 sets __BE_LOSS_DISPLAY_REQUIRED__', /window\.__BE_LOSS_DISPLAY_REQUIRED__\s*=\s*true/.test(rt));
  t('6.10 emits onBeLossDisplayRequired', /HookBus\.emit\(\s*['"]onBeLossDisplayRequired['"]/.test(rt));
  t('6.11 payload cites AR Art.4', /BE-AR-25\.10\.2018-Art\.4/.test(rt));
  t('6.12 payload cites AR Art.16', /BE-AR-25\.10\.2018-Art\.16/.test(rt));
});

block('7. LEGO contracts', () => {
  const events = [
    'onBeEpisCheckRequired',
    'onBeUnder21CapEnforced',
    'onBeCoolingOffRequired',
    'onBeMinSpinPaceEnforced',
    'onBeLossDisplayRequired',
  ];
  for (const ev of events) {
    t(`7.${ev} owner declared in lego-gate.mjs`,
      new RegExp(`${ev}:\\s*\\[\\s*['"]belgiumComplianceGate\\.mjs['"]\\s*\\]`).test(legoSrc));
  }
  const optOutMatch = legoSrc.match(/HOOK_REGISTRATION_OPT_OUT[\s\S]*?\n\]\);/);
  t('7.6 belgiumComplianceGate.mjs in HOOK_REGISTRATION_OPT_OUT',
    !!optOutMatch && optOutMatch[0].includes("belgiumComplianceGate.mjs"));
});

block('8. Honest scope', () => {
  t('8.1 Source cites Art.4', /Art\.4/.test(src));
  t('8.2 Source cites Art.16', /Art\.16/.test(src));
  t('8.3 Source cites rule_no_math_unless_asked', /rule_no_math_unless_asked/.test(src));
});

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
