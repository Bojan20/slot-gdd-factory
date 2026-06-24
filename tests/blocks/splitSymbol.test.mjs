/**
 * tests/blocks/splitSymbol.test.mjs — Wave H16 contract test.
 */
import {
  defaultConfig, resolveConfig,
  emitSplitSymbolCSS, emitSplitSymbolMarkup, emitSplitSymbolRuntime,
} from '../../src/blocks/splitSymbol.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/splitSymbol.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => { if (cond) { console.log('  ✓', label); pass++; } else { console.log('  ✗', label); fail++; } };

console.log('splitSymbol block contract');

const def = defaultConfig();
t('defaultConfig frozen', Object.isFrozen(def));
t('default enabled = false', def.enabled === false);
t('default splitGapPx = 2', def.splitGapPx === 2);
t('default autoOnFlag = true', def.autoOnFlag === true);

t('auto-enable on GDD declare', resolveConfig({ splitSymbol: {} }).enabled === true);
const r1 = resolveConfig({ splitSymbol: { splitGapPx: 99 } });
t('splitGapPx clamped to ceiling 8', r1.splitGapPx === 8);
const r2 = resolveConfig({ splitSymbol: { dividerColor: '<script>' } });
t('dividerColor XSS stripped', !r2.dividerColor.includes('<'));
const r3 = resolveConfig({ splitSymbol: { restrictKinds: ['W', '<X>', 'TOOLONGGGGGGGG'] } });
t('restrictKinds filtered', r3.restrictKinds.includes('W') && r3.restrictKinds.length === 2);

t('CSS disabled empty', emitSplitSymbolCSS({ ...def, enabled: false }) === '');
const css = emitSplitSymbolCSS({ ...def, enabled: true });
t('CSS .symbol-cell[data-split selector', css.includes('.symbol-cell[data-split="true"]'));
t('CSS keyframes split-symbol-pulse',     css.includes('@keyframes split-symbol-pulse'));
t('CSS prefers-reduced-motion gate',      css.includes('prefers-reduced-motion'));

t('markup disabled empty', emitSplitSymbolMarkup({ ...def, enabled: false }) === '');
const m = emitSplitSymbolMarkup({ ...def, enabled: true });
t('markup is comment marker', m.includes('decorates'));

t('runtime disabled empty', emitSplitSymbolRuntime({ ...def, enabled: false }) === '');
const rt = emitSplitSymbolRuntime({ ...def, enabled: true });
t('runtime listens preSpin',       rt.includes("HookBus.on('preSpin'"));
t('runtime listens onSpinResult',  rt.includes("HookBus.on('onSpinResult'"));
t('runtime listens onTumbleStep',  rt.includes("HookBus.on('onTumbleStep'"));
t('runtime listens onFsSpinResult',rt.includes("HookBus.on('onFsSpinResult'"));
t('runtime emits onSplitSymbolPlaced',  rt.includes("HookBus.emit('onSplitSymbolPlaced'"));
t('runtime emits onSplitSymbolCleared', rt.includes("HookBus.emit('onSplitSymbolCleared'"));
t('runtime exposes window.splitSymbolMark',  rt.includes('window.splitSymbolMark'));
t('runtime exposes window.splitSymbolClear', rt.includes('window.splitSymbolClear'));

/* Sandbox */
function makeSb(cellSyms) {
  const listeners = {};
  const emits = [];
  const cells = cellSyms.map(([reel, row, sym, pendingSplit]) => {
    const c = { _attrs: { 'data-reel': String(reel), 'data-row': String(row), 'data-sym': sym, 'data-pending-split': pendingSplit ? 'true' : 'false' },
      setAttribute(k, v) { this._attrs[k] = v; },
      getAttribute(k) { return this._attrs[k]; },
    };
    return c;
  });
  const document = {
    querySelector(sel) {
      const m = sel.match(/data-reel="(\d+)"\]\[data-row="(\d+)"/);
      if (m) return cells.find(c => c.getAttribute('data-reel') === m[1] && c.getAttribute('data-row') === m[2]) || null;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === '.symbol-cell') return cells;
      if (sel === '.symbol-cell[data-split="true"]') return cells.filter(c => c.getAttribute('data-split') === 'true');
      return [];
    },
  };
  const window = {
    HookBus: {
      on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); },
      emit(ev, p) { emits.push({ ev, p }); (listeners[ev] || []).forEach(fn => fn(p)); },
    },
  };
  return { window, document, listeners, emits, cells };
}
function runRt(cfg, sb) {
  const fn = new Function('window', 'document', emitSplitSymbolRuntime(cfg));
  fn(sb.window, sb.document);
}

const sb1 = makeSb([[0, 0, 'W', true], [1, 0, 'H1', false]]);
runRt({ ...def, enabled: true }, sb1);
t('sandbox: listeners registered', !!sb1.listeners.preSpin);

sb1.listeners.onSpinResult[0]();
t('sandbox: pending-split cell marked', sb1.cells[0].getAttribute('data-split') === 'true');
const placed = sb1.emits.filter(e => e.ev === 'onSplitSymbolPlaced');
t('sandbox: onSplitSymbolPlaced emitted', placed.length === 1 && placed[0].p.reel === 0);

sb1.listeners.preSpin[0]();
t('sandbox: preSpin clears split flag', sb1.cells[0].getAttribute('data-split') === 'false');

// API mark
const sb2 = makeSb([[2, 1, 'W', false]]);
runRt({ ...def, enabled: true }, sb2);
sb2.window.splitSymbolMark(2, 1, 'W');
t('sandbox: API mark works', sb2.cells[0].getAttribute('data-split') === 'true');

// Restriction
const sb3 = makeSb([[0, 0, 'H1', true]]);
runRt({ ...def, enabled: true, restrictKinds: ['WILD'] }, sb3);
sb3.listeners.onSpinResult[0]();
t('sandbox: restriction blocks non-WILD', sb3.cells[0].getAttribute('data-split') !== 'true');

/* Vendor neutrality */
const src = readFileSync(SRC_PATH, 'utf8');
const VENDORS = /(industry standard|pragmatic|megaways|netent|microgaming|reactoonz|olympus|wrath|cleopatra|buffalo|sugar rush|sweet bonanza|wolf run|cash eruption|playson|hacksaw|nolimit|btg|wazdan|playngo|yggdrasil|relax gaming|push gaming|stakelogic)/i;
t('source: vendor-neutral', !VENDORS.test(src));

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
