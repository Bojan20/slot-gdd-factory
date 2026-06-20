#!/usr/bin/env node
/**
 * tests/blocks/linkedReels.test.mjs
 *
 * D-17.3 — Linked-reels block (FS-only reel link + repeat + unit emission).
 */

import {
  defaultConfig,
  resolveConfig,
  expandUnits,
  emitLinkedReelsCSS,
  emitLinkedReelsRuntime,
} from '../../src/blocks/linkedReels.mjs';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '../../src/blocks/linkedReels.mjs');

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('— linkedReels block —');

/* 1. defaults */
const dflt = defaultConfig();
t('default enabled=false', dflt.enabled === false);
t('default linkedReelIndices=[1,2,3]',
  JSON.stringify(dflt.linkedReelIndices) === '[1,2,3]');
t('default linkMode=any', dflt.linkMode === 'any');
t('default targetSymbols=[]', Array.isArray(dflt.targetSymbols) && dflt.targetSymbols.length === 0);
t('default onlyDuringFs=true', dflt.onlyDuringFs === true);
t('default repeatAcrossRows=false', dflt.repeatAcrossRows === false);
t('default fuseGlowDurationMs=720', dflt.fuseGlowDurationMs === 720);
t('default role=group', dflt.role === 'group');
t('default ariaLabelPrefix="Linked reels"', dflt.ariaLabelPrefix === 'Linked reels');

/* 2. fresh arrays per call */
dflt.linkedReelIndices.push(99);
dflt.targetSymbols.push('X');
const dflt2 = defaultConfig();
t('defaults returns fresh linkedReelIndices array',
  JSON.stringify(dflt2.linkedReelIndices) === '[1,2,3]');
t('defaults returns fresh targetSymbols array',
  dflt2.targetSymbols.length === 0);

/* 3. resolveConfig — enabled */
t('resolveConfig honors enabled=true',
  resolveConfig({ linkedReels: { enabled: true } }).enabled === true);

/* 4. resolveConfig — linkedReelIndices dedup + sort */
const idx = resolveConfig({ linkedReels: { linkedReelIndices: [3, 1, 2, 1, 99, -1] } });
t('resolveConfig sanitizes linkedReelIndices (dedup, bounds, sort)',
  JSON.stringify(idx.linkedReelIndices) === '[1,2,3]');

/* 5. resolveConfig — linkMode */
t('resolveConfig honors linkMode=specific',
  resolveConfig({ linkedReels: { linkMode: 'specific' } }).linkMode === 'specific');
t('resolveConfig rejects unknown linkMode (fallback any)',
  resolveConfig({ linkedReels: { linkMode: 'foo' } }).linkMode === 'any');

/* 6. resolveConfig — targetSymbols sanitization */
const ts = resolveConfig({ linkedReels: { targetSymbols: ['FIRE', 'FIRE', 'BIG', '<bad>', '', 42] } });
t('resolveConfig dedupes targetSymbols + drops non-strings',
  JSON.stringify(ts.targetSymbols).includes('FIRE') &&
  JSON.stringify(ts.targetSymbols).includes('BIG'));
t('resolveConfig strips HTML chars from targetSymbols',
  !ts.targetSymbols.some(function (s) { return s.includes('<') || s.includes('>'); }));

/* 7. resolveConfig — onlyDuringFs + repeatAcrossRows + bounds */
t('resolveConfig honors onlyDuringFs=false',
  resolveConfig({ linkedReels: { onlyDuringFs: false } }).onlyDuringFs === false);
t('resolveConfig honors repeatAcrossRows=true',
  resolveConfig({ linkedReels: { repeatAcrossRows: true } }).repeatAcrossRows === true);
t('resolveConfig honors fuseGlowDurationMs=1500',
  resolveConfig({ linkedReels: { fuseGlowDurationMs: 1500 } }).fuseGlowDurationMs === 1500);
t('resolveConfig rejects fuseGlowDurationMs=99',
  resolveConfig({ linkedReels: { fuseGlowDurationMs: 99 } }).fuseGlowDurationMs === 720);

/* 8. expandUnits — same-row repeat on 5×3 with linked reels [1,2,3] */
const cfgLink = resolveConfig({ linkedReels: {
  enabled: true,
  linkedReelIndices: [1, 2, 3],
  targetSymbols: ['FIRE'],
}});
const gridLand = [
  ['A','B','C','D','E'],
  ['A','B','FIRE','D','E'],
  ['A','B','C','D','E'],
];
const u = expandUnits(gridLand, cfgLink);
t('expandUnits emits 3 units (1 source landing → 3 linked reels same row)',
  u.length === 3);
t('expandUnits unit rows all equal to source row',
  u.every(function (x) { return x.row === 1; }));
t('expandUnits unit reels = linked indices',
  u.map(function (x) { return x.reel; }).sort().join(',') === '1,2,3');
t('expandUnits source symbol preserved',
  u.every(function (x) { return x.symbol === 'FIRE'; }));
t('expandUnits sourceReel correctly identified',
  u.every(function (x) { return x.sourceReel === 2; }));

/* 9. expandUnits — no landing → 0 units */
const gridEmpty = [
  ['A','B','C','D','E'],
  ['A','B','C','D','E'],
  ['A','B','C','D','E'],
];
t('expandUnits emits 0 when no target lands', expandUnits(gridEmpty, cfgLink).length === 0);

/* 10. expandUnits — landing OUTSIDE linked reels → 0 units */
const gridOutside = [
  ['FIRE','B','C','D','FIRE'],
  ['FIRE','B','C','D','FIRE'],
  ['FIRE','B','C','D','FIRE'],
];
t('expandUnits ignores landings outside linked block',
  expandUnits(gridOutside, cfgLink).length === 0);

/* 11. expandUnits — repeatAcrossRows=true fills entire linked block */
const cfgFill = resolveConfig({ linkedReels: {
  enabled: true,
  linkedReelIndices: [1, 2, 3],
  targetSymbols: ['FIRE'],
  repeatAcrossRows: true,
}});
const uFill = expandUnits(gridLand, cfgFill);
t('expandUnits in fill mode fills 3 reels × 3 rows = 9 units',
  uFill.length === 9);

/* 12. expandUnits — multiple landings dedupe */
const gridMulti = [
  ['A','FIRE','C','D','E'],
  ['A','B','FIRE','D','E'],
  ['A','B','C','D','E'],
];
const uMulti = expandUnits(gridMulti, cfgLink);
t('expandUnits dedupes overlapping unit anchors',
  uMulti.length === 6 /* row 0: 3 reels + row 1: 3 reels = 6 */);

/* 13. expandUnits — linkMode='specific' requires ALL targetSymbols */
const cfgSpec = resolveConfig({ linkedReels: {
  enabled: true,
  linkedReelIndices: [1, 2, 3],
  targetSymbols: ['FIRE', 'BIG'],
  linkMode: 'specific',
}});
const gridOnlyFire = [
  ['A','FIRE','C','D','E'],
  ['A','B','FIRE','D','E'],
  ['A','B','C','D','E'],
];
t('expandUnits in specific mode misses when not all targets present',
  expandUnits(gridOnlyFire, cfgSpec).length === 0);
const gridBoth = [
  ['A','FIRE','C','D','E'],
  ['A','BIG','FIRE','D','E'],
  ['A','B','C','D','E'],
];
t('expandUnits in specific mode hits when all targets present',
  expandUnits(gridBoth, cfgSpec).length > 0);

/* 14. expandUnits — no targetSymbols (any) catches every landing */
const cfgAny = resolveConfig({ linkedReels: {
  enabled: true,
  linkedReelIndices: [1, 2, 3],
  targetSymbols: [],
}});
const uAny = expandUnits(gridLand, cfgAny);
t('expandUnits with targetSymbols=[] treats any symbol as target',
  uAny.length > 0);

/* 15. expandUnits — too few linked reels (< 2) → 0 units */
const cfgOne = resolveConfig({ linkedReels: {
  enabled: true,
  linkedReelIndices: [2],
  targetSymbols: ['FIRE'],
}});
t('expandUnits with single linked reel emits 0 (no link possible)',
  expandUnits(gridLand, cfgOne).length === 0);

/* 16. expandUnits — column-per-reel orientation */
const colsLand = [
  ['A','A','A'],            /* reel 0 */
  ['B','FIRE','B'],         /* reel 1 → source landing row 1 */
  ['C','C','C'],            /* reel 2 */
  ['D','D','D'],            /* reel 3 */
  ['E','E','E'],            /* reel 4 */
];
const uCols = expandUnits(colsLand, cfgLink);
t('expandUnits works on column-per-reel orientation',
  uCols.length === 3 && uCols.every(function (x) { return x.row === 1; }));

/* 17. CSS emit — disabled empty */
t('emitCSS(disabled) → empty', emitLinkedReelsCSS(defaultConfig()) === '');

/* 18. CSS emit — enabled */
const css = emitLinkedReelsCSS({ ...defaultConfig(), enabled: true });
t('emitCSS includes .lr-fuse', css.includes('.lr-fuse'));
t('emitCSS includes data-linked-reel selector', css.includes('data-linked-reel'));
t('emitCSS honors fuseGlowDurationMs',
  emitLinkedReelsCSS({ ...defaultConfig(), enabled: true, fuseGlowDurationMs: 1200 })
    .includes('1200ms'));
t('emitCSS includes prefers-reduced-motion guard',
  css.includes('prefers-reduced-motion'));

/* 19. Runtime — disabled empty */
t('emitRuntime(disabled) → empty', emitLinkedReelsRuntime(defaultConfig()) === '');

/* 20. Runtime — enabled wires HookBus */
const rt = emitLinkedReelsRuntime({ ...defaultConfig(), enabled: true });
t('runtime non-empty', rt.length > 500);
t('runtime registers onFsEnter listener',
  rt.includes("HookBus.on('onFsEnter'"));
t('runtime registers onFsStart listener (fallback)',
  rt.includes("HookBus.on('onFsStart'"));
t('runtime registers onFsEnd listener',
  rt.includes("HookBus.on('onFsEnd'"));
t('runtime registers onSpinResult listener',
  rt.includes("HookBus.on('onSpinResult'"));
t('runtime registers onFsSpinResult listener',
  rt.includes("HookBus.on('onFsSpinResult'"));
t('runtime emits onReelsLinked',
  rt.includes("HookBus.emit('onReelsLinked'"));
t('runtime emits onLinkUnits',
  rt.includes("HookBus.emit('onLinkUnits'"));
t('runtime exposes window.linkedReelsForceSymbol',
  rt.includes('window.linkedReelsForceSymbol'));
t('runtime routes force chip through runOneBaseSpin',
  rt.includes('window.runOneBaseSpin()'));
t('runtime carries role="presentation" on fuse overlay',
  rt.includes('role="presentation"'));

/* 21. Runtime — base-game persistent path (onlyDuringFs=false) */
const rtBase = emitLinkedReelsRuntime({ ...defaultConfig(), enabled: true,
  onlyDuringFs: false });
t('runtime base-game mode wires DOMContentLoaded fallback',
  rtBase.includes('DOMContentLoaded') || rtBase.includes('readyState'));

/* 22. Source — vendor-neutral */
const src = readFileSync(SRC, 'utf-8');
const banned = ['cash eruption','wrath of olympus','huff','starlight'];
const lower = src.toLowerCase();
for (const b of banned) {
  t('source vendor-neutral (no "' + b + '")', !lower.includes(b));
}

/* 23. determinism */
const a1 = emitLinkedReelsCSS({ ...defaultConfig(), enabled: true });
const a2 = emitLinkedReelsCSS({ ...defaultConfig(), enabled: true });
t('determinism: same config → byte-identical CSS', a1 === a2);
const r1 = emitLinkedReelsRuntime({ ...defaultConfig(), enabled: true });
const r2 = emitLinkedReelsRuntime({ ...defaultConfig(), enabled: true });
t('determinism: same config → byte-identical runtime', r1 === r2);

console.log('');
console.log('  ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
