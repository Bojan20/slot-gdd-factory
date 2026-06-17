#!/usr/bin/env node
/**
 * tests/blocks/jurisdictionGate.test.mjs
 *
 * W59.H1 — Centralized jurisdiction-precedence resolver + audit gate.
 *
 * Tests pin:
 *   1. The frozen precedence chain shape
 *   2. resolveJurisdiction pure helper (3-key + optional fallback)
 *   3. resolveJurisdictionWithSource (audit-trail variant)
 *   4. defaultConfig + resolveConfig (orchestrator wiring)
 *   5. emitCSS no-op
 *   6. emitRuntime sole-owner emit + window flag
 *   7. LEGO contracts
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
const legoSrc = readFileSync(resolve(here, '../../tools/lego-gate.mjs'), 'utf8');
const srcPath = resolve(here, '../../src/blocks/jurisdictionGate.mjs');
const src = readFileSync(srcPath, 'utf8');

const mod = await import('../../src/blocks/jurisdictionGate.mjs');
const {
  JURISDICTION_PRECEDENCE_KEYS,
  resolveJurisdiction,
  resolveJurisdictionWithSource,
  defaultConfig,
  resolveConfig,
  emitJurisdictionGateCSS,
  emitJurisdictionGateRuntime,
} = mod;

/* ════════════════════════════════════════════════════════════════════
 * 1. Frozen precedence chain
 * ════════════════════════════════════════════════════════════════════ */
block('1. JURISDICTION_PRECEDENCE_KEYS contract', () => {
  t('1.1 Exported + frozen',
    !!JURISDICTION_PRECEDENCE_KEYS && Object.isFrozen(JURISDICTION_PRECEDENCE_KEYS));
  t('1.2 Order: regulator.profile FIRST',
    JURISDICTION_PRECEDENCE_KEYS[0] === 'regulator.profile');
  t('1.3 Order: responsibleGambling.jurisdiction SECOND',
    JURISDICTION_PRECEDENCE_KEYS[1] === 'responsibleGambling.jurisdiction');
  t('1.4 Chain length = 2 (canonical paths only; per-block fallback is the 3rd via opts)',
    JURISDICTION_PRECEDENCE_KEYS.length === 2);
});

/* ════════════════════════════════════════════════════════════════════
 * 2. resolveJurisdiction pure helper
 * ════════════════════════════════════════════════════════════════════ */
block('2. resolveJurisdiction', () => {
  t('2.1 null model → null',          resolveJurisdiction(null) === null);
  t('2.2 undefined model → null',     resolveJurisdiction(undefined) === null);
  t('2.3 empty object → null',        resolveJurisdiction({}) === null);
  t('2.4 string in model → null (non-object early return)',
    resolveJurisdiction('UKGC') === null);

  t('2.5 regulator.profile resolves',
    resolveJurisdiction({ regulator: { profile: 'UKGC' } }) === 'UKGC');
  t('2.6 lowercase normalized uppercase',
    resolveJurisdiction({ regulator: { profile: 'de' } }) === 'DE');
  t('2.7 whitespace trimmed',
    resolveJurisdiction({ regulator: { profile: '  NL  ' } }) === 'NL');

  t('2.8 responsibleGambling.jurisdiction fallback',
    resolveJurisdiction({ responsibleGambling: { jurisdiction: 'SE' } }) === 'SE');

  t('2.9 precedence: regulator wins over RG',
    resolveJurisdiction({
      regulator: { profile: 'UKGC' },
      responsibleGambling: { jurisdiction: 'DE' },
    }) === 'UKGC');

  /* Per-block opt-in fallback via opts. */
  t('2.10 fallbackKey opts honored when canonical chain empty',
    resolveJurisdiction({ autoplay: { jurisdiction: 'MGA' } }, { fallbackKey: 'autoplay.jurisdiction' }) === 'MGA');
  t('2.11 fallbackKey opts LOSES to regulator.profile',
    resolveJurisdiction({
      regulator: { profile: 'UKGC' },
      autoplay: { jurisdiction: 'MGA' },
    }, { fallbackKey: 'autoplay.jurisdiction' }) === 'UKGC');

  t('2.12 fallbackKey missing path → null',
    resolveJurisdiction({}, { fallbackKey: 'foo.bar.baz' }) === null);

  /* Edge cases. */
  t('2.13 empty-string regulator.profile ignored',
    resolveJurisdiction({ regulator: { profile: '   ' } }) === null);
  t('2.14 non-string regulator.profile ignored',
    resolveJurisdiction({ regulator: { profile: 42 } }) === null);
});

/* ════════════════════════════════════════════════════════════════════
 * 3. resolveJurisdictionWithSource — audit-trail variant
 * ════════════════════════════════════════════════════════════════════ */
block('3. resolveJurisdictionWithSource', () => {
  const a = resolveJurisdictionWithSource({ regulator: { profile: 'UKGC' } });
  t('3.1 returns { jurisdiction, source } for regulator.profile match',
    a.jurisdiction === 'UKGC' && a.source === 'regulator.profile');

  const b = resolveJurisdictionWithSource({ responsibleGambling: { jurisdiction: 'DE' } });
  t('3.2 source reports responsibleGambling.jurisdiction',
    b.jurisdiction === 'DE' && b.source === 'responsibleGambling.jurisdiction');

  const c = resolveJurisdictionWithSource(
    { autoplay: { jurisdiction: 'MGA' } },
    { fallbackKey: 'autoplay.jurisdiction' }
  );
  t('3.3 source reports the fallbackKey when used',
    c.jurisdiction === 'MGA' && c.source === 'autoplay.jurisdiction');

  const d = resolveJurisdictionWithSource({});
  t('3.4 empty model → both null',
    d.jurisdiction === null && d.source === null);
});

/* ════════════════════════════════════════════════════════════════════
 * 4. defaultConfig + resolveConfig
 * ════════════════════════════════════════════════════════════════════ */
block('4. defaultConfig + resolveConfig', () => {
  const dflt = defaultConfig();
  t('4.1 enabled defaults true',                 dflt.enabled === true);
  t('4.2 resolveConfig populates jurisdiction',
    resolveConfig({ regulator: { profile: 'EU' } }).jurisdiction === 'EU');
  t('4.3 resolveConfig populates source',
    resolveConfig({ regulator: { profile: 'EU' } }).source === 'regulator.profile');
  t('4.4 resolveConfig with no signal → jurisdiction null',
    resolveConfig({}).jurisdiction === null);
  t('4.5 enabled=false GDD knob honored',
    resolveConfig({ jurisdictionGate: { enabled: false } }).enabled === false);
});

/* ════════════════════════════════════════════════════════════════════
 * 5. emitCSS no-op
 * ════════════════════════════════════════════════════════════════════ */
block('5. emitCSS no-op', () => {
  t('5.1 emitCSS default returns ""', emitJurisdictionGateCSS(defaultConfig()) === '');
  t('5.2 emitCSS enabled DE also returns ""',
    emitJurisdictionGateCSS(resolveConfig({ regulator: { profile: 'DE' } })) === '');
});

/* ════════════════════════════════════════════════════════════════════
 * 6. emitRuntime
 * ════════════════════════════════════════════════════════════════════ */
block('6. emitRuntime', () => {
  t('6.1 disabled → ""', emitJurisdictionGateRuntime({ ...defaultConfig(), enabled: false }) === '');
  t('6.2 no jurisdiction signal → "" (skip emit)',
    emitJurisdictionGateRuntime(resolveConfig({})) === '');

  const rt = emitJurisdictionGateRuntime(resolveConfig({ regulator: { profile: 'DE' } }));
  t('6.3 sets window.__SLOT_JURISDICTION__',
    /window\.__SLOT_JURISDICTION__\s*=\s*JURISDICTION/.test(rt));
  t('6.4 baked JURISDICTION literal "DE"',
    /JURISDICTION\s*=\s*"DE"/.test(rt));
  t('6.5 sole-owner emit onJurisdictionResolved',
    /HookBus\.emit\(\s*['"]onJurisdictionResolved['"]/.test(rt));
  t('6.6 emit payload includes source',
    /onJurisdictionResolved[\s\S]{0,300}source:/.test(rt));
  t('6.7 SSR-safe: typeof window === undefined → return',
    /typeof\s+window\s*===\s*['"]undefined['"][\s\S]{0,50}return/.test(rt));
  t('6.8 emit wrapped in try/catch',
    /try\s*\{[\s\S]{0,300}HookBus\.emit[\s\S]{0,300}\}\s*catch/.test(rt));
});

/* ════════════════════════════════════════════════════════════════════
 * 7. LEGO contracts
 * ════════════════════════════════════════════════════════════════════ */
block('7. LEGO contracts', () => {
  t('7.1 onJurisdictionResolved owner declared',
    /onJurisdictionResolved:\s*\[\s*['"]jurisdictionGate\.mjs['"]\s*\]/.test(legoSrc));
  t('7.2 W59.H1 marker comment in lego-gate.mjs',
    /W59\.H1/.test(legoSrc));
  t('7.3 jurisdictionGate.mjs registered in HOOK_REGISTRATION_OPT_OUT',
    /HOOK_REGISTRATION_OPT_OUT[\s\S]{0,6000}jurisdictionGate\.mjs/.test(legoSrc));
});

/* ════════════════════════════════════════════════════════════════════
 * 8. Honest scope
 * ════════════════════════════════════════════════════════════════════ */
block('8. Honest scope', () => {
  t('8.1 Source cites rule_no_math_unless_asked', /rule_no_math_unless_asked/.test(src));
  t('8.2 Source lists which blocks adopt the helper (W58.J-* references)',
    /W58\.J-/.test(src));
  t('8.3 Source notes this does NOT replace per-block obligation logic',
    /does NOT replace/.test(src) || /does not replace/i.test(src));
});

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
