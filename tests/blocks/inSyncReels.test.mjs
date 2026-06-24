/**
 * tests/blocks/inSyncReels.test.mjs — UQ-DEEP-AK · WAVE 1 · BLOCK B
 *
 * 20-case suite for src/blocks/inSyncReels.mjs.
 */
import {
  defaultConfig,
  resolveConfig,
  emitInSyncReelsCSS,
  emitInSyncReelsMarkup,
  emitInSyncReelsRuntime,
} from '../../src/blocks/inSyncReels.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

let pass = 0, fail = 0;
function t(name, ok) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name); }
}

console.log('\n=== inSyncReels block (UQ-DEEP-AK B) ===');

/* 1. defaultConfig frozen + schemaVersion='1' */
const d = defaultConfig();
let frozenOk = Object.isFrozen(d);
try { d.enabled = true; if (d.enabled === true) frozenOk = false; } catch (_) { /* strict mode throws */ }
t('1. defaultConfig frozen + schemaVersion=1',
   frozenOk && d.schemaVersion === '1');

/* 2. default enabled=false */
t('2. default enabled=false', d.enabled === false);

/* 3. auto-enable from model.wild.special.in_sync */
const m3 = { wild: { special: { in_sync: { reels: [2, 3], evidence: 'Reels 2-3 spin in sync', lang: 'en' } } } };
const r3 = resolveConfig(m3);
t('3. auto-enable from model.wild.special.in_sync',
   r3.enabled === true && r3.syncGroups.length === 1 &&
   r3.syncGroups[0][0] === 2 && r3.syncGroups[0][1] === 3);

/* 4. auto-enable from model.inSyncReels */
const r4 = resolveConfig({ inSyncReels: { syncGroups: [[1, 2]] } });
t('4. auto-enable from model.inSyncReels',
   r4.enabled === true && r4.syncGroups.length === 1 &&
   r4.syncGroups[0][0] === 1 && r4.syncGroups[0][1] === 2);

/* 5. syncGroups empty → disabled */
const r5 = resolveConfig({ inSyncReels: { syncGroups: [] } });
t('5. empty syncGroups → disabled', r5.enabled === false && r5.syncGroups.length === 0);

/* 6. syncGroup with length<2 → dropped */
const r6 = resolveConfig({ inSyncReels: { syncGroups: [[1], [3, 4]] } });
t('6. length<2 dropped, length>=2 retained',
   r6.syncGroups.length === 1 && r6.syncGroups[0].length === 2);

/* 7. dedupe + sort within a group */
const r7 = resolveConfig({ inSyncReels: { syncGroups: [[4, 2, 4, 3]] } });
t('7. dedupe + sort within group',
   r7.syncGroups.length === 1 &&
   r7.syncGroups[0].length === 3 &&
   r7.syncGroups[0][0] === 2 && r7.syncGroups[0][1] === 3 && r7.syncGroups[0][2] === 4);

/* 8. multi-group support [[2,3],[5,6]] */
const r8 = resolveConfig({ inSyncReels: { syncGroups: [[2, 3], [5, 6]] } });
t('8. multi-group support',
   r8.syncGroups.length === 2 &&
   r8.syncGroups[0][0] === 2 && r8.syncGroups[0][1] === 3 &&
   r8.syncGroups[1][0] === 5 && r8.syncGroups[1][1] === 6);

/* 9. mode whitelist */
const r9a = resolveConfig({ inSyncReels: { syncGroups: [[2, 3]], mode: 'fs' } });
const r9b = resolveConfig({ inSyncReels: { syncGroups: [[2, 3]], mode: 'base' } });
const r9c = resolveConfig({ inSyncReels: { syncGroups: [[2, 3]], mode: 'both' } });
const r9d = resolveConfig({ inSyncReels: { syncGroups: [[2, 3]], mode: 'lobotomy' } });
t('9. mode whitelist (fs/base/both accepted, junk rejected)',
   r9a.mode === 'fs' && r9b.mode === 'base' && r9c.mode === 'both' && r9d.mode === 'both');

/* 10. linkBarMs clamp [60, 1500] */
const r10a = resolveConfig({ inSyncReels: { syncGroups: [[2, 3]], linkBarMs: 30 } });
const r10b = resolveConfig({ inSyncReels: { syncGroups: [[2, 3]], linkBarMs: 9999 } });
const r10c = resolveConfig({ inSyncReels: { syncGroups: [[2, 3]], linkBarMs: 500 } });
t('10. linkBarMs clamp [60, 1500]',
   r10a.linkBarMs === 60 && r10b.linkBarMs === 1500 && r10c.linkBarMs === 500);

/* 11. highlightColor hex validate (invalid rejected) */
const r11a = resolveConfig({ inSyncReels: { syncGroups: [[2, 3]], highlightColor: '#ff00aa' } });
const r11b = resolveConfig({ inSyncReels: { syncGroups: [[2, 3]], highlightColor: 'red' } });
const r11c = resolveConfig({ inSyncReels: { syncGroups: [[2, 3]], highlightColor: '<script>' } });
t('11. highlightColor hex validate',
   r11a.highlightColor === '#ff00aa' &&
   r11b.highlightColor === '#5dd2ff' &&
   r11c.highlightColor === '#5dd2ff');

/* 12. mirrorStops + mirrorSymbols default true */
t('12. mirrorStops + mirrorSymbols default true',
   r9a.mirrorStops === true && r9a.mirrorSymbols === true);

/* 13. emitCSS '' disabled / non-empty enabled */
const cssOff = emitInSyncReelsCSS(defaultConfig());
const cssOn  = emitInSyncReelsCSS(r3);
t('13. emitCSS empty disabled / has rules enabled',
   cssOff === '' &&
   cssOn.includes('.isr-link-bar') &&
   cssOn.includes('.isr-reel-glow'));

/* 14. emitMarkup '' disabled / div enabled */
const mkOff = emitInSyncReelsMarkup(defaultConfig());
const mkOn  = emitInSyncReelsMarkup(r3);
t('14. emitMarkup empty disabled / div enabled',
   mkOff === '' &&
   mkOn.includes('<div') &&
   mkOn.includes('isrLinkHost'));

/* 15. emitRuntime '' disabled / JS enabled */
const rtOff = emitInSyncReelsRuntime(defaultConfig());
const rtOn  = emitInSyncReelsRuntime(r3, m3);
t('15. emitRuntime empty disabled / JS enabled',
   rtOff === '' && rtOn.includes('inSyncAPI'));

/* 16. Runtime exposes window.inSyncAPI */
t('16. Runtime exposes window.inSyncAPI',
   rtOn.includes('window.inSyncAPI') &&
   rtOn.includes('syncStops') &&
   rtOn.includes('state'));

/* 17. Runtime contains __ISR_WIRED__ idempotency */
t('17. Runtime contains __ISR_WIRED__ guard',
   rtOn.includes('__ISR_WIRED__'));

/* 18. Runtime contains preSpin hook reference */
t('18. Runtime contains preSpin hook reference',
   rtOn.includes('preSpin'));

/* 19. Runtime no eval/document.write/innerHTML user sinks */
const noEval        = !/\beval\s*\(/.test(rtOn);
const noNewFn       = !/new\s+Function\s*\(/.test(rtOn);
const noDocWrite    = !/document\.write\b/.test(rtOn);
const noInnerHTML   = !/\.innerHTML\s*=/.test(rtOn);
t('19. Runtime safe (no eval / document.write / innerHTML sinks)',
   noEval && noNewFn && noDocWrite && noInnerHTML);

/* 20. Source vendor-neutral (no vendor brand leak in our block file) */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const src = readFileSync(resolve(__dirname, '../../src/blocks/inSyncReels.mjs'), 'utf8');
const vendorRe = /\b(IGT|NetEnt|Pragmatic|Aristocrat|Microgaming|Playtech|Scientific Games|Bally|WMS|Konami|Novomatic)\b/i;
t('20. Source vendor-neutral',
   !vendorRe.test(src));

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
