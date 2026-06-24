/**
 * tests/blocks/paylineDimmer.test.mjs — Wave H27 contract test.
 */
import {
  defaultConfig, resolveConfig,
  emitPaylineDimmerCSS, emitPaylineDimmerMarkup, emitPaylineDimmerRuntime,
} from '../../src/blocks/paylineDimmer.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/paylineDimmer.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => { if (cond) { console.log('  ✓', label); pass++; } else { console.log('  ✗', label); fail++; } };

console.log('paylineDimmer block contract');

const def = defaultConfig();
t('defaultConfig frozen', Object.isFrozen(def));
t('default enabled = false', def.enabled === false);
t('default opacityFloor = 0.35', def.opacityFloor === 0.35);

t('auto-enable on GDD declare', resolveConfig({ paylineDimmer: {} }).enabled === true);
const r1 = resolveConfig({ paylineDimmer: { opacityFloor: 5 } });
t('opacityFloor clamped to 0.95 ceiling', r1.opacityFloor === 0.95);
const r2 = resolveConfig({ paylineDimmer: { overlayColor: '<X>' } });
t('overlayColor XSS stripped', !r2.overlayColor.includes('<'));

const css = emitPaylineDimmerCSS({ ...def, enabled: true });
t('CSS [data-dimmed=true] selector', css.includes('[data-dimmed="true"]'));
t('CSS prefers-reduced-motion gate', css.includes('prefers-reduced-motion'));

const rt = emitPaylineDimmerRuntime({ ...def, enabled: true });
t('runtime listens preSpin',       rt.includes("HookBus.on('preSpin'"));
t('runtime listens onSpinResult',  rt.includes("HookBus.on('onSpinResult'"));
t('runtime listens onTumbleStep',  rt.includes("HookBus.on('onTumbleStep'"));
t('runtime listens onWinPresentationEnd', rt.includes("HookBus.on('onWinPresentationEnd'"));
t('runtime listens onFsTrigger',   rt.includes("HookBus.on('onFsTrigger'"));
t('runtime listens onFsEnd',       rt.includes("HookBus.on('onFsEnd'"));
t('runtime emits onPaylineDimmerStart',   rt.includes("HookBus.emit('onPaylineDimmerStart'"));
t('runtime emits onPaylineDimmerCleared', rt.includes("HookBus.emit('onPaylineDimmerCleared'"));

/* Sandbox */
function makeSb(cellCoords) {
  const listeners = {};
  const emits = [];
  const cells = cellCoords.map(([r, c]) => ({ _attrs: { 'data-reel': String(r), 'data-row': String(c), 'data-dimmed': 'false' },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
  }));
  const document = {
    querySelectorAll(sel) {
      if (sel === '.symbol-cell') return cells;
      if (sel === '.symbol-cell[data-dimmed="true"]') return cells.filter(c => c.getAttribute('data-dimmed') === 'true');
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
  const fn = new Function('window', 'document', emitPaylineDimmerRuntime(cfg));
  fn(sb.window, sb.document);
}

// Grid 3x1 → win na cells (0,0) i (1,0), cell (2,0) treba da bude dimmed
const coords = [[0, 0], [1, 0], [2, 0]];
const sb1 = makeSb(coords);
runRt({ ...def, enabled: true }, sb1);
sb1.listeners.onSpinResult[0]({ events: [{ cells: [{ reel: 0, row: 0 }, { reel: 1, row: 0 }] }] });
const starts = sb1.emits.filter(e => e.ev === 'onPaylineDimmerStart');
t('sandbox: non-winning cells dimmed → onPaylineDimmerStart',
  starts.length === 1 && starts[0].p.dimmedCount === 1);
t('sandbox: winning cell (0,0) NOT dimmed', sb1.cells[0].getAttribute('data-dimmed') === 'false');
t('sandbox: winning cell (1,0) NOT dimmed', sb1.cells[1].getAttribute('data-dimmed') === 'false');
t('sandbox: non-winning cell (2,0) IS dimmed', sb1.cells[2].getAttribute('data-dimmed') === 'true');

// preSpin clears
sb1.listeners.preSpin[0]();
t('sandbox: preSpin clears dim', sb1.cells[2].getAttribute('data-dimmed') === 'false');

// No events → no dim
const sb2 = makeSb(coords);
runRt({ ...def, enabled: true }, sb2);
sb2.listeners.onSpinResult[0]({ events: [] });
const starts2 = sb2.emits.filter(e => e.ev === 'onPaylineDimmerStart');
t('sandbox: no events → no dim', starts2.length === 0);

// skipDuringFs
const sb3 = makeSb(coords);
runRt({ ...def, enabled: true, skipDuringFs: true }, sb3);
sb3.listeners.onFsTrigger[0]();
sb3.emits.length = 0;
sb3.listeners.onSpinResult[0]({ events: [{ cells: [{ reel: 0, row: 0 }] }] });
const starts3 = sb3.emits.filter(e => e.ev === 'onPaylineDimmerStart');
t('sandbox: skipDuringFs=true blocks during FS', starts3.length === 0);

/* Vendor neutrality */
const src = readFileSync(SRC_PATH, 'utf8');
const VENDORS = /(industry standard|pragmatic|megaways|netent|microgaming|reactoonz|olympus|wrath|cleopatra|buffalo|sugar rush|sweet bonanza|wolf run|cash eruption|playson|hacksaw|nolimit|btg|wazdan|playngo|yggdrasil|relax gaming|push gaming|stakelogic)/i;
t('source: vendor-neutral', !VENDORS.test(src));

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
