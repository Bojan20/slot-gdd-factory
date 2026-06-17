/**
 * tests/blocks/infinityReels.test.mjs — Wave H18 contract test.
 */
import {
  defaultConfig,
  resolveConfig,
  emitInfinityReelsCSS,
  emitInfinityReelsMarkup,
  emitInfinityReelsRuntime,
} from '../../src/blocks/infinityReels.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/infinityReels.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => {
  if (cond) { console.log('  ✓', label); pass++; }
  else      { console.log('  ✗', label); fail++; }
};

console.log('infinityReels block contract');

const def = defaultConfig();
t('defaultConfig frozen',                Object.isFrozen(def));
t('default enabled = false',             def.enabled === false);
t('default startCount = 5',              def.startCount === 5);
t('default capCount = 12',               def.capCount === 12);
t('default position = top-right',        def.position === 'top-right');
t('default milestones array frozen',     Object.isFrozen(def.milestones));
t('default labelTemplate = REELS {N}',   def.labelTemplate === 'REELS {N}');
t('defaultConfig returns fresh object',  defaultConfig() !== defaultConfig());

t('auto-enable when GDD declares block', resolveConfig({ infinityReels: {} }).enabled === true);
t('no key → disabled',                   resolveConfig({}).enabled === false);

const r1 = resolveConfig({ infinityReels: { startCount: 1 } });
t('startCount clamped to 3 floor',       r1.startCount === 3);
const r2 = resolveConfig({ infinityReels: { capCount: 9999 } });
t('capCount clamped to 64 ceiling',      r2.capCount === 64);
const r3 = resolveConfig({ infinityReels: { startCount: 8, capCount: 4 } });
t('capCount auto-raised to startCount',  r3.capCount >= r3.startCount);
const r4 = resolveConfig({ infinityReels: { position: 'middle' } });
t('position whitelist rejects bogus',    r4.position === 'top-right');
const r5 = resolveConfig({ infinityReels: { labelTemplate: '<x>R={N}' } });
t('labelTemplate XSS chars stripped',    !r5.labelTemplate.includes('<'));
const r6 = resolveConfig({ infinityReels: { milestones: [6, 12, 9, 6] } });
t('milestones dedup + sort',             r6.milestones.length === 3 && r6.milestones[0] === 6 && r6.milestones[2] === 12);
const r7 = resolveConfig({ infinityReels: { milestones: [99] } });
t('milestones filter > cap dropped',     r7.milestones.length === 0 || r7.milestones[0] !== 99);

const cssDis = emitInfinityReelsCSS({ ...def, enabled: false });
t('CSS disabled = empty',                cssDis === '');
const css = emitInfinityReelsCSS({ ...def, enabled: true });
t('CSS .infreels-badge selector',        css.includes('.infreels-badge'));
t('CSS @keyframes infreels-pulse',       css.includes('@keyframes infreels-pulse'));
t('CSS prefers-reduced-motion gate',     css.includes('prefers-reduced-motion'));

const mDis = emitInfinityReelsMarkup({ ...def, enabled: false });
t('markup disabled = empty',             mDis === '');
const mk = emitInfinityReelsMarkup({ ...def, enabled: true });
t('markup #infReelsBadge present',       mk.includes('id="infReelsBadge"'));
t('markup role=status',                  mk.includes('role="status"'));
t('markup aria-live=polite',             mk.includes('aria-live="polite"'));
t('markup initial REELS 5',              mk.includes('REELS 5'));

const rtDis = emitInfinityReelsRuntime({ ...def, enabled: false });
t('runtime disabled = empty',            rtDis === '');
const rt = emitInfinityReelsRuntime({ ...def, enabled: true });
t('runtime listens preSpin',             rt.includes("HookBus.on('preSpin'"));
t('runtime listens onTumbleStep',        rt.includes("HookBus.on('onTumbleStep'"));
t('runtime listens postSpin',            rt.includes("HookBus.on('postSpin'"));
t('runtime listens onFsTrigger',         rt.includes("HookBus.on('onFsTrigger'"));
t('runtime listens onFsSpinResult',      rt.includes("HookBus.on('onFsSpinResult'"));
t('runtime emits onInfinityReelAdded',   rt.includes("HookBus.emit('onInfinityReelAdded'"));
t('runtime emits onInfinityReelsReset',  rt.includes("HookBus.emit('onInfinityReelsReset'"));
t('runtime emits onInfinityChainMilestone', rt.includes("HookBus.emit('onInfinityChainMilestone'"));
t('runtime exposes window.infinityReelsSet',  rt.includes('window.infinityReelsSet'));
t('runtime exposes window.infinityReelsBump', rt.includes('window.infinityReelsBump'));
t('runtime exposes window.infinityReelsReset',rt.includes('window.infinityReelsReset'));
t('runtime exposes window.infinityReelsGet',  rt.includes('window.infinityReelsGet'));

/* --- Sandbox --- */
function makeSb() {
  const listeners = {};
  const emits = [];
  const badge = {
    _attrs: {}, textContent: '',
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k] != null ? this._attrs[k] : null; },
  };
  const document = {
    getElementById(id) { return id === 'infReelsBadge' ? badge : null; },
  };
  const window = {
    HookBus: {
      on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); },
      emit(ev, p) { emits.push({ ev, p }); (listeners[ev] || []).forEach(fn => fn(p)); },
    },
  };
  return { window, document, listeners, emits, badge };
}
function runRt(cfg, sb) {
  const fn = new Function('window', 'document', 'setTimeout', emitInfinityReelsRuntime(cfg));
  fn(sb.window, sb.document, () => 1);
}

const sb1 = makeSb();
runRt({ ...def, enabled: true }, sb1);
t('sandbox: listeners registered',       !!sb1.listeners.onTumbleStep);

/* grow chain */
sb1.window.__INFINITY_REELS_COUNT__ = 6;
sb1.listeners.onTumbleStep[0]();
const added1 = sb1.emits.filter(e => e.ev === 'onInfinityReelAdded');
t('sandbox: onInfinityReelAdded 5→6',    added1.length === 1 && added1[0].p.to === 6);

sb1.window.__INFINITY_REELS_COUNT__ = 8;
sb1.listeners.onTumbleStep[0]();
const added2 = sb1.emits.filter(e => e.ev === 'onInfinityReelAdded');
t('sandbox: onInfinityReelAdded 6→8',    added2.length === 2 && added2[1].p.to === 8);

/* milestone fires once at 6, once at 8 */
const ms = sb1.emits.filter(e => e.ev === 'onInfinityChainMilestone');
t('sandbox: milestones 6 + 8 fired',     ms.length === 2 && ms[0].p.count === 6 && ms[1].p.count === 8);

/* not regress when external decreases (no removal event) */
sb1.emits.length = 0;
sb1.window.__INFINITY_REELS_COUNT__ = 5;
sb1.listeners.onTumbleStep[0]();
t('sandbox: shrink not emit added',      sb1.emits.filter(e => e.ev === 'onInfinityReelAdded').length === 0);

/* postSpin emits reset if collapsed */
sb1.window.__INFINITY_REELS_COUNT__ = 5;
sb1.emits.length = 0;
/* Force chain back up to trigger condition properly */
sb1.window.__INFINITY_REELS_COUNT__ = 7;
sb1.listeners.onTumbleStep[0]();
sb1.window.__INFINITY_REELS_COUNT__ = 5;
sb1.listeners.postSpin[0]();
const reset1 = sb1.emits.filter(e => e.ev === 'onInfinityReelsReset');
t('sandbox: postSpin reset emit',        reset1.length === 1);

/* preSpin resets chain */
sb1.window.__INFINITY_REELS_COUNT__ = 9;
sb1.listeners.onTumbleStep[0]();
sb1.emits.length = 0;
sb1.listeners.preSpin[0]();
const reset2 = sb1.emits.filter(e => e.ev === 'onInfinityReelsReset');
t('sandbox: preSpin reset emit',         reset2.length === 1);

/* API bump */
const sb2 = makeSb();
runRt({ ...def, enabled: true }, sb2);
sb2.window.infinityReelsBump(3);
const added3 = sb2.emits.filter(e => e.ev === 'onInfinityReelAdded');
t('sandbox: bump API adds reels',        added3.length === 1 && added3[0].p.to === 8);

/* API set */
const sb3 = makeSb();
runRt({ ...def, enabled: true }, sb3);
sb3.window.infinityReelsSet(10);
const got = sb3.window.infinityReelsGet();
t('sandbox: set + get current=10',       got.count === 10);

/* FS chain reset on trigger */
const sb4 = makeSb();
runRt({ ...def, enabled: true }, sb4);
sb4.window.__INFINITY_REELS_COUNT__ = 7;
sb4.listeners.onTumbleStep[0]();
sb4.emits.length = 0;
sb4.listeners.onFsTrigger[0]();
const fsReset = sb4.emits.filter(e => e.ev === 'onInfinityReelsReset');
t('sandbox: onFsTrigger resets chain',   fsReset.length === 1);

/* FS spin result counts */
const sb5 = makeSb();
runRt({ ...def, enabled: true }, sb5);
sb5.window.__INFINITY_REELS_COUNT__ = 6;
sb5.listeners.onFsSpinResult[0]();
const fsAdd = sb5.emits.filter(e => e.ev === 'onInfinityReelAdded');
t('sandbox: onFsSpinResult emits added', fsAdd.length === 1);

/* cap enforcement */
const sb6 = makeSb();
runRt({ ...def, enabled: true, capCount: 7 }, sb6);
sb6.window.__INFINITY_REELS_COUNT__ = 99;
sb6.listeners.onTumbleStep[0]();
const capAdd = sb6.emits.filter(e => e.ev === 'onInfinityReelAdded');
t('sandbox: cap=7 clamps growth',        capAdd.length === 1 && capAdd[0].p.to === 7);

const src = readFileSync(SRC_PATH, 'utf8');
const VENDORS = /(\bIGT\b|pragmatic|megaways|netent|microgaming|reactoonz|olympus|wrath|cleopatra|buffalo|sugar rush|sweet bonanza|wolf run|cash eruption|playson|hacksaw|nolimit|btg|wazdan|playngo|yggdrasil|relax gaming|push gaming|stakelogic)/i;
t('source: vendor-neutral',              !VENDORS.test(src));

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
