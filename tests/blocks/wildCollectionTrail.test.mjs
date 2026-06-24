/**
 * tests/blocks/wildCollectionTrail.test.mjs — Wave H12 contract test.
 */
import {
  defaultConfig,
  resolveConfig,
  emitWildCollectionTrailCSS,
  emitWildCollectionTrailMarkup,
  emitWildCollectionTrailRuntime,
} from '../../src/blocks/wildCollectionTrail.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/wildCollectionTrail.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => { if (cond) { console.log('  ✓', label); pass++; } else { console.log('  ✗', label); fail++; } };

console.log('wildCollectionTrail block contract');

const def = defaultConfig();
t('defaultConfig frozen', Object.isFrozen(def));
t('default enabled = false', def.enabled === false);
t('default capacity = 10', def.capacity === 10);
t('default rewardSteps = [5, 10]', JSON.stringify(def.rewardSteps) === '[5,10]');
t('default rewardKind = fsBonus', def.rewardKind === 'fsBonus');

t('auto-enable on GDD declare', resolveConfig({ wildCollectionTrail: {} }).enabled === true);
const r1 = resolveConfig({ wildCollectionTrail: { rewardKind: 'bogus' } });
t('rewardKind whitelist rejects bogus', r1.rewardKind === 'fsBonus');
const r2 = resolveConfig({ wildCollectionTrail: { rewardKind: 'multBump' } });
t('rewardKind multBump accepted', r2.rewardKind === 'multBump');
const r3 = resolveConfig({ wildCollectionTrail: { rewardSteps: [50, 100, 3] } });
t('rewardSteps filtered + sorted', JSON.stringify(r3.rewardSteps) === '[3]');
const r4 = resolveConfig({ wildCollectionTrail: { capacity: 1000 } });
t('capacity clamped to 99 ceiling', r4.capacity === 99);
const r5 = resolveConfig({ wildCollectionTrail: { position: 'middle' } });
t('position whitelist rejects middle', r5.position === 'top');

t('CSS disabled empty', emitWildCollectionTrailCSS({ ...def, enabled: false }) === '');
const css = emitWildCollectionTrailCSS({ ...def, enabled: true });
t('CSS .wild-trail selector', css.includes('.wild-trail'));
t('CSS prefers-reduced-motion gate', css.includes('prefers-reduced-motion'));

const m = emitWildCollectionTrailMarkup({ ...def, enabled: true });
t('markup has id=wildTrail', m.includes('id="wildTrail"'));
t('markup role=progressbar', m.includes('role="progressbar"'));
t('markup aria-valuemax matches capacity', m.includes(`aria-valuemax="${def.capacity}"`));

t('runtime disabled empty', emitWildCollectionTrailRuntime({ ...def, enabled: false }) === '');
const rt = emitWildCollectionTrailRuntime({ ...def, enabled: true });
t('runtime listens onSpinResult',    rt.includes("HookBus.on('onSpinResult'"));
t('runtime listens onTumbleStep',    rt.includes("HookBus.on('onTumbleStep'"));
t('runtime listens onFsEnd',         rt.includes("HookBus.on('onFsEnd'"));
t('runtime emits onWildTrailBump literal',         rt.includes("HookBus.emit('onWildTrailBump'"));
t('runtime emits onWildCollectionReward literal',  rt.includes("HookBus.emit('onWildCollectionReward'"));
t('runtime emits onWildTrailReset literal',        rt.includes("HookBus.emit('onWildTrailReset'"));

/* Sandbox */
function makeSb(wildsOnGrid) {
  const listeners = {};
  const emits = [];
  const cells = wildsOnGrid.map(sym => ({
    getAttribute(k) { return k === 'data-sym' ? sym : null; },
    textContent: sym,
  }));
  const host = { _attrs: {}, _children: [],
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    querySelector(sel) {
      if (sel === '.wt-label') return { textContent: '' };
      if (sel === '.wt-fill')  return { style: {} };
      return null;
    },
  };
  const document = {
    getElementById(id) { return id === 'wildTrail' ? host : null; },
    /* Bug #2 (2026-06-17, dual selector) — runtime now queries
     * '.symbol-cell, .cell' to match both block markup and real engine
     * gridRenderer (div.cell). Stub returns cells for any selector
     * containing 'cell' to mirror this. */
    querySelectorAll(sel) { return (typeof sel === 'string' && sel.indexOf('cell') !== -1) ? cells : []; },
  };
  const window = {
    HookBus: {
      on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); },
      emit(ev, p) { emits.push({ ev, p }); (listeners[ev] || []).forEach(fn => fn(p)); },
    },
  };
  return { window, document, listeners, emits, host };
}
function runRt(cfg, sb) {
  const fn = new Function('window', 'document', 'setTimeout', emitWildCollectionTrailRuntime(cfg));
  fn(sb.window, sb.document, (cb) => 0);
}

const sb1 = makeSb(['W', 'W', 'H1', 'W', 'M2']);
runRt({ ...def, enabled: true }, sb1);
t('sandbox: listeners registered', !!sb1.listeners.onSpinResult);

sb1.listeners.onSpinResult[0]();
t('sandbox: trail bumped by wild count', sb1.window.__SLOT_WILD_TRAIL__.count === 3);
const bumps = sb1.emits.filter(e => e.ev === 'onWildTrailBump');
t('sandbox: onWildTrailBump emitted',     bumps.length === 1 && bumps[0].p.to === 3);

// Reward step crossing
const sb2 = makeSb(['W', 'W', 'W', 'W', 'W']);
runRt({ ...def, enabled: true }, sb2);
sb2.listeners.onSpinResult[0]();
const rewards = sb2.emits.filter(e => e.ev === 'onWildCollectionReward');
t('sandbox: rewardStep=5 crossed → reward emitted', rewards.length === 1 && rewards[0].p.step === 5);

// Second spin reaches 10 → both reward + max
const sb3 = makeSb([]);
runRt({ ...def, enabled: true }, sb3);
sb3.window.wildTrailBump(5); /* manual API */
const r1Emits = sb3.emits.filter(e => e.ev === 'onWildCollectionReward');
t('sandbox: API bump fires reward step 5', r1Emits.length === 1);
sb3.window.wildTrailBump(5);
const r2Emits = sb3.emits.filter(e => e.ev === 'onWildCollectionReward' && e.p.step === 10);
t('sandbox: 2nd API bump fires reward step 10', r2Emits.length === 1);

// API reset
sb3.window.wildTrailReset();
t('sandbox: API reset clears count', sb3.window.__SLOT_WILD_TRAIL__.count === 0);

// onFsEnd reset (default false, skip emit)
const sb4 = makeSb([]);
runRt({ ...def, enabled: true, resetOnFsEnd: true }, sb4);
sb4.window.wildTrailBump(3);
sb4.listeners.onFsEnd[0]();
t('sandbox: onFsEnd reset when resetOnFsEnd=true', sb4.window.__SLOT_WILD_TRAIL__.count === 0);

/* Vendor neutrality */
const src = readFileSync(SRC_PATH, 'utf8');
const VENDORS = /(industry standard|pragmatic|megaways|netent|microgaming|reactoonz|olympus|wrath|cleopatra|buffalo|sugar rush|sweet bonanza|wolf run|cash eruption|playson|hacksaw|nolimit|btg|wazdan|playngo|yggdrasil|relax gaming|push gaming|stakelogic)/i;
t('source: vendor-neutral', !VENDORS.test(src));

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
