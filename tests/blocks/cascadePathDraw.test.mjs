/**
 * tests/blocks/cascadePathDraw.test.mjs — Wave H24 contract test.
 */
import {
  defaultConfig, resolveConfig,
  emitCascadePathDrawCSS, emitCascadePathDrawMarkup, emitCascadePathDrawRuntime,
} from '../../src/blocks/cascadePathDraw.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/cascadePathDraw.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => { if (cond) { console.log('  ✓', label); pass++; } else { console.log('  ✗', label); fail++; } };

console.log('cascadePathDraw block contract');

const def = defaultConfig();
t('defaultConfig frozen', Object.isFrozen(def));
t('default enabled = false', def.enabled === false);
t('default minCells = 3', def.minCells === 3);
t('default strokePx = 3', def.strokePx === 3);

t('auto-enable on GDD declare', resolveConfig({ cascadePathDraw: {} }).enabled === true);
const r1 = resolveConfig({ cascadePathDraw: { strokePx: 99 } });
t('strokePx clamped to 8 ceiling', r1.strokePx === 8);
const r2 = resolveConfig({ cascadePathDraw: { strokeColor: '<X>red' } });
t('strokeColor XSS stripped', !r2.strokeColor.includes('<'));

const css = emitCascadePathDrawCSS({ ...def, enabled: true });
t('CSS #cascadePathSvg selector', css.includes('#cascadePathSvg'));
t('CSS keyframes cascade-path-draw', css.includes('@keyframes cascade-path-draw'));
t('CSS prefers-reduced-motion gate', css.includes('prefers-reduced-motion'));

const m = emitCascadePathDrawMarkup({ ...def, enabled: true });
t('markup contains cascadePathSvg id', m.includes('id="cascadePathSvg"'));
t('markup aria-hidden=true (decoration)', m.includes('aria-hidden="true"'));

const rt = emitCascadePathDrawRuntime({ ...def, enabled: true });
t('runtime listens preSpin',       rt.includes("HookBus.on('preSpin'"));
t('runtime listens onSpinResult',  rt.includes("HookBus.on('onSpinResult'"));
t('runtime listens onTumbleStep',  rt.includes("HookBus.on('onTumbleStep'"));
t('runtime emits onCascadePathDrawn',   rt.includes("HookBus.emit('onCascadePathDrawn'"));
t('runtime emits onCascadePathCleared', rt.includes("HookBus.emit('onCascadePathCleared'"));
t('runtime exposes cascadePathDraw API',  rt.includes('window.cascadePathDraw'));
t('runtime exposes cascadePathClear API', rt.includes('window.cascadePathClear'));

/* Sandbox */
function makeSb() {
  const listeners = {};
  const emits = [];
  const svgKids = [];
  const svg = {
    children: svgKids,
    get firstChild() { return svgKids[0] || null; },
    appendChild(c) { svgKids.push(c); c.parentNode = svg; return c; },
    removeChild(c) { const i = svgKids.indexOf(c); if (i >= 0) svgKids.splice(i, 1); return c; },
  };
  const cellMap = new Map();
  function makeCell(reel, row) {
    cellMap.set(reel + ':' + row, {
      getBoundingClientRect: () => ({ left: reel * 60, top: row * 60, width: 50, height: 50, right: reel * 60 + 50, bottom: row * 60 + 50 }),
    });
  }
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) makeCell(r, c);
  const grid = { appendChild() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 500, height: 500, right: 500, bottom: 500 }) };
  const document = {
    getElementById(id) { return id === 'cascadePathSvg' ? svg : null; },
    querySelector(sel) {
      if (sel === '.grid' || sel === '#grid') return grid;
      const m = sel.match(/data-reel="(\d+)"\]\[data-row="(\d+)"/);
      return m ? cellMap.get(m[1] + ':' + m[2]) || null : null;
    },
    createElementNS() {
      return { _attrs: {}, parentNode: null,
        setAttribute(k, v) { this._attrs[k] = v; },
        getAttribute(k) { return this._attrs[k]; },
        className: 'svg-path',
      };
    },
  };
  const window = {
    HookBus: {
      on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); },
      emit(ev, p) { emits.push({ ev, p }); (listeners[ev] || []).forEach(fn => fn(p)); },
    },
  };
  return { window, document, listeners, emits, svgKids };
}
function runRt(cfg, sb) {
  const fn = new Function('window', 'document', emitCascadePathDrawRuntime(cfg));
  fn(sb.window, sb.document);
}

const sb1 = makeSb();
runRt({ ...def, enabled: true }, sb1);

sb1.listeners.onSpinResult[0]({ events: [{ cells: [{ reel: 0, row: 0 }, { reel: 1, row: 0 }, { reel: 2, row: 0 }] }] });
const drawn = sb1.emits.filter(e => e.ev === 'onCascadePathDrawn');
t('sandbox: 3-cell path drawn', drawn.length === 1 && drawn[0].p.points === 3);
t('sandbox: svg has 1 path child', sb1.svgKids.length === 1);

// Below minCells = 3 — 2 cells → no draw
const sb2 = makeSb();
runRt({ ...def, enabled: true }, sb2);
sb2.listeners.onSpinResult[0]({ events: [{ cells: [{ reel: 0, row: 0 }, { reel: 1, row: 0 }] }] });
const drawn2 = sb2.emits.filter(e => e.ev === 'onCascadePathDrawn');
t('sandbox: 2-cell win below minCells → no draw', drawn2.length === 0);

// preSpin clears
const sb3 = makeSb();
runRt({ ...def, enabled: true }, sb3);
sb3.window.cascadePathDraw([{ reel: 0, row: 0 }, { reel: 1, row: 0 }, { reel: 2, row: 0 }], 0);
sb3.listeners.preSpin[0]();
const cleared = sb3.emits.filter(e => e.ev === 'onCascadePathCleared');
t('sandbox: preSpin clears paths', cleared.length === 1);

/* Vendor neutrality */
const src = readFileSync(SRC_PATH, 'utf8');
const VENDORS = /(industry standard|pragmatic|megaways|netent|microgaming|reactoonz|olympus|wrath|cleopatra|buffalo|sugar rush|sweet bonanza|wolf run|cash eruption|playson|hacksaw|nolimit|btg|wazdan|playngo|yggdrasil|relax gaming|push gaming|stakelogic)/i;
t('source: vendor-neutral', !VENDORS.test(src));

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
