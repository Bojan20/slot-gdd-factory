/**
 * tests/blocks/symbolModifiers.test.mjs — UQ-DEEP-AJ · P1B contract test.
 */
import {
  defaultConfig,
  resolveConfig,
  emitSymbolModifiersCSS,
  emitSymbolModifiersMarkup,
  emitSymbolModifiersRuntime,
} from '../../src/blocks/symbolModifiers.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/symbolModifiers.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => {
  if (cond) { console.log('  ✓', label); pass++; }
  else      { console.log('  ✗', label); fail++; }
};

console.log('symbolModifiers block contract');

/* 1. defaultConfig frozen + schemaVersion='1' */
const def = defaultConfig();
t('defaultConfig frozen + schemaVersion="1"',
  Object.isFrozen(def) && def.schemaVersion === '1');

/* 2. default enabled=false (opt-in) */
t('default enabled = false (opt-in)', def.enabled === false);

/* 3. auto-enable when GDD declares non-empty transforms or oddsMasks */
const r3a = resolveConfig({ symbolModifiers: {
  transforms: [{ kind: 'mystery_reveal', params: { mysteryId: '?', pool: ['A','B'] } }],
} });
const r3b = resolveConfig({ symbolModifiers: {
  oddsMasks: [{ kind: 'reel_restrict', params: { symbol: 'W', reels: [1,2,3] } }],
} });
t('auto-enable with non-empty transforms', r3a.enabled === true);
t('auto-enable with non-empty oddsMasks',  r3b.enabled === true);

/* 4. enabled=false locked when both arrays empty (even if user set true) */
const r4 = resolveConfig({ symbolModifiers: { enabled: true } });
t('enabled=false locked when both arrays empty', r4.enabled === false);

/* 5. transforms unknown kind dropped silently */
const r5 = resolveConfig({ symbolModifiers: {
  transforms: [
    { kind: 'evil_drop_table', params: {} },
    { kind: 'mystery_reveal', params: { mysteryId: '?', pool: ['A'] } },
  ],
} });
t('unknown transform kind dropped',
  r5.transforms.length === 1 && r5.transforms[0].kind === 'mystery_reveal');

/* 6. oddsMasks unknown kind dropped silently */
const r6 = resolveConfig({ symbolModifiers: {
  oddsMasks: [
    { kind: 'rm_rf_slash', params: {} },
    { kind: 'reel_restrict', params: { symbol: 'W', reels: [1] } },
  ],
} });
t('unknown oddsMask kind dropped',
  r6.oddsMasks.length === 1 && r6.oddsMasks[0].kind === 'reel_restrict');

/* 7. XSS in transform.label stripped */
const r7 = resolveConfig({ symbolModifiers: {
  transforms: [
    { kind: 'sticky_overlay', label: '<script>alert(1)</script>BadLbl',
      params: { symbol: 'W', positions: [] } },
  ],
} });
t('XSS in label stripped (no < or >)',
  !/[<>]/.test(r7.transforms[0].label) && r7.transforms[0].label.includes('BadLbl'));

/* 8. mysteryRevealMode whitelist */
const r8a = resolveConfig({ symbolModifiers: {
  mysteryRevealMode: 'per-position',
  transforms: [{ kind: 'mystery_reveal', params: { mysteryId: '?', pool: ['A'] } }],
} });
const r8b = resolveConfig({ symbolModifiers: {
  mysteryRevealMode: 'INVALID',
  transforms: [{ kind: 'mystery_reveal', params: { mysteryId: '?', pool: ['A'] } }],
} });
t('mysteryRevealMode whitelist (per-position accepted, INVALID rejected)',
  r8a.mysteryRevealMode === 'per-position' && r8b.mysteryRevealMode === 'collective');

/* 9. copyWildDirection whitelist */
const r9a = resolveConfig({ symbolModifiers: {
  copyWildDirection: 'all',
  transforms: [{ kind: 'copy_wild', params: { wildId: 'W' } }],
} });
const r9b = resolveConfig({ symbolModifiers: {
  copyWildDirection: 'DIAGONAL',
  transforms: [{ kind: 'copy_wild', params: { wildId: 'W' } }],
} });
t('copyWildDirection whitelist (all accepted, DIAGONAL rejected)',
  r9a.copyWildDirection === 'all' && r9b.copyWildDirection === 'horizontal');

/* 10. emitSymbolModifiersCSS returns string when enabled, '' when disabled */
const cssDis = emitSymbolModifiersCSS({ ...def, enabled: false });
const cssEn  = emitSymbolModifiersCSS({ ...def, enabled: true });
t('CSS disabled = "" / enabled = non-empty string',
  cssDis === '' && typeof cssEn === 'string' && cssEn.length > 0
  && cssEn.includes('.sym-mod-overlay'));

/* 11. emitSymbolModifiersMarkup returns div when enabled, '' when disabled */
const mDis = emitSymbolModifiersMarkup({ ...def, enabled: false });
const mEn  = emitSymbolModifiersMarkup({ ...def, enabled: true });
t('Markup disabled = "" / enabled = #sym-mod-stage div',
  mDis === '' && mEn.includes('id="sym-mod-stage"')
  && mEn.includes('class="sym-mod-overlay"'));

/* 12. emitSymbolModifiersRuntime returns JS string when enabled */
const rt = emitSymbolModifiersRuntime({ ...def, enabled: true });
t('Runtime enabled = JS string', typeof rt === 'string' && rt.length > 0);

/* 13. Runtime contains 'window.symbolModifiersAPI' export */
t('Runtime exposes window.symbolModifiersAPI',
  rt.includes('window.symbolModifiersAPI'));

/* 14. Runtime contains all 4 API methods (applyTransform, applyOddsMask, mountStage) */
t('Runtime defines applyTransform + applyOddsMask + mountStage',
  rt.includes('function applyTransform(') &&
  rt.includes('function applyOddsMask(') &&
  rt.includes('function mountStage('));

/* 15. Runtime does NOT contain forbidden patterns (eval, document.write,
       innerHTML assignment for user data). */
const usesEval = /\beval\s*\(/.test(rt);
const usesDocWrite = /document\.write\s*\(/.test(rt);
const usesInnerHTMLAssign = /\.innerHTML\s*=/.test(rt);
t('Runtime has no eval / document.write / innerHTML= sinks',
  !usesEval && !usesDocWrite && !usesInnerHTMLAssign);

/* --- Vendor neutrality (bonus regression guard) --- */
const src = readFileSync(SRC_PATH, 'utf8');
const VENDORS = /\b(IGT|Pragmatic Play|Cash Eruption|Megaways|NetEnt|Microgaming|Hacksaw|Nolimit|Wazdan)\b/;
if (VENDORS.test(src)) {
  console.log('  ✗', 'source vendor-neutral');
  fail++;
} else {
  console.log('  ✓', 'source vendor-neutral');
}

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
