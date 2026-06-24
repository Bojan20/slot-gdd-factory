#!/usr/bin/env node
/**
 * tests/blocks/netherlandsComplianceGate.test.mjs
 *
 * W58.J-NL — NL KSA compliance gate.
 *
 * Authority anchors:
 *   §31  Wet KSA Cruks register check (Centraal Register Uitsluiting Kansspelen)
 *   §33  Cool-off period enforcement
 *   §31a Bonus-buy ban — already enforced by bonusBuy.mjs (W57.A4)
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
const srcPath = resolve(here, '../../src/blocks/netherlandsComplianceGate.mjs');
const src = readFileSync(srcPath, 'utf8');
const legoSrc = readFileSync(resolve(here, '../../tools/lego-gate.mjs'), 'utf8');

const mod = await import('../../src/blocks/netherlandsComplianceGate.mjs');
const {
  defaultConfig,
  resolveConfig,
  emitNetherlandsComplianceGateCSS,
  emitNetherlandsComplianceGateRuntime,
  NL_COOL_OFF_HOURS_DEFAULT,
  NL_COOL_OFF_HOURS_BOUNDS,
} = mod;

/* ════════════════════════════════════════════════════════════════════
 * 1. Public API exports
 * ════════════════════════════════════════════════════════════════════ */
block('1. Public API contract', () => {
  t('1.1 NL_COOL_OFF_HOURS_DEFAULT = 24',     NL_COOL_OFF_HOURS_DEFAULT === 24);
  t('1.2 NL_COOL_OFF_HOURS_BOUNDS = [1, 8760] (1h..1y)',
    Array.isArray(NL_COOL_OFF_HOURS_BOUNDS) &&
    NL_COOL_OFF_HOURS_BOUNDS[0] === 1 &&
    NL_COOL_OFF_HOURS_BOUNDS[1] === 8760);
  t('1.3 NL_COOL_OFF_HOURS_BOUNDS frozen',     Object.isFrozen(NL_COOL_OFF_HOURS_BOUNDS));
});

/* ════════════════════════════════════════════════════════════════════
 * 2. defaultConfig
 * ════════════════════════════════════════════════════════════════════ */
block('2. defaultConfig', () => {
  const c = defaultConfig();
  t('2.1 enabled defaults false (opt-in)',  c.enabled === false);
  t('2.2 jurisdiction defaults null',       c.jurisdiction === null);
  t('2.3 coolOffHours defaults 24',         c.coolOffHours === 24);
});

/* ════════════════════════════════════════════════════════════════════
 * 3. resolveConfig — 3-key jurisdiction precedence + auto-enable NL
 * ════════════════════════════════════════════════════════════════════ */
block('3. resolveConfig 3-key precedence + auto-enable', () => {
  const off = resolveConfig({});
  t('3.1 No jurisdiction → enabled FALSE',  off.enabled === false);
  t('3.2 No jurisdiction → jurisdiction null',  off.jurisdiction === null);

  const c1 = resolveConfig({ netherlandsComplianceGate: { jurisdiction: 'NL' } });
  t('3.3 NL via netherlandsComplianceGate → enabled TRUE',
    c1.enabled === true && c1.jurisdiction === 'NL');

  const c2 = resolveConfig({ responsibleGambling: { jurisdiction: 'nl' } });
  t('3.4 lowercase nl via responsibleGambling → uppercase + auto-enable',
    c2.jurisdiction === 'NL' && c2.enabled === true);

  const c3 = resolveConfig({
    regulator: { profile: 'NL' },
    responsibleGambling: { jurisdiction: 'UKGC' },  /* should lose */
    netherlandsComplianceGate: { jurisdiction: 'MGA' }, /* should lose */
  });
  t('3.5 regulator.profile precedence wins',
    c3.jurisdiction === 'NL' && c3.enabled === true);

  const c4 = resolveConfig({ regulator: { profile: 'UKGC' } });
  t('3.6 UKGC → enabled FALSE (no auto-enable outside NL)',
    c4.enabled === false && c4.jurisdiction === 'UKGC');

  const c5 = resolveConfig({ netherlandsComplianceGate: { enabled: true } });
  t('3.7 explicit enabled:true honored without jurisdiction',
    c5.enabled === true);
});

/* ════════════════════════════════════════════════════════════════════
 * 4. resolveConfig — coolOffHours bounds clamp
 * ════════════════════════════════════════════════════════════════════ */
block('4. coolOffHours clamping', () => {
  const tooLow = resolveConfig({ netherlandsComplianceGate: { coolOffHours: 0 } });
  t('4.1 coolOffHours 0 out-of-bounds → defaults 24', tooLow.coolOffHours === 24);

  const tooHigh = resolveConfig({ netherlandsComplianceGate: { coolOffHours: 99999 } });
  t('4.2 coolOffHours 99999 out-of-bounds → defaults 24', tooHigh.coolOffHours === 24);

  const ok = resolveConfig({ netherlandsComplianceGate: { coolOffHours: 168 } });
  t('4.3 coolOffHours 168 (7d) valid → applied', ok.coolOffHours === 168);

  const annual = resolveConfig({ netherlandsComplianceGate: { coolOffHours: 8760 } });
  t('4.4 coolOffHours 8760 (1y) valid → applied', annual.coolOffHours === 8760);

  const badType = resolveConfig({ netherlandsComplianceGate: { coolOffHours: 'forever' } });
  t('4.5 coolOffHours string ignored → defaults 24', badType.coolOffHours === 24);
});

/* ════════════════════════════════════════════════════════════════════
 * 5. emitCSS no-op
 * ════════════════════════════════════════════════════════════════════ */
block('5. emitCSS no-op', () => {
  t('5.1 emitCSS returns empty string',
    emitNetherlandsComplianceGateCSS(defaultConfig()) === '');
  t('5.2 emitCSS enabled NL also returns empty',
    emitNetherlandsComplianceGateCSS(resolveConfig({ regulator: { profile: 'NL' } })) === '');
});

/* ════════════════════════════════════════════════════════════════════
 * 6. emitRuntime disabled
 * ════════════════════════════════════════════════════════════════════ */
block('6. emitRuntime disabled', () => {
  t('6.1 disabled config → empty runtime',
    emitNetherlandsComplianceGateRuntime(defaultConfig()) === '');
  t('6.2 UKGC jurisdiction → empty runtime',
    emitNetherlandsComplianceGateRuntime(resolveConfig({ regulator: { profile: 'UKGC' } })) === '');
});

/* ════════════════════════════════════════════════════════════════════
 * 7. emitRuntime NL §31 wiring — Cruks check obligation
 * ════════════════════════════════════════════════════════════════════ */
block('7. emitRuntime §31 Cruks wiring', () => {
  const rt = emitNetherlandsComplianceGateRuntime(resolveConfig({ regulator: { profile: 'NL' } }));
  t('7.1 sets window.__NL_CRUKS_CHECK_REQUIRED__ = true',
    /window\.__NL_CRUKS_CHECK_REQUIRED__\s*=\s*true/.test(rt));
  t('7.2 initializes window.__NL_CRUKS_CHECK_PASSED__ to false if missing',
    /typeof\s+window\.__NL_CRUKS_CHECK_PASSED__\s*===\s*['"]undefined['"][\s\S]{0,150}=\s*false/.test(rt));
  t('7.3 sole-owner emit onCruksCheckRequired',
    /HookBus\.emit\(\s*['"]onCruksCheckRequired['"]/.test(rt));
  t('7.4 emit payload cites NL-WetKSA-§31',
    /onCruksCheckRequired[\s\S]{0,300}NL-WetKSA-§31/.test(rt));
  t('7.5 emit payload includes jurisdiction',
    /onCruksCheckRequired[\s\S]{0,300}jurisdiction:/.test(rt));
});

/* ════════════════════════════════════════════════════════════════════
 * 8. emitRuntime §33 cool-off wiring
 * ════════════════════════════════════════════════════════════════════ */
block('8. emitRuntime §33 cool-off wiring', () => {
  const rt = emitNetherlandsComplianceGateRuntime(resolveConfig({ regulator: { profile: 'NL' } }));
  t('8.1 sets window.__NL_COOL_OFF_HOURS__ = 24 (default)',
    /window\.__NL_COOL_OFF_HOURS__\s*=\s*COOL_OFF_HOURS/.test(rt) &&
    /COOL_OFF_HOURS\s*=\s*24/.test(rt));
  t('8.2 sole-owner emit onCoolOffEnforced',
    /HookBus\.emit\(\s*['"]onCoolOffEnforced['"]/.test(rt));
  t('8.3 emit payload cites NL-WetKSA-§33',
    /onCoolOffEnforced[\s\S]{0,300}NL-WetKSA-§33/.test(rt));
  t('8.4 emit payload includes coolOffHours value',
    /onCoolOffEnforced[\s\S]{0,300}coolOffHours:/.test(rt));
});

/* ════════════════════════════════════════════════════════════════════
 * 9. emitRuntime — custom coolOffHours from GDD knob
 * ════════════════════════════════════════════════════════════════════ */
block('9. Custom coolOffHours bakes', () => {
  const rt = emitNetherlandsComplianceGateRuntime(resolveConfig({
    regulator: { profile: 'NL' },
    netherlandsComplianceGate: { coolOffHours: 720 }, /* 30 days */
  }));
  t('9.1 COOL_OFF_HOURS literal baked as 720',
    /COOL_OFF_HOURS\s*=\s*720/.test(rt));
});

/* ════════════════════════════════════════════════════════════════════
 * 10. SSR safety
 * ════════════════════════════════════════════════════════════════════ */
block('10. SSR safety guards', () => {
  const rt = emitNetherlandsComplianceGateRuntime(resolveConfig({ regulator: { profile: 'NL' } }));
  t('10.1 IIFE early-returns when typeof window === undefined',
    /typeof\s+window\s*===\s*['"]undefined['"][\s\S]{0,80}return/.test(rt));
  t('10.2 emit gated behind typeof HookBus.emit === function',
    /HookBus[\s\S]{0,100}typeof\s+window\.HookBus\.emit\s*===\s*['"]function['"]/.test(rt));
  t('10.3 emit calls wrapped in try/catch (no boot failure on emit error)',
    /try\s*\{[\s\S]{0,300}HookBus\.emit\([\s\S]{0,300}\}\s*catch/.test(rt));
});

/* ════════════════════════════════════════════════════════════════════
 * 11. LEGO contracts
 * ════════════════════════════════════════════════════════════════════ */
block('11. LEGO contracts', () => {
  t('11.1 onCruksCheckRequired owner declared',
    /onCruksCheckRequired:\s*\[\s*['"]netherlandsComplianceGate\.mjs['"]\s*\]/.test(legoSrc));
  t('11.2 onCoolOffEnforced owner declared',
    /onCoolOffEnforced:\s*\[\s*['"]netherlandsComplianceGate\.mjs['"]\s*\]/.test(legoSrc));
  t('11.3 W58.J-NL marker comment in lego-gate.mjs',
    /W58\.J-NL/.test(legoSrc));
  t('11.4 Wet KSA / Cruks citation in lego-gate.mjs',
    /Cruks/.test(legoSrc) && /Wet\s*KSA/i.test(legoSrc));
  t('11.5 netherlandsComplianceGate.mjs registered in HOOK_REGISTRATION_OPT_OUT',
    /HOOK_REGISTRATION_OPT_OUT[\s\S]{0,4000}netherlandsComplianceGate\.mjs/.test(legoSrc));
});

/* ════════════════════════════════════════════════════════════════════
 * 12. Honest scope
 * ════════════════════════════════════════════════════════════════════ */
block('12. Honest scope', () => {
  t('12.1 Source cites §31 by section reference',
    /§\s*31/.test(src));
  t('12.2 Source cites §33 by section reference',
    /§\s*33/.test(src));
  t('12.3 Source notes §31a bonus-buy already covered by W57.A4',
    /W57\.A4/.test(src) && /§\s*31a/.test(src));
  t('12.4 Source cites Cruks register by name',
    /Cruks/.test(src) && /Centraal Register Uitsluiting Kansspelen/.test(src));
  t('12.5 Source cites rule_no_math_unless_asked honest scope',
    /rule_no_math_unless_asked/.test(src));
  t('12.6 No vendor / theme strings in source',
    !/(Wrath|Olympus|Lightning Link|Megaways|Pragmatic|NetEnt|Microgaming|industry standard)/i.test(src));
});

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
