#!/usr/bin/env node
/**
 * tests/blocks/bigSymbolRender2x2.test.mjs
 *
 * D-17.2 — Big-Symbol render + UNIT-count gate test.
 */

import {
  defaultConfig,
  resolveConfig,
  findBigSymbolFootprints,
  countUnits,
  emitBigSymbolRender2x2CSS,
  emitBigSymbolRender2x2Runtime,
} from '../../src/blocks/bigSymbolRender2x2.mjs';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '../../src/blocks/bigSymbolRender2x2.mjs');

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('— bigSymbolRender2x2 block —');

/* 1. defaults */
const dflt = defaultConfig();
t('default enabled=false (opt-in)', dflt.enabled === false);
t('default bigSymbolKinds=[]', Array.isArray(dflt.bigSymbolKinds) && dflt.bigSymbolKinds.length === 0);
t('default countMode=units', dflt.countMode === 'units');
t('default role=img', dflt.role === 'img');
t('default ariaLabelPrefix=Big', dflt.ariaLabelPrefix === 'Big');
t('default mountTransitionMs=320', dflt.mountTransitionMs === 320);
t('default zIndex=60', dflt.zIndex === 60);

/* 2. fresh array per defaults call */
dflt.bigSymbolKinds.push({ symbol: 'X', geometry: '2x2' });
const dflt2 = defaultConfig();
t('defaults returns fresh bigSymbolKinds array (no mutation leak)',
  dflt2.bigSymbolKinds.length === 0);

/* 3. resolveConfig — enabled toggle */
t('resolveConfig honors enabled=true',
  resolveConfig({ bigSymbolRender2x2: { enabled: true } }).enabled === true);

/* 4. resolveConfig — valid kinds */
const validCfg = resolveConfig({ bigSymbolRender2x2: {
  enabled: true,
  bigSymbolKinds: [
    { symbol: 'FIRE', geometry: '2x2' },
    { symbol: 'WILD', geometry: '3h'  },
    { symbol: 'MYSTERY', geometry: 'fullReel' },
  ],
}});
t('resolveConfig honors valid kinds (3 entries)',
  validCfg.bigSymbolKinds.length === 3);
t('resolveConfig preserves symbol+geometry per entry',
  validCfg.bigSymbolKinds[0].symbol === 'FIRE' &&
  validCfg.bigSymbolKinds[0].geometry === '2x2');

/* 5. resolveConfig — bad kinds dropped */
const dirtyCfg = resolveConfig({ bigSymbolRender2x2: {
  bigSymbolKinds: [
    { symbol: 'FIRE', geometry: '2x2' },
    null,                                            /* dropped */
    'not-an-object',                                 /* dropped */
    { symbol: '',     geometry: '2x2' },             /* empty sym dropped */
    { symbol: 'WILD', geometry: 'unknown' },         /* bad geo dropped */
    { symbol: 'FIRE', geometry: '2x2' },             /* dup dropped */
  ],
}});
t('resolveConfig drops bad kind entries (only FIRE/2x2 remains)',
  dirtyCfg.bigSymbolKinds.length === 1 &&
  dirtyCfg.bigSymbolKinds[0].symbol === 'FIRE');

/* 6. resolveConfig — countMode */
t('resolveConfig honors countMode=cells',
  resolveConfig({ bigSymbolRender2x2: { countMode: 'cells' } }).countMode === 'cells');
t('resolveConfig rejects countMode=garbage (fallback units)',
  resolveConfig({ bigSymbolRender2x2: { countMode: 'foo' } }).countMode === 'units');

/* 7. resolveConfig — bounds */
t('resolveConfig honors mountTransitionMs=600',
  resolveConfig({ bigSymbolRender2x2: { mountTransitionMs: 600 } }).mountTransitionMs === 600);
t('resolveConfig rejects mountTransitionMs out of bounds',
  resolveConfig({ bigSymbolRender2x2: { mountTransitionMs: 9999 } }).mountTransitionMs === 320);
t('resolveConfig honors zIndex=120',
  resolveConfig({ bigSymbolRender2x2: { zIndex: 120 } }).zIndex === 120);
t('resolveConfig rejects zIndex=99999',
  resolveConfig({ bigSymbolRender2x2: { zIndex: 99999 } }).zIndex === 60);

/* 8. resolveConfig — theme + ARIA safe-chars */
const themeCfg = resolveConfig({ bigSymbolRender2x2: { themeClass: 'foundry-theme_42' } });
t('resolveConfig honors safe themeClass', themeCfg.themeClass === 'foundry-theme_42');
const themeBad = resolveConfig({ bigSymbolRender2x2: { themeClass: 'foo<bar>baz' } });
t('resolveConfig strips unsafe chars from themeClass',
  themeBad.themeClass === 'foobarbaz' || themeBad.themeClass === 'foobaz');

/* 9. findBigSymbolFootprints — 5×3 row-major, single 2×2 FIRE at reel 1 row 1 */
const cfgFire = resolveConfig({ bigSymbolRender2x2: {
  enabled: true,
  bigSymbolKinds: [{ symbol: 'FIRE', geometry: '2x2' }],
}});
const gridSingle = [
  ['A','A','B','C','D'],
  ['A','FIRE','FIRE','C','D'],
  ['A','FIRE','FIRE','C','D'],
];
const fps1 = findBigSymbolFootprints(gridSingle, cfgFire);
t('finds single 2×2 footprint', fps1.length === 1);
t('footprint anchor at reel 1 row 1',
  fps1[0].anchorReel === 1 && fps1[0].anchorRow === 1);
t('footprint cells = 4', fps1[0].footprint.length === 4);

/* 10. countUnits — units vs cells mode */
t('countUnits returns 1 unit', countUnits(gridSingle, cfgFire) === 1);
const cfgCells = resolveConfig({ bigSymbolRender2x2: {
  enabled: true,
  bigSymbolKinds: [{ symbol: 'FIRE', geometry: '2x2' }],
  countMode: 'cells',
}});
t('countUnits in cells mode returns 4 cells',
  countUnits(gridSingle, cfgCells) === 4);

/* 11. findBigSymbolFootprints — multiple 2×2 FIRE on 6×4 */
const grid64 = [
  ['FIRE','FIRE','B','C','D','E'],
  ['FIRE','FIRE','B','FIRE','FIRE','E'],
  ['A',   'B',   'C','FIRE','FIRE','E'],
  ['A',   'B',   'C','D',   'E',   'F'],
];
const fps2 = findBigSymbolFootprints(grid64, cfgFire);
t('finds 2 separate 2×2 footprints on 6×4', fps2.length === 2);
t('countUnits 2 units on 6×4 grid', countUnits(grid64, cfgFire) === 2);
t('countUnits 8 cells in cells mode on 6×4',
  countUnits(grid64, cfgCells) === 8);

/* 12. findBigSymbolFootprints — 3-high WILD */
const cfgWild = resolveConfig({ bigSymbolRender2x2: {
  enabled: true,
  bigSymbolKinds: [{ symbol: 'WILD', geometry: '3h' }],
}});
const gridWild3h = [
  ['A','WILD','B','WILD','D'],
  ['A','WILD','B','WILD','D'],
  ['A','WILD','B','WILD','D'],
];
const fps3 = findBigSymbolFootprints(gridWild3h, cfgWild);
t('finds 2 separate 3-high WILD footprints',
  fps3.length === 2 && fps3.every(f => f.geometry === '3h'));

/* 13. findBigSymbolFootprints — fullReel */
const cfgFull = resolveConfig({ bigSymbolRender2x2: {
  enabled: true,
  bigSymbolKinds: [{ symbol: 'MEGA', geometry: 'fullReel' }],
}});
const gridFull = [
  ['MEGA','A','B','C','D'],
  ['MEGA','A','B','C','D'],
  ['MEGA','A','B','C','D'],
  ['MEGA','A','B','C','D'],
];
const fps4 = findBigSymbolFootprints(gridFull, cfgFull);
t('finds fullReel footprint spanning all 4 rows',
  fps4.length === 1 && fps4[0].footprint.length === 4);

/* 14. findBigSymbolFootprints — engine-tag path */
const gridTagged = [
  ['A','A','B'],
  ['A',{ __big__: { symbol: 'FIRE', geometry: '2x2' } }, 'B'],
  ['A','C','B'],
];
/* In the tagged path, the anchor cell carries the tag; the block trusts
 * the engine for footprint extent. Provide a grid wide enough for 2x2.
 */
const grid3x3Tag = [
  ['A','A','B'],
  ['A',{ __big__: { symbol: 'FIRE', geometry: '2x2' } }, { __big__: {} }],
  ['A','C','B'],
];
/* Use a wider tagged grid that satisfies the 2x2 footprint */
const wideTag = [
  ['A','A','B','C','D'],
  ['A', { __big__: { symbol: 'FIRE', geometry: '2x2' } }, 'X', 'C', 'D'],
  ['A', 'X', 'X', 'C', 'D'],
];
const fpsTag = findBigSymbolFootprints(wideTag, cfgFire);
t('finds engine-tagged big symbol footprint',
  fpsTag.length === 1 && fpsTag[0].symbol === 'FIRE' && fpsTag[0].geometry === '2x2');

/* 15. findBigSymbolFootprints — empty kinds → empty result */
t('finds nothing when bigSymbolKinds empty',
  findBigSymbolFootprints(gridSingle, defaultConfig()).length === 0);

/* 16. findBigSymbolFootprints — out-of-bounds 2×2 at right edge */
const gridEdge = [
  ['A','B','C','D','FIRE'],
  ['A','B','C','D','FIRE'],
  ['A','B','C','D','FIRE'],
];
/* 2×2 needs 2 reels; FIRE only on reel 4 → no valid 2×2 footprint */
t('rejects 2×2 footprint out of grid bounds (right edge)',
  findBigSymbolFootprints(gridEdge, cfgFire).length === 0);

/* 17. CSS emit — disabled empty */
t('emitCSS(disabled) → empty', emitBigSymbolRender2x2CSS(defaultConfig()) === '');

/* 18. CSS emit — enabled contains all selectors */
const css = emitBigSymbolRender2x2CSS({ ...defaultConfig(), enabled: true,
  bigSymbolKinds: [{ symbol: 'FIRE', geometry: '2x2' }] });
t('emitCSS includes .bsr-host', css.includes('.bsr-host'));
t('emitCSS includes .bsr-art',  css.includes('.bsr-art'));
t('emitCSS includes data-geometry=2x2 rule',
  css.includes('data-geometry="2x2"'));
t('emitCSS honors mountTransitionMs',
  emitBigSymbolRender2x2CSS({ ...defaultConfig(), enabled: true, mountTransitionMs: 480,
    bigSymbolKinds: [{ symbol: 'FIRE', geometry: '2x2' }] }).includes('480ms'));
t('emitCSS includes prefers-reduced-motion guard',
  css.includes('prefers-reduced-motion'));

/* 19. Runtime — disabled empty */
t('emitRuntime(disabled) → empty', emitBigSymbolRender2x2Runtime(defaultConfig()) === '');

/* 20. Runtime — enabled wires HookBus + DOM */
const rt = emitBigSymbolRender2x2Runtime({ ...defaultConfig(), enabled: true,
  bigSymbolKinds: [{ symbol: 'FIRE', geometry: '2x2' }] });
t('runtime non-empty', rt.length > 500);
t('runtime registers preSpin listener (unmount)',
  rt.includes("HookBus.on('preSpin'"));
t('runtime registers onSpinResult listener',
  rt.includes("HookBus.on('onSpinResult'"));
t('runtime registers onFsSpinResult listener',
  rt.includes("HookBus.on('onFsSpinResult'"));
t('runtime registers onTumbleStep listener',
  rt.includes("HookBus.on('onTumbleStep'"));
t('runtime emits onBigSymbolMounted',
  rt.includes("HookBus.emit('onBigSymbolMounted'"));
t('runtime emits onBigSymbolUnmounted',
  rt.includes("HookBus.emit('onBigSymbolUnmounted'"));
t('runtime exposes window.bigSymbolForceAt force chip',
  rt.includes('window.bigSymbolForceAt'));
t('runtime sets __FORCE_BIG_SYMBOL__ flag from force chip',
  rt.includes('window.__FORCE_BIG_SYMBOL__'));
t('runtime routes force chip through runOneBaseSpin (rule_force_buttons_real_spin)',
  rt.includes('window.runOneBaseSpin()'));
t('runtime exposes window.bigSymbolCountUnits helper',
  rt.includes('window.bigSymbolCountUnits'));
t('runtime carries role="img" baseline a11y',
  rt.includes('role="img"'));

/* 21. Source — vendor-neutral */
const src = readFileSync(SRC, 'utf-8');
const banned = ['cash eruption','wrath of olympus','huff','starlight'];
const lower = src.toLowerCase();
for (const b of banned) {
  t('source vendor-neutral (no "' + b + '")', !lower.includes(b));
}

/* 22. determinism */
const a1 = emitBigSymbolRender2x2CSS({ ...defaultConfig(), enabled: true,
  bigSymbolKinds: [{ symbol: 'FIRE', geometry: '2x2' }] });
const a2 = emitBigSymbolRender2x2CSS({ ...defaultConfig(), enabled: true,
  bigSymbolKinds: [{ symbol: 'FIRE', geometry: '2x2' }] });
t('determinism: same config → byte-identical CSS', a1 === a2);
const r1 = emitBigSymbolRender2x2Runtime({ ...defaultConfig(), enabled: true,
  bigSymbolKinds: [{ symbol: 'FIRE', geometry: '2x2' }] });
const r2 = emitBigSymbolRender2x2Runtime({ ...defaultConfig(), enabled: true,
  bigSymbolKinds: [{ symbol: 'FIRE', geometry: '2x2' }] });
t('determinism: same config → byte-identical runtime', r1 === r2);

console.log('');
console.log('  ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
