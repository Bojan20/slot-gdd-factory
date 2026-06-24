/**
 * tests/blocks/copyWildOrchestrator.test.mjs
 *
 * UQ-DEEP-AK · WAVE 1 · BLOCK A — Copy Wild Orchestrator contract test.
 *
 * Pattern: console.log + pass/fail counter (matches the cellOverflowCounter
 * test shape that other LEGO blocks follow). 20 cases total — covers
 * default contract, parser-signal auto-enable, explicit override
 * auto-enable, source/target reel normalization, mode whitelist,
 * propagation-ms clamp, halo RGB validation, copy mode mutual exclusion,
 * CSS/markup/runtime emit shape, runtime API surface, idempotency guard,
 * hook surface, XSS/forbidden-pattern guard, vendor neutrality.
 */
import {
  defaultConfig,
  resolveConfig,
  emitCopyWildOrchestratorCSS,
  emitCopyWildOrchestratorMarkup,
  emitCopyWildOrchestratorRuntime,
} from '../../src/blocks/copyWildOrchestrator.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH  = resolvePath(__dirname, '../../src/blocks/copyWildOrchestrator.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => {
  if (cond) { console.log('  ✓', label); pass++; }
  else      { console.log('  ✗', label); fail++; }
};

console.log('copyWildOrchestrator block contract');

/* 1. defaultConfig frozen + schemaVersion='1' */
const def = defaultConfig();
t('1. defaultConfig frozen + schemaVersion=1',
  Object.isFrozen(def) && def.schemaVersion === '1');

/* 2. default enabled=false */
t('2. default enabled = false (opt-in)',
  def.enabled === false);

/* 3. auto-enable iz model.wild.special.copy_wild */
const r3 = resolveConfig({
  wild: { special: { copy_wild: { sourceReels: [1], targetReels: [2, 4] } } },
});
t('3. auto-enable from model.wild.special.copy_wild',
  r3.enabled === true && r3.sourceReels.length === 1 && r3.targetReels.length === 2);

/* 4. auto-enable iz model.copyWildOrchestrator */
const r4 = resolveConfig({
  copyWildOrchestrator: { sourceReels: [3], targetReels: [1, 5] },
});
t('4. auto-enable from model.copyWildOrchestrator',
  r4.enabled === true && r4.sourceReels[0] === 3);

/* 5. sourceReels empty → disabled even when key present */
const r5 = resolveConfig({
  wild: { special: { copy_wild: { sourceReels: [], targetReels: [2, 4] } } },
});
t('5. sourceReels empty → disabled',
  r5.enabled === false);

/* 6. targetReels empty → disabled */
const r6 = resolveConfig({
  wild: { special: { copy_wild: { sourceReels: [1], targetReels: [] } } },
});
t('6. targetReels empty → disabled',
  r6.enabled === false);

/* 7. sourceReels dedupe + sort */
const r7 = resolveConfig({
  copyWildOrchestrator: { sourceReels: [3, 1, 3, 2, 1], targetReels: [5] },
});
t('7. sourceReels dedupe + sort',
  r7.sourceReels.length === 3 &&
  r7.sourceReels[0] === 1 && r7.sourceReels[1] === 2 && r7.sourceReels[2] === 3);

/* 8. targetReels exclude sourceReels overlap */
const r8 = resolveConfig({
  copyWildOrchestrator: { sourceReels: [2, 3], targetReels: [1, 2, 3, 4, 5] },
});
t('8. targetReels exclude sourceReels overlap',
  r8.targetReels.length === 3 &&
  !r8.targetReels.includes(2) && !r8.targetReels.includes(3) &&
  r8.targetReels.includes(1) && r8.targetReels.includes(4) && r8.targetReels.includes(5));

/* 9. mode whitelist (base/fs/both accepted, INVALID rejected) */
const r9a = resolveConfig({ copyWildOrchestrator: { sourceReels: [1], targetReels: [2], mode: 'base' } });
const r9b = resolveConfig({ copyWildOrchestrator: { sourceReels: [1], targetReels: [2], mode: 'fs' } });
const r9c = resolveConfig({ copyWildOrchestrator: { sourceReels: [1], targetReels: [2], mode: 'both' } });
const r9d = resolveConfig({ copyWildOrchestrator: { sourceReels: [1], targetReels: [2], mode: 'GARBAGE' } });
t('9. mode whitelist (base/fs/both ok, invalid → default both)',
  r9a.mode === 'base' && r9b.mode === 'fs' && r9c.mode === 'both' && r9d.mode === 'both');

/* 10. propagationMs clamp [80, 2000] */
const r10a = resolveConfig({ copyWildOrchestrator: { sourceReels: [1], targetReels: [2], propagationMs: 5 } });
const r10b = resolveConfig({ copyWildOrchestrator: { sourceReels: [1], targetReels: [2], propagationMs: 99999 } });
const r10c = resolveConfig({ copyWildOrchestrator: { sourceReels: [1], targetReels: [2], propagationMs: 500 } });
t('10. propagationMs clamp [80, 2000]',
  r10a.propagationMs === 80 && r10b.propagationMs === 2000 && r10c.propagationMs === 500);

/* 11. haloRGB validate format */
const r11a = resolveConfig({ copyWildOrchestrator: { sourceReels: [1], targetReels: [2], haloRGB: '12,34,56' } });
const r11b = resolveConfig({ copyWildOrchestrator: { sourceReels: [1], targetReels: [2], haloRGB: 'not-a-color' } });
const r11c = resolveConfig({ copyWildOrchestrator: { sourceReels: [1], targetReels: [2], haloRGB: '999,999,999' } });
t('11. haloRGB validate format (good ok, garbage default, clamp 0-255)',
  r11a.haloRGB === '12,34,56' &&
  r11b.haloRGB === '255,214,110' &&
  r11c.haloRGB === '255,255,255');

/* 12. copyOnHit + copyOnWin mutual exclusion (default copyOnHit=true) */
const r12a = resolveConfig({ copyWildOrchestrator: { sourceReels: [1], targetReels: [2] } });
const r12b = resolveConfig({ copyWildOrchestrator: { sourceReels: [1], targetReels: [2], copyOnWin: true } });
const r12c = resolveConfig({ copyWildOrchestrator: { sourceReels: [1], targetReels: [2], copyOnHit: false, copyOnWin: false } });
t('12. copyOnHit/copyOnWin mutex (default hit, win overrides, both-false → hit)',
  r12a.copyOnHit === true && r12a.copyOnWin === false &&
  r12b.copyOnHit === false && r12b.copyOnWin === true &&
  r12c.copyOnHit === true && r12c.copyOnWin === false);

/* 13. emitCSS returns '' when disabled, non-empty string when enabled */
const cssDis = emitCopyWildOrchestratorCSS(def);
const cssEn  = emitCopyWildOrchestratorCSS(r3);
t('13. emitCSS empty-when-disabled / non-empty-when-enabled',
  cssDis === '' && typeof cssEn === 'string' && cssEn.length > 50 &&
  cssEn.includes('.cw-source-glow') && cssEn.includes('.cw-target-flash') &&
  cssEn.includes('.cw-trail'));

/* 14. emitMarkup returns '' when disabled, div when enabled */
const mDis = emitCopyWildOrchestratorMarkup(def);
const mEn  = emitCopyWildOrchestratorMarkup(r3);
t('14. emitMarkup empty-when-disabled / div-when-enabled',
  mDis === '' && typeof mEn === 'string' &&
  mEn.includes('id="cw-stage"') && mEn.includes('class="cw-overlay"') &&
  mEn.includes('aria-hidden="true"'));

/* 15. emitRuntime returns '' when disabled, JS string when enabled */
const rtDis = emitCopyWildOrchestratorRuntime(def);
const rtEn  = emitCopyWildOrchestratorRuntime(r3);
t('15. emitRuntime empty-when-disabled / JS-when-enabled',
  rtDis === '' && typeof rtEn === 'string' && rtEn.length > 200);

/* 16. Runtime exposes window.copyWildAPI */
t('16. runtime exposes window.copyWildAPI',
  rtEn.includes('window.copyWildAPI') &&
  rtEn.includes('emitCopy') && rtEn.includes('state'));

/* 17. Runtime contains __CW_WIRED__ idempotency guard */
t('17. runtime __CW_WIRED__ idempotency guard',
  rtEn.includes('__CW_WIRED__') &&
  rtEn.includes('if (window.__CW_WIRED__) return;'));

/* 18. Runtime contains 'onSpinResult' hook (string search) */
t('18. runtime wires onSpinResult hook',
  rtEn.includes("'onSpinResult'") || rtEn.includes('"onSpinResult"'));

/* 19. Runtime NO forbidden patterns (eval, document.write, user-data innerHTML) */
/*    We allow internal substitutions but disallow real eval / document.write /
 *    any `.innerHTML =` assignment (only textContent + setAttribute used). */
const hasEval        = /\beval\s*\(/.test(rtEn);
const hasDocWrite    = /document\.write\s*\(/.test(rtEn);
const hasInnerHtmlAssign = /\.innerHTML\s*=/.test(rtEn);
t('19. runtime no eval / no document.write / no innerHTML assign',
  !hasEval && !hasDocWrite && !hasInnerHtmlAssign);

/* 20. source vendor-neutral (no IGT / PragmaticPlay / Cash Eruption / Wrath of) */
const src = readFileSync(SRC_PATH, 'utf8');
const VENDOR_RE = /\b(IGT|Pragmatic\s*Play|Pragmatic|Cash\s*Eruption|Wrath\s*of|NetEnt|Microgaming|Playson|Hacksaw|Nolimit|BTG|Wazdan|Play'?n\s*Go|Yggdrasil|Relax\s*Gaming|Push\s*Gaming|Stakelogic|Megaways|Reactoonz|Olympus|Cleopatra|Buffalo|Sugar\s*Rush|Sweet\s*Bonanza|Wolf\s*Run)\b/i;
t('20. source vendor-neutral (no banned brand tokens)',
  !VENDOR_RE.test(src));

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
