#!/usr/bin/env node
/**
 * tests/blocks/denmarkComplianceGate.test.mjs
 *
 * Wave F7 / HX3 — Denmark Spillemyndigheden (DGA) compliance gate.
 * BEK 727 af 25/06/2010.
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
const srcPath = resolve(here, '../../src/blocks/denmarkComplianceGate.mjs');
const src = readFileSync(srcPath, 'utf8');
const legoSrc = readFileSync(resolve(here, '../../tools/lego-gate.mjs'), 'utf8');

const mod = await import('../../src/blocks/denmarkComplianceGate.mjs');
const {
  defaultConfig,
  resolveConfig,
  emitDenmarkComplianceGateCSS,
  emitDenmarkComplianceGateRuntime,
  DK_MIN_SPIN_MS_DEFAULT,
  DK_RC_DEFAULT,
} = mod;

block('1. Public API constants', () => {
  t('1.1 DK_MIN_SPIN_MS_DEFAULT = 2000', DK_MIN_SPIN_MS_DEFAULT === 2000);
  t('1.2 DK_RC_DEFAULT = 30*60*1000', DK_RC_DEFAULT === 1800000);
  t('1.3 bounds frozen', Object.isFrozen(mod.DK_MIN_SPIN_MS_BOUNDS));
});

block('2. defaultConfig', () => {
  const c = defaultConfig();
  t('2.1 enabled defaults false', c.enabled === false);
  t('2.2 jurisdiction defaults null', c.jurisdiction === null);
  t('2.3 minSpinMs defaults 2000', c.minSpinMs === 2000);
  t('2.4 realityCheckMs defaults 30 min', c.realityCheckMs === 1800000);
});

block('3. resolveConfig jurisdiction precedence + auto-enable', () => {
  t('3.1 no jurisdiction → disabled', resolveConfig({}).enabled === false);

  const c1 = resolveConfig({ regulator: { profile: 'DK' } });
  t('3.2 regulator.profile DK → enabled', c1.enabled === true && c1.jurisdiction === 'DK');

  const c2 = resolveConfig({ responsibleGambling: { jurisdiction: 'dk' } });
  t('3.3 lowercase via responsibleGambling → uppercase + enabled',
    c2.jurisdiction === 'DK' && c2.enabled === true);

  const c3 = resolveConfig({ regulator: { profile: 'DGA' } });
  t('3.4 DGA synonym honored', c3.jurisdiction === 'DGA' && c3.enabled === true);

  const c4 = resolveConfig({ regulator: { profile: 'DE' } });
  t('3.5 non-DK → disabled', c4.enabled === false);
});

block('4. resolveConfig knob clamping', () => {
  const low = resolveConfig({ denmarkComplianceGate: { minSpinMs: 100 } });
  t('4.1 minSpinMs too low → default 2000', low.minSpinMs === 2000);
  const ok = resolveConfig({ denmarkComplianceGate: { minSpinMs: 3500 } });
  t('4.2 valid minSpinMs applied', ok.minSpinMs === 3500);
  const rc = resolveConfig({ denmarkComplianceGate: { realityCheckMs: 900000 } });
  t('4.3 realityCheckMs accepted', rc.realityCheckMs === 900000);
});

block('5. emit surfaces', () => {
  t('5.1 emitCSS returns empty string', emitDenmarkComplianceGateCSS(defaultConfig()) === '');
  t('5.2 emitRuntime disabled returns empty', emitDenmarkComplianceGateRuntime(defaultConfig()) === '');
  t('5.3 emitRuntime non-DK returns empty',
    emitDenmarkComplianceGateRuntime(resolveConfig({ regulator: { profile: 'DE' } })) === '');
});

block('6. emitRuntime DK wiring', () => {
  const rt = emitDenmarkComplianceGateRuntime(resolveConfig({ regulator: { profile: 'DK' } }));
  t('6.1 sets __DK_REALITY_CHECK_MS__', /window\.__DK_REALITY_CHECK_MS__\s*=\s*RC_INTERVAL/.test(rt));
  t('6.2 emits onDkRealityCheckEnforced', /HookBus\.emit\(\s*['"]onDkRealityCheckEnforced['"]/.test(rt));
  t('6.3 emits onDkLossLimitRequired', /HookBus\.emit\(\s*['"]onDkLossLimitRequired['"]/.test(rt));
  t('6.4 emits onDkRofusCheckRequired', /HookBus\.emit\(\s*['"]onDkRofusCheckRequired['"]/.test(rt));
  t('6.5 emits onDkMinSpinPaceEnforced', /HookBus\.emit\(\s*['"]onDkMinSpinPaceEnforced['"]/.test(rt));
  t('6.6 payload cites BEK 727 §44', /DK-BEK-727-§44/.test(rt));
  t('6.7 payload cites BEK 727 §32', /DK-BEK-727-§32/.test(rt));
  t('6.8 payload cites BEK 727 §29', /DK-BEK-727-§29/.test(rt));
  t('6.9 payload cites BEK 727 §41', /DK-BEK-727-§41/.test(rt));
});

block('7. LEGO contracts', () => {
  const events = [
    'onDkRealityCheckEnforced',
    'onDkLossLimitRequired',
    'onDkRofusCheckRequired',
    'onDkMinSpinPaceEnforced',
  ];
  for (const ev of events) {
    t(`7.${ev} owner declared in lego-gate.mjs`,
      new RegExp(`${ev}:\\s*\\[\\s*['"]denmarkComplianceGate\\.mjs['"]\\s*\\]`).test(legoSrc));
  }
  const optOutMatch = legoSrc.match(/HOOK_REGISTRATION_OPT_OUT[\s\S]*?\n\]\);/);
  t('7.5 denmarkComplianceGate.mjs in HOOK_REGISTRATION_OPT_OUT',
    !!optOutMatch && optOutMatch[0].includes("denmarkComplianceGate.mjs"));
});

block('8. Honest scope', () => {
  t('8.1 Source cites BEK 727', /BEK nr 727/.test(src) || /BEK 727/.test(src));
  t('8.2 Source cites §44', /§44/.test(src));
});

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
