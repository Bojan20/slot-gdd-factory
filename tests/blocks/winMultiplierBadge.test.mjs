/**
 * tests/blocks/winMultiplierBadge.test.mjs — Wave H20 contract test.
 */
import {
  defaultConfig, resolveConfig,
  emitWinMultiplierBadgeCSS, emitWinMultiplierBadgeMarkup, emitWinMultiplierBadgeRuntime,
} from '../../src/blocks/winMultiplierBadge.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/winMultiplierBadge.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => { if (cond) { console.log('  ✓', label); pass++; } else { console.log('  ✗', label); fail++; } };

console.log('winMultiplierBadge block contract');

const def = defaultConfig();
t('defaultConfig frozen', Object.isFrozen(def));
t('default enabled = false', def.enabled === false);
t('default minMult = 2', def.minMult === 2);
t('default position = win-center', def.position === 'win-center');

t('auto-enable on GDD declare', resolveConfig({ winMultiplierBadge: {} }).enabled === true);
const r1 = resolveConfig({ winMultiplierBadge: { position: 'wonky' } });
t('position whitelist rejects wonky', r1.position === 'win-center');
const r2 = resolveConfig({ winMultiplierBadge: { minMult: 0 } });
t('minMult clamped to floor 2', r2.minMult === 2);
const r3 = resolveConfig({ winMultiplierBadge: { labelTemplate: '<script>x' } });
t('labelTemplate XSS stripped', !r3.labelTemplate.includes('<'));

const css = emitWinMultiplierBadgeCSS({ ...def, enabled: true });
t('CSS .win-mult-badge selector', css.includes('.win-mult-badge'));
t('CSS keyframes win-mult-badge-pulse', css.includes('@keyframes win-mult-badge-pulse'));
t('CSS prefers-reduced-motion gate', css.includes('prefers-reduced-motion'));

const rt = emitWinMultiplierBadgeRuntime({ ...def, enabled: true });
t('runtime listens preSpin',        rt.includes("HookBus.on('preSpin'"));
t('runtime listens onSpinResult',   rt.includes("HookBus.on('onSpinResult'"));
t('runtime listens onPathMultiplierAssigned', rt.includes("HookBus.on('onPathMultiplierAssigned'"));
t('runtime listens onFsEnd',        rt.includes("HookBus.on('onFsEnd'"));
t('runtime emits onWinMultBadgePlaced',  rt.includes("HookBus.emit('onWinMultBadgePlaced'"));
t('runtime emits onWinMultBadgeCleared', rt.includes("HookBus.emit('onWinMultBadgeCleared'"));
t('runtime exposes winMultBadge API',    rt.includes('window.winMultBadge'));
t('runtime exposes winMultBadgeClear',   rt.includes('window.winMultBadgeClear'));

/* Sandbox */
function makeSb() {
  const listeners = {};
  const emits = [];
  const anchors = new Map();
  function makeAnchor(reel, row) {
    const a = { _attrs: { 'data-reel': String(reel), 'data-row': String(row) }, _kids: [], style: {},
      setAttribute(k, v) { this._attrs[k] = v; },
      getAttribute(k) { return this._attrs[k]; },
      appendChild(c) { this._kids.push(c); c._parent = this; c.parentNode = this; return c; },
      querySelector(sel) { return this._kids.find(k => k.className === 'win-mult-badge') || null; },
    };
    anchors.set(reel + ':' + row, a);
    return a;
  }
  makeAnchor(0, 0); makeAnchor(1, 1); makeAnchor(2, 2);
  const document = {
    querySelector(sel) {
      const m = sel.match(/data-reel="(\d+)"\]\[data-row="(\d+)"/);
      if (m) return anchors.get(m[1] + ':' + m[2]) || null;
      return null;
    },
    querySelectorAll() {
      const all = [];
      for (const a of anchors.values()) {
        for (const k of a._kids) if (k.className === 'win-mult-badge') all.push(k);
      }
      return all;
    },
    createElement() {
      const el = { _attrs: {}, className: '', textContent: '', style: {}, _kids: [],
        setAttribute(k, v) { this._attrs[k] = v; },
        getAttribute(k) { return this._attrs[k]; },
        appendChild(c) { this._kids.push(c); return c; },
        /* WCAG aria-live fix uses innerHTML template; mock parses span. */
        get firstChild() { return this._kids[0] || null; },
        set innerHTML(html) {
          this._kids = [];
          const m = /^<span([^>]*)>(.*?)<\/span>$/.exec(String(html).trim());
          if (!m) return;
          const child = { _attrs: {}, className: '', textContent: m[2], style: {},
            setAttribute(k, v) { this._attrs[k] = v; },
            getAttribute(k) { return this._attrs[k]; },
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
  };
  const window = {
    HookBus: {
      on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); },
      emit(ev, p) { emits.push({ ev, p }); (listeners[ev] || []).forEach(fn => fn(p)); },
    },
  };
  return { window, document, listeners, emits, anchors };
}
function runRt(cfg, sb) {
  const fn = new Function('window', 'document', emitWinMultiplierBadgeRuntime(cfg));
  fn(sb.window, sb.document);
}

const sb1 = makeSb();
runRt({ ...def, enabled: true }, sb1);

// onSpinResult with multiplier events
sb1.listeners.onSpinResult[0]({ events: [{ multiplier: 5, cells: [{ reel: 0, row: 0 }] }] });
const placed = sb1.emits.filter(e => e.ev === 'onWinMultBadgePlaced');
t('sandbox: badge placed for ×5 win', placed.length === 1 && placed[0].p.mult === 5);

// minMult gate
sb1.emits.length = 0;
sb1.listeners.onSpinResult[0]({ events: [{ multiplier: 1, cells: [{ reel: 1, row: 1 }] }] });
const noPlace = sb1.emits.filter(e => e.ev === 'onWinMultBadgePlaced');
t('sandbox: mult=1 below minMult=2 → no badge', noPlace.length === 0);

// preSpin clears
const sb2 = makeSb();
runRt({ ...def, enabled: true }, sb2);
sb2.listeners.onSpinResult[0]({ events: [{ multiplier: 3, cells: [{ reel: 2, row: 2 }] }] });
sb2.listeners.preSpin[0]();
const cleared = sb2.emits.filter(e => e.ev === 'onWinMultBadgeCleared');
t('sandbox: preSpin clears badges', cleared.length === 1);

// API
const sb3 = makeSb();
runRt({ ...def, enabled: true }, sb3);
sb3.window.winMultBadge(0, 0, 7);
t('sandbox: API placement works',
  sb3.emits.some(e => e.ev === 'onWinMultBadgePlaced' && e.p.mult === 7));

/* Vendor neutrality */
const src = readFileSync(SRC_PATH, 'utf8');
const VENDORS = /(industry standard|pragmatic|megaways|netent|microgaming|reactoonz|olympus|wrath|cleopatra|buffalo|sugar rush|sweet bonanza|wolf run|cash eruption|playson|hacksaw|nolimit|btg|wazdan|playngo|yggdrasil|relax gaming|push gaming|stakelogic)/i;
t('source: vendor-neutral', !VENDORS.test(src));

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
