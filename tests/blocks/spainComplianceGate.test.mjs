#!/usr/bin/env node
/**
 * tests/blocks/spainComplianceGate.test.mjs
 *
 * W58.J-ES — Spanish DGOJ compliance gate.
 *
 * Authority anchors:
 *   RD 958/2020 Art.26 — No autoplay
 *   DGOJ Tech Spec §5  — Min spin duration (3 s)
 *   RD 958/2020 Art.21 — Mandatory reality-check 60 min
 *   RD 958/2020 Art.28 — RGIAJ self-exclusion register
 *   RD 958/2020 Art.25 — Bonus offer restriction (marketing-layer flag)
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
const srcPath = resolve(here, '../../src/blocks/spainComplianceGate.mjs');
const src = readFileSync(srcPath, 'utf8');
const legoSrc = readFileSync(resolve(here, '../../tools/lego-gate.mjs'), 'utf8');

const mod = await import('../../src/blocks/spainComplianceGate.mjs');
const {
  defaultConfig,
  resolveConfig,
  emitSpainComplianceGateCSS,
  emitSpainComplianceGateRuntime,
  ES_MIN_SPIN_MS_DEFAULT,
  ES_REALITY_CHECK_INTERVAL_MIN_DEFAULT,
  ES_REALITY_CHECK_INTERVAL_MIN_BOUNDS,
} = mod;

/* ════════════════════════════════════════════════════════════════════
 * 1. Public API + constants
 * ════════════════════════════════════════════════════════════════════ */
block('1. Public API contract', () => {
  t('1.1 ES_MIN_SPIN_MS_DEFAULT = 3000', ES_MIN_SPIN_MS_DEFAULT === 3000);
  t('1.2 ES_REALITY_CHECK_INTERVAL_MIN_DEFAULT = 60',
    ES_REALITY_CHECK_INTERVAL_MIN_DEFAULT === 60);
  t('1.3 ES_REALITY_CHECK_INTERVAL_MIN_BOUNDS frozen',
    Object.isFrozen(ES_REALITY_CHECK_INTERVAL_MIN_BOUNDS));
});

/* ════════════════════════════════════════════════════════════════════
 * 2. defaultConfig
 * ════════════════════════════════════════════════════════════════════ */
block('2. defaultConfig', () => {
  const c = defaultConfig();
  t('2.1 enabled defaults false', c.enabled === false);
  t('2.2 jurisdiction defaults null', c.jurisdiction === null);
  t('2.3 minSpinMs defaults 3000', c.minSpinMs === 3000);
  t('2.4 realityCheckIntervalMin defaults 60',
    c.realityCheckIntervalMin === 60);
});

/* ════════════════════════════════════════════════════════════════════
 * 3. resolveConfig 3-key precedence + auto-enable ES
 * ════════════════════════════════════════════════════════════════════ */
block('3. resolveConfig 3-key precedence + auto-enable', () => {
  const off = resolveConfig({});
  t('3.1 No jurisdiction → enabled FALSE', off.enabled === false);

  const c1 = resolveConfig({ spainComplianceGate: { jurisdiction: 'ES' } });
  t('3.2 ES via spainComplianceGate → enabled TRUE', c1.enabled === true);
  t('3.3 ES jurisdiction normalized uppercase', c1.jurisdiction === 'ES');

  const c2 = resolveConfig({ responsibleGambling: { jurisdiction: 'es' } });
  t('3.4 lowercase es → uppercase + enabled',
    c2.jurisdiction === 'ES' && c2.enabled === true);

  const c3 = resolveConfig({ regulator: { profile: 'ES' } });
  t('3.5 regulator.profile precedence wins',
    c3.jurisdiction === 'ES' && c3.enabled === true);

  const c4 = resolveConfig({ regulator: { profile: 'UKGC' } });
  t('3.6 UKGC → enabled FALSE',
    c4.enabled === false && c4.jurisdiction === 'UKGC');

  const c5 = resolveConfig({ spainComplianceGate: { enabled: true } });
  t('3.7 explicit enabled:true honored', c5.enabled === true);

  /* Bounds clamp on minSpinMs. */
  const tooLow = resolveConfig({
    regulator: { profile: 'ES' },
    spainComplianceGate: { minSpinMs: 100 },
  });
  t('3.8 minSpinMs 100 OOB → defaults 3000', tooLow.minSpinMs === 3000);
  const okMs = resolveConfig({
    regulator: { profile: 'ES' },
    spainComplianceGate: { minSpinMs: 4500 },
  });
  t('3.9 minSpinMs 4500 valid → applied', okMs.minSpinMs === 4500);

  /* Bounds clamp on realityCheckIntervalMin. */
  const rcLow = resolveConfig({
    regulator: { profile: 'ES' },
    spainComplianceGate: { realityCheckIntervalMin: 5 },
  });
  t('3.10 realityCheckIntervalMin 5 OOB → defaults 60',
    rcLow.realityCheckIntervalMin === 60);
  const rcOk = resolveConfig({
    regulator: { profile: 'ES' },
    spainComplianceGate: { realityCheckIntervalMin: 45 },
  });
  t('3.11 realityCheckIntervalMin 45 valid → applied',
    rcOk.realityCheckIntervalMin === 45);
});

/* ════════════════════════════════════════════════════════════════════
 * 4. emitCSS no-op
 * ════════════════════════════════════════════════════════════════════ */
block('4. emitCSS no-op', () => {
  t('4.1 disabled → empty CSS',
    emitSpainComplianceGateCSS(defaultConfig()) === '');
  t('4.2 enabled ES → empty CSS',
    emitSpainComplianceGateCSS(resolveConfig({ regulator: { profile: 'ES' } })) === '');
});

/* ════════════════════════════════════════════════════════════════════
 * 5. emitRuntime disabled → empty
 * ════════════════════════════════════════════════════════════════════ */
block('5. emitRuntime disabled', () => {
  t('5.1 disabled → empty runtime',
    emitSpainComplianceGateRuntime(defaultConfig()) === '');
  t('5.2 UKGC jurisdiction → empty runtime',
    emitSpainComplianceGateRuntime(resolveConfig({ regulator: { profile: 'UKGC' } })) === '');
});

/* ════════════════════════════════════════════════════════════════════
 * 6. emitRuntime ES wiring
 * ════════════════════════════════════════════════════════════════════ */
block('6. emitRuntime ES wiring', () => {
  const rt = emitSpainComplianceGateRuntime(resolveConfig({ regulator: { profile: 'ES' } }));

  /* Art.26 autoplay */
  t('6.1 sets window.__ES_AUTOPLAY_BANNED__ = true',
    /window\.__ES_AUTOPLAY_BANNED__\s*=\s*true/.test(rt));
  t('6.2 emits onAutoplayBanned',
    /HookBus\.emit\(\s*['"]onAutoplayBanned['"]/.test(rt));
  t('6.3 onAutoplayBanned cites ES-RD-958-2020-Art.26',
    /onAutoplayBanned[\s\S]{0,400}ES-RD-958-2020-Art\.26/.test(rt));

  /* DGOJ Tech Spec §5 min-spin */
  t('6.4 sets window.__ES_MIN_SPIN_MS__',
    /window\.__ES_MIN_SPIN_MS__\s*=\s*MIN_SPIN_MS/.test(rt) &&
    /MIN_SPIN_MS\s*=\s*3000/.test(rt));
  t('6.5 emits onMinSpinDurationEnforced',
    /HookBus\.emit\(\s*['"]onMinSpinDurationEnforced['"]/.test(rt));
  t('6.6 onMinSpinDurationEnforced cites ES-DGOJ-TechSpec-§5',
    /onMinSpinDurationEnforced[\s\S]{0,400}ES-DGOJ-TechSpec-§5/.test(rt));

  /* Art.21 mandatory reality-check */
  t('6.7 sets window.__ES_REALITY_CHECK_INTERVAL_MIN__',
    /window\.__ES_REALITY_CHECK_INTERVAL_MIN__\s*=\s*RC_INTERVAL_MIN/.test(rt) &&
    /RC_INTERVAL_MIN\s*=\s*60/.test(rt));
  t('6.8 emits onMandatoryRealityCheckIntervalEnforced',
    /HookBus\.emit\(\s*['"]onMandatoryRealityCheckIntervalEnforced['"]/.test(rt));
  t('6.9 onMandatoryRealityCheckIntervalEnforced cites ES-RD-958-2020-Art.21',
    /onMandatoryRealityCheckIntervalEnforced[\s\S]{0,400}ES-RD-958-2020-Art\.21/.test(rt));

  /* Art.28 RGIAJ */
  t('6.10 sets window.__ES_RGIAJ_CHECK_REQUIRED__ = true',
    /window\.__ES_RGIAJ_CHECK_REQUIRED__\s*=\s*true/.test(rt));
  t('6.11 sets __ES_RGIAJ_CHECK_PASSED__ default false',
    /typeof\s+window\.__ES_RGIAJ_CHECK_PASSED__\s*===\s*['"]undefined['"][\s\S]{0,200}window\.__ES_RGIAJ_CHECK_PASSED__\s*=\s*false/.test(rt));
  t('6.12 emits onRgiajCheckRequired',
    /HookBus\.emit\(\s*['"]onRgiajCheckRequired['"]/.test(rt));
  t('6.13 onRgiajCheckRequired cites ES-RD-958-2020-Art.28',
    /onRgiajCheckRequired[\s\S]{0,400}ES-RD-958-2020-Art\.28/.test(rt));

  /* Art.25 bonus restrictions */
  t('6.14 sets window.__ES_BONUS_OFFERS_RESTRICTED__ = true',
    /window\.__ES_BONUS_OFFERS_RESTRICTED__\s*=\s*true/.test(rt));

  t('6.15 SSR-safe typeof window guard',
    /typeof\s+window\s*===\s*['"]undefined['"]\s*\)\s*return/.test(rt));
});

/* ════════════════════════════════════════════════════════════════════
 * 7. LEGO contracts
 * ════════════════════════════════════════════════════════════════════ */
block('7. LEGO contracts', () => {
  t('7.1 onAutoplayBanned owner list includes spainComplianceGate.mjs',
    /onAutoplayBanned:\s*\[[^\]]*['"]spainComplianceGate\.mjs['"]/.test(legoSrc));
  t('7.2 onMinSpinDurationEnforced owner includes spainComplianceGate.mjs',
    /onMinSpinDurationEnforced:\s*\[[^\]]*['"]spainComplianceGate\.mjs['"]/.test(legoSrc));
  t('7.3 onMandatoryRealityCheckIntervalEnforced owner includes spainComplianceGate.mjs',
    /onMandatoryRealityCheckIntervalEnforced:\s*\[[^\]]*['"]spainComplianceGate\.mjs['"]/.test(legoSrc));
  t('7.4 onRgiajCheckRequired sole owner: spainComplianceGate.mjs',
    /onRgiajCheckRequired:\s*\[\s*['"]spainComplianceGate\.mjs['"]\s*\]/.test(legoSrc));
  t('7.5 W58.J-ES marker in lego-gate.mjs',
    /W58\.J-ES/.test(legoSrc));
  t('7.6 DGOJ citation in lego-gate.mjs', /DGOJ/.test(legoSrc));
  t('7.7 spainComplianceGate.mjs in HOOK_REGISTRATION_OPT_OUT',
    /HOOK_REGISTRATION_OPT_OUT[\s\S]{0,5000}spainComplianceGate\.mjs/.test(legoSrc));
});

/* ════════════════════════════════════════════════════════════════════
 * 8. Honest scope + vendor neutrality
 * ════════════════════════════════════════════════════════════════════ */
block('8. Honest scope + vendor neutrality', () => {
  t('8.1 Source cites RD 958/2020', /RD 958\/2020/.test(src));
  t('8.2 Source cites DGOJ Tech Spec', /DGOJ Tech Spec/i.test(src));
  t('8.3 Source cites RGIAJ by full name',
    /Registro General de Interdicciones de Acceso al Juego/.test(src));
  t('8.4 Source notes operator-side responsibility',
    /operator-side|operator session-init/i.test(src));
  t('8.5 Source cites rule_no_math_unless_asked',
    /rule_no_math_unless_asked/.test(src));
  t('8.6 No vendor strings in source',
    !/(Wrath|Olympus|Lightning Link|Megaways|Pragmatic|NetEnt|Microgaming|\bIGT\b)/i.test(src));
});

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
