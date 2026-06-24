/**
 * tests/blocks/winLineFlash.test.mjs — Wave H21 contract test.
 */
import {
  defaultConfig, resolveConfig,
  emitWinLineFlashCSS, emitWinLineFlashMarkup, emitWinLineFlashRuntime,
} from '../../src/blocks/winLineFlash.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/winLineFlash.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => { if (cond) { console.log('  ✓', label); pass++; } else { console.log('  ✗', label); fail++; } };

console.log('winLineFlash block contract');

const def = defaultConfig();
t('defaultConfig frozen', Object.isFrozen(def));
/* 2026-06-18 — Boki rule (HNP backlog "sve sto postoji u svakom slotu radi
 * odmah i uvek"): defaults flipped to ON. GDD opt-out path still honored. */
t('default enabled = true (universal base-game presenter)', def.enabled === true);
t('default direction = ltr', def.direction === 'ltr');
t('default minCells = 3', def.minCells === 3);

t('auto-enable on GDD declare', resolveConfig({ winLineFlash: {} }).enabled === true);
const r1 = resolveConfig({ winLineFlash: { direction: 'sideways' } });
t('direction whitelist rejects bogus', r1.direction === 'ltr');
const r2 = resolveConfig({ winLineFlash: { direction: 'rtl' } });
t('direction rtl accepted', r2.direction === 'rtl');
const r3 = resolveConfig({ winLineFlash: { minCells: 99 } });
t('minCells clamped to 12 ceiling', r3.minCells === 12);

const css = emitWinLineFlashCSS({ ...def, enabled: true });
t('CSS [data-line-flash=true] selector', css.includes('[data-line-flash="true"]'));
t('CSS @keyframes win-line-flash-ltr', css.includes('@keyframes win-line-flash-ltr'));
t('CSS prefers-reduced-motion gate', css.includes('prefers-reduced-motion'));

const rt = emitWinLineFlashRuntime({ ...def, enabled: true });
t('runtime listens preSpin',       rt.includes("HookBus.on('preSpin'"));
t('runtime listens onSpinResult',  rt.includes("HookBus.on('onSpinResult'"));
t('runtime listens onTumbleStep',  rt.includes("HookBus.on('onTumbleStep'"));
t('runtime emits onWinLineFlashStart',   rt.includes("HookBus.emit('onWinLineFlashStart'"));
t('runtime emits onWinLineFlashEnd',     rt.includes("HookBus.emit('onWinLineFlashEnd'"));
t('runtime emits onWinLineFlashCleared', rt.includes("HookBus.emit('onWinLineFlashCleared'"));

/* Sandbox */
function makeSb() {
  const listeners = {};
  const emits = [];
  const cellMap = new Map();
  function makeCell(reel, row) {
    const c = { _attrs: { 'data-reel': String(reel), 'data-row': String(row), 'data-line-flash': 'false' },
      setAttribute(k, v) { this._attrs[k] = v; },
      getAttribute(k) { return this._attrs[k]; },
    };
    cellMap.set(reel + ':' + row, c);
    return c;
  }
  for (let r = 0; r < 5; r++) makeCell(r, 0);
  const document = {
    querySelector(sel) {
      const m = sel.match(/data-reel="(\d+)"\]\[data-row="(\d+)"/);
      return m ? cellMap.get(m[1] + ':' + m[2]) || null : null;
    },
    querySelectorAll(sel) {
      if (sel === '.symbol-cell[data-line-flash="true"]') {
        return Array.from(cellMap.values()).filter(c => c.getAttribute('data-line-flash') === 'true');
      }
      return [];
    },
  };
  const window = {
    HookBus: {
      on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); },
      emit(ev, p) { emits.push({ ev, p }); (listeners[ev] || []).forEach(fn => fn(p)); },
    },
  };
  return { window, document, listeners, emits, cellMap };
}
function runRt(cfg, sb) {
  const fn = new Function('window', 'document', 'setTimeout', emitWinLineFlashRuntime(cfg));
  fn(sb.window, sb.document, (cb) => 0);
}

const sb1 = makeSb();
runRt({ ...def, enabled: true }, sb1);

sb1.listeners.onSpinResult[0]({ events: [{ cells: [{ reel: 0, row: 0 }, { reel: 1, row: 0 }, { reel: 2, row: 0 }] }] });
const starts = sb1.emits.filter(e => e.ev === 'onWinLineFlashStart');
t('sandbox: 3-cell win triggers flash start', starts.length === 1 && starts[0].p.cellCount === 3);

// Below minCells = 3 — 2 cells → no flash
const sb2 = makeSb();
runRt({ ...def, enabled: true }, sb2);
sb2.listeners.onSpinResult[0]({ events: [{ cells: [{ reel: 0, row: 0 }, { reel: 1, row: 0 }] }] });
const starts2 = sb2.emits.filter(e => e.ev === 'onWinLineFlashStart');
t('sandbox: 2-cell win below minCells → no flash', starts2.length === 0);

// preSpin clears
const sb3 = makeSb();
runRt({ ...def, enabled: true }, sb3);
sb3.window.winLineFlash([{ reel: 0, row: 0 }, { reel: 1, row: 0 }, { reel: 2, row: 0 }], 0);
sb3.listeners.preSpin[0]();
const cleared = sb3.emits.filter(e => e.ev === 'onWinLineFlashCleared');
t('sandbox: preSpin clears flashes', cleared.length === 1);

/* Vendor neutrality */
const src = readFileSync(SRC_PATH, 'utf8');
const VENDORS = /(industry standard|pragmatic|megaways|netent|microgaming|reactoonz|olympus|wrath|cleopatra|buffalo|sugar rush|sweet bonanza|wolf run|cash eruption|playson|hacksaw|nolimit|btg|wazdan|playngo|yggdrasil|relax gaming|push gaming|stakelogic)/i;
t('source: vendor-neutral', !VENDORS.test(src));

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
