/**
 * tests/blocks/addedSymbolsInjector.test.mjs
 *
 * UQ-DEEP-AK · WAVE 1 · BLOCK D — contract test (24 cases).
 */
import {
  defaultConfig,
  resolveConfig,
  emitAddedSymbolsInjectorCSS,
  emitAddedSymbolsInjectorMarkup,
  emitAddedSymbolsInjectorRuntime,
  emitCSS,
  emitMarkup,
  emitRuntime,
} from '../../src/blocks/addedSymbolsInjector.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/addedSymbolsInjector.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => {
  if (cond) { console.log('  ✓', label); pass++; }
  else      { console.log('  ✗', label); fail++; }
};

console.log('addedSymbolsInjector block contract');

/* 1. defaultConfig frozen + schemaVersion='1' */
const def = defaultConfig();
t('1. defaultConfig frozen + schemaVersion="1"',
  Object.isFrozen(def) && def.schemaVersion === '1');

/* 2. default enabled=false + injections=[] */
t('2. default enabled=false + injections=[]',
  def.enabled === false && Array.isArray(def.injections) && def.injections.length === 0);

/* 3. auto-enable from model.wild.special.added_symbols (single object wrap) */
const r3 = resolveConfig({
  wild: { special: { added_symbols: { symbolId: 'W', count: 2, addedDuring: 'bonus' } } },
});
t('3. auto-enable from wild.special.added_symbols + single-object wrapped to array',
  r3.enabled === true
  && Array.isArray(r3.injections)
  && r3.injections.length === 1
  && r3.injections[0].symbolId === 'W'
  && r3.injections[0].count === 2
  && r3.injections[0].addedDuring === 'bonus');

/* 4. auto-enable from model.addedSymbolsInjector (array form) */
const r4 = resolveConfig({
  addedSymbolsInjector: {
    injections: [
      { symbolId: 'W', count: 1, addedDuring: 'freeSpins' },
      { symbolId: 'S', count: 3, addedDuring: 'bonus' },
    ],
  },
});
t('4. auto-enable from addedSymbolsInjector (array)',
  r4.enabled === true && r4.injections.length === 2);

/* 5. injections empty → disabled even when key present */
const r5 = resolveConfig({ addedSymbolsInjector: { injections: [] } });
t('5. injections empty → disabled even when key present',
  r5.enabled === false && r5.injections.length === 0);

/* 6. injection symbolId whitelist (lowercase rejected) */
const r6 = resolveConfig({
  addedSymbolsInjector: {
    injections: [
      { symbolId: 'wild', count: 1, addedDuring: 'bonus' },     // lowercase → REJECT
      { symbolId: 'W',    count: 1, addedDuring: 'bonus' },     // ACCEPT
      { symbolId: 'S_1',  count: 1, addedDuring: 'freeSpins' }, // ACCEPT (alnum + underscore)
      { symbolId: 'bad-id', count: 1, addedDuring: 'bonus' },   // hyphen → REJECT
    ],
  },
});
t('6. injection symbolId whitelist ([A-Z0-9_]+; lowercase/hyphen rejected)',
  r6.injections.length === 2
  && r6.injections.some((i) => i.symbolId === 'W')
  && r6.injections.some((i) => i.symbolId === 'S_1')
  && !r6.injections.some((i) => i.symbolId === 'wild'));

/* 7. injection count clamp [1, 10] */
const r7 = resolveConfig({
  addedSymbolsInjector: {
    injections: [
      { symbolId: 'W', count: 0,   addedDuring: 'bonus' },     // clamp up → 1
      { symbolId: 'X', count: 99,  addedDuring: 'bonus' },     // clamp down → 10
      { symbolId: 'Y', count: 5,   addedDuring: 'bonus' },     // pass-through
    ],
  },
});
const c0 = r7.injections.find((i) => i.symbolId === 'W').count;
const c99 = r7.injections.find((i) => i.symbolId === 'X').count;
const c5 = r7.injections.find((i) => i.symbolId === 'Y').count;
t('7. injection count clamp [1, 10]',
  c0 === 1 && c99 === 10 && c5 === 5);

/* 8. injection addedDuring whitelist */
const r8 = resolveConfig({
  addedSymbolsInjector: {
    injections: [
      { symbolId: 'W', count: 1, addedDuring: 'baseGame' },
      { symbolId: 'X', count: 1, addedDuring: 'freeSpins' },
      { symbolId: 'Y', count: 1, addedDuring: 'bonus' },
      { symbolId: 'Z', count: 1, addedDuring: 'BAD_PHASE' },  // reject
    ],
  },
});
t('8. addedDuring whitelist (baseGame/freeSpins/bonus accepted, BAD rejected)',
  r8.injections.length === 3
  && !r8.injections.some((i) => i.addedDuring === 'BAD_PHASE'));

/* 9. injection weight clamp [0, 1] */
const r9 = resolveConfig({
  addedSymbolsInjector: {
    injections: [
      { symbolId: 'W', count: 1, addedDuring: 'bonus', weight: -1   }, // → 0
      { symbolId: 'X', count: 1, addedDuring: 'bonus', weight: 2.5  }, // → 1
      { symbolId: 'Y', count: 1, addedDuring: 'bonus', weight: 0.5  }, // → 0.5
      { symbolId: 'Z', count: 1, addedDuring: 'bonus' },               // default 1.0
    ],
  },
});
const wW = r9.injections.find((i) => i.symbolId === 'W').weight;
const wX = r9.injections.find((i) => i.symbolId === 'X').weight;
const wY = r9.injections.find((i) => i.symbolId === 'Y').weight;
const wZ = r9.injections.find((i) => i.symbolId === 'Z').weight;
t('9. injection weight clamp [0, 1] + default 1.0',
  wW === 0 && wX === 1 && wY === 0.5 && wZ === 1.0);

/* 10. injection invalid entry dropped (not crash) */
let r10, threw = false;
try {
  r10 = resolveConfig({
    addedSymbolsInjector: {
      injections: [
        null,
        undefined,
        'garbage',
        42,
        { /* missing fields */ },
        { symbolId: 'OK', count: 1, addedDuring: 'bonus' },
      ],
    },
  });
} catch (_) { threw = true; }
t('10. invalid entries dropped without crash',
  !threw && r10 && r10.injections.length === 1
  && r10.injections[0].symbolId === 'OK');

/* 11. injection dedupe by symbolId+addedDuring pair */
const r11 = resolveConfig({
  addedSymbolsInjector: {
    injections: [
      { symbolId: 'W', count: 1, addedDuring: 'bonus' },
      { symbolId: 'W', count: 9, addedDuring: 'bonus' },     // dup pair → drop
      { symbolId: 'W', count: 2, addedDuring: 'freeSpins' }, // different phase → keep
      { symbolId: 'S', count: 1, addedDuring: 'bonus' },     // different symbol → keep
    ],
  },
});
t('11. dedupe by symbolId+addedDuring (first wins, subsequent dups dropped)',
  r11.injections.length === 3
  && r11.injections[0].symbolId === 'W' && r11.injections[0].addedDuring === 'bonus' && r11.injections[0].count === 1
  && r11.injections.some((i) => i.symbolId === 'W' && i.addedDuring === 'freeSpins')
  && r11.injections.some((i) => i.symbolId === 'S' && i.addedDuring === 'bonus'));

/* 12. haloRGB format validate */
const r12valid = resolveConfig({
  addedSymbolsInjector: {
    haloRGB: '120,200,255',
    injections: [{ symbolId: 'W', count: 1, addedDuring: 'bonus' }],
  },
});
const r12bad = resolveConfig({
  addedSymbolsInjector: {
    haloRGB: 'red',
    injections: [{ symbolId: 'W', count: 1, addedDuring: 'bonus' }],
  },
});
const r12oversat = resolveConfig({
  addedSymbolsInjector: {
    haloRGB: '999,200,200', // out of [0,255]
    injections: [{ symbolId: 'W', count: 1, addedDuring: 'bonus' }],
  },
});
t('12. haloRGB format validated (valid kept, invalid → default)',
  r12valid.haloRGB === '120,200,255'
  && r12bad.haloRGB === defaultConfig().haloRGB
  && r12oversat.haloRGB === defaultConfig().haloRGB);

/* 13. injectionMs clamp [80, 1500] */
const r13lo = resolveConfig({
  addedSymbolsInjector: {
    injectionMs: 10,
    injections: [{ symbolId: 'W', count: 1, addedDuring: 'bonus' }],
  },
});
const r13hi = resolveConfig({
  addedSymbolsInjector: {
    injectionMs: 9999,
    injections: [{ symbolId: 'W', count: 1, addedDuring: 'bonus' }],
  },
});
const r13mid = resolveConfig({
  addedSymbolsInjector: {
    injectionMs: 500,
    injections: [{ symbolId: 'W', count: 1, addedDuring: 'bonus' }],
  },
});
t('13. injectionMs clamp [80, 1500]',
  r13lo.injectionMs === 80 && r13hi.injectionMs === 1500 && r13mid.injectionMs === 500);

/* 14. parser-shape {symbolId,count,addedDuring} wrapped to array */
const r14 = resolveConfig({
  wild: { special: { added_symbols: {
    symbolId: 'W', count: 3, addedDuring: 'freeSpins',
    evidence: 'Additional wild symbols added during free spins',
    lang: 'en',
  } } },
});
t('14. parser single-rule shape wrapped to injections[]',
  Array.isArray(r14.injections)
  && r14.injections.length === 1
  && r14.injections[0].symbolId === 'W'
  && r14.injections[0].count === 3
  && r14.injections[0].addedDuring === 'freeSpins');

/* 15. emitCSS '' disabled / non-empty enabled */
const cssDis = emitAddedSymbolsInjectorCSS({ ...def, enabled: false });
const cssEn  = emitAddedSymbolsInjectorCSS(r3);
const cssAliasEn = emitCSS(r3);
t('15. CSS disabled = "" / enabled = non-empty string (contains .asi-injected-cell + @keyframes asi-pop)',
  cssDis === ''
  && typeof cssEn === 'string'
  && cssEn.length > 0
  && cssEn.includes('.asi-injected-cell')
  && cssEn.includes('@keyframes asi-pop')
  && cssEn.includes('prefers-reduced-motion')
  && cssAliasEn === cssEn);

/* 16. emitMarkup '' disabled / div enabled */
const mDis = emitAddedSymbolsInjectorMarkup({ ...def, enabled: false });
const mEn  = emitAddedSymbolsInjectorMarkup(r3);
const mAlias = emitMarkup(r3);
t('16. Markup disabled = "" / enabled = div',
  mDis === ''
  && typeof mEn === 'string'
  && mEn.length > 0
  && /^<div\b/.test(mEn)
  && mAlias === mEn);

/* 17. emitRuntime '' disabled / JS enabled */
const rtDis = emitAddedSymbolsInjectorRuntime({ ...def, enabled: false });
const rtEn  = emitAddedSymbolsInjectorRuntime(r3);
const rtAlias = emitRuntime(r3);
t('17. Runtime disabled = "" / enabled = JS string',
  rtDis === ''
  && typeof rtEn === 'string'
  && rtEn.length > 0
  && rtAlias === rtEn);

/* 18. Runtime exposes window.addedSymbolsAPI */
t('18. Runtime exposes window.addedSymbolsAPI',
  rtEn.includes('window.addedSymbolsAPI'));

/* 19. Runtime contains __ASI_WIRED__ */
t('19. Runtime idempotency flag __ASI_WIRED__',
  rtEn.includes('__ASI_WIRED__'));

/* 20. Runtime contains 'onSpinResult' hook subscription */
t('20. Runtime subscribes to onSpinResult hook',
  rtEn.includes("HookBus.on('onSpinResult'") || rtEn.includes('HookBus.on("onSpinResult"'));

/* 21. Runtime no eval / document.write / user innerHTML sinks */
const usesEval = /\beval\s*\(/.test(rtEn);
const usesDocWrite = /document\.write\s*\(/.test(rtEn);
const usesInnerHTMLAssign = /\.innerHTML\s*=/.test(rtEn);
t('21. Runtime no eval / document.write / innerHTML= sinks',
  !usesEval && !usesDocWrite && !usesInnerHTMLAssign);

/* 22. Source vendor-neutral */
const src = readFileSync(SRC_PATH, 'utf8');
const VENDORS = /\b(IGT|Pragmatic Play|Cash Eruption|Megaways|NetEnt|Microgaming|Hacksaw|Nolimit|Wazdan)\b/;
t('22. source vendor-neutral', !VENDORS.test(src));

/* 23. defaultConfig fresh frozen (not shared instances) */
const d1 = defaultConfig();
const d2 = defaultConfig();
t('23. defaultConfig returns fresh top-level frozen object each call',
  d1 !== d2 && Object.isFrozen(d1) && Object.isFrozen(d2)
  // shapes equal
  && d1.enabled === d2.enabled
  && d1.haloRGB === d2.haloRGB
  && d1.injectionMs === d2.injectionMs
  && d1.schemaVersion === d2.schemaVersion);

/* 24. schemaVersion stamped on resolveConfig output */
t('24. schemaVersion="1" stamped on resolveConfig output',
  r3.schemaVersion === '1'
  && r4.schemaVersion === '1'
  && r5.schemaVersion === '1');

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
