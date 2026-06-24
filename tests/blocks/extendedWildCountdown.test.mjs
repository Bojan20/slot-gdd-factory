/**
 * tests/blocks/extendedWildCountdown.test.mjs — UQ-DEEP-AK · WAVE 1 · BLOCK C
 *
 * Contract test for the extended-wild countdown presentation + state
 * block. Mirrors the symbolModifiers test harness (pass/fail counter,
 * plain console output, no node:test wrapper) so it is callable as a
 * straight `node tests/blocks/extendedWildCountdown.test.mjs` script.
 *
 * 22-case spec:
 *   1.  defaultConfig frozen + schemaVersion='1'
 *   2.  default enabled=false
 *   3.  auto-enable from model.wild.special.extended_wild
 *   4.  auto-enable from model.extendedWildCountdown
 *   5.  extraSpins=0 → clamped to 1
 *   6.  extraSpins=999 → clamped to 99
 *   7.  mode whitelist (base/fs/both accepted, BAD rejected)
 *   8.  countdownColor hex validate
 *   9.  countdownFontPx clamp [8, 32]
 *   10. pulseMs clamp [100, 3000]
 *   11. decrementOn whitelist
 *   12. crossPhase default true
 *   13. emitCSS '' disabled / non-empty enabled
 *   14. emitMarkup '' disabled / div enabled
 *   15. emitRuntime '' disabled / JS enabled
 *   16. Runtime exposes window.extendedWildAPI
 *   17. Runtime contains __EWCD_WIRED__
 *   18. Runtime contains 'onSpinResult' hook
 *   19. Runtime contains 'preSpin' hook
 *   20. Runtime has no eval / document.write / innerHTML= sinks
 *   21. Source vendor-neutral
 *   22. defaultConfig returns fresh frozen object (not shared mutable)
 */

import {
  defaultConfig,
  resolveConfig,
  emitExtendedWildCountdownCSS,
  emitExtendedWildCountdownMarkup,
  emitExtendedWildCountdownRuntime,
} from '../../src/blocks/extendedWildCountdown.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/extendedWildCountdown.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => {
  if (cond) { console.log('  ✓', label); pass++; }
  else      { console.log('  ✗', label); fail++; }
};

console.log('extendedWildCountdown block contract (UQ-DEEP-AK · WAVE 1 · BLOCK C)');

/* 1. defaultConfig frozen + schemaVersion='1' */
const def = defaultConfig();
t('1.  defaultConfig frozen + schemaVersion="1"',
  Object.isFrozen(def) && def.schemaVersion === '1');

/* 2. default enabled=false */
t('2.  default enabled = false (opt-in)',
  def.enabled === false);

/* 3. auto-enable from model.wild.special.extended_wild */
const c3 = resolveConfig({
  wild: { special: { extended_wild: { extraSpins: 3, evidence: 'prose' } } },
});
t('3.  auto-enable from model.wild.special.extended_wild',
  c3.enabled === true);

/* 4. auto-enable from model.extendedWildCountdown */
const c4 = resolveConfig({ extendedWildCountdown: { extraSpins: 5 } });
t('4.  auto-enable from model.extendedWildCountdown',
  c4.enabled === true && c4.extraSpins === 5);

/* 5. extraSpins=0 → clamped to 1 */
const c5 = resolveConfig({ extendedWildCountdown: { enabled: true, extraSpins: 0 } });
t('5.  extraSpins=0 → clamped to 1',
  c5.extraSpins === 1);

/* 6. extraSpins=999 → clamped to 99 */
const c6 = resolveConfig({ extendedWildCountdown: { enabled: true, extraSpins: 999 } });
t('6.  extraSpins=999 → clamped to 99',
  c6.extraSpins === 99);

/* 7. mode whitelist (base/fs/both accepted, BAD rejected) */
const c7a = resolveConfig({ extendedWildCountdown: { enabled: true, mode: 'base' } });
const c7b = resolveConfig({ extendedWildCountdown: { enabled: true, mode: 'fs' } });
const c7c = resolveConfig({ extendedWildCountdown: { enabled: true, mode: 'both' } });
const c7d = resolveConfig({ extendedWildCountdown: { enabled: true, mode: 'BAD' } });
t('7.  mode whitelist (base/fs/both accepted, BAD rejected)',
  c7a.mode === 'base' && c7b.mode === 'fs' && c7c.mode === 'both' && c7d.mode === 'both');

/* 8. countdownColor hex validate */
const c8a = resolveConfig({ extendedWildCountdown: { enabled: true, countdownColor: '#abc' } });
const c8b = resolveConfig({ extendedWildCountdown: { enabled: true, countdownColor: '#1A2B3C' } });
const c8c = resolveConfig({ extendedWildCountdown: { enabled: true, countdownColor: 'red' } });
t('8.  countdownColor hex validate (#abc + #1A2B3C accepted, "red" rejected)',
  c8a.countdownColor === '#abc' &&
  c8b.countdownColor === '#1A2B3C' &&
  c8c.countdownColor === '#ffcc00');

/* 9. countdownFontPx clamp [8, 32] */
const c9a = resolveConfig({ extendedWildCountdown: { enabled: true, countdownFontPx: 4 } });
const c9b = resolveConfig({ extendedWildCountdown: { enabled: true, countdownFontPx: 64 } });
const c9c = resolveConfig({ extendedWildCountdown: { enabled: true, countdownFontPx: 20 } });
t('9.  countdownFontPx clamp [8, 32] (4→8, 64→32, 20→20)',
  c9a.countdownFontPx === 8 && c9b.countdownFontPx === 32 && c9c.countdownFontPx === 20);

/* 10. pulseMs clamp [100, 3000] */
const c10a = resolveConfig({ extendedWildCountdown: { enabled: true, pulseMs: 50 } });
const c10b = resolveConfig({ extendedWildCountdown: { enabled: true, pulseMs: 9999 } });
const c10c = resolveConfig({ extendedWildCountdown: { enabled: true, pulseMs: 600 } });
t('10. pulseMs clamp [100, 3000] (50→100, 9999→3000, 600→600)',
  c10a.pulseMs === 100 && c10b.pulseMs === 3000 && c10c.pulseMs === 600);

/* 11. decrementOn whitelist (spinComplete/fsSpinOnly/baseSpinOnly accepted, BAD rejected) */
const c11a = resolveConfig({ extendedWildCountdown: { enabled: true, decrementOn: 'spinComplete' } });
const c11b = resolveConfig({ extendedWildCountdown: { enabled: true, decrementOn: 'fsSpinOnly' } });
const c11c = resolveConfig({ extendedWildCountdown: { enabled: true, decrementOn: 'baseSpinOnly' } });
const c11d = resolveConfig({ extendedWildCountdown: { enabled: true, decrementOn: 'BAD' } });
t('11. decrementOn whitelist (3 valid accepted, BAD rejected)',
  c11a.decrementOn === 'spinComplete' &&
  c11b.decrementOn === 'fsSpinOnly' &&
  c11c.decrementOn === 'baseSpinOnly' &&
  c11d.decrementOn === 'spinComplete');

/* 12. crossPhase default true */
t('12. crossPhase default = true',
  def.crossPhase === true);

/* 13. emitCSS '' disabled / non-empty enabled */
const cssDis = emitExtendedWildCountdownCSS({ ...def, enabled: false });
const cssEn  = emitExtendedWildCountdownCSS({ ...def, enabled: true });
t('13. emitCSS "" disabled / non-empty enabled',
  cssDis === '' &&
  typeof cssEn === 'string' && cssEn.length > 0 &&
  cssEn.includes('.ewcd-counter') &&
  cssEn.includes('.ewcd-cell-glow') &&
  cssEn.includes('.ewcd-final-pop') &&
  cssEn.includes('prefers-reduced-motion'));

/* 14. emitMarkup '' disabled / div enabled */
const mDis = emitExtendedWildCountdownMarkup({ ...def, enabled: false });
const mEn  = emitExtendedWildCountdownMarkup({ ...def, enabled: true });
t('14. emitMarkup "" disabled / div enabled',
  mDis === '' &&
  typeof mEn === 'string' && mEn.length > 0 &&
  /^<div\b/.test(mEn) &&
  mEn.includes('id="ewcd-stage"'));

/* 15. emitRuntime '' disabled / JS enabled */
const rtDis = emitExtendedWildCountdownRuntime({ ...def, enabled: false });
const rtEn  = emitExtendedWildCountdownRuntime({ ...def, enabled: true });
t('15. emitRuntime "" disabled / JS string enabled',
  rtDis === '' && typeof rtEn === 'string' && rtEn.length > 0);

/* 16. Runtime exposes window.extendedWildAPI */
t('16. Runtime exposes window.extendedWildAPI',
  rtEn.includes('window.extendedWildAPI'));

/* 17. Runtime contains __EWCD_WIRED__ */
t('17. Runtime contains __EWCD_WIRED__ idempotency guard',
  rtEn.includes('__EWCD_WIRED__'));

/* 18. Runtime contains 'onSpinResult' hook */
t('18. Runtime contains onSpinResult hook subscription',
  /HookBus\.on\(\s*['"]onSpinResult['"]/.test(rtEn));

/* 19. Runtime contains 'preSpin' hook */
t('19. Runtime contains preSpin hook subscription',
  /HookBus\.on\(\s*['"]preSpin['"]/.test(rtEn));

/* 20. Runtime no eval/document.write/innerHTML user sinks */
const usesEval            = /\beval\s*\(/.test(rtEn);
const usesDocWrite        = /document\.write\s*\(/.test(rtEn);
const usesInnerHTMLAssign = /\.innerHTML\s*=/.test(rtEn);
t('20. Runtime has no eval / document.write / innerHTML= sinks',
  !usesEval && !usesDocWrite && !usesInnerHTMLAssign);

/* 21. Source vendor-neutral */
const src = readFileSync(SRC_PATH, 'utf8');
const VENDORS = /\b(IGT|Pragmatic Play|Cash Eruption|Megaways|NetEnt|Microgaming|Hacksaw|Nolimit|Wazdan)\b/;
t('21. source vendor-neutral (no proprietary names)',
  !VENDORS.test(src));

/* 22. defaultConfig returns fresh frozen object (not shared mutable) */
const a = defaultConfig();
const b = defaultConfig();
let mutationLeaked = false;
try { a.enabled = true; } catch (_) { /* frozen — good */ }
t('22. defaultConfig returns fresh frozen object (mutation isolated)',
  Object.isFrozen(a) && Object.isFrozen(b) && b.enabled === false && !mutationLeaked);

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
