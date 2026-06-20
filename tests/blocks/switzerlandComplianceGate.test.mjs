#!/usr/bin/env node
/**
 * tests/blocks/switzerlandComplianceGate.test.mjs
 *
 * Wave F7 / HX5 — Swiss ESBK + Comlot compliance gate.
 * BGS SR 935.51 + VGS.
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
const srcPath = resolve(here, '../../src/blocks/switzerlandComplianceGate.mjs');
const src = readFileSync(srcPath, 'utf8');
const legoSrc = readFileSync(resolve(here, '../../tools/lego-gate.mjs'), 'utf8');

const mod = await import('../../src/blocks/switzerlandComplianceGate.mjs');
const {
  defaultConfig,
  resolveConfig,
  emitSwitzerlandComplianceGateCSS,
  emitSwitzerlandComplianceGateRuntime,
  CH_MIN_SPIN_MS_DEFAULT,
  CH_RC_DEFAULT,
} = mod;

block('1. Public API constants', () => {
  t('1.1 CH_MIN_SPIN_MS_DEFAULT = 2500', CH_MIN_SPIN_MS_DEFAULT === 2500);
  t('1.2 CH_RC_DEFAULT = 30*60*1000', CH_RC_DEFAULT === 1800000);
  t('1.3 bounds frozen', Object.isFrozen(mod.CH_MIN_SPIN_MS_BOUNDS));
});

block('2. defaultConfig', () => {
  const c = defaultConfig();
  t('2.1 enabled defaults false', c.enabled === false);
  t('2.2 jurisdiction defaults null', c.jurisdiction === null);
  t('2.3 minSpinMs defaults 2500', c.minSpinMs === 2500);
  t('2.4 realityCheckMs defaults 30 min', c.realityCheckMs === 1800000);
});

block('3. resolveConfig jurisdiction precedence + auto-enable', () => {
  t('3.1 no jurisdiction → disabled', resolveConfig({}).enabled === false);

  const c1 = resolveConfig({ regulator: { profile: 'CH' } });
  t('3.2 regulator.profile CH → enabled', c1.enabled === true && c1.jurisdiction === 'CH');

  const c2 = resolveConfig({ responsibleGambling: { jurisdiction: 'ch' } });
  t('3.3 lowercase via responsibleGambling → uppercase + enabled',
    c2.jurisdiction === 'CH' && c2.enabled === true);

  const c3 = resolveConfig({ regulator: { profile: 'ESBK' } });
  t('3.4 ESBK synonym honored', c3.jurisdiction === 'ESBK' && c3.enabled === true);

  const c4 = resolveConfig({ regulator: { profile: 'DE' } });
  t('3.5 non-CH → disabled', c4.enabled === false);
});

block('4. resolveConfig knob clamping', () => {
  const low = resolveConfig({ switzerlandComplianceGate: { minSpinMs: 100 } });
  t('4.1 minSpinMs too low → default 2500', low.minSpinMs === 2500);
  const ok = resolveConfig({ switzerlandComplianceGate: { minSpinMs: 3500 } });
  t('4.2 valid minSpinMs applied', ok.minSpinMs === 3500);
  const rc = resolveConfig({ switzerlandComplianceGate: { realityCheckMs: 900000 } });
  t('4.3 realityCheckMs accepted', rc.realityCheckMs === 900000);
});

block('5. emit surfaces', () => {
  t('5.1 emitCSS returns empty string', emitSwitzerlandComplianceGateCSS(defaultConfig()) === '');
  t('5.2 emitRuntime disabled returns empty', emitSwitzerlandComplianceGateRuntime(defaultConfig()) === '');
  t('5.3 emitRuntime non-CH returns empty',
    emitSwitzerlandComplianceGateRuntime(resolveConfig({ regulator: { profile: 'DE' } })) === '');
});

block('6. emitRuntime CH wiring', () => {
  const rt = emitSwitzerlandComplianceGateRuntime(resolveConfig({ regulator: { profile: 'CH' } }));
  t('6.1 sets __CH_WHITELIST_REQUIRED__', /window\.__CH_WHITELIST_REQUIRED__\s*=\s*true/.test(rt));
  t('6.2 emits onChWhitelistRequired', /HookBus\.emit\(\s*['"]onChWhitelistRequired['"]/.test(rt));
  t('6.3 emits onChRealityCheckEnforced', /HookBus\.emit\(\s*['"]onChRealityCheckEnforced['"]/.test(rt));
  t('6.4 emits onChLossDisplayRequired', /HookBus\.emit\(\s*['"]onChLossDisplayRequired['"]/.test(rt));
  t('6.5 emits onChMinSpinPaceEnforced', /HookBus\.emit\(\s*['"]onChMinSpinPaceEnforced['"]/.test(rt));
  t('6.6 emits onChCantonRestrictionEnforced', /HookBus\.emit\(\s*['"]onChCantonRestrictionEnforced['"]/.test(rt));
  t('6.7 emits onChSelfExclusionCheckRequired', /HookBus\.emit\(\s*['"]onChSelfExclusionCheckRequired['"]/.test(rt));
  t('6.8 payload cites BGS Art.86', /CH-BGS-Art\.86/.test(rt));
  t('6.9 payload cites VGS Art.79', /CH-VGS-Art\.79/.test(rt));
  t('6.10 payload cites VGS Art.81', /CH-VGS-Art\.81/.test(rt));
  t('6.11 payload cites BGS Art.80', /CH-BGS-Art\.80/.test(rt));
  t('6.12 payload cites BGS Art.85', /CH-BGS-Art\.85/.test(rt));
  t('6.13 payload cites BGS Art.83', /CH-BGS-Art\.83/.test(rt));
});

block('7. LEGO contracts', () => {
  const events = [
    'onChWhitelistRequired',
    'onChRealityCheckEnforced',
    'onChLossDisplayRequired',
    'onChMinSpinPaceEnforced',
    'onChCantonRestrictionEnforced',
    'onChSelfExclusionCheckRequired',
  ];
  for (const ev of events) {
    t(`7.${ev} owner declared in lego-gate.mjs`,
      new RegExp(`${ev}:\\s*\\[\\s*['"]switzerlandComplianceGate\\.mjs['"]\\s*\\]`).test(legoSrc));
  }
  const optOutMatch = legoSrc.match(/HOOK_REGISTRATION_OPT_OUT[\s\S]*?\n\]\);/);
  t('7.7 switzerlandComplianceGate.mjs in HOOK_REGISTRATION_OPT_OUT',
    !!optOutMatch && optOutMatch[0].includes("switzerlandComplianceGate.mjs"));
});

block('8. Honest scope', () => {
  t('8.1 Source cites BGS', /BGS/.test(src));
  t('8.2 Source cites VGS', /VGS/.test(src));
});

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
