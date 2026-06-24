/**
 * tests/blocks/dualRoleScatter.test.mjs — Wave H10 contract test.
 */
import {
  defaultConfig,
  resolveConfig,
  emitDualRoleScatterCSS,
  emitDualRoleScatterMarkup,
  emitDualRoleScatterRuntime,
} from '../../src/blocks/dualRoleScatter.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/dualRoleScatter.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => {
  if (cond) { console.log('  ✓', label); pass++; }
  else      { console.log('  ✗', label); fail++; }
};

console.log('dualRoleScatter block contract');

const def = defaultConfig();
t('defaultConfig frozen',                 Object.isFrozen(def));
t('default enabled = false (opt-in)',     def.enabled === false);
t('default symbol = S',                   def.symbol === 'S');
t('default secondaryRole = wild',         def.secondaryRole === 'wild');
t('default minLanded = 1',                def.minLanded === 1);

t('auto-enable when GDD declares block',  resolveConfig({ dualRoleScatter: {} }).enabled === true);
const r1 = resolveConfig({ dualRoleScatter: { secondaryRole: 'bogus' } });
t('secondaryRole whitelist rejects bogus',r1.secondaryRole === 'wild');
const r2 = resolveConfig({ dualRoleScatter: { secondaryRole: 'pay' } });
t('secondaryRole pay accepted',           r2.secondaryRole === 'pay');
const r3 = resolveConfig({ dualRoleScatter: { minLanded: 50 } });
t('minLanded clamped to 12 ceiling',      r3.minLanded === 12);
const r4 = resolveConfig({ dualRoleScatter: { badgeText: '<X>★' } });
t('badgeText XSS chars stripped',         !r4.badgeText.includes('<'));

const cssDis = emitDualRoleScatterCSS({ ...def, enabled: false });
t('CSS disabled = empty',                 cssDis === '');
const css = emitDualRoleScatterCSS({ ...def, enabled: true });
t('CSS .dual-role-badge selector',        css.includes('.dual-role-badge'));
t('CSS @keyframes dual-role-pulse',       css.includes('@keyframes dual-role-pulse'));
t('CSS prefers-reduced-motion gate',      css.includes('prefers-reduced-motion'));

const m = emitDualRoleScatterMarkup({ ...def, enabled: true });
t('markup is decorate marker',            m.includes('decorates .symbol-cell'));

const rtDis = emitDualRoleScatterRuntime({ ...def, enabled: false });
t('runtime disabled = empty',             rtDis === '');
const rt = emitDualRoleScatterRuntime({ ...def, enabled: true });
t('runtime listens postSpin',             rt.includes("HookBus.on('postSpin'"));
t('runtime listens onTumbleStep',         rt.includes("HookBus.on('onTumbleStep'"));
t('runtime listens onFsTrigger',          rt.includes("HookBus.on('onFsTrigger'"));
t('runtime emits onDualRoleActivated literal', rt.includes("HookBus.emit('onDualRoleActivated'"));
t('runtime exposes window.dualRoleScan API',   rt.includes('window.dualRoleScan'));

/* Sandbox */
function makeSb(cellSyms) {
  const listeners = {};
  const emits = [];
  const cells = cellSyms.map(([reel, row, sym]) => ({
    _attrs: { 'data-reel': String(reel), 'data-row': String(row), 'data-sym': sym, 'aria-label': '' },
    _kids: [],
    nodeType: 1,
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    appendChild(c) { this._kids.push(c); return c; },
    querySelector(sel) { return this._kids.find(k => k.className === 'dual-role-badge') || null; },
  }));
  const document = {
    addEventListener() {},
    querySelectorAll(sel) { return sel === '.symbol-cell' ? cells : []; },
    createElement() {
      const el = { _attrs: {}, className: '', textContent: '', _kids: [],
        setAttribute(k, v) { this._attrs[k] = v; },
        getAttribute(k) { return this._attrs[k]; },
        appendChild(c) { this._kids.push(c); return c; },
        /* WCAG aria-live fix uses innerHTML template; mock parses span. */
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
  return { window, document, listeners, emits, cells };
}
function runRt(cfg, sb) {
  const fn = new Function('window', 'document', emitDualRoleScatterRuntime(cfg));
  fn(sb.window, sb.document);
}

const sb1 = makeSb([[0, 0, 'S'], [1, 1, 'H1'], [3, 2, 'S']]);
runRt({ ...def, enabled: true }, sb1);
t('sandbox: listeners registered',         !!sb1.listeners.postSpin);

sb1.listeners.postSpin[0]();
const acts = sb1.emits.filter(e => e.ev === 'onDualRoleActivated');
t('sandbox: 2 dual-role activations emitted', acts.length === 2);
t('sandbox: first act reel=0 sym=S role=wild', acts[0].p.reel === 0 && acts[0].p.role === 'wild');
t('sandbox: second act reel=3',                acts[1].p.reel === 3);

// FS trigger emits scatter role
sb1.emits.length = 0;
sb1.listeners.onFsTrigger[0]();
const fsActs = sb1.emits.filter(e => e.ev === 'onDualRoleActivated' && e.p.role === 'scatter');
t('sandbox: onFsTrigger emits scatter role',  fsActs.length === 2);

// minLanded gate
const sb2 = makeSb([[0, 0, 'S'], [1, 0, 'M1']]);
runRt({ ...def, enabled: true, minLanded: 3 }, sb2);
sb2.listeners.postSpin[0]();
const acts2 = sb2.emits.filter(e => e.ev === 'onDualRoleActivated');
t('sandbox: minLanded=3, 1 scatter → no event', acts2.length === 0);

// secondaryRole=pay
const sb3 = makeSb([[0, 0, 'S']]);
runRt({ ...def, enabled: true, secondaryRole: 'pay' }, sb3);
sb3.listeners.postSpin[0]();
const acts3 = sb3.emits.filter(e => e.ev === 'onDualRoleActivated');
t('sandbox: secondaryRole=pay activated',     acts3.length === 1 && acts3[0].p.role === 'pay');

// API call
const sb4 = makeSb([[0, 0, 'S']]);
runRt({ ...def, enabled: true }, sb4);
sb4.emits.length = 0;
const count = sb4.window.dualRoleScan();
t('sandbox: API dualRoleScan returns count',  count === 1);

/* Vendor neutrality */
const src = readFileSync(SRC_PATH, 'utf8');
const VENDORS = /(industry standard|pragmatic|megaways|netent|microgaming|reactoonz|olympus|wrath|cleopatra|buffalo|sugar rush|sweet bonanza|wolf run|cash eruption|playson|hacksaw|nolimit|btg|wazdan|playngo|yggdrasil|relax gaming|push gaming|stakelogic)/i;
t('source: vendor-neutral',                   !VENDORS.test(src));

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
