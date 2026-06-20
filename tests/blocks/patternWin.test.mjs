#!/usr/bin/env node
/**
 * tests/blocks/patternWin.test.mjs
 *
 * D-17.1 — Pattern-Win block test (Foundry-family gap closure).
 * Validates detector, defaults, sanitizers, CSS/runtime emit,
 * vendor-neutral source, replace-not-stack signal contract, and
 * a11y output.
 */

import {
  defaultConfig,
  resolveConfig,
  detectPattern,
  emitPatternWinCSS,
  emitPatternWinRuntime,
} from '../../src/blocks/patternWin.mjs';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '../../src/blocks/patternWin.mjs');

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('— patternWin block —');

/* 1. defaults */
const dflt = defaultConfig();
t('default enabled=false (opt-in only)', dflt.enabled === false);
t('default anchorReel=0', dflt.anchorReel === 0);
t('default anchorSymbol="" (auto)', dflt.anchorSymbol === '');
t('default anchorStackHeight=3', dflt.anchorStackHeight === 3);
t('default winReels=[1,2,3,4]', JSON.stringify(dflt.winReels) === '[1,2,3,4]');
t('default wildSymbol=WILD', dflt.wildSymbol === 'WILD');
t('default payX=1000', dflt.payX === 1000);
t('default replaceLineTally=true', dflt.replaceLineTally === true);
t('default celebrationLabel="PATTERN WIN"', dflt.celebrationLabel === 'PATTERN WIN');
t('default celebrationDurationMs=1800', dflt.celebrationDurationMs === 1800);
t('default role=status', dflt.role === 'status');
t('default ariaLabelPrefix="Pattern win"', dflt.ariaLabelPrefix === 'Pattern win');

/* 2. defaults returns fresh winReels array */
dflt.winReels.push(99);
const dflt2 = defaultConfig();
t('defaults returns fresh winReels array (no mutation leak)',
  JSON.stringify(dflt2.winReels) === '[1,2,3,4]');

/* 3. resolveConfig — enabled */
const en = resolveConfig({ patternWin: { enabled: true } });
t('resolveConfig honors enabled=true', en.enabled === true);

/* 4. resolveConfig — anchorReel clamp */
const ar = resolveConfig({ patternWin: { anchorReel: 4 } });
t('resolveConfig honors anchorReel=4', ar.anchorReel === 4);
const arOut = resolveConfig({ patternWin: { anchorReel: 99 } });
t('resolveConfig rejects anchorReel out of bounds', arOut.anchorReel === 0);
const arNeg = resolveConfig({ patternWin: { anchorReel: -1 } });
t('resolveConfig rejects negative anchorReel', arNeg.anchorReel === 0);

/* 5. resolveConfig — anchorStackHeight bounds */
const ash = resolveConfig({ patternWin: { anchorStackHeight: 5 } });
t('resolveConfig honors anchorStackHeight=5', ash.anchorStackHeight === 5);
const ashOut = resolveConfig({ patternWin: { anchorStackHeight: 100 } });
t('resolveConfig rejects anchorStackHeight=100', ashOut.anchorStackHeight === 3);

/* 6. resolveConfig — winReels sanitization */
const wr = resolveConfig({ patternWin: { winReels: [2, 3] } });
t('resolveConfig honors custom winReels', JSON.stringify(wr.winReels) === '[2,3]');
const wrDirty = resolveConfig({ patternWin: { winReels: [1, 2, 'bad', -1, 99, 3] } });
t('resolveConfig sanitizes winReels (drop bad)',
  JSON.stringify(wrDirty.winReels) === '[1,2,3]');
const wrDup = resolveConfig({ patternWin: { winReels: [1, 1, 2, 2] } });
t('resolveConfig dedupes winReels', JSON.stringify(wrDup.winReels) === '[1,2]');

/* 7. resolveConfig — anchorSymbol + wildSymbol */
const sym = resolveConfig({ patternWin: { anchorSymbol: 'RED7', wildSymbol: 'W' } });
t('resolveConfig honors anchorSymbol', sym.anchorSymbol === 'RED7');
t('resolveConfig honors wildSymbol', sym.wildSymbol === 'W');
const symHtml = resolveConfig({ patternWin: { anchorSymbol: 'RED7<script>' } });
t('resolveConfig strips HTML/control chars from anchorSymbol',
  symHtml.anchorSymbol === 'RED7script');

/* 8. resolveConfig — payX bounds */
const pay = resolveConfig({ patternWin: { payX: 2500 } });
t('resolveConfig honors payX=2500', pay.payX === 2500);
const payZero = resolveConfig({ patternWin: { payX: 0 } });
t('resolveConfig rejects payX=0', payZero.payX === 1000);
const payHuge = resolveConfig({ patternWin: { payX: 1000000 } });
t('resolveConfig rejects payX=1M', payHuge.payX === 1000);

/* 9. resolveConfig — replaceLineTally */
const repl = resolveConfig({ patternWin: { replaceLineTally: false } });
t('resolveConfig honors replaceLineTally=false', repl.replaceLineTally === false);

/* 10. resolveConfig — celebration duration bounds */
const dur = resolveConfig({ patternWin: { celebrationDurationMs: 2400 } });
t('resolveConfig honors celebrationDurationMs=2400', dur.celebrationDurationMs === 2400);
const durOut = resolveConfig({ patternWin: { celebrationDurationMs: 99 } });
t('resolveConfig rejects celebrationDurationMs=99', durOut.celebrationDurationMs === 1800);

/* 11. resolveConfig — themeClass strip non-safe chars */
const theme = resolveConfig({ patternWin: { themeClass: 'foundry-theme_42' } });
t('resolveConfig honors safe themeClass', theme.themeClass === 'foundry-theme_42');
const themeBad = resolveConfig({ patternWin: { themeClass: 'foo<bar>baz' } });
t('resolveConfig strips unsafe chars from themeClass',
  themeBad.themeClass === 'foobarbaz' || themeBad.themeClass === 'foobaz');

/* 12. detectPattern — row-major hit (5×3, anchor=RED7 stack reel 0, WILDs reels 1-4) */
const gridHit = [
  ['RED7','WILD','WILD','WILD','WILD'],
  ['RED7','WILD','WILD','WILD','WILD'],
  ['RED7','WILD','WILD','WILD','WILD'],
];
const cfgHit = resolveConfig({ patternWin: {
  enabled: true, anchorSymbol: 'RED7', wildSymbol: 'WILD',
  anchorReel: 0, anchorStackHeight: 3, winReels: [1, 2, 3, 4],
}});
const detHit = detectPattern(gridHit, cfgHit);
t('detectPattern hits row-major 5×3 full anchor stack + wilds', detHit.hit === true);
t('detectPattern anchor info correct',
  detHit.anchor && detHit.anchor.reel === 0 && detHit.anchor.symbol === 'RED7' && detHit.anchor.height === 3);

/* 13. detectPattern — miss (no anchor stack) */
const gridMissAnchor = [
  ['RED7','WILD','WILD','WILD','WILD'],
  ['BLUE','WILD','WILD','WILD','WILD'],
  ['RED7','WILD','WILD','WILD','WILD'],
];
t('detectPattern misses when anchor stack broken',
  detectPattern(gridMissAnchor, cfgHit).hit === false);

/* 14. detectPattern — miss (one win-reel has no wild) */
const gridMissWild = [
  ['RED7','WILD','BELL','WILD','WILD'],
  ['RED7','WILD','BELL','WILD','WILD'],
  ['RED7','WILD','BELL','WILD','WILD'],
];
t('detectPattern misses when one win-reel lacks wild',
  detectPattern(gridMissWild, cfgHit).hit === false);

/* 15. detectPattern — col-per-reel orientation */
const colsHit = [
  ['RED7','RED7','RED7'],
  ['CHERRY','WILD','LEMON'],
  ['BELL','BELL','WILD'],
  ['PLUM','WILD','GRAPES'],
  ['WILD','MELON','ORANGE'],
];
t('detectPattern hits column-per-reel orientation',
  detectPattern(colsHit, cfgHit).hit === true);

/* 16. detectPattern — empty / invalid */
t('detectPattern empty grid → miss', detectPattern([], cfgHit).hit === false);
t('detectPattern null grid → miss', detectPattern(null, cfgHit).hit === false);
t('detectPattern no anchorSymbol → miss',
  detectPattern(gridHit, resolveConfig({ patternWin: { enabled: true }})).hit === false);

/* 17. detectPattern — wild substring (only exact match counts) */
const gridSubstring = [
  ['RED7','WILDx','WILDx','WILDx','WILDx'],
  ['RED7','WILDx','WILDx','WILDx','WILDx'],
  ['RED7','WILDx','WILDx','WILDx','WILDx'],
];
t('detectPattern requires exact wild match (no substring)',
  detectPattern(gridSubstring, cfgHit).hit === false);

/* 18. detectPattern — partial stack short by 1 */
const gridShort = [
  ['RED7','WILD','WILD','WILD','WILD'],
  ['RED7','WILD','WILD','WILD','WILD'],
  ['CHERRY','WILD','WILD','WILD','WILD'],
];
const cfgShort3 = cfgHit; /* requires height 3 */
t('detectPattern requires full stack (2 of 3 short)',
  detectPattern(gridShort, cfgShort3).hit === false);
const cfgShort2 = resolveConfig({ patternWin: {
  enabled: true, anchorSymbol: 'RED7', wildSymbol: 'WILD',
  anchorReel: 0, anchorStackHeight: 2, winReels: [1, 2, 3, 4],
}});
t('detectPattern accepts shorter required height',
  detectPattern(gridShort, cfgShort2).hit === true);

/* 19. CSS emit — disabled returns empty */
t('emitPatternWinCSS(disabled) → empty', emitPatternWinCSS(defaultConfig()) === '');

/* 20. CSS emit — enabled returns non-empty */
const css = emitPatternWinCSS({ ...defaultConfig(), enabled: true });
t('emitPatternWinCSS(enabled) → non-empty', css.length > 100);
t('emitPatternWinCSS includes .pw-overlay', css.includes('.pw-overlay'));
t('emitPatternWinCSS includes .pw-banner', css.includes('.pw-banner'));
t('emitPatternWinCSS honors celebrationDurationMs',
  emitPatternWinCSS({ ...defaultConfig(), enabled: true, celebrationDurationMs: 2400 })
    .includes('2400ms'));
t('emitPatternWinCSS includes prefers-reduced-motion guard',
  css.includes('prefers-reduced-motion'));

/* 21. Runtime emit — disabled returns empty */
t('emitPatternWinRuntime(disabled) → empty', emitPatternWinRuntime(defaultConfig()) === '');

/* 22. Runtime emit — enabled wires HookBus + DOM */
const rt = emitPatternWinRuntime({ ...defaultConfig(), enabled: true,
  anchorSymbol: 'RED7' });
t('runtime non-empty', rt.length > 200);
t('runtime registers onSpinResult listener',
  rt.includes("HookBus.on('onSpinResult'"));
t('runtime registers onFsSpinResult listener (FS path)',
  rt.includes("HookBus.on('onFsSpinResult'"));
t('runtime registers postSpin listener',
  rt.includes("HookBus.on('postSpin'"));
t('runtime emits onPatternWinTrigger',
  rt.includes("HookBus.emit('onPatternWinTrigger'"));
t('runtime emits onPatternWinPaid',
  rt.includes("HookBus.emit('onPatternWinPaid'"));
t('runtime exposes window.patternWinForceAt force chip',
  rt.includes('window.patternWinForceAt'));
t('runtime sets __FORCE_PATTERN_WIN__ flag from force chip',
  rt.includes('window.__FORCE_PATTERN_WIN__ = true'));
t('runtime routes force chip through runOneBaseSpin (rule_force_buttons_real_spin)',
  rt.includes('window.runOneBaseSpin()'));
t('runtime calls setMultMax when replaceLineTally', rt.includes('setMultMax'));
t('runtime carries aria-live="polite" for a11y',
  rt.includes('aria-live="polite"'));
t('runtime carries role="status" baseline',
  rt.includes('role="status"'));

/* 23. Runtime — replaceLineTally=false skips setMultMax conditionally */
const rtNoReplace = emitPatternWinRuntime({ ...defaultConfig(), enabled: true,
  replaceLineTally: false, anchorSymbol: 'RED7' });
t('runtime CFG.replaceLineTally encoded into IIFE',
  rtNoReplace.includes('"replaceLineTally":false') ||
  rtNoReplace.includes('replaceLineTally":false'));

/* 24. Source — vendor-neutral (no game/vendor names) */
const src = readFileSync(SRC, 'utf-8');
const banned = ['cash eruption','wrath of olympus','huff','starlight'];
const lower = src.toLowerCase();
for (const b of banned) {
  t('source vendor-neutral (no "' + b + '")', !lower.includes(b));
}

/* 25. determinism: same config → byte-identical CSS + runtime */
const a1 = emitPatternWinCSS({ ...defaultConfig(), enabled: true });
const a2 = emitPatternWinCSS({ ...defaultConfig(), enabled: true });
t('determinism: same config → byte-identical CSS', a1 === a2);
const r1 = emitPatternWinRuntime({ ...defaultConfig(), enabled: true });
const r2 = emitPatternWinRuntime({ ...defaultConfig(), enabled: true });
t('determinism: same config → byte-identical runtime', r1 === r2);

/* Summary */
console.log('');
console.log('  ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
