#!/usr/bin/env node
/**
 * tests/blocks/swedenComplianceGate.test.mjs
 *
 * Wave F7 / HX2 — Sweden SGA (Spelinspektionen) compliance gate.
 * Spellagen SFS 2018:1138.
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
const srcPath = resolve(here, '../../src/blocks/swedenComplianceGate.mjs');
const src = readFileSync(srcPath, 'utf8');
const legoSrc = readFileSync(resolve(here, '../../tools/lego-gate.mjs'), 'utf8');

const mod = await import('../../src/blocks/swedenComplianceGate.mjs');
const {
  defaultConfig,
  resolveConfig,
  emitSwedenComplianceGateCSS,
  emitSwedenComplianceGateRuntime,
  SE_MIN_SPIN_MS_DEFAULT,
} = mod;

block('1. Public API constants', () => {
  t('1.1 SE_MIN_SPIN_MS_DEFAULT = 3000', SE_MIN_SPIN_MS_DEFAULT === 3000);
  t('1.2 bounds frozen', Object.isFrozen(mod.SE_MIN_SPIN_MS_BOUNDS));
});

block('2. defaultConfig', () => {
  const c = defaultConfig();
  t('2.1 enabled defaults false', c.enabled === false);
  t('2.2 jurisdiction defaults null', c.jurisdiction === null);
  t('2.3 minSpinMs defaults 3000', c.minSpinMs === 3000);
});

block('3. resolveConfig jurisdiction precedence + auto-enable', () => {
  t('3.1 no jurisdiction → disabled', resolveConfig({}).enabled === false);

  const c1 = resolveConfig({ regulator: { profile: 'SE' } });
  t('3.2 regulator.profile SE → enabled', c1.enabled === true && c1.jurisdiction === 'SE');

  const c2 = resolveConfig({ responsibleGambling: { jurisdiction: 'se' } });
  t('3.3 lowercase via responsibleGambling → uppercase + enabled',
    c2.jurisdiction === 'SE' && c2.enabled === true);

  const c3 = resolveConfig({ regulator: { profile: 'SGA' } });
  t('3.4 SGA synonym honored', c3.jurisdiction === 'SGA' && c3.enabled === true);

  const c4 = resolveConfig({ regulator: { profile: 'DE' } });
  t('3.5 non-SE → disabled', c4.enabled === false);

  const c5 = resolveConfig({ swedenComplianceGate: { enabled: true } });
  t('3.6 explicit enabled:true honored', c5.enabled === true);
});

block('4. resolveConfig knob clamping', () => {
  const low = resolveConfig({ swedenComplianceGate: { minSpinMs: 100 } });
  t('4.1 minSpinMs too low → default 3000', low.minSpinMs === 3000);
  const ok = resolveConfig({ swedenComplianceGate: { minSpinMs: 4500 } });
  t('4.2 valid minSpinMs applied', ok.minSpinMs === 4500);
});

block('5. emit surfaces', () => {
  t('5.1 emitCSS returns empty string', emitSwedenComplianceGateCSS(defaultConfig()) === '');
  t('5.2 emitRuntime disabled returns empty', emitSwedenComplianceGateRuntime(defaultConfig()) === '');
  t('5.3 emitRuntime non-SE returns empty',
    emitSwedenComplianceGateRuntime(resolveConfig({ regulator: { profile: 'DE' } })) === '');
});

block('6. emitRuntime SE wiring', () => {
  const rt = emitSwedenComplianceGateRuntime(resolveConfig({ regulator: { profile: 'SE' } }));
  t('6.1 sets __SE_MIN_SPIN_MS__', /window\.__SE_MIN_SPIN_MS__\s*=\s*MIN_SPIN_MS/.test(rt));
  t('6.2 emits onSeMinSpinPaceEnforced', /HookBus\.emit\(\s*['"]onSeMinSpinPaceEnforced['"]/.test(rt));
  t('6.3 sets __SE_AUTOPLAY_BANNED__', /window\.__SE_AUTOPLAY_BANNED__\s*=\s*true/.test(rt));
  t('6.4 emits onAutoplayBanned', /HookBus\.emit\(\s*['"]onAutoplayBanned['"]/.test(rt));
  t('6.5 emits onSeDepositLimitRequired', /HookBus\.emit\(\s*['"]onSeDepositLimitRequired['"]/.test(rt));
  t('6.6 emits onSeSpelpausCheckRequired', /HookBus\.emit\(\s*['"]onSeSpelpausCheckRequired['"]/.test(rt));
  t('6.7 emits onSeBonusConsentRequired', /HookBus\.emit\(\s*['"]onSeBonusConsentRequired['"]/.test(rt));
  t('6.8 payload cites Spellag 14k §6', /SE-Spellag-14k-§6/.test(rt));
  t('6.9 payload cites Spellag 14k §1', /SE-Spellag-14k-§1/.test(rt));
  t('6.10 payload cites Spellag 14k §7', /SE-Spellag-14k-§7/.test(rt));
  t('6.11 payload cites Spellag 14k §11', /SE-Spellag-14k-§11/.test(rt));
  t('6.12 payload cites Spellag 14k §13', /SE-Spellag-14k-§13/.test(rt));
});

block('7. LEGO contracts', () => {
  const soleOwnerEvents = [
    'onSeMinSpinPaceEnforced',
    'onSeDepositLimitRequired',
    'onSeSpelpausCheckRequired',
    'onSeBonusConsentRequired',
  ];
  for (const ev of soleOwnerEvents) {
    t(`7.${ev} owner declared in lego-gate.mjs`,
      new RegExp(`${ev}:\\s*\\[\\s*['"]swedenComplianceGate\\.mjs['"]\\s*\\]`).test(legoSrc));
  }
  t('7.5 onAutoplayBanned shared multi-owner list includes swedenComplianceGate',
    /onAutoplayBanned:[\s\S]{0,400}swedenComplianceGate\.mjs/.test(legoSrc));
  const optOutMatch = legoSrc.match(/HOOK_REGISTRATION_OPT_OUT[\s\S]*?\n\]\);/);
  t('7.6 swedenComplianceGate.mjs in HOOK_REGISTRATION_OPT_OUT',
    !!optOutMatch && optOutMatch[0].includes("swedenComplianceGate.mjs"));
});

block('8. Honest scope', () => {
  t('8.1 Source cites Spellag', /Spellag/.test(src));
  t('8.2 Source cites §1', /§1/.test(src));
  t('8.3 Source cites rule_no_math_unless_asked', /rule_no_math_unless_asked/.test(src));
});

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
