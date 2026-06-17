#!/usr/bin/env node
/**
 * tests/blocks/franceComplianceGate.test.mjs
 *
 * W58.J-FR — French ANJ compliance gate.
 *
 * Authority anchors:
 *   ANJ Recommendation 2022-01 §3.2 — No autoplay
 *   ANJ Recommendation 2022-01 §3.3 — No turbo / fast-spin
 *   Decree n° 2019-1061 Art.4      — Minimum spin duration (3 s)
 *   Decree n° 2019-1061 Art.21     — FRJ self-exclusion register
 *
 * Pins:
 *   1. Public API + constants
 *   2. defaultConfig + resolveConfig 3-key precedence
 *   3. Auto-enable on FR jurisdiction
 *   4. emitRuntime: four window flags + four sole-owner emits
 *   5. CSS no-op
 *   6. LEGO contracts
 *   7. Honest scope + vendor neutrality
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
const srcPath = resolve(here, '../../src/blocks/franceComplianceGate.mjs');
const src = readFileSync(srcPath, 'utf8');
const legoSrc = readFileSync(resolve(here, '../../tools/lego-gate.mjs'), 'utf8');

const mod = await import('../../src/blocks/franceComplianceGate.mjs');
const {
  defaultConfig,
  resolveConfig,
  emitFranceComplianceGateCSS,
  emitFranceComplianceGateRuntime,
  FR_MIN_SPIN_MS_DEFAULT,
  FR_MIN_SPIN_MS_BOUNDS,
} = mod;

/* ════════════════════════════════════════════════════════════════════
 * 1. Public API + constants
 * ════════════════════════════════════════════════════════════════════ */
block('1. Public API contract', () => {
  t('1.1 FR_MIN_SPIN_MS_DEFAULT exported = 3000', FR_MIN_SPIN_MS_DEFAULT === 3000);
  t('1.2 FR_MIN_SPIN_MS_BOUNDS exported frozen',
    !!FR_MIN_SPIN_MS_BOUNDS && Object.isFrozen(FR_MIN_SPIN_MS_BOUNDS));
  t('1.3 FR_MIN_SPIN_MS_BOUNDS = [1000, 30000]',
    FR_MIN_SPIN_MS_BOUNDS[0] === 1000 && FR_MIN_SPIN_MS_BOUNDS[1] === 30000);
  t('1.4 defaultConfig is a function', typeof defaultConfig === 'function');
  t('1.5 resolveConfig is a function', typeof resolveConfig === 'function');
  t('1.6 emitCSS is a function', typeof emitFranceComplianceGateCSS === 'function');
  t('1.7 emitRuntime is a function', typeof emitFranceComplianceGateRuntime === 'function');
});

/* ════════════════════════════════════════════════════════════════════
 * 2. defaultConfig
 * ════════════════════════════════════════════════════════════════════ */
block('2. defaultConfig', () => {
  const c = defaultConfig();
  t('2.1 enabled defaults false (opt-in)',   c.enabled === false);
  t('2.2 jurisdiction defaults null',        c.jurisdiction === null);
  t('2.3 minSpinMs defaults 3000',           c.minSpinMs === 3000);
});

/* ════════════════════════════════════════════════════════════════════
 * 3. resolveConfig 3-key precedence + auto-enable FR
 * ════════════════════════════════════════════════════════════════════ */
block('3. resolveConfig 3-key precedence + auto-enable', () => {
  const off = resolveConfig({});
  t('3.1 No jurisdiction → enabled FALSE', off.enabled === false);
  t('3.2 No jurisdiction → jurisdiction null', off.jurisdiction === null);

  const c1 = resolveConfig({ franceComplianceGate: { jurisdiction: 'FR' } });
  t('3.3 FR via franceComplianceGate → enabled TRUE', c1.enabled === true);
  t('3.4 FR jurisdiction normalized uppercase', c1.jurisdiction === 'FR');

  const c2 = resolveConfig({ responsibleGambling: { jurisdiction: 'fr' } });
  t('3.5 lowercase fr via responsibleGambling → uppercase + enabled',
    c2.jurisdiction === 'FR' && c2.enabled === true);

  const c3 = resolveConfig({
    regulator: { profile: 'FR' },
    responsibleGambling: { jurisdiction: 'UKGC' },
    franceComplianceGate: { jurisdiction: 'MGA' },
  });
  t('3.6 regulator.profile precedence wins',
    c3.jurisdiction === 'FR' && c3.enabled === true);

  const c4 = resolveConfig({ regulator: { profile: 'UKGC' } });
  t('3.7 UKGC → enabled FALSE (no auto-enable outside FR)',
    c4.enabled === false && c4.jurisdiction === 'UKGC');

  const c5 = resolveConfig({ franceComplianceGate: { enabled: true } });
  t('3.8 explicit enabled:true honored without jurisdiction', c5.enabled === true);

  /* Bounds clamp. */
  const tooLow = resolveConfig({
    regulator: { profile: 'FR' },
    franceComplianceGate: { minSpinMs: 100 },
  });
  t('3.9 minSpinMs 100 out-of-bounds → defaults 3000', tooLow.minSpinMs === 3000);
  const ok = resolveConfig({
    regulator: { profile: 'FR' },
    franceComplianceGate: { minSpinMs: 5000 },
  });
  t('3.10 minSpinMs 5000 valid → applied', ok.minSpinMs === 5000);
  const badType = resolveConfig({
    regulator: { profile: 'FR' },
    franceComplianceGate: { minSpinMs: 'fast' },
  });
  t('3.11 minSpinMs string ignored → defaults 3000', badType.minSpinMs === 3000);
});

/* ════════════════════════════════════════════════════════════════════
 * 4. emitCSS no-op
 * ════════════════════════════════════════════════════════════════════ */
block('4. emitCSS no-op', () => {
  t('4.1 disabled config → empty CSS',
    emitFranceComplianceGateCSS(defaultConfig()) === '');
  t('4.2 enabled FR also returns empty CSS',
    emitFranceComplianceGateCSS(resolveConfig({ regulator: { profile: 'FR' } })) === '');
});

/* ════════════════════════════════════════════════════════════════════
 * 5. emitRuntime disabled → empty
 * ════════════════════════════════════════════════════════════════════ */
block('5. emitRuntime disabled', () => {
  t('5.1 disabled config → empty runtime',
    emitFranceComplianceGateRuntime(defaultConfig()) === '');
  t('5.2 UKGC jurisdiction → no auto-enable → empty runtime',
    emitFranceComplianceGateRuntime(resolveConfig({ regulator: { profile: 'UKGC' } })) === '');
});

/* ════════════════════════════════════════════════════════════════════
 * 6. emitRuntime FR wiring — four flags + four emits
 * ════════════════════════════════════════════════════════════════════ */
block('6. emitRuntime FR wiring', () => {
  const rt = emitFranceComplianceGateRuntime(resolveConfig({ regulator: { profile: 'FR' } }));

  /* ANJ §3.2 autoplay */
  t('6.1 sets window.__FR_AUTOPLAY_BANNED__ = true',
    /window\.__FR_AUTOPLAY_BANNED__\s*=\s*true/.test(rt));
  t('6.2 emits onAutoplayBanned (literal event name for LEGO ownership)',
    /HookBus\.emit\(\s*['"]onAutoplayBanned['"]/.test(rt));
  t('6.3 onAutoplayBanned cites FR-ANJ-Reco-2022-01-§3.2',
    /onAutoplayBanned[\s\S]{0,400}FR-ANJ-Reco-2022-01-§3\.2/.test(rt));

  /* ANJ §3.3 turbo */
  t('6.4 sets window.__FR_TURBO_BANNED__ = true',
    /window\.__FR_TURBO_BANNED__\s*=\s*true/.test(rt));
  t('6.5 emits onTurboBanned',
    /HookBus\.emit\(\s*['"]onTurboBanned['"]/.test(rt));
  t('6.6 onTurboBanned cites FR-ANJ-Reco-2022-01-§3.3',
    /onTurboBanned[\s\S]{0,400}FR-ANJ-Reco-2022-01-§3\.3/.test(rt));

  /* Decree 2019-1061 Art.4 min-spin */
  t('6.7 sets window.__FR_MIN_SPIN_MS__ from config',
    /window\.__FR_MIN_SPIN_MS__\s*=\s*MIN_SPIN_MS/.test(rt) &&
    /MIN_SPIN_MS\s*=\s*3000/.test(rt));
  t('6.8 emits onMinSpinDurationEnforced',
    /HookBus\.emit\(\s*['"]onMinSpinDurationEnforced['"]/.test(rt));
  t('6.9 onMinSpinDurationEnforced cites FR-Decree-2019-1061-Art.4',
    /onMinSpinDurationEnforced[\s\S]{0,400}FR-Decree-2019-1061-Art\.4/.test(rt));
  t('6.10 onMinSpinDurationEnforced includes minSpinMs payload',
    /onMinSpinDurationEnforced[\s\S]{0,400}minSpinMs:/.test(rt));

  /* Decree 2019-1061 Art.21 FRJ register */
  t('6.11 sets window.__FR_FRJ_CHECK_REQUIRED__ = true',
    /window\.__FR_FRJ_CHECK_REQUIRED__\s*=\s*true/.test(rt));
  t('6.12 sets __FR_FRJ_CHECK_PASSED__ default false (when undefined)',
    /typeof\s+window\.__FR_FRJ_CHECK_PASSED__\s*===\s*['"]undefined['"][\s\S]{0,200}window\.__FR_FRJ_CHECK_PASSED__\s*=\s*false/.test(rt));
  t('6.13 emits onFrjCheckRequired',
    /HookBus\.emit\(\s*['"]onFrjCheckRequired['"]/.test(rt));
  t('6.14 onFrjCheckRequired cites FR-Decree-2019-1061-Art.21',
    /onFrjCheckRequired[\s\S]{0,400}FR-Decree-2019-1061-Art\.21/.test(rt));

  /* SSR safety + emit fault-tolerance */
  t('6.15 SSR-safe typeof window guard',
    /typeof\s+window\s*===\s*['"]undefined['"]\s*\)\s*return/.test(rt));
  t('6.16 Each emit wrapped in try/catch (audit must never throw)',
    (() => {
      const events = ['onAutoplayBanned','onTurboBanned','onMinSpinDurationEnforced','onFrjCheckRequired'];
      return events.every(ev => {
        const re = new RegExp('try\\s*\\{[^}]{0,800}HookBus\\.emit\\([\'"]' + ev + '[\'"]');
        return re.test(rt);
      });
    })());
});

/* ════════════════════════════════════════════════════════════════════
 * 7. LEGO contracts
 * ════════════════════════════════════════════════════════════════════ */
block('7. LEGO contracts', () => {
  t('7.1 onAutoplayBanned owner list includes franceComplianceGate.mjs',
    /onAutoplayBanned:\s*\[[^\]]*['"]franceComplianceGate\.mjs['"]/.test(legoSrc));
  t('7.2 onTurboBanned owner list includes franceComplianceGate.mjs',
    /onTurboBanned:\s*\[[^\]]*['"]franceComplianceGate\.mjs['"]/.test(legoSrc));
  t('7.3 onMinSpinDurationEnforced owner list includes franceComplianceGate.mjs',
    /onMinSpinDurationEnforced:\s*\[[^\]]*['"]franceComplianceGate\.mjs['"]/.test(legoSrc));
  t('7.4 onFrjCheckRequired sole owner: franceComplianceGate.mjs',
    /onFrjCheckRequired:\s*\[\s*['"]franceComplianceGate\.mjs['"]\s*\]/.test(legoSrc));
  t('7.5 W58.J-FR marker in lego-gate.mjs',
    /W58\.J-FR/.test(legoSrc));
  t('7.6 ANJ citation in lego-gate.mjs',
    /ANJ/.test(legoSrc));
  t('7.7 franceComplianceGate.mjs registered in HOOK_REGISTRATION_OPT_OUT',
    /HOOK_REGISTRATION_OPT_OUT[\s\S]{0,5000}franceComplianceGate\.mjs/.test(legoSrc));
});

/* ════════════════════════════════════════════════════════════════════
 * 8. Honest scope + vendor neutrality
 * ════════════════════════════════════════════════════════════════════ */
block('8. Honest scope + vendor neutrality', () => {
  t('8.1 Source cites ANJ Recommendation 2022-01',
    /ANJ Recommendation 2022-01/.test(src));
  t('8.2 Source cites Decree n° 2019-1061',
    /Decree n°? 2019-1061/.test(src));
  t('8.3 Source notes operator-side responsibility for FRJ API',
    /operator-side/i.test(src) || /operator session-init/i.test(src));
  t('8.4 Source cites rule_no_math_unless_asked honest scope',
    /rule_no_math_unless_asked/.test(src));
  t('8.5 No vendor / theme strings in source',
    !/(Wrath|Olympus|Lightning Link|Megaways|Pragmatic|NetEnt|Microgaming|\bIGT\b)/i.test(src));
});

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
