#!/usr/bin/env node
/**
 * tests/blocks/italyComplianceGate.test.mjs
 *
 * W58.J-IT — Italian ADM compliance gate.
 *
 * Authority anchors:
 *   ADM Technical Spec §6.2 — No autoplay
 *   ADM Technical Spec §6.3 — No turbo / fast-spin
 *   ADM Technical Spec §6.4 — Min spin duration (3 s)
 *   Decreto Dignità Art.9 + ADM Spec §8 — Mandatory reality-check 60 min
 *   Legislative Decree 132/2020 Art.5 — RUA self-exclusion register
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
const srcPath = resolve(here, '../../src/blocks/italyComplianceGate.mjs');
const src = readFileSync(srcPath, 'utf8');
const legoSrc = readFileSync(resolve(here, '../../tools/lego-gate.mjs'), 'utf8');

const mod = await import('../../src/blocks/italyComplianceGate.mjs');
const {
  defaultConfig,
  resolveConfig,
  emitItalyComplianceGateCSS,
  emitItalyComplianceGateRuntime,
  IT_MIN_SPIN_MS_DEFAULT,
  IT_REALITY_CHECK_INTERVAL_MIN_DEFAULT,
  IT_REALITY_CHECK_INTERVAL_MIN_BOUNDS,
} = mod;

/* ════════════════════════════════════════════════════════════════════
 * 1. Public API + constants
 * ════════════════════════════════════════════════════════════════════ */
block('1. Public API contract', () => {
  t('1.1 IT_MIN_SPIN_MS_DEFAULT exported = 3000', IT_MIN_SPIN_MS_DEFAULT === 3000);
  t('1.2 IT_REALITY_CHECK_INTERVAL_MIN_DEFAULT exported = 60',
    IT_REALITY_CHECK_INTERVAL_MIN_DEFAULT === 60);
  t('1.3 IT_REALITY_CHECK_INTERVAL_MIN_BOUNDS frozen',
    Object.isFrozen(IT_REALITY_CHECK_INTERVAL_MIN_BOUNDS));
  t('1.4 Reality-check bounds = [15, 240]',
    IT_REALITY_CHECK_INTERVAL_MIN_BOUNDS[0] === 15 &&
    IT_REALITY_CHECK_INTERVAL_MIN_BOUNDS[1] === 240);
});

/* ════════════════════════════════════════════════════════════════════
 * 2. defaultConfig
 * ════════════════════════════════════════════════════════════════════ */
block('2. defaultConfig', () => {
  const c = defaultConfig();
  t('2.1 enabled defaults false (opt-in)', c.enabled === false);
  t('2.2 jurisdiction defaults null',      c.jurisdiction === null);
  t('2.3 minSpinMs defaults 3000',         c.minSpinMs === 3000);
  t('2.4 realityCheckIntervalMin defaults 60',
    c.realityCheckIntervalMin === 60);
});

/* ════════════════════════════════════════════════════════════════════
 * 3. resolveConfig 3-key precedence + auto-enable IT
 * ════════════════════════════════════════════════════════════════════ */
block('3. resolveConfig 3-key precedence + auto-enable', () => {
  const off = resolveConfig({});
  t('3.1 No jurisdiction → enabled FALSE', off.enabled === false);

  const c1 = resolveConfig({ italyComplianceGate: { jurisdiction: 'IT' } });
  t('3.2 IT via italyComplianceGate → enabled TRUE', c1.enabled === true);
  t('3.3 IT jurisdiction normalized uppercase', c1.jurisdiction === 'IT');

  const c2 = resolveConfig({ responsibleGambling: { jurisdiction: 'it' } });
  t('3.4 lowercase it → uppercase + enabled',
    c2.jurisdiction === 'IT' && c2.enabled === true);

  const c3 = resolveConfig({
    regulator: { profile: 'IT' },
    responsibleGambling: { jurisdiction: 'UKGC' },
  });
  t('3.5 regulator.profile precedence wins',
    c3.jurisdiction === 'IT' && c3.enabled === true);

  const c4 = resolveConfig({ regulator: { profile: 'UKGC' } });
  t('3.6 UKGC → enabled FALSE',
    c4.enabled === false && c4.jurisdiction === 'UKGC');

  const c5 = resolveConfig({ italyComplianceGate: { enabled: true } });
  t('3.7 explicit enabled:true honored',
    c5.enabled === true);

  /* Bounds clamp on minSpinMs. */
  const tooLow = resolveConfig({
    regulator: { profile: 'IT' },
    italyComplianceGate: { minSpinMs: 100 },
  });
  t('3.8 minSpinMs 100 out-of-bounds → defaults 3000', tooLow.minSpinMs === 3000);
  const okMs = resolveConfig({
    regulator: { profile: 'IT' },
    italyComplianceGate: { minSpinMs: 4500 },
  });
  t('3.9 minSpinMs 4500 valid → applied', okMs.minSpinMs === 4500);

  /* Bounds clamp on realityCheckIntervalMin. */
  const rcLow = resolveConfig({
    regulator: { profile: 'IT' },
    italyComplianceGate: { realityCheckIntervalMin: 5 },
  });
  t('3.10 realityCheckIntervalMin 5 out-of-bounds → defaults 60',
    rcLow.realityCheckIntervalMin === 60);
  const rcOk = resolveConfig({
    regulator: { profile: 'IT' },
    italyComplianceGate: { realityCheckIntervalMin: 30 },
  });
  t('3.11 realityCheckIntervalMin 30 valid → applied',
    rcOk.realityCheckIntervalMin === 30);
});

/* ════════════════════════════════════════════════════════════════════
 * 4. emitCSS no-op
 * ════════════════════════════════════════════════════════════════════ */
block('4. emitCSS no-op', () => {
  t('4.1 disabled config → empty CSS',
    emitItalyComplianceGateCSS(defaultConfig()) === '');
  t('4.2 enabled IT also returns empty CSS',
    emitItalyComplianceGateCSS(resolveConfig({ regulator: { profile: 'IT' } })) === '');
});

/* ════════════════════════════════════════════════════════════════════
 * 5. emitRuntime disabled → empty
 * ════════════════════════════════════════════════════════════════════ */
block('5. emitRuntime disabled', () => {
  t('5.1 disabled config → empty runtime',
    emitItalyComplianceGateRuntime(defaultConfig()) === '');
  t('5.2 UKGC jurisdiction → empty runtime',
    emitItalyComplianceGateRuntime(resolveConfig({ regulator: { profile: 'UKGC' } })) === '');
});

/* ════════════════════════════════════════════════════════════════════
 * 6. emitRuntime IT wiring — five flags + five emits
 * ════════════════════════════════════════════════════════════════════ */
block('6. emitRuntime IT wiring', () => {
  const rt = emitItalyComplianceGateRuntime(resolveConfig({ regulator: { profile: 'IT' } }));

  /* ADM §6.2 autoplay */
  t('6.1 sets window.__IT_AUTOPLAY_BANNED__ = true',
    /window\.__IT_AUTOPLAY_BANNED__\s*=\s*true/.test(rt));
  t('6.2 emits onAutoplayBanned',
    /HookBus\.emit\(\s*['"]onAutoplayBanned['"]/.test(rt));
  t('6.3 onAutoplayBanned cites IT-ADM-TechSpec-§6.2',
    /onAutoplayBanned[\s\S]{0,400}IT-ADM-TechSpec-§6\.2/.test(rt));

  /* ADM §6.3 turbo */
  t('6.4 sets window.__IT_TURBO_BANNED__ = true',
    /window\.__IT_TURBO_BANNED__\s*=\s*true/.test(rt));
  t('6.5 emits onTurboBanned',
    /HookBus\.emit\(\s*['"]onTurboBanned['"]/.test(rt));
  t('6.6 onTurboBanned cites IT-ADM-TechSpec-§6.3',
    /onTurboBanned[\s\S]{0,400}IT-ADM-TechSpec-§6\.3/.test(rt));

  /* ADM §6.4 min-spin */
  t('6.7 sets window.__IT_MIN_SPIN_MS__',
    /window\.__IT_MIN_SPIN_MS__\s*=\s*MIN_SPIN_MS/.test(rt) &&
    /MIN_SPIN_MS\s*=\s*3000/.test(rt));
  t('6.8 emits onMinSpinDurationEnforced',
    /HookBus\.emit\(\s*['"]onMinSpinDurationEnforced['"]/.test(rt));
  t('6.9 onMinSpinDurationEnforced cites IT-ADM-TechSpec-§6.4',
    /onMinSpinDurationEnforced[\s\S]{0,400}IT-ADM-TechSpec-§6\.4/.test(rt));

  /* Decreto Dignità Art.9 mandatory reality-check */
  t('6.10 sets window.__IT_REALITY_CHECK_INTERVAL_MIN__',
    /window\.__IT_REALITY_CHECK_INTERVAL_MIN__\s*=\s*RC_INTERVAL_MIN/.test(rt) &&
    /RC_INTERVAL_MIN\s*=\s*60/.test(rt));
  t('6.11 emits onMandatoryRealityCheckIntervalEnforced',
    /HookBus\.emit\(\s*['"]onMandatoryRealityCheckIntervalEnforced['"]/.test(rt));
  t('6.12 onMandatoryRealityCheckIntervalEnforced cites IT-DecretoDignita-Art.9',
    /onMandatoryRealityCheckIntervalEnforced[\s\S]{0,400}IT-DecretoDignita-Art\.9/.test(rt));
  t('6.13 onMandatoryRealityCheckIntervalEnforced includes intervalMin',
    /onMandatoryRealityCheckIntervalEnforced[\s\S]{0,400}intervalMin:/.test(rt));

  /* LD 132/2020 Art.5 RUA register */
  t('6.14 sets window.__IT_RUA_CHECK_REQUIRED__ = true',
    /window\.__IT_RUA_CHECK_REQUIRED__\s*=\s*true/.test(rt));
  t('6.15 sets __IT_RUA_CHECK_PASSED__ default false',
    /typeof\s+window\.__IT_RUA_CHECK_PASSED__\s*===\s*['"]undefined['"][\s\S]{0,200}window\.__IT_RUA_CHECK_PASSED__\s*=\s*false/.test(rt));
  t('6.16 emits onRuaCheckRequired',
    /HookBus\.emit\(\s*['"]onRuaCheckRequired['"]/.test(rt));
  t('6.17 onRuaCheckRequired cites IT-LD-132-2020-Art.5',
    /onRuaCheckRequired[\s\S]{0,400}IT-LD-132-2020-Art\.5/.test(rt));

  t('6.18 SSR-safe typeof window guard',
    /typeof\s+window\s*===\s*['"]undefined['"]\s*\)\s*return/.test(rt));
});

/* ════════════════════════════════════════════════════════════════════
 * 7. LEGO contracts
 * ════════════════════════════════════════════════════════════════════ */
block('7. LEGO contracts', () => {
  t('7.1 onAutoplayBanned owner list includes italyComplianceGate.mjs',
    /onAutoplayBanned:\s*\[[^\]]*['"]italyComplianceGate\.mjs['"]/.test(legoSrc));
  t('7.2 onTurboBanned owner list includes italyComplianceGate.mjs',
    /onTurboBanned:\s*\[[^\]]*['"]italyComplianceGate\.mjs['"]/.test(legoSrc));
  t('7.3 onMinSpinDurationEnforced owner includes italyComplianceGate.mjs',
    /onMinSpinDurationEnforced:\s*\[[^\]]*['"]italyComplianceGate\.mjs['"]/.test(legoSrc));
  t('7.4 onMandatoryRealityCheckIntervalEnforced owner includes italyComplianceGate.mjs',
    /onMandatoryRealityCheckIntervalEnforced:\s*\[[^\]]*['"]italyComplianceGate\.mjs['"]/.test(legoSrc));
  t('7.5 onRuaCheckRequired sole owner: italyComplianceGate.mjs',
    /onRuaCheckRequired:\s*\[\s*['"]italyComplianceGate\.mjs['"]\s*\]/.test(legoSrc));
  t('7.6 W58.J-IT marker in lego-gate.mjs',
    /W58\.J-IT/.test(legoSrc));
  t('7.7 ADM citation in lego-gate.mjs', /ADM/.test(legoSrc));
  t('7.8 italyComplianceGate.mjs registered in HOOK_REGISTRATION_OPT_OUT',
    /HOOK_REGISTRATION_OPT_OUT[\s\S]{0,5000}italyComplianceGate\.mjs/.test(legoSrc));
});

/* ════════════════════════════════════════════════════════════════════
 * 8. Honest scope + vendor neutrality
 * ════════════════════════════════════════════════════════════════════ */
block('8. Honest scope + vendor neutrality', () => {
  t('8.1 Source cites ADM Technical Spec',
    /ADM Technical Spec/i.test(src));
  t('8.2 Source cites Legislative Decree 132/2020',
    /Legislative Decree 132\/2020/.test(src));
  t('8.3 Source cites Decreto Dignità',
    /Decreto Dignit/i.test(src));
  t('8.4 Source notes operator-side responsibility for RUA API',
    /operator-side|operator session-init/i.test(src));
  t('8.5 Source cites rule_no_math_unless_asked',
    /rule_no_math_unless_asked/.test(src));
  t('8.6 No vendor strings in source',
    !/(Wrath|Olympus|Lightning Link|Megaways|Pragmatic|NetEnt|Microgaming|\bIGT\b)/i.test(src));
});

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
