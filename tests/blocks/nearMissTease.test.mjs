/**
 * tests/blocks/nearMissTease.test.mjs — Wave H22 contract test.
 */
import {
  defaultConfig, resolveConfig,
  emitNearMissTeaseCSS, emitNearMissTeaseMarkup, emitNearMissTeaseRuntime,
} from '../../src/blocks/nearMissTease.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/nearMissTease.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => { if (cond) { console.log('  ✓', label); pass++; } else { console.log('  ✗', label); fail++; } };

console.log('nearMissTease block contract');

const def = defaultConfig();
t('defaultConfig frozen', Object.isFrozen(def));
t('default enabled = false', def.enabled === false);
t('default scatterTrigger = 3', def.scatterTrigger === 3);
t('default scatterDeficit = 1', def.scatterDeficit === 1);

t('auto-enable on GDD declare', resolveConfig({ nearMissTease: {} }).enabled === true);
const r1 = resolveConfig({ nearMissTease: { scatterDeficit: 99 } });
t('scatterDeficit clamped to 5 ceiling', r1.scatterDeficit === 5);
const r2 = resolveConfig({ nearMissTease: { glowColor: '<X>' } });
t('glowColor XSS stripped', !r2.glowColor.includes('<'));

const css = emitNearMissTeaseCSS({ ...def, enabled: true });
t('CSS [data-near-miss=true] selector', css.includes('[data-near-miss="true"]'));
t('CSS @keyframes near-miss-tease', css.includes('@keyframes near-miss-tease'));
t('CSS prefers-reduced-motion gate', css.includes('prefers-reduced-motion'));

const rt = emitNearMissTeaseRuntime({ ...def, enabled: true });
t('runtime listens preSpin',        rt.includes("HookBus.on('preSpin'"));
t('runtime listens onSpinResult',   rt.includes("HookBus.on('onSpinResult'"));
t('runtime listens onFsTrigger',    rt.includes("HookBus.on('onFsTrigger'"));
t('runtime listens onFsEnd',        rt.includes("HookBus.on('onFsEnd'"));
t('runtime emits onNearMissTease',  rt.includes("HookBus.emit('onNearMissTease'"));
t('runtime emits onNearMissCleared',rt.includes("HookBus.emit('onNearMissCleared'"));

/* Sandbox */
function makeSb(syms) {
  const listeners = {};
  const emits = [];
  const cells = syms.map(s => ({ _attrs: { 'data-sym': s, 'data-near-miss': 'false' },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
  }));
  const document = {
    querySelectorAll(sel) {
      if (sel === '.symbol-cell') return cells;
      if (sel === '.symbol-cell[data-near-miss="true"]') return cells.filter(c => c.getAttribute('data-near-miss') === 'true');
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
  const fn = new Function('window', 'document', 'setTimeout', emitNearMissTeaseRuntime(cfg));
  fn(sb.window, sb.document, (cb) => 0);
}

// 2 scatters → near-miss tease (trigger=3, deficit=1)
const sb1 = makeSb(['S', 'S', 'H1', 'M2', 'L1']);
runRt({ ...def, enabled: true }, sb1);
sb1.listeners.onSpinResult[0]();
const teases = sb1.emits.filter(e => e.ev === 'onNearMissTease');
t('sandbox: 2 of 3 scatters fires tease',
  teases.length === 1 && teases[0].p.count === 2 && teases[0].p.deficit === 1);
t('sandbox: scatter cells marked',
  sb1.cells[0].getAttribute('data-near-miss') === 'true' &&
  sb1.cells[1].getAttribute('data-near-miss') === 'true');

// 3 scatters → no tease (full trigger)
const sb2 = makeSb(['S', 'S', 'S']);
runRt({ ...def, enabled: true }, sb2);
sb2.listeners.onSpinResult[0]();
const teases2 = sb2.emits.filter(e => e.ev === 'onNearMissTease');
t('sandbox: 3 scatters (full) → no tease', teases2.length === 0);

// 1 scatter → no tease (deficit=2 > 1)
const sb3 = makeSb(['S', 'H1']);
runRt({ ...def, enabled: true }, sb3);
sb3.listeners.onSpinResult[0]();
const teases3 = sb3.emits.filter(e => e.ev === 'onNearMissTease');
t('sandbox: deficit > scatterDeficit blocks', teases3.length === 0);

// skipDuringFs
const sb4 = makeSb(['S', 'S']);
runRt({ ...def, enabled: true }, sb4);
sb4.listeners.onFsTrigger[0]();
sb4.emits.length = 0;
sb4.listeners.onSpinResult[0]();
const teases4 = sb4.emits.filter(e => e.ev === 'onNearMissTease');
t('sandbox: skipDuringFs=true blocks during FS', teases4.length === 0);

/* Vendor neutrality */
const src = readFileSync(SRC_PATH, 'utf8');
const VENDORS = /(IGT|pragmatic|megaways|netent|microgaming|reactoonz|olympus|wrath|cleopatra|buffalo|sugar rush|sweet bonanza|wolf run|cash eruption|playson|hacksaw|nolimit|btg|wazdan|playngo|yggdrasil|relax gaming|push gaming|stakelogic)/i;
t('source: vendor-neutral', !VENDORS.test(src));

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
