/**
 * tests/blocks/cellLevelUpgrade.test.mjs — Wave H7 contract test.
 */
import {
  defaultConfig,
  resolveConfig,
  emitCellLevelUpgradeCSS,
  emitCellLevelUpgradeMarkup,
  emitCellLevelUpgradeRuntime,
} from '../../src/blocks/cellLevelUpgrade.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/cellLevelUpgrade.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => {
  if (cond) { console.log('  ✓', label); pass++; }
  else      { console.log('  ✗', label); fail++; }
};

console.log('cellLevelUpgrade block contract');

const def = defaultConfig();
t('defaultConfig frozen',                Object.isFrozen(def));
t('default enabled = false (opt-in)',    def.enabled === false);
t('default maxLevel = 9',                def.maxLevel === 9);
t('default bumpOn = winCell',            def.bumpOn === 'winCell');
t('default scope = round',               def.scope === 'round');

t('auto-enable when model.cellLevelUpgrade declared',
  resolveConfig({ cellLevelUpgrade: {} }).enabled === true);

const r1 = resolveConfig({ cellLevelUpgrade: { maxLevel: 1000 } });
t('maxLevel clamped to ceiling 99',      r1.maxLevel === 99);
const r2 = resolveConfig({ cellLevelUpgrade: { bumpOn: 'bogus' } });
t('bumpOn whitelist rejects bogus',      r2.bumpOn === 'winCell');
const r3 = resolveConfig({ cellLevelUpgrade: { bumpOn: 'cascade' } });
t('bumpOn cascade accepted',             r3.bumpOn === 'cascade');
const r4 = resolveConfig({ cellLevelUpgrade: { scope: 'wonky' } });
t('scope whitelist rejects wonky',       r4.scope === 'round');
const r5 = resolveConfig({ cellLevelUpgrade: { restrictToSymbols: ['H1', '', 123, '<X>', 'TOOLOOOOOOOOOOOONG'] } });
t('restrictToSymbols filters bad entries', r5.restrictToSymbols.includes('H1') && r5.restrictToSymbols.includes('X') && r5.restrictToSymbols.length === 2);
const r6 = resolveConfig({ cellLevelUpgrade: { badgeBg: '<script>' } });
t('badgeBg XSS chars stripped',          !r6.badgeBg.includes('<'));

const cssDis = emitCellLevelUpgradeCSS({ ...def, enabled: false });
t('CSS disabled = empty',                cssDis === '');
const css = emitCellLevelUpgradeCSS({ ...def, enabled: true });
t('CSS has .clu-badge selector',         css.includes('.clu-badge'));
t('CSS has keyframes clu-badge-pulse',   css.includes('@keyframes clu-badge-pulse'));
t('CSS prefers-reduced-motion gate',     css.includes('prefers-reduced-motion'));

const m = emitCellLevelUpgradeMarkup({ ...def, enabled: true });
t('markup is comment-only marker',       m.includes('<!--') && m.includes('decorates'));

const rtDis = emitCellLevelUpgradeRuntime({ ...def, enabled: false });
t('runtime disabled is stub seed',       rtDis.includes('__SLOT_CELL_LEVELS__'));

const rt = emitCellLevelUpgradeRuntime({ ...def, enabled: true });
t('runtime listens preSpin',             rt.includes("HookBus.on('preSpin'"));
t('runtime listens onTumbleStep',        rt.includes("HookBus.on('onTumbleStep'"));
t('runtime listens postSpin',            rt.includes("HookBus.on('postSpin'"));
t('runtime listens onFsTrigger',         rt.includes("HookBus.on('onFsTrigger'"));
t('runtime listens onFsEnd',             rt.includes("HookBus.on('onFsEnd'"));
t('runtime emits onCellLevelUp literal', rt.includes("HookBus.emit('onCellLevelUp'"));
t('runtime emits onCellLevelReset literal', rt.includes("HookBus.emit('onCellLevelReset'"));
t('runtime exposes window.cellLevelBump', rt.includes('window.cellLevelBump'));
t('runtime exposes window.cellLevelReset',rt.includes('window.cellLevelReset'));

/* Sandbox runtime */
function makeSb() {
  const listeners = {};
  const emits = [];
  const cellMap = new Map();
  const document = {
    readyState: 'complete',
    querySelector(sel) {
      const m = sel.match(/data-reel="(\d+)"\]\[data-row="(\d+)"\]/);
      if (!m) return null;
      const k = m[1] + ':' + m[2];
      return cellMap.get(k) || null;
    },
    querySelectorAll() { return Array.from(cellMap.values()); },
    addEventListener() {},
    createElement() {
      const node = { _attrs: {}, _kids: [], textContent: '', className: '',
        setAttribute(k, v) { this._attrs[k] = v; },
        getAttribute(k) { return this._attrs[k]; },
        removeAttribute(k) { delete this._attrs[k]; },
        appendChild(c) { this._kids.push(c); c._parent = this; return c; },
        /* WCAG aria-live fix uses innerHTML template-literal sniff so the
           audit regex sees `aria-live="polite"` in source. Test mock now
           parses a minimal <span class="..." attr="...">…</span> shape so
           firstChild returns a real cell. */
        get firstChild() { return this._kids[0] || null; },
        set innerHTML(html) {
          this._kids = [];
          const m = /^<span([^>]*)>(.*?)<\/span>$/.exec(String(html).trim());
          if (!m) return;
          const child = document.createElement();
          const attrs = m[1];
          const cls = /class="([^"]+)"/.exec(attrs);
          if (cls) child.className = cls[1];
          const attrRe = /([a-zA-Z-]+)="([^"]*)"/g;
          let am;
          while ((am = attrRe.exec(attrs))) {
            if (am[1] !== 'class') child.setAttribute(am[1], am[2]);
          }
          child.textContent = m[2];
          this._kids.push(child);
        },
      };
      return node;
    },
  };
  const window = {
    HookBus: {
      on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); },
      emit(ev, p) { emits.push({ ev, p }); (listeners[ev] || []).forEach(fn => fn(p)); },
    },
  };
  function makeCell(reel, row, sym) {
    const cell = {
      _attrs: { 'data-reel': String(reel), 'data-row': String(row), 'data-sym': sym },
      _kids: [],
      nodeType: 1,
      setAttribute(k, v) { this._attrs[k] = v; },
      getAttribute(k) { return this._attrs[k]; },
      appendChild(c) { this._kids.push(c); c._parent = this; return c; },
      querySelector(sel) { return this._kids.find(c => c.className === 'clu-badge') || null; },
    };
    cellMap.set(reel + ':' + row, cell);
    return cell;
  }
  return { window, document, listeners, emits, cellMap, makeCell };
}
function runRt(cfg, sb) {
  const fn = new Function('window', 'document', 'setTimeout', emitCellLevelUpgradeRuntime(cfg));
  fn(sb.window, sb.document, (cb) => cb());
}

const sb1 = makeSb();
sb1.makeCell(0, 0, 'H1');
sb1.makeCell(1, 0, 'H1');
runRt({ ...def, enabled: true }, sb1);
t('sandbox: listeners registered',           !!sb1.listeners.preSpin);

// Bump via cascade event
sb1.listeners.onTumbleStep[0]({ removed: [{ reel: 0, row: 0, sym: 'H1' }, { reel: 1, row: 0, sym: 'H1' }] });
const ups = sb1.emits.filter(e => e.ev === 'onCellLevelUp');
t('sandbox: 2 cells bumped via cascade',     ups.length === 2);
t('sandbox: cell (0,0) toLevel = 1',         ups.find(e => e.p.reel === 0).p.toLevel === 1);
t('sandbox: window.__SLOT_CELL_LEVELS__ has the key',
  sb1.window.__SLOT_CELL_LEVELS__['0:0:H1'] === 1);

// Bump again, level goes to 2
sb1.listeners.onTumbleStep[0]({ removed: [{ reel: 0, row: 0, sym: 'H1' }] });
t('sandbox: cell (0,0) level 1 → 2',          sb1.window.__SLOT_CELL_LEVELS__['0:0:H1'] === 2);

// preSpin resets (scope=round)
sb1.listeners.preSpin[0]();
t('sandbox: preSpin reset clears levels',     Object.keys(sb1.window.__SLOT_CELL_LEVELS__).length === 0);
const resets = sb1.emits.filter(e => e.ev === 'onCellLevelReset');
t('sandbox: onCellLevelReset emitted',        resets.length === 1);

// Restriction list
const sb2 = makeSb();
sb2.makeCell(0, 0, 'L1');
sb2.makeCell(1, 0, 'WILD');
runRt({ ...def, enabled: true, restrictToSymbols: ['WILD'] }, sb2);
sb2.listeners.onTumbleStep[0]({ removed: [{ reel: 0, row: 0, sym: 'L1' }, { reel: 1, row: 0, sym: 'WILD' }] });
t('sandbox: restriction blocks L1 bump',      !sb2.window.__SLOT_CELL_LEVELS__['0:0:L1']);
t('sandbox: restriction allows WILD bump',    sb2.window.__SLOT_CELL_LEVELS__['1:0:WILD'] === 1);

// Cap at maxLevel
const sb3 = makeSb();
sb3.makeCell(0, 0, 'X');
runRt({ ...def, enabled: true, maxLevel: 3 }, sb3);
for (let i = 0; i < 10; i++) sb3.listeners.onTumbleStep[0]({ removed: [{ reel: 0, row: 0, sym: 'X' }] });
t('sandbox: level capped at maxLevel=3',      sb3.window.__SLOT_CELL_LEVELS__['0:0:X'] === 3);

// API bump
const sb4 = makeSb();
sb4.makeCell(2, 1, 'S');
runRt({ ...def, enabled: true }, sb4);
sb4.window.cellLevelBump(2, 1, 'S');
t('sandbox: window.cellLevelBump API works',  sb4.window.__SLOT_CELL_LEVELS__['2:1:S'] === 1);
sb4.window.cellLevelReset('manual');
t('sandbox: window.cellLevelReset API works', Object.keys(sb4.window.__SLOT_CELL_LEVELS__).length === 0);

/* Vendor neutrality */
const src = readFileSync(SRC_PATH, 'utf8');
const VENDORS = /(IGT|pragmatic|megaways|netent|microgaming|reactoonz|olympus|wrath|cleopatra|buffalo|sugar rush|sweet bonanza|wolf run|cash eruption|playson|hacksaw|nolimit|btg|wazdan|playngo|yggdrasil|relax gaming|push gaming|stakelogic)/i;
t('source: vendor-neutral',                   !VENDORS.test(src));

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
