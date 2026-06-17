/**
 * tests/blocks/cellOverflowCounter.test.mjs — Wave H8 contract test.
 */
import {
  defaultConfig,
  resolveConfig,
  emitCellOverflowCounterCSS,
  emitCellOverflowCounterMarkup,
  emitCellOverflowCounterRuntime,
} from '../../src/blocks/cellOverflowCounter.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/cellOverflowCounter.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => {
  if (cond) { console.log('  ✓', label); pass++; }
  else      { console.log('  ✗', label); fail++; }
};

console.log('cellOverflowCounter block contract');

const def = defaultConfig();
t('defaultConfig frozen',                Object.isFrozen(def));
t('default enabled = false (opt-in)',    def.enabled === false);
t('default position = above',            def.position === 'above');
t('default minOverflow = 1',             def.minOverflow === 1);

t('auto-enable when GDD declares block', resolveConfig({ cellOverflowCounter: {} }).enabled === true);
const r1 = resolveConfig({ cellOverflowCounter: { position: 'INVALID' } });
t('position whitelist rejects invalid',  r1.position === 'above');
const r2 = resolveConfig({ cellOverflowCounter: { position: 'below' } });
t('position below accepted',             r2.position === 'below');
const r3 = resolveConfig({ cellOverflowCounter: { minOverflow: 9999 } });
t('minOverflow clamped to 99 ceiling',   r3.minOverflow === 99);

const cssDis = emitCellOverflowCounterCSS({ ...def, enabled: false });
t('CSS disabled = empty',                cssDis === '');
const css = emitCellOverflowCounterCSS({ ...def, enabled: true });
t('CSS has .cell-overflow-badge selector', css.includes('.cell-overflow-badge'));
t('CSS uses top offset for above',         css.includes('top: -22px;'));
t('CSS keyframes cell-overflow-pulse',     css.includes('@keyframes cell-overflow-pulse'));
t('CSS prefers-reduced-motion gate',       css.includes('prefers-reduced-motion'));

const cssBelow = emitCellOverflowCounterCSS({ ...def, enabled: true, position: 'below' });
t('CSS below uses bottom offset',          cssBelow.includes('bottom: -22px;'));

const mDis = emitCellOverflowCounterMarkup({ ...def, enabled: false });
t('markup disabled = empty',               mDis === '');
const m = emitCellOverflowCounterMarkup({ ...def, enabled: true });
t('markup comment present',                m.includes('decorates reel columns'));

const rtDis = emitCellOverflowCounterRuntime({ ...def, enabled: false });
t('runtime disabled = empty',              rtDis === '');

const rt = emitCellOverflowCounterRuntime({ ...def, enabled: true });
t('runtime listens preSpin',               rt.includes("HookBus.on('preSpin'"));
t('runtime listens postSpin',              rt.includes("HookBus.on('postSpin'"));
t('runtime listens onTumbleStep',          rt.includes("HookBus.on('onTumbleStep'"));
t('runtime listens onFsSpinResult',        rt.includes("HookBus.on('onFsSpinResult'"));
t('runtime emits onCellOverflow literal',  rt.includes("HookBus.emit('onCellOverflow'"));
t('runtime exposes measure / hide API',    rt.includes('cellOverflowMeasure') && rt.includes('cellOverflowHide'));

/* Sandbox */
function makeSb(reelDefs) {
  const listeners = {};
  const emits = [];
  const reels = reelDefs.map(([idx, depth, visible, sym]) => {
    const cells = [];
    for (let i = 0; i < visible; i++) {
      cells.push({ nodeType: 1, getAttribute(k) { return k === 'data-sym' ? sym : null; } });
    }
    const badges = [];
    return {
      _attrs: { 'data-reel': String(idx), 'data-stack-depth': String(depth), 'data-visible-rows': String(visible), 'data-stack-sym': sym },
      getAttribute(k) { return this._attrs[k]; },
      setAttribute(k, v) { this._attrs[k] = v; },
      querySelectorAll(sel) { return sel === '.symbol-cell' ? cells : badges; },
      querySelector(sel) { return sel === '.cell-overflow-badge' ? (badges[0] || null) : null; },
      appendChild(b) { badges.push(b); return b; },
    };
  });
  const document = {
    readyState: 'complete',
    addEventListener() {},
    querySelectorAll(sel) {
      if (sel === '.reel-column, .reel[data-reel]') return reels;
      if (sel === '.cell-overflow-badge') return [].concat(...reels.map(r => r.querySelectorAll('.cell-overflow-badge')));
      return [];
    },
    querySelector(sel) {
      const m = sel.match(/data-reel="(\d+)"/);
      if (!m) return null;
      return reels.find(r => r.getAttribute('data-reel') === m[1]) || null;
    },
    createElement() {
      const el = { _attrs: {}, className: '', textContent: '', _kids: [],
        setAttribute(k, v) { this._attrs[k] = v; },
        getAttribute(k) { return this._attrs[k]; },
        appendChild(c) { this._kids.push(c); return c; },
        /* WCAG aria-live fix uses innerHTML template; mock parses
           <span class="…" attr="…"></span> shape so firstChild works. */
        get firstChild() { return this._kids[0] || null; },
        set innerHTML(html) {
          this._kids = [];
          const m = /^<span([^>]*)>(.*?)<\/span>$/.exec(String(html).trim());
          if (!m) return;
          const child = { _attrs: {}, className: '', textContent: m[2],
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
  return { window, document, listeners, emits, reels };
}
function runRt(cfg, sb) {
  const fn = new Function('window', 'document', emitCellOverflowCounterRuntime(cfg));
  fn(sb.window, sb.document);
}

const sb1 = makeSb([[0, 8, 4, 'H1'], [1, 4, 4, 'M2'], [2, 7, 3, 'W']]);
runRt({ ...def, enabled: true }, sb1);
t('sandbox: postSpin listener registered',          !!sb1.listeners.postSpin);

sb1.emits.length = 0;  // clear boot-time measure emits
sb1.listeners.postSpin[0]();
const overflows = sb1.emits.filter(e => e.ev === 'onCellOverflow');
const reelsHit = new Set(overflows.map(o => o.p.reel));
t('sandbox: 2 unique reels reported overflow',      reelsHit.size === 2);
t('sandbox: reel 0 overflow count=4',               overflows.find(e => e.p.reel === 0).p.count === 4);
t('sandbox: reel 2 overflow count=4',               overflows.find(e => e.p.reel === 2).p.count === 4);
t('sandbox: reel 1 (no overflow) NOT reported',     !overflows.find(e => e.p.reel === 1));
const reel0Badge = sb1.reels[0].querySelectorAll('badges-list-via-querySelectorAll')[0] || sb1.reels[0].querySelector('.cell-overflow-badge');
t('sandbox: reel 0 badge data-visible=true',        reel0Badge && reel0Badge.getAttribute('data-visible') === 'true');
t('sandbox: reel 0 badge text = +4',                reel0Badge && reel0Badge.textContent === '+4');

// preSpin hides all
sb1.listeners.preSpin[0]();
t('sandbox: preSpin hides reel 0 badge',            reel0Badge.getAttribute('data-visible') === 'false');

// minOverflow gating
const sb2 = makeSb([[0, 5, 4, 'H1']]);
runRt({ ...def, enabled: true, minOverflow: 5 }, sb2);
sb2.listeners.postSpin[0]();
const ovs2 = sb2.emits.filter(e => e.ev === 'onCellOverflow');
t('sandbox: minOverflow=5, overflow=1 → NO event',  ovs2.length === 0);

/* Vendor neutrality */
const src = readFileSync(SRC_PATH, 'utf8');
const VENDORS = /(IGT|pragmatic|megaways|netent|microgaming|reactoonz|olympus|wrath|cleopatra|buffalo|sugar rush|sweet bonanza|wolf run|cash eruption|playson|hacksaw|nolimit|btg|wazdan|playngo|yggdrasil|relax gaming|push gaming|stakelogic)/i;
t('source: vendor-neutral',                         !VENDORS.test(src));

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
