#!/usr/bin/env node
/**
 * tests/blocks/romaniaComplianceGate.test.mjs
 *
 * Wave F7 / HX6 — Romania ONJN (Oficiul Naţional pentru Jocuri de Noroc)
 * compliance gate. OUG 77/2009 + Regulament ONJN.
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
const srcPath = resolve(here, '../../src/blocks/romaniaComplianceGate.mjs');
const src = readFileSync(srcPath, 'utf8');
const legoSrc = readFileSync(resolve(here, '../../tools/lego-gate.mjs'), 'utf8');

const mod = await import('../../src/blocks/romaniaComplianceGate.mjs');
const {
  defaultConfig,
  resolveConfig,
  emitRomaniaComplianceGateCSS,
  emitRomaniaComplianceGateRuntime,
  RO_MIN_SPIN_MS_DEFAULT,
  RO_WIN_TAX_PCT_DEFAULT,
  RO_WIN_TAX_THRESHOLD,
  RO_HANDPAY_RON_DEFAULT,
} = mod;

block('1. Public API constants', () => {
  t('1.1 RO_MIN_SPIN_MS_DEFAULT = 2500', RO_MIN_SPIN_MS_DEFAULT === 2500);
  t('1.2 RO_WIN_TAX_PCT_DEFAULT = 10', RO_WIN_TAX_PCT_DEFAULT === 10);
  t('1.3 RO_WIN_TAX_THRESHOLD = 1000', RO_WIN_TAX_THRESHOLD === 1000);
  t('1.4 RO_HANDPAY_RON_DEFAULT = 100000', RO_HANDPAY_RON_DEFAULT === 100000);
  t('1.5 bounds frozen', Object.isFrozen(mod.RO_MIN_SPIN_MS_BOUNDS));
});

block('2. defaultConfig', () => {
  const c = defaultConfig();
  t('2.1 enabled defaults false', c.enabled === false);
  t('2.2 jurisdiction defaults null', c.jurisdiction === null);
  t('2.3 minSpinMs defaults 2500', c.minSpinMs === 2500);
  t('2.4 winTaxPct defaults 10', c.winTaxPct === 10);
  t('2.5 winTaxThresholdRon defaults 1000', c.winTaxThresholdRon === 1000);
});

block('3. resolveConfig jurisdiction precedence + auto-enable', () => {
  t('3.1 no jurisdiction → disabled', resolveConfig({}).enabled === false);

  const c1 = resolveConfig({ regulator: { profile: 'RO' } });
  t('3.2 regulator.profile RO → enabled', c1.enabled === true && c1.jurisdiction === 'RO');

  const c2 = resolveConfig({ responsibleGambling: { jurisdiction: 'ro' } });
  t('3.3 lowercase via responsibleGambling → uppercase + enabled',
    c2.jurisdiction === 'RO' && c2.enabled === true);

  const c3 = resolveConfig({ regulator: { profile: 'ONJN' } });
  t('3.4 ONJN synonym honored', c3.jurisdiction === 'ONJN' && c3.enabled === true);

  const c4 = resolveConfig({ regulator: { profile: 'DE' } });
  t('3.5 non-RO → disabled', c4.enabled === false);
});

block('4. resolveConfig knob clamping', () => {
  const low = resolveConfig({ romaniaComplianceGate: { minSpinMs: 100 } });
  t('4.1 minSpinMs too low → default 2500', low.minSpinMs === 2500);
  const ok = resolveConfig({ romaniaComplianceGate: { minSpinMs: 3500 } });
  t('4.2 valid minSpinMs applied', ok.minSpinMs === 3500);
});

block('5. emit surfaces', () => {
  t('5.1 emitCSS returns empty string', emitRomaniaComplianceGateCSS(defaultConfig()) === '');
  t('5.2 emitRuntime disabled returns empty', emitRomaniaComplianceGateRuntime(defaultConfig()) === '');
  t('5.3 emitRuntime non-RO returns empty',
    emitRomaniaComplianceGateRuntime(resolveConfig({ regulator: { profile: 'DE' } })) === '');
});

block('6. emitRuntime RO wiring', () => {
  const rt = emitRomaniaComplianceGateRuntime(resolveConfig({ regulator: { profile: 'RO' } }));
  t('6.1 sets __RO_WIN_TAX_PCT__', /window\.__RO_WIN_TAX_PCT__\s*=\s*TAX_PCT/.test(rt));
  t('6.2 emits onRoWinTaxDisclosureEnforced', /HookBus\.emit\(\s*['"]onRoWinTaxDisclosureEnforced['"]/.test(rt));
  t('6.3 emits onRoLimitsRequired', /HookBus\.emit\(\s*['"]onRoLimitsRequired['"]/.test(rt));
  t('6.4 emits onRoOsajCheckRequired', /HookBus\.emit\(\s*['"]onRoOsajCheckRequired['"]/.test(rt));
  t('6.5 emits onRoMinSpinPaceEnforced', /HookBus\.emit\(\s*['"]onRoMinSpinPaceEnforced['"]/.test(rt));
  t('6.6 emits onRoHandpayThresholdEnforced', /HookBus\.emit\(\s*['"]onRoHandpayThresholdEnforced['"]/.test(rt));
  t('6.7 payload cites OUG Art.10', /RO-OUG-77\.2009-Art\.10/.test(rt));
  t('6.8 payload cites Reg 2023.IX Art.5', /RO-Reg-2023\.IX-Art\.5/.test(rt));
  t('6.9 payload cites OSAJ register', /RO-OSAJ-Register/.test(rt));
  t('6.10 payload cites OUG Art.13', /RO-OUG-77\.2009-Art\.13/.test(rt));
  t('6.11 payload cites OUG Art.15', /RO-OUG-77\.2009-Art\.15/.test(rt));
});

block('7. LEGO contracts', () => {
  const events = [
    'onRoWinTaxDisclosureEnforced',
    'onRoLimitsRequired',
    'onRoOsajCheckRequired',
    'onRoMinSpinPaceEnforced',
    'onRoHandpayThresholdEnforced',
  ];
  for (const ev of events) {
    t(`7.${ev} owner declared in lego-gate.mjs`,
      new RegExp(`${ev}:\\s*\\[\\s*['"]romaniaComplianceGate\\.mjs['"]\\s*\\]`).test(legoSrc));
  }
  const optOutMatch = legoSrc.match(/HOOK_REGISTRATION_OPT_OUT[\s\S]*?\n\]\);/);
  t('7.6 romaniaComplianceGate.mjs in HOOK_REGISTRATION_OPT_OUT',
    !!optOutMatch && optOutMatch[0].includes("romaniaComplianceGate.mjs"));
});

block('8. Honest scope', () => {
  t('8.1 Source cites OUG 77/2009', /OUG 77\/2009/.test(src));
  t('8.2 Source cites ONJN', /ONJN/.test(src));
});

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
