#!/usr/bin/env node
/**
 * tests/blocks/potSymbolFireball.test.mjs
 *
 * D-17.5 — Pot-tier Fireball symbol classifier + value tag test.
 */

import {
  defaultConfig,
  resolveConfig,
  classifyCell,
  sumLandings,
  emitPotSymbolFireballCSS,
  emitPotSymbolFireballRuntime,
} from '../../src/blocks/potSymbolFireball.mjs';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '../../src/blocks/potSymbolFireball.mjs');

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('— potSymbolFireball block —');

/* 1. defaults */
const dflt = defaultConfig();
t('default enabled=false', dflt.enabled === false);
t('default potTiers=[MINI,MINOR,MAJOR]',
  JSON.stringify(dflt.potTiers) === '["MINI","MINOR","MAJOR"]');
t('default potValues MINI=100',  dflt.potValues.MINI  === 100);
t('default potValues MINOR=500', dflt.potValues.MINOR === 500);
t('default potValues MAJOR=2000',dflt.potValues.MAJOR === 2000);
t('default symbolPrefix=POT_',   dflt.symbolPrefix === 'POT_');
t('default role=img',            dflt.role === 'img');
t('default ariaLabelPrefix="Pot symbol"',
  dflt.ariaLabelPrefix === 'Pot symbol');
t('default shimmerDurationMs=900', dflt.shimmerDurationMs === 900);

/* 2. fresh arrays per call */
dflt.potTiers.push('X');
dflt.potValues.MINI = 999;
const dflt2 = defaultConfig();
t('defaults returns fresh potTiers array',
  JSON.stringify(dflt2.potTiers) === '["MINI","MINOR","MAJOR"]');
t('defaults returns fresh potValues object', dflt2.potValues.MINI === 100);

/* 3. resolveConfig — enabled */
t('resolveConfig honors enabled=true',
  resolveConfig({ potSymbolFireball: { enabled: true } }).enabled === true);

/* 4. resolveConfig — custom tiers + values */
const cust = resolveConfig({ potSymbolFireball: {
  potTiers: ['SMALL', 'BIG', 'HUGE'],
  potValues: { SMALL: 50, BIG: 750, HUGE: 5000 },
}});
t('resolveConfig honors custom tiers',
  JSON.stringify(cust.potTiers) === '["SMALL","BIG","HUGE"]');
t('resolveConfig honors custom values',
  cust.potValues.SMALL === 50 && cust.potValues.HUGE === 5000);

/* 5. resolveConfig — partial custom values fill missing from defaults */
const part = resolveConfig({ potSymbolFireball: {
  potValues: { MINI: 250 },
}});
t('resolveConfig honors partial custom values',  part.potValues.MINI === 250);
t('resolveConfig fills missing values from defaults',
  part.potValues.MINOR === 500 && part.potValues.MAJOR === 2000);

/* 6. resolveConfig — bad values dropped */
const dirty = resolveConfig({ potSymbolFireball: {
  potValues: { MINI: 'bad', MINOR: -1, MAJOR: NaN },
}});
t('resolveConfig falls back to defaults when all values bad',
  dirty.potValues.MINI === 100 && dirty.potValues.MAJOR === 2000);

/* 7. resolveConfig — custom tiers without DEFAULT_VALUES match → 0 */
const noDef = resolveConfig({ potSymbolFireball: {
  potTiers: ['ALPHA', 'BETA'],
}});
t('resolveConfig fills 0 for custom tiers without defaults',
  noDef.potValues.ALPHA === 0 && noDef.potValues.BETA === 0);

/* 8. resolveConfig — bounds */
t('resolveConfig honors shimmerDurationMs=1500',
  resolveConfig({ potSymbolFireball: { shimmerDurationMs: 1500 } }).shimmerDurationMs === 1500);
t('resolveConfig rejects shimmerDurationMs out of bounds',
  resolveConfig({ potSymbolFireball: { shimmerDurationMs: 99 } }).shimmerDurationMs === 900);

/* 9. resolveConfig — themeClass + ARIA strip */
const safeTheme = resolveConfig({ potSymbolFireball: { themeClass: 'foundry_42' } });
t('resolveConfig honors safe themeClass', safeTheme.themeClass === 'foundry_42');
const themeBad = resolveConfig({ potSymbolFireball: { themeClass: 'foo<x>bar' } });
t('resolveConfig strips unsafe chars from themeClass',
  themeBad.themeClass === 'fooxbar' || themeBad.themeClass === 'foobar');

/* 10. classifyCell — bare tier strings */
const c = resolveConfig({ potSymbolFireball: { enabled: true } });
const r1 = classifyCell('MINI', c);
t('classifyCell bare MINI → MINI/100',
  r1 && r1.tier === 'MINI' && r1.credits === 100);
const r2 = classifyCell('major', c);
t('classifyCell case-insens "major" → MAJOR/2000',
  r2 && r2.tier === 'MAJOR' && r2.credits === 2000);

/* 11. classifyCell — prefix + tier */
const r3 = classifyCell('POT_MINOR', c);
t('classifyCell POT_MINOR → MINOR/500',
  r3 && r3.tier === 'MINOR' && r3.credits === 500);
const r4 = classifyCell('pot_minor', c);
t('classifyCell case-insens pot_minor → MINOR/500',
  r4 && r4.tier === 'MINOR' && r4.credits === 500);

/* 12. classifyCell — engine-tagged cell */
const r5 = classifyCell({ __pot__: { tier: 'MAJOR' } }, c);
t('classifyCell engine-tagged MAJOR → MAJOR/2000 (default value)',
  r5 && r5.tier === 'MAJOR' && r5.credits === 2000);
const r6 = classifyCell({ __pot__: { tier: 'MINI', credits: 9999 } }, c);
t('classifyCell engine-tagged custom credits override',
  r6 && r6.tier === 'MINI' && r6.credits === 9999);

/* 13. classifyCell — non-pot cells */
t('classifyCell ordinary symbol → null', classifyCell('RED7', c) === null);
t('classifyCell empty string → null',     classifyCell('', c) === null);
t('classifyCell null → null',             classifyCell(null, c) === null);
t('classifyCell number → null',           classifyCell(42, c) === null);
t('classifyCell tag with bad tier → null',
  classifyCell({ __pot__: { tier: 'NOPE' } }, c) === null);
t('classifyCell tag with non-string tier → null',
  classifyCell({ __pot__: { tier: 42 } }, c) === null);

/* 14. classifyCell — empty tiers (direct config) → null */
const cEmpty = { ...defaultConfig(), enabled: true, potTiers: [] };
t('classifyCell with empty tiers (direct cfg) → null',
  classifyCell('MINI', cEmpty) === null);
/* resolveConfig safely refuses to make tiers empty (falls back to defaults) */
t('resolveConfig falls back to defaults when potTiers=[] sent',
  JSON.stringify(resolveConfig({ potSymbolFireball: { potTiers: [] }}).potTiers) === '["MINI","MINOR","MAJOR"]');

/* 15. sumLandings */
t('sumLandings empty array → 0', sumLandings([]) === 0);
t('sumLandings null → 0',         sumLandings(null) === 0);
t('sumLandings sums credits',
  sumLandings([{ credits: 100 }, { credits: 500 }, { credits: 2000 }]) === 2600);
t('sumLandings ignores bad entries',
  sumLandings([{ credits: 100 }, null, { credits: 'bad' }, { foo: 1 }, { credits: 50 }]) === 150);

/* 16. CSS emit — disabled */
t('emitCSS(disabled) → empty', emitPotSymbolFireballCSS(defaultConfig()) === '');

/* 17. CSS emit — enabled */
const css = emitPotSymbolFireballCSS({ ...defaultConfig(), enabled: true,
  potTiers: ['MINI','MINOR','MAJOR'],
  potValues: { MINI: 100, MINOR: 500, MAJOR: 2000 }});
t('emitCSS includes .pot-tag', css.includes('.pot-tag'));
t('emitCSS includes data-pot-tier selector', css.includes('data-pot-tier'));
t('emitCSS includes MINI/MINOR/MAJOR brightness tiers',
  css.includes('data-pot-tier="MINI"') && css.includes('data-pot-tier="MAJOR"'));
t('emitCSS honors shimmerDurationMs',
  emitPotSymbolFireballCSS({ ...defaultConfig(), enabled: true, shimmerDurationMs: 1500,
    potTiers: ['MINI'], potValues: { MINI: 100 }}).includes('1500ms'));
t('emitCSS includes prefers-reduced-motion guard',
  css.includes('prefers-reduced-motion'));

/* 18. Runtime — disabled */
t('emitRuntime(disabled) → empty', emitPotSymbolFireballRuntime(defaultConfig()) === '');

/* 19. Runtime — enabled wires HookBus */
const rt = emitPotSymbolFireballRuntime({ ...defaultConfig(), enabled: true,
  potTiers: ['MINI','MINOR','MAJOR'],
  potValues: { MINI: 100, MINOR: 500, MAJOR: 2000 }});
t('runtime non-empty', rt.length > 500);
t('runtime registers onHoldAndWinTrigger listener',
  rt.includes("HookBus.on('onHoldAndWinTrigger'"));
t('runtime registers onSpinResult listener',
  rt.includes("HookBus.on('onSpinResult'"));
t('runtime registers onFsSpinResult listener',
  rt.includes("HookBus.on('onFsSpinResult'"));
t('runtime registers onHoldAndWinEnd listener',
  rt.includes("HookBus.on('onHoldAndWinEnd'"));
t('runtime emits onPotSymbolLanded',
  rt.includes("HookBus.emit('onPotSymbolLanded'"));
t('runtime emits onPotSymbolCollected',
  rt.includes("HookBus.emit('onPotSymbolCollected'"));
t('runtime exposes window.potSymbolFireballForce',
  rt.includes('window.potSymbolFireballForce'));
t('runtime exposes window.potSymbolFireballGetCollected getter',
  rt.includes('window.potSymbolFireballGetCollected'));
t('runtime sets __FORCE_POT_SYMBOL__ flag',
  rt.includes('window.__FORCE_POT_SYMBOL__'));
t('runtime routes force chip through runOneBaseSpin',
  rt.includes('window.runOneBaseSpin()'));
t('runtime carries role="img" baseline a11y',
  rt.includes('role="img"'));

/* 20. Source — vendor-neutral */
const src = readFileSync(SRC, 'utf-8');
const banned = ['cash eruption','wrath of olympus','huff','starlight'];
const lower = src.toLowerCase();
for (const b of banned) {
  t('source vendor-neutral (no "' + b + '")', !lower.includes(b));
}

/* 21. determinism */
const a1 = emitPotSymbolFireballCSS({ ...defaultConfig(), enabled: true,
  potTiers: ['MINI'], potValues: { MINI: 100 }});
const a2 = emitPotSymbolFireballCSS({ ...defaultConfig(), enabled: true,
  potTiers: ['MINI'], potValues: { MINI: 100 }});
t('determinism: same config → byte-identical CSS', a1 === a2);
const rA = emitPotSymbolFireballRuntime({ ...defaultConfig(), enabled: true,
  potTiers: ['MINI'], potValues: { MINI: 100 }});
const rB = emitPotSymbolFireballRuntime({ ...defaultConfig(), enabled: true,
  potTiers: ['MINI'], potValues: { MINI: 100 }});
t('determinism: same config → byte-identical runtime', rA === rB);

console.log('');
console.log('  ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
