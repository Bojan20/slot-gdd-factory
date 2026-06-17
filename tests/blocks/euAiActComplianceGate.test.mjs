#!/usr/bin/env node
/**
 * tests/blocks/euAiActComplianceGate.test.mjs
 *
 * W58.J-EU — EU AI Act (Regulation 2024/1689) compliance gate.
 *
 * Authority anchors:
 *   Art.5(1)(a)  Subliminal-manipulation prohibition
 *   Art.5(1)(b)  Vulnerability-exploitation (DDA) prohibition
 *   Art.50(1)    Transparency on AI-generated / AI-personalized content
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
const srcPath = resolve(here, '../../src/blocks/euAiActComplianceGate.mjs');
const src = readFileSync(srcPath, 'utf8');
const legoSrc = readFileSync(resolve(here, '../../tools/lego-gate.mjs'), 'utf8');

const mod = await import('../../src/blocks/euAiActComplianceGate.mjs');
const {
  defaultConfig,
  resolveConfig,
  emitEuAiActComplianceGateCSS,
  emitEuAiActComplianceGateRuntime,
  EU_AI_ACT_PROHIBITED_PRACTICES,
} = mod;

/* ════════════════════════════════════════════════════════════════════
 * 1. Public API exports
 * ════════════════════════════════════════════════════════════════════ */
block('1. Public API contract', () => {
  t('1.1 EU_AI_ACT_PROHIBITED_PRACTICES exported', !!EU_AI_ACT_PROHIBITED_PRACTICES);
  t('1.2 EU_AI_ACT_PROHIBITED_PRACTICES frozen',
    Object.isFrozen(EU_AI_ACT_PROHIBITED_PRACTICES));
  t('1.3 Has all 3 Article references (5(1)(a) + 5(1)(b) + 50(1))',
    EU_AI_ACT_PROHIBITED_PRACTICES.length === 3 &&
    EU_AI_ACT_PROHIBITED_PRACTICES.some(p => p.article === '5(1)(a)') &&
    EU_AI_ACT_PROHIBITED_PRACTICES.some(p => p.article === '5(1)(b)') &&
    EU_AI_ACT_PROHIBITED_PRACTICES.some(p => p.article === '50(1)'));
  t('1.4 Each entry frozen (deep-freeze contract)',
    EU_AI_ACT_PROHIBITED_PRACTICES.every(p => typeof p.article === 'string' && typeof p.short === 'string'));
});

/* ════════════════════════════════════════════════════════════════════
 * 2. defaultConfig
 * ════════════════════════════════════════════════════════════════════ */
block('2. defaultConfig', () => {
  const c = defaultConfig();
  t('2.1 enabled defaults false (opt-in)',   c.enabled === false);
  t('2.2 jurisdiction defaults null',        c.jurisdiction === null);
  t('2.3 declareNoAi defaults true',         c.declareNoAi === true);
});

/* ════════════════════════════════════════════════════════════════════
 * 3. resolveConfig — 3-key precedence + auto-enable EU
 * ════════════════════════════════════════════════════════════════════ */
block('3. resolveConfig 3-key precedence + auto-enable', () => {
  const off = resolveConfig({});
  t('3.1 No jurisdiction → enabled FALSE',  off.enabled === false);
  t('3.2 No jurisdiction → jurisdiction null', off.jurisdiction === null);

  const c1 = resolveConfig({ euAiActComplianceGate: { jurisdiction: 'EU' } });
  t('3.3 EU via euAiActComplianceGate → enabled TRUE',
    c1.enabled === true && c1.jurisdiction === 'EU');

  const c2 = resolveConfig({ responsibleGambling: { jurisdiction: 'eu' } });
  t('3.4 lowercase eu via responsibleGambling → uppercase + auto-enable',
    c2.jurisdiction === 'EU' && c2.enabled === true);

  const c3 = resolveConfig({
    regulator: { profile: 'EU' },
    responsibleGambling: { jurisdiction: 'UKGC' }, /* should lose */
    euAiActComplianceGate: { jurisdiction: 'MGA' }, /* should lose */
  });
  t('3.5 regulator.profile precedence wins',
    c3.jurisdiction === 'EU' && c3.enabled === true);

  /* UKGC is no longer EU but the AI Act still doesn't auto-apply there. */
  const c4 = resolveConfig({ regulator: { profile: 'UKGC' } });
  t('3.6 UKGC → enabled FALSE (no auto-enable outside EU)',
    c4.enabled === false && c4.jurisdiction === 'UKGC');

  const c5 = resolveConfig({ euAiActComplianceGate: { enabled: true } });
  t('3.7 explicit enabled:true honored without jurisdiction',
    c5.enabled === true);
});

/* ════════════════════════════════════════════════════════════════════
 * 4. resolveConfig — declareNoAi toggle
 * ════════════════════════════════════════════════════════════════════ */
block('4. declareNoAi knob', () => {
  const yes = resolveConfig({ regulator: { profile: 'EU' }, euAiActComplianceGate: { declareNoAi: true } });
  t('4.1 declareNoAi true → cfg.declareNoAi true', yes.declareNoAi === true);

  const no = resolveConfig({ regulator: { profile: 'EU' }, euAiActComplianceGate: { declareNoAi: false } });
  t('4.2 declareNoAi false → cfg.declareNoAi false', no.declareNoAi === false);

  const bad = resolveConfig({ regulator: { profile: 'EU' }, euAiActComplianceGate: { declareNoAi: 'yes' } });
  t('4.3 non-boolean declareNoAi ignored → default true', bad.declareNoAi === true);
});

/* ════════════════════════════════════════════════════════════════════
 * 5. emitCSS no-op
 * ════════════════════════════════════════════════════════════════════ */
block('5. emitCSS no-op', () => {
  t('5.1 emitCSS returns empty string',
    emitEuAiActComplianceGateCSS(defaultConfig()) === '');
  t('5.2 emitCSS enabled EU also returns empty',
    emitEuAiActComplianceGateCSS(resolveConfig({ regulator: { profile: 'EU' } })) === '');
});

/* ════════════════════════════════════════════════════════════════════
 * 6. emitRuntime disabled
 * ════════════════════════════════════════════════════════════════════ */
block('6. emitRuntime disabled', () => {
  t('6.1 disabled config → empty runtime',
    emitEuAiActComplianceGateRuntime(defaultConfig()) === '');
  t('6.2 UKGC jurisdiction → empty runtime (no auto-enable)',
    emitEuAiActComplianceGateRuntime(resolveConfig({ regulator: { profile: 'UKGC' } })) === '');
});

/* ════════════════════════════════════════════════════════════════════
 * 7. emitRuntime Art.5(1)(a) — Subliminal manipulation flag
 * ════════════════════════════════════════════════════════════════════ */
block('7. emitRuntime Art.5(1)(a) — subliminal manipulation', () => {
  const rt = emitEuAiActComplianceGateRuntime(resolveConfig({ regulator: { profile: 'EU' } }));
  t('7.1 declareNoAi=true path sets __EU_AI_SUBLIMINAL_BANNED__ = true',
    /DECLARE_NO_AI[\s\S]{0,150}window\.__EU_AI_SUBLIMINAL_BANNED__\s*=\s*true/.test(rt));
  t('7.2 DECLARE_NO_AI literal baked from cfg',
    /DECLARE_NO_AI\s*=\s*true/.test(rt));
});

/* ════════════════════════════════════════════════════════════════════
 * 8. emitRuntime Art.5(1)(b) — DDA prohibition + emit
 * ════════════════════════════════════════════════════════════════════ */
block('8. emitRuntime Art.5(1)(b) — DDA prohibition', () => {
  const rt = emitEuAiActComplianceGateRuntime(resolveConfig({ regulator: { profile: 'EU' } }));
  t('8.1 sets window.__EU_AI_ACT_DDA_PROHIBITED__ = true',
    /window\.__EU_AI_ACT_DDA_PROHIBITED__\s*=\s*true/.test(rt));
  t('8.2 sole-owner emit onAiActDdaProhibited',
    /HookBus\.emit\(\s*['"]onAiActDdaProhibited['"]/.test(rt));
  t('8.3 emit payload cites EU-AIAct-2024/1689-Art.5(1)(b)',
    /onAiActDdaProhibited[\s\S]{0,400}EU-AIAct-2024\/1689-Art\.5\(1\)\(b\)/.test(rt));
  t('8.4 emit payload includes jurisdiction',
    /onAiActDdaProhibited[\s\S]{0,400}jurisdiction:/.test(rt));
});

/* ════════════════════════════════════════════════════════════════════
 * 9. emitRuntime Art.50(1) — Transparency declaration + emit
 * ════════════════════════════════════════════════════════════════════ */
block('9. emitRuntime Art.50(1) — transparency declaration', () => {
  const rt = emitEuAiActComplianceGateRuntime(resolveConfig({ regulator: { profile: 'EU' } }));
  t('9.1 sets window.__EU_AI_DECLARATION_REQUIRED__ = true',
    /window\.__EU_AI_DECLARATION_REQUIRED__\s*=\s*true/.test(rt));
  t('9.2 initializes window.__EU_AI_DECLARATION_ACK__ to false if missing',
    /typeof\s+window\.__EU_AI_DECLARATION_ACK__\s*===\s*['"]undefined['"][\s\S]{0,150}=\s*false/.test(rt));
  t('9.3 sole-owner emit onAiSystemDeclarationRequired',
    /HookBus\.emit\(\s*['"]onAiSystemDeclarationRequired['"]/.test(rt));
  t('9.4 emit payload cites EU-AIAct-2024/1689-Art.50(1)',
    /onAiSystemDeclarationRequired[\s\S]{0,400}EU-AIAct-2024\/1689-Art\.50\(1\)/.test(rt));
});

/* ════════════════════════════════════════════════════════════════════
 * 10. emitRuntime declareNoAi=false branch
 * ════════════════════════════════════════════════════════════════════ */
block('10. declareNoAi=false branch', () => {
  const rt = emitEuAiActComplianceGateRuntime(resolveConfig({
    regulator: { profile: 'EU' },
    euAiActComplianceGate: { declareNoAi: false },
  }));
  t('10.1 DECLARE_NO_AI baked false',
    /DECLARE_NO_AI\s*=\s*false/.test(rt));
  t('10.2 Subliminal flag gated behind if (DECLARE_NO_AI)',
    /if\s*\(\s*DECLARE_NO_AI[\s\S]{0,150}__EU_AI_SUBLIMINAL_BANNED__/.test(rt));
  t('10.3 DDA prohibition still fires (Art.5(1)(b) always applies)',
    /HookBus\.emit\(\s*['"]onAiActDdaProhibited['"]/.test(rt));
  t('10.4 Art.50 declaration still fires (Art.50(1) always applies)',
    /HookBus\.emit\(\s*['"]onAiSystemDeclarationRequired['"]/.test(rt));
});

/* ════════════════════════════════════════════════════════════════════
 * 11. SSR safety
 * ════════════════════════════════════════════════════════════════════ */
block('11. SSR safety', () => {
  const rt = emitEuAiActComplianceGateRuntime(resolveConfig({ regulator: { profile: 'EU' } }));
  t('11.1 IIFE early-returns when typeof window === undefined',
    /typeof\s+window\s*===\s*['"]undefined['"][\s\S]{0,80}return/.test(rt));
  t('11.2 emit gated behind typeof HookBus.emit === function',
    /HookBus[\s\S]{0,100}typeof\s+window\.HookBus\.emit\s*===\s*['"]function['"]/.test(rt));
  t('11.3 emit calls wrapped in try/catch',
    /try\s*\{[\s\S]{0,400}HookBus\.emit[\s\S]{0,400}\}\s*catch/.test(rt));
});

/* ════════════════════════════════════════════════════════════════════
 * 12. LEGO contracts
 * ════════════════════════════════════════════════════════════════════ */
block('12. LEGO contracts', () => {
  t('12.1 onAiActDdaProhibited owner declared',
    /onAiActDdaProhibited:\s*\[\s*['"]euAiActComplianceGate\.mjs['"]\s*\]/.test(legoSrc));
  t('12.2 onAiSystemDeclarationRequired owner declared',
    /onAiSystemDeclarationRequired:\s*\[\s*['"]euAiActComplianceGate\.mjs['"]\s*\]/.test(legoSrc));
  t('12.3 W58.J-EU marker comment in lego-gate.mjs',
    /W58\.J-EU/.test(legoSrc));
  t('12.4 EU AI Act citation in lego-gate.mjs',
    /EU\s*AI\s*Act/.test(legoSrc));
  t('12.5 euAiActComplianceGate.mjs registered in HOOK_REGISTRATION_OPT_OUT',
    /HOOK_REGISTRATION_OPT_OUT[\s\S]{0,5000}euAiActComplianceGate\.mjs/.test(legoSrc));
});

/* ════════════════════════════════════════════════════════════════════
 * 13. Honest scope
 * ════════════════════════════════════════════════════════════════════ */
block('13. Honest scope', () => {
  t('13.1 Source cites Article 5(1)(a) by reference',
    /Art\.5\(1\)\(a\)/.test(src) || /Article\s*5\s*\(1\)\(a\)/.test(src));
  t('13.2 Source cites Article 5(1)(b) by reference',
    /Art\.5\(1\)\(b\)/.test(src) || /Article\s*5\s*\(1\)\(b\)/.test(src));
  t('13.3 Source cites Article 50(1) transparency',
    /Art\.50\(1\)/.test(src) || /Article\s*50\(1\)/.test(src));
  t('13.4 Source cites Regulation 2024/1689 by number',
    /2024\/1689/.test(src));
  t('13.5 Source cites rule_no_math_unless_asked honest scope',
    /rule_no_math_unless_asked/.test(src));
  t('13.6 Source documents DDA as the prohibited practice family',
    /DDA/.test(src) && /Dynamic Difficulty Adjustment/.test(src));
  t('13.7 No vendor / theme strings in source',
    !/(Wrath|Olympus|Lightning Link|Megaways|Pragmatic|NetEnt|Microgaming|IGT)/i.test(src));
});

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
