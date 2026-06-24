/**
 * tests/blocks/megaSymbol.test.mjs — Wave H11 contract test.
 */
import {
  defaultConfig,
  resolveConfig,
  emitMegaSymbolCSS,
  emitMegaSymbolMarkup,
  emitMegaSymbolRuntime,
} from '../../src/blocks/megaSymbol.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/megaSymbol.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => {
  if (cond) { console.log('  ✓', label); pass++; }
  else      { console.log('  ✗', label); fail++; }
};

console.log('megaSymbol block contract');

const def = defaultConfig();
t('defaultConfig frozen',                Object.isFrozen(def));
t('default enabled = false',             def.enabled === false);
t('default minSize = 2',                 def.minSize === 2);
t('default maxSize = 3',                 def.maxSize === 3);
t('default persistRound = false',        def.persistRound === false);

t('auto-enable on GDD declare',          resolveConfig({ megaSymbol: {} }).enabled === true);
const r1 = resolveConfig({ megaSymbol: { minSize: 5 } });
t('minSize whitelist rejects 5',         r1.minSize === 2);
const r2 = resolveConfig({ megaSymbol: { minSize: 3, maxSize: 2 } });
t('maxSize coerced ≥ minSize',           r2.maxSize === 3);
const r3 = resolveConfig({ megaSymbol: { fgColor: '<script>' } });
t('fgColor XSS chars stripped',          !r3.fgColor.includes('<'));

const cssDis = emitMegaSymbolCSS({ ...def, enabled: false });
t('CSS disabled = empty',                cssDis === '');
const css = emitMegaSymbolCSS({ ...def, enabled: true });
t('CSS has .mega-symbol-overlay',        css.includes('.mega-symbol-overlay'));
t('CSS keyframes mega-symbol-enter',     css.includes('@keyframes mega-symbol-enter'));
t('CSS prefers-reduced-motion gate',     css.includes('prefers-reduced-motion'));

const m = emitMegaSymbolMarkup({ ...def, enabled: true });
t('markup is comment-only marker',       m.includes('overlay built at runtime'));

const rtDis = emitMegaSymbolRuntime({ ...def, enabled: false });
t('runtime disabled = empty',            rtDis === '');
const rt = emitMegaSymbolRuntime({ ...def, enabled: true });
t('runtime listens preSpin',             rt.includes("HookBus.on('preSpin'"));
t('runtime listens onMegaSymbolLanded',  rt.includes("HookBus.on('onMegaSymbolLanded'"));
t('runtime listens postSpin',            rt.includes("HookBus.on('postSpin'"));
t('runtime listens onFsEnd',             rt.includes("HookBus.on('onFsEnd'"));
t('runtime emits onMegaSymbolPlaced',    rt.includes("HookBus.emit('onMegaSymbolPlaced'"));
t('runtime emits onMegaSymbolCleared',   rt.includes("HookBus.emit('onMegaSymbolCleared'"));
t('runtime exposes megaSymbolPlant API', rt.includes('window.megaSymbolPlant'));
t('runtime exposes megaSymbolClear API', rt.includes('window.megaSymbolClear'));

/* Sandbox runtime — minimal DOM */
function makeSb(cellGrid) {
  const listeners = {};
  const emits = [];
  const overlays = [];
  const cells = new Map();
  for (const [r, c] of cellGrid) {
    const rect = { left: r * 60, top: c * 60, right: r * 60 + 50, bottom: c * 60 + 50 };
    cells.set(r + ':' + c, {
      _attrs: { 'data-reel': String(r), 'data-row': String(c) },
      getBoundingClientRect: () => rect,
      getAttribute(k) { return this._attrs[k]; },
    });
  }
  const grid = { style: {},
    appendChild(el) { overlays.push(el); el._parent = grid; el.parentNode = grid; return el; },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 500, bottom: 500 }),
  };
  grid.removeChild = (el) => {
    const idx = overlays.indexOf(el);
    if (idx >= 0) overlays.splice(idx, 1);
  };
  const document = {
    querySelector(sel) {
      if (sel === '.grid' || sel === '#grid') return grid;
      const m = sel.match(/data-reel="(\d+)"\]\[data-row="(\d+)"/);
      if (m) return cells.get(m[1] + ':' + m[2]) || null;
      return null;
    },
    querySelectorAll(sel) {
      return sel === '.mega-symbol-overlay' ? overlays : [];
    },
    createElement() {
      const el = { _attrs: {}, _kids: [], className: '', textContent: '', style: {},
        setAttribute(k, v) { this._attrs[k] = v; },
        getAttribute(k) { return this._attrs[k]; },
        appendChild(c) { this._kids.push(c); return c; },
        /* WCAG aria-live fix uses innerHTML template; mock parses div. */
        get firstChild() { return this._kids[0] || null; },
        set innerHTML(html) {
          this._kids = [];
          const m = /^<div([^>]*)>(.*?)<\/div>$/.exec(String(html).trim());
          if (!m) return;
          const child = { _attrs: {}, _kids: [], className: '', textContent: m[2], style: {},
            setAttribute(k, v) { this._attrs[k] = v; },
            getAttribute(k) { return this._attrs[k]; },
            appendChild(c) { this._kids.push(c); return c; },
          };
          const cls = /class="([^"]+)"/.exec(m[1]);
          if (cls) child.className = cls[1];
          const attrRe = /([a-zA-Z-]+)="([^"]*)"/g;
          let am;
          while ((am = attrRe.exec(m[1]))) {
            if (am[1] !== 'class') child.setAttribute(am[1], am[2]);
          }
          this._kids.push(child);
        },
      };
      return el;
    },
    body: grid,
  };
  const window = {
    HookBus: {
      on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); },
      emit(ev, p) { emits.push({ ev, p }); (listeners[ev] || []).forEach(fn => fn(p)); },
    },
  };
  return { window, document, grid, overlays, listeners, emits };
}
function runRt(cfg, sb) {
  const fn = new Function('window', 'document', emitMegaSymbolRuntime(cfg));
  fn(sb.window, sb.document);
}

// Build a 4x4 cell grid for testing
const cellGrid = [];
for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) cellGrid.push([r, c]);

const sb1 = makeSb(cellGrid);
runRt({ ...def, enabled: true }, sb1);
t('sandbox: listeners registered',       !!sb1.listeners.preSpin);

// Plant 2x2 mega
const ok = sb1.window.megaSymbolPlant(0, 0, 2, 'W');
t('sandbox: megaSymbolPlant returns true', ok === true);
t('sandbox: overlay created in grid',      sb1.overlays.length === 1);
t('sandbox: overlay has 2x2 data-mega-size attr', sb1.overlays[0].getAttribute('data-mega-size') === '2');
t('sandbox: overlay sym attr = W',         sb1.overlays[0].getAttribute('data-mega-sym') === 'W');
t('sandbox: overlay role=img',             sb1.overlays[0].getAttribute('role') === 'img');
const placedEmits = sb1.emits.filter(e => e.ev === 'onMegaSymbolPlaced');
t('sandbox: onMegaSymbolPlaced emitted',   placedEmits.length === 1 && placedEmits[0].p.size === 2);

// preSpin clears
sb1.listeners.preSpin[0]();
t('sandbox: preSpin clears overlay',       sb1.overlays.length === 0);
const clears = sb1.emits.filter(e => e.ev === 'onMegaSymbolCleared');
t('sandbox: onMegaSymbolCleared emitted',  clears.length === 1);

// Persistent mode does NOT clear on preSpin
const sb2 = makeSb(cellGrid);
runRt({ ...def, enabled: true, persistRound: true }, sb2);
sb2.window.megaSymbolPlant(0, 0, 2, 'W');
sb2.listeners.preSpin[0]();
t('sandbox: persistRound mode keeps overlay on preSpin', sb2.overlays.length === 1);

// onMegaSymbolLanded event triggers placement
const sb3 = makeSb(cellGrid);
runRt({ ...def, enabled: true }, sb3);
sb3.listeners.onMegaSymbolLanded[0]({ reel: 1, row: 1, size: 3, sym: 'M1' });
t('sandbox: onMegaSymbolLanded event plants overlay', sb3.overlays.length === 1);
t('sandbox: event-driven overlay 3x3',                sb3.overlays[0].getAttribute('data-mega-size') === '3');

// onFsEnd clears
const sb4 = makeSb(cellGrid);
runRt({ ...def, enabled: true }, sb4);
sb4.window.megaSymbolPlant(0, 0, 2, 'W');
sb4.listeners.onFsEnd[0]();
t('sandbox: onFsEnd clears (clearOnFsEnd=true)',      sb4.overlays.length === 0);

/* Vendor neutrality */
const src = readFileSync(SRC_PATH, 'utf8');
const VENDORS = /(industry standard|pragmatic|megaways|netent|microgaming|reactoonz|olympus|wrath|cleopatra|buffalo|sugar rush|sweet bonanza|wolf run|cash eruption|playson|hacksaw|nolimit|btg|wazdan|playngo|yggdrasil|relax gaming|push gaming|stakelogic)/i;
t('source: vendor-neutral',              !VENDORS.test(src));

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
